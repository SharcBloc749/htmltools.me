// Optional Firebase App Check bootstrap for the Library data project.
//
// The previous hardcoded reCAPTCHA v3 site key was rejected by Google on
// htmltools.me (HTTP 400), which broke RTDB listeners and callable context.
// App Check is an anti-abuse layer, not an authorization layer: Library auth,
// owner claims, and RTDB rules remain enforced by Firebase Auth and the Admin
// SDK. To avoid shipping a known-broken provider, App Check is OFF by default.
//
// To enable it, register the production domain in Firebase App Check and set a
// valid site key in the page <head>:
//   <meta name="library-app-check" content="YOUR_SITE_KEY" data-provider="recaptcha-v3">
// Supported data-provider values: recaptcha-v3 (default), recaptcha-enterprise.
// Do not enable App Check enforcement in the Firebase console until this key
// works on https://htmltools.me and https://www.htmltools.me.
export async function initializeLibraryAppCheck(app) {
  const meta = typeof document !== 'undefined'
    ? document.querySelector('meta[name="library-app-check"]')
    : null;
  const siteKey = meta?.getAttribute('content')?.trim();
  if (!siteKey) return null;
  const kind = meta?.getAttribute('data-provider') || 'recaptcha-v3';
  const mod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js');
  let provider;
  if (kind === 'recaptcha-enterprise') provider = new mod.ReCaptchaEnterpriseProvider(siteKey);
  else if (kind === 'recaptcha-v3') provider = new mod.ReCaptchaV3Provider(siteKey);
  else throw new Error(`Unsupported Library App Check provider: ${kind}`);
  return mod.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
}
