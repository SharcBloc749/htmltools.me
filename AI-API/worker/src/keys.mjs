/**
 * htmltools.me API key format and hashing.
 *
 *   ht-<30 random characters>          e.g. ht-3jhnnuj2tgq8m4xwv7b2n5r0kd9fcs
 *   └── id shown to humans: ht-3jhnnuj2tg
 *
 * Only a salted hash is stored (plus, if escrow is explicitly enabled, an AES-GCM
 * ciphertext of the key). The plaintext key exists in the response body of the
 * create call and nowhere else.
 */

import { bytesToHex, constantTimeEqual } from './util.mjs';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i, l, o, 0, 1
const KEY_BODY_LENGTH = 30;
const ID_LENGTH = 10;

export const KEY_PREFIX = 'ht-';
export const KEY_PATTERN = /^ht-[a-z0-9]{30}$/;

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function generateKey() {
  return KEY_PREFIX + randomString(KEY_BODY_LENGTH);
}

/** The public identifier derived from a presented key. Safe to log and display. */
export function keyId(key) {
  if (!KEY_PATTERN.test(key)) return '';
  return key.slice(0, KEY_PREFIX.length + ID_LENGTH);
}

export function isWellFormedKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

export function newSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * SHA-256(salt || pepper || key). The pepper lives only in a Worker secret, so a
 * leaked roster file (private repo, backup, screenshot) cannot be brute-forced
 * into working keys without also leaking the Worker secret.
 */
export async function hashKey(key, salt, pepper) {
  if (!pepper) throw new Error('KEY_PEPPER secret is not configured.');
  const data = new TextEncoder().encode(`${salt}\u0000${pepper}\u0000${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

export async function verifyKey(key, record, pepper) {
  if (!isWellFormedKey(key) || !record?.hash || !record?.salt) return false;
  const candidate = await hashKey(key, record.salt, pepper);
  return constantTimeEqual(candidate, record.hash);
}

/** Human-readable label used in the roster header: "ht-3jhnnuj2tg - Name - email". */
export function keyLabel(record) {
  return `${record.id} - ${record.name || 'HTMLTools user'} - ${record.email || 'no email'}`;
}
