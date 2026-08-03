(function () {
  "use strict";

  var currentScript;
  var widgetId;
  var apiBase;
  var IDLE_TIMEOUT_MS = 40000;
  var DEFAULT_SDK_SRC = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.14.0/dist/lib.iife.js";
  var sdkSrc;

  var state = {
    config: null,
    isOpen: false,
    isStarted: false,
    isLoading: false,
    mode: "text",
    conversationMode: "text",
    sdkPromise: null,
    conversation: null,
    connectionState: "idle",
    voiceState: "idle",
    voiceMode: "listening",
    isMicActive: false,
    isMuted: false,
    visualizerTimer: null,
    visualizerBars: [8, 18, 36, 22, 14, 30, 12, 24, 16, 28, 10, 20],
    inputVolume: 0,
    outputVolume: 0,
    transcriptPreview: "",
    activeAgentMessageId: null,
    sessionId: "",
    sessionWelcomeMessage: "",
    lastEventType: "",
    lastCloseCode: "",
    lastCloseReason: "",
    messages: [],
    typewriterTimer: null,
    idleTimer: null,
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
    sdkSrc = currentScript.getAttribute("data-sdk-src") || DEFAULT_SDK_SRC;

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
        startConversation(state.mode);
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
      if (!state.config.textEnabled && state.config.voiceEnabled) state.mode = "voice";
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
        min-width: 184px;
        height: 70px;
        padding: 9px 12px 9px 10px;
        border: 1px solid rgba(255, 255, 255, 0.42);
        border-radius: 24px;
        background:
          linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08)),
          radial-gradient(circle at 22% 18%, rgba(255,255,255,0.5), transparent 34%),
          linear-gradient(135deg, var(--revox-primary) 0%, var(--revox-secondary) 94%);
        color: #ffffff;
        box-shadow:
          0 22px 54px rgba(15, 23, 42, 0.28),
          0 0 0 1px color-mix(in srgb, var(--revox-primary) 16%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.42);
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 10px;
        cursor: pointer;
        transition: transform 180ms ease, box-shadow 180ms ease, filter 180ms ease;
        animation: revox-pop 320ms cubic-bezier(.2,.9,.25,1.1);
        isolation: isolate;
        overflow: hidden;
      }

      .launcher::before {
        content: "";
        position: absolute;
        inset: 1px;
        border-radius: 22px;
        background:
          linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
        opacity: 0.72;
        transform: translateX(-42%);
        z-index: -1;
        pointer-events: none;
      }

      .launcher::after {
        content: "";
        position: absolute;
        inset: -18px;
        border-radius: 32px;
        background: color-mix(in srgb, var(--revox-primary) 18%, transparent);
        opacity: 0.54;
        z-index: -2;
      }

      .launcher:hover {
        transform: translateY(-3px);
        filter: saturate(1.08);
        box-shadow:
          0 28px 70px rgba(15, 23, 42, 0.34),
          0 0 0 1px color-mix(in srgb, var(--revox-primary) 20%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.46);
      }

      .launcher-icon {
        position: relative;
        width: 48px;
        height: 48px;
        border-radius: 16px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08));
        box-shadow:
          inset 0 0 0 1px rgba(255,255,255,0.24),
          0 10px 22px rgba(15,23,42,0.2);
      }

      .launcher-status {
        position: absolute;
        right: -2px;
        top: -2px;
        width: 13px;
        height: 13px;
        border: 2px solid rgba(255,255,255,0.92);
        border-radius: 999px;
        background: #22c55e;
      }

      .launcher-logo {
        width: 36px;
        height: 36px;
        border-radius: 12px;
        object-fit: cover;
        background: rgba(255, 255, 255, 0.16);
      }

      .launcher-mark {
        width: 30px;
        height: 30px;
        flex: 0 0 auto;
      }

      .launcher-copy {
        display: grid;
        gap: 1px;
        min-width: 0;
        text-align: left;
        flex: 1 1 auto;
      }

      .launcher-copy strong,
      .launcher-copy span {
        display: block;
        max-width: 104px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .launcher-copy strong {
        font-size: 14.5px;
        line-height: 1.1;
        font-weight: 760;
      }

      .launcher-copy span {
        font-size: 11px;
        line-height: 1.15;
        opacity: 0.74;
      }

      .launcher-action {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        background: rgba(255,255,255,0.18);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
        transition: transform 180ms ease, background 180ms ease;
      }

      .launcher:hover .launcher-action {
        transform: translateX(2px);
        background: rgba(255,255,255,0.24);
      }

      .window {
        width: min(392px, calc(100vw - 32px));
        height: min(640px, calc(100vh - 32px));
        max-height: 640px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 20px;
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.34)),
          var(--revox-bg);
        box-shadow:
          0 28px 80px rgba(15, 23, 42, 0.24),
          0 0 0 1px rgba(15, 23, 42, 0.04);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) auto auto auto;
        animation: revox-rise 240ms cubic-bezier(.2,.9,.25,1);
        transform-origin: bottom ${isLeft ? "left" : "right"};
      }

      .header {
        position: relative;
        min-height: 82px;
        padding: 15px 14px 15px 16px;
        background:
          radial-gradient(circle at 92% -10%, rgba(255,255,255,0.28), transparent 34%),
          linear-gradient(135deg, color-mix(in srgb, var(--revox-secondary) 86%, #020617), var(--revox-primary));
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
        width: 44px;
        height: 44px;
        border-radius: 14px;
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
        font-size: 15.5px;
        line-height: 1.2;
      }

      .title span {
        width: fit-content;
        margin-top: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        font-size: 11.5px;
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
        width: 36px;
        height: 36px;
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
        padding: 16px 14px 14px;
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

      .mode-switch {
        height: 62px;
        min-height: 62px;
        max-height: 62px;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        background:
          linear-gradient(rgba(255,255,255,0.96), rgba(255,255,255,0.96)),
          var(--revox-bg);
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        overflow: hidden;
      }

      .mode-switch button {
        appearance: none;
        width: 100%;
        height: 40px;
        min-width: 0;
        min-height: 40px;
        max-height: 40px;
        padding: 0 12px;
        border: 1px solid rgba(15, 23, 42, 0.06);
        border-radius: 14px;
        background: transparent;
        color: color-mix(in srgb, var(--revox-text) 72%, white);
        cursor: pointer;
        font-size: 13.5px;
        line-height: 1;
        font-weight: 750;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        overflow: hidden;
        white-space: nowrap;
        transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }

      .mode-switch button[aria-pressed="true"] {
        background: #ffffff;
        border-color: rgba(15, 23, 42, 0.08);
        color: var(--revox-text);
        box-shadow:
          0 10px 24px rgba(15, 23, 42, 0.08),
          inset 0 -2px 0 color-mix(in srgb, var(--revox-primary) 82%, var(--revox-secondary));
      }

      .mode-switch svg {
        width: 15px;
        height: 15px;
        flex: 0 0 auto;
      }

      .mode-switch button:disabled {
        cursor: not-allowed;
        opacity: 0.48;
      }

      .conversation-body {
        min-height: 0;
        overflow: hidden;
        background:
          radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--revox-primary) 11%, transparent), transparent 28%),
          radial-gradient(circle at 90% 14%, color-mix(in srgb, var(--revox-secondary) 10%, transparent), transparent 24%),
          linear-gradient(rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.9)),
          var(--revox-bg);
      }

      .conversation-body .messages {
        height: 100%;
        background: transparent;
      }

      .voice-stage {
        height: 100%;
        min-height: 0;
        padding: 16px 14px 14px;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 12px;
      }

      .voice-orb-wrap {
        min-height: 250px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 18px;
        background:
          radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--revox-primary) 18%, transparent), transparent 30%),
          radial-gradient(circle at 46% 48%, color-mix(in srgb, var(--revox-secondary) 14%, transparent), transparent 36%),
          rgba(255, 255, 255, 0.76);
        display: grid;
        place-items: center;
        overflow: hidden;
      }

      .voice-orb {
        position: relative;
        width: min(208px, 58vw);
        aspect-ratio: 1;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 42% 34%, rgba(255, 255, 255, 0.7), transparent 22%),
          conic-gradient(from 160deg, var(--revox-primary), var(--revox-secondary), var(--revox-primary));
        box-shadow:
          0 28px 70px color-mix(in srgb, var(--revox-primary) 24%, transparent),
          inset 0 1px 0 rgba(255,255,255,0.45);
      }

      .voice-orb::before,
      .voice-orb::after {
        content: "";
        position: absolute;
        inset: -18px;
        border-radius: inherit;
        border: 1px solid color-mix(in srgb, var(--revox-primary) 22%, transparent);
        opacity: 0.7;
        animation: revox-ring 2.6s infinite ease-out;
      }

      .voice-orb::after {
        inset: -34px;
        border-color: color-mix(in srgb, var(--revox-secondary) 18%, transparent);
        animation-delay: 520ms;
      }

      .voice-visualizer {
        position: relative;
        z-index: 1;
        width: 74%;
        height: 70px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
      }

      .voice-bar {
        width: 7px;
        height: calc(var(--bar-height) * 1px);
        min-height: 10px;
        max-height: 74px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 0 18px rgba(255, 255, 255, 0.38);
        transition: height 90ms linear;
      }

      .voice-meta {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 20px;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #ffffff;
        font-size: 12px;
        font-weight: 760;
      }

      .voice-pill {
        padding: 5px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        backdrop-filter: blur(10px);
      }

      .voice-transcript {
        min-height: 70px;
        padding: 12px 13px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.86);
        color: color-mix(in srgb, var(--revox-text) 78%, white);
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .voice-transcript strong {
        display: block;
        margin-bottom: 4px;
        color: var(--revox-text);
        font-size: 12px;
      }

      .message {
        display: flex;
        margin: 0 0 12px;
        animation: revox-message 180ms ease both;
      }

      .message.visitor {
        justify-content: flex-end;
      }

      .bubble {
        max-width: 82%;
        padding: 11px 13px;
        border-radius: 15px;
        font-size: 14px;
        line-height: 1.5;
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
        min-height: 24px;
        padding: 0 14px 8px;
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
        padding: 13px 14px 15px;
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
        min-height: 46px;
      }

      .composer {
        padding: 0;
        background: transparent;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .controls {
        padding: 10px 12px 12px;
        display: grid;
        gap: 10px;
      }

      .conversation-actions {
        padding: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .conversation-state {
        min-width: 0;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: color-mix(in srgb, var(--revox-text) 58%, white);
        font-size: 12px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .conversation-state::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.13);
        flex: 0 0 auto;
      }

      .end-button {
        flex: 0 0 auto;
        min-height: 34px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        padding: 0 13px;
        background: #ffffff;
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

      .mute-button {
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        background: #ffffff;
        color: var(--revox-secondary);
        cursor: pointer;
        display: grid;
        place-items: center;
      }

      .composer input {
        width: 100%;
        min-width: 0;
        height: 44px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 14px;
        padding: 0 14px;
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
        width: 44px;
        height: 44px;
        flex: 0 0 44px;
        display: grid;
        place-items: center;
      }

      .composer button:disabled, .start button:disabled {
        cursor: wait;
        opacity: 0.66;
      }

      .footer {
        padding: 8px 12px 10px;
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

      @keyframes revox-ring {
        from { opacity: 0.7; transform: scale(0.72); }
        to { opacity: 0; transform: scale(1.08); }
      }
    `;
  }

  function render() {
    if (!state.config) return;
    updateHostState();

    if (!state.isOpen) {
      root.innerHTML = `
        <button class="launcher" type="button" aria-label="Open ${escapeHtml(state.config.widgetName)} chat">
          <span class="launcher-icon">
            ${logoHtml("launcher-logo") || chatIcon("launcher-mark")}
            <span class="launcher-status" aria-hidden="true"></span>
          </span>
          <span class="launcher-copy">
            <strong>Ask ${escapeHtml(shortWidgetName(state.config.widgetName))}</strong>
            <span>AI assistant</span>
          </span>
          <span class="launcher-action" aria-hidden="true">${arrowRightIcon()}</span>
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
        ${modeSwitchHtml()}
        <div class="conversation-body">
          ${state.mode === "voice" ? voiceStageHtml() : messagesHtml()}
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
        startConversation(state.mode);
      });
    }

    Array.prototype.forEach.call(root.querySelectorAll("[data-mode]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setMode(button.getAttribute("data-mode"));
      });
    });

    var endButton = root.querySelector("[data-end]");
    if (endButton) {
      endButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        endConversation();
      });
    }

    var muteButton = root.querySelector("[data-mute]");
    if (muteButton) {
      muteButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleMute();
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

  function renderMessagesOnly() {
    if (!state.config || state.mode !== "text") {
      render();
      return;
    }

    var conversationBody = root.querySelector(".conversation-body");
    if (!conversationBody) {
      render();
      return;
    }

    var activeMessage = getActiveAgentMessage();
    if (activeMessage && activeMessage.id) {
      var activeBubble = root.querySelector('[data-message-id="' + escapeAttribute(activeMessage.id) + '"] .bubble');
      if (activeBubble) {
        var textNode = activeBubble.querySelector(".bubble-text");
        if (textNode) textNode.textContent = activeMessage.text || "";

        var cursor = activeBubble.querySelector(".stream-cursor");
        if (activeMessage.streaming && !cursor) {
          var newCursor = document.createElement("span");
          newCursor.className = "stream-cursor";
          newCursor.setAttribute("aria-hidden", "true");
          activeBubble.appendChild(newCursor);
        }
        if (!activeMessage.streaming && cursor) cursor.remove();

        var activeMessages = conversationBody.querySelector(".messages");
        if (activeMessages) activeMessages.scrollTop = activeMessages.scrollHeight;

        var activeStatus = root.querySelector(".status");
        if (activeStatus) activeStatus.innerHTML = statusText();
        return;
      }
    }

    conversationBody.innerHTML = messagesHtml();
    var messages = conversationBody.querySelector(".messages");
    if (messages) messages.scrollTop = messages.scrollHeight;

    var status = root.querySelector(".status");
    if (status) status.innerHTML = statusText();
  }

  function renderVoiceVisualizerOnly() {
    var bars = root.querySelectorAll(".voice-bar");
    if (!bars.length) return;

    Array.prototype.forEach.call(bars, function (bar, index) {
      bar.style.setProperty("--bar-height", String(state.visualizerBars[index] || 10));
    });

    var transcript = root.querySelector(".voice-transcript");
    if (transcript) {
      transcript.innerHTML = "<strong>Live transcript</strong>" +
        escapeHtml(state.transcriptPreview || latestTranscriptText() || "Start voice and speak naturally.");
    }
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

  function setMode(mode) {
    if (mode !== "text" && mode !== "voice") return;
    if (state.isStarted || state.isLoading) return;
    if (mode === "text" && !state.config.textEnabled) return;

    state.mode = mode;
    state.error = "";
    render();
  }

  function endConversation() {
    clearIdleTimer();
    stopVisualizer();

    if (state.conversation) {
      var conversation = state.conversation;
      state.conversation = null;
      conversation.endSession().catch(function () {});
    }

    stopTypewriter();
    var endedMessage = getActiveAgentMessage();
    if (endedMessage) endedMessage.streaming = false;

    state.isStarted = false;
    state.isLoading = false;
    state.connectionState = "idle";
    state.voiceState = "idle";
    state.voiceMode = "listening";
    state.isMicActive = false;
    state.isMuted = false;
    state.transcriptPreview = "";
    state.activeAgentMessageId = null;
    state.error = "";
    track("chat_ended", { mode: state.conversationMode, reason: "visitor" });
    render();
  }

  async function startConversation(mode) {
    if (state.isLoading || state.isStarted) return;
    if (mode === "text" && !state.config.textEnabled) return;

    setLoading(true, "");
    try {
      var sessionMode = shouldUseMicrophone(mode) ? "voice" : mode;
      state.isMicActive = false;
      state.voiceState = "idle";
      state.voiceMode = "listening";
      state.isMuted = false;
      var response = await fetch(apiBase + "/public/widget-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ widgetId: widgetId, pageUrl: window.location.href, mode: sessionMode })
      });

      if (!response.ok) throw new Error("Could not start this chat. Please try again.");

      var session = await response.json();
      state.sessionId = session.sessionId || "";
      if (session.welcomeMessage) {
        state.sessionWelcomeMessage = session.welcomeMessage;
        state.messages = [{ role: "agent", text: session.welcomeMessage }];
      }
      state.isStarted = true;
      state.conversationMode = mode;
      state.connectionState = "connecting";
      state.isMicActive = sessionMode === "voice";
      state.voiceState = sessionMode === "voice" ? "connecting" : "idle";
      render();
      await connectToElevenLabs(session.signedUrl, mode, sessionMode);
    } catch (error) {
      state.isStarted = false;
      state.isMicActive = false;
      state.connectionState = "idle";
      state.voiceState = "idle";
      setLoading(false, error.message || "Could not start this chat. Please try again.");
    }
  }

  function shouldUseMicrophone(mode) {
    return mode === "voice";
  }

  async function connectToElevenLabs(signedUrl, mode, sessionMode) {
    if (state.conversation) await state.conversation.endSession().catch(function () {});

    var client = await loadElevenLabsClient();
    if (!client.Conversation || !client.Conversation.startSession) {
      throw new Error("Realtime chat client is not available.");
    }

    if (sessionMode === "voice") {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Voice needs HTTPS and microphone access. Some HTML testers block this.");
      }

      var permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach(function (track) {
        track.stop();
      });
    }

    var isVoiceSession = sessionMode === "voice";
    var sessionOptions = {
      signedUrl: signedUrl,
      connectionType: "websocket",
      textOnly: !isVoiceSession,
      overrides: {
        conversation: {
          textOnly: !isVoiceSession
        }
      },
      dynamicVariables: {
        welcome_message: state.sessionWelcomeMessage || state.config.welcomeMessage || ""
      },
      onConnect: function () {
        state.error = "";
        state.connectionState = "connected";
        state.isMicActive = sessionMode === "voice";
        state.voiceState = sessionMode === "voice" ? "listening" : "idle";
        state.isLoading = false;
        state.isStarted = true;
        resetIdleTimer();
        if (sessionMode === "voice") startVisualizer();
        render();
      },
      onDisconnect: function (details) {
        clearIdleTimer();
        stopVisualizer();
        if (state.isStarted) {
          state.error = details && details.reason === "user" ? "" : disconnectMessage(details);
          state.isStarted = false;
          state.isLoading = false;
          state.connectionState = details && details.reason === "user" ? "idle" : "disconnected";
          state.voiceState = "idle";
          state.isMicActive = false;
          state.activeAgentMessageId = null;
          track("chat_ended", { mode: state.conversationMode, reason: details ? details.reason : "disconnect" });
          render();
        }
      },
      onError: function (message) {
        clearIdleTimer();
        stopVisualizer();
        state.error = normalizeErrorMessage(message) || "Realtime chat connection failed.";
        state.connectionState = "error";
        state.voiceState = "idle";
        state.isMicActive = false;
        state.isLoading = false;
        render();
      },
      onStatusChange: function (props) {
        state.connectionState = props.status === "connected" ? "connected" : props.status;
        state.isLoading = props.status === "connecting";
        render();
      },
      onModeChange: function (props) {
        state.voiceMode = props.mode;
        state.voiceState = props.mode;
        render();
      },
      onMessage: function (payload) {
        handleSdkMessage(payload, mode);
      },
      onAgentChatResponsePart: function (part) {
        handleAgentTextPart(part);
      },
      onVadScore: function (props) {
        state.inputVolume = Math.max(0, Math.min(1, Number(props.vadScore) || 0));
      }
    };

    state.conversation = await client.Conversation.startSession(sessionOptions);
  }

  function disconnectMessage(details) {
    if (!details) return "Chat disconnected. Start a new chat if you need more help.";
    if (details.message) return normalizeErrorMessage(details.message);
    if (details.closeReason) return normalizeErrorMessage(details.closeReason);
    if (details.context && details.context.reason) return normalizeErrorMessage(details.context.reason);
    if (details.reason === "agent") return "The agent ended the conversation.";
    return "Chat disconnected. Start a new chat if you need more help.";
  }

  function normalizeErrorMessage(message) {
    if (!message) return "";
    return String(message).replace(/^Error:\s*/i, "").trim();
  }

  function handleAgentTextPart(part) {
    if (!part) return;
    if (typeof part === "string") {
      resetIdleTimer();
      appendAgentDelta(part);
      return;
    }

    var partText = typeof part.text === "string" ? part.text : "";

    if (part.type === "start") {
      if (partText) resetIdleTimer();
      ensureActiveAgentMessage("");
      queueAgentText(partText, false);
      state.isLoading = true;
      renderMessagesOnly();
      return;
    }

    if (part.type === "delta") {
      if (partText) resetIdleTimer();
      queueAgentText(partText, false);
      state.isLoading = true;
      renderMessagesOnly();
      return;
    }

    if (part.type === "stop") {
      state.isLoading = false;
      var stoppedMessage = getActiveAgentMessage();
      if (stoppedMessage) stoppedMessage.finishWhenTyped = true;
      startTypewriter();
      renderMessagesOnly();
    }
  }

  function handleSdkMessage(payload, mode) {
    if (!payload || !payload.message) return;
    resetIdleTimer();

    if (payload.role === "user" || payload.source === "user") {
      appendTranscriptMessage("visitor", payload.message, payload.event_id);
      state.transcriptPreview = payload.message;
      state.isLoading = mode !== "voice";
      render();
      return;
    }

    state.transcriptPreview = payload.message;
    var lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage.role === "agent" && lastMessage.text === payload.message) {
      lastMessage.streaming = false;
      state.activeAgentMessageId = null;
    } else {
      var activeMessage = getActiveAgentMessage();
      if (activeMessage) {
        activeMessage.pendingText = payload.message.slice(activeMessage.text.length);
        activeMessage.finishWhenTyped = true;
        activeMessage.streaming = true;
        startTypewriter();
      } else {
        queueAgentText(payload.message, true);
      }
    }
    state.isLoading = false;
    renderMessagesOnly();
  }

  function appendTranscriptMessage(role, text, eventId) {
    var existing = eventId
      ? state.messages.find(function (message) {
          return message.eventId === eventId && message.role === role;
        })
      : null;

    if (existing) {
      existing.text = text;
      return;
    }

    state.messages.push({ role: role, text: text, eventId: eventId });
  }

  function loadElevenLabsClient() {
    if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) {
      return Promise.resolve(window.ElevenLabsClient);
    }

    if (state.sdkPromise) return state.sdkPromise;

    state.sdkPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = sdkSrc;
      script.async = true;
      script.onload = function () {
        if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) {
          resolve(window.ElevenLabsClient);
          return;
        }
        reject(new Error("Voice client failed to load."));
      };
      script.onerror = function () {
        reject(new Error("Voice client failed to load."));
      };
      document.head.appendChild(script);
    });

    return state.sdkPromise;
  }

  function toggleMute() {
    if (!state.conversation || !state.isMicActive) return;
    state.isMuted = !state.isMuted;
    state.conversation.setMicMuted(state.isMuted);
    render();
  }

  function startVisualizer() {
    stopVisualizer();
    state.visualizerTimer = window.setInterval(updateVisualizer, 90);
  }

  function stopVisualizer() {
    if (!state.visualizerTimer) return;
    window.clearInterval(state.visualizerTimer);
    state.visualizerTimer = null;
  }

  function updateVisualizer() {
    var bars = [];
    var inputData = state.conversation && state.conversation.getInputByteFrequencyData ? state.conversation.getInputByteFrequencyData() : [];
    var outputData = state.conversation && state.conversation.getOutputByteFrequencyData ? state.conversation.getOutputByteFrequencyData() : [];
    var inputVolume = state.conversation && state.conversation.getInputVolume ? state.conversation.getInputVolume() : state.inputVolume;
    var outputVolume = state.conversation && state.conversation.getOutputVolume ? state.conversation.getOutputVolume() : state.outputVolume;
    var activeData = state.voiceMode === "speaking" ? outputData : inputData;
    var activeVolume = Math.max(inputVolume || 0, outputVolume || 0, state.inputVolume || 0);

    for (var index = 0; index < 12; index += 1) {
      var offset = Math.floor((activeData.length / 12) * index);
      var sample = activeData[offset] || 0;
      var fallback = 10 + Math.abs(Math.sin(Date.now() / 180 + index)) * 18;
      bars.push(Math.round(10 + sample / 255 * 62 + activeVolume * 34 || fallback));
    }

    state.visualizerBars = bars;
    state.inputVolume = inputVolume || state.inputVolume || 0;
    state.outputVolume = outputVolume || state.outputVolume || 0;
    renderVoiceVisualizerOnly();
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
      renderMessagesOnly();
    }, 22);
  }

  function stopTypewriter() {
    if (!state.typewriterTimer) return;
    window.clearInterval(state.typewriterTimer);
    state.typewriterTimer = null;
  }

  function resetIdleTimer() {
    clearIdleTimer();
    if (!state.isStarted) return;

    state.idleTimer = window.setTimeout(function () {
      terminateIdleConversation();
    }, IDLE_TIMEOUT_MS);
  }

  function clearIdleTimer() {
    if (!state.idleTimer) return;
    window.clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }

  function terminateIdleConversation() {
    if (!state.isStarted) return;

    if (state.conversation) {
      var conversation = state.conversation;
      state.conversation = null;
      conversation.endSession().catch(function () {});
    }

    clearIdleTimer();
    stopVisualizer();
    stopTypewriter();
    var activeMessage = getActiveAgentMessage();
    if (activeMessage) activeMessage.streaming = false;

    state.isStarted = false;
    state.isLoading = false;
    state.connectionState = "idle";
    state.voiceState = "idle";
    state.activeAgentMessageId = null;
    state.error = "Conversation ended after 40 seconds of inactivity.";
    track("chat_ended", { mode: state.conversationMode, reason: "idle_timeout", timeoutMs: IDLE_TIMEOUT_MS });
    render();
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
    resetIdleTimer();

    if (!state.conversation || !state.conversation.sendUserMessage) {
      state.error = "Chat is reconnecting. Please try again in a moment.";
      state.connectionState = "disconnected";
      state.isLoading = false;
      render();
      return;
    }

    state.conversation.sendUserMessage(text);

    track("message_sent", { length: text.length });
    render();
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
    var messageId = message.id ? ' data-message-id="' + escapeAttribute(message.id) + '"' : "";

    return `
      <div class="message ${message.role === "visitor" ? "visitor" : "agent"}"${messageId}>
        <div class="bubble"><span class="bubble-text">${body}</span>${message.streaming ? '<span class="stream-cursor" aria-hidden="true"></span>' : ""}</div>
      </div>
    `;
  }

  function messagesHtml() {
    return `
      <div class="messages" aria-live="polite">
        ${state.messages.map(messageHtml).join("")}
      </div>
    `;
  }

  function modeSwitchHtml() {
    if (!state.config.voiceEnabled || !state.config.textEnabled) return "";

    return `
      <div class="mode-switch" role="tablist" aria-label="Conversation mode">
        <button type="button" data-mode="text" aria-pressed="${state.mode === "text"}" ${state.isStarted ? "disabled" : ""}>${chatTabIcon()} Chat</button>
        <button type="button" data-mode="voice" aria-pressed="${state.mode === "voice"}" ${state.isStarted ? "disabled" : ""}>${voiceTabIcon()} Voice</button>
      </div>
    `;
  }

  function voiceStageHtml() {
    return `
      <div class="voice-stage" aria-live="polite">
        <div class="voice-orb-wrap">
          <div class="voice-orb">
            <div class="voice-visualizer" aria-hidden="true">
              ${state.visualizerBars.map(function (height) {
                return '<span class="voice-bar" style="--bar-height:' + escapeAttribute(height) + '"></span>';
              }).join("")}
            </div>
            <div class="voice-meta">
              <span class="voice-pill">${escapeHtml(voiceLabel())}</span>
              <span class="voice-pill">${state.isMuted ? "Muted" : "Mic on"}</span>
            </div>
          </div>
        </div>
        <div class="voice-transcript">
          <strong>Live transcript</strong>
          ${escapeHtml(state.transcriptPreview || latestTranscriptText() || "Start voice and speak naturally.")}
        </div>
      </div>
    `;
  }

  function startHtml() {
    var label = state.mode === "voice" ? "Start voice" : "Start chat";
    var loadingLabel = state.mode === "voice" ? "Starting voice..." : "Starting...";
    return `
      <div class="start">
        <button type="button" data-start ${state.isLoading ? "disabled" : ""}>
          ${state.isLoading ? loadingLabel : label}
        </button>
      </div>
    `;
  }

  function activeChatControlsHtml() {
    return `
      <div class="controls">
        <div class="conversation-actions">
          <span class="conversation-state">${escapeHtml(connectionLabel())}</span>
          ${state.isMicActive ? '<button class="mute-button" type="button" data-mute aria-label="Mute microphone">' + micIcon() + '</button>' : ""}
          <button class="end-button" type="button" data-end>End conversation</button>
        </div>
        ${state.mode === "voice" ? "" : composerHtml()}
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

  function voiceLabel() {
    if (state.connectionState === "connecting") return "Connecting";
    if (state.voiceMode === "speaking") return "AI speaking";
    if (state.isMuted) return "Muted";
    if (state.connectionState === "connected") return "Listening";
    return "Voice ready";
  }

  function latestTranscriptText() {
    for (var index = state.messages.length - 1; index >= 0; index -= 1) {
      if (state.messages[index].text) return state.messages[index].text;
    }
    return "";
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

  function shortWidgetName(name) {
    var cleanName = String(name || "").trim();
    if (!cleanName) return "Revox";
    var shortName = cleanName.replace(/\s+(assistant|agent|chat|bot)$/i, "").trim();
    return shortName || cleanName;
  }

  function chatIcon(className) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 8.5C5 6.57 6.57 5 8.5 5h7C17.43 5 19 6.57 19 8.5v4.2c0 1.93-1.57 3.5-3.5 3.5H12l-4.2 2.55a.8.8 0 0 1-1.2-.68V16.1A3.5 3.5 0 0 1 5 12.7V8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function arrowRightIcon() {
    return `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
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

  function chatTabIcon() {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7.5 9.5h9M7.5 13h5.5M6.8 18.4l3-1.8h5.7a4 4 0 0 0 4-4V8.5a4 4 0 0 0-4-4h-7a4 4 0 0 0-4 4v4.1a4 4 0 0 0 2.3 3.6v2.2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  function voiceTabIcon() {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" stroke-width="1.8"/>
        <path d="M18.5 11.5v.5a6.5 6.5 0 0 1-13 0v-.5M12 18.5V21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `;
  }

  function micIcon() {
    if (state.isMuted) {
      return `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m4 4 16 16M9 9v3a3 3 0 0 0 4.5 2.6M15 10.5V7a3 3 0 0 0-5.2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M19 11v1a7 7 0 0 1-1.2 3.9M5 11v1a7 7 0 0 0 10.2 6.2M12 19v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `;
    }

    return `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" stroke-width="2"/>
        <path d="M19 11v1a7 7 0 0 1-14 0v-1M12 19v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
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
