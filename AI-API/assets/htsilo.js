/* HTSilo — the green in-site helper.
 *
 * Talks to POST /htsilo/chat on the gateway with the signed-in user's Firebase ID
 * token (never an API key). The Worker owns the system prompt, the model, the
 * 320-token cap and the per-user daily limit, and the request spends from the same
 * shared Workers AI budget as the public API. Conversation context is kept in this
 * tab's sessionStorage only, and is cleared when the tab closes. */
(function () {
  'use strict';
  var H = window.HTAI;
  if (!H) return;

  var KEY = 'htai.silo.history';
  var MAX_TURNS = 8;
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY) || '[]').slice(-MAX_TURNS); } catch (_) { history = []; }

  var host = document.createElement('div');
  host.innerHTML = [
    '<button class="silo-fab" type="button" aria-expanded="false" aria-controls="silo-panel">',
    '  <span class="silo-face" aria-hidden="true"></span>',
    '  <span>Ask HTSilo</span>',
    '</button>',
    '<section class="silo-panel hidden" id="silo-panel" aria-label="HTSilo assistant">',
    '  <header class="silo-head">',
    '    <span class="silo-face" aria-hidden="true"></span>',
    '    <div><div class="name">HTSilo</div><div class="status" data-silo-status>API helper</div></div>',
    '    <button class="x" type="button" data-silo-clear title="Clear conversation" aria-label="Clear conversation">↺</button>',
    '    <button class="x" type="button" data-silo-close title="Close" aria-label="Close">✕</button>',
    '  </header>',
    '  <div class="silo-body" data-silo-body></div>',
    '  <div class="silo-foot">',
    '    <div class="silo-input">',
    '      <textarea data-silo-input rows="1" placeholder="Ask about the API, models or keys…" aria-label="Message HTSilo"></textarea>',
    '      <button class="silo-send" type="button" data-silo-send aria-label="Send">',
    '        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    '      </button>',
    '    </div>',
    '    <div class="meta"><span data-silo-remaining>Free pool · sign in to chat</span><span>Green, not magic</span></div>',
    '  </div>',
    '</section>',
  ].join('');
  document.body.appendChild(host);

  var fab = H.$('.silo-fab', host);
  var panel = H.$('#silo-panel', host);
  var body = H.$('[data-silo-body]', host);
  var input = H.$('[data-silo-input]', host);
  var send = H.$('[data-silo-send]', host);
  var statusEl = H.$('[data-silo-status]', host);
  var remainingEl = H.$('[data-silo-remaining]', host);

  var greeted = false;
  var busy = false;

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-MAX_TURNS))); } catch (_) { /* ignore */ }
  }

  function bubble(role, text) {
    var el = document.createElement('div');
    el.className = 'silo-msg ' + (role === 'user' ? 'user' : 'bot');
    el.innerHTML = role === 'user' ? H.esc(text) : H.md(text);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function render() {
    body.innerHTML = '';
    if (!H.currentUser) {
      bubble('bot', 'Sign in first — HTSilo only answers signed-in accounts, so the shared free pool stays yours.');
      var link = document.createElement('a');
      link.className = 'btn btn-primary btn-sm';
      link.href = '/AI-API/Dashboard/';
      link.textContent = 'Sign in';
      link.style.cssText = 'align-self:flex-start;margin-top:-2px';
      body.appendChild(link);
      statusEl.textContent = 'Signed out';
      return;
    }
    if (!history.length) {
      bubble('bot', 'Hi, I’m HTSilo. I can explain the base URL, models, limits, streaming, tool calling or BYOK. What are you building?');
    }
    history.forEach(function (message) { bubble(message.role, message.content); });
    statusEl.textContent = 'API helper';
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    input.disabled = value;
  }

  async function ask(text) {
    if (busy) return;
    history.push({ role: 'user', content: text });
    save();
    bubble('user', text);
    input.value = '';
    setBusy(true);
    var thinking = bubble('bot', '');
    thinking.innerHTML = '<span class="silo-typing"><i></i><i></i><i></i></span>';
    statusEl.textContent = 'Thinking';

    try {
      var result = await H.api('/htsilo/chat', {
        method: 'POST',
        body: { messages: history.slice(-MAX_TURNS), page: location.pathname },
      });
      thinking.remove();
      history.push({ role: 'assistant', content: result.reply });
      history = history.slice(-MAX_TURNS);
      save();
      bubble('bot', result.reply);
      remainingEl.textContent = result.remaining + ' messages left today';
    } catch (error) {
      thinking.remove();
      var message = error.message || 'HTSilo could not answer.';
      if (error.status === 401) message = 'Your session expired. Sign in again from the dashboard.';
      if (error.code === 'user_daily_limit') message = 'That is today’s limit for HTSilo. It resets at 00:00 UTC.';
      if (error.code === 'free_pool_exhausted') message = 'The shared free pool is empty for today. It resets at 00:00 UTC.';
      if (error.code === 'site_rate_limit' || error.code === 'rate_limit_exceeded') message = 'One moment — too many messages in a row. Try again in a minute.';
      bubble('bot', message);
      history.pop();
      save();
    } finally {
      setBusy(false);
      statusEl.textContent = H.currentUser ? 'API helper' : 'Signed out';
      input.focus();
    }
  }

  function open() {
    panel.classList.remove('hidden');
    fab.setAttribute('aria-expanded', 'true');
    render();
    if (!greeted) { greeted = true; }
    input.focus();
  }

  function close() {
    panel.classList.add('hidden');
    fab.setAttribute('aria-expanded', 'false');
  }

  fab.addEventListener('click', function () {
    if (panel.classList.contains('hidden')) open();
    else close();
  });
  H.$('[data-silo-close]', host).addEventListener('click', close);
  H.$('[data-silo-clear]', host).addEventListener('click', function () {
    history = [];
    save();
    render();
  });

  send.addEventListener('click', function () {
    var text = input.value.trim();
    if (!text) return;
    if (!H.currentUser) { H.toast('Sign in to chat with HTSilo', 'bad'); return; }
    ask(text.slice(0, 2000));
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send.click();
    }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(110, input.scrollHeight) + 'px';
  });

  H.ready.then(function () {
    H.onAuth(function (user) {
      if (user) {
        render();
        remainingEl.textContent = 'Free pool · signed in';
      } else {
        render();
        remainingEl.textContent = 'Free pool · sign in to chat';
      }
    });
  }).catch(function () {
    statusEl.textContent = 'Sign-in unavailable';
  });
})();
