/* Public configuration for the htmltools.me AI API pages.
 *
 * The Firebase web config below is a public identifier set (it is designed to be
 * shipped to browsers). It grants no server privileges: the gateway verifies every
 * ID token against Google's signing keys, and Firebase security is enforced by that
 * verification plus the Worker's own authorization. No admin/service-account
 * credential is used for authentication, and none belongs in this file.
 */
window.HTAI = {
  /* Cloudflare Worker gateway — the origin that actually answers.
   *
   * Users never need to see this host. If you attach the Worker to a branded route
   * (api.htmltools.me, or htmltools.me/ai/*) the pages below switch to it on their
   * own: they probe the same-origin PROXY_PATH once per session and only fall back
   * to this origin if nothing answers there.
   *
   * Set `window.HTAI_GATEWAY` in a <script> before this file to hard-pin any origin. */
  API_ORIGIN: 'https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev',
  API_BASE: 'https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev',

  /* Same-origin path that forwards to the Worker, when one exists. */
  PROXY_PATH: '/ai',

  /* Shown to users when the branded route answers; keep it human. */
  BRANDED_LABEL: 'htmltools.me/ai',

  FB_CONFIG: {
    apiKey: 'AIzaSyDNelWu7deMsAKfDdZjbQX_G-hJkcyzbUw',
    authDomain: 'general-database-4cb1c.firebaseapp.com',
    databaseURL: 'https://general-database-4cb1c-default-rtdb.firebaseio.com',
    projectId: 'general-database-4cb1c',
    storageBucket: 'general-database-4cb1c.firebasestorage.app',
    messagingSenderId: '291066015509',
    appId: '1:291066015509:web:33761d4f042656f595431c',
  },

  /* Site paths */
  DASHBOARD: '/AI-API/Dashboard/',
  DOCS: '/AI-API/Docs/',
  PLAYGROUND: '/AI-API/Playground/',
  HOME: '/AI-API/',

  /* Kept in localStorage only to remember the last model a user picked. */
  LS_MODEL: 'htai.model',
  LS_DEFAULT_MODEL: 'htai.defaultModel',
};
/* Static fallback. Prefer H.base() / H.v1() from app.js, which resolve the branded
 * route when it exists. */
window.HTAI.V1 = window.HTAI.API_BASE + '/v1';
