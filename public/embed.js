(() => {
  "use strict";

  const IDLE_MS = 40000;
  const SDK_SRC = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.14.0/dist/lib.iife.js";
  const script = document.currentScript || [...document.querySelectorAll("script[src]")].reverse().find((item) => item.dataset.widgetId);
  const widgetId = script && script.dataset.widgetId;
  const apiBase = script ? script.dataset.apiBase || new URL(script.src, location.href).origin : "";
  let root;
  let style;
  let sdkPromise;
  let idleTimer;
  let typeTimer;
  let visualTimer;
  let conversation;
  let socket;
  let cfg;
  let state = {
    open: false,
    started: false,
    loading: false,
    mode: "text",
    status: "idle",
    voiceMode: "ready",
    muted: false,
    mic: false,
    error: "",
    sessionId: "",
    vars: {},
    active: "",
    messages: [],
    bars: [18, 32, 46, 28, 38, 24, 44, 30]
  };

  if (!script || !widgetId) {
    console.error("[Revox] Missing data-widget-id.");
    return;
  }

  ready(async () => {
    const host = document.createElement("div");
    host.id = "revox-widget-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    style = document.createElement("style");
    root = document.createElement("div");
    shadow.append(style, root);
    await loadConfig();
  });

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${apiBase}/public/widget-config/${encodeURIComponent(widgetId)}`, { credentials: "omit" });
      if (!res.ok) return;
      const raw = await res.json();
      cfg = {
        name: raw.widget_name || "Revox Assistant",
        logo: raw.logo_url || "",
        primary: raw.primary_color || "#635bff",
        secondary: raw.secondary_color || "#111827",
        bg: raw.background_color || "#ffffff",
        text: raw.text_color || "#111827",
        welcome: raw.welcome_message || "Hi there. How can I help you today?",
        pos: raw.widget_position === "bottom-left" ? "left" : "right",
        textEnabled: raw.text_enabled !== false,
        voiceEnabled: raw.voice_enabled !== false,
        officeIsOpen: raw.office_is_open || "unknown"
      };
      if (!cfg.textEnabled && cfg.voiceEnabled) state.mode = "voice";
      state.messages = [{ role: "agent", text: cfg.welcome }];
      injectCss();
      render();
      track("loaded");
    } catch (err) {
      console.error("[Revox] Config failed", err);
    }
  }

  function injectCss() {
    style.textContent = `
      :host{all:initial}.rw,.rw *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}.rw{--p:${color(cfg.primary,"#635bff")};--s:${color(cfg.secondary,"#111827")};--bg:${color(cfg.bg,"#fff")};--txt:${color(cfg.text,"#111827")};position:fixed;${cfg.pos}:22px;bottom:22px;z-index:2147483647;color:var(--txt)}button,input{font:inherit}.launch{height:68px;min-width:184px;border:0;border-radius:22px;padding:9px 12px 9px 10px;color:#fff;background:linear-gradient(135deg,var(--p),var(--s));box-shadow:0 22px 55px rgba(15,23,42,.28),inset 0 1px 0 rgba(255,255,255,.35);display:flex;align-items:center;gap:10px;cursor:pointer}.launch:hover{transform:translateY(-2px)}.li{width:48px;height:48px;border-radius:16px;background:rgba(255,255,255,.18);display:grid;place-items:center;position:relative;flex:0 0 auto}.li img{width:38px;height:38px;border-radius:13px;object-fit:cover}.dot{position:absolute;right:-1px;top:-1px;width:13px;height:13px;border-radius:50%;background:#22c55e;border:2px solid #fff}.lc{display:grid;gap:2px;min-width:0;text-align:left}.lc b,.lc span{max-width:105px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lc b{font-size:14px}.lc span{font-size:11px;opacity:.76}.go{width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center}.win{width:min(392px,calc(100vw - 28px));height:min(640px,calc(100vh - 28px));border-radius:20px;overflow:hidden;background:var(--bg);box-shadow:0 28px 80px rgba(15,23,42,.24);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto auto;border:1px solid rgba(15,23,42,.08)}.head{min-height:82px;padding:15px 14px 15px 16px;background:linear-gradient(135deg,var(--s),var(--p));color:#fff;display:flex;align-items:center;gap:12px}.brand{display:flex;align-items:center;gap:12px;min-width:0;flex:1}.av{width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.17);display:grid;place-items:center;flex:0 0 auto;border:1px solid rgba(255,255,255,.22);font-weight:800}.av img{width:44px;height:44px;border-radius:14px;object-fit:cover}.ttl{min-width:0}.ttl b,.ttl span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ttl b{font-size:15.5px}.ttl span{width:max-content;margin-top:6px;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.16);font-size:11.5px}.ttl span:before{content:"";display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:#22c55e}.x{width:38px;height:38px;border:0;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;cursor:pointer}.tabs{height:62px;padding:10px 14px;background:rgba(255,255,255,.96);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;border-bottom:1px solid rgba(15,23,42,.07)}.tabs button{height:40px;border-radius:14px;border:1px solid rgba(15,23,42,.07);background:transparent;color:rgba(17,24,39,.62);font-size:13.5px;font-weight:750;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer}.tabs button[aria-pressed=true]{background:#fff;color:var(--txt);box-shadow:0 10px 24px rgba(15,23,42,.08),inset 0 -2px 0 var(--p)}.tabs button:disabled{opacity:.5;cursor:not-allowed}.body{min-height:0;overflow:hidden;background:radial-gradient(circle at 15% 0,rgba(99,91,255,.09),transparent 28%),linear-gradient(rgba(255,255,255,.9),rgba(255,255,255,.94)),var(--bg)}.msgs{height:100%;overflow:auto;padding:16px 14px}.msg{display:flex;margin:0 0 12px}.msg.user{justify-content:flex-end}.bubble{max-width:82%;padding:11px 13px;border-radius:15px 15px 15px 7px;background:#fff;border:1px solid color-mix(in srgb,var(--s) 25%,rgba(15,23,42,.08));box-shadow:0 8px 22px rgba(15,23,42,.07);font-size:14px;line-height:1.5;overflow-wrap:anywhere}.user .bubble{border:0;border-radius:15px 15px 7px 15px;background:linear-gradient(135deg,var(--p),var(--s));color:#fff}.cur{display:inline-block;width:7px;height:16px;margin-left:2px;border-radius:999px;background:var(--p);vertical-align:-3px;animation:blink .9s infinite}.voice{height:100%;padding:16px 14px;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:12px}.orbwrap{border:1px solid rgba(15,23,42,.08);border-radius:18px;background:rgba(255,255,255,.74);display:grid;place-items:center;overflow:hidden}.orb{width:min(208px,58vw);aspect-ratio:1;border-radius:50%;background:conic-gradient(from 150deg,var(--p),var(--s),var(--p));display:grid;place-items:center;box-shadow:0 28px 70px color-mix(in srgb,var(--p) 24%,transparent);position:relative}.bars{height:70px;display:flex;align-items:center;gap:5px}.bar{width:7px;min-height:10px;height:calc(var(--h)*1px);border-radius:999px;background:rgba(255,255,255,.9);transition:height .09s linear}.vp{position:absolute;left:18px;right:18px;bottom:20px;display:flex;justify-content:space-between;color:#fff;font-size:12px;font-weight:760}.vp span{padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.18)}.trans{min-height:70px;padding:12px 13px;border:1px solid rgba(15,23,42,.08);border-radius:14px;background:rgba(255,255,255,.86);font-size:13px;line-height:1.45;color:#4b5563}.trans b{display:block;color:var(--txt);font-size:12px;margin-bottom:4px}.status{min-height:24px;padding:0 14px 8px;background:rgba(255,255,255,.9);color:#6b7280;font-size:12px}.start,.ctrls{border-top:1px solid rgba(15,23,42,.09);background:color-mix(in srgb,var(--bg) 94%,white)}.start{padding:13px 14px 15px}.start button{width:100%;min-height:46px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--p),var(--s));color:#fff;cursor:pointer;font-weight:750;box-shadow:0 12px 26px color-mix(in srgb,var(--p) 28%,transparent)}.ctrls{padding:10px 12px 12px}.acts{min-height:34px;display:flex;align-items:center;gap:8px;margin-bottom:10px}.cs{font-size:13px;font-weight:760;color:#6b7280;margin-right:auto}.cs:before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:#22c55e;margin-right:8px}.end,.mute{height:34px;border-radius:999px;border:1px solid rgba(15,23,42,.1);background:#fff;color:var(--p);font-weight:760;cursor:pointer}.end{padding:0 13px}.mute{width:34px}.form{display:grid;grid-template-columns:minmax(0,1fr)48px;gap:9px}.form input{height:48px;border-radius:18px;border:1px solid rgba(15,23,42,.12);padding:0 15px;font-size:14px;outline:none}.form button{width:48px;height:48px;border:0;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--s));color:#fff;cursor:pointer}.foot{padding:9px 12px 11px;border-top:1px solid rgba(15,23,42,.07);text-align:center;color:#6b7280;font-size:12px}.foot a{color:var(--p);font-weight:800;text-decoration:none}@keyframes blink{50%{opacity:.25}}@media(max-width:520px){.rw{left:12px!important;right:12px!important;bottom:12px}.win{width:100%;height:min(640px,calc(100vh - 24px));border-radius:18px}.launch{margin-left:auto;min-width:144px;height:62px}.lc span{display:none}}`;
  }

  function render() {
    if (!cfg) return;
    root.className = "rw";
    root.innerHTML = state.open ? windowHtml() : launcherHtml();
    bind();
    scrollBottom();
  }

  function launcherHtml() {
    return `<button class="launch" type="button" data-open aria-label="Open chat"><span class="li">${cfg.logo ? `<img src="${esc(cfg.logo)}" alt="">` : icon()}<span class="dot"></span></span><span class="lc"><b>Ask ${esc(shortName())}</b><span>AI assistant</span></span><span class="go">${arrow()}</span></button>`;
  }

  function windowHtml() {
    return `<section class="win"><header class="head"><div class="brand"><div class="av">${cfg.logo ? `<img src="${esc(cfg.logo)}" alt="">` : "R"}</div><div class="ttl"><b>${esc(cfg.name)}</b><span>${esc(label())}</span></div></div><button class="x" type="button" data-close aria-label="Close">${xIcon()}</button></header>${tabs()}<main class="body">${state.mode === "voice" ? voiceHtml() : messagesHtml()}</main><div class="status">${esc(state.error || statusText())}</div>${state.started ? controlsHtml() : startHtml()}<footer class="foot">Powered by <a href="https://revoxai.io" target="_blank" rel="noreferrer">Revox</a></footer></section>`;
  }

  function tabs() {
    if (!cfg.textEnabled || !cfg.voiceEnabled) return "";
    return `<div class="tabs"><button type="button" data-mode="text" aria-pressed="${state.mode === "text"}" ${state.started || state.loading ? "disabled" : ""}>${chatIcon()} Chat</button><button type="button" data-mode="voice" aria-pressed="${state.mode === "voice"}" ${state.started || state.loading ? "disabled" : ""}>${micIcon()} Voice</button></div>`;
  }

  function messagesHtml() {
    return `<div class="msgs">${state.messages.map((m) => `<div class="msg ${m.role === "visitor" ? "user" : ""}" ${m.id ? `data-mid="${esc(m.id)}"` : ""}><div class="bubble"><span>${esc(m.text)}</span>${m.streaming ? `<i class="cur"></i>` : ""}</div></div>`).join("")}</div>`;
  }

  function voiceHtml() {
    return `<div class="voice"><div class="orbwrap"><div class="orb"><div class="bars">${state.bars.map((h) => `<span class="bar" style="--h:${h}"></span>`).join("")}</div><div class="vp"><span>${esc(voiceLabel())}</span><span>${state.muted ? "Muted" : "Mic on"}</span></div></div></div><div class="trans"><b>Live transcript</b>${esc(latestText() || "Start voice and speak naturally.")}</div></div>`;
  }

  function startHtml() {
    const voice = state.mode === "voice";
    return `<div class="start"><button type="button" data-start ${state.loading ? "disabled" : ""}>${state.loading ? "Starting..." : voice ? "Start voice" : "Start chat"}</button></div>`;
  }

  function controlsHtml() {
    return `<div class="ctrls"><div class="acts"><span class="cs">${esc(statusText() || "Connected")}</span>${state.mic ? `<button class="mute" type="button" data-mute aria-label="Mute">${micIcon()}</button>` : ""}<button class="end" type="button" data-end>End conversation</button></div>${state.mode === "text" ? `<form class="form"><input name="message" autocomplete="off" placeholder="Type your message..." ${state.status !== "connected" ? "disabled" : ""}><button type="submit" aria-label="Send" ${state.status !== "connected" ? "disabled" : ""}>${sendIcon()}</button></form>` : ""}</div>`;
  }

  function bind() {
    root.querySelector("[data-open]")?.addEventListener("click", () => {
      state.open = true;
      state.error = "";
      render();
      track("opened");
    });
    root.querySelector("[data-close]")?.addEventListener("click", () => {
      state.open = false;
      render();
    });
    root.querySelectorAll("[data-mode]").forEach((btn) => btn.addEventListener("click", () => {
      if (state.started || state.loading) return;
      state.mode = btn.dataset.mode;
      state.error = "";
      render();
    }));
    root.querySelector("[data-start]")?.addEventListener("click", () => start(state.mode));
    root.querySelector("[data-end]")?.addEventListener("click", end);
    root.querySelector("[data-mute]")?.addEventListener("click", mute);
    root.querySelector("form")?.addEventListener("submit", send);
  }

  async function start(mode) {
    if (state.loading || state.started) return;
    state.loading = true;
    state.error = "";
    state.status = "connecting";
    render();
    try {
      const res = await fetch(`${apiBase}/public/widget-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ widgetId, pageUrl: location.href, mode })
      });
      if (!res.ok) throw new Error("Could not start chat.");
      const data = await res.json();
      state.sessionId = data.sessionId || "";
      state.vars = data.dynamicVariables || {};
      if (data.welcomeMessage) state.messages = [{ role: "agent", text: data.welcomeMessage }];
      state.started = true;
      state.loading = false;
      state.status = "connecting";
      state.mic = mode === "voice";
      render();
      if (mode === "voice") await startVoice(data.signedUrl);
      else startText(data.signedUrl);
    } catch (err) {
      state.loading = false;
      state.started = false;
      state.status = "idle";
      state.mic = false;
      state.error = err.message || "Could not start chat.";
      render();
    }
  }

  function startText(url) {
    socket?.close();
    socket = new WebSocket(url);
    conversation = {
      sendUserMessage(text) {
        if (socket.readyState !== WebSocket.OPEN) throw new Error("Chat is still connecting.");
        socket.send(JSON.stringify({ type: "user_message", text }));
      },
      endSession() {
        socket.close();
        return Promise.resolve();
      }
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: vars() }));
      state.status = "connected";
      state.loading = false;
      state.mic = false;
      resetIdle();
      render();
    });
    socket.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === "ping" && payload.ping_event) {
        setTimeout(() => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "pong", event_id: payload.ping_event.event_id })), payload.ping_event.ping_ms || 0);
        return;
      }
      handleEvent(payload);
    });
    socket.addEventListener("error", () => {
      state.error = "Realtime chat connection failed.";
      state.status = "error";
      state.loading = false;
      render();
    });
    socket.addEventListener("close", (event) => {
      clearIdle();
      if (state.started) {
        state.started = false;
        state.status = event.wasClean ? "idle" : "disconnected";
        state.error = event.wasClean ? "" : "Chat disconnected. Start a new chat if you need more help.";
        render();
      }
    });
  }

  async function startVoice(url) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice needs HTTPS and microphone access.");
    const client = await loadSdk();
    conversation = await client.Conversation.startSession({
      signedUrl: url,
      connectionType: "websocket",
      dynamicVariables: vars(),
      onConnect() {
        state.status = "connected";
        state.loading = false;
        state.mic = true;
        resetIdle();
        visualTimer = setInterval(updateBars, 90);
        render();
      },
      onDisconnect() {
        clearIdle();
        stopVisual();
        if (state.started) end(false);
      },
      onError(message) {
        state.error = clean(message) || "Realtime chat connection failed.";
        state.status = "error";
        state.loading = false;
        render();
      },
      onModeChange(props) {
        state.voiceMode = props.mode || "ready";
        render();
      },
      onMessage(payload) {
        handleEvent(payload);
      },
      onAgentChatResponsePart(part) {
        const text = typeof part === "string" ? part : part?.text || part?.text_response_part?.text || "";
        if (text) queueText(text, false);
      }
    });
  }

  function handleEvent(payload) {
    resetIdle();
    if (payload.type === "agent_chat_response_part") {
      const text = payload.text_response_part?.text || "";
      if (text) queueText(text, false);
      return;
    }
    const userText = payload.user_transcription_event?.user_transcript || (payload.role === "user" ? payload.message : "");
    if (userText) {
      add("visitor", userText, payload.user_transcription_event?.event_id || payload.event_id);
      render();
      return;
    }
    const agentText = payload.agent_response_event?.agent_response || payload.agent_response_correction_event?.corrected_agent_response || (payload.role !== "user" ? payload.message : "");
    if (agentText) queueText(agentText, true);
  }

  function send(event) {
    event.preventDefault();
    const input = root.querySelector("input[name=message]");
    const text = input?.value.trim();
    if (!text || state.status !== "connected") return;
    input.value = "";
    add("visitor", text);
    ensureAgent();
    render();
    try {
      conversation.sendUserMessage(text);
      track("message_sent", { length: text.length });
      resetIdle();
    } catch (err) {
      state.error = clean(err.message) || "Message failed to send.";
      render();
    }
  }

  function add(role, text, eventId) {
    const existing = eventId && state.messages.find((m) => m.eventId === eventId && m.role === role);
    if (existing) existing.text = text;
    else state.messages.push({ role, text, eventId });
  }

  function queueText(text, finish) {
    const msg = ensureAgent();
    if (text.startsWith(msg.text)) msg.pending = text.slice(msg.text.length);
    else msg.pending = (msg.pending || "") + text;
    msg.streaming = true;
    msg.finish = finish || msg.finish;
    type();
  }

  function ensureAgent() {
    let msg = state.active && state.messages.find((m) => m.id === state.active);
    if (msg) return msg;
    msg = { id: `a-${Date.now()}`, role: "agent", text: "", pending: "", streaming: true };
    state.active = msg.id;
    state.messages.push(msg);
    return msg;
  }

  function type() {
    if (typeTimer) return;
    typeTimer = setInterval(() => {
      const msg = state.messages.find((m) => m.id === state.active);
      if (!msg) return clearType();
      const pending = msg.pending || "";
      if (!pending) {
        if (msg.finish) {
          msg.streaming = false;
          state.active = "";
          clearType();
        }
        renderMessages();
        return;
      }
      const count = pending.length > 24 ? 3 : 1;
      msg.text += pending.slice(0, count);
      msg.pending = pending.slice(count);
      renderMessages();
    }, 22);
  }

  function renderMessages() {
    if (state.mode !== "text") return render();
    const body = root.querySelector(".body");
    if (body) {
      body.innerHTML = messagesHtml();
      root.querySelector(".status").textContent = state.error || statusText();
      scrollBottom();
    }
  }

  function clearType() {
    clearInterval(typeTimer);
    typeTimer = null;
  }

  function end(user = true) {
    clearIdle();
    clearType();
    stopVisual();
    try { conversation?.endSession?.(); } catch {}
    try { socket?.close?.(); } catch {}
    conversation = null;
    socket = null;
    state.started = false;
    state.loading = false;
    state.status = "idle";
    state.mic = false;
    state.muted = false;
    state.voiceMode = "ready";
    state.error = "";
    state.active = "";
    track("chat_ended", { reason: user ? "visitor" : "disconnect", mode: state.mode });
    render();
  }

  function mute() {
    if (!conversation?.setMicMuted) return;
    state.muted = !state.muted;
    conversation.setMicMuted(state.muted);
    render();
  }

  function resetIdle() {
    clearIdle();
    if (state.started) idleTimer = setTimeout(() => {
      state.error = "Conversation ended after 40 seconds of inactivity.";
      end(false);
      state.error = "Conversation ended after 40 seconds of inactivity.";
      render();
    }, IDLE_MS);
  }

  function clearIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  function stopVisual() {
    clearInterval(visualTimer);
    visualTimer = null;
  }

  function updateBars() {
    const data = conversation?.getInputByteFrequencyData?.() || [];
    state.bars = state.bars.map((_, i) => 12 + Math.round((data[Math.floor(data.length / 8 * i)] || Math.abs(Math.sin(Date.now() / 180 + i)) * 90) / 255 * 62));
    const bars = root.querySelectorAll(".bar");
    bars.forEach((bar, i) => bar.style.setProperty("--h", state.bars[i]));
  }

  function loadSdk() {
    if (window.ElevenLabsClient?.Conversation) return Promise.resolve(window.ElevenLabsClient);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const item = document.createElement("script");
      item.src = script.dataset.sdkSrc || SDK_SRC;
      item.async = true;
      item.onload = () => window.ElevenLabsClient?.Conversation ? resolve(window.ElevenLabsClient) : reject(new Error("Voice client failed to load."));
      item.onerror = () => reject(new Error("Voice client failed to load."));
      document.head.appendChild(item);
    });
    return sdkPromise;
  }

  function vars() {
    return {
      ...state.vars,
      office_is_open: String(state.vars.office_is_open || script.dataset.officeIsOpen || cfg.officeIsOpen || "unknown").trim() || "unknown",
      welcome_message: String(state.vars.welcome_message || cfg.welcome || "").trim()
    };
  }

  function scrollBottom() {
    const messages = root.querySelector(".msgs");
    if (messages) messages.scrollTop = messages.scrollHeight;
  }

  function track(event, metadata) {
    fetch(`${apiBase}/public/widget-analytics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      keepalive: true,
      body: JSON.stringify({ widgetId, sessionId: state.sessionId || undefined, event, metadata })
    }).catch(() => {});
  }

  function statusText() {
    if (state.status === "connecting") return "Connecting";
    if (state.status === "connected") return "Connected";
    if (state.status === "disconnected") return "Disconnected";
    if (state.status === "error") return "Connection error";
    return "Secure AI chat";
  }

  function label() {
    if (state.mode === "voice" && state.started) return voiceLabel();
    return statusText();
  }

  function voiceLabel() {
    if (state.status === "connecting") return "Connecting";
    if (state.voiceMode === "speaking") return "AI speaking";
    if (state.muted) return "Muted";
    if (state.status === "connected") return "Listening";
    return "Voice ready";
  }

  function latestText() {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) if (state.messages[i].text) return state.messages[i].text;
    return "";
  }

  function shortName() {
    return (cfg.name || "Revox").replace(/\s+(assistant|agent|chat|bot)$/i, "").trim() || "Revox";
  }

  function color(value, fallback) {
    const text = String(value || "").trim();
    return /^#[0-9a-f]{3,8}$/i.test(text) || /^rgb/i.test(text) || /^hsl/i.test(text) ? text : fallback;
  }

  function clean(value) {
    return String(value || "").replace(/^Error:\s*/i, "").trim();
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function icon() {
    return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8.5C5 6.57 6.57 5 8.5 5h7C17.43 5 19 6.57 19 8.5v4.2c0 1.93-1.57 3.5-3.5 3.5H12l-4.2 2.55a.8.8 0 0 1-1.2-.68V16.1A3.5 3.5 0 0 1 5 12.7V8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }

  function chatIcon() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 9.5h9M7.5 13h5.5M6.8 18.4l3-1.8h5.7a4 4 0 0 0 4-4V8.5a4 4 0 0 0-4-4h-7a4 4 0 0 0-4 4v4.1a4 4 0 0 0 2.3 3.6v2.2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function micIcon() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" stroke-width="1.8"/><path d="M18.5 11.5v.5a6.5 6.5 0 0 1-13 0v-.5M12 18.5V21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  function sendIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 14-7-4 14-3-5-7-2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  function arrow() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function xIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
})();
