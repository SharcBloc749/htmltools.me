/* SiloAI — the in-site assistant.
 *
 * Talks to POST /siloai/chat with the signed-in user's Firebase ID token (never an
 * API key). The Worker owns the system prompt, the model, the token cap and the daily
 * limit, and every reply spends from the same shared Workers AI budget as the public
 * API. Conversation history lives in this tab's sessionStorage and dies with the tab.
 */
(function () {
  'use strict';
  var H = window.HTAI;
  if (!H) return;

  var STORE = 'htai.siloai.history';
  var MAX_TURNS = 8;
  var SUGGESTIONS = [
    'What base URL do I use?',
    'Which model should I start with?',
    'How do I stream a reply?',
  ];

  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]').slice(-MAX_TURNS); } catch (_) { history = []; }

  var host = document.createElement('div');
  host.className = 'siloai-root';
  host.innerHTML = [
    '<button class="siloai-fab" type="button" aria-label="Open SiloAI" aria-expanded="false" aria-controls="siloai-panel">',
    '  <img src="/SiloAI.png?v=3" alt="" width="26" height="26">',
    '</button>',
    '<section class="siloai-panel hidden" id="siloai-panel" aria-label="SiloAI assistant">',
    '  <header class="siloai-head">',
    '    <img class="siloai-avatar" src="/SiloAI.png?v=3" alt="" width="30" height="30">',
    '    <div class="siloai-id">',
    '      <span class="siloai-name">SiloAI</span>',
    '      <span class="siloai-state" data-silo-state>API assistant</span>',
    '    </div>',
    '    <button class="siloai-icon" type="button" data-silo-reset title="Start over" aria-label="Start over">',
    '      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    '    </button>',
    '    <button class="siloai-icon" type="button" data-silo-close title="Close" aria-label="Close SiloAI">',
    '      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    '    </button>',
    '  </header>',
    '  <div class="siloai-body" data-silo-body></div>',
    '  <form class="siloai-foot" data-silo-form>',
    '    <label class="siloai-field">',
    '      <span class="siloai-sr">Message SiloAI</span>',
    '      <textarea data-silo-input rows="1" placeholder="Ask about the API, models or keys" aria-label="Message SiloAI"></textarea>',
    '      <button class="siloai-send" type="submit" aria-label="Send message">',
    '        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M11 6l6 6-6 6"/></svg>',
    '      </button>',
    '    </label>',
    '    <p class="siloai-meta" data-silo-meta>Signed-in only · shared free pool</p>',
    '  </form>',
    '</section>',
  ].join('');
  document.body.appendChild(host);

  var fab = H.$('.siloai-fab', host);
  var panel = H.$('#siloai-panel', host);
  var body = H.$('[data-silo-body]', host);
  var form = H.$('[data-silo-form]', host);
  var input = H.$('[data-silo-input]', host);
  var stateEl = H.$('[data-silo-state]', host);
  var metaEl = H.$('[data-silo-meta]', host);
  var busy = false;

  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-MAX_TURNS))); } catch (_) { /* ignore */ }
  }

  function message(role, text) {
    var el = document.createElement('div');
    el.className = 'siloai-msg ' + (role === 'user' ? 'is-user' : 'is-bot');
    el.innerHTML = role === 'user' ? H.esc(text) : H.md(text);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function renderEmpty() {
    var intro = document.createElement('div');
    intro.className = 'siloai-intro';
    intro.innerHTML =
      '<p>SiloAI explains this gateway: base URL, models, limits, streaming, keys.</p>' +
      '<div class="siloai-chips">' +
      SUGGESTIONS.map(function (s) { return '<button type="button" class="siloai-chip" data-silo-suggest>' + H.esc(s) + '</button>'; }).join('') +
      '</div>';
    body.appendChild(intro);
    H.$$('[data-silo-suggest]', intro).forEach(function (chip) {
      chip.addEventListener('click', function () { ask(chip.textContent); });
    });
  }

  function render() {
    body.innerHTML = '';
    if (!H.currentUser) {
      var gate = document.createElement('div');
      gate.className = 'siloai-intro';
      gate.innerHTML = '<p>SiloAI answers signed-in accounts only, so the shared free pool stays yours.</p>' +
        '<a class="btn btn-primary btn-sm" href="/AI-API/Dashboard/">Sign in to chat</a>';
      body.appendChild(gate);
      stateEl.textContent = 'Signed out';
      metaEl.textContent = 'Sign in to use SiloAI';
      return;
    }
    if (!history.length) renderEmpty();
    else history.forEach(function (entry) { message(entry.role, entry.content); });
    stateEl.textContent = 'API assistant';
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    panel.classList.toggle('is-busy', value);
    if (!value) input.focus();
  }

  function failure(error) {
    if (error.code === 'not_configured') return 'The gateway is not fully set up yet. The owner needs to finish the deployment.';
    if (error.status === 401) return 'Your session expired. Sign in again from the dashboard.';
    if (error.code === 'user_daily_limit') return 'That is today’s SiloAI limit. It resets at 00:00 UTC.';
    if (error.code === 'free_pool_exhausted') return 'The shared free pool is empty for today. It resets at 00:00 UTC.';
    if (error.code === 'site_rate_limit' || error.code === 'rate_limit_exceeded') return 'Too many messages in a row — try again in a minute.';
    if (error.code === 'provider_error') return 'SiloAI could not reach the model. Try again in a moment.';
    return error.message || 'SiloAI could not answer.';
  }

  async function ask(text) {
    if (busy || !text) return;
    if (!H.currentUser) { H.toast('Sign in to chat with SiloAI', 'bad'); return; }
    if (!history.length) body.innerHTML = '';
    history.push({ role: 'user', content: text });
    save();
    message('user', text);
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    stateEl.textContent = 'Thinking';
    var pending = message('bot', '');
    pending.innerHTML = '<span class="siloai-typing"><i></i><i></i><i></i></span>';

    try {
      var result = await H.api('/siloai/chat', {
        method: 'POST',
        body: { messages: history.slice(-MAX_TURNS), page: location.pathname },
      });
      pending.remove();
      history.push({ role: 'assistant', content: result.reply });
      history = history.slice(-MAX_TURNS);
      save();
      message('bot', result.reply);
      metaEl.textContent = result.remaining + ' messages left today';
    } catch (error) {
      pending.remove();
      history.pop();
      save();
      message('bot', failure(error));
    } finally {
      setBusy(false);
      stateEl.textContent = H.currentUser ? 'API assistant' : 'Signed out';
    }
  }

  function open() {
    panel.classList.remove('hidden');
    fab.setAttribute('aria-expanded', 'true');
    render();
    input.focus();
  }

  function close() {
    panel.classList.add('hidden');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }

  fab.addEventListener('click', function () {
    if (panel.classList.contains('hidden')) open(); else close();
  });
  H.$('[data-silo-close]', host).addEventListener('click', close);
  H.$('[data-silo-reset]', host).addEventListener('click', function () {
    history = [];
    save();
    render();
    input.focus();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    ask(input.value.trim().slice(0, 2000));
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
    if (event.key === 'Escape') close();
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  });

  H.ready.then(function () {
    H.onAuth(function () {
      render();
      if (panel.classList.contains('hidden')) return;
    });
  }).catch(function () {
    stateEl.textContent = 'Sign-in unavailable';
  });
})();
