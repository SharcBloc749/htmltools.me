/* SiloAI website assistant embed. Install with:
   <script async src="https://htmltools.me/SiloAI/widget.js?v=5" data-site-id="YOUR_SITE_ID"></script>
*/
(function () {
  'use strict';
  if (window.__siloaiLoaded) return;
  window.__siloaiLoaded = true;
  var script = document.currentScript;
  var siteId = script && script.getAttribute('data-site-id');
  if (!/^[a-f0-9]{24}$/.test(siteId || '')) return;
  var api = 'https://siloai.bozhetarnikmatthew.workers.dev';
  var storageKey = 'siloai.history.' + siteId;
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(storageKey) || '[]').slice(-4); } catch (_) { history = []; }

  var host = document.createElement('div');
  host.id = 'siloai-widget-host';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;';
  document.body.appendChild(host);
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial}*{box-sizing:border-box}button,textarea{font:inherit}.silo-fab{width:64px;height:64px;padding:0;overflow:hidden;border-radius:14px;border:1px solid #999999;background:#090909;box-shadow:0 14px 38px #00000088;cursor:pointer;display:grid;place-items:center;transition:transform .2s,box-shadow .2s}.silo-fab:hover{transform:translateY(-2px);box-shadow:0 18px 44px #000000bb}.silo-fab img{display:block;width:100%;height:100%;border-radius:12px;object-fit:cover;image-rendering:auto;transform:none}.silo-panel{position:fixed;right:20px;bottom:92px;width:min(390px,calc(100vw - 28px));height:min(580px,calc(100dvh - 118px));background:#0b0b0b;color:#f4f4f4;border:1px solid #333333;border-radius:19px;box-shadow:0 24px 80px #000000bb;display:flex;flex-direction:column;overflow:hidden;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}.silo-panel[hidden]{display:none}.silo-head{height:62px;flex:none;display:flex;align-items:center;gap:11px;padding:0 15px;border-bottom:1px solid #272727;background:#111111}.silo-head img{width:38px;height:38px;border-radius:8px;object-fit:cover;transform:none;border:1px solid #777777;background:#090909}.silo-brand{font-weight:650;letter-spacing:.02em}.silo-status{font-size:11px;color:#a6a6a6}.silo-grow{flex:1}.silo-icon{width:34px;height:34px;border-radius:9px;color:#d0d0d0;background:transparent;border:0;cursor:pointer;font-size:19px}.silo-icon:hover{background:#232323}.silo-messages{overflow:auto;flex:1;padding:17px 14px;display:flex;flex-direction:column;gap:12px}.silo-welcome{padding:18px 15px;border:1px solid #313131;border-radius:14px;background:linear-gradient(140deg,#151515,#111111);color:#c6c6c6}.silo-welcome b{display:block;color:#f4f4f4;font-size:16px;margin-bottom:5px}.silo-msg{max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;border-radius:13px}.silo-user{align-self:flex-end;background:#262626;color:#f3f3f3;border:1px solid #3c3c3c}.silo-assistant{align-self:flex-start;background:#141414;border:1px solid #272727;color:#e4e4e4}.silo-error{color:#cecece}.silo-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.silo-source{display:inline-flex;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #353535;background:#181818;color:#bdbdbd;border-radius:999px;padding:5px 9px;font-size:11px;text-decoration:none}.silo-source:hover{border-color:#7c7c7c;color:#ffffff}.silo-action{margin-top:9px;border:1px solid #d0d0d0;background:#e5e5e5;color:#111111;border-radius:10px;padding:8px 11px;cursor:pointer;font-weight:600}.silo-action:hover{background:#808080}.silo-compose{padding:11px;border-top:1px solid #272727;background:#111111}.silo-row{display:flex;align-items:flex-end;gap:8px;background:#0c0c0c;border:1px solid #343434;border-radius:13px;padding:7px}.silo-row:focus-within{border-color:#858585}.silo-input{resize:none;min-height:38px;max-height:110px;flex:1;border:0;outline:0;background:transparent;color:#f4f4f4;padding:8px 6px;font-size:14px;line-height:1.4}.silo-input::placeholder{color:#7e7e7e}.silo-send{width:37px;height:37px;border:0;border-radius:10px;background:#e5e5e5;color:#111111;cursor:pointer;font-size:18px}.silo-send:disabled{opacity:.45;cursor:default}.silo-foot{font-size:10px;color:#808080;margin:7px 3px 0}.silo-typing{color:#b1b1b1;font-size:12px}.silo-panel[data-busy="true"] .silo-send{opacity:.5}@media(max-width:520px){#siloai-widget-host{right:10px!important;bottom:10px!important}.silo-fab{width:58px;height:58px;border-radius:13px}.silo-fab img{width:100%;height:100%;border-radius:11px;transform:none}.silo-panel{right:6px;bottom:72px;width:calc(100vw - 12px);height:calc(100dvh - 84px);max-height:none;border-radius:16px}}@media(prefers-reduced-motion:reduce){.silo-fab{transition:none}}',
    '</style>',
    '<button class="silo-fab" type="button" aria-label="Open SiloAI" aria-expanded="false"><img src="https://htmltools.me/SiloAI/brandmark-mono.png?v=2" alt=""></button>',
    '<section class="silo-panel" role="dialog" aria-label="Chat with SiloAI" hidden>',
    '  <header class="silo-head"><img src="https://htmltools.me/SiloAI/brandmark-mono.png?v=2" alt=""><div><div class="silo-brand">SiloAI</div><div class="silo-status">Website assistant</div></div><span class="silo-grow"></span><button class="silo-icon" type="button" data-clear title="Start a new conversation" aria-label="Start a new conversation">↻</button><button class="silo-icon" type="button" data-close aria-label="Close SiloAI">×</button></header>',
    '  <div class="silo-messages" aria-live="polite"><div class="silo-welcome"><b>Hi, I’m SiloAI.</b>Ask me about this website, its tools, and where to find things.</div></div>',
    '  <form class="silo-compose"><div class="silo-row"><textarea class="silo-input" rows="1" maxlength="1200" aria-label="Message SiloAI" placeholder="Ask about this website…"></textarea><button class="silo-send" type="submit" aria-label="Send message">↑</button></div><div class="silo-foot">Answers use this site’s public pages. SiloAI does not click or change anything unless the site owner enables it.</div></form>',
    '</section>',
  ].join('');

  var fab = shadow.querySelector('.silo-fab');
  var panel = shadow.querySelector('.silo-panel');
  var log = shadow.querySelector('.silo-messages');
  var form = shadow.querySelector('.silo-compose');
  var input = shadow.querySelector('.silo-input');
  var send = shadow.querySelector('.silo-send');
  var busy = false;

  function save() { try { sessionStorage.setItem(storageKey, JSON.stringify(history.slice(-4))); } catch (_) {} }
  function currentPageContext() {
    var pageUrl;
    var pageTitle = document.title || '';
    try { pageUrl = new URL(window.location.href); } catch (_) { pageUrl = new URL('/', location.origin); }
    try {
      var topUrl = new URL(window.top.location.href);
      if (topUrl.protocol === 'https:' && (location.origin === 'null' || topUrl.origin === location.origin)) {
        pageUrl = topUrl;
        pageTitle = window.top.document.title || pageTitle;
      }
    } catch (_) { /* cross-origin frame: use the widget's own document context */ }
    return { pagePath: pageUrl.pathname, pageTitle: pageTitle.slice(0, 180) };
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
      var link = document.createElement('a');
      link.className = 'silo-source';
      var destination;
      try { destination = new URL(source.path, location.origin); } catch (_) { return; }
      if (destination.origin !== location.origin) return;
      link.href = destination.href;
      link.target = '_self';
      link.textContent = source.title || source.path;
      link.title = source.path;
      wrap.appendChild(link);
    });
    if (wrap.childNodes.length) parent.appendChild(wrap);
  }
  function renderHistory() {
    log.textContent = '';
    history.forEach(function (entry) { bubble(entry.role, entry.content); });
    if (!history.length) {
      var welcome = document.createElement('div');
      welcome.className = 'silo-welcome';
      var bold = document.createElement('b');
      bold.textContent = 'Hi, I’m SiloAI.';
      welcome.appendChild(bold);
      welcome.appendChild(document.createTextNode('Ask me about this website, its tools, and where to find things.'));
      log.appendChild(welcome);
    }
  }
  function setBusy(value) {
    busy = value;
    panel.dataset.busy = String(value);
    input.disabled = value;
    send.disabled = value;
  }
  async function ask(text) {
    if (busy || !text.trim()) return;
    if (!history.length) log.textContent = '';
    history.push({ role: 'user', content: text });
    history = history.slice(-4);
    save();
    bubble('user', text);
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    var pending = bubble('assistant', 'SiloAI is thinking…');
    pending.className += ' silo-typing';
    try {
      var pageContext = currentPageContext();
      var response = await fetch(api + '/chat/' + siteId, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(0, -1), pagePath: pageContext.pagePath, pageTitle: pageContext.pageTitle }),
        credentials: 'omit',
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error && payload.error.message || 'SiloAI could not answer. Please try again.');
      pending.remove();
      history.push({ role: 'assistant', content: payload.reply || 'I could not find an answer that time.' });
      history = history.slice(-4);
      save();
      var reply = bubble('assistant', payload.reply || 'I could not find an answer that time.');
      addSources(reply, payload.sources);
      if (payload.action && payload.action.type === 'navigate' && typeof payload.action.path === 'string') {
        var destination;
        try { destination = new URL(payload.action.path, location.origin); } catch (_) { destination = null; }
        if (destination && destination.origin === location.origin && destination.pathname === payload.action.path) {
          if (payload.confirmAction === false) {
            location.assign(destination.href);
          } else {
            var action = document.createElement('button');
            action.className = 'silo-action';
            action.type = 'button';
            action.textContent = 'Go to ' + (payload.action.title || payload.action.path);
            action.addEventListener('click', function () { location.assign(destination.href); });
            reply.appendChild(action);
          }
        }
      }
    } catch (error) {
      pending.remove();
      history.pop();
      save();
      bubble('assistant', error.message || 'SiloAI could not answer. Please try again.', true);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  fab.addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    fab.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) input.focus();
  });
  shadow.querySelector('[data-close]').addEventListener('click', function () { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus(); });
  shadow.querySelector('[data-clear]').addEventListener('click', function () { history = []; save(); renderHistory(); input.focus(); });
  form.addEventListener('submit', function (event) { event.preventDefault(); ask(input.value.trim().slice(0, 1200)); });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
    if (event.key === 'Escape') { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); }
  });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(100, input.scrollHeight) + 'px'; });
  if (history.length) renderHistory();
})();
