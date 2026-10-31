export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export function error(status, code, message) {
  return json({ error: { code, message } }, status);
}

export function base64ToText(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function textToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readJson(request, maxBytes = 16_000) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) return { ok: false, response: error(413, 'body_too_large', 'Request is too large.') };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, response: error(413, 'body_too_large', 'Request is too large.') };
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, response: error(400, 'invalid_json', 'Request body must be JSON.') }; }
}

export function safeDomain(value) {
  if (typeof value !== 'string' || value.length > 253) return null;
  let parsed;
  try { parsed = new URL(value.includes('://') ? value : `https://${value}`); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !host.includes('.')) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return null;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}

export function normalizePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://silo.invalid');
    if (url.origin !== 'https://silo.invalid') return null;
    return url.pathname;
  } catch { return null; }
}
