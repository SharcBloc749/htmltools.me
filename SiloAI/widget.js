/* SiloAI website assistant embed. Install with:
   <script async src="https://htmltools.me/SiloAI/widget.js" data-site-id="YOUR_SITE_ID"></script>

   No version query string: this file is served with must-revalidate, so every
   install picks up the newest build on the next page load. The running version is
   shown in the bottom corner of the chat window and exposed as window.SiloAI.version.
*/
(function () {
  'use strict';
  var BUILD_VERSION = '10';
  if (window.__siloaiLoadedVersion === BUILD_VERSION) return;
  var script = document.currentScript;
  var siteId = script && script.getAttribute('data-site-id');
  if (!/^[a-f0-9]{24}$/.test(siteId || '')) return;
  var previousWidget = document.getElementById('siloai-widget-host');
  if (previousWidget) previousWidget.remove();
  window.__siloaiLoaded = true;
  window.__siloaiLoadedVersion = BUILD_VERSION;
  var api = 'https://siloai.bozhetarnikmatthew.workers.dev';
  var storageKey = 'siloai.conversations.' + siteId;
  var conversations = [];
  var activeId = '';
  var imageHistoryPruned = false;
  var history = [];
  var busy = false;
  var selectedImage = '';
  var selectedImageName = '';
  var imagePreparing = false;
  var dragState = null;
  var panelDrag = null;
  var panelResizeState = null;
  var panelPinned = false;
  var suppressClickUntil = 0;
  var statusTimer = 0;
  var listening = false;
  var recognition = null;
  var targetIndex = new Map();
  var highlightCleanup = null;
  var defaultLauncherSize = window.innerWidth <= 520 ? 58 : 64;
  var launcherSize = defaultLauncherSize;

  function id() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function loadConversations() {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      conversations = Array.isArray(saved.conversations) ? saved.conversations.map(function (item) {
        var messages = Array.isArray(item.messages) ? item.messages.filter(function (entry) {
          return entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string';
        }).map(function (entry) {
          return {
            role: entry.role,
            content: entry.content.slice(0, 2400),
            imageData: typeof entry.imageData === 'string' && entry.imageData.length <= 330000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(entry.imageData) ? entry.imageData : '',
            sources: Array.isArray(entry.sources) ? entry.sources.slice(0, 3) : [],
          };
        }) : [];
        return { id: String(item.id || id()), title: String(item.title || 'Conversation').slice(0, 70), updatedAt: Number(item.updatedAt) || Date.now(), messages: messages };
      }) : [];
      activeId = String(saved.activeId || '');
    } catch (_) { conversations = []; activeId = ''; }
    if (!conversations.some(function (item) { return item.id === activeId; })) activeId = conversations[0] && conversations[0].id || '';
    var active = conversations.find(function (item) { return item.id === activeId; });
    if (active) history = active.messages;
    else { history = []; activeId = ''; }
  }
  loadConversations();

  var host = document.createElement('div');
  host.id = 'siloai-widget-host';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;width:' + defaultLauncherSize + 'px;height:' + defaultLauncherSize + 'px;z-index:2147483000;overflow:visible;';
  (document.body || document.documentElement).appendChild(host);
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var icons = {
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 6.4a2 2 0 0 1 2-2h10.4a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H10l-4.2 3.4v-3.4h-1a2 2 0 0 1-2-2z"/><path d="M8 8.6h8M8 11.6h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.4"/><circle cx="9" cy="9.6" r="1.5"/><path d="M4.4 16.8l4.3-4.3 3.1 3.1 2.6-2.6 4.6 4.6"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9.3" y="3.4" width="5.4" height="9.8" rx="2.7"/><path d="M6.2 11.4a5.8 5.8 0 0 0 11.6 0"/><path d="M12 17.2v3.2M9.4 20.4h5.2"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5V5.2M12 5.2l-5.6 5.6M12 5.2l5.6 5.6"/></svg>',
  };
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    'button,textarea,input{font:inherit}',
    'svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '.silo-fab{position:absolute;inset:0;width:100%;height:100%;padding:0;overflow:hidden;border-radius:15px;border:1px solid #8f8f8f;background:#090909;box-shadow:0 14px 38px #0008;cursor:grab;display:grid;place-items:center;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;transition:box-shadow .18s ease,transform .18s ease}',
    '.silo-fab:hover{box-shadow:0 16px 44px #000b}',
    '.silo-fab.is-dragging{will-change:left,top}',
    '.silo-panel.is-dragging,.silo-panel.is-resizing{will-change:left,top,width,height}',
    '.silo-fab:active{cursor:grabbing;transform:scale(.97)}',
    '.silo-fab:focus-visible{outline:2px solid #f2f2f2;outline-offset:3px}',
    '.silo-fab img{display:block;width:100%;height:100%;border-radius:14px;object-fit:cover;transform:none;pointer-events:none;-webkit-user-drag:none;user-select:none}',
    '.silo-panel{position:fixed;width:min(390px,calc(100vw - 24px));height:min(580px,calc(100dvh - 110px));min-width:min(300px,calc(100vw - 16px));min-height:min(360px,calc(100dvh - 16px));max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);background:#0b0b0b;color:#f4f4f4;border:1px solid #333;border-radius:19px;box-shadow:0 24px 80px #000b;display:flex;flex-direction:column;overflow:hidden;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}',
    '.silo-panel[hidden]{display:none}',
    '.silo-panel.is-dragging,.silo-panel.is-resizing{user-select:none;-webkit-user-select:none}',
    '.silo-head{height:60px;min-height:60px;display:flex;align-items:center;gap:9px;padding:0 8px 0 11px;border-bottom:1px solid #262626;background:#111;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}',
    '.silo-panel.is-dragging .silo-head{cursor:grabbing}',
    '.silo-logo{width:35px;height:35px;flex:none;border-radius:8px;object-fit:cover;border:1px solid #767676;background:#090909;pointer-events:none;-webkit-user-drag:none}',
    '.silo-id{min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.silo-brand{font-weight:650;letter-spacing:.02em;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.silo-status{font-size:10px;line-height:1.2;color:#a3a3a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.silo-grow{flex:1}',
    '.silo-icon{width:31px;height:31px;flex:none;display:grid;place-items:center;border-radius:9px;color:#cfcfcf;background:transparent;border:0;cursor:pointer;padding:0;touch-action:manipulation;transition:background .15s ease,color .15s ease}',
    '.silo-icon:hover,.silo-icon[aria-expanded=true]{background:#232323;color:#f4f4f4}',
    '.silo-icon:focus-visible,.silo-tool:focus-visible,.silo-send:focus-visible{outline:2px solid #f2f2f2;outline-offset:2px}',
    '.silo-icon:disabled,.silo-tool:disabled{opacity:.4;cursor:default}',
    '.silo-messages{overflow:auto;flex:1;min-height:0;padding:15px 13px 22px;display:flex;flex-direction:column;gap:11px;overscroll-behavior:contain}',
    '.silo-welcome{padding:16px 14px;border:1px solid #313131;border-radius:14px;background:linear-gradient(140deg,#161616,#101010);color:#c2c2c2}',
    '.silo-welcome b{display:block;color:#f4f4f4;font-size:16px;margin-bottom:5px}',
    '.silo-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}',
    '.silo-chip{border:1px solid #3a3a3a;background:#1a1a1a;color:#dedede;border-radius:999px;padding:6px 10px;font-size:11px;cursor:pointer;line-height:1.3}',
    '.silo-chip:hover{background:#262626;border-color:#5a5a5a;color:#fff}',
    '.silo-msg{max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;border-radius:13px;font-size:13.5px}',
    '.silo-user{align-self:flex-end;background:#262626;color:#f3f3f3;border:1px solid #3c3c3c}',
    '.silo-assistant{align-self:flex-start;background:#141414;border:1px solid #272727;color:#e4e4e4}',
    '.silo-error{color:#eee;border-color:#5b5b5b;background:#191919}',
    '.silo-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.silo-source{display:inline-flex;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #353535;background:#181818;color:#bdbdbd;border-radius:999px;padding:5px 9px;font-size:11px;text-decoration:none}',
    '.silo-source:hover{border-color:#6a6a6a;color:#f2f2f2}',
    '.silo-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}',
    '.silo-action{border:1px solid #cfcfcf;background:#e9e9e9;color:#111;border-radius:9px;padding:7px 11px;cursor:pointer;font-weight:600;font-size:12px;line-height:1.25;white-space:nowrap}',
    '.silo-action:hover{background:#fff}',
    '.silo-action.ghost{background:transparent;color:#e4e4e4;border-color:#4a4a4a}',
    '.silo-action.ghost:hover{background:#242424;color:#fff}',
    '.silo-action:disabled{opacity:.45;cursor:default}',
    '.silo-action-note{margin-top:8px;font-size:12px;color:#b6b6b6;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.silo-action-note code{background:#1d1d1d;border:1px solid #333;border-radius:5px;padding:1px 5px;font-size:11px}',
    '.silo-user-image{display:block;max-width:220px;max-height:160px;object-fit:contain;border-radius:8px;margin-top:7px}',
    '.silo-compose{position:relative;flex:none;padding:9px 10px 9px;border-top:1px solid #262626;background:#111}',
    '.silo-attachment{display:flex;align-items:center;gap:9px;padding:6px 8px;margin-bottom:8px;border:1px solid #363636;border-radius:11px;background:#171717;color:#d0d0d0;font-size:11px}',
    '.silo-attachment[hidden]{display:none}',
    '.silo-attachment img{width:42px;height:34px;object-fit:cover;border-radius:6px;border:1px solid #444;flex:none}',
    '.silo-attachment-copy{min-width:0;display:flex;flex-direction:column;line-height:1.25}',
    '.silo-attachment-copy b{font-size:11.5px;color:#ededed;font-weight:600}',
    '.silo-attachment-copy span{font-size:10px;color:#9c9c9c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.silo-attachment-x{margin-left:auto;width:24px;height:24px;flex:none;border-radius:7px;border:0;background:transparent;color:#cfcfcf;font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center}',
    '.silo-attachment-x:hover{background:#2a2a2a;color:#fff}',
    '.silo-row{display:flex;align-items:flex-end;gap:5px;background:#0c0c0c;border:1px solid #333;border-radius:15px;padding:5px 5px 5px 7px;transition:border-color .15s ease}',
    '.silo-row:focus-within{border-color:#8b8b8b}',
    '.silo-input{resize:none;min-height:34px;max-height:112px;flex:1;min-width:0;border:0;outline:0;background:transparent;color:#f4f4f4;padding:7px 2px;font-size:13.5px;line-height:1.45}',
    '.silo-input::placeholder{color:#868686}',
    '.silo-input:disabled{opacity:.6}',
    '.silo-send,.silo-tool{width:33px;height:33px;flex:none;display:grid;place-items:center;border:0;border-radius:50%;cursor:pointer;padding:0;touch-action:manipulation;transition:background .15s ease,color .15s ease,transform .15s ease}',
    '.silo-tool{background:transparent;color:#b9b9b9}',
    '.silo-tool:hover{background:#212121;color:#fff}',
    '.silo-tool[data-active=true]{background:#242424;color:#fff}',
    '.silo-tool[hidden]{display:none}',
    '.silo-tool[data-listening=true]{background:#ededed;color:#0d0d0d;animation:silo-pulse 1.4s ease-in-out infinite}',
    '.silo-send{background:#ededed;color:#0d0d0d;margin-left:2px}',
    '.silo-send svg{width:17px;height:17px;stroke-width:2}',
    '.silo-send:hover:not(:disabled){background:#fff}',
    '.silo-send:active:not(:disabled){transform:scale(.95)}',
    '.silo-send:disabled{background:#212121;color:#6d6d6d;cursor:default}',
    '.silo-note{display:flex;align-items:center;gap:7px;margin:7px 3px 0;padding:6px 9px;border:1px solid #3a3a3a;border-radius:9px;background:#171717;color:#d5d5d5;font-size:11px;line-height:1.35}',
    '.silo-note[hidden]{display:none}',
    '.silo-note[data-tone=warn]{border-color:#5a5a5a;color:#e8e8e8}',
    '.silo-dot{width:6px;height:6px;border-radius:50%;background:#9a9a9a;flex:none}',
    '.silo-note[data-tone=warn] .silo-dot{background:#e2e2e2}',
    '.silo-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;font-size:10px;color:#838383;margin:7px 3px 0;line-height:1.45}',
    '.silo-foot a{display:block;color:#dcdcdc;text-decoration:underline;text-underline-offset:2px}',
    '.silo-foot a:hover{color:#fff}',
    '.silo-version{flex:none;color:#5d5d5d;font-size:9.5px;letter-spacing:.04em;font-variant-numeric:tabular-nums;user-select:text;-webkit-user-select:text}',
    '.silo-msg.silo-rich{white-space:normal}',
    '.silo-rich p{margin:0 0 6px}',
    '.silo-rich p:last-child,.silo-rich ul:last-child,.silo-rich ol:last-child{margin-bottom:0}',
    '.silo-rich ul,.silo-rich ol{margin:0 0 6px;padding-left:17px}',
    '.silo-rich ul{list-style:disc}.silo-rich ol{list-style:decimal}',
    '.silo-rich li{margin:2px 0}',
    '.silo-rich strong{color:#fff;font-weight:650}',
    '.silo-rich em{font-style:italic;color:#dcdcdc}',
    '.silo-rich code{background:#1d1d1d;border:1px solid #333;border-radius:5px;padding:1px 5px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.silo-rich a{color:#ededed;text-decoration:underline;text-underline-offset:2px}',
    '.silo-rich a:hover{color:#fff}',
    '.silo-typing{color:#b1b1b1;font-size:12px;display:flex;gap:4px;align-items:center}',
    '.silo-typing i{width:5px;height:5px;border-radius:50%;background:#a8a8a8;animation:silo-bounce 1.1s infinite ease-in-out}',
    '.silo-typing i:nth-child(2){animation-delay:.15s}',
    '.silo-typing i:nth-child(3){animation-delay:.3s}',
    '.silo-panel[data-busy=true] .silo-send{opacity:.5}',
    '.silo-menu{position:absolute;top:65px;right:10px;z-index:4;width:min(268px,calc(100% - 20px));max-height:min(300px,50%);overflow:auto;background:#171717;border:1px solid #444;border-radius:12px;padding:6px;box-shadow:0 12px 40px #000b}',
    '.silo-menu[hidden]{display:none}',
    '.silo-menu button{display:block;width:100%;padding:9px 10px;text-align:left;border:0;border-radius:7px;background:transparent;color:#eee;cursor:pointer;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.silo-menu button:hover,.silo-menu button[aria-current=true]{background:#2b2b2b}',
    '.silo-menu small{display:block;color:#999;font-size:10px;margin-top:2px}',
    '.silo-history-empty{color:#aaa;padding:10px;font-size:12px}',
    '.silo-panel-resize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;padding:0;border:0;border-radius:6px;background:transparent;cursor:nwse-resize;touch-action:none;opacity:.55;transition:opacity .15s ease}',
    '.silo-panel-resize:hover,.silo-panel-resize:focus-visible{opacity:1}',
    '.silo-panel-resize::before{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:1.5px solid #9a9a9a;border-bottom:1.5px solid #9a9a9a;border-bottom-right-radius:2px}',
    '.silo-panel-resize:focus-visible{outline:2px solid #eee;outline-offset:1px}',
    '.silo-hidden-file{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%);border:0}',
    '@keyframes silo-pulse{0%,100%{box-shadow:0 0 0 0 #ffffff55}50%{box-shadow:0 0 0 5px #ffffff00}}',
    '@keyframes silo-bounce{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}',
    '</style>',
    '<button class="silo-fab" type="button" aria-label="Open SiloAI" title="Drag to move; click to open" aria-expanded="false"><img src="https://htmltools.me/SiloAI/brandmark-mono.png?v=3" alt="" draggable="false"></button>',
    '<section class="silo-panel" role="dialog" aria-label="Chat with SiloAI" aria-modal="false" hidden>',
    '  <header class="silo-head" data-drag-handle><img class="silo-logo" src="https://htmltools.me/SiloAI/brandmark-mono.png?v=3" alt="" draggable="false"><div class="silo-id"><div class="silo-brand">SiloAI</div><div class="silo-status">Website assistant by HTMLTools.me</div></div><span class="silo-grow"></span><button class="silo-icon" type="button" data-history aria-label="Previous conversations" title="Previous conversations" aria-expanded="false">' + icons.list + '</button><button class="silo-icon" type="button" data-new aria-label="New conversation" title="New conversation">' + icons.plus + '</button><button class="silo-icon" type="button" data-close aria-label="Close SiloAI" title="Close">' + icons.close + '</button></header>',
    '  <div class="silo-menu" data-conversation-menu hidden></div>',
    '  <div class="silo-messages" aria-live="polite"></div>',
    '  <form class="silo-compose"><div class="silo-attachment" data-attachment hidden><img data-attachment-image alt="Screenshot preview"><span class="silo-attachment-copy"><b>Screenshot attached</b><span data-attachment-name>Screenshot attached</span></span><button class="silo-attachment-x" type="button" data-remove-image aria-label="Remove screenshot" title="Remove screenshot">×</button></div><div class="silo-row"><textarea class="silo-input" rows="1" maxlength="1200" aria-label="Message SiloAI" placeholder="Ask about this website…"></textarea><button class="silo-tool" type="button" data-attach aria-label="Attach a screenshot" title="Attach a screenshot">' + icons.image + '</button><button class="silo-tool" type="button" data-voice aria-label="Dictate with your voice" title="Dictate with your voice" aria-pressed="false" hidden>' + icons.mic + '</button><button class="silo-send" type="submit" aria-label="Send message" title="Send">' + icons.send + '</button></div><input class="silo-hidden-file" data-image-file type="file" accept="image/png,image/jpeg,image/webp"><div class="silo-note" data-status role="status" aria-live="polite" hidden><span class="silo-dot"></span><span data-status-text></span></div><div class="silo-note" data-storage-status role="status" aria-live="polite" hidden><span class="silo-dot"></span><span data-storage-text></span></div><div class="silo-foot"><a href="https://htmltools.me/SiloAI/" target="_blank" rel="noopener noreferrer">Set up SiloAI on your site for free at htmltools.me/SiloAI!</a><span class="silo-version" data-version title="SiloAI widget v' + BUILD_VERSION + '">v' + BUILD_VERSION + '</span></div></form>',
    '  <button class="silo-panel-resize" type="button" data-resize-panel aria-label="Resize chat window" title="Drag to resize chat window"></button>',
    '</section>',
  ].join('');

  var fab = shadow.querySelector('.silo-fab');
  var panel = shadow.querySelector('.silo-panel');
  var head = shadow.querySelector('[data-drag-handle]');
  var log = shadow.querySelector('.silo-messages');
  var form = shadow.querySelector('.silo-compose');
  var input = shadow.querySelector('.silo-input');
  var send = shadow.querySelector('.silo-send');
  var menu = shadow.querySelector('[data-conversation-menu]');
  var imageFile = shadow.querySelector('[data-image-file]');
  var attachment = shadow.querySelector('[data-attachment]');
  var attachmentName = shadow.querySelector('[data-attachment-name]');
  var attachButton = shadow.querySelector('[data-attach]');
  var micButton = shadow.querySelector('[data-voice]');
  var statusBox = shadow.querySelector('[data-status]');
  var statusText = shadow.querySelector('[data-status-text]');
  var storageBox = shadow.querySelector('[data-storage-status]');
  var storageText = shadow.querySelector('[data-storage-text]');
  var panelResizeHandle = shadow.querySelector('[data-resize-panel]');
  var historyButton = shadow.querySelector('[data-history]');

  function setStatus(text, tone) {
    if (statusTimer) { window.clearTimeout(statusTimer); statusTimer = 0; }
    if (!text) { statusBox.hidden = true; statusText.textContent = ''; return; }
    statusText.textContent = text;
    statusBox.hidden = false;
    statusBox.setAttribute('data-tone', tone === 'warn' ? 'warn' : 'info');
    if (tone !== 'warn') statusTimer = window.setTimeout(function () { setStatus(''); }, 6000);
  }
  function setStorageStatus(text) {
    if (!text) { storageBox.hidden = true; storageText.textContent = ''; return; }
    storageText.textContent = text;
    storageBox.hidden = false;
  }
  function closeHistoryMenu() {
    menu.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
  }
  function saveConversations() {
    var active = activeConversation();
    if (active) { active.messages = history; active.updatedAt = Date.now(); }
    conversations = conversations.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    try {
      localStorage.setItem(storageKey, JSON.stringify({ activeId: activeId, conversations: conversations }));
      setStorageStatus(imageHistoryPruned ? 'Browser storage was low, so attached images were removed from saved chat history.' : '');
    } catch (_) {
      var removedImages = false;
      conversations.forEach(function (thread) {
        thread.messages.forEach(function (entry) {
          if (entry.imageData) { entry.imageData = ''; removedImages = true; }
        });
      });
      var activeAfterPrune = activeConversation();
      if (activeAfterPrune) history = activeAfterPrune.messages;
      if (removedImages) imageHistoryPruned = true;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ activeId: activeId, conversations: conversations }));
        setStorageStatus(imageHistoryPruned ? 'Browser storage was low, so attached images were removed from saved chat history.' : '');
      } catch (_) {
        setStorageStatus('This browser could not save chat history. Free local storage or enable site storage, then try again.');
      }
    }
  }
  function activeConversation() { return conversations.find(function (item) { return item.id === activeId; }) || null; }
  function startConversation(preserveAttachment) {
    if (busy) return;
    closeHistoryMenu();
    var thread = { id: id(), title: 'New conversation', updatedAt: Date.now(), messages: [] };
    conversations.unshift(thread);
    activeId = thread.id;
    history = thread.messages;
    if (!preserveAttachment) clearAttachment();
    saveConversations();
    renderHistory();
    renderConversationMenu();
  }
  function loadConversation(threadId) {
    if (busy) return;
    var thread = conversations.find(function (item) { return item.id === threadId; });
    if (!thread) return;
    activeId = thread.id;
    history = thread.messages;
    clearAttachment();
    saveConversations();
    renderHistory();
    closeHistoryMenu();
  }
  function setTitleFromMessage(thread, text) {
    if (thread && thread.title === 'New conversation') thread.title = (text || 'Screenshot conversation').replace(/\s+/g, ' ').slice(0, 54);
  }
  function clearAttachment() {
    selectedImage = '';
    selectedImageName = '';
    imageFile.value = '';
    setAttachmentPreview();
  }
  function setAttachmentPreview() {
    var img = shadow.querySelector('[data-attachment-image]');
    if (selectedImage) {
      img.src = selectedImage;
      attachmentName.textContent = selectedImageName || 'Screenshot attached';
      attachment.hidden = false;
    } else {
      img.removeAttribute('src');
      attachment.hidden = true;
    }
    attachButton.setAttribute('data-active', selectedImage ? 'true' : 'false');
  }
  function currentPageDocument() {
    try { if (window.top.document && window.top.location.origin === location.origin) return window.top.document; } catch (_) { /* cross-origin frame */ }
    return document;
  }
  function currentPageContext() {
    var doc = currentPageDocument(); var view = doc.defaultView || window; var pageUrl;
    try { pageUrl = new URL(view.location.href); } catch (_) { pageUrl = new URL('/', location.origin); }
    return { pagePath: pageUrl.pathname, pageTitle: String(doc.title || document.title || '').slice(0, 180) };
  }
  function ownNodes(el) {
    if (!el) return false;
    if (host === el || host.contains(el)) return true;
    if (el.closest && el.closest('#siloai-widget-host') === host) return true;
    try { if (typeof el.getRootNode === 'function' && el.getRootNode() === shadow) return true; } catch (_) { /* detached */ }
    var parentHost = el.parentElement ? el.parentElement.closest('#siloai-widget-host') : null;
    return parentHost === host;
  }
  /* Every document we can safely read: the visitor's page plus same-origin
     frames (tool pages such as HTML Runner keep their controls inside one). */
  function pageDocuments() {
    var docs = [];
    var seen = new Set();
    var topDoc = currentPageDocument();
    var queue = [{ doc: topDoc, frame: null }];
    while (queue.length && docs.length < 6) {
      var item = queue.shift();
      if (!item.doc || seen.has(item.doc)) continue;
      seen.add(item.doc);
      if (ownNodes(item.doc.body)) continue;
      docs.push(item);
      var frames;
      try { frames = item.doc.querySelectorAll('iframe,frame'); } catch (_) { continue; }
      for (var index = 0; index < frames.length && index < 10; index++) {
        var frame = frames[index];
        if (ownNodes(frame)) continue;
        var child = null;
        try { child = frame.contentDocument; } catch (_) { child = null; }
        if (!child || !child.body || seen.has(child)) continue;
        var rect = frame.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) continue;
        queue.push({ doc: child, frame: frame });
      }
    }
    return docs;
  }
  /* Controls inside open shadow roots are invisible to querySelectorAll. */
  function controlCandidates(doc) {
    var list = Array.prototype.slice.call(doc.querySelectorAll(CONTROL_SELECTOR));
    var hosts;
    try { hosts = doc.querySelectorAll('*'); } catch (_) { return list; }
    var scanned = 0;
    for (var index = 0; index < hosts.length && scanned < 1_500; index++) {
      var node = hosts[index];
      if (!node.shadowRoot || ownNodes(node)) continue;
      scanned++;
      var inner = node.shadowRoot.querySelectorAll(CONTROL_SELECTOR);
      for (var innerIndex = 0; innerIndex < inner.length; innerIndex++) list.push(inner[innerIndex]);
    }
    return list;
  }
  function explicitButtonType(el) {
    return String(el.getAttribute('type') || '').toLowerCase();
  }
  function elementHidden(el, view, memo) {
    if (memo.has(el)) return memo.get(el);
    var hidden = el.hidden === true || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert');
    if (!hidden) {
      var computed = view.getComputedStyle(el);
      hidden = computed.display === 'none' || computed.visibility === 'hidden' || computed.visibility === 'collapse'
        || computed.contentVisibility === 'hidden' || Number(computed.opacity) === 0;
    }
    if (!hidden && el.parentElement) hidden = elementHidden(el.parentElement, view, memo);
    memo.set(el, hidden);
    return hidden;
  }
  function isVisibleOnPage(el, doc, minSize, memo) {
    if (ownNodes(el)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < minSize || rect.height < minSize) return false;
    // One computed-style lookup per element for the whole pass: candidates arrive
    // in document order, so parent results are already cached.
    return !elementHidden(el, doc.defaultView || window, memo || new Map());
  }
  function isInViewport(el, view) {
    var rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < (view.innerHeight || 0) && rect.left < (view.innerWidth || 0);
  }
  function excerptFromDocument(doc, budget) {
    var root = doc.querySelector('main,[role=main],article') || doc.body;
    if (!root) return '';
    var view = doc.defaultView || window;
    var walker = doc.createTreeWalker(root, 4);
    var memo = new Map();
    var excluded = 'script,style,noscript,template,nav,footer,input,textarea,select,option,[contenteditable=true],[hidden],[aria-hidden=true]';
    var onScreen = []; var elsewhere = []; var visited = 0;
    var screenLength = 0;
    while (walker.nextNode() && visited++ < 1_800) {
      var node = walker.currentNode; var el = node.parentElement;
      if (!el || ownNodes(el) || (el.closest && el.closest(excluded))) continue;
      if (!isVisibleOnPage(el, doc, 1, memo)) continue;
      var text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (isInViewport(el, view)) { onScreen.push(text); screenLength += text.length + 1; }
      else elsewhere.push(text);
      if (screenLength > budget * 0.7 && elsewhere.length > 200) break;
    }
    var lead = onScreen.join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, Math.round(budget * 0.7));
    var rest = elsewhere.join(' ').replace(/\s{2,}/g, ' ').trim();
    var combined = lead ? lead + (rest ? ' ' + rest : '') : rest;
    return combined.replace(/\s{2,}/g, ' ').trim().slice(0, budget);
  }
  function visiblePageExcerpt() {
    var documents = pageDocuments();
    var primary = excerptFromDocument(documents[0].doc, 2_000);
    if (documents.length < 2) return primary;
    // Same-origin frames often hold the actual tool UI (editors, runners).
    var frameText = '';
    for (var index = 1; index < documents.length && frameText.length < 500; index++) {
      var piece = excerptFromDocument(documents[index].doc, 500);
      if (piece) frameText += (frameText ? ' ' : '') + piece;
    }
    var combined = (primary + (frameText ? ' ' + frameText : '')).replace(/\s{2,}/g, ' ').trim();
    return combined.slice(0, 2_500);
  }
  /**
   * Removes generation scaffolding that can slip into a reply: fenced JSON, a
   * leading {"reply": fragment, or a trailing ,"action":… that was cut off.
   */
  function tidyReplyText(text) {
    var value = String(text == null ? '' : text).trim();
    if (!value) return '';
    value = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    var marker = /"reply"\s*:\s*"/.exec(value);
    if (marker && !/^\s*\{/.test(value)) {
      // Prose followed by a leaked JSON fragment: keep the prose only.
      return quietTrim(value.slice(0, marker.index).replace(/[\s,{]+$/, ''));
    }
    if (marker) {
      var out = '';
      for (var i = marker.index + marker[0].length; i < value.length; i++) {
        var char = value.charAt(i);
        if (char === '\\') {
          var next = value.charAt(i + 1);
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i++;
          continue;
        }
        if (char === '"') break;
        out += char;
      }
      if (out.trim()) return out.trim();
    }
    if (/^\s*\{\s*"?reply"?\s*:/i.test(value) || /^\s*\{\s*$/.test(value)) {
      return quietTrim(value.replace(/^\s*\{\s*"?reply"?\s*:\s*"?/i, '').replace(/"?\s*,\s*"action"[\s\S]*$/i, ''));
    }
    return quietTrim(value);
  }
  function quietTrim(value) {
    return String(value || '').replace(/\s+$/, '').replace(/^\s+/, '');
  }
  function stripDanglingMarkers(value) {
    var text = String(value || '').replace(/\r\n/g, '\n');
    if (((text.match(/\*\*/g) || []).length) % 2 === 1) text = text.replace(/\*\*(?![^]*\*\*)/, '');
    if (((text.match(/`/g) || []).length) % 2 === 1) text = text.replace(/`(?![^`]*`)/, '');
    return text;
  }
  function inlineFormat(target, text) {
    var pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]{1,120}\]\((?:https?:\/\/|\/)[^)\s]{1,300}\))/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) target.appendChild(document.createTextNode(text.slice(last, match.index)));
      var token = match[0];
      last = match.index + token.length;
      if (token.slice(0, 2) === '**') {
        var strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        target.appendChild(strong);
      } else if (token.charAt(0) === '`') {
        var code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        target.appendChild(code);
      } else if (token.charAt(0) === '[') {
        var pair = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        var href = '';
        try { href = new URL(pair[2], location.href).href; } catch (_) { href = ''; }
        if (href && /^https?:/i.test(href)) {
          var anchor = document.createElement('a');
          anchor.href = href;
          anchor.textContent = pair[1];
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          target.appendChild(anchor);
        } else target.appendChild(document.createTextNode(pair[1] || token));
      } else {
        var em = document.createElement('em');
        em.textContent = token.slice(1, -1);
        target.appendChild(em);
      }
    }
    if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
  }
  /** A tiny, safe Markdown renderer: bold, italics, inline code, links, lists, headings. */
  function renderRichText(target, text) {
    target.classList.add('silo-rich');
    target.textContent = '';
    var value = stripDanglingMarkers(text).trim();
    if (!value) return;
    value.split(/\n{2,}/).forEach(function (block) {
      var list = null;
      block.split('\n').forEach(function (rawLine) {
        var line = quietTrim(rawLine);
        if (!line) { list = null; return; }
        line = line.replace(/^#{1,6}\s+/, '');
        var bullet = /^[-*•]\s+(.*)$/.exec(line);
        var numbered = /^\d+[.)]\s+(.*)$/.exec(line);
        if (bullet || numbered) {
          var wantedTag = (bullet ? 'ul' : 'ol');
          if (!list || list.tagName.toLowerCase() !== wantedTag) {
            list = document.createElement(wantedTag);
            target.appendChild(list);
          }
          var item = document.createElement('li');
          inlineFormat(item, (bullet || numbered)[1] || '');
          list.appendChild(item);
          return;
        }
        list = null;
        var paragraph = document.createElement('p');
        inlineFormat(paragraph, line);
        target.appendChild(paragraph);
      });
    });
  }
  function bubble(role, text, isError) {
    var el = document.createElement('div');
    el.className = 'silo-msg ' + (role === 'user' ? 'silo-user' : 'silo-assistant') + (isError ? ' silo-error' : '');
    if (role === 'user') el.textContent = text;
    else renderRichText(el, text);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function addSources(parent, sources) {
    if (!Array.isArray(sources) || !sources.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'silo-sources';
    sources.forEach(function (source) {
      if (!source || typeof source.path !== 'string' || !source.path.startsWith('/') || source.path.startsWith('//')) return;
      var destination;
      try { destination = new URL(source.path, location.origin); } catch (_) { return; }
      if (destination.origin !== location.origin) return;
      var link = document.createElement('a');
      link.className = 'silo-source';
      link.href = destination.href;
      link.textContent = source.title || source.path;
      link.title = source.path;
      wrap.appendChild(link);
    });
    if (wrap.childNodes.length) parent.appendChild(wrap);
  }
  function renderConversationMenu() {
    menu.textContent = '';
    if (!conversations.length) {
      var empty = document.createElement('div'); empty.className = 'silo-history-empty'; empty.textContent = 'No saved conversations yet.'; menu.appendChild(empty); return;
    }
    conversations.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (thread) {
      var button = document.createElement('button');
      button.type = 'button'; button.setAttribute('aria-current', String(thread.id === activeId));
      button.appendChild(document.createTextNode(thread.title || 'Conversation'));
      var when = document.createElement('small'); when.textContent = new Date(thread.updatedAt).toLocaleString(); button.appendChild(when);
      button.addEventListener('click', function () { loadConversation(thread.id); });
      menu.appendChild(button);
    });
  }
  function welcomeCard() {
    var welcome = document.createElement('div'); welcome.className = 'silo-welcome';
    var bold = document.createElement('b'); bold.textContent = 'Hi, I’m SiloAI.';
    welcome.appendChild(bold);
    welcome.appendChild(document.createTextNode('Ask about this website — or ask me to point at, click, or change something on this page.'));
    var chips = document.createElement('div'); chips.className = 'silo-chips';
    [['What can I do on this page?', 'What can I do on this page?'], ['Highlight something here', 'Highlight Anything on my page'], ['Attach a screenshot', null]].forEach(function (pair) {
      var chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'silo-chip'; chip.textContent = pair[0];
      chip.addEventListener('click', function () {
        if (!pair[1]) { imageFile.click(); return; }
        input.value = pair[1];
        submitComposer();
      });
      chips.appendChild(chip);
    });
    welcome.appendChild(chips);
    return welcome;
  }
  function renderHistory() {
    log.textContent = '';
    if (!history.length) { log.appendChild(welcomeCard()); return; }
    history.forEach(function (entry) {
      var el = bubble(entry.role, entry.role === 'assistant' ? tidyReplyText(entry.content) : (entry.content || ''));
      if (entry.imageData) { var img = document.createElement('img'); img.className = 'silo-user-image'; img.src = entry.imageData; img.alt = 'Screenshot you attached'; el.appendChild(img); }
      if (entry.role === 'assistant') addSources(el, entry.sources);
    });
  }
  function describeVisibleControls() {
    var controls = collectPageTargets();
    var groups = [
      ['button', 'button'],
      ['link', 'link'],
      ['field', 'field'],
      ['check', 'checkbox'],
      ['select', 'dropdown'],
      ['text', 'text block'],
    ];
    var parts = [];
    groups.forEach(function (pair) {
      var items = controls.filter(function (item) { return item.kind === pair[0]; });
      if (!items.length) return;
      var names = items.slice(0, 4).map(function (item) { return '“' + item.label + '”'; }).join(', ') + (items.length > 4 ? ', …' : '');
      parts.push(items.length + ' ' + pair[1] + (items.length === 1 ? '' : 's') + ' (' + names + ')');
    });
    if (!parts.length) return 'I could not read any controls on this page. If it is inside a cross-origin frame, the site owner needs to embed me in that frame instead.';
    return 'On this page I can see ' + parts.join(', ') + '.';
  }
  function submitComposer() {
    if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return; }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  function setBusy(value) {
    busy = value;
    panel.dataset.busy = String(value);
    input.disabled = value;
    send.disabled = value;
    attachButton.disabled = value;
    shadow.querySelector('[data-new]').disabled = value;
    shadow.querySelector('[data-history]').disabled = value;
    micButton.disabled = value;
    if (value) { fab.setAttribute('aria-busy', 'true'); } else fab.removeAttribute('aria-busy');
  }

  var TEXT_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,pre,code,blockquote,[role=heading]';
  var BUTTON_SELECTOR = 'button,[role=button],summary,a[href],a.btn,a.button,a[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio]';
  var CONTROL_SELECTOR = BUTTON_SELECTOR + ',input,textarea,select,[contenteditable=true],[contenteditable=""],' + TEXT_SELECTOR;
  function shortText(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100); }
  var LABEL_EDGE;
  try { LABEL_EDGE = new RegExp('^[^\\p{L}\\p{N}([{\"\'\u201c]+|[^\\p{L}\\p{N})\\]}\"\'\u201d]+$', 'gu'); }
  catch (_) { LABEL_EDGE = /^[^A-Za-z0-9([{"']+|[^A-Za-z0-9)\]}"']+$/g; }
  /* "▶ Run", "🔄 Refresh preview" and "Run →" all match a visitor saying "Run". */
  function cleanLabel(text) {
    var base = shortText(text);
    var trimmed = base.replace(LABEL_EDGE, '').replace(/\s+/g, ' ').trim();
    return trimmed || base;
  }
  function attrText(el, name) {
    var value = el.getAttribute(name);
    return value ? shortText(value) : '';
  }
  function labelledByText(el) {
    var tokens = String(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    var doc = el.ownerDocument || document;
    var pieces = tokens.map(function (token) {
      var node = null;
      try { node = doc.getElementById(token); } catch (_) { node = null; }
      return node ? (node.innerText || node.textContent || '') : '';
    });
    return shortText(pieces.join(' '));
  }
  function iconText(el) {
    var image = el.querySelector && el.querySelector('img[alt]');
    if (image) { var alt = attrText(image, 'alt'); if (alt) return alt; }
    var svgTitle = el.querySelector && el.querySelector('svg title');
    if (svgTitle) { var title = shortText(svgTitle.textContent); if (title) return title; }
    return '';
  }
  function accessibleName(el) {
    return attrText(el, 'aria-label') || labelledByText(el) || attrText(el, 'title') || attrText(el, 'data-tooltip')
      || attrText(el, 'placeholder') || shortText(el.innerText || el.textContent || '') || iconText(el);
  }
  function controlLabelFor(el, kind) {
    var editable = el.matches('[contenteditable=true],[contenteditable=""]');
    if (kind === 'field' || kind === 'check' || kind === 'select') {
      var explicit = attrText(el, 'aria-label') || attrText(el, 'placeholder') || attrText(el, 'title') || labelledByText(el);
      if (explicit) return explicit;
      if (el.labels && el.labels.length) {
        var labelled = shortText(Array.prototype.map.call(el.labels, function (label) { return label.innerText || label.textContent || ''; }).join(' '));
        if (labelled) return labelled;
      }
      if (kind === 'check') return 'Checkbox';
      if (kind === 'select') return 'Dropdown';
      return editable ? 'Editable text area' : 'Text field';
    }
    return cleanLabel(accessibleName(el) || (kind === 'button' ? el.value || '' : ''));
  }
  function isSensitiveField(el) {
    var inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (inputType === 'password') return true;
    var identity = [el.autocomplete, el.name, el.id].join(' ');
    return /password|secret|token|one-time|otp|cc-|credit.?card|ssn/i.test(identity);
  }
  function linkHref(el) {
    var raw = el.getAttribute('href') || '';
    if (!raw || raw === '#') return '';
    try {
      var url = new URL(raw, location.href);
      if (!/^https?:$/.test(url.protocol)) return '';
      var internal = url.origin === location.origin;
      return { href: internal ? url.pathname + url.search : url.href.slice(0, 400), external: !internal, internal: internal };
    } catch (_) { return ''; }
  }
  function isChecked(el) {
    if (el.matches('input')) return Boolean(el.checked);
    var aria = el.getAttribute('aria-checked');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    return el.getAttribute('aria-pressed') === 'true';
  }
  function selectOptions(el) {
    if (!el.options) return [];
    return Array.prototype.slice.call(el.options, 0, 12).map(function (option) {
      return shortText(option.textContent || option.value || '');
    }).filter(Boolean);
  }
  function collectPageTargets() {
    targetIndex.clear();
    var buckets = { button: [], link: [], check: [], select: [], field: [], text: [] };
    var documents = pageDocuments();
    for (var docIndex = 0; docIndex < documents.length; docIndex++) {
      var doc = documents[docIndex].doc;
      var frame = documents[docIndex].frame;
      var view = doc.defaultView || window;
      var memo = new Map();
      var candidates = controlCandidates(doc);
      for (var index = 0; index < candidates.length && index < 2_400; index++) {
        var el = candidates[index];
        if (!el.isConnected || ownNodes(el)) continue;
        var kind; var inputType = ''; var clickable = true;
        var extra = {};
        var inputKind = (el.getAttribute('type') || '').toLowerCase();
        if (el.matches('input,textarea,select')) {
          if (el.tagName === 'SELECT') { kind = 'select'; extra.options = selectOptions(el); }
          else if (el.matches('input[type=checkbox],input[type=radio],[role=checkbox],[role=radio],[role=switch]')) {
            kind = 'check'; extra.state = isChecked(el) ? 'checked' : 'unchecked';
          } else if (el.tagName === 'INPUT' && ['button', 'submit', 'reset', 'image'].includes(inputKind)) {
            kind = 'button';
            clickable = inputKind === 'button';
            inputType = 'button';
          } else if (el.tagName === 'INPUT' && !['text', 'search', 'email', 'url', 'tel', 'number'].includes(inputKind)) {
            continue;
          } else {
            kind = 'field'; inputType = inputKind || (el.tagName === 'TEXTAREA' ? 'textarea' : 'text');
          }
          if (kind !== 'check' && isSensitiveField(el)) continue;
        } else if (el.matches('a[href]') && !el.matches('[role=button],button')) {
          var link = linkHref(el);
          if (!link) continue;
          kind = 'link';
          extra.href = link.href;
          extra.external = link.external;
          // Links are never clicked in place: leaving the page always goes through
          // the destination card (or openLink) so the visitor decides to go.
          clickable = false;
        } else if (el.matches(BUTTON_SELECTOR)) {
          kind = 'button';
          // Everything visible is reported so it can be highlighted. Only controls
          // that would submit/reset a form or leave the page are highlight-only.
          // A <button> with no type attribute reports type="submit" to script while
          // behaving like a normal button, so the attribute is what counts.
          var declared = explicitButtonType(el);
          if (el.tagName === 'BUTTON' && (declared === 'submit' || declared === 'reset')) clickable = false;
          if (el.matches('[role=checkbox],[role=radio],[role=switch]')) {
            kind = 'check'; extra.state = isChecked(el) ? 'checked' : 'unchecked';
          }
          extra.tag = el.tagName.toLowerCase();
        } else if (el.matches('[contenteditable=true],[contenteditable=""]')) {
          kind = 'field'; inputType = 'contenteditable';
        } else if (el.matches(TEXT_SELECTOR)) {
          kind = 'text';
          extra.tag = el.tagName.toLowerCase();
        } else continue;
        if (kind === 'text') {
          var parentText = el.parentElement && el.parentElement.closest(TEXT_SELECTOR);
          if (parentText && !ownNodes(parentText) && isVisibleOnPage(parentText, doc, 2, memo)) continue;
        }
        if (!isVisibleOnPage(el, doc, 2, memo)) continue;
        if (frame && !isVisibleOnPage(frame, frame.ownerDocument, 2, new Map())) continue;
        if (el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled') === 'true') continue;
        var label = controlLabelFor(el, kind);
        if (!label) continue;
        if (kind === 'field' && /password|secret|token|one-time|otp|credit.?card|card.?number|security.?code|\bssn\b/i.test(label)) continue;
        var inViewport = isInViewport(el, view);
        var entry = { el: el, kind: kind, label: label, inputType: inputType, clickable: clickable, inViewport: inViewport, docIndex: docIndex, order: index };
        Object.keys(extra).forEach(function (key) { entry[key] = extra[key]; });
        buckets[kind].push(entry);
      }
    }
    // Prefer what the visitor can actually see right now.
    var byScreen = function (a, b) {
      return (b.clickable === false ? 0 : 1) - (a.clickable === false ? 0 : 1)
        || (b.inViewport ? 1 : 0) - (a.inViewport ? 1 : 0)
        || a.docIndex - b.docIndex
        || a.order - b.order;
    };
    ['button', 'link', 'field', 'check', 'select', 'text'].forEach(function (name) { buckets[name].sort(byScreen); });
    var ordered = buckets.button.slice(0, 16)
      .concat(buckets.link.slice(0, 10), buckets.field.slice(0, 10), buckets.check.slice(0, 8), buckets.select.slice(0, 6), buckets.text.slice(0, 14));
    return ordered.map(function (entry, position) {
      var controlId = 'siloctl' + (position + 1);
      targetIndex.set(controlId, entry);
      var item = { id: controlId, kind: entry.kind, label: entry.label };
      if (entry.inputType) item.inputType = entry.inputType;
      if (entry.kind === 'button' || entry.kind === 'link') item.clickable = entry.clickable !== false;
      if (entry.kind === 'link') { item.href = entry.href; item.external = entry.external === true; }
      if (entry.kind === 'check') item.state = entry.state;
      if (entry.kind === 'select') item.options = entry.options;
      if (entry.tag) item.tag = entry.tag;
      return item;
    });
  }
  function resolveTarget(action) {
    if (!action || typeof action.target !== 'string' || !/^[a-z0-9_-]{1,48}$/i.test(action.target)) return null;
    var entry = targetIndex.get(action.target);
    var el = entry && entry.el;
    if (!el || !el.isConnected) {
      collectPageTargets();
      entry = targetIndex.get(action.target);
      el = entry && entry.el;
    }
    if (!el || !el.isConnected || ownNodes(el)) return null;
    if (el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled') === 'true' || el.closest('[aria-hidden="true"]')) return null;
    return el;
  }
  function clearHighlight() {
    if (!highlightCleanup) return;
    var cleanup = highlightCleanup;
    highlightCleanup = null;
    try { cleanup(); } catch (_) { /* detached */ }
  }
  function highlightElement(el, label) {
    clearHighlight();
    var doc = el.ownerDocument || document;
    var view = doc.defaultView || window;
    if (!doc.body) return;
    var ring = doc.createElement('div');
    var chip = doc.createElement('div');
    ring.setAttribute('data-siloai-highlight', '');
    chip.setAttribute('data-siloai-highlight', '');
    chip.textContent = shortText(label) || 'Here';
    ring.style.cssText = 'position:fixed;z-index:2147482990;pointer-events:none;border-radius:9px;box-shadow:0 0 0 2px #fff,0 0 0 7px rgba(255,255,255,.18),0 0 0 9999px rgba(0,0,0,.30);transition:left .16s ease,top .16s ease,width .16s ease,height .16s ease;';
    chip.style.cssText = 'position:fixed;z-index:2147482991;pointer-events:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;background:#f2f2f2;color:#0b0b0b;border-radius:999px;padding:3px 9px;box-shadow:0 6px 18px rgba(0,0,0,.45);';
    doc.body.appendChild(ring);
    doc.body.appendChild(chip);
    function position() {
      if (!el.isConnected) { clearHighlight(); return; }
      var rect = el.getBoundingClientRect();
      ring.style.left = Math.round(rect.left - 5) + 'px';
      ring.style.top = Math.round(rect.top - 5) + 'px';
      ring.style.width = Math.max(10, Math.round(rect.width + 10)) + 'px';
      ring.style.height = Math.max(10, Math.round(rect.height + 10)) + 'px';
      var chipTop = rect.top - 28;
      if (chipTop < 8) chipTop = Math.min(rect.bottom + 8, (view.innerHeight || 0) - 30);
      chip.style.left = Math.max(8, Math.min((view.innerWidth || 0) - 170, Math.round(rect.left - 2))) + 'px';
      chip.style.top = Math.max(8, Math.round(chipTop)) + 'px';
    }
    position();
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    view.addEventListener('scroll', position, true);
    view.addEventListener('resize', position);
    var timer = window.setTimeout(clearHighlight, 6000);
    highlightCleanup = function () {
      window.clearTimeout(timer);
      view.removeEventListener('scroll', position, true);
      view.removeEventListener('resize', position);
      if (ring.parentNode) ring.parentNode.removeChild(ring);
      if (chip.parentNode) chip.parentNode.removeChild(chip);
    };
    position();
  }
  function actionButton(parent, text, handler, ghost) {
    var wrap = parent.querySelector('.silo-actions');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'silo-actions'; parent.appendChild(wrap); }
    var button = document.createElement('button');
    button.className = 'silo-action' + (ghost ? ' ghost' : '');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', handler);
    wrap.appendChild(button);
    return button;
  }
  function actionNote(parent, text) {
    var note = document.createElement('div');
    note.className = 'silo-action-note';
    note.textContent = text;
    parent.appendChild(note);
    return note;
  }
  function replaceFieldValue(target, value) {
    if (target.matches('[contenteditable=true],[contenteditable=""]')) {
      target.textContent = value;
    } else if (target.tagName === 'SELECT') {
      var option = Array.prototype.find.call(target.options, function (item) { return item.value === value || item.textContent.trim() === value; });
      if (option) target.value = option.value;
    } else {
      var prototype = Object.getPrototypeOf(target);
      var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(target, value); else target.value = value;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof target.focus === 'function') target.focus();
  }
  function pageViewFor(el) {
    var doc = el.ownerDocument || document;
    return doc.defaultView || window;
  }
  function scrollPage(position) {
    var view = window;
    var top = position === 'bottom' ? document.documentElement.scrollHeight : position === 'top' ? 0 : null;
    if (top === null) {
      var step = Math.round((view.innerHeight || 400) * 0.8);
      view.scrollBy({ top: position === 'up' ? -step : step, behavior: 'smooth' });
      return 'Scrolled the page ' + position + '.';
    }
    view.scrollTo({ top: top, behavior: 'smooth' });
    return 'Scrolled to the ' + position + ' of the page.';
  }
  function copyText(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4_000);
    if (!text) return Promise.reject(new Error('empty'));
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(area);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }
  function selectElementText(el) {
    if (el.matches('input,textarea')) { el.focus(); el.select(); return true; }
    var doc = el.ownerDocument || document;
    var selection = doc.getSelection ? doc.getSelection() : null;
    if (!selection || !doc.createRange) return false;
    var range = doc.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  function setCheckedState(el, desired) {
    var target = desired === 'checked';
    if (el.matches('input[type=checkbox],input[type=radio]')) {
      if (target && el.matches('input[type=radio]')) {
        var group = el.name ? el.ownerDocument.querySelectorAll('input[type=radio][name="' + String(el.name).replace(/"/g, '') + '"]') : [el];
        Array.prototype.forEach.call(group, function (radio) { radio.checked = radio === el; });
      } else el.checked = target;
    } else {
      el.setAttribute('aria-checked', String(target));
      el.setAttribute('aria-pressed', String(target));
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pickOption(el, value) {
    if (!el.options) return false;
    var match = Array.prototype.find.call(el.options, function (option) {
      return shortText(option.textContent || '') === value || option.value === value;
    });
    if (!match) return false;
    el.value = match.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function clearHighlightsByName(name) {
    var marks = document.querySelectorAll('[data-siloai-find="' + name + '"]');
    Array.prototype.forEach.call(marks, function (mark) {
      var parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    });
  }
  function findOnPage(phrase) {
    var doc = document;
    var needle = String(phrase || '').trim().toLowerCase();
    if (!needle) return 0;
    clearHighlightsByName('find');
    var walker = doc.createTreeWalker(doc.body || doc.documentElement, 4);
    var nodes = [];
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var parent = node.parentElement;
      if (!parent || ownNodes(parent) || parent.closest('script,style,noscript,textarea,svg,[data-siloai-highlight]')) continue;
      if (String(node.nodeValue || '').toLowerCase().indexOf(needle) === -1) continue;
      nodes.push(node);
      if (nodes.length > 60) break;
    }
    var marked = 0;
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var fragment = doc.createDocumentFragment();
      var cursor = 0;
      var at = lower.indexOf(needle);
      if (at === -1) return;
      while (at !== -1) {
        fragment.appendChild(doc.createTextNode(text.slice(cursor, at)));
        var mark = doc.createElement('mark');
        mark.setAttribute('data-siloai-find', 'find');
        mark.textContent = text.slice(at, at + needle.length);
        mark.style.cssText = 'background:#f5e663;color:#0b0b0b;border-radius:3px;box-shadow:0 0 0 2px #f5e663;padding:0 1px';
        fragment.appendChild(mark);
        marked++;
        cursor = at + needle.length;
        at = lower.indexOf(needle, cursor);
      }
      fragment.appendChild(doc.createTextNode(text.slice(cursor)));
      if (node.parentNode) node.parentNode.replaceChild(fragment, node);
    });
    if (marked) {
      var first = doc.querySelector('[data-siloai-find="find"]');
      if (first && typeof first.scrollIntoView === 'function') first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(function () { clearHighlightsByName('find'); }, 12_000);
    }
    return marked;
  }

  function openDestination(href, newTab) {
    var url;
    try { url = new URL(href, location.href); } catch (_) { return false; }
    if (!/^https?:$/.test(url.protocol)) return false;
    if (newTab) {
      var opened = window.open(url.href, '_blank', 'noopener,noreferrer');
      if (opened) { try { opened.opener = null; } catch (_) { /* ignore */ } }
      setStatus(newTab && !opened ? 'Your browser blocked the new tab. Use the same-tab button instead.' : 'Opened ' + url.pathname + ' in a new tab.', newTab && !opened ? 'warn' : 'info');
      return true;
    }
    setStatus('Opened ' + (url.pathname || '/') + ' in this tab.', 'info');
    location.assign(url.href);
    return true;
  }

  function applyAction(parent, action, confirmAction) {
    if (!action || typeof action.type !== 'string') return;
    var known = action.target ? targetIndex.get(action.target) : null;
    var label = shortText(action.label) || (known && known.label) || 'that element';

    /* ---- navigation ------------------------------------------------------ */
    if (action.type === 'navigate' && typeof action.path === 'string') {
      var destination;
      try { destination = new URL(action.path, location.origin); } catch (_) { return; }
      if (!/^https?:$/.test(destination.protocol)) return;
      var internal = destination.origin === location.origin;
      var tabChoice = action.newTab === true;
      var titleText = shortText(action.title) || (internal ? destination.pathname : destination.hostname);
      if (confirmAction === false) { openDestination(destination.href, tabChoice); return; }
      var primary = actionButton(parent, (tabChoice ? 'Open “' : 'Go to “') + titleText + '”' + (tabChoice ? ' in a new tab' : ' here'));
      primary.addEventListener('click', function () {
        primary.disabled = true;
        primary.textContent = 'Opening…';
        openDestination(destination.href, tabChoice);
      });
      actionButton(parent, tabChoice ? 'Open in this tab instead' : 'Open in a new tab instead', function (event) {
        event.currentTarget.disabled = true;
        openDestination(destination.href, !tabChoice);
      }, true);
      return;
    }
    var linkHrefValue = typeof action.href === 'string' ? action.href : (known && typeof known.href === 'string' ? known.href : '');
    if (action.type === 'openLink' && linkHrefValue) {
      var href = linkHrefValue;
      var external = action.external === true || (known && known.external === true) || !/^\/(?!\/)/.test(href);
      var wantedNewTab = action.newTab !== false || external;
      actionButton(parent, (wantedNewTab ? 'Open “' : 'Go to “') + label + '”' + (wantedNewTab ? ' in a new tab' : ' here'), function (event) {
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Opening…';
        openDestination(href, wantedNewTab);
      });
      actionButton(parent, wantedNewTab ? 'Open in this tab instead' : 'Open in a new tab instead', function (event) {
        event.currentTarget.disabled = true;
        openDestination(href, !wantedNewTab);
      }, true);
      return;
    }

    /* ---- instant helpers -------------------------------------------------- */
    if (action.type === 'scroll') {
      if (action.position) { setStatus(scrollPage(action.position)); return; }
      var scrollTarget = resolveTarget(action);
      if (!scrollTarget) { setStatus('That element is no longer on the page.', 'warn'); return; }
      if (typeof scrollTarget.scrollIntoView === 'function') scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      setStatus('Scrolled to “' + label + '”.');
      actionButton(parent, 'Scroll again', function () {
        var again = resolveTarget(action);
        if (again && typeof again.scrollIntoView === 'function') again.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, true);
      return;
    }
    if (action.type === 'find') {
      var hits = findOnPage(action.value);
      setStatus(hits ? 'Found ' + hits + ' match' + (hits === 1 ? '' : 'es') + ' for “' + shortText(action.value) + '” and highlighted them.' : 'I could not find “' + shortText(action.value) + '” on this page.', hits ? 'info' : 'warn');
      return;
    }
    if (action.type === 'focus') {
      actionButton(parent, 'Focus “' + label + '”', function (event) {
        var target = resolveTarget(action);
        if (!target) { setStatus('That control is no longer on the page.', 'warn'); return; }
        if (typeof target.focus === 'function') target.focus();
        highlightElement(target, label);
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Focused ✓';
        setStatus('Ready to type in “' + label + '”.');
      });
      return;
    }
    if (action.type === 'highlight') {
      var runHighlight = function (quiet) {
        var target = resolveTarget(action);
        if (!target) { setStatus('That element is no longer on the page. Ask me again and I’ll re-check.', 'warn'); return; }
        highlightElement(target, label);
        if (!quiet) setStatus('Highlighted “' + label + '” on the page.');
      };
      runHighlight(true);
      actionButton(parent, 'Highlight again', function () { runHighlight(false); }, true);
      return;
    }

    /* ---- confirmed state changes ----------------------------------------- */
    if (action.type === 'click') {
      actionButton(parent, 'Click “' + label + '”', function (event) {
        var target = resolveTarget(action);
        if (!target) { setStatus('That button is no longer on the page, so I didn’t click it.', 'warn'); return; }
        var current = targetIndex.get(action.target);
        if (current && current.clickable === false) { setStatus('“' + label + '” would submit a form or leave this page, so I can only highlight it.', 'warn'); return; }
        if (!target.matches('button,[role=button],[role=tab],[role=menuitem],summary,input[type=button],a.btn,a.button')) { setStatus('That element is not a button, so I did not click it.', 'warn'); return; }
        if (target.tagName === 'BUTTON' && ['submit', 'reset'].includes(explicitButtonType(target))) { setStatus('For safety, form submit and reset buttons cannot be clicked.', 'warn'); return; }
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Clicked ✓';
        var doc = target.ownerDocument;
        var blockSubmit = function (submitEvent) { submitEvent.preventDefault(); submitEvent.stopImmediatePropagation(); };
        doc.addEventListener('submit', blockSubmit, true);
        try { target.click(); } finally { doc.removeEventListener('submit', blockSubmit, true); }
        highlightElement(target, label);
        setStatus('Activated “' + label + '”. Review the page to confirm what it did.');
      });
      return;
    }
    if (action.type === 'fill' && typeof action.value === 'string') {
      actionNote(parent, 'Fill “' + label + '” with: ' + action.value.slice(0, 300));
      actionButton(parent, 'Fill it in', function (event) {
        var target = resolveTarget(action);
        if (!target || !target.matches('textarea,input,select,[contenteditable=true],[contenteditable=""]')) { setStatus('That text field is no longer available, so I didn’t change it.', 'warn'); return; }
        replaceFieldValue(target, action.value);
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Filled ✓';
        setStatus('Filled “' + label + '”. I did not submit anything.');
      });
      return;
    }
    if (action.type === 'clear') {
      actionButton(parent, 'Clear “' + label + '”', function (event) {
        var target = resolveTarget(action);
        if (!target || !target.matches('textarea,input,[contenteditable=true],[contenteditable=""]')) { setStatus('That field is no longer available.', 'warn'); return; }
        replaceFieldValue(target, '');
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Cleared ✓';
        setStatus('Cleared “' + label + '”.');
      });
      return;
    }
    if (action.type === 'edit' && typeof action.value === 'string') {
      actionNote(parent, 'Change “' + label + '” to: ' + action.value.slice(0, 300));
      actionButton(parent, 'Change the text', function (event) {
        var target = resolveTarget(action);
        if (!target) { setStatus('That text is no longer on the page, so I didn’t change it.', 'warn'); return; }
        var previous = target.textContent;
        target.textContent = action.value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Changed ✓';
        setStatus('Changed the text of “' + label + '”.');
        actionButton(parent, 'Undo', function (undoEvent) {
          if (target.isConnected) {
            target.textContent = previous;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            setStatus('Restored the original text.');
          }
          undoEvent.currentTarget.disabled = true;
        }, true);
      });
      return;
    }
    if (action.type === 'toggle') {
      var wantChecked = action.value === 'checked';
      actionButton(parent, (wantChecked ? 'Check ' : 'Uncheck ') + '“' + label + '”', function (event) {
        var target = resolveTarget(action);
        if (!target) { setStatus('That control is no longer on the page.', 'warn'); return; }
        setCheckedState(target, action.value);
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = wantChecked ? 'Checked ✓' : 'Unchecked ✓';
        setStatus((wantChecked ? 'Checked' : 'Unchecked') + ' “' + label + '”.');
      });
      return;
    }
    if (action.type === 'select' && typeof action.value === 'string') {
      actionButton(parent, 'Choose “' + action.value.slice(0, 40) + '”', function (event) {
        var target = resolveTarget(action);
        if (!target || !target.matches('select')) { setStatus('That dropdown is no longer on the page.', 'warn'); return; }
        if (!pickOption(target, action.value)) { setStatus('That option is not in the list any more.', 'warn'); return; }
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Chosen ✓';
        setStatus('Set “' + label + '” to “' + action.value.slice(0, 40) + '”.');
      });
      return;
    }
    if (action.type === 'copy') {
      actionButton(parent, 'Copy “' + label + '”', function (event) {
        var button = event.currentTarget;
        var target = resolveTarget(action);
        if (!target) { setStatus('That element is no longer on the page.', 'warn'); return; }
        var text = target.matches('input,textarea') ? target.value : (target.innerText || target.textContent || '');
        copyText(text).then(function () {
          button.disabled = true;
          button.textContent = 'Copied ✓';
          setStatus('Copied the text of “' + label + '” to your clipboard.');
        }, function () { setStatus('This browser would not let me copy. Select the text and copy it manually.', 'warn'); });
      });
      return;
    }
    if (action.type === 'selectText') {
      actionButton(parent, 'Select the text of “' + label + '”', function (event) {
        var target = resolveTarget(action);
        if (!target || !selectElementText(target)) { setStatus('I could not select that text, so nothing was changed.', 'warn'); return; }
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Selected ✓';
        setStatus('Selected the text of “' + label + '”. Press Ctrl/Cmd+C to copy it.');
      });
      return;
    }
  }

  async function ask(text) {
    if (busy) return;
    if (imagePreparing) { setStatus('Please wait for the screenshot to finish preparing.', 'warn'); return; }
    if (!text.trim() && !selectedImage) return;
    var userText = text.trim().slice(0, 1200) || 'Please explain this screenshot and help me understand what to do.';
    var thread = activeConversation(); if (!thread) { startConversation(true); thread = activeConversation(); }
    setTitleFromMessage(thread, userText);
    var imageForRequest = selectedImage;
    var userEntry = { role: 'user', content: userText, imageData: imageForRequest };
    history.push(userEntry);
    saveConversations();
    if (log.querySelector('.silo-welcome')) log.textContent = '';
    var userBubble = bubble('user', userText);
    if (imageForRequest) { var preview = document.createElement('img'); preview.className = 'silo-user-image'; preview.src = imageForRequest; preview.alt = 'Screenshot you attached'; userBubble.appendChild(preview); }
    input.value = '';
    input.style.height = 'auto';
    clearAttachment();
    closeHistoryMenu();
    clearHighlight();
    clearHighlightsByName('find');
    setStatus('');
    setBusy(true);
    var pending = bubble('assistant', '');
    pending.className += ' silo-typing';
    pending.innerHTML = '<i></i><i></i><i></i>';
    pending.setAttribute('aria-label', 'SiloAI is thinking');
    try {
      var pageContext = currentPageContext();
      var pageExcerpt = visiblePageExcerpt();
      var controls = collectPageTargets();
      var modelHistory = history.slice(0, -1).slice(-4).map(function (entry) { return { role: entry.role, content: entry.content }; });
      var response = await fetch(api + '/chat/' + siteId, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: userText, image: imageForRequest || undefined, controls: controls, history: modelHistory, pagePath: pageContext.pagePath, pageTitle: pageContext.pageTitle, pageExcerpt: pageExcerpt }),
        credentials: 'omit',
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error && payload.error.message || 'SiloAI could not answer. Please try again.');
      pending.remove();
      var replyText = tidyReplyText(payload.reply);
      if (!replyText) replyText = 'I could not find an answer that time — please ask again.';
      var assistantEntry = { role: 'assistant', content: replyText, sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 3) : [] };
      history.push(assistantEntry);
      saveConversations();
      var reply = bubble('assistant', replyText);
      addSources(reply, payload.sources);
      applyAction(reply, payload.action, payload.confirmAction);
      if (!payload.action && /\b(highlight|click|press|tap|point|fill|type|change|edit|rewrite|button)\b/i.test(userText)) {
        setStatus(describeVisibleControls());
      }
      log.scrollTop = log.scrollHeight;
    } catch (error) {
      pending.remove();
      var failureText = error.message || 'SiloAI could not answer. Please try again.';
      history.push({ role: 'assistant', content: failureText });
      saveConversations();
      bubble('assistant', failureText, true);
    } finally { setBusy(false); input.focus({ preventScroll: true }); }
  }

  function panelSize() {
    var rect = panel.getBoundingClientRect();
    return {
      width: rect.width || Math.min(390, window.innerWidth - 24),
      height: rect.height || Math.min(580, window.innerHeight - 110),
    };
  }
  function clampPanel(left, top, size) {
    var maxLeft = Math.max(8, window.innerWidth - size.width - 8);
    var maxTop = Math.max(8, window.innerHeight - size.height - 8);
    return { left: Math.max(8, Math.min(maxLeft, left)), top: Math.max(8, Math.min(maxTop, top)) };
  }
  function setPanelPosition(left, top) {
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }
  function placePanel() {
    if (panel.hidden) return;
    var size = panelSize();
    var left;
    var top;
    if (panelPinned) {
      var rect = panel.getBoundingClientRect();
      left = panel.style.left ? parseFloat(panel.style.left) : rect.left;
      top = panel.style.top ? parseFloat(panel.style.top) : rect.top;
    } else {
      var launcher = host.getBoundingClientRect();
      left = launcher.left + launcher.width / 2 > window.innerWidth / 2 ? launcher.right - size.width : launcher.left;
      top = launcher.top - size.height - 12;
      if (top < 8) top = launcher.bottom + 12;
    }
    var point = clampPanel(left, top, size);
    setPanelPosition(point.left, point.top);
  }
  function clampLauncher(left, top) {
    return { left: Math.max(0, Math.min(window.innerWidth - host.offsetWidth, left)), top: Math.max(0, Math.min(window.innerHeight - host.offsetHeight, top)) };
  }

  function togglePanel() {
    if (panel.hidden) openPanel(); else closePanel(false);
  }
  /* ---- dragging ----------------------------------------------------------
     Pointer capture keeps events coming even when the cursor outruns the
     element, the `buttons` check ends a drag whose release we never saw
     (cursor released outside the window or over a frame), and every visual
     update is applied once per animation frame without layout reads. */
  var frameRequest = 0;
  function nextFrame(job) {
    if (frameRequest) return;
    frameRequest = window.requestAnimationFrame ? window.requestAnimationFrame(function () {
      frameRequest = 0;
      job();
    }) : window.setTimeout(function () { frameRequest = 0; job(); }, 16);
  }
  function capturePointer(el, pointerId) {
    try { el.setPointerCapture(pointerId); } catch (_) { /* older browsers */ }
  }
  function releasePointer(el, pointerId) {
    try { if (el.hasPointerCapture && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
  }
  function beginDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    suppressClickUntil = 0;
    var rect = host.getBoundingClientRect();
    dragState = {
      x: event.clientX, y: event.clientY, left: rect.left, top: rect.top,
      moved: false, pointerId: event.pointerId,
      panelSize: panel.hidden ? null : panelSize(),
      panelLeft: panel.style.left ? parseFloat(panel.style.left) : null,
      panelTop: panel.style.top ? parseFloat(panel.style.top) : null,
    };
    capturePointer(fab, event.pointerId);
  }
  function moveDrag(event) {
    if (!dragState) return;
    if (event.pointerId !== undefined && event.pointerId !== dragState.pointerId) return;
    if (event.buttons === 0) { endDrag(event); return; }
    var dx = event.clientX - dragState.x;
    var dy = event.clientY - dragState.y;
    if (!dragState.moved) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      dragState.moved = true;
      fab.classList.add('is-dragging');
    }
    var state = dragState;
    state.pending = {
      left: Math.max(0, Math.min(window.innerWidth - launcherSize, state.left + dx)),
      top: Math.max(0, Math.min(window.innerHeight - launcherSize, state.top + dy)),
    };
    nextFrame(function () {
      if (dragState !== state || !state.pending) return;
      applyLauncherPosition(state);
    });
  }
  function applyLauncherPosition(state) {
    var target = state.pending;
    state.pending = null;
    host.style.left = Math.round(target.left) + 'px';
    host.style.top = Math.round(target.top) + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    if (state.panelSize && !panelPinned && state.panelLeft !== null) {
      // Pure arithmetic: never measure layout in the middle of a drag.
      var side = state.left + launcherSize / 2 > window.innerWidth / 2 ? 'right' : 'left';
      var left = side === 'right' ? target.left + launcherSize - state.panelSize.width : target.left;
      var top = target.top - state.panelSize.height - 12;
      if (top < 8) top = target.top + launcherSize + 12;
      var point = clampPanel(left, top, state.panelSize);
      setPanelPosition(point.left, point.top);
    }
  }
  function endDrag(event) {
    if (!dragState) return;
    if (event && event.pointerId !== undefined && event.pointerId !== dragState.pointerId) return;
    var moved = dragState.moved;
    // A fast flick can outrun the last animation frame: settle the final
    // position synchronously so the launcher lands under the pointer.
    if (dragState.pending) applyLauncherPosition(dragState);
    releasePointer(fab, dragState.pointerId);
    dragState = null;
    fab.classList.remove('is-dragging');
    if (moved) { suppressClickUntil = Date.now() + 500; placePanel(); return; }
    var isRelease = !event || event.type === 'pointerup';
    if (isRelease) {
      togglePanel();
      suppressClickUntil = Date.now() + 500;
    }
  }
  function beginPanelDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest && event.target.closest('button')) return;
    event.preventDefault();
    var rect = panel.getBoundingClientRect();
    panelPinned = true;
    panelDrag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, pointerId: event.pointerId };
    panel.classList.add('is-dragging');
    setPanelPosition(rect.left, rect.top);
    capturePointer(head, event.pointerId);
  }
  function movePanelDrag(event) {
    if (!panelDrag) return;
    if (event.pointerId !== undefined && event.pointerId !== panelDrag.pointerId) return;
    if (event.buttons === 0) { endPanelDrag(event); return; }
    var state = panelDrag;
    var size = { width: state.width, height: state.height };
    state.pending = clampPanel(state.left + event.clientX - state.x, state.top + event.clientY - state.y, size);
    nextFrame(function () {
      if (panelDrag !== state || !state.pending) return;
      setPanelPosition(state.pending.left, state.pending.top);
      state.pending = null;
    });
  }
  function endPanelDrag(event) {
    if (!panelDrag) return;
    if (event && event.pointerId !== undefined && event.pointerId !== panelDrag.pointerId) return;
    if (panelDrag.pending) setPanelPosition(panelDrag.pending.left, panelDrag.pending.top);
    releasePointer(head, panelDrag.pointerId);
    panelDrag = null;
    panel.classList.remove('is-dragging');
  }
  function beginPanelResize(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    var rect = panel.getBoundingClientRect();
    panelPinned = true;
    panelResizeState = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top, pointerId: event.pointerId };
    panel.classList.add('is-resizing');
    setPanelPosition(rect.left, rect.top);
    capturePointer(panelResizeHandle, event.pointerId);
  }
  function movePanelResize(event) {
    if (!panelResizeState) return;
    if (event.pointerId !== undefined && event.pointerId !== panelResizeState.pointerId) return;
    if (event.buttons === 0) { endPanelResize(event); return; }
    var state = panelResizeState;
    // The panel does not move while resizing, so the limits are simple arithmetic.
    var maxWidth = Math.max(240, window.innerWidth - state.left - 8);
    var maxHeight = Math.max(240, window.innerHeight - state.top - 8);
    var minWidth = Math.min(300, maxWidth);
    var minHeight = Math.min(360, maxHeight);
    state.pending = {
      width: Math.round(Math.max(minWidth, Math.min(maxWidth, state.width + event.clientX - state.x))),
      height: Math.round(Math.max(minHeight, Math.min(maxHeight, state.height + event.clientY - state.y))),
    };
    nextFrame(function () {
      if (panelResizeState !== state || !state.pending) return;
      panel.style.width = state.pending.width + 'px';
      panel.style.height = state.pending.height + 'px';
      state.pending = null;
    });
  }
  function endPanelResize(event) {
    if (!panelResizeState) return;
    if (event && event.pointerId !== undefined && event.pointerId !== panelResizeState.pointerId) return;
    if (panelResizeState.pending) {
      panel.style.width = panelResizeState.pending.width + 'px';
      panel.style.height = panelResizeState.pending.height + 'px';
    }
    releasePointer(panelResizeHandle, panelResizeState.pointerId);
    panelResizeState = null;
    panel.classList.remove('is-resizing');
  }
  function endAllDrags() {
    if (dragState) endDrag({ type: 'pointercancel', pointerId: dragState.pointerId });
    if (panelDrag) endPanelDrag({ pointerId: panelDrag.pointerId });
    if (panelResizeState) endPanelResize({ pointerId: panelResizeState.pointerId });
  }
  function keyboardResize(event) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    var delta = event.shiftKey ? 32 : 16;
    var rect = panel.getBoundingClientRect();
    var maxWidth = Math.max(160, window.innerWidth - 16);
    var maxHeight = Math.max(200, window.innerHeight - 16);
    var minWidth = Math.min(300, maxWidth);
    var minHeight = Math.min(360, maxHeight);
    var width = Math.max(minWidth, Math.min(maxWidth, rect.width + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0)));
    var height = Math.max(minHeight, Math.min(maxHeight, rect.height + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0)));
    panelPinned = true;
    panel.style.width = Math.round(width) + 'px';
    panel.style.height = Math.round(height) + 'px';
    placePanel();
    setStatus('Chat window: ' + Math.round(width) + '×' + Math.round(height));
  }

  function openPanel() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    placePanel();
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
  }
  function closePanel(returnFocus) {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    closeHistoryMenu();
    clearHighlight();
    if (returnFocus) fab.focus();
  }

  fab.addEventListener('pointerdown', beginDrag);
  fab.addEventListener('lostpointercapture', function (event) { if (dragState) endDrag({ type: 'pointercancel', pointerId: event.pointerId }); });
  head.addEventListener('lostpointercapture', function (event) { if (panelDrag) endPanelDrag({ pointerId: event.pointerId }); });
  panelResizeHandle.addEventListener('lostpointercapture', function (event) { if (panelResizeState) endPanelResize({ pointerId: event.pointerId }); });
  fab.addEventListener('dragstart', function (event) { event.preventDefault(); });
  fab.addEventListener('click', function (event) {
    event.preventDefault();
    if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; return; }
    togglePanel();
  });
  head.addEventListener('pointerdown', beginPanelDrag);
  panelResizeHandle.addEventListener('pointerdown', beginPanelResize);
  panelResizeHandle.addEventListener('keydown', keyboardResize);
  /* Pointer moves are tracked on the window so a fast drag that leaves the
     launcher, header, or corner grip keeps following the pointer. */
  window.addEventListener('pointermove', function (event) { moveDrag(event); movePanelDrag(event); movePanelResize(event); }, true);
  window.addEventListener('pointerup', function (event) { endDrag(event); endPanelDrag(event); endPanelResize(event); }, true);
  window.addEventListener('pointercancel', function (event) { endDrag(event); endPanelDrag(event); endPanelResize(event); }, true);
  /* A release we never saw (outside the window, over a frame, alt-tab) must end
     the drag instead of leaving the widget glued to the cursor. */
  window.addEventListener('blur', endAllDrags);
  document.addEventListener('pointerleave', function (event) { if (event.buttons === 0) endAllDrags(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) endAllDrags(); });
  shadow.querySelector('[data-close]').addEventListener('click', function () { closePanel(true); });
  shadow.querySelector('[data-new]').addEventListener('click', function () { startConversation(false); });
  historyButton.addEventListener('click', function (event) {
    event.stopPropagation();
    renderConversationMenu();
    menu.hidden = !menu.hidden;
    historyButton.setAttribute('aria-expanded', String(!menu.hidden));
  });
  attachButton.addEventListener('click', function () { imageFile.click(); });
  shadow.querySelector('[data-remove-image]').addEventListener('click', function () { clearAttachment(); input.focus(); });
  shadow.addEventListener('pointerdown', function (event) { if (!menu.hidden && !menu.contains(event.target) && !historyButton.contains(event.target)) closeHistoryMenu(); });
  shadow.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.key === 'Escape') { if (!menu.hidden) closeHistoryMenu(); else closePanel(true); }
  });
  shadow.addEventListener('keyup', function (event) { event.stopPropagation(); });
  shadow.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
  shadow.addEventListener('click', function (event) { event.stopPropagation(); });
  shadow.addEventListener('wheel', function (event) { event.stopPropagation(); }, { passive: true });

  imageFile.addEventListener('change', async function () {
    var file = imageFile.files && imageFile.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000) {
      setStatus('Choose a JPEG, PNG, or WebP screenshot under 15 MB.', 'warn');
      imageFile.value = '';
      return;
    }
    clearAttachment();
    imagePreparing = true;
    send.disabled = true;
    attachButton.disabled = true;
    attachButton.setAttribute('data-active', 'true');
    setStatus('Preparing screenshot…');
    var bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
      var scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      var context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      var data = canvas.toDataURL('image/jpeg', 0.72);
      for (var quality = 0.62; data.length > 300_000 && quality >= 0.38; quality -= 0.08) data = canvas.toDataURL('image/jpeg', quality);
      if (data.length > 300_000) { setStatus('That screenshot is too large after compression. Try a smaller crop.', 'warn'); imageFile.value = ''; return; }
      selectedImage = data;
      selectedImageName = String(file.name || 'Screenshot attached').slice(0, 60);
      imageFile.value = '';
      setAttachmentPreview();
      setStatus('');
    } catch (_) { setStatus('This browser could not prepare that screenshot. Try a JPEG or PNG image.', 'warn'); }
    finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      imagePreparing = false;
      send.disabled = busy;
      attachButton.disabled = busy;
      attachButton.setAttribute('data-active', selectedImage ? 'true' : 'false');
    }
  });

  var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Speech) {
    micButton.hidden = false;
    var markListening = function () {
      listening = true;
      micButton.setAttribute('data-listening', 'true');
      micButton.setAttribute('aria-pressed', 'true');
      setStatus('Listening… speak now.');
    };
    micButton.addEventListener('click', function () {
      if (listening && recognition) { try { recognition.stop(); } catch (_) { /* ignore */ } return; }
      try {
        recognition = new Speech();
        recognition.lang = document.documentElement.lang || 'en';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = markListening;
        recognition.onresult = function (event) {
          var spoken = event.results[0][0].transcript;
          input.value = (input.value ? input.value.trim() + ' ' : '') + spoken;
          input.dispatchEvent(new Event('input'));
          input.focus();
        };
        recognition.onerror = function (event) {
          setStatus(event.error === 'not-allowed' ? 'Allow microphone access in your browser to use voice typing.' : 'Voice typing is unavailable right now.', 'warn');
        };
        recognition.onend = function () {
          listening = false;
          recognition = null;
          micButton.setAttribute('data-listening', 'false');
          micButton.setAttribute('aria-pressed', 'false');
          if (statusText.textContent === 'Listening… speak now.') setStatus('');
        };
        markListening();
        recognition.start();
      } catch (_) {
        listening = false;
        micButton.setAttribute('data-listening', 'false');
        setStatus('Voice typing is unavailable right now.', 'warn');
      }
    });
  }

  form.addEventListener('submit', function (event) { event.preventDefault(); ask(input.value.slice(0, 1200)); });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer(); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(112, input.scrollHeight) + 'px';
    if (statusBox.getAttribute('data-tone') === 'warn' && !imagePreparing) setStatus('');
  });
  window.addEventListener('resize', function () {
    var rect = host.getBoundingClientRect();
    var point = clampLauncher(rect.left, rect.top);
    host.style.left = point.left + 'px';
    host.style.top = point.top + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    placePanel();
  });
  window.addEventListener('blur', function () { clearHighlight(); });
  /* Small public hook: open devtools and run SiloAI.inspect() to see exactly
     which controls the widget can reach on the current page. */
  window.SiloAI = window.SiloAI || {};
  window.SiloAI.version = BUILD_VERSION;
  window.SiloAI.inspect = function () {
    var controls = collectPageTargets();
    var summary = { pagePath: currentPageContext().pagePath, documents: pageDocuments().length, controls: controls };
    try { console.info('[SiloAI]', summary); } catch (_) { /* ignore */ }
    return summary;
  };
  window.SiloAI.highlight = function (selector) {
    var el = null;
    try { el = document.querySelector(selector); } catch (_) { el = null; }
    if (!el) return false;
    highlightElement(el, el.textContent || el.tagName);
    return true;
  };

  renderHistory();
  renderConversationMenu();
  setAttachmentPreview();
})();
