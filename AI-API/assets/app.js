/* Shared client helpers: DOM, formatting, copy, toasts, Firebase sign-in and the
 * authenticated management API. Kept dependency-free apart from the Firebase compat
 * SDK that each page loads from gstatic. */
(function () {
  'use strict';

  var H = (window.HTAI = window.HTAI || {});
  H.$ = function (sel, root) { return (root || document).querySelector(sel); };
  H.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  H.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* Minimal, safe markdown for model replies: escape first, then a tiny subset. */
  H.md = function (text) {
    var src = H.esc(text || '');
    var fences = [];
    src = src.replace(/```([a-z0-9+#-]*)\n([\s\S]*?)```/gi, function (_, lang, code) {
      fences.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
      return '\u0000F' + (fences.length - 1) + '\u0000';
    });
    src = src.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    src = src.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    src = src.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
    src = src.replace(/\u0000F(\d+)\u0000/g, function (_, i) { return fences[Number(i)]; });
    return src;
  };

  H.fmtNum = function (n) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US');
  };

  H.fmtDate = function (ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  H.fmtDateTime = function (ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  H.relTime = function (ms) {
    if (!ms) return 'never';
    var diff = Date.now() - ms;
    if (diff < 45e3) return 'just now';
    var mins = Math.round(diff / 6e4);
    if (mins < 60) return mins + ' min ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + ' h ago';
    var days = Math.round(hours / 24);
    if (days < 30) return days + ' d ago';
    return H.fmtDate(ms);
  };

  H.countdown = function (iso) {
    var target = new Date(iso).getTime();
    if (!isFinite(target)) return '';
    var diff = Math.max(0, target - Date.now());
    var h = Math.floor(diff / 36e5);
    var m = Math.floor((diff % 36e5) / 6e4);
    if (h >= 1) return h + 'h ' + m + 'm';
    return m + 'm';
  };

  H.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    H.toast('Copied');
  };

  H.toast = function (message, kind) {
    var host = H.$('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2400);
    setTimeout(function () { el.remove(); }, 2800);
  };

  /* Copy buttons: <button class="copy" data-copy="text"> or a selector target. */
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    event.preventDefault();
    var value = button.getAttribute('data-copy');
    var source = button.getAttribute('data-copy-from');
    if (source) {
      var node = document.querySelector(source);
      value = node ? node.textContent : '';
    }
    H.copy(value);
  });

  /* ── Firebase ──────────────────────────────────────────────────────────── */

  H.ready = new Promise(function (resolve, reject) {
    if (!window.firebase) return reject(new Error('Firebase SDK did not load.'));
    try {
      if (!firebase.apps.length) firebase.initializeApp(H.FB_CONFIG);
      H.auth = firebase.auth();
      H.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      resolve(H.auth);
    } catch (error) { reject(error); }
  });

  H.currentUser = null;
  H.onAuth = function (callback) {
    if (!H.auth) return;
    H.auth.onAuthStateChanged(function (user) {
      H.currentUser = user || null;
      callback(user || null);
    });
  };

  H.signIn = function (email, password) { return H.auth.signInWithEmailAndPassword(email, password); };
  H.signUp = function (email, password) { return H.auth.createUserWithEmailAndPassword(email, password); };
  H.google = function () { return H.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); };
  H.signOut = function () { return H.auth.signOut(); };

  H.idToken = async function () {
    var user = H.auth && H.auth.currentUser;
    if (!user) throw new Error('Sign in first.');
    return user.getIdToken();
  };

  /** Re-authenticate so the Worker sees a fresh auth_time (it requires < 5 min). */
  H.reauthPassword = async function (password) {
    var user = H.auth.currentUser;
    if (!user) throw new Error('Sign in first.');
    if (!user.email) throw new Error('This account has no password. Use "Continue with Google" instead.');
    var credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
    await user.reauthenticateWithCredential(credential);
    await user.getIdToken(true);
  };

  H.reauthGoogle = async function () {
    var user = H.auth.currentUser;
    if (!user) throw new Error('Sign in first.');
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    await user.getIdToken(true);
  };

  H.friendlyAuthError = function (error) {
    var raw = String((error && (error.message || error.code)) || error || 'Something went wrong.');
    return raw.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '.').trim();
  };

  /** Authenticated management call. Throws Error with `.code` and `.status`. */
  H.api = async function (path, options) {
    options = options || {};
    var headers = { 'content-type': 'application/json' };
    if (options.token) headers.authorization = 'Bearer ' + options.token;
    else headers.authorization = 'Bearer ' + (await H.idToken());
    if (options.adminPassphrase) headers['x-ht-admin-passphrase'] = options.adminPassphrase;
    var response = await fetch(H.API_BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    var payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      var message = (payload && payload.error && payload.error.message) || ('Request failed (' + response.status + ').');
      var error = new Error(message);
      error.code = payload && payload.error ? payload.error.code : 'error';
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };

  /** Send a signed-in user to the dashboard, returning to `next` afterwards. */
  H.requireSignIn = function (next) {
    var target = '/AI-API/Dashboard/?next=' + encodeURIComponent(next || location.pathname);
    location.href = target;
  };

  H.poolClass = function (pool) {
    if (!pool) return '';
    if (pool.exhausted || pool.remaining <= 0) return 'out';
    if (pool.percentRemaining <= 20) return 'low';
    return '';
  };

  H.renderPool = function (host, pool) {
    if (!host || !pool) return;
    var pct = Math.max(0, Math.min(100, pool.percentRemaining));
    var cls = H.poolClass(pool);
    host.innerHTML =
      '<div class="meter-top"><span>Shared free pool</span>' +
      '<span><b>' + H.fmtNum(pool.remaining) + '</b> / ' + H.fmtNum(pool.budget) + ' neurons left</span></div>' +
      '<div class="meter-bar ' + cls + '"><span style="width:' + pct + '%"></span></div>' +
      '<div class="meter-top"><span>Resets in ' + H.esc(H.countdown(pool.resetsAt)) + '</span>' +
      '<span>' + H.fmtNum(pool.requestsToday) + ' / ' + H.fmtNum(pool.requestCap) + ' requests</span></div>';
  };
})();
