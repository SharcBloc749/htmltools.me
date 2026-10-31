const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keyCache = { keys: new Map(), expiresAt: 0 };

function decodeSegment(segment) {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))));
}

async function loadKeys(fetchImpl, force = false) {
  if (!force && keyCache.keys.size && keyCache.expiresAt > Date.now()) return keyCache;
  const response = await fetchImpl(JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!response.ok) {
    if (keyCache.keys.size) return keyCache;
    throw Object.assign(new Error('Unable to load Firebase signing keys.'), { code: 'auth_unavailable' });
  }
  const body = await response.json();
  const keys = new Map((body.keys || []).filter((key) => key.kty === 'RSA' && key.kid).map((key) => [key.kid, key]));
  if (!keys.size) throw Object.assign(new Error('Firebase signing keys are unavailable.'), { code: 'auth_unavailable' });
  const maxAge = Number(/max-age=(\d+)/i.exec(response.headers.get('cache-control') || '')?.[1] || 3600);
  keyCache = { keys, expiresAt: Date.now() + Math.min(maxAge, 43_200) * 1000 };
  return keyCache;
}

export async function verifyFirebaseToken(token, projectId, fetchImpl = fetch) {
  if (!projectId) throw Object.assign(new Error('Firebase project is not configured.'), { code: 'auth_unavailable' });
  if (typeof token !== 'string' || token.length > 8192) throw Object.assign(new Error('Sign in to continue.'), { code: 'unauthorized' });
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Invalid sign-in token.'), { code: 'unauthorized' });
  let header, claims;
  try { header = decodeSegment(parts[0]); claims = decodeSegment(parts[1]); }
  catch { throw Object.assign(new Error('Invalid sign-in token.'), { code: 'unauthorized' }); }
  if (header.alg !== 'RS256' || !header.kid) throw Object.assign(new Error('Invalid sign-in token.'), { code: 'unauthorized' });
  let keyset = await loadKeys(fetchImpl);
  let jwk = keyset.keys.get(header.kid);
  if (!jwk) { keyset = await loadKeys(fetchImpl, true); jwk = keyset.keys.get(header.kid); }
  if (!jwk) throw Object.assign(new Error('Unknown Firebase signing key.'), { code: 'unauthorized' });
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const input = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[2].length % 4) % 4)), (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, input);
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || !claims.sub || !claims.exp || claims.exp <= now || claims.iat > now + 60) {
    throw Object.assign(new Error('Your sign-in has expired. Please sign in again.'), { code: 'unauthorized' });
  }
  return { uid: claims.sub, email: claims.email || '', name: claims.name || '' };
}

export async function requireUser(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) throw Object.assign(new Error('Sign in to use the dashboard.'), { code: 'unauthorized' });
  return verifyFirebaseToken(match[1], env.FIREBASE_PROJECT_ID);
}
