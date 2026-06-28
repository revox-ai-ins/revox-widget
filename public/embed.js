(function () {
  "use strict";

  var IDLE_TIMEOUT_MS = 40000;
  var SDK_SRC = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.14.0/dist/lib.iife.js";
  var script = document.currentScript || findScript();
  var widgetId = script && script.getAttribute("data-widget-id");
  var apiBase = script ? script.getAttribute("data-api-base") || new URL(script.src, location.href).origin : "";
  var sdkSrc = script ? script.getAttribute("data-sdk-src") || SDK_SRC : SDK_SRC;

  var state = {
    config: null,
    open: false,
    started: false,
    loading: false,
    mode: "text",
    activeMode: "text",
    connection: "idle",
    voiceMode: "listening",
    muted: false,
    conversation: null,
    sdkPromise: null,
    idleTimer: null,
    visualTimer: null,
    bars: [16, 28, 44, 24, 36, 54, 30, 42, 20, 34, 26, 18],
    messages: [],
    transcript: "",
    activeAgentId: "",
    typeTimer: null,
    sessionId: "",
    error: ""
  };

  var host, root, style;

  if (!script || !widgetId) {
    console.error("[Revox] Missing data-widget-id on embed script.");
    return;
  }

  ready(boot);

  function findScript() {
    var scripts = Array.prototype.slice.call(document.querySelectorAll("script[src]"));
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      if (scripts[i].getAttribute("data-widget-id") && /\/embed\.js(\?|$)/.test(scripts[i].src)) return scripts[i];
    }
    return null;
  }

  function ready(fn) {
    if (document.body) return fn();
    document.addEventListener("DOMContentLoaded", fn, { once: true });
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
    loadConfig();
  }

  async function loadConfig() {
    try {
      var res = await fetch(apiBase + "/public/widget-config/" + encodeURIComponent(widgetId), { credentials: "omit" });
      if (!res.ok) throw new Error("Widget unavailable");
      state.config = normalize(await res.json());
      if (!state.config.textEnabled && state.config.voiceEnabled) state.mode = "voice";
      state.messages = [{ role: "agent", text: state.config.welcomeMessage }];
      injectStyles();
      render();
      track("loaded");
    } catch (err) {
      console.error("[Revox] Failed to load widget", err);
    }
  }

  function injectStyles() {
    var c = state.config;
    var side = c.widgetPosition === "bottom-left" ? "left" : "right";
    style.textContent = `
      :host{all:initial}.revox-root,.revox-root *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}.revox-root{--p:${css(c.primaryColor,"#2563eb")};--s:${css(c.secondaryColor,"#0f172a")};--bg:${css(c.backgroundColor,"#fff")};--txt:${css(c.textColor,"#111827")};--muted:color-mix(in srgb,var(--txt) 58%,white);position:fixed;${side}:24px;bottom:24px;z-index:2147483647;color:var(--txt)}button,input{font:inherit}.launcher{min-width:154px;height:68px;padding:0 18px 0 14px;border:0;border-radius:999px;background:linear-gradient(145deg,var(--p),var(--s));color:#fff;box-shadow:0 24px 58px rgba(15,23,42,.32);display:inline-flex;align-items:center;gap:11px;cursor:pointer}.launcher:hover{transform:translateY(-2px)}.logo,.fallback{width:40px;height:40px;border-radius:999px;display:grid;place-items:center;background:rgba(255,255,255,.18);object-fit:cover;font-weight:800}.launcher-copy{display:grid;text-align:left}.launcher-copy strong{font-size:14px}.launcher-copy span{max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.8}.window{width:min(404px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));border-radius:22px;overflow:hidden;background:var(--bg);box-shadow:0 34px 90px rgba(15,23,42,.31);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto auto}.header{min-height:92px;padding:18px;background:linear-gradient(135deg,var(--s),var(--p));color:#fff;display:flex;align-items:center;gap:12px}.brand{display:flex;align-items:center;gap:12px;min-width:0;flex:1}.title{min-width:0}.title strong,.title span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.title strong{font-size:16px}.title span{width:fit-content;margin-top:7px;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px}.x,.mute{width:38px;height:38px;border:0;border-radius:999px;background:rgba(255,255,255,.16);color:currentColor;cursor:pointer;display:grid;place-items:center}.mode{height:58px;min-height:58px;max-height:58px;padding:10px 16px;background:rgba(255,255,255,.92);display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;overflow:hidden}.mode button{display:flex;align-items:center;justify-content:center;width:100%;height:38px;min-height:38px;max-height:38px;padding:0 12px;line-height:38px;border:1px solid rgba(15,23,42,.1);border-radius:999px;background:#fff;color:var(--txt);font-size:13px;font-weight:750;cursor:pointer;overflow:hidden}.mode button[aria-pressed=true]{background:linear-gradient(135deg,var(--p),var(--s));color:#fff;border-color:transparent}.mode button:disabled{opacity:.48;cursor:not-allowed}.body{min-height:0;overflow:hidden;background:radial-gradient(circle at 12% 0%,color-mix(in srgb,var(--p) 11%,transparent),transparent 28%),linear-gradient(rgba(255,255,255,.9),rgba(255,255,255,.9)),var(--bg)}.messages{height:100%;padding:20px 16px 16px;overflow:auto}.msg{display:flex;margin:0 0 14px}.visitor{justify-content:flex-end}.bubble{max-width:82%;padding:12px 14px;border-radius:16px;font-size:14px;line-height:1.48;overflow-wrap:anywhere;box-shadow:0 8px 22px rgba(15,23,42,.08)}.agent .bubble{border-bottom-left-radius:7px;background:#fff;color:#0f172a;border:1px solid color-mix(in srgb,var(--s) 25%,rgba(15,23,42,.08))}.visitor .bubble{border-bottom-right-radius:7px;background:linear-gradient(135deg,var(--p),var(--s));color:#fff}.cursor{display:inline-block;width:7px;height:16px;margin-left:2px;border-radius:999px;background:var(--p);vertical-align:-3px;animation:blink .9s infinite}.voice{height:100%;padding:18px 16px 14px;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:14px}.orb-wrap{min-height:260px;border:1px solid rgba(15,23,42,.08);border-radius:20px;background:rgba(255,255,255,.76);display:grid;place-items:center;overflow:hidden}.orb{position:relative;width:min(230px,68vw);aspect-ratio:1;border-radius:999px;display:grid;place-items:center;background:radial-gradient(circle at 42% 34%,rgba(255,255,255,.72),transparent 22%),conic-gradient(from 160deg,var(--p),var(--s),var(--p));box-shadow:0 28px 70px color-mix(in srgb,var(--p) 24%,transparent)}.orb:before,.orb:after{content:"";position:absolute;inset:-18px;border-radius:inherit;border:1px solid color-mix(in srgb,var(--p) 22%,transparent);animation:ring 2.6s infinite ease-out}.orb:after{inset:-34px;border-color:color-mix(in srgb,var(--s) 18%,transparent);animation-delay:.52s}.viz{z-index:1;width:74%;height:76px;display:flex;align-items:center;justify-content:center;gap:5px}.bar{width:7px;height:calc(var(--h)*1px);min-height:10px;max-height:74px;border-radius:999px;background:rgba(255,255,255,.9);transition:height 90ms linear}.vpills{position:absolute;left:18px;right:18px;bottom:20px;z-index:1;display:flex;justify-content:space-between;color:#fff;font-size:12px;font-weight:760}.pill{padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.18)}.transcript{min-height:72px;padding:13px 14px;border:1px solid rgba(15,23,42,.08);border-radius:16px;background:rgba(255,255,255,.86);font-size:13px;line-height:1.45}.transcript strong{display:block;margin-bottom:4px;font-size:12px}.status{min-height:26px;padding:0 16px 8px;background:rgba(255,255,255,.9);color:var(--muted);font-size:12px}.start,.controls{border-top:1px solid rgba(15,23,42,.1);background:color-mix(in srgb,var(--bg) 94%,white)}.start{padding:14px 16px 16px}.primary,.send{border:0;border-radius:999px;background:linear-gradient(135deg,var(--p),var(--s));color:#fff;cursor:pointer;font-weight:750;box-shadow:0 12px 26px color-mix(in srgb,var(--p) 28%,transparent)}.primary{width:100%;min-height:48px}.actions{padding:10px 14px 0;display:flex;align-items:center;justify-content:space-between;gap:10px}.state{min-width:0;color:var(--muted);font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.end{min-height:32px;border:1px solid rgba(15,23,42,.12);border-radius:999px;padding:0 13px;background:#fff;color:var(--s);cursor:pointer;font-size:12px;font-weight:750}.mute{flex:0 0 auto;width:34px;height:34px;background:#fff;color:var(--s);border:1px solid rgba(15,23,42,.12)}.composer{padding:8px 14px 14px;display:grid;grid-template-columns:1fr 46px;gap:8px}.composer input{width:100%;min-width:0;height:46px;border:1px solid rgba(15,23,42,.12);border-radius:999px;padding:0 16px;color:var(--txt);background:#fff;outline:none}.send{width:46px;height:46px;display:grid;place-items:center}.footer{padding:9px 12px 11px;border-top:1px solid rgba(15,23,42,.07);background:rgba(255,255,255,.82);text-align:center;color:var(--muted);font-size:12px}.footer a{color:var(--p);text-decoration:none;font-weight:750}@media(max-width:520px){.revox-root{left:12px;right:12px;bottom:12px}.launcher{margin-left:auto;min-width:136px}.window{width:100%;height:min(680px,calc(100vh - 24px));border-radius:18px}}@keyframes blink{50%{opacity:.2}}@keyframes ring{from{opacity:.7;transform:scale(.72)}to{opacity:0;transform:scale(1.08)}}`;
  }

  function render() {
    if (!state.config) return;
    setAttrs();
    if (!state.open) {
      root.innerHTML = `<button class="launcher" type="button" aria-label="Open chat">${logo("logo") || iconChat("logo")}<span class="launcher-copy"><strong>Chat</strong><span>${esc(state.config.widgetName)}</span></span></button>`;
      root.querySelector(".launcher").onclick = open;
      return;
    }
    root.innerHTML = `<section class="window" role="dialog" aria-label="${esc(state.config.widgetName)} chat"><header class="header"><div class="brand">${logo("logo") || '<div class="fallback">R</div>'}<div class="title"><strong>${esc(state.config.widgetName)}</strong><span>${esc(label())}</span></div></div><button class="x" type="button" aria-label="Close">${iconX()}</button></header>${modeSwitch()}<div class="body">${state.mode === "voice" ? voiceHtml() : messagesHtml()}</div><div class="status">${status()}</div>${state.started ? controlsHtml() : startHtml()}<footer class="footer">Powered by <a href="https://revoxai.io" target="_blank" rel="noreferrer">Revox</a></footer></section>`;
    root.querySelector(".x").onclick = close;
    each("[data-mode]", function (b) { b.onclick = function () { setMode(b.getAttribute("data-mode")); }; });
    var start = root.querySelector("[data-start]"); if (start) start.onclick = function () { startConversation(state.mode); };
    var end = root.querySelector("[data-end]"); if (end) end.onclick = endConversation;
    var mute = root.querySelector("[data-mute]"); if (mute) mute.onclick = toggleMute;
    var form = root.querySelector("form"); if (form) form.onsubmit = sendText;
    var messages = root.querySelector(".messages"); if (messages) messages.scrollTop = messages.scrollHeight;
  }

  function setAttrs() {
    host.setAttribute("data-revox-loaded", state.config ? "true" : "false");
    host.setAttribute("data-revox-open", state.open ? "true" : "false");
    host.setAttribute("data-revox-started", state.started ? "true" : "false");
    host.setAttribute("data-revox-connection", state.connection);
    host.setAttribute("data-revox-message-count", String(state.messages.length));
    host.setAttribute("data-revox-error", state.error ? "true" : "false");
  }

  function open() { state.open = true; state.error = ""; render(); track("opened"); }
  function close() { state.open = false; render(); }
  function setMode(mode) {
    if (state.started || state.loading) return;
    if (mode === "text" && state.config.textEnabled) state.mode = "text";
    if (mode === "voice" && state.config.voiceEnabled) state.mode = "voice";
    state.error = ""; render();
  }

  async function startConversation(mode) {
    if (state.loading || state.started) return;
    state.loading = true; state.error = ""; render();
    try {
      var res = await fetch(apiBase + "/public/widget-session", { method: "POST", headers: { "content-type": "application/json" }, credentials: "omit", body: JSON.stringify({ widgetId: widgetId, pageUrl: location.href, mode: mode }) });
      if (!res.ok) throw new Error("Could not start this chat. Please try again.");
      var session = await res.json();
      state.sessionId = session.sessionId || "";
      state.activeMode = mode;
      state.started = true;
      state.connection = "connecting";
      if (session.welcomeMessage) state.messages = [{ role: "agent", text: session.welcomeMessage }];
      render();
      await connect(session.signedUrl, mode);
    } catch (err) {
      state.loading = false; state.started = false; state.connection = "idle"; state.error = err.message || "Could not start this chat. Please try again."; render();
    }
  }

  async function connect(signedUrl, mode) {
    if (state.conversation) await state.conversation.endSession().catch(noop);
    var client = await loadSdk();
    state.conversation = await client.Conversation.startSession({
      signedUrl: signedUrl,
      textOnly: mode !== "voice",
      dynamicVariables: { welcome_message: state.config.welcomeMessage || "" },
      onConnect: function () { state.loading = false; state.started = true; state.connection = "connected"; resetIdle(); if (mode === "voice") startViz(); render(); },
      onDisconnect: function (d) { clearIdle(); stopViz(); if (state.started) { state.started = false; state.loading = false; state.connection = d && d.reason === "user" ? "idle" : "disconnected"; state.error = d && d.reason === "user" ? "" : "Chat disconnected. Start a new chat if you need more help."; track("chat_ended", { mode: state.activeMode, reason: d ? d.reason : "disconnect" }); render(); } },
      onError: function (m) { clearIdle(); stopViz(); state.loading = false; state.connection = "error"; state.error = m || "Realtime chat connection failed."; render(); },
      onStatusChange: function (p) { state.connection = p.status === "connected" ? "connected" : p.status; state.loading = p.status === "connecting"; render(); },
      onModeChange: function (p) { state.voiceMode = p.mode; render(); },
      onMessage: function (p) { handleMessage(p, mode); },
      onAgentChatResponsePart: handlePart,
      onVadScore: function (p) { state.inputVolume = Math.max(0, Math.min(1, Number(p.vadScore) || 0)); }
    });
  }

  function handleMessage(p, mode) {
    if (!p || !p.message) return;
    resetIdle();
    if (p.role === "user" || p.source === "user") {
      addOrUpdate("visitor", p.message, p.event_id);
      state.transcript = p.message;
      state.loading = mode !== "voice";
      render(); return;
    }
    state.transcript = p.message;
    var last = state.messages[state.messages.length - 1];
    if (last && last.role === "agent" && last.text === p.message) { last.streaming = false; state.activeAgentId = ""; }
    else queueAgent(p.message, true);
    state.loading = false; render();
  }

  function handlePart(part) {
    if (!part) return;
    var text = typeof part === "string" ? part : part.text || "";
    if (text) { resetIdle(); queueAgent(text, false); }
    if (part.type === "stop") { var msg = activeAgent(); if (msg) msg.finish = true; typewriter(); }
    state.loading = part.type !== "stop"; render();
  }

  function addOrUpdate(role, text, id) {
    var found = id && state.messages.find(function (m) { return m.eventId === id && m.role === role; });
    if (found) found.text = text; else state.messages.push({ role: role, text: text, eventId: id });
  }

  function queueAgent(text, finish) {
    var msg = activeAgent();
    if (!msg) { state.activeAgentId = "agent-" + Date.now(); msg = { id: state.activeAgentId, role: "agent", text: "", pending: "", streaming: true, finish: false }; state.messages.push(msg); }
    msg.pending = (msg.pending || "") + (text || "");
    msg.streaming = true;
    if (finish) msg.finish = true;
    typewriter();
  }

  function typewriter() {
    if (state.typeTimer) return;
    state.typeTimer = setInterval(function () {
      var msg = activeAgent();
      if (!msg) return stopType();
      var pending = msg.pending || "";
      if (!pending) { if (msg.finish) { msg.streaming = false; msg.finish = false; state.activeAgentId = ""; stopType(); render(); } return; }
      var n = pending.length > 24 ? 3 : 1;
      msg.text += pending.slice(0, n); msg.pending = pending.slice(n); render();
    }, 22);
  }

  function stopType() { if (state.typeTimer) clearInterval(state.typeTimer); state.typeTimer = null; }
  function activeAgent() { return state.activeAgentId ? state.messages.find(function (m) { return m.id === state.activeAgentId; }) : null; }

  async function endConversation() {
    clearIdle(); stopViz(); stopType();
    var c = state.conversation; state.conversation = null;
    if (c) await c.endSession().catch(noop);
    state.started = false; state.loading = false; state.connection = "idle"; state.error = ""; state.muted = false; state.activeAgentId = "";
    track("chat_ended", { mode: state.activeMode, reason: "visitor" }); render();
  }

  function terminateIdle() {
    if (!state.started) return;
    var c = state.conversation; state.conversation = null;
    if (c) c.endSession().catch(noop);
    clearIdle(); stopViz(); stopType(); state.started = false; state.loading = false; state.connection = "idle"; state.error = "Conversation ended after 40 seconds of inactivity.";
    track("chat_ended", { mode: state.activeMode, reason: "idle_timeout", timeoutMs: IDLE_TIMEOUT_MS }); render();
  }
  function resetIdle() { clearIdle(); if (state.started) state.idleTimer = setTimeout(terminateIdle, IDLE_TIMEOUT_MS); }
  function clearIdle() { if (state.idleTimer) clearTimeout(state.idleTimer); state.idleTimer = null; }

  function sendText(e) {
    e.preventDefault();
    var input = root.querySelector("input[name=message]");
    var text = input && input.value.trim();
    if (!text || state.connection !== "connected" || !state.conversation) return;
    state.messages.push({ role: "visitor", text: text }); input.value = ""; state.loading = true; state.error = ""; resetIdle(); state.conversation.sendUserMessage(text); track("message_sent", { length: text.length }); render();
  }

  function toggleMute() { if (!state.conversation || state.activeMode !== "voice") return; state.muted = !state.muted; state.conversation.setMicMuted(state.muted); render(); }
  function startViz() { stopViz(); state.visualTimer = setInterval(updateViz, 90); }
  function stopViz() { if (state.visualTimer) clearInterval(state.visualTimer); state.visualTimer = null; }
  function updateViz() {
    var data = [], v = 0;
    if (state.conversation) {
      data = state.voiceMode === "speaking" && state.conversation.getOutputByteFrequencyData ? state.conversation.getOutputByteFrequencyData() : state.conversation.getInputByteFrequencyData ? state.conversation.getInputByteFrequencyData() : [];
      v = Math.max(state.conversation.getInputVolume ? state.conversation.getInputVolume() : 0, state.conversation.getOutputVolume ? state.conversation.getOutputVolume() : 0, state.inputVolume || 0);
    }
    state.bars = state.bars.map(function (_, i) { var sample = data[Math.floor((data.length / 12) * i)] || 0; return Math.round(10 + sample / 255 * 62 + v * 34 + Math.abs(Math.sin(Date.now() / 180 + i)) * 8); });
    render();
  }

  function loadSdk() {
    if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) return Promise.resolve(window.ElevenLabsClient);
    if (state.sdkPromise) return state.sdkPromise;
    state.sdkPromise = new Promise(function (resolve, reject) { var s = document.createElement("script"); s.src = sdkSrc; s.async = true; s.onload = function () { window.ElevenLabsClient ? resolve(window.ElevenLabsClient) : reject(new Error("Voice client failed to load.")); }; s.onerror = function () { reject(new Error("Voice client failed to load.")); }; document.head.appendChild(s); });
    return state.sdkPromise;
  }

  function modeSwitch() { return `<div class="mode" role="tablist"><button type="button" data-mode="text" aria-pressed="${state.mode === "text"}" ${state.started || !state.config.textEnabled ? "disabled" : ""}>Chat</button><button type="button" data-mode="voice" aria-pressed="${state.mode === "voice"}" ${state.started || !state.config.voiceEnabled ? "disabled" : ""}>Voice</button></div>`; }
  function messagesHtml() { return `<div class="messages" aria-live="polite">${state.messages.map(msgHtml).join("")}</div>`; }
  function msgHtml(m) { return `<div class="msg ${m.role === "visitor" ? "visitor" : "agent"}"><div class="bubble">${esc(m.text || "")}${m.streaming ? '<span class="cursor"></span>' : ""}</div></div>`; }
  function voiceHtml() { return `<div class="voice"><div class="orb-wrap"><div class="orb"><div class="viz">${state.bars.map(function (h) { return '<span class="bar" style="--h:' + esc(h) + '"></span>'; }).join("")}</div><div class="vpills"><span class="pill">${esc(voiceLabel())}</span><span class="pill">${state.muted ? "Muted" : "Mic on"}</span></div></div></div><div class="transcript"><strong>Live transcript</strong>${esc(state.transcript || latest() || "Start voice and speak naturally.")}</div></div>`; }
  function startHtml() { var voice = state.mode === "voice"; return `<div class="start"><button class="primary" type="button" data-start ${state.loading ? "disabled" : ""}>${state.loading ? (voice ? "Starting voice..." : "Starting...") : (voice ? "Start voice" : "Start chat")}</button></div>`; }
  function controlsHtml() { return `<div class="controls"><div class="actions"><span class="state">${esc(label())}</span>${state.activeMode === "voice" ? '<button class="mute" type="button" data-mute aria-label="Mute microphone">' + iconMic() + '</button>' : ""}<button class="end" type="button" data-end>End conversation</button></div>${state.activeMode === "voice" ? "" : '<form class="composer"><input name="message" type="text" autocomplete="off" placeholder="Type your message..." aria-label="Message"><button class="send" type="submit" aria-label="Send">' + iconSend() + '</button></form>'}</div>`; }
  function status() { if (state.error) return esc(state.error); if (state.connection === "connecting") return "Connecting..."; if (state.connection === "disconnected") return "Disconnected"; if (state.connection === "error") return "Connection error"; if (state.started) return "Connected securely"; return ""; }
  function label() { if (state.connection === "connecting") return "Connecting"; if (state.connection === "connected") return "Connected"; if (state.connection === "error") return "Connection error"; if (state.connection === "disconnected") return "Disconnected"; return "Secure AI chat"; }
  function voiceLabel() { if (state.connection === "connecting") return "Connecting"; if (state.voiceMode === "speaking") return "AI speaking"; if (state.muted) return "Muted"; if (state.connection === "connected") return "Listening"; return "Voice ready"; }
  function latest() { for (var i = state.messages.length - 1; i >= 0; i -= 1) if (state.messages[i].text) return state.messages[i].text; return ""; }
  function each(sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  function normalize(r) { return { widgetName: r.widget_name || r.widgetName || "Revox Assistant", logoUrl: r.logo_url || r.logoUrl || "", primaryColor: r.primary_color || r.primaryColor || "#2563eb", secondaryColor: r.secondary_color || r.secondaryColor || "#0f172a", backgroundColor: r.background_color || r.backgroundColor || "#fff", textColor: r.text_color || r.textColor || "#111827", welcomeMessage: r.welcome_message || r.welcomeMessage || "Hi, how can I help?", widgetPosition: r.widget_position || r.widgetPosition || "bottom-right", textEnabled: r.text_enabled ?? r.textEnabled ?? true, voiceEnabled: r.voice_enabled ?? r.voiceEnabled ?? false }; }
  function logo(cls) { return state.config.logoUrl ? '<img class="' + cls + '" src="' + escAttr(state.config.logoUrl) + '" alt="">' : ""; }
  function track(event, metadata) { fetch(apiBase + "/public/widget-analytics", { method: "POST", headers: { "content-type": "application/json" }, credentials: "omit", keepalive: true, body: JSON.stringify({ widgetId: widgetId, sessionId: state.sessionId || undefined, event: event, metadata: metadata }) }).catch(noop); }
  function css(v, f) { if (!v || typeof v !== "string") return f; v = v.trim(); return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgb(a)?\([0-9,.\s%/]+\)$/.test(v) || /^hsl(a)?\([0-9,.\s%/deg]+\)$/.test(v) ? v : f; }
  function esc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function escAttr(v) { return esc(v).replace(/`/g, "&#096;"); }
  function noop() {}
  function iconChat(cls) { return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8.5C5 6.57 6.57 5 8.5 5h7C17.43 5 19 6.57 19 8.5v4.2c0 1.93-1.57 3.5-3.5 3.5H12l-4.2 2.55a.8.8 0 0 1-1.2-.68V16.1A3.5 3.5 0 0 1 5 12.7V8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'; }
  function iconX() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
  function iconSend() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 14-7-4 14-3-5-7-2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'; }
  function iconMic() { return state.muted ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="m4 4 16 16M9 9v3a3 3 0 0 0 4.5 2.6M15 10.5V7a3 3 0 0 0-5.2-2M19 11v1a7 7 0 0 1-1.2 3.9M5 11v1a7 7 0 0 0 10.2 6.2M12 19v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" stroke-width="2"/><path d="M19 11v1a7 7 0 0 1-14 0v-1M12 19v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
})();
