/**
 * Authenticated encryption for user-supplied provider keys (BYOK) and, if the
 * operator opts in, optional key escrow.
 *
 * Key management:
 *   - `BYOK_ENCRYPTION_KEY` and `KEY_ESCROW_SECRET` are Worker secrets. They live in
 *     Cloudflare's encrypted secret store, never in this repository, never in the
 *     browser and never in the GitHub roster file.
 *   - The AES-256-GCM key is derived with HKDF-SHA-256 from that secret plus a
 *     context string that includes the Firebase uid (and the key id for escrow), so
 *     a ciphertext copied onto another user's record fails to decrypt.
 *   - Every record has its own random 96-bit IV; the context string is also used as
 *     additional authenticated data.
 *   - Deleting a user's Groq key deletes the ciphertext. Rotating the secret makes
 *     every stored ciphertext undecryptable (users must re-enter their keys), which
 *     is the documented rotation behaviour.
 */

import { base64ToBytes, bytesToBase64 } from './util.mjs';

const MIN_SECRET_LENGTH = 24;
const HKDF_SALT = 'htmltools.me/ai-api/v1';

function assertSecret(secret, name) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw Object.assign(new Error(`${name} is missing or too short (minimum ${MIN_SECRET_LENGTH} characters).`), {
      code: 'crypto_misconfigured',
    });
  }
}

async function deriveAesKey(secret, context) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(context),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** @returns {Promise<{v:number, iv:string, ct:string}>} */
export async function encryptSecret(plaintext, secret, context, secretName = 'encryption secret') {
  assertSecret(secret, secretName);
  const key = await deriveAesKey(secret, context);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

export async function decryptSecret(blob, secret, context, secretName = 'encryption secret') {
  assertSecret(secret, secretName);
  if (!blob || blob.v !== 1 || !blob.iv || !blob.ct) {
    throw Object.assign(new Error('Stored ciphertext is malformed.'), { code: 'ciphertext_invalid' });
  }
  const key = await deriveAesKey(secret, context);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(blob.iv), additionalData: new TextEncoder().encode(context) },
      key,
      base64ToBytes(blob.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw Object.assign(
      new Error('Stored ciphertext could not be decrypted with the current secret. The secret may have been rotated.'),
      { code: 'ciphertext_undecryptable' },
    );
  }
}

export const byokContext = (uid, provider) => `byok:${provider}:${uid}`;
export const escrowContext = keyId => `escrow:${keyId}`;
