(function () {
  'use strict';

  var API = 'https://siloai.bozhetarnikmatthew.workers.dev';
  var FB_CONFIG = {
    apiKey: 'AIzaSyDNelWu7deMsAKfDdZjbQX_G-hJkcyzbUw',
    authDomain: 'general-database-4cb1c.firebaseapp.com',
    databaseURL: 'https://general-database-4cb1c-default-rtdb.firebaseio.com',
    projectId: 'general-database-4cb1c',
    storageBucket: 'general-database-4cb1c.firebasestorage.app',
    messagingSenderId: '291066015509',
    appId: '1:291066015509:web:33761d4f042656f595431c',
  };
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); };
  var authCard = $('[data-auth-card]');
  var dashboard = $('[data-dashboard]');
  var authForm = $('[data-auth-form]');
  var authError = $('[data-auth-error]');
  var addForm = $('[data-add-form]');
  var addError = $('[data-add-error]');
  var list = $('[data-site-list]');
  var dialog = $('[data-dialog]');
  var dialogContent = $('[data-dialog-content]');
  var toastEl = $('[data-toast]');
  var mode = 'signin';
  var currentUser = null;
  var toastTimer;
  var siteCache = {};

  function toast(message, error) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', Boolean(error));
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('visible'); }, 3300);
  }
  function errorText(error) {
    var message = error && (error.message || error.code) || 'Something went wrong.';
    return String(message).replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '').trim();
  }
  function setAccount(user) {
    $('[data-account]').textContent = user ? (user.displayName || user.email || 'Signed in') : '';
    $('[data-signout]').classList.toggle('hidden', !user);
    authCard.classList.toggle('hidden', Boolean(user));
    dashboard.classList.toggle('hidden', !user);
  }
  async function api(path, options) {
    options = options || {};
    if (!currentUser) throw new Error('Sign in to continue.');
    var token = await currentUser.getIdToken();
    var response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'omit',
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(payload.error && payload.error.message || 'Request failed (' + response.status + ').');
      error.code = payload.error && payload.error.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  function refs() { return firebase.database().ref('siloai_users/' + currentUser.uid + '/sites'); }

  async function loadSites() {
    if (!currentUser) return;
    list.innerHTML = '<div class="loading panel"><span class="spinner"></span> Loading your sites…</div>';
    try {
      var snapshot = await refs().get();
      var links = snapshot.val() || {};
      var ids = Object.keys(links).filter(function (id) { return /^[a-f0-9]{24}$/.test(id); }).slice(0, 20);
      if (!ids.length) {
        list.innerHTML = '<div class="empty panel"><span class="empty-icon">◎</span><h3>No websites connected yet</h3><p>Add a domain above to start discovering its public pages.</p></div>';
        return;
      }
      var results = await Promise.all(ids.map(async function (id) {
        try { var result = await api('/api/sites/' + id); siteCache[id] = result; return result; }
        catch (error) { return { id: id, domain: links[id].domain || id, error: error.message }; }
      }));
      list.innerHTML = results.map(siteCard).join('');
    } catch (error) {
      list.innerHTML = '<div class="panel error-panel"><b>Could not load your sites.</b><p>' + esc(errorText(error)) + '</p><button class="button subtle" type="button" data-retry>Try again</button></div>';
    }
  }
  function siteCard(response) {
    var site = response.site || response;
    var verified = site.verified;
    var title = site.profile && site.profile.title || site.domain;
    var pages = site.pageCount == null ? (site.pages || []).length : site.pageCount;
    var detail = response.error ? '<p class="card-warning">' + esc(response.error) + '</p>' : '';
    return '<article class="site-card panel" data-site-card="' + esc(site.id) + '">' +
      '<div class="site-card-main"><span class="site-icon"><img src="/SiloAI.png?v=4" alt=""></span><div class="site-title"><div class="domain-line"><h3>' + esc(title) + '</h3><span class="status ' + (verified ? 'verified' : 'pending') + '"><i></i>' + (verified ? 'Verified' : 'Needs verification') + '</span></div><a href="https://' + esc(site.domain) + '" target="_blank" rel="noopener">' + esc(site.domain) + ' ↗</a></div><span class="page-count">' + pages + '<small> indexed pages</small></span><button class="button subtle" type="button" data-open="' + esc(site.id) + '">Manage <span>→</span></button></div>' + detail + '</article>';
  }

  function makeGroupText(groups) {
    return (groups || []).map(function (group) { return group.name + ': ' + (group.paths || []).join(', '); }).join('\n');
  }
  function parseGroups(value) {
    var groups = [];
    String(value || '').split(/\r?\n/).forEach(function (line) {
      var colon = line.indexOf(':');
      if (colon < 1) return;
      var name = line.slice(0, colon).trim();
      var paths = line.slice(colon + 1).split(',').map(function (part) { return part.trim(); }).filter(Boolean);
      if (name && paths.length) groups.push({ name: name, paths: paths });
    });
    return groups;
  }
  // The embed URL is intentionally unversioned: the widget file is served with
  // must-revalidate, so every update reaches existing embeds without the owner
  // editing their site again. The running version is shown in the widget footer.
  var WIDGET_SRC = 'https://htmltools.me/SiloAI/widget.js';
  function widgetSnippet(site) {
    return '<script async src="' + WIDGET_SRC + '" data-site-id="' + site.id + '"><\/script>';
  }
  function openSite(id) {
    var site = siteCache[id] && (siteCache[id].site || siteCache[id]);
    if (!site) return;
    $('[data-dialog-title]').textContent = site.profile && site.profile.title || site.domain;
    dialogContent.innerHTML = site.verified ? verifiedPanel(site) : verifyPanel(site);
    dialog.showModal();
    bindDialog(site);
  }
  function verifyPanel(site) {
    var body = 'siloai-verification=' + site.verificationToken;
    var path = site.verificationPath || '/.well-known/siloai-verification.txt';
    var suggested = 'https://' + site.domain + path;
    return '<div class="verify-banner"><span class="verify-icon">!</span><div><b>Verify this domain</b><p>Paste the link to any page on this domain that contains the code below — a plain text file at the path shown works too. SiloAI only crawls after it reads the code.</p></div></div>' +
      '<div class="field"><label for="verification-url">Page URL that contains the code</label><input id="verification-url" class="field-input" type="text" spellcheck="false" autocomplete="url" data-verification-url value="' + esc(suggested) + '" placeholder="https://' + esc(site.domain) + '/verify.html"><p class="hint">Paste it with or without <code>https://</code>. The page must be on <b>' + esc(site.domain) + '</b>.</p></div>' +
      '<div class="field"><label>Exact contents on that page</label><div class="copy-row"><code>' + esc(body) + '</code><button class="mini-copy" data-copy="' + esc(body) + '">Copy</button></div></div>' +
      '<div class="field"><label>Or publish this file path</label><div class="copy-row"><code>' + esc(path) + '</code><button class="mini-copy" data-copy="' + esc(path) + '">Copy</button></div></div>' +
      '<div class="notice"><b>Either way works</b><p>The code can sit anywhere inside the page’s HTML, including in a comment or a <code>&lt;meta&gt;</code> tag. Keep it exactly as shown — it is unique to your account.</p></div>' +
      '<div class="dialog-actions"><button class="button primary" type="button" data-verify="' + esc(site.id) + '">Verify &amp; crawl <span>→</span></button><span class="muted small">First scan: up to 30 public pages</span></div>' +
      '<p class="dialog-error" role="alert" data-site-error></p>';
  }
  function verifiedPanel(site) {
    var pages = (site.pages || []).map(function (page) {
      return '<div class="page-row"><div><b>' + esc(page.title || page.path) + '</b><code>' + esc(page.path) + '</code></div><span>' + esc((page.headings || []).slice(0, 2).join(' · ')) + '</span></div>';
    }).join('');
    var actionSettings = site.actions || { navigationMode: 'on', pageActionsMode: 'on', confirmNavigation: true };
    return '<div class="verified-banner"><span>✓</span><div><b>Domain verified</b><p>Last index refresh: ' + esc(site.lastCrawledAt ? new Date(site.lastCrawledAt).toLocaleString() : 'not yet crawled') + ' · ' + esc(site.pageCount || 0) + ' pages discovered</p></div><div class="verified-actions"><button class="button subtle" type="button" data-ai-test="' + esc(site.id) + '">Test AI</button><button class="button subtle" type="button" data-refresh="' + esc(site.id) + '">Refresh index</button></div></div>' +
      '<div class="field"><label for="groups">Tool groups <span class="label-note">One per line: Name: /path, /another/path</span></label><textarea id="groups" class="groups-input" data-groups placeholder="Library: /Library, /Library/Studio, /Library/Studio/Upload\nAI Playground: /AI-Playground">' + esc(makeGroupText(site.groups)) + '</textarea><p class="hint">Groups help SiloAI understand related tool pages. Listed paths are also checked as crawl seeds on the next refresh; use the exact page path, including any trailing slash. Other public pages are still discovered automatically.</p></div>' +
      '<div class="permissions"><div><b>Let SiloAI navigate visitors</b><p>On by default. When a visitor asks to go somewhere, SiloAI shows them a button with the destination; nothing opens until they press it, and SiloAI picks whether to open a new tab or reuse the current one.</p></div><label class="switch"><input type="checkbox" data-allow-nav ' + (actionSettings.navigationMode !== 'off' ? 'checked' : '') + '><span></span></label></div>' +
      '<div class="permissions"><div><b>Allow page interactions</b><p>On by default. SiloAI can highlight, click, fill, clear, tick, choose from a dropdown, copy, select text, search the page, and rewrite visible text. Visitors confirm every change; submit/reset buttons are always excluded.</p></div><label class="switch"><input type="checkbox" data-allow-actions ' + (actionSettings.pageActionsMode !== 'off' ? 'checked' : '') + '><span></span></label></div>' +
      '<div class="permissions nested" data-confirm-wrap><div><b>Ask before each navigation</b><p>Recommended. Visitors press a destination button instead of being sent away mid-task. Turn this off to let SiloAI open a page immediately.</p></div><label class="switch"><input type="checkbox" data-confirm-nav ' + (actionSettings.confirmNavigation !== false ? 'checked' : '') + '><span></span></label></div>' +
      '<div class="dialog-actions"><button class="button primary" type="button" data-save="' + esc(site.id) + '">Save settings</button><button class="button subtle" type="button" data-copy="' + esc(widgetSnippet(site)) + '">Copy widget code</button></div>' +
      '<div class="field"><label>Install the widget on this domain</label><pre class="snippet">' + esc(widgetSnippet(site)) + '</pre><p class="hint">Paste this snippet before <code>&lt;/body&gt;</code>. The widget is silent unless a visitor opens it, and it keeps itself up to date — you never need to edit this snippet again. The running version is shown in the corner of the chat window.</p></div>' +
      '<div class="pages-head"><div><h3>Discovered pages</h3><p class="hint">SiloAI rechecks active sites after 24 hours. Owners can refresh manually.</p></div><span class="count-pill">' + esc(site.pageCount || 0) + '</span></div>' +
      '<div class="page-list">' + (pages || '<p class="muted">No pages have been indexed yet.</p>') + '</div>' +
      (site.lastCrawlError ? '<p class="dialog-error">' + esc(site.lastCrawlError) + '</p>' : '') +
      '<p class="dialog-error" role="alert" data-site-error></p>';
  }
  function bindDialog(site) {
    dialogContent.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', async function () {
        try { await navigator.clipboard.writeText(button.dataset.copy); toast('Copied to clipboard'); }
        catch (_) { toast('Copy failed. Select the text and copy it manually.', true); }
      });
    });
    var verify = dialogContent.querySelector('[data-verify]');
    if (verify) verify.addEventListener('click', async function () {
      var error = $('[data-site-error]', dialogContent);
      verify.disabled = true;
      verify.textContent = 'Verifying and scanning…';
      error.textContent = '';
      try {
        var urlField = dialogContent.querySelector('[data-verification-url]');
        var verificationUrl = urlField ? urlField.value.trim() : '';
        var result = await api('/api/sites/' + site.id + '/verify', { method: 'POST', body: { verificationUrl: verificationUrl } });
        siteCache[site.id] = result;
        var skippedLarge = Number(result.result && result.result.skippedLargePages) || 0;
        toast('Domain verified — ' + result.result.pages + ' pages indexed' + (skippedLarge ? ' · ' + skippedLarge + ' oversized skipped' : ''));
        await loadSites();
        openSite(site.id);
      } catch (failure) {
        error.textContent = errorText(failure);
        verify.disabled = false;
        verify.textContent = 'Verify & crawl →';
        try {
          var latest = await api('/api/sites/' + site.id);
          siteCache[site.id] = latest;
          await loadSites();
          if (latest.verified) openSite(site.id);
        } catch (_) { /* keep the actionable error in the open dialog */ }
      }
    });
    var aiTest = dialogContent.querySelector('[data-ai-test]');
    if (aiTest) aiTest.addEventListener('click', async function () {
      var error = $('[data-site-error]', dialogContent);
      aiTest.disabled = true;
      aiTest.textContent = 'Testing AI…';
      error.textContent = '';
      try {
        var result = await api('/api/sites/' + site.id + '/ai-test', { method: 'POST', body: {} });
        toast('AI is responding · ' + (result.fallback ? 'fallback ' : '') + result.model);
      } catch (failure) {
        error.textContent = errorText(failure);
        toast('AI test failed', true);
      } finally {
        aiTest.disabled = false;
        aiTest.textContent = 'Test AI';
      }
    });
    var refresh = dialogContent.querySelector('[data-refresh]');
    if (refresh) refresh.addEventListener('click', async function () {
      var error = $('[data-site-error]', dialogContent);
      refresh.disabled = true;
      refresh.textContent = 'Refreshing…';
      try {
        var result = await api('/api/sites/' + site.id + '/refresh', { method: 'POST', body: {} });
        siteCache[site.id] = result;
        var skippedLarge = Number(result.result && result.result.skippedLargePages) || 0;
        toast(skippedLarge ? 'Index refreshed · skipped ' + skippedLarge + ' oversized page' + (skippedLarge === 1 ? '' : 's') : 'Index refreshed');
        await loadSites();
        openSite(site.id);
      } catch (failure) { error.textContent = errorText(failure); refresh.disabled = false; refresh.textContent = 'Refresh index'; }
    });
    var allow = dialogContent.querySelector('[data-allow-nav]');
    var confirmWrap = dialogContent.querySelector('[data-confirm-wrap]');
    if (allow && confirmWrap) {
      var syncConfirm = function () { confirmWrap.classList.toggle('disabled', !allow.checked); };
      allow.addEventListener('change', syncConfirm);
      syncConfirm();
    }
    var save = dialogContent.querySelector('[data-save]');
    if (save) save.addEventListener('click', async function () {
      var error = $('[data-site-error]', dialogContent);
      save.disabled = true;
      error.textContent = '';
      try {
        var result = await api('/api/sites/' + site.id, {
          method: 'PUT',
          body: {
            groups: parseGroups($('[data-groups]', dialogContent).value),
            actions: {
              navigationMode: $('[data-allow-nav]', dialogContent).checked ? 'on' : 'off',
              pageActionsMode: $('[data-allow-actions]', dialogContent).checked ? 'on' : 'off',
              confirmNavigation: $('[data-confirm-nav]', dialogContent).checked,
            },
          },
        });
        siteCache[site.id] = result;
        toast('Settings saved');
        await loadSites();
        openSite(site.id);
      } catch (failure) { error.textContent = errorText(failure); save.disabled = false; }
    });
  }

  authForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    authError.textContent = '';
    var email = $('[data-email]').value.trim();
    var password = $('[data-password]').value;
    var submit = $('[data-auth-submit]');
    submit.disabled = true;
    try {
      if (mode === 'signup') await firebase.auth().createUserWithEmailAndPassword(email, password);
      else await firebase.auth().signInWithEmailAndPassword(email, password);
    } catch (error) { authError.textContent = errorText(error); }
    finally { submit.disabled = false; }
  });
  $('[data-auth-toggle]').addEventListener('click', function () {
    mode = mode === 'signin' ? 'signup' : 'signin';
    $('[data-auth-submit]').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('[data-auth-toggle]').textContent = mode === 'signup' ? 'I already have an account' : 'Create account';
    $('[data-auth-error]').textContent = '';
  });
  $('[data-google]').addEventListener('click', async function () {
    authError.textContent = '';
    try { await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
    catch (error) { authError.textContent = errorText(error); }
  });
  $('[data-signout]').addEventListener('click', function () { firebase.auth().signOut(); });
  addForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    addError.textContent = '';
    var submit = $('button[type="submit"]', addForm);
    submit.disabled = true;
    try {
      var result = await api('/api/sites', { method: 'POST', body: { domain: $('[data-domain]').value.trim() } });
      await refs().child(result.site.id).set({ domain: result.site.domain, createdAt: result.site.createdAt });
      siteCache[result.site.id] = result;
      $('[data-domain]').value = '';
      await loadSites();
      openSite(result.site.id);
    } catch (error) { addError.textContent = errorText(error); }
    finally { submit.disabled = false; }
  });
  document.addEventListener('click', function (event) {
    var open = event.target.closest('[data-open]');
    if (open) { openSite(open.dataset.open); return; }
    if (event.target.closest('[data-retry]')) loadSites();
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });

  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
    firebase.auth().onAuthStateChanged(function (user) {
      currentUser = user || null;
      setAccount(currentUser);
      if (currentUser) loadSites();
    });
  } catch (error) {
    authError.textContent = 'Could not initialize Firebase: ' + errorText(error);
  }
})();
