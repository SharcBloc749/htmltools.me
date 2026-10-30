/**
 * Firebase Authentication ID-token verification.
 *
 * We verify tokens with Google's public JWKS — no Firebase Admin SDK, no service
 * account, no private key and no admin credentials anywhere in this project.
 * That is all that is needed to prove "this request comes from uid X".
 *
 * Project: general-database-4cb1c (the same project the Website Encryption tool
 * and AI Playground login use). Tokens from htmltools-main / htmltools-library are
 * rejected because the audience does not match.
 */

import { base64urlToBytes, nowSec, textToBase64url } from './util.mjs';

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Module-scope cache. Each Worker isolate keeps its own copy; Google rotates keys
// rarely and `kid` lookup makes a stale cache harmless (unknown kid forces a refetch).
let jwksCache = { keys: new Map(), expiresAt: 0 };

function parseCacheMaxAge(response) {
  const cc = response.headers.get('cache-control') || '';
  const m = /max-age=(\d+)/.exec(cc);
  return m ? Number(m[1]) : 3600;
}

async function loadJwks(env, fetchImpl, force = false) {
  const now = Date.now();
  if (!force && jwksCache.keys.size && jwksCache.expiresAt > now) return jwksCache;
  const res = await fetchImpl(JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!res.ok) {
    if (jwksCache.keys.size) return jwksCache; // use a still-usable stale copy
    throw new Error('Could not load Google signing keys.');
  }
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys.set(jwk.kid, jwk);
  }
  if (!keys.size) throw new Error('Google signing key set was empty.');
  jwksCache = {
    keys,
    // Cap the cache at 12 h even if Google asks for longer, so key rotation and
    // revocation of the local copy have a bound.
    expiresAt: now + Math.min(parseCacheMaxAge(res), 12 * 3600) * 1000,
  };
  return jwksCache;
}

function decodeSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(segment)));
}

/**
 * @returns {Promise<object>} verified claims
 * @throws {Error} with `.code` set to a stable string
 */
export async function verifyIdToken(token, env, fetchImpl = fetch) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw Object.assign(new Error('Firebase project is not configured.'), { code: 'auth_misconfigured' });
  if (typeof token !== 'string' || token.length < 40 || token.length > 8192) {
    throw Object.assign(new Error('Missing or malformed sign-in token.'), { code: 'auth_missing' });
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Malformed sign-in token.'), { code: 'auth_malformed' });

  let header, payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw Object.assign(new Error('Malformed sign-in token.'), { code: 'auth_malformed' });
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw Object.assign(new Error('Unsupported sign-in token.'), { code: 'auth_malformed' });
  }

  let jwks = await loadJwks(env, fetchImpl);
  let jwk = jwks.keys.get(header.kid);
  if (!jwk) {
    jwks = await loadJwks(env, fetchImpl, true); // key rotation
    jwk = jwks.keys.get(header.kid);
  }
  if (!jwk) throw Object.assign(new Error('Unknown signing key.'), { code: 'auth_bad_signature' });

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw Object.assign(new Error('Could not import signing key.'), { code: 'auth_verification_failed' });
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlToBytes(parts[2]), signed);
  } catch {
    valid = false;
  }
  if (!valid) throw Object.assign(new Error('Sign-in token signature is invalid.'), { code: 'auth_bad_signature' });

  const now = nowSec();
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss || payload.aud !== projectId) {
    throw Object.assign(new Error('Sign-in token is for a different Firebase project.'), { code: 'auth_wrong_project' });
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw Object.assign(new Error('Sign-in token has expired. Sign in again.'), { code: 'auth_expired' });
  }
  if (!Number.isFinite(payload.iat) || payload.iat > now + 60) {
    throw Object.assign(new Error('Sign-in token has an invalid issue time.'), { code: 'auth_malformed' });
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw Object.assign(new Error('Sign-in token has no subject.'), { code: 'auth_malformed' });
  }

  const firebase = payload.firebase || {};
  const authTime = Number(payload.auth_time ?? firebase.auth_time ?? 0) || 0;

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.slice(0, 254) : '',
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : '',
    picture: typeof payload.picture === 'string' ? payload.picture.slice(0, 512) : '',
    authTime,
    signInProvider: typeof firebase.sign_in_provider === 'string' ? firebase.sign_in_provider : 'unknown',
  };
}

/** Extract a bearer token from either header spelling. */
export function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : '';
}

/** Display name fallback used for the private roster file. */
export function displayName(user) {
  const name = (user.name || '').trim();
  if (name) return name.slice(0, 80);
  const email = (user.email || '').trim();
  if (email.includes('@')) {
    return email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .slice(0, 80);
  }
  return 'HTMLTools user';
}

/** Small opaque fingerprint so the dashboard can show "which account" safely. */
export function userRef(uid) {
  return textToBase64url(String(uid)).slice(0, 10);
}
