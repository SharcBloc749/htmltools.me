/* SiloAI website assistant embed. Install with:
   <script async src="https://htmltools.me/SiloAI/widget.js?v=4" data-site-id="YOUR_SITE_ID"></script>
*/
(function () {
  'use strict';
  var BUILD_VERSION = '4';
  if (window.__siloaiLoadedVersion === BUILD_VERSION) return;
  var previousWidget = document.getElementById('siloai-widget-host');
  if (previousWidget) previousWidget.remove();
  window.__siloaiLoaded = true;
  window.__siloaiLoadedVersion = BUILD_VERSION;
  var script = document.currentScript;
  var siteId = script && script.getAttribute('data-site-id');
  if (!/^[a-f0-9]{24}$/.test(siteId || '')) return;
  var api = 'https://siloai.bozhetarnikmatthew.workers.dev';
  var storageKey = 'siloai.conversations.' + siteId;
  var conversations = [];
  var activeId = '';
  var history = [];
  var busy = false;
  var selectedImage = '';
  var pendingControls = new Map();
  var resizePanelState = null;
  var dragState = null;
  var suppressNextClick = false;
  var defaultLauncherSize = window.innerWidth <= 520 ? 58 : 64;
  var launcherSize = defaultLauncherSize;

  function id() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function loadConversations() {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      conversations = Array.isArray(saved.conversations) ? saved.conversations.slice(0, 20).map(function (item) {
        var messages = Array.isArray(item.messages) ? item.messages.slice(-40).filter(function (entry) {
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
  document.body.appendChild(host);
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial}*{box-sizing:border-box}button,textarea,input{font:inherit}.silo-fab{position:absolute;inset:0;width:100%;height:100%;padding:0;overflow:hidden;border-radius:14px;border:1px solid #999;background:#090909;box-shadow:0 14px 38px #0008;cursor:grab;display:grid;place-items:center;touch-action:none}.silo-fab:active{cursor:grabbing}.silo-fab img{display:block;width:100%;height:100%;border-radius:12px;object-fit:cover;transform:none}.silo-launcher-resize{position:absolute;right:-7px;bottom:-7px;width:22px;height:22px;border:1px solid #aaa;border-radius:7px;background:#191919;color:#eee;font-size:13px;line-height:1;cursor:nwse-resize;touch-action:none;z-index:2}.silo-panel{position:fixed;width:min(390px,calc(100vw - 24px));height:min(580px,calc(100dvh - 110px));min-width:min(280px,calc(100vw - 16px));min-height:min(340px,calc(100dvh - 16px));max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);background:#0b0b0b;color:#f4f4f4;border:1px solid #333;border-radius:19px;box-shadow:0 24px 80px #000b;display:flex;flex-direction:column;overflow:hidden;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}.silo-panel[hidden]{display:none}.silo-head{height:62px;min-height:62px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #272727;background:#111}.silo-head img{width:36px;height:36px;border-radius:8px;object-fit:cover;border:1px solid #777;background:#090909}.silo-brand{font-weight:650;letter-spacing:.02em}.silo-status{font-size:10px;line-height:1.15;color:#a6a6a6;overflow-wrap:anywhere}.silo-head>div:nth-child(2){min-width:0}.silo-grow{flex:1}.silo-icon{width:32px;height:32px;flex:none;border-radius:9px;color:#ddd;background:transparent;border:0;cursor:pointer;font-size:18px}.silo-icon:hover,.silo-icon[aria-expanded=true]{background:#232323}.silo-messages{overflow:auto;flex:1;min-height:0;padding:15px 13px 22px;display:flex;flex-direction:column;gap:11px}.silo-welcome{padding:16px 14px;border:1px solid #313131;border-radius:14px;background:linear-gradient(140deg,#151515,#111);color:#c6c6c6}.silo-welcome b{display:block;color:#f4f4f4;font-size:16px;margin-bottom:5px}.silo-msg{max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;border-radius:13px}.silo-user{align-self:flex-end;background:#262626;color:#f3f3f3;border:1px solid #3c3c3c}.silo-assistant{align-self:flex-start;background:#141414;border:1px solid #272727;color:#e4e4e4}.silo-error{color:#eee}.silo-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.silo-source{display:inline-flex;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #353535;background:#181818;color:#bdbdbd;border-radius:999px;padding:5px 9px;font-size:11px;text-decoration:none}.silo-action{margin-top:8px;border:1px solid #bdbdbd;background:#e5e5e5;color:#111;border-radius:9px;padding:7px 10px;cursor:pointer;font-weight:600;font-size:12px}.silo-action:hover{background:#fff}.silo-preview-image{display:block;max-width:min(230px,100%);max-height:180px;object-fit:contain;border:1px solid #555;border-radius:8px;margin-top:8px}.silo-compose{position:relative;flex:none;padding:9px 10px 10px;border-top:1px solid #272727;background:#111}.silo-row{display:flex;align-items:flex-end;gap:6px;background:#0c0c0c;border:1px solid #343434;border-radius:13px;padding:6px}.silo-row:focus-within{border-color:#858585}.silo-input{resize:none;min-height:38px;max-height:100px;flex:1;min-width:0;border:0;outline:0;background:transparent;color:#f4f4f4;padding:8px 5px;font-size:14px;line-height:1.4}.silo-input::placeholder{color:#888}.silo-send,.silo-tool{width:35px;height:35px;flex:none;border:0;border-radius:9px;background:#242424;color:#e8e8e8;cursor:pointer;font-size:16px}.silo-tool{width:auto;min-width:35px;padding:0 6px;font-size:10px;font-weight:650}.silo-send{background:#e5e5e5;color:#111111;font-size:18px}.silo-send:disabled,.silo-tool:disabled{opacity:.45;cursor:default}.silo-tool[hidden]{display:none}.silo-toolbar{display:flex;gap:6px;margin-top:5px}.silo-attachment{display:flex;align-items:center;gap:8px;padding:5px 7px;margin-bottom:6px;border:1px solid #333;border-radius:9px;color:#ccc;font-size:11px}.silo-attachment[hidden]{display:none}.silo-attachment img{width:40px;height:32px;object-fit:cover;border-radius:4px}.silo-attachment button{margin-left:auto;border:0;background:transparent;color:#ddd;font-size:17px;cursor:pointer}.silo-foot{font-size:10px;color:#888;margin:6px 3px 0;line-height:1.4}.silo-foot a{display:block;color:#ddd;text-decoration:underline;text-underline-offset:2px;margin-bottom:5px}.silo-context-toggle{display:flex;align-items:center;gap:6px;margin:5px 3px;color:#bbb;font-size:10px}.silo-context-toggle input{accent-color:#ddd}.silo-typing{color:#b1b1b1;font-size:12px}.silo-panel[data-busy=true] .silo-send{opacity:.5}.silo-menu{position:absolute;top:67px;right:10px;z-index:4;width:min(260px,calc(100% - 20px));max-height:min(300px,50%);overflow:auto;background:#171717;border:1px solid #444;border-radius:11px;padding:6px;box-shadow:0 12px 40px #000b}.silo-menu[hidden]{display:none}.silo-menu button{display:block;width:100%;padding:9px 10px;text-align:left;border:0;border-radius:7px;background:transparent;color:#eee;cursor:pointer;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.silo-menu button:hover,.silo-menu button[aria-current=true]{background:#2b2b2b}.silo-menu small{display:block;color:#999;font-size:10px;margin-top:2px}.silo-panel-resize{position:absolute;right:0;bottom:0;width:22px;height:22px;border:0;background:linear-gradient(135deg,transparent 47%,#777 49%,#777 54%,transparent 56%,transparent 65%,#999 67%,#999 72%,transparent 74%);cursor:nwse-resize;touch-action:none}.silo-panel-resize:focus-visible,.silo-launcher-resize:focus-visible{outline:2px solid #eee;outline-offset:2px}.silo-hidden-file{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%);border:0}.silo-mic-status{color:#bbb;font-size:10px;margin:4px 3px}.silo-mic-status:empty{display:none}.silo-user-image{display:block;max-width:220px;max-height:160px;object-fit:contain;border-radius:8px;margin-top:7px}.silo-history-empty{color:#aaa;padding:10px;font-size:12px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}',
    '</style>',
    '<button class="silo-fab" type="button" aria-label="Open SiloAI" title="Drag to move; click to open" aria-expanded="false"><img src="https://htmltools.me/SiloAI/brandmark-mono.png?v=3" alt=""></button>',
    '<button class="silo-launcher-resize" type="button" data-resize-launcher aria-label="Resize SiloAI button" title="Drag to resize the SiloAI button">◢</button>',
    '<section class="silo-panel" role="dialog" aria-label="Chat with SiloAI" aria-modal="false" hidden>',
    '  <header class="silo-head"><img src="https://htmltools.me/SiloAI/brandmark-mono.png?v=3" alt=""><div><div class="silo-brand">SiloAI</div><div class="silo-status">Website Assistant - Powered by HTMLTools.me</div></div><span class="silo-grow"></span><button class="silo-icon" type="button" data-history aria-label="Previous conversations" title="Previous conversations">▤</button><button class="silo-icon" type="button" data-new aria-label="New conversation" title="New conversation">＋</button><button class="silo-icon" type="button" data-close aria-label="Close SiloAI">×</button></header>',
    '  <div class="silo-menu" data-conversation-menu hidden></div>',
    '  <div class="silo-messages" aria-live="polite"></div>',
    '  <form class="silo-compose"><div class="silo-attachment" data-attachment hidden><img data-attachment-image alt="Screenshot preview"><span>Screenshot attached</span><button type="button" data-remove-image aria-label="Remove screenshot">×</button></div><div class="silo-row"><textarea class="silo-input" rows="1" maxlength="1200" aria-label="Message SiloAI" placeholder="Ask about this website…"></textarea><button class="silo-tool" type="button" data-attach aria-label="Attach screenshot" title="Attach screenshot">Image</button><button class="silo-tool" type="button" data-voice aria-label="Dictate with your voice" title="Dictate with your voice" hidden>Mic</button><button class="silo-send" type="submit" aria-label="Send message">↑</button></div><input class="silo-hidden-file" data-image-file type="file" accept="image/png,image/jpeg,image/webp"><label class="silo-context-toggle"><input data-include-editor type="checkbox"><span>Include current editor text (up to 3 KB)</span></label><div class="silo-mic-status" data-mic-status aria-live="polite"></div><div class="silo-foot"><a href="https://htmltools.me/SiloAI/" target="_blank" rel="noopener noreferrer">Set up SiloAI on your site for free at htmltools.me/SiloAI!</a><span>Up to 2.5 KB of visible page text is sent to SiloAI for page-specific answers. Editor text is sent only when checked. Attached screenshots go to Cloudflare AI.</span></div></form>',
    '  <button class="silo-panel-resize" type="button" data-resize-panel aria-label="Resize chat window" title="Drag to resize chat window"></button>',
    '</section>',
  ].join('');

  var fab = shadow.querySelector('.silo-fab');
  var panel = shadow.querySelector('.silo-panel');
  var log = shadow.querySelector('.silo-messages');
  var form = shadow.querySelector('.silo-compose');
  var input = shadow.querySelector('.silo-input');
  var send = shadow.querySelector('.silo-send');
  var menu = shadow.querySelector('[data-conversation-menu]');
  var imageFile = shadow.querySelector('[data-image-file]');
  var attachment = shadow.querySelector('[data-attachment]');
  var micButton = shadow.querySelector('[data-voice]');
  var micStatus = shadow.querySelector('[data-mic-status]');
  var includeEditor = shadow.querySelector('[data-include-editor]');

  function saveConversations() {
    var active = activeConversation();
    if (active) { active.messages = history.slice(-40); active.updatedAt = Date.now(); }
    conversations = conversations.sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 20);
    try { localStorage.setItem(storageKey, JSON.stringify({ activeId: activeId, conversations: conversations })); }
    catch (_) {
      conversations = conversations.slice(0, 20).map(function (thread) {
        thread.messages = thread.messages.map(function (entry) { return Object.assign({}, entry, { imageData: '' }); });
        return thread;
      });
      var activeAfterPrune = activeConversation();
      if (activeAfterPrune) history = activeAfterPrune.messages;
      try { localStorage.setItem(storageKey, JSON.stringify({ activeId: activeId, conversations: conversations })); } catch (_) { /* storage may be disabled or full */ }
    }
  }
  function activeConversation() { return conversations.find(function (item) { return item.id === activeId; }) || null; }
  function startConversation(preserveAttachment) {
    if (busy) return;
    menu.hidden = true;
    var thread = { id: id(), title: 'New conversation', updatedAt: Date.now(), messages: [] };
    conversations.unshift(thread);
    conversations = conversations.slice(0, 20);
    activeId = thread.id;
    history = thread.messages;
    if (!preserveAttachment) { selectedImage = ''; updateAttachmentPreview(); }
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
    selectedImage = '';
    updateAttachmentPreview();
    saveConversations();
    renderHistory();
    menu.hidden = true;
    shadow.querySelector('[data-history]').setAttribute('aria-expanded', 'false');
  }
  function setTitleFromMessage(thread, text) {
    if (thread && thread.title === 'New conversation') thread.title = (text || 'Screenshot conversation').replace(/\s+/g, ' ').slice(0, 54);
  }
  function updateAttachmentPreview() {
    var img = shadow.querySelector('[data-attachment-image]');
    if (selectedImage) { img.src = selectedImage; attachment.hidden = false; }
    else { img.removeAttribute('src'); attachment.hidden = true; }
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
  function visiblePageExcerpt() {
    var doc = currentPageDocument(); var root = doc.querySelector('main,[role=main],article') || doc.body;
    if (!root) return '';
    var walker = doc.createTreeWalker(root, 4); var pieces = []; var total = 0; var visited = 0;
    var excluded = 'script,style,noscript,template,nav,footer,button,input,textarea,select,option,[contenteditable=true],[hidden],[aria-hidden=true]';
    while (walker.nextNode() && total < 2_500 && visited++ < 1_500) {
      var node = walker.currentNode; var el = node.parentElement;
      if (!el || host.contains(el) || el.closest(excluded)) continue;
      var style = (doc.defaultView || window).getComputedStyle(el); var rect = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      var text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      var remaining = 2_500 - total; text = text.slice(0, remaining);
      pieces.push(text); total += text.length + 1;
    }
    return pieces.join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, 2_500);
  }
  function currentEditorText() {
    var doc = currentPageDocument();
    var selector = 'textarea,.CodeMirror-code,.cm-content,.monaco-editor .view-lines,[contenteditable=true],[role=textbox]';
    var candidates = Array.prototype.slice.call(doc.querySelectorAll(selector));
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (host.contains(el) || el.disabled || el.readOnly) continue;
      var identity = [el.id, el.className, el.name, el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' ');
      var knownEditor = el.matches('.CodeMirror-code,.cm-content,.monaco-editor .view-lines') || /code|html|javascript|editor|source|script|markup|stylesheet|json|xml/i.test(identity);
      if (!knownEditor) continue;
      var rect = el.getBoundingClientRect(); var style = (doc.defaultView || window).getComputedStyle(el);
      if (rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden') continue;
      var value = el.matches('textarea') ? el.value : (el.innerText || el.textContent || '');
      value = String(value || '').trim();
      if (value) return value.slice(0, 3_000);
    }
    return '';
  }
  function bubble(role, text, isError) {
    var el = document.createElement('div');
    el.className = 'silo-msg ' + (role === 'user' ? 'silo-user' : 'silo-assistant') + (isError ? ' silo-error' : '');
    el.textContent = text;
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
  function renderHistory() {
    log.textContent = '';
    if (!history.length) {
      var welcome = document.createElement('div'); welcome.className = 'silo-welcome';
      var bold = document.createElement('b'); bold.textContent = 'Hi, I’m SiloAI.'; welcome.appendChild(bold);
      welcome.appendChild(document.createTextNode('Ask about this website, its tools, or attach a screenshot for help.'));
      log.appendChild(welcome); return;
    }
    history.forEach(function (entry) {
      var el = bubble(entry.role, entry.content || '');
      if (entry.imageData) { var img = document.createElement('img'); img.className = 'silo-user-image'; img.src = entry.imageData; img.alt = 'Screenshot you attached'; el.appendChild(img); }
      if (entry.role === 'assistant') addSources(el, entry.sources);
    });
  }
  function setBusy(value) {
    busy = value; panel.dataset.busy = String(value); input.disabled = value; send.disabled = value;
    shadow.querySelector('[data-attach]').disabled = value;
    shadow.querySelector('[data-new]').disabled = value;
    shadow.querySelector('[data-history]').disabled = value;
    micButton.disabled = value; includeEditor.disabled = value;
  }
  function pageControls() {
    var doc = document;
    try { if (window.top.document && window.top.location.origin === location.origin) doc = window.top.document; } catch (_) { /* cross-origin top */ }
    doc.querySelectorAll('[data-siloai-control-id]').forEach(function (el) { el.removeAttribute('data-siloai-control-id'); });
    var candidates = Array.prototype.slice.call(doc.querySelectorAll('button:not([type=submit]):not([type=reset]),[role=button]:not(a),input,textarea,h1,h2,h3,h4,p,li,pre,code,[role=heading]'));
    var controls = [];
    candidates.forEach(function (el) {
      if (controls.length >= 40 || host.contains(el) || el.disabled || el.readOnly) return;
      var rect = el.getBoundingClientRect(); var style = doc.defaultView.getComputedStyle(el);
      if (rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      var kind; var inputType = '';
      if (el.matches('button,[role=button]')) {
        if (el.tagName === 'BUTTON' && ['submit', 'reset'].includes(String(el.type || '').toLowerCase())) return;
        kind = 'button';
      } else if (el.matches('h1,h2,h3,h4,p,li,pre,code,[role=heading]')) {
        kind = 'text';
      } else {
        inputType = (el.getAttribute('type') || 'text').toLowerCase();
        if (!(el.tagName === 'TEXTAREA' || ['text', 'search', 'email', 'url', 'tel', 'number'].includes(inputType))) return;
        if (/password|secret|token|one-time|otp|cc-|credit.?card|ssn/i.test([el.autocomplete, el.name, el.id].join(' '))) return;
        kind = 'field';
      }
      var labels = el.labels ? Array.prototype.map.call(el.labels, function (label) { return label.innerText || label.textContent || ''; }).join(' ') : '';
      var label = (el.getAttribute('aria-label') || el.innerText || el.textContent || labels || el.getAttribute('placeholder') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (!label) return;
      var controlId = 'siloctl' + (controls.length + 1);
      el.setAttribute('data-siloai-control-id', controlId);
      controls.push({ id: controlId, kind: kind, label: label, inputType: inputType });
    });
    return controls;
  }
  function needsPageControls(text) { return /\b(click|press|tap|clear|reset|highlight|point to|fill|type into|enter into|select|button|field)\b/i.test(text); }
  function findTarget(action) {
    if (!action || !/^[a-z0-9_-]{1,48}$/i.test(action.target || '')) return null;
    var target = document.querySelector('[data-siloai-control-id="' + action.target + '"]');
    if (!target) { try { target = window.top.document.querySelector('[data-siloai-control-id="' + action.target + '"]'); } catch (_) { return null; } }
    if (!target || !target.isConnected || host.contains(target) || target.disabled) return null;
    return target;
  }
  function actionButton(parent, text, onClick) {
    var button = document.createElement('button'); button.className = 'silo-action'; button.type = 'button'; button.textContent = text;
    button.addEventListener('click', onClick); parent.appendChild(button); return button;
  }
  function applyAction(parent, action, confirmAction) {
    if (!action || typeof action.type !== 'string') return;
    if (action.type === 'navigate' && typeof action.path === 'string') {
      var destination;
      try { destination = new URL(action.path, location.origin); } catch (_) { return; }
      if (destination.origin !== location.origin || destination.pathname !== action.path) return;
      if (confirmAction === false) { location.assign(destination.href); return; }
      actionButton(parent, 'Go to ' + (action.title || action.path), function () { location.assign(destination.href); });
      return;
    }
    if (!['highlight', 'click', 'fill'].includes(action.type)) return;
    var label = String(action.label || 'page control').slice(0, 100);
    if (action.type === 'highlight') {
      actionButton(parent, 'Highlight “' + label + '”', function () {
        var target = findTarget(action); if (!target) { bubble('assistant', 'That control is no longer on the page. Ask me again to locate it.'); return; }
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        var oldOutline = target.style.outline; var oldOffset = target.style.outlineOffset; var oldTransition = target.style.transition;
        target.style.transition = 'outline-color .2s, box-shadow .2s'; target.style.outline = '3px solid #f0f0f0'; target.style.outlineOffset = '3px'; target.style.boxShadow = '0 0 0 6px #7778';
        window.setTimeout(function () { if (target.isConnected) { target.style.outline = oldOutline; target.style.outlineOffset = oldOffset; target.style.boxShadow = ''; target.style.transition = oldTransition; } }, 4500);
      });
      return;
    }
    if (action.type === 'click') {
      actionButton(parent, 'Confirm click: “' + label + '”', function () {
        var target = findTarget(action);
        if (!target || !(target.matches('button:not([type=submit]):not([type=reset]),[role=button]:not(a)'))) { bubble('assistant', 'That button is no longer available, so I did not click it.'); return; }
        if (target.tagName === 'BUTTON' && ['submit', 'reset'].includes(String(target.type || '').toLowerCase())) { bubble('assistant', 'For safety, form submit and reset buttons cannot be clicked.'); return; }
        var doc = target.ownerDocument;
        var blockSubmit = function (submitEvent) { submitEvent.preventDefault(); submitEvent.stopImmediatePropagation(); };
        doc.addEventListener('submit', blockSubmit, true);
        try { target.click(); } finally { doc.removeEventListener('submit', blockSubmit, true); }
        bubble('assistant', 'Activated “' + label + '”. Review the page to confirm what it did.');
      });
      return;
    }
    if (action.type === 'fill' && typeof action.value === 'string') {
      var preview = document.createElement('div'); preview.className = 'silo-msg silo-assistant'; preview.textContent = 'Fill “' + label + '” with: ' + action.value.slice(0, 500); parent.appendChild(preview);
      actionButton(parent, 'Confirm fill', function () {
        var target = findTarget(action); if (!target || !(target.matches('textarea,input[type=text],input[type=search],input[type=email],input[type=url],input[type=tel],input[type=number]'))) { bubble('assistant', 'That text field is no longer available, so I did not change it.'); return; }
        var prototype = Object.getPrototypeOf(target); var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(target, action.value); else target.value = action.value;
        target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); target.focus();
        bubble('assistant', 'Filled “' + label + '”. I did not submit the form.');
      });
    }
  }
  async function ask(text) {
    if (busy || (!text.trim() && !selectedImage)) return;
    var userText = text.trim().slice(0, 1200) || 'Please explain this screenshot and help me understand what to do.';
    var thread = activeConversation(); if (!thread) { startConversation(true); thread = activeConversation(); }
    setTitleFromMessage(thread, userText);
    var imageForRequest = selectedImage;
    var userEntry = { role: 'user', content: userText, imageData: imageForRequest };
    history.push(userEntry); history = history.slice(-40); saveConversations();
    var userBubble = bubble('user', userText);
    if (imageForRequest) { var preview = document.createElement('img'); preview.className = 'silo-user-image'; preview.src = imageForRequest; preview.alt = 'Screenshot you attached'; userBubble.appendChild(preview); }
    input.value = ''; input.style.height = 'auto'; selectedImage = ''; imageFile.value = ''; updateAttachmentPreview();
    setBusy(true);
    var pending = bubble('assistant', 'SiloAI is thinking…'); pending.className += ' silo-typing';
    try {
      var pageContext = currentPageContext();
      var pageExcerpt = visiblePageExcerpt();
      var editorText = includeEditor.checked ? currentEditorText() : '';
      var controls = needsPageControls(userText) ? pageControls() : [];
      var modelHistory = history.slice(0, -1).slice(-4).map(function (entry) { return { role: entry.role, content: entry.content }; });
      var response = await fetch(api + '/chat/' + siteId, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: userText, image: imageForRequest || undefined, controls: controls, history: modelHistory, pagePath: pageContext.pagePath, pageTitle: pageContext.pageTitle, pageExcerpt: pageExcerpt, editorText: editorText || undefined }),
        credentials: 'omit',
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error && payload.error.message || 'SiloAI could not answer. Please try again.');
      pending.remove();
      var replyText = payload.reply || 'I could not find an answer that time.';
      var assistantEntry = { role: 'assistant', content: replyText, sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 3) : [] };
      history.push(assistantEntry); history = history.slice(-40); saveConversations();
      var reply = bubble('assistant', replyText); addSources(reply, payload.sources); applyAction(reply, payload.action, payload.confirmAction);
    } catch (error) {
      pending.remove();
      var failureText = error.message || 'SiloAI could not answer. Please try again.';
      history.push({ role: 'assistant', content: failureText }); history = history.slice(-40); saveConversations();
      bubble('assistant', failureText, true);
    } finally { setBusy(false); input.focus(); }
  }
  function placePanel() {
    if (panel.hidden) return;
    var rect = host.getBoundingClientRect(); var panelRect = panel.getBoundingClientRect();
    var width = panelRect.width || Math.min(390, window.innerWidth - 24); var height = panelRect.height || Math.min(580, window.innerHeight - 110);
    var left = rect.left + rect.width / 2 > window.innerWidth / 2 ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    var top = rect.top - height - 12;
    if (top < 8) top = rect.bottom + 12;
    top = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    panel.style.left = Math.round(left) + 'px'; panel.style.top = Math.round(top) + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }
  function clampLauncher(left, top) {
    return { left: Math.max(0, Math.min(window.innerWidth - host.offsetWidth, left)), top: Math.max(0, Math.min(window.innerHeight - host.offsetHeight, top)) };
  }
  function beginDrag(event) {
    if (event.button !== 0 || event.target.closest('[data-resize-launcher]')) return;
    var rect = host.getBoundingClientRect();
    dragState = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, pointerId: event.pointerId };
    fab.setPointerCapture(event.pointerId);
  }
  function moveDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    var dx = event.clientX - dragState.x; var dy = event.clientY - dragState.y;
    if (!dragState.moved && Math.hypot(dx, dy) < 5) return;
    dragState.moved = true; suppressNextClick = true;
    var point = clampLauncher(dragState.left + dx, dragState.top + dy);
    host.style.left = point.left + 'px'; host.style.top = point.top + 'px'; host.style.right = 'auto'; host.style.bottom = 'auto';
    placePanel();
  }
  function endDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.moved) window.setTimeout(function () { suppressNextClick = false; }, 0);
    dragState = null;
  }
  function resizeStart(event, target) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    var panelResize = target.hasAttribute('data-resize-panel'); var rect = panelResize ? panel.getBoundingClientRect() : host.getBoundingClientRect();
    resizePanelState = { target: target, panel: panelResize, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, pointerId: event.pointerId };
    target.setPointerCapture(event.pointerId);
  }
  function resizeMove(event) {
    if (!resizePanelState || resizePanelState.pointerId !== event.pointerId) return;
    var maxW = Math.max(220, window.innerWidth - 16); var maxH = Math.max(260, window.innerHeight - 16);
    if (resizePanelState.panel) {
      var width = Math.max(Math.min(280, maxW), Math.min(maxW, resizePanelState.width + event.clientX - resizePanelState.x));
      var height = Math.max(Math.min(340, maxH), Math.min(maxH, resizePanelState.height + event.clientY - resizePanelState.y));
      panel.style.width = Math.round(width) + 'px'; panel.style.height = Math.round(height) + 'px'; placePanel();
    } else {
      launcherSize = Math.max(44, Math.min(140, resizePanelState.width + event.clientX - resizePanelState.x));
      host.style.width = launcherSize + 'px'; host.style.height = launcherSize + 'px'; fab.style.width = launcherSize + 'px'; fab.style.height = launcherSize + 'px';
      var rect = host.getBoundingClientRect(); var point = clampLauncher(rect.left, rect.top);
      host.style.left = point.left + 'px'; host.style.top = point.top + 'px'; host.style.right = 'auto'; host.style.bottom = 'auto'; placePanel();
    }
  }
  function resizeEnd(event) { if (resizePanelState && resizePanelState.pointerId === event.pointerId) resizePanelState = null; }
  function keyboardResize(event, target) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); var delta = event.shiftKey ? 32 : 16;
    if (target.hasAttribute('data-resize-panel')) {
      var rect = panel.getBoundingClientRect(); panel.style.width = Math.max(280, Math.min(window.innerWidth - 16, rect.width + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0))) + 'px';
      panel.style.height = Math.max(340, Math.min(window.innerHeight - 16, rect.height + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0))) + 'px'; placePanel();
    } else {
      launcherSize = Math.max(44, Math.min(140, launcherSize + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? delta : -delta)));
      host.style.width = launcherSize + 'px'; host.style.height = launcherSize + 'px'; fab.style.width = launcherSize + 'px'; fab.style.height = launcherSize + 'px';
    }
  }

  fab.addEventListener('pointerdown', beginDrag);
  fab.addEventListener('pointermove', moveDrag); fab.addEventListener('pointerup', endDrag); fab.addEventListener('pointercancel', endDrag);
  shadow.querySelector('[data-resize-launcher]').addEventListener('pointerdown', function (event) { resizeStart(event, event.currentTarget); });
  shadow.querySelector('[data-resize-panel]').addEventListener('pointerdown', function (event) { resizeStart(event, event.currentTarget); });
  [shadow.querySelector('[data-resize-launcher]'), shadow.querySelector('[data-resize-panel]')].forEach(function (button) { button.addEventListener('pointermove', resizeMove); button.addEventListener('pointerup', resizeEnd); button.addEventListener('pointercancel', resizeEnd); button.addEventListener('keydown', function (event) { keyboardResize(event, button); }); });
  fab.addEventListener('click', function () {
    if (suppressNextClick) return;
    panel.hidden = !panel.hidden; fab.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { placePanel(); input.focus(); }
  });
  shadow.querySelector('[data-close]').addEventListener('click', function () { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus(); });
  shadow.querySelector('[data-new]').addEventListener('click', function () { startConversation(false); });
  shadow.querySelector('[data-history]').addEventListener('click', function (event) { menu.hidden = !menu.hidden; event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden)); renderConversationMenu(); });
  shadow.querySelector('[data-attach]').addEventListener('click', function () { imageFile.click(); });
  shadow.querySelector('[data-remove-image]').addEventListener('click', function () { selectedImage = ''; imageFile.value = ''; updateAttachmentPreview(); });
  imageFile.addEventListener('change', async function () {
    var file = imageFile.files && imageFile.files[0]; if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000) { micStatus.textContent = 'Choose a JPEG, PNG, or WebP screenshot under 15 MB.'; imageFile.value = ''; return; }
    micStatus.textContent = 'Preparing screenshot…';
    try {
      var bitmap = await createImageBitmap(file); var scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      var data = canvas.toDataURL('image/jpeg', 0.72);
      for (var quality = 0.62; data.length > 300_000 && quality >= 0.38; quality -= 0.08) data = canvas.toDataURL('image/jpeg', quality);
      if (data.length > 300_000) { micStatus.textContent = 'That screenshot is too large after compression. Try a smaller crop.'; imageFile.value = ''; return; }
      selectedImage = data; imageFile.value = ''; updateAttachmentPreview(); micStatus.textContent = '';
    } catch (_) { micStatus.textContent = 'This browser could not prepare the screenshot. Try a JPEG or PNG image.'; }
  });
  var Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Speech) {
    micButton.hidden = false;
    micButton.addEventListener('click', function () {
      try {
        var recognition = new Speech(); recognition.lang = document.documentElement.lang || 'en'; recognition.interimResults = false; recognition.maxAlternatives = 1;
        micButton.disabled = true; micStatus.textContent = 'Listening…';
        recognition.onresult = function (event) { var spoken = event.results[0][0].transcript; input.value = (input.value ? input.value.trim() + ' ' : '') + spoken; input.dispatchEvent(new Event('input')); input.focus(); };
        recognition.onerror = function (event) { micStatus.textContent = event.error === 'not-allowed' ? 'Allow microphone access in your browser to use voice typing.' : 'Voice typing is unavailable right now.'; };
        recognition.onend = function () { micButton.disabled = false; if (micStatus.textContent === 'Listening…') micStatus.textContent = ''; };
        recognition.start();
      } catch (_) { micButton.disabled = false; micStatus.textContent = 'Voice typing is unavailable right now.'; }
    });
  }
  form.addEventListener('submit', function (event) { event.preventDefault(); ask(input.value.slice(0, 1200)); });
  input.addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } if (event.key === 'Escape') { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); } });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(100, input.scrollHeight) + 'px'; });
  window.addEventListener('resize', function () { var point = clampLauncher(host.getBoundingClientRect().left, host.getBoundingClientRect().top); host.style.left = point.left + 'px'; host.style.top = point.top + 'px'; host.style.right = 'auto'; host.style.bottom = 'auto'; placePanel(); });
  renderHistory(); renderConversationMenu();
})();
