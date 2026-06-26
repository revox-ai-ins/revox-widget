(function () {
  "use strict";

  var currentScript;
  var widgetId;
  var apiBase;

  var state = {
    config: null,
    isOpen: false,
    isStarted: false,
    isLoading: false,
    connectionState: "idle",
    socket: null,
    activeAgentMessageId: null,
    sessionWelcomeMessage: "",
    lastEventType: "",
    lastCloseCode: "",
    lastCloseReason: "",
    messages: [],
    typewriterTimer: null,
    error: ""
  };

  var host;
  var style;
  var root;

  resolveEmbedScript(0);

  function findEmbedScript() {
    var scripts = Array.prototype.slice.call(document.querySelectorAll("script[src]"));
    for (var index = scripts.length - 1; index >= 0; index -= 1) {
      var script = scripts[index];
      var src = script.getAttribute("src") || "";
      if (script.getAttribute("data-widget-id") && /\/embed\.js(\?|$)/.test(src)) {
        return script;
      }
    }
    return null;
  }

  function resolveEmbedScript(attempt) {
    currentScript = document.currentScript || findEmbedScript();
    widgetId = currentScript ? currentScript.getAttribute("data-widget-id") : "";

    if (!currentScript || !widgetId) {
      if (attempt < 20) {
        window.setTimeout(function () {
          resolveEmbedScript(attempt + 1);
        }, 50);
        return;
      }

      console.error("[Revox] Missing data-widget-id on embed script.");
      return;
    }

    apiBase =
      currentScript.getAttribute("data-api-base") ||
      new URL(currentScript.getAttribute("src") || "", window.location.href).origin;

    whenBodyReady(boot);
  }

  function boot() {
    host = document.createElement("div");
    host.id = "revox-widget-host";
    document.body.appendChild(host);

    var shadow = host.attachShadow({ mode: "open" });
    style = document.createElement("style");
    root = document.createElement("div");
    root.className = "revox-root";
    shadow.appendChild(style);
    shadow.appendChild(root);
    host.addEventListener("click", function (event) {
      if (event.defaultPrevented) return;

      if (state.config && !state.isOpen) {
        openWidget();
        return;
      }

      if (!state.isOpen) return;

      var actionBandTop = window.innerHeight - 132;
      if (event.clientY < actionBandTop) return;

      if (!state.isStarted) {
        startChat();
        return;
      }

      var input = root.querySelector("input[name='message']");
      if (input) input.focus();
    });

    loadConfig();
  }

  function whenBodyReady(callback) {
    if (document.body) {
      callback();
      return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function updateHostState() {
    host.setAttribute("data-revox-loaded", state.config ? "true" : "false");
    host.setAttribute("data-revox-open", state.isOpen ? "true" : "false");
    host.setAttribute("data-revox-started", state.isStarted ? "true" : "false");
    host.setAttribute("data-revox-connection", state.connectionState);
    host.setAttribute("data-revox-message-count", String(state.messages.length));
    host.setAttribute("data-revox-error", state.error ? "true" : "false");
    host.setAttribute("data-revox-last-event", state.lastEventType || "");
    host.setAttribute("data-revox-close-code", state.lastCloseCode || "");
    host.setAttribute("data-revox-close-reason", state.lastCloseReason || "");
  }

  async function loadConfig() {
    try {
      var response = await fetch(apiBase + "/public/widget-config/" + encodeURIComponent(widgetId), {
        method: "GET",
        credentials: "omit"
      });

      if (!response.ok) throw new Error("Widget is unavailable on this site.");

      state.config = normalizeConfig(await response.json());
      state.messages = [
        {
          role: "agent",
          text: state.config.welcomeMessage || "Hi, how can I help?"
        }
      ];
      injectStyles();
      render();
      track("loaded");
    } catch (error) {
      console.error("[Revox] Failed to load widget config", error);
    }
  }

  function injectStyles() {
    var cfg = state.config;
    var isLeft = cfg.widgetPosition === "bottom-left";

    style.textContent = `
      :host {
        all: initial;
      }

      .revox-root, .revox-root * {
        box-sizing: border-box;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }

      .revox-root {
        --revox-primary: ${sanitizeCssColor(cfg.primaryColor, "#2563eb")};
        --revox-secondary: ${sanitizeCssColor(cfg.secondaryColor, "#0f172a")};
        --revox-bg: ${sanitizeCssColor(cfg.backgroundColor, "#ffffff")};
        --revox-text: ${sanitizeCssColor(cfg.textColor, "#111827")};
        --revox-muted: color-mix(in srgb, var(--revox-text) 58%, white);
        --revox-line: rgba(15, 23, 42, 0.1);
        --revox-surface: color-mix(in srgb, var(--revox-bg) 94%, white);
        --revox-soft: color-mix(in srgb, var(--revox-primary) 9%, white);
        --revox-secondary-soft: color-mix(in srgb, var(--revox-secondary) 10%, white);
        --revox-agent-line: color-mix(in srgb, var(--revox-secondary) 34%, rgba(15, 23, 42, 0.08));
        position: fixed;
        ${isLeft ? "left" : "right"}: 24px;
        bottom: 24px;
        z-index: 2147483647;
        color: var(--revox-text);
      }

      button, input {
        font: inherit;
      }

      .launcher {
        position: relative;
        width: auto;
        min-width: 154px;
        height: 68px;
        padding: 0 18px 0 14px;
        border: 0;
        border-radius: 999px;
        background:
          radial-gradient(circle at 32% 18%, rgba(255,255,255,0.46), transparent 34%),
          linear-gradient(145deg, var(--revox-primary) 0%, var(--revox-primary) 42%, var(--revox-secondary) 100%);
        color: #ffffff;
        box-shadow:
          0 22px 54px rgba(15, 23, 42, 0.32),
          inset 0 1px 0 rgba(255, 255, 255, 0.34);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 11px;
        cursor: pointer;
        transition: transform 180ms ease, box-shadow 180ms ease, filter 180ms ease;
        animation: revox-pop 320ms cubic-bezier(.2,.9,.25,1.1);
      }

      .launcher::before {
        content: "";
        position: absolute;
        inset: -7px;
        border-radius: inherit;
        background: color-mix(in srgb, var(--revox-primary) 18%, transparent);
        opacity: 0.75;
        transform: scale(0.88);
        z-index: -1;
      }

      .launcher::after {
        content: "";
        position: absolute;
        left: 43px;
        top: 12px;
        width: 13px;
        height: 13px;
        border: 2px solid #ffffff;
        border-radius: 999px;
        background: #22c55e;
      }

      .launcher:hover {
        transform: translateY(-3px) scale(1.02);
        filter: saturate(1.08);
        box-shadow:
          0 28px 64px rgba(15, 23, 42, 0.36),
          inset 0 1px 0 rgba(255, 255, 255, 0.38);
      }

      .launcher-logo {
        width: 38px;
        height: 38px;
        border-radius: 999px;
        object-fit: cover;
        background: rgba(255, 255, 255, 0.18);
      }

      .launcher-mark {
        width: 34px;
        height: 34px;
        flex: 0 0 auto;
      }

      .launcher-copy {
        display: grid;
        gap: 1px;
        min-width: 0;
        text-align: left;
      }

      .launcher-copy strong,
      .launcher-copy span {
        display: block;
        max-width: 98px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .launcher-copy strong {
        font-size: 14px;
        line-height: 1.1;
      }

      .launcher-copy span {
        font-size: 11px;
        line-height: 1.15;
        opacity: 0.78;
      }

      .window {
        width: min(404px, calc(100vw - 32px));
        height: min(680px, calc(100vh - 32px));
        max-height: 680px;
        border: 1px solid rgba(255, 255, 255, 0.52);
        border-radius: 22px;
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.22)),
          var(--revox-bg);
        box-shadow:
          0 34px 90px rgba(15, 23, 42, 0.31),
          0 0 0 1px rgba(15, 23, 42, 0.04);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto auto auto;
        animation: revox-rise 240ms cubic-bezier(.2,.9,.25,1);
        transform-origin: bottom ${isLeft ? "left" : "right"};
      }

      .header {
        position: relative;
        min-height: 92px;
        padding: 18px 16px 18px 18px;
        background:
          linear-gradient(90deg, var(--revox-secondary) 0 6px, transparent 6px),
          radial-gradient(circle at 82% 0%, rgba(255,255,255,0.28), transparent 34%),
          linear-gradient(135deg, color-mix(in srgb, var(--revox-secondary) 88%, #020617), var(--revox-primary));
        color: #ffffff;
        display: flex;
        align-items: center;
        gap: 12px;
        overflow: hidden;
      }

      .header::after {
        content: "";
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.48), transparent);
      }

      .brand {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        flex: 1;
      }

      .brand-logo, .brand-fallback {
        width: 46px;
        height: 46px;
        border-radius: 999px;
        flex: 0 0 auto;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.24);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .brand-logo {
        object-fit: cover;
      }

      .brand-fallback {
        display: grid;
        place-items: center;
        font-weight: 800;
        font-size: 18px;
      }

      .title {
        min-width: 0;
      }

      .title strong, .title span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .title strong {
        font-size: 16px;
        line-height: 1.2;
      }

      .title span {
        width: fit-content;
        margin-top: 7px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        font-size: 12px;
        opacity: 0.92;
      }

      .title span::before {
        content: "";
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 6px;
        border-radius: 999px;
        background: #22c55e;
        vertical-align: 1px;
      }

      .icon-button {
        position: relative;
        z-index: 1;
        width: 38px;
        height: 38px;
        border: 0;
        border-radius: 999px;
        color: currentColor;
        background: rgba(255, 255, 255, 0.15);
        cursor: pointer;
        display: grid;
        place-items: center;
        transition: background 160ms ease, transform 160ms ease;
      }

      .icon-button:hover {
        background: rgba(255, 255, 255, 0.24);
        transform: rotate(4deg);
      }

      .messages {
        padding: 20px 16px 16px;
        overflow-y: auto;
        background:
          radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--revox-primary) 11%, transparent), transparent 28%),
          radial-gradient(circle at 90% 14%, color-mix(in srgb, var(--revox-secondary) 10%, transparent), transparent 24%),
          linear-gradient(rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.9)),
          var(--revox-bg);
      }

      .messages::-webkit-scrollbar {
        width: 8px;
      }

      .messages::-webkit-scrollbar-thumb {
        background: rgba(15, 23, 42, 0.14);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: content-box;
      }

      .message {
        display: flex;
        margin: 0 0 14px;
        animation: revox-message 180ms ease both;
      }

      .message.visitor {
        justify-content: flex-end;
      }

      .bubble {
        max-width: 82%;
        padding: 12px 14px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.48;
        overflow-wrap: anywhere;
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
      }

      .agent .bubble {
        border-bottom-left-radius: 7px;
        background:
          linear-gradient(90deg, var(--revox-secondary-soft), transparent 42%),
          rgba(255, 255, 255, 0.94);
        color: #0f172a;
        border: 1px solid var(--revox-agent-line);
      }

      .visitor .bubble {
        border-bottom-right-radius: 7px;
        background: linear-gradient(135deg, var(--revox-primary) 0%, color-mix(in srgb, var(--revox-primary) 68%, var(--revox-secondary)) 58%, var(--revox-secondary) 100%);
        color: #ffffff;
      }

      .stream-cursor {
        display: inline-block;
        width: 7px;
        height: 16px;
        margin-left: 2px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--revox-primary) 72%, var(--revox-secondary));
        vertical-align: -3px;
        animation: revox-cursor 900ms infinite ease-in-out;
      }

      .status {
        min-height: 26px;
        padding: 0 16px 8px;
        background: linear-gradient(rgba(255,255,255,0.9), rgba(255,255,255,0.9)), var(--revox-bg);
        color: var(--revox-muted);
        font-size: 12px;
      }

      .typing {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .typing span {
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: currentColor;
        opacity: 0.45;
        animation: revox-dot 900ms infinite ease-in-out;
      }

      .typing span:nth-child(2) { animation-delay: 120ms; }
      .typing span:nth-child(3) { animation-delay: 240ms; }

      .start, .controls {
        border-top: 1px solid var(--revox-line);
        background: var(--revox-surface);
      }

      .start {
        padding: 14px 16px 16px;
      }

      .start button, .composer button {
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--revox-primary), color-mix(in srgb, var(--revox-primary) 64%, var(--revox-secondary)), var(--revox-secondary));
        color: #ffffff;
        cursor: pointer;
        font-weight: 700;
        box-shadow: 0 12px 26px color-mix(in srgb, var(--revox-primary) 28%, transparent);
        transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
      }

      .start button:hover, .composer button:hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 30px color-mix(in srgb, var(--revox-primary) 34%, transparent);
      }

      .start button {
        width: 100%;
        min-height: 48px;
      }

      .composer {
        padding: 8px 14px 14px;
        background: transparent;
        display: grid;
        grid-template-columns: 1fr 46px;
        gap: 8px;
      }

      .conversation-actions {
        padding: 10px 14px 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .conversation-state {
        min-width: 0;
        color: color-mix(in srgb, var(--revox-text) 58%, white);
        font-size: 12px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .end-button {
        flex: 0 0 auto;
        min-height: 32px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        padding: 0 13px;
        background: color-mix(in srgb, var(--revox-secondary) 7%, white);
        color: color-mix(in srgb, var(--revox-secondary) 72%, var(--revox-text));
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
      }

      .end-button:hover {
        background: #ffffff;
        color: var(--revox-secondary);
        border-color: color-mix(in srgb, var(--revox-secondary) 38%, rgba(15, 23, 42, 0.12));
      }

      .composer input {
        width: 100%;
        min-width: 0;
        height: 46px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        padding: 0 16px;
        color: var(--revox-text);
        background: #ffffff;
        outline: none;
        box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
      }

      .composer input:focus {
        border-color: var(--revox-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--revox-primary) 18%, transparent);
      }

      .composer button {
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
      }

      .composer button:disabled, .start button:disabled {
        cursor: wait;
        opacity: 0.66;
      }

      .footer {
        padding: 9px 12px 11px;
        border-top: 1px solid rgba(15, 23, 42, 0.07);
        background: rgba(255, 255, 255, 0.82);
        text-align: center;
        color: var(--revox-muted);
        font-size: 12px;
      }

      .footer a {
        color: var(--revox-primary);
        text-decoration: none;
        font-weight: 700;
      }

      @media (max-width: 520px) {
        .revox-root {
          left: 12px;
          right: 12px;
          bottom: 12px;
        }

        .launcher {
          margin-left: auto;
          min-width: 136px;
          height: 62px;
          padding: 0 16px 0 13px;
        }

        .window {
          width: 100%;
          height: min(680px, calc(100vh - 24px));
          border-radius: 18px;
        }
      }

      @keyframes revox-pop {
        from { opacity: 0; transform: translateY(8px) scale(0.92); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes revox-rise {
        from { opacity: 0; transform: translateY(14px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes revox-message {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes revox-dot {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
        40% { transform: translateY(-3px); opacity: 0.9; }
      }

      @keyframes revox-cursor {
        0%, 100% { opacity: 0.25; transform: scaleY(0.72); }
        50% { opacity: 1; transform: scaleY(1); }
      }
    `;
  }

  function render() {
    if (!state.config) return;
    updateHostState();

    if (!state.isOpen) {
      root.innerHTML = `
        <button class="launcher" type="button" aria-label="Open ${escapeHtml(state.config.widgetName)} chat">
          ${logoHtml("launcher-logo") || chatIcon("launcher-mark")}
          <span class="launcher-copy">
            <strong>Chat</strong>
            <span>${escapeHtml(state.config.widgetName)}</span>
          </span>
        </button>
      `;
      root.querySelector(".launcher").addEventListener("click", openWidget);
      return;
    }

    root.innerHTML = `
      <section class="window" role="dialog" aria-label="${escapeHtml(state.config.widgetName)} chat">
        <header class="header">
          <div class="brand">
            ${logoHtml("brand-logo") || '<div class="brand-fallback">R</div>'}
            <div class="title">
              <strong>${escapeHtml(state.config.widgetName)}</strong>
              <span>${connectionLabel()}</span>
            </div>
          </div>
          <button class="icon-button close" type="button" aria-label="Close chat">${closeIcon()}</button>
        </header>
        <div class="messages" aria-live="polite">
          ${state.messages.map(messageHtml).join("")}
        </div>
        <div class="status">${statusText()}</div>
        ${state.isStarted ? activeChatControlsHtml() : startHtml()}
        <footer class="footer">Powered by <a href="https://revoxai.io" target="_blank" rel="noreferrer">Revox</a></footer>
      </section>
    `;

    root.querySelector(".close").addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeWidget();
    });
    var startButton = root.querySelector("[data-start]");
    if (startButton) {
      startButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        startChat();
      });
    }

    var endButton = root.querySelector("[data-end]");
    if (endButton) {
      endButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        endConversation();
      });
    }

    var form = root.querySelector("form");
    if (form) {
      form.addEventListener("submit", sendMessage);
      form.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }

    var messages = root.querySelector(".messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  }

  function openWidget() {
    state.isOpen = true;
    state.error = "";
    render();
    track("opened");
  }

  function closeWidget() {
    state.isOpen = false;
    render();
  }

  function endConversation() {
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close(1000, "Visitor ended conversation");
      state.socket = null;
    }

    stopTypewriter();
    var endedMessage = getActiveAgentMessage();
    if (endedMessage) endedMessage.streaming = false;

    state.isStarted = false;
    state.isLoading = false;
    state.connectionState = "idle";
    state.activeAgentMessageId = null;
    state.error = "";
    track("chat_ended");
    render();
  }

  async function startChat() {
    if (state.isLoading || state.isStarted) return;

    setLoading(true, "");
    try {
      var response = await fetch(apiBase + "/public/widget-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ widgetId: widgetId, pageUrl: window.location.href })
      });

      if (!response.ok) throw new Error("Could not start this chat. Please try again.");

      var session = await response.json();
      if (session.welcomeMessage) {
        state.sessionWelcomeMessage = session.welcomeMessage;
        state.messages = [{ role: "agent", text: session.welcomeMessage }];
      }
      connectToElevenLabs(session.signedUrl);
      state.isStarted = true;
      state.connectionState = "connecting";
      setLoading(true, "");
    } catch (error) {
      setLoading(false, error.message || "Could not start this chat. Please try again.");
    }
  }

  function connectToElevenLabs(signedUrl) {
    if (state.socket) state.socket.close();

    try {
      state.socket = new WebSocket(signedUrl);
    } catch (error) {
      state.error = "Realtime chat connection failed.";
      render();
      return;
    }

    state.socket.addEventListener("open", function () {
      state.error = "";
      state.connectionState = "connected";
      state.isLoading = false;
      safeSocketSend({
        type: "conversation_initiation_client_data",
        conversation_config_override: {},
        dynamic_variables: {
          welcome_message: state.sessionWelcomeMessage || state.config.welcomeMessage || ""
        }
      });
      render();
    });

    state.socket.addEventListener("message", function (event) {
      handleAgentEvent(event.data);
    });

    state.socket.addEventListener("close", function (event) {
      state.lastCloseCode = String(event.code || "");
      state.lastCloseReason = event.reason || "";
      if (state.isStarted) {
        state.error = "Chat disconnected. Start a new chat if you need more help.";
        state.isStarted = false;
        state.isLoading = false;
        state.connectionState = "disconnected";
        state.activeAgentMessageId = null;
        track("chat_ended");
        render();
      }
    });

    state.socket.addEventListener("error", function () {
      state.error = "Realtime chat connection failed.";
      state.connectionState = "error";
      state.isLoading = false;
      render();
    });
  }

  function handleAgentEvent(rawData) {
    var payload;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return;
    }

    state.lastEventType = payload.type || "";
    updateHostState();

    if (payload.type === "ping" && payload.ping_event?.event_id !== undefined) {
      safeSocketSend({ type: "pong", event_id: payload.ping_event.event_id });
      return;
    }

    if (payload.type === "agent_chat_response_part" && payload.text_response_part) {
      handleAgentTextPart(payload.text_response_part);
      return;
    }

    var text =
      payload.agent_response_event?.agent_response ||
      payload.agent_response_correction_event?.corrected_agent_response ||
      payload.agent_response ||
      payload.text ||
      payload.message;

    if (!text || typeof text !== "string") return;

    var lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage.role === "agent" && lastMessage.text === text) {
      state.isLoading = false;
      lastMessage.streaming = false;
      render();
      return;
    }

    var activeMessage = getActiveAgentMessage();
    if (activeMessage) {
      activeMessage.pendingText = text.slice(activeMessage.text.length);
      activeMessage.finishWhenTyped = true;
      activeMessage.streaming = true;
      startTypewriter();
    } else {
      ensureActiveAgentMessage("");
      queueAgentText(text, true);
    }
    state.isLoading = false;
    render();
  }

  function handleAgentTextPart(part) {
    if (!part) return;
    if (typeof part === "string") {
      appendAgentDelta(part);
      return;
    }

    var partText = typeof part.text === "string" ? part.text : "";

    if (part.type === "start") {
      ensureActiveAgentMessage("");
      queueAgentText(partText, false);
      state.isLoading = true;
      render();
      return;
    }

    if (part.type === "delta") {
      queueAgentText(partText, false);
      state.isLoading = true;
      render();
      return;
    }

    if (part.type === "stop") {
      state.isLoading = false;
      var stoppedMessage = getActiveAgentMessage();
      if (stoppedMessage) stoppedMessage.finishWhenTyped = true;
      startTypewriter();
      render();
    }
  }

  function ensureActiveAgentMessage(initialText) {
    var existing = getActiveAgentMessage();
    if (existing) {
      if (initialText) existing.pendingText = (existing.pendingText || "") + initialText;
      existing.streaming = true;
      return existing;
    }

    state.activeAgentMessageId = "agent-" + Date.now();
    var message = {
      id: state.activeAgentMessageId,
      role: "agent",
      text: "",
      pendingText: initialText || "",
      streaming: true,
      finishWhenTyped: false
    };
    state.messages.push(message);
    startTypewriter();
    return message;
  }

  function appendAgentDelta(text) {
    queueAgentText(text, false);
  }

  function queueAgentText(text, finishWhenTyped) {
    var message = ensureActiveAgentMessage("");
    if (text) message.pendingText = (message.pendingText || "") + text;
    message.streaming = true;
    if (finishWhenTyped) message.finishWhenTyped = true;
    startTypewriter();
  }

  function startTypewriter() {
    if (state.typewriterTimer) return;

    state.typewriterTimer = window.setInterval(function () {
      var message = getActiveAgentMessage();
      if (!message) {
        stopTypewriter();
        return;
      }

      var pending = message.pendingText || "";
      if (!pending) {
        if (message.finishWhenTyped) {
          message.streaming = false;
          message.finishWhenTyped = false;
          state.activeAgentMessageId = null;
          stopTypewriter();
          render();
        }
        return;
      }

      var charsToReveal = pending.length > 24 ? 3 : 1;
      message.text += pending.slice(0, charsToReveal);
      message.pendingText = pending.slice(charsToReveal);
      message.streaming = true;
      render();
    }, 22);
  }

  function stopTypewriter() {
    if (!state.typewriterTimer) return;
    window.clearInterval(state.typewriterTimer);
    state.typewriterTimer = null;
  }

  function getActiveAgentMessage() {
    if (!state.activeAgentMessageId) return null;
    return state.messages.find(function (message) {
      return message.id === state.activeAgentMessageId;
    });
  }

  function sendMessage(event) {
    event.preventDefault();
    var input = root.querySelector("input[name='message']");
    var text = input && input.value ? input.value.trim() : "";
    if (!text || state.connectionState !== "connected") return;

    state.messages.push({ role: "visitor", text: text });
    ensureActiveAgentMessage("");
    state.isLoading = true;
    state.error = "";
    if (input) input.value = "";

    safeSocketSend({
      type: "user_message",
      text: text
    });

    track("message_sent", { length: text.length });
    render();
  }

  function safeSocketSend(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      state.error = "Chat is reconnecting. Please try again in a moment.";
      state.connectionState = "disconnected";
      state.isLoading = false;
      render();
      return;
    }

    state.socket.send(JSON.stringify(payload));
  }

  function setLoading(isLoading, error) {
    state.isLoading = isLoading;
    state.error = error;
    updateHostState();
    render();
  }

  function track(eventName, metadata) {
    fetch(apiBase + "/public/widget-analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      keepalive: true,
      body: JSON.stringify({
        widgetId: widgetId,
        sessionId: state.sessionId || undefined,
        event: eventName,
        metadata: metadata
      })
    }).catch(function () {});
  }

  function messageHtml(message) {
    var body = message.text ? escapeHtml(message.text) : "";
    if (message.streaming) body += '<span class="stream-cursor" aria-hidden="true"></span>';

    return `
      <div class="message ${message.role === "visitor" ? "visitor" : "agent"}">
        <div class="bubble">${body}</div>
      </div>
    `;
  }

  function startHtml() {
    return `
      <div class="start">
        <button type="button" data-start ${state.isLoading ? "disabled" : ""}>
          ${state.isLoading ? "Starting..." : "Start chat"}
        </button>
      </div>
    `;
  }

  function activeChatControlsHtml() {
    return `
      <div class="controls">
        <div class="conversation-actions">
          <span class="conversation-state">${escapeHtml(connectionLabel())}</span>
          <button class="end-button" type="button" data-end>End conversation</button>
        </div>
        ${composerHtml()}
      </div>
    `;
  }

  function composerHtml() {
    var disabled = state.connectionState !== "connected";
    return `
      <form class="composer">
        <input name="message" type="text" autocomplete="off" placeholder="${disabled ? "Connecting..." : "Type your message..."}" aria-label="Message" ${disabled ? "disabled" : ""} />
        <button type="submit" aria-label="Send message" ${disabled ? "disabled" : ""}>${sendIcon()}</button>
      </form>
    `;
  }

  function statusText() {
    if (state.error) return escapeHtml(state.error);
    if (state.connectionState === "connecting") return 'Connecting <span class="typing" aria-hidden="true"><span></span><span></span><span></span></span>';
    if (state.connectionState === "disconnected") return "Disconnected";
    if (state.connectionState === "error") return "Connection error";
    if (state.isStarted) return "Connected securely";
    return "";
  }

  function connectionLabel() {
    if (state.connectionState === "connecting") return "Connecting";
    if (state.connectionState === "connected") return "Connected";
    if (state.connectionState === "error") return "Connection error";
    if (state.connectionState === "disconnected") return "Disconnected";
    return "Secure AI chat";
  }

  function normalizeConfig(raw) {
    return {
      widgetName: raw.widget_name || raw.widgetName || "Revox Assistant",
      logoUrl: raw.logo_url || raw.logoUrl || "",
      primaryColor: raw.primary_color || raw.primaryColor || "#2563eb",
      secondaryColor: raw.secondary_color || raw.secondaryColor || "#0f172a",
      backgroundColor: raw.background_color || raw.backgroundColor || "#ffffff",
      textColor: raw.text_color || raw.textColor || "#111827",
      welcomeMessage: raw.welcome_message || raw.welcomeMessage || "Hi, how can I help?",
      widgetPosition: raw.widget_position || raw.widgetPosition || "bottom-right",
      textEnabled: raw.text_enabled ?? raw.textEnabled ?? true,
      voiceEnabled: raw.voice_enabled ?? raw.voiceEnabled ?? false
    };
  }

  function logoHtml(className) {
    if (!state.config.logoUrl) return "";
    return '<img class="' + className + '" src="' + escapeAttribute(state.config.logoUrl) + '" alt="" />';
  }

  function chatIcon(className) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 8.5C5 6.57 6.57 5 8.5 5h7C17.43 5 19 6.57 19 8.5v4.2c0 1.93-1.57 3.5-3.5 3.5H12l-4.2 2.55a.8.8 0 0 1-1.2-.68V16.1A3.5 3.5 0 0 1 5 12.7V8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function closeIcon() {
    return `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `;
  }

  function sendIcon() {
    return `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m5 12 14-7-4 14-3-5-7-2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function sanitizeCssColor(value, fallback) {
    if (!value || typeof value !== "string") return fallback;
    var trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    if (/^rgb(a)?\([0-9,.\s%/]+\)$/.test(trimmed)) return trimmed;
    if (/^hsl(a)?\([0-9,.\s%/deg]+\)$/.test(trimmed)) return trimmed;
    return fallback;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();
