// htmltools.me AI API gateway — generated file, do not edit.
// Source: AI-API/worker/src/*.mjs  ·  rebuild with: npm run bundle
// Deploy with `npx wrangler deploy` (preferred) or paste into the
// Cloudflare dashboard editor together with the bindings listed in
// AI-API/worker/README.md.

// src/util.mjs
var DAY_MS = 864e5;
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
function oaiError(status, message, type, code, param = null) {
  return { error: { message, type, param, code } };
}
function errorResponse(status, message, type, code, headers = {}, param = null) {
  return json(oaiError(status, message, type, code, param), status, headers);
}
function nowSec() {
  return Math.floor(Date.now() / 1e3);
}
function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}
function nextUtcMidnight(ms = Date.now()) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
function newRequestId() {
  return "req_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}
function logEvent(env, event) {
  try {
    console.log(JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...event }));
  } catch {
    console.log('{"event":"log_failed"}');
  }
}
function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function bytesToBase64(buffer) {
  let s = "";
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s);
}
function base64ToBytes(value) {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function base64urlToBytes(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - value.length % 4);
  return base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
function textToBase64url(text) {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}
function estimateMessageTokens(messages) {
  let chars = 0;
  for (const m of messages || []) {
    if (typeof m?.content === "string") chars += m.content.length;
    else if (Array.isArray(m?.content)) chars += JSON.stringify(m.content).length;
    chars += 8;
  }
  return Math.max(1, Math.ceil(chars / 4));
}
async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    return { ok: false, status: 413, message: `Request body exceeds ${Math.floor(maxBytes / 1024)} KB.` };
  }
  let text = "";
  try {
    if (!request.body) {
      text = await request.text();
    } else {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {
          });
          return { ok: false, status: 413, message: `Request body exceeds ${Math.floor(maxBytes / 1024)} KB.` };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
  } catch {
    return { ok: false, status: 400, message: "Could not read request body." };
  }
  if (!text.trim()) return { ok: false, status: 400, message: "Request body must be a JSON object." };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, status: 400, message: "Request body must be a JSON object." };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, message: "Request body is not valid JSON." };
  }
}
function parseOrigins(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function originAllowed(origin, patterns) {
  if (!origin) return false;
  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern === origin) return true;
    if (pattern.startsWith("*.") && origin === pattern.slice(2)) return true;
    if (pattern.startsWith("*.") && origin.endsWith(pattern.slice(1))) return true;
  }
  return false;
}
function corsHeaders(request, env = {}, mode = "api") {
  const origin = request.headers.get("origin") || "";
  const isSite = mode === "site";
  const patterns = parseOrigins(
    isSite ? env.SITE_CORS_ORIGINS ?? "https://htmltools.me,https://www.htmltools.me" : env.API_CORS_ORIGINS ?? "*"
  );
  const headers = {
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-ht-admin-passphrase",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
  if (originAllowed(origin, patterns)) {
    headers["access-control-allow-origin"] = patterns.includes("*") ? "*" : origin;
  }
  return headers;
}

// src/firebase.mjs
var JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
var jwksCache = { keys: /* @__PURE__ */ new Map(), expiresAt: 0 };
function parseCacheMaxAge(response) {
  const cc = response.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  return m ? Number(m[1]) : 3600;
}
async function loadJwks(env, fetchImpl, force = false) {
  const now = Date.now();
  if (!force && jwksCache.keys.size && jwksCache.expiresAt > now) return jwksCache;
  const res = await fetchImpl(JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!res.ok) {
    if (jwksCache.keys.size) return jwksCache;
    throw new Error("Could not load Google signing keys.");
  }
  const body = await res.json();
  const keys = /* @__PURE__ */ new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    keys.set(jwk.kid, jwk);
  }
  if (!keys.size) throw new Error("Google signing key set was empty.");
  jwksCache = {
    keys,
    // Cap the cache at 12 h even if Google asks for longer, so key rotation and
    // revocation of the local copy have a bound.
    expiresAt: now + Math.min(parseCacheMaxAge(res), 12 * 3600) * 1e3
  };
  return jwksCache;
}
function decodeSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(segment)));
}
async function verifyIdToken(token, env, fetchImpl = fetch) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw Object.assign(new Error("Firebase project is not configured."), { code: "auth_misconfigured" });
  if (typeof token !== "string" || token.length < 40 || token.length > 8192) {
    throw Object.assign(new Error("Missing or malformed sign-in token."), { code: "auth_missing" });
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Malformed sign-in token."), { code: "auth_malformed" });
  let header2, payload;
  try {
    header2 = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw Object.assign(new Error("Malformed sign-in token."), { code: "auth_malformed" });
  }
  if (header2.alg !== "RS256" || typeof header2.kid !== "string") {
    throw Object.assign(new Error("Unsupported sign-in token."), { code: "auth_malformed" });
  }
  let jwks = await loadJwks(env, fetchImpl);
  let jwk = jwks.keys.get(header2.kid);
  if (!jwk) {
    jwks = await loadJwks(env, fetchImpl, true);
    jwk = jwks.keys.get(header2.kid);
  }
  if (!jwk) throw Object.assign(new Error("Unknown signing key."), { code: "auth_bad_signature" });
  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    throw Object.assign(new Error("Could not import signing key."), { code: "auth_verification_failed" });
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64urlToBytes(parts[2]), signed);
  } catch {
    valid = false;
  }
  if (!valid) throw Object.assign(new Error("Sign-in token signature is invalid."), { code: "auth_bad_signature" });
  const now = nowSec();
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss || payload.aud !== projectId) {
    throw Object.assign(new Error("Sign-in token is for a different Firebase project."), { code: "auth_wrong_project" });
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw Object.assign(new Error("Sign-in token has expired. Sign in again."), { code: "auth_expired" });
  }
  if (!Number.isFinite(payload.iat) || payload.iat > now + 60) {
    throw Object.assign(new Error("Sign-in token has an invalid issue time."), { code: "auth_malformed" });
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw Object.assign(new Error("Sign-in token has no subject."), { code: "auth_malformed" });
  }
  const firebase = payload.firebase || {};
  const authTime = Number(payload.auth_time ?? firebase.auth_time ?? 0) || 0;
  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email.slice(0, 254) : "",
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === "string" ? payload.name.slice(0, 120) : "",
    picture: typeof payload.picture === "string" ? payload.picture.slice(0, 512) : "",
    authTime,
    signInProvider: typeof firebase.sign_in_provider === "string" ? firebase.sign_in_provider : "unknown"
  };
}
function bearer(request) {
  const header2 = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header2.trim());
  return m ? m[1].trim() : "";
}
function displayName(user) {
  const name = (user.name || "").trim();
  if (name) return name.slice(0, 80);
  const email = (user.email || "").trim();
  if (email.includes("@")) {
    return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
  }
  return "HTMLTools user";
}
function userRef(uid) {
  return textToBase64url(String(uid)).slice(0, 10);
}

// src/keys.mjs
var ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
var KEY_BODY_LENGTH = 30;
var ID_LENGTH = 10;
var KEY_PREFIX = "ht-";
var KEY_PATTERN = /^ht-[a-z0-9]{30}$/;
function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
function generateKey() {
  return KEY_PREFIX + randomString(KEY_BODY_LENGTH);
}
function keyId(key) {
  if (!KEY_PATTERN.test(key)) return "";
  return key.slice(0, KEY_PREFIX.length + ID_LENGTH);
}
function isWellFormedKey(key) {
  return typeof key === "string" && KEY_PATTERN.test(key);
}
function newSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
async function hashKey(key, salt, pepper) {
  if (!pepper) throw new Error("KEY_PEPPER secret is not configured.");
  const data = new TextEncoder().encode(`${salt}\0${pepper}\0${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(digest);
}
async function verifyKey(key, record, pepper) {
  if (!isWellFormedKey(key) || !record?.hash || !record?.salt) return false;
  const candidate = await hashKey(key, record.salt, pepper);
  return constantTimeEqual(candidate, record.hash);
}
function keyLabel(record) {
  return `${record.id} - ${record.name || "HTMLTools user"} - ${record.email || "no email"}`;
}

// src/crypto.mjs
var MIN_SECRET_LENGTH = 24;
var HKDF_SALT = "htmltools.me/ai-api/v1";
function assertSecret(secret, name) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw Object.assign(new Error(`${name} is missing or too short (minimum ${MIN_SECRET_LENGTH} characters).`), {
      code: "crypto_misconfigured"
    });
  }
}
async function deriveAesKey(secret, context) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(context)
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptSecret(plaintext, secret, context, secretName = "encryption secret") {
  assertSecret(secret, secretName);
  const key = await deriveAesKey(secret, context);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { v: 1, iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}
async function decryptSecret(blob, secret, context, secretName = "encryption secret") {
  assertSecret(secret, secretName);
  if (!blob || blob.v !== 1 || !blob.iv || !blob.ct) {
    throw Object.assign(new Error("Stored ciphertext is malformed."), { code: "ciphertext_invalid" });
  }
  const key = await deriveAesKey(secret, context);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(blob.iv), additionalData: new TextEncoder().encode(context) },
      key,
      base64ToBytes(blob.ct)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw Object.assign(
      new Error("Stored ciphertext could not be decrypted with the current secret. The secret may have been rotated."),
      { code: "ciphertext_undecryptable" }
    );
  }
}
var byokContext = (uid, provider) => `byok:${provider}:${uid}`;
var escrowContext = (keyId2) => `escrow:${keyId2}`;

// src/models.mjs
var FREE_PROVIDER = "workers-ai";
var BYOK_PROVIDER = "groq";
var WORKERS_AI_MODELS = [
  {
    id: "@cf/meta/llama-3.2-3b-instruct",
    label: "Llama 3.2 3B Instruct",
    provider: FREE_PROVIDER,
    enabled: true,
    maxOutput: 768,
    contextChars: 48e3,
    supportsStream: true,
    supportsTools: false,
    neurons: { in: 3e3, out: 1e4 },
    note: "Cheapest free-pool model. Good for short answers, classification and HTSilo."
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B Instruct",
    provider: FREE_PROVIDER,
    enabled: true,
    maxOutput: 1024,
    contextChars: 96e3,
    supportsStream: true,
    supportsTools: true,
    neurons: { in: 4100, out: 34900 },
    note: "Default free-pool general model."
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B Instruct (FP8 Fast)",
    provider: FREE_PROVIDER,
    enabled: true,
    maxOutput: 1024,
    contextChars: 96e3,
    supportsStream: true,
    supportsTools: true,
    neurons: { in: 26700, out: 204800 },
    note: "Best free-pool quality, roughly 12\xD7 the Neuron cost of the 8B model."
  },
  {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    label: "Qwen2.5 Coder 32B Instruct",
    provider: FREE_PROVIDER,
    enabled: false,
    maxOutput: 1024,
    contextChars: 96e3,
    supportsStream: true,
    supportsTools: false,
    neurons: { in: 2e4, out: 12e4 },
    note: "Disabled by default: confirm the exact model id exists in your Workers AI catalogue before enabling."
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: FREE_PROVIDER,
    enabled: false,
    maxOutput: 1024,
    contextChars: 96e3,
    supportsStream: true,
    supportsTools: true,
    neurons: { in: 31800, out: 68200 },
    note: "Disabled by default: highest Neuron cost per request in the catalogue."
  }
];
var GROQ_MODELS = [
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant (Groq)",
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 96e3,
    supportsStream: true,
    supportsTools: true
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile (Groq)",
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128e3,
    supportsStream: true,
    supportsTools: true
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (Groq)",
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128e3,
    supportsStream: true,
    supportsTools: true
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128e3,
    supportsStream: true,
    supportsTools: true
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen3 32B (Groq)",
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128e3,
    supportsStream: true,
    supportsTools: true
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout 17B (Groq)",
    provider: BYOK_PROVIDER,
    maxOutput: 2048,
    contextChars: 128e3,
    supportsStream: true,
    supportsTools: true
  }
];
var AUTO_MODEL = "auto";
var AUTO_FREE_MODEL = "@cf/meta/llama-3.1-8b-instruct";
var AUTO_BYOK_MODEL = "llama-3.1-8b-instant";
var BY_ID = new Map([...WORKERS_AI_MODELS, ...GROQ_MODELS].map((m) => [m.id, m]));
function resolveModel(id) {
  if (typeof id !== "string") return null;
  const model = BY_ID.get(id);
  if (!model) return null;
  if (model.provider === FREE_PROVIDER && model.enabled === false) return null;
  return model;
}
function freePoolModels() {
  return WORKERS_AI_MODELS.filter((m) => m.enabled);
}
function estimateNeurons(model, inputTokens, outputTokens) {
  if (!model || model.provider !== FREE_PROVIDER) return 0;
  const rates = model.neurons || { in: 1e4, out: 5e4 };
  return Math.ceil((inputTokens * rates.in + outputTokens * rates.out) / 1e6);
}
function modelsPayload(env, { hasByok }) {
  const freeCap = Number(env.FREE_DAILY_NEURONS || 6e3);
  return {
    object: "list",
    data: [
      ...freePoolModels().map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "cloudflare-workers-ai",
        x_ht: {
          provider: FREE_PROVIDER,
          label: m.label,
          free_pool: true,
          available: true,
          streaming: m.supportsStream,
          tools: m.supportsTools,
          max_output_tokens: m.maxOutput,
          est_neurons_per_1k_in: Math.ceil(m.neurons.in / 1e3),
          daily_pool_neurons: freeCap
        }
      })),
      ...GROQ_MODELS.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "groq",
        x_ht: {
          provider: BYOK_PROVIDER,
          label: m.label,
          free_pool: false,
          available: Boolean(hasByok),
          requires_byok: true,
          streaming: m.supportsStream,
          tools: m.supportsTools,
          max_output_tokens: m.maxOutput
        }
      })),
      {
        id: AUTO_MODEL,
        object: "model",
        created: 0,
        owned_by: "htmltools",
        x_ht: {
          provider: "auto",
          label: "Auto (own Groq key first, then shared free pool)",
          free_pool: true,
          available: true,
          streaming: true,
          tools: false
        }
      }
    ]
  };
}

// src/providers.mjs
var GROQ_BASE = "https://api.groq.com/openai/v1";
var MAX_MESSAGES = 40;
var MAX_TOOLS = 16;
var MAX_TOOL_CHARS = 24e3;
var MAX_STRING_PART = 32e3;
function normalizeContent(content) {
  if (typeof content === "string") return { ok: true, value: content };
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== "object") return { ok: false, message: "Invalid message content part." };
      if (part.type === "text") {
        if (typeof part.text !== "string") return { ok: false, message: "Text content parts need a string `text`." };
        parts.push({ type: "text", text: part.text });
      } else {
        return {
          ok: false,
          message: `Content type "${String(part.type).slice(0, 40)}" is not supported by this gateway. Send text only.`,
          code: "unsupported_content"
        };
      }
    }
    return { ok: true, value: parts };
  }
  return { ok: false, message: "Message `content` must be a string or an array of text parts." };
}
function normalizeChatRequest(body, model) {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: "`messages` must be a non-empty array." };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, message: `At most ${MAX_MESSAGES} messages per request.` };
  }
  const normalized = [];
  let totalChars = 0;
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") return { ok: false, message: "Each message must be an object." };
    let role = String(raw.role || "");
    if (role === "developer") role = "system";
    if (!["system", "user", "assistant", "tool"].includes(role)) {
      return { ok: false, message: `Unsupported message role "${role.slice(0, 24)}".`, code: "invalid_message" };
    }
    const content = normalizeContent(raw.content ?? "");
    if (!content.ok) return { ok: false, message: content.message, code: content.code || "invalid_message" };
    const message = { role, content: content.value };
    if (role === "tool") {
      if (typeof raw.tool_call_id !== "string" || !raw.tool_call_id) {
        return { ok: false, message: "Tool messages need a `tool_call_id`." };
      }
      message.tool_call_id = raw.tool_call_id.slice(0, 64);
    }
    if (role === "assistant" && Array.isArray(raw.tool_calls)) {
      if (!model.supportsTools) {
        return { ok: false, message: `Model ${model.id} does not support tool calling on this gateway.`, code: "unsupported_feature" };
      }
      message.tool_calls = raw.tool_calls.slice(0, MAX_TOOLS).map((call) => ({
        id: String(call?.id || "").slice(0, 64),
        type: "function",
        function: {
          name: String(call?.function?.name || "").slice(0, 64),
          arguments: typeof call?.function?.arguments === "string" ? call.function.arguments.slice(0, MAX_STRING_PART) : "{}"
        }
      }));
    }
    if (typeof raw.name === "string") message.name = raw.name.slice(0, 64);
    totalChars += typeof message.content === "string" ? message.content.length : JSON.stringify(message.content).length;
    totalChars += JSON.stringify(message.tool_calls || "").length;
    normalized.push(message);
  }
  const contextCap = model.contextChars || 48e3;
  if (totalChars > contextCap) {
    return {
      ok: false,
      message: `Conversation is ${totalChars} characters; ${model.id} accepts about ${contextCap} on this gateway. Trim the history or start a new thread.`,
      code: "context_length_exceeded"
    };
  }
  let streams = false;
  if (body.stream !== void 0) {
    if (typeof body.stream !== "boolean") return { ok: false, message: "`stream` must be a boolean." };
    streams = body.stream;
  }
  let tools;
  if (body.tools !== void 0 && body.tools !== null) {
    if (!model.supportsTools) {
      return { ok: false, message: `Model ${model.id} does not support tool calling on this gateway.`, code: "unsupported_feature", param: "tools" };
    }
    if (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS) {
      return { ok: false, message: `\`tools\` must be an array of at most ${MAX_TOOLS} functions.`, param: "tools" };
    }
    const serialized = JSON.stringify(body.tools);
    if (serialized.length > MAX_TOOL_CHARS) {
      return { ok: false, message: "Tool schemas are too large.", code: "request_too_large", param: "tools" };
    }
    tools = body.tools.map((tool) => ({
      type: "function",
      function: {
        name: String(tool?.function?.name || "").slice(0, 64),
        description: tool?.function?.description ? String(tool.function.description).slice(0, 1024) : void 0,
        parameters: tool?.function?.parameters && typeof tool.function.parameters === "object" ? tool.function.parameters : { type: "object", properties: {} }
      }
    }));
    if (tools.some((t) => !/^[A-Za-z0-9_-]{1,64}$/.test(t.function.name))) {
      return { ok: false, message: "Tool function names must match [A-Za-z0-9_-]{1,64}.", param: "tools" };
    }
  }
  const requestedMax = body.max_completion_tokens ?? body.max_tokens;
  let maxTokens = Number.isFinite(Number(requestedMax)) ? Math.floor(Number(requestedMax)) : Math.min(512, model.maxOutput);
  maxTokens = Math.min(model.maxOutput, Math.max(1, maxTokens));
  if (body.n !== void 0 && Number(body.n) !== 1) {
    return { ok: false, message: "This gateway only supports n = 1.", code: "unsupported_parameter", param: "n" };
  }
  if (body.logprobs === true || body.top_logprobs) {
    return { ok: false, message: "logprobs are not supported by this gateway.", code: "unsupported_parameter", param: "logprobs" };
  }
  if (body.audio || body.modalities) {
    return { ok: false, message: "Audio and non-text modalities are not supported.", code: "unsupported_feature" };
  }
  let stop;
  if (typeof body.stop === "string") stop = [body.stop.slice(0, 64)];
  else if (Array.isArray(body.stop)) stop = body.stop.slice(0, 4).map((s) => String(s).slice(0, 64));
  const temperature = Number.isFinite(Number(body.temperature)) ? Math.min(2, Math.max(0, Number(body.temperature))) : 0.7;
  const topP = Number.isFinite(Number(body.top_p)) ? Math.min(1, Math.max(0, Number(body.top_p))) : void 0;
  let responseFormat;
  if (body.response_format && typeof body.response_format === "object") {
    if (body.response_format.type === "text") responseFormat = { type: "text" };
    else if (body.response_format.type === "json_object") responseFormat = { type: "json_object" };
    else return { ok: false, message: "Only response_format text and json_object are supported.", code: "unsupported_parameter", param: "response_format" };
  }
  return {
    ok: true,
    value: {
      messages: normalized,
      stream: streams,
      tools,
      toolChoice: typeof body.tool_choice === "string" || body.tool_choice && typeof body.tool_choice === "object" ? body.tool_choice : void 0,
      maxTokens,
      temperature,
      topP,
      stop,
      responseFormat,
      frequencyPenalty: Number.isFinite(Number(body.frequency_penalty)) ? Math.min(2, Math.max(-2, Number(body.frequency_penalty))) : void 0,
      presencePenalty: Number.isFinite(Number(body.presence_penalty)) ? Math.min(2, Math.max(-2, Number(body.presence_penalty))) : void 0,
      seed: Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : void 0,
      includeUsage: body?.stream_options?.include_usage === true,
      inputTokens: estimateMessageTokens(normalized) + estimateTokens(JSON.stringify(tools || ""))
    }
  };
}
function chunkId() {
  return "chatcmpl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}
function sseHeaders(requestId) {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId
  };
}
function sseResponse(stream, requestId) {
  return new Response(stream, { status: 200, headers: { ...sseHeaders(requestId) } });
}
function translateWorkersStream(rawStream, modelId, requestId, onUsage, inputTokens) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = chunkId();
  const created = nowSec();
  let buffer = "";
  let started = false;
  let finished = false;
  let outputChars = 0;
  let toolIndex = 0;
  let usageFromProvider = null;
  const frame = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}

`);
  const emit = (controller, delta, finishReason = null) => {
    controller.enqueue(frame({
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    }));
  };
  const start = (controller) => {
    if (started) return;
    started = true;
    emit(controller, { role: "assistant", content: "" });
  };
  const handleObject = (controller, object) => {
    if (!object || typeof object !== "object") return;
    start(controller);
    const choice = Array.isArray(object.choices) ? object.choices[0] : null;
    if (choice) {
      const delta = choice.delta || choice.message || {};
      const out = {};
      if (typeof delta.content === "string" && delta.content) {
        out.content = delta.content;
        outputChars += delta.content.length;
      }
      if (Array.isArray(delta.tool_calls)) out.tool_calls = delta.tool_calls;
      if (Object.keys(out).length) emit(controller, out);
      if (choice.finish_reason) {
        emit(controller, {}, choice.finish_reason);
        finished = true;
      }
      if (object.usage) usageFromProvider = object.usage;
      return;
    }
    if (typeof object.response === "string" && object.response) {
      outputChars += object.response.length;
      emit(controller, { content: object.response });
    }
    if (Array.isArray(object.tool_calls) && object.tool_calls.length) {
      emit(controller, {
        tool_calls: object.tool_calls.map((call) => ({
          index: toolIndex++,
          id: String(call.id || crypto.randomUUID()).slice(0, 64),
          type: "function",
          function: {
            name: String(call.name || call.function?.name || "").slice(0, 64),
            arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? call.function?.arguments ?? {})
          }
        }))
      });
    }
    if (object.usage) usageFromProvider = object.usage;
  };
  return new ReadableStream({
    async start(controller) {
      const reader = rawStream.getReader();
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line || line.startsWith(":")) continue;
            if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                handleObject(controller, JSON.parse(data));
              } catch {
              }
            }
          }
        }
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail.startsWith("data:")) {
          const data = tail.slice(5).trim();
          if (data && data !== "[DONE]") {
            try {
              handleObject(controller, JSON.parse(data));
            } catch {
            }
          }
        }
        start(controller);
        if (!finished) emit(controller, {}, "stop");
        if (usageFromProvider) {
          const usage = normalizeUsage(usageFromProvider, modelId, outputChars);
          controller.enqueue(frame({ id, object: "chat.completion.chunk", created, model: modelId, choices: [], usage }));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        try {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ error: { message: "The provider stream ended unexpectedly.", type: "upstream_error", code: "stream_failed" } })}

`
          ));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch {
        }
        controller.close();
      } finally {
        try {
          reader.releaseLock();
        } catch {
        }
        onUsage?.({
          inputTokens: usageFromProvider ? Number(usageFromProvider.prompt_tokens) || inputTokens : inputTokens,
          outputTokens: usageFromProvider ? Number(usageFromProvider.completion_tokens) || 0 : Math.ceil(outputChars / 4),
          providerUsage: Boolean(usageFromProvider)
        });
      }
    }
  });
}
function normalizeUsage(usage, modelId, outputChars = 0) {
  if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
    return {
      prompt_tokens: Number(usage.prompt_tokens) || 0,
      completion_tokens: Number(usage.completion_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0)
    };
  }
  const completion = Math.max(0, Math.ceil(outputChars / 4));
  return {
    prompt_tokens: Number(usage?.input_tokens) || 0,
    completion_tokens: completion,
    total_tokens: (Number(usage?.input_tokens) || 0) + completion
  };
}
function normalizeToolCalls(calls) {
  return calls.slice(0, MAX_TOOLS).map((call) => ({
    id: String(call.id || crypto.randomUUID()).slice(0, 64),
    type: "function",
    function: {
      name: String(call.name || call.function?.name || "").slice(0, 64),
      arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? call.function?.arguments ?? {})
    }
  }));
}
async function callWorkersAI(env, model, request, options = {}) {
  const requestId = options.requestId || "req_local";
  const input = {
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    stream: request.stream
  };
  if (request.topP !== void 0) input.top_p = request.topP;
  if (request.stop) input.stop = request.stop;
  if (request.responseFormat) input.response_format = request.responseFormat;
  if (request.tools) {
    input.tools = request.tools;
    if (request.toolChoice) input.tool_choice = request.toolChoice;
  }
  if (request.stream) {
    let usagePromise;
    const usage2 = new Promise((resolve) => {
      usagePromise = resolve;
    });
    const raw = await env.AI.run(model.id, input);
    if (!raw || typeof raw.getReader !== "function") {
      const body2 = normalizeWorkersResult(raw, model.id, request);
      const text = JSON.stringify(body2);
      const encoder = new TextEncoder();
      const stream2 = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: body2.id,
            object: "chat.completion.chunk",
            created: body2.created,
            model: body2.model,
            choices: [{ index: 0, delta: { role: "assistant", content: body2.choices[0].message.content || "" }, finish_reason: null }]
          })}

`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: body2.id,
            object: "chat.completion.chunk",
            created: body2.created,
            model: body2.model,
            choices: [{ index: 0, delta: {}, finish_reason: body2.choices[0].finish_reason }]
          })}

`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          usagePromise({ inputTokens: request.inputTokens, outputTokens: estimateTokens(text), providerUsage: false });
        }
      });
      return { response: sseResponse(stream2, requestId), usage: usage2, streamed: true };
    }
    const stream = translateWorkersStream(raw, model.id, requestId, usagePromise, request.inputTokens);
    return { response: sseResponse(stream, requestId), usage: usage2, streamed: true };
  }
  const result = await env.AI.run(model.id, input);
  const body = normalizeWorkersResult(result, model.id, request);
  const usage = {
    inputTokens: body.usage.prompt_tokens || request.inputTokens,
    outputTokens: body.usage.completion_tokens,
    providerUsage: Boolean(result?.usage)
  };
  return { response: Response.json(body, { headers: { "x-request-id": requestId } }), usage, streamed: false };
}
function normalizeWorkersResult(result, modelId, request) {
  if (!result || typeof result !== "object") {
    throw Object.assign(new Error("The model returned an empty response."), { code: "upstream_error" });
  }
  if (result.choices && Array.isArray(result.choices)) {
    const message2 = result.choices[0]?.message || { role: "assistant", content: "" };
    const outputChars = typeof message2.content === "string" ? message2.content.length : 0;
    return {
      id: result.id || chunkId(),
      object: "chat.completion",
      created: result.created || nowSec(),
      model: modelId,
      choices: [{
        index: 0,
        message: message2,
        finish_reason: result.choices[0]?.finish_reason || (message2.tool_calls ? "tool_calls" : "stop")
      }],
      usage: normalizeUsage(result.usage, modelId, outputChars)
    };
  }
  let text = result.response;
  if (typeof text !== "string") {
    text = typeof result.output_text === "string" ? result.output_text : "";
  }
  const toolCalls = Array.isArray(result.tool_calls) && result.tool_calls.length ? normalizeToolCalls(result.tool_calls) : void 0;
  const message = { role: "assistant", content: text || (toolCalls ? null : "") };
  if (toolCalls) message.tool_calls = toolCalls;
  const finish = toolCalls ? "tool_calls" : typeof result.finish_reason === "string" ? result.finish_reason : "stop";
  return {
    id: result.id || chunkId(),
    object: "chat.completion",
    created: result.created || nowSec(),
    model: modelId,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: result.usage ? normalizeUsage(result.usage, modelId, text.length) : {
      prompt_tokens: request.inputTokens,
      completion_tokens: Math.max(1, estimateTokens(text)),
      total_tokens: request.inputTokens + Math.max(1, estimateTokens(text))
    }
  };
}
async function callGroq(env, model, request, apiKey, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const requestId = options.requestId || "req_local";
  const payload = {
    model: model.id,
    messages: request.messages,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    stream: request.stream
  };
  if (request.topP !== void 0) payload.top_p = request.topP;
  if (request.stop) payload.stop = request.stop;
  if (request.tools) payload.tools = request.tools;
  if (request.toolChoice) payload.tool_choice = request.toolChoice;
  if (request.responseFormat) payload.response_format = request.responseFormat;
  if (request.frequencyPenalty !== void 0) payload.frequency_penalty = request.frequencyPenalty;
  if (request.presencePenalty !== void 0) payload.presence_penalty = request.presencePenalty;
  if (request.seed !== void 0) payload.seed = request.seed;
  if (request.stream) payload.stream_options = { include_usage: true };
  const upstream = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: request.stream ? "text/event-stream" : "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    let message = `Groq rejected the request (${upstream.status}).`;
    let code = "provider_error";
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) message = String(parsed.error.message).slice(0, 300);
      if (parsed?.error?.code) code = String(parsed.error.code).slice(0, 60);
    } catch {
    }
    const error = new Error(message);
    error.code = code;
    error.status = upstream.status === 429 ? 429 : 502;
    error.retryAfter = upstream.headers.get("retry-after");
    error.provider = "groq";
    throw error;
  }
  if (request.stream) {
    let resolveUsage;
    const usage2 = new Promise((resolve) => {
      resolveUsage = resolve;
    });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let chars = 0;
    let providerUsage = null;
    let buffer = "";
    const counted = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) providerUsage = parsed.usage;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string") chars += delta.length;
          } catch {
          }
        }
      },
      flush() {
        resolveUsage({
          inputTokens: providerUsage ? Number(providerUsage.prompt_tokens) || request.inputTokens : request.inputTokens,
          outputTokens: providerUsage ? Number(providerUsage.completion_tokens) || 0 : Math.ceil(chars / 4),
          providerUsage: Boolean(providerUsage)
        });
      }
    });
    return {
      response: new Response(upstream.body.pipeThrough(counted), { status: 200, headers: sseHeaders(requestId) }),
      usage: usage2,
      streamed: true
    };
  }
  const body = await upstream.json();
  const outputChars = typeof body?.choices?.[0]?.message?.content === "string" ? body.choices[0].message.content.length : 0;
  if (body && typeof body === "object") body.model = body.model || model.id;
  const usage = {
    inputTokens: body?.usage?.prompt_tokens ?? request.inputTokens,
    outputTokens: body?.usage?.completion_tokens ?? Math.ceil(outputChars / 4),
    providerUsage: Boolean(body?.usage)
  };
  return {
    response: Response.json(body, { headers: { "x-request-id": requestId } }),
    usage,
    streamed: false
  };
}
async function verifyGroqKey(apiKey, fetchImpl = fetch) {
  if (typeof apiKey !== "string" || !/^gsk_[A-Za-z0-9_-]{16,200}$/.test(apiKey)) {
    return { ok: false, message: "That does not look like a Groq API key (expected gsk_\u2026)." };
  }
  const res = await fetchImpl(`${GROQ_BASE}/models`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  if (res.status === 401 || res.status === 403) return { ok: false, message: "Groq rejected that key." };
  if (!res.ok) return { ok: false, message: `Groq returned ${res.status} while checking the key.` };
  return { ok: true };
}

// src/htsilo.mjs
var HTSILO_MODEL = "@cf/meta/llama-3.1-8b-instruct";
var BASE = "https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev/v1";
function htsiloSystemPrompt(page) {
  const where = typeof page === "string" ? page.replace(/[^\w/-]/g, "").slice(0, 60) : "";
  return [
    "You are HTSilo, the friendly helper built into htmltools.me AI API. You are concise, practical and encouraging.",
    "You answer questions about using the htmltools.me AI API, an OpenAI-compatible gateway.",
    "",
    "Facts you may rely on:",
    `- Base URL for OpenAI-compatible clients: ${BASE}`,
    "- Endpoints: GET /v1/models and POST /v1/chat/completions. Errors and responses use OpenAI formats.",
    "- Authentication: header `Authorization: Bearer ht-...` with a key the user creates at https://htmltools.me/AI-API/Dashboard/",
    "- Free shared pool models are Cloudflare Workers AI ids such as @cf/meta/llama-3.1-8b-instruct and @cf/meta/llama-3.3-70b-instruct-fp8-fast. They share one daily Neuron budget and stop working (HTTP 429, code free_pool_exhausted) when it runs out.",
    "- Users can connect their own Groq API key in the dashboard; Groq model ids (for example llama-3.3-70b-versatile) then run on their own account.",
    '- Streaming uses `"stream": true` and server-sent events. Tool calling works only on models marked as tool-capable.',
    "- Not supported: image or audio input, logprobs, n greater than 1, embeddings, and models outside the allowlist.",
    "- Limits: about 10 requests per minute per key and account, plus per-user daily caps and the shared daily budget.",
    "",
    "Rules:",
    "- Never ask for passwords, API keys, Groq keys or Firebase tokens. Tell the user to paste those only into the dashboard, never into chat.",
    "- If a user pastes a secret, tell them to revoke it.",
    "- Keep answers short: at most about 150 words or one small code block. Use plain text and fenced code blocks. No emoji.",
    where ? `- The user is currently on the ${where} page of the tool; tailor examples to that page when useful.` : ""
  ].filter(Boolean).join("\n");
}

// src/github.mjs
function githubConfigured(env) {
  return Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO);
}
function apiUrl(env, path) {
  const repo = env.GITHUB_REPO;
  const file = path || env.GITHUB_KEYS_PATH || "keys.js";
  const branch = env.GITHUB_BRANCH || "main";
  return `https://api.github.com/repos/${repo}/contents/${encodeURI(file)}?ref=${encodeURIComponent(branch)}`;
}
function authHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "htmltools-me-ai-api"
  };
}
async function readRepoFile(env, path, fetchImpl = fetch) {
  if (!githubConfigured(env)) return null;
  const res = await fetchImpl(apiUrl(env, path), {
    headers: authHeaders(env),
    cache: "no-store",
    cf: { cacheTtl: 0 }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}).`);
  const body = await res.json();
  const content = new TextDecoder().decode(base64ToBytes(String(body.content || "").replace(/\n/g, "")));
  return { content, sha: body.sha };
}
async function writeRepoFile(env, path, content, message, fetchImpl = fetch) {
  if (!githubConfigured(env)) return { skipped: true };
  const file = path || env.GITHUB_KEYS_PATH || "keys.js";
  const branch = env.GITHUB_BRANCH || "main";
  const existing = await readRepoFile(env, file, fetchImpl);
  if (existing && existing.content === content) return { unchanged: true };
  const put = async (sha) => fetchImpl(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURI(file)}`,
    {
      method: "PUT",
      headers: { ...authHeaders(env), "content-type": "application/json" },
      body: JSON.stringify({
        message: `${message} [skip ci]`,
        content: bytesToBase64(new TextEncoder().encode(content)),
        branch,
        ...sha ? { sha } : {}
      })
    }
  );
  let res = await put(existing?.sha);
  if (res.status === 409) {
    const fresh = await readRepoFile(env, file, fetchImpl);
    res = await put(fresh?.sha);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub write failed (${res.status}). ${text.slice(0, 200)}`);
  }
  return { written: true };
}
var header = () => [
  "// htmltools.me AI API \u2014 PRIVATE key roster.",
  "//",
  "// Generated by the gateway Worker. Do not edit by hand: the next sync overwrites",
  "// it. Plaintext API keys are NOT stored here \u2014 each record keeps a salted",
  "// SHA-256 hash. The full key is shown to its owner exactly once, at creation.",
  "//",
  "// Format: <key id> - <display name> - <email>",
  ""
].join("\n");
function renderKeysFile(records, meta = {}) {
  const lines = [header()];
  const active = records.filter((r) => !r.revoked);
  lines.push(...active.map((r) => `// ${keyLabel(r)}`));
  if (!active.length) lines.push("// (no active keys)");
  lines.push("");
  lines.push("/* eslint-disable */");
  lines.push("module.exports = " + JSON.stringify({
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    gateway: "htmltools-me-ai-api",
    count: records.length,
    active: active.length,
    day: meta.day || null,
    pool: meta.pool || null,
    keys: records.map((r) => ({
      id: r.id,
      salt: r.salt,
      hash: r.hash,
      uid: r.uid,
      name: r.name,
      email: r.email,
      label: r.label || "",
      created: r.created,
      lastUsed: r.lastUsed || null,
      revoked: Boolean(r.revoked),
      revokedAt: r.revokedAt || null,
      usage: r.usage || { requests: 0, tokens: 0 },
      ...r.escrow ? { escrow: r.escrow } : {}
    }))
  }, null, 2) + ";\n");
  return lines.join("\n");
}
function renderByokFile(records) {
  return [
    "// htmltools.me AI API \u2014 PRIVATE BYOK ciphertext store.",
    "//",
    "// Each entry is an AES-256-GCM ciphertext of a user-supplied Groq API key. The",
    "// encryption secret lives only in a Cloudflare Worker secret and is not in this",
    "// repository. Deleting an entry removes that user's stored provider key.",
    "",
    "/* eslint-disable */",
    "module.exports = " + JSON.stringify({
      generated: (/* @__PURE__ */ new Date()).toISOString(),
      cipher: "AES-256-GCM/HKDF-SHA-256",
      providers: records.map((r) => ({
        uid: r.uid,
        ref: r.ref,
        provider: r.provider,
        blob: r.blob,
        updated: r.updated,
        verified: Boolean(r.verified)
      }))
    }, null, 2) + ";\n"
  ].join("\n");
}
function parseKeysFile(content) {
  if (!content) return [];
  const start = content.indexOf("module.exports =");
  if (start < 0) return [];
  const body = content.slice(start + "module.exports =".length).replace(/;\s*$/, "");
  try {
    const data = JSON.parse(body);
    const keys = Array.isArray(data?.keys) ? data.keys : [];
    return keys.filter((k) => typeof k.id === "string" && typeof k.hash === "string" && typeof k.salt === "string").map((k) => ({
      id: k.id.slice(0, 16),
      salt: k.salt,
      hash: k.hash,
      uid: String(k.uid || "").slice(0, 128),
      name: String(k.name || "").slice(0, 80),
      email: String(k.email || "").slice(0, 254),
      label: typeof k.label === "string" ? k.label.slice(0, 80) : "",
      created: Number(k.created) || Date.now(),
      lastUsed: Number(k.lastUsed) || null,
      revoked: Boolean(k.revoked),
      revokedAt: Number(k.revokedAt) || null,
      usage: {
        requests: Number(k.usage?.requests) || 0,
        tokens: Number(k.usage?.tokens) || 0
      },
      ...k.escrow ? { escrow: k.escrow } : {}
    }));
  } catch {
    return [];
  }
}
function parseByokFile(content) {
  if (!content) return [];
  const start = content.indexOf("module.exports =");
  if (start < 0) return [];
  try {
    const data = JSON.parse(content.slice(start + "module.exports =".length).replace(/;\s*$/, ""));
    return Array.isArray(data?.providers) ? data.providers : [];
  } catch {
    return [];
  }
}

// src/state.mjs
var STORE_VERSION = 1;
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function limits(env) {
  return {
    dailyNeurons: num(env.FREE_DAILY_NEURONS, 6e3),
    dailyRequests: num(env.FREE_DAILY_REQUESTS, 1200),
    globalRpm: num(env.GLOBAL_RPM, 60),
    perKeyRpm: num(env.PER_KEY_RPM, 10),
    perUserRpm: num(env.PER_USER_RPM, 10),
    perUserDailyRequests: num(env.PER_USER_DAILY_REQUESTS, 150),
    perUserDailyNeurons: num(env.PER_USER_DAILY_NEURONS, 1200),
    byokDailyRequests: num(env.BYOK_DAILY_REQUESTS, 2e3),
    maxActiveKeys: num(env.MAX_ACTIVE_KEYS, 5),
    maxKeysPerDay: num(env.MAX_KEYS_PER_DAY, 10),
    htsiloDaily: num(env.HTSILO_DAILY_MESSAGES, 15),
    htsiloRpm: num(env.HTSILO_RPM, 4)
  };
}
var emptyCounters = (day) => ({
  day,
  requests: 0,
  neurons: 0,
  reserved: 0,
  pending: [],
  tokensIn: 0,
  tokensOut: 0,
  byKey: {},
  byUser: {},
  minutes: {},
  history: {}
});
var MINUTE = 6e4;
var GatewayState = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loaded = false;
    this.keys = /* @__PURE__ */ new Map();
    this.byok = /* @__PURE__ */ new Map();
    this.counters = emptyCounters(utcDay());
    this.limitWindows = /* @__PURE__ */ new Map();
    this.dirtyCounters = false;
    this.dirtyKeys = false;
    this.dirtyByok = false;
    this.lastSync = 0;
    this.lastSyncError = "";
    this.state.blockConcurrencyWhile(() => this.load());
  }
  /* ── lifecycle ─────────────────────────────────────────────────────────── */
  async load() {
    const [meta, counters] = await Promise.all([
      this.state.storage.get("meta"),
      this.state.storage.get("counters")
    ]);
    if (counters && counters.day) {
      this.counters = { ...emptyCounters(counters.day), ...counters };
    }
    const stored = await this.state.storage.list({ prefix: "key:" });
    for (const [, record] of stored) {
      if (record?.id) this.keys.set(record.id, record);
    }
    const storedByok = await this.state.storage.list({ prefix: "byok:" });
    for (const [, record] of storedByok) {
      if (record?.uid) this.byok.set(record.uid, record);
    }
    if (!this.keys.size && githubConfigured(this.env)) {
      try {
        const file = await readRepoFile(this.env, this.env.GITHUB_KEYS_PATH || "keys.js");
        const records = parseKeysFile(file?.content);
        if (records.length) {
          const writes = {};
          for (const record of records) {
            this.keys.set(record.id, record);
            writes[`key:${record.id}`] = record;
          }
          await this.state.storage.put(writes);
        }
        const byokFile = await readRepoFile(this.env, this.env.GITHUB_BYOK_PATH || "byok.js");
        for (const entry of parseByokFile(byokFile?.content)) {
          if (!entry?.uid) continue;
          const record = {
            uid: entry.uid,
            ref: entry.ref || "",
            provider: entry.provider || "groq",
            blob: entry.blob,
            updated: Number(entry.updated) || Date.now(),
            verified: Boolean(entry.verified)
          };
          this.byok.set(record.uid, record);
          await this.state.storage.put(`byok:${record.uid}`, record);
        }
      } catch {
      }
    }
    this.meta = { version: STORE_VERSION, ...meta || {} };
    await this.rollDayIfNeeded();
    this.loaded = true;
    await this.scheduleAlarm();
  }
  async scheduleAlarm() {
    const current = await this.state.storage.getAlarm();
    if (current === null || current === void 0) {
      await this.state.storage.setAlarm(Date.now() + 3e4);
    }
  }
  async saveCounters() {
    await this.state.storage.put("counters", this.counters);
    this.dirtyCounters = false;
  }
  async persistKey(record) {
    await this.state.storage.put(`key:${record.id}`, record);
    this.dirtyKeys = true;
  }
  async persistByok(record) {
    await this.state.storage.put(`byok:${record.uid}`, record);
    this.dirtyByok = true;
  }
  async rollDayIfNeeded() {
    const today = utcDay();
    if (this.counters.day === today) return false;
    const history = this.counters.history || {};
    history[this.counters.day] = {
      requests: this.counters.requests,
      neurons: this.counters.neurons,
      tokensIn: this.counters.tokensIn,
      tokensOut: this.counters.tokensOut
    };
    for (const day of Object.keys(history).sort().slice(0, -14)) delete history[day];
    this.counters = { ...emptyCounters(today), history };
    await this.saveCounters();
    return true;
  }
  pruneMinutes(now) {
    const cutoff = Math.floor(now / MINUTE) - 3;
    for (const key of Object.keys(this.counters.minutes)) {
      if (Number(key) < cutoff) delete this.counters.minutes[key];
    }
  }
  minuteBucket(now, create) {
    const key = String(Math.floor(now / MINUTE));
    let bucket = this.counters.minutes[key];
    if (!bucket && create) {
      bucket = { global: 0, keys: {}, users: {}, ips: {} };
      this.counters.minutes[key] = bucket;
    }
    return bucket;
  }
  /**
   * A stream that dies with the isolate, or a provider that never returns, would
   * otherwise hold its reservation for the rest of the UTC day. Expire anything
   * older than ten minutes before every decision.
   */
  pruneReservations(now) {
    if (!Array.isArray(this.counters.pending)) this.counters.pending = [];
    const cutoff = now - 10 * 6e4;
    const kept = [];
    for (const entry of this.counters.pending) {
      if (entry && entry.at >= cutoff) kept.push(entry);
      else this.counters.reserved = Math.max(0, this.counters.reserved - (entry?.amount || 0));
    }
    while (kept.length > 500) {
      const dropped = kept.shift();
      this.counters.reserved = Math.max(0, this.counters.reserved - (dropped?.amount || 0));
    }
    this.counters.pending = kept;
  }
  bump(map, key, by = 1) {
    map[key] = (map[key] || 0) + by;
    return map[key];
  }
  deny(status, code, message, extra = {}) {
    return {
      ok: false,
      status,
      code,
      message,
      retryAfter: extra.retryAfter ?? null,
      ...extra
    };
  }
  pool() {
    const l = limits(this.env);
    const remainingNeurons = Math.max(0, l.dailyNeurons - this.counters.neurons - this.counters.reserved);
    const remainingRequests = Math.max(0, l.dailyRequests - this.counters.requests);
    return {
      day: this.counters.day,
      budget: l.dailyNeurons,
      spent: this.counters.neurons,
      reserved: this.counters.reserved,
      remaining: remainingNeurons,
      requestsToday: this.counters.requests,
      requestCap: l.dailyRequests,
      requestsRemaining: remainingRequests,
      tokensIn: this.counters.tokensIn,
      tokensOut: this.counters.tokensOut,
      resetsAt: new Date(nextUtcMidnight()).toISOString()
    };
  }
  /* ── request handling ──────────────────────────────────────────────────── */
  async fetch(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ ok: false, code: "bad_request", message: "Malformed internal request." }, { status: 400 });
    }
    const op = new URL(request.url).pathname.replace(/^\//, "");
    try {
      const handler = this[`op_${op}`];
      if (typeof handler !== "function") {
        return Response.json({ ok: false, code: "unknown_op", message: "Unknown operation." }, { status: 404 });
      }
      const result = await handler.call(this, payload || {});
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { ok: false, code: error?.code || "internal_error", message: String(error?.message || error).slice(0, 300) },
        { status: 500 }
      );
    }
  }
  async op_authorize({
    key,
    ip = "",
    provider = "workers-ai",
    modelId = "",
    maxOutput = 512,
    inputTokens = 0,
    isFreePool = true,
    context = "api"
  }) {
    const now = Date.now();
    await this.rollDayIfNeeded();
    this.pruneMinutes(now);
    this.pruneReservations(now);
    const l = limits(this.env);
    const id = typeof key === "string" ? key.slice(0, 13) : "";
    const record = this.keys.get(id);
    if (!record) return this.deny(401, "invalid_api_key", "That API key is not valid. Create one at https://htmltools.me/AI-API/Dashboard/.");
    if (record.revoked) return this.deny(401, "key_revoked", "That API key has been revoked.");
    const valid = await verifyKey(key, record, this.env.KEY_PEPPER);
    if (!valid) return this.deny(401, "invalid_api_key", "That API key is not valid.");
    const bucket = this.minuteBucket(now, true);
    if ((bucket.keys[id] || 0) >= l.perKeyRpm) {
      const retry = Math.ceil((MINUTE - now % MINUTE) / 1e3);
      return this.deny(429, "rate_limit_exceeded", `This key allows ${l.perKeyRpm} requests per minute.`, { retryAfter: retry });
    }
    if ((bucket.users[record.uid] || 0) >= l.perUserRpm) {
      const retry = Math.ceil((MINUTE - now % MINUTE) / 1e3);
      return this.deny(429, "rate_limit_exceeded", `This account allows ${l.perUserRpm} requests per minute.`, { retryAfter: retry });
    }
    const userUsage = this.counters.byUser[record.uid] || { requests: 0, neurons: 0, tokens: 0 };
    const dailyCap = isFreePool ? l.perUserDailyRequests : l.byokDailyRequests;
    if (userUsage.requests >= dailyCap) {
      return this.deny(429, "user_daily_limit", `This account allows ${dailyCap} requests per UTC day.`, {
        retryAfter: Math.ceil((nextUtcMidnight() - now) / 1e3)
      });
    }
    let reserveNeurons = 0;
    let reservationId = null;
    if (isFreePool) {
      if ((bucket.global || 0) >= l.globalRpm) {
        const retry = Math.ceil((MINUTE - now % MINUTE) / 1e3);
        return this.deny(429, "site_rate_limit", "The shared gateway is at its per-minute limit. Retry shortly or connect your own Groq key.", { retryAfter: retry });
      }
      if (this.counters.requests >= l.dailyRequests) {
        return this.deny(429, "free_pool_exhausted", "The shared free pool reached its daily request cap. It resets at 00:00 UTC; connect your own Groq key to keep going.", {
          retryAfter: Math.ceil((nextUtcMidnight() - now) / 1e3)
        });
      }
      if (userUsage.neurons >= l.perUserDailyNeurons) {
        return this.deny(429, "user_daily_limit", "This account reached its daily share of the shared free pool. Connect your own Groq key or wait for the 00:00 UTC reset.", {
          retryAfter: Math.ceil((nextUtcMidnight() - now) / 1e3)
        });
      }
      const model = resolveModel(modelId);
      reserveNeurons = model ? estimateNeurons(model, inputTokens, maxOutput) : 100;
      if (this.counters.neurons + this.counters.reserved + reserveNeurons > l.dailyNeurons) {
        return this.deny(429, "free_pool_exhausted", "The shared free pool is out of budget for today. It resets at 00:00 UTC; connect your own Groq key to keep going.", {
          retryAfter: Math.ceil((nextUtcMidnight() - now) / 1e3),
          pool: this.pool()
        });
      }
      this.counters.reserved += reserveNeurons;
      reservationId = crypto.randomUUID();
      this.counters.pending.push({ id: reservationId, amount: reserveNeurons, at: now });
      this.bump(bucket, "global");
    }
    this.bump(bucket.keys, id);
    this.bump(bucket.users, record.uid);
    if (ip) this.bump(bucket.ips, ip);
    this.bump(this.counters.byKey, id);
    const countsUsage = context !== "models";
    if (countsUsage) {
      record.usage = record.usage || { requests: 0, tokens: 0 };
      record.usage.requests += 1;
    }
    if (isFreePool && countsUsage) this.counters.requests += 1;
    if (countsUsage) {
      this.counters.byUser[record.uid] = {
        requests: userUsage.requests + 1,
        neurons: userUsage.neurons,
        tokens: userUsage.tokens
      };
    }
    record.lastUsed = now;
    this.dirtyCounters = true;
    await this.persistKey(record);
    return {
      ok: true,
      keyId: id,
      uid: record.uid,
      name: record.name,
      email: record.email,
      reservation: reserveNeurons,
      reservationId,
      context,
      limits: {
        perKeyRpm: l.perKeyRpm,
        perUserRpm: l.perUserRpm,
        dailyRequests: dailyCap,
        remainingToday: Math.max(0, dailyCap - (userUsage.requests + (context === "models" ? 0 : 1))),
        freePool: this.pool()
      }
    };
  }
  async op_settle({
    keyId: keyId2 = "",
    uid = "",
    reservation = 0,
    reservationId = null,
    isFreePool = true,
    inputTokens = 0,
    outputTokens = 0,
    success = true
  }) {
    const now = Date.now();
    await this.rollDayIfNeeded();
    if (isFreePool) {
      if (Array.isArray(this.counters.pending)) {
        const index = this.counters.pending.findIndex((entry) => entry && entry.id === reservationId);
        if (index >= 0) {
          const [entry] = this.counters.pending.splice(index, 1);
          this.counters.reserved = Math.max(0, this.counters.reserved - (entry.amount || 0));
        } else {
          this.counters.reserved = Math.max(0, this.counters.reserved - reservation);
        }
      } else {
        this.counters.reserved = Math.max(0, this.counters.reserved - reservation);
      }
      if (success) this.counters.neurons += Math.max(0, reservation);
    }
    this.counters.tokensIn += Math.max(0, inputTokens);
    this.counters.tokensOut += Math.max(0, outputTokens);
    const record = keyId2 ? this.keys.get(keyId2) : null;
    if (record && success) {
      record.usage = record.usage || { requests: 0, tokens: 0 };
      record.usage.tokens += Math.max(0, inputTokens) + Math.max(0, outputTokens);
      await this.persistKey(record);
    }
    if (uid) {
      const usage = this.counters.byUser[uid] || { requests: 0, neurons: 0, tokens: 0 };
      usage.neurons += isFreePool && success ? Math.max(0, reservation) : 0;
      usage.tokens += Math.max(0, inputTokens) + Math.max(0, outputTokens);
      this.counters.byUser[uid] = usage;
    }
    this.dirtyCounters = true;
    return { ok: true, pool: this.pool() };
  }
  async op_siteAuthorize({ uid, ip = "", provider = "workers-ai", modelId = "", maxOutput = 320, inputTokens = 0, kind = "htsilo" }) {
    const now = Date.now();
    await this.rollDayIfNeeded();
    this.pruneMinutes(now);
    this.pruneReservations(now);
    const l = limits(this.env);
    const bucket = this.minuteBucket(now, true);
    const userRpm = kind === "htsilo" ? l.htsiloRpm : l.perUserRpm;
    if ((bucket.users[uid] || 0) >= userRpm) {
      return this.deny(429, "rate_limit_exceeded", `Slow down: ${userRpm} requests per minute.`, {
        retryAfter: Math.ceil((MINUTE - now % MINUTE) / 1e3)
      });
    }
    const usage = this.counters.byUser[uid] || { requests: 0, neurons: 0, tokens: 0 };
    const dailyCap = kind === "htsilo" ? l.htsiloDaily : l.perUserDailyRequests;
    if (usage.requests >= dailyCap) {
      return this.deny(429, "user_daily_limit", `Daily limit reached (${dailyCap} messages).`, {
        retryAfter: Math.ceil((nextUtcMidnight() - now) / 1e3)
      });
    }
    if ((bucket.global || 0) >= l.globalRpm) {
      return this.deny(429, "site_rate_limit", "The gateway is busy right now. Try again in a moment.", {
        retryAfter: Math.ceil((MINUTE - now % MINUTE) / 1e3)
      });
    }
    const model = resolveModel(modelId);
    const reservation = model ? estimateNeurons(model, inputTokens, maxOutput) : 50;
    if (this.counters.neurons + this.counters.reserved + reservation > l.dailyNeurons) {
      return this.deny(429, "free_pool_exhausted", "The free pool is empty for today. It resets at 00:00 UTC.", {
        retryAfter: Math.ceil((nextUtcMidnight() - now) / 1e3),
        pool: this.pool()
      });
    }
    this.counters.reserved += reservation;
    const reservationId = crypto.randomUUID();
    this.counters.pending.push({ id: reservationId, amount: reservation, at: now });
    this.bump(bucket, "global");
    this.bump(bucket.users, uid);
    if (ip) this.bump(bucket.ips, ip);
    this.counters.requests += 1;
    this.counters.byUser[uid] = {
      requests: usage.requests + 1,
      neurons: usage.neurons,
      tokens: usage.tokens
    };
    this.dirtyCounters = true;
    return {
      ok: true,
      uid,
      reservation,
      reservationId,
      remaining: Math.max(0, dailyCap - (usage.requests + 1)),
      pool: this.pool()
    };
  }
  /* ── key management ────────────────────────────────────────────────────── */
  async op_createKey({ uid, name, email, label = "", salt, hash, escrow = null, keyId: keyId2 = "" }) {
    await this.rollDayIfNeeded();
    const l = limits(this.env);
    if (!uid || !salt || !hash || !keyId2) return { ok: false, code: "bad_request", message: "Missing key material." };
    const active = [...this.keys.values()].filter((r) => r.uid === uid && !r.revoked);
    if (active.length >= l.maxActiveKeys) {
      return { ok: false, code: "key_limit", message: `You can have ${l.maxActiveKeys} active keys. Revoke one first.` };
    }
    const now = Date.now();
    const createdToday = [...this.keys.values()].filter((r) => r.uid === uid && now - r.created < DAY_MS).length;
    if (createdToday >= l.maxKeysPerDay) {
      return { ok: false, code: "key_limit", message: `Limit of ${l.maxKeysPerDay} new keys per day reached.` };
    }
    if (this.keys.has(keyId2)) return { ok: false, code: "key_collision", message: "Please retry: identifier collision." };
    const record = {
      id: keyId2,
      salt,
      hash,
      uid,
      name: String(name || "HTMLTools user").slice(0, 80),
      email: String(email || "").slice(0, 254),
      label: String(label || "").slice(0, 80),
      created: now,
      lastUsed: null,
      revoked: false,
      revokedAt: null,
      usage: { requests: 0, tokens: 0 },
      ...escrow ? { escrow } : {}
    };
    this.keys.set(record.id, record);
    await this.persistKey(record);
    await this.syncGithub({ force: true }).catch(() => {
    });
    return { ok: true, record: this.publicRecord(record) };
  }
  publicRecord(record) {
    return {
      id: record.id,
      label: record.label,
      created: record.created,
      lastUsed: record.lastUsed,
      revoked: Boolean(record.revoked),
      revokedAt: record.revokedAt,
      usage: record.usage || { requests: 0, tokens: 0 },
      recoverable: Boolean(record.escrow)
    };
  }
  async op_ownerForKey({ keyId: keyId2 }) {
    const record = this.keys.get(keyId2);
    if (!record || record.revoked) return { ok: false, code: "invalid_api_key" };
    return { ok: true, hasByok: this.byok.has(record.uid) };
  }
  async op_limitCheck({ scope = "misc", key = "", limit = 30, windowSec = 60 }) {
    const now = Date.now();
    const id = `${scope}:${key}`;
    let entry = this.limitWindows.get(id);
    if (!entry || entry.reset <= now) {
      entry = { count: 1, reset: now + windowSec * 1e3 };
      this.limitWindows.set(id, entry);
      if (this.limitWindows.size > 5e3) {
        for (const [k, v] of this.limitWindows) if (v.reset <= now) this.limitWindows.delete(k);
      }
      return { ok: true, remaining: limit - 1 };
    }
    if (entry.count >= limit) {
      return { ok: false, code: "rate_limit_exceeded", retryAfter: Math.ceil((entry.reset - now) / 1e3) };
    }
    entry.count += 1;
    return { ok: true, remaining: Math.max(0, limit - entry.count) };
  }
  async op_listKeys({ uid }) {
    const records = [...this.keys.values()].filter((r) => r.uid === uid).sort((a, b) => b.created - a.created).map((r) => this.publicRecord(r));
    return { ok: true, keys: records, pool: this.pool() };
  }
  async op_revokeKey({ uid, keyId: keyId2, asAdmin = false }) {
    const record = this.keys.get(keyId2);
    if (!record) return { ok: false, code: "not_found", message: "No such key." };
    if (!asAdmin && record.uid !== uid) return { ok: false, code: "forbidden", message: "That key belongs to another account." };
    if (!record.revoked) {
      record.revoked = true;
      record.revokedAt = Date.now();
      await this.persistKey(record);
      await this.syncGithub({ force: true }).catch(() => {
      });
    }
    return { ok: true, record: this.publicRecord(record) };
  }
  async op_getKey({ keyId: keyId2, uid, asAdmin = false }) {
    const record = this.keys.get(keyId2);
    if (!record) return { ok: false, code: "not_found", message: "No such key." };
    if (!asAdmin && record.uid !== uid) return { ok: false, code: "forbidden", message: "That key belongs to another account." };
    return { ok: true, record };
  }
  async op_usage({ uid }) {
    const keys = [...this.keys.values()].filter((r) => r.uid === uid);
    const user = this.counters.byUser[uid] || { requests: 0, neurons: 0, tokens: 0 };
    const l = limits(this.env);
    return {
      ok: true,
      usage: {
        today: {
          requests: user.requests,
          tokens: user.tokens,
          neurons: user.neurons,
          freePoolRequests: user.requests
        },
        limits: {
          requestsPerDay: l.perUserDailyRequests,
          requestsPerMinute: l.perUserRpm,
          neuronsPerDay: l.perUserDailyNeurons,
          maxActiveKeys: l.maxActiveKeys
        },
        keys: keys.length,
        activeKeys: keys.filter((k) => !k.revoked).length,
        history: this.counters.history,
        pool: this.pool()
      }
    };
  }
  /* ── BYOK ──────────────────────────────────────────────────────────────── */
  async op_byokSet({ uid, ref = "", provider = "groq", blob, verified = false }) {
    if (!uid || !blob) return { ok: false, code: "bad_request", message: "Missing key material." };
    const record = { uid, ref, provider, blob, updated: Date.now(), verified: Boolean(verified) };
    this.byok.set(uid, record);
    await this.persistByok(record);
    await this.syncGithub({ force: true }).catch(() => {
    });
    return { ok: true, provider, updated: record.updated, verified: record.verified };
  }
  async op_byokGet({ uid }) {
    const record = this.byok.get(uid);
    if (!record) return { ok: false, code: "no_byok", message: "No provider key is connected." };
    return { ok: true, record };
  }
  async op_byokStatus({ uid }) {
    const record = this.byok.get(uid);
    return {
      ok: true,
      connected: Boolean(record),
      provider: record?.provider || null,
      updated: record?.updated || null,
      verified: Boolean(record?.verified)
    };
  }
  async op_byokDelete({ uid }) {
    const record = this.byok.get(uid);
    this.byok.delete(uid);
    await this.state.storage.delete(`byok:${uid}`);
    this.dirtyByok = true;
    await this.syncGithub({ force: true }).catch(() => {
    });
    return { ok: true, removed: Boolean(record) };
  }
  /* ── admin / public ────────────────────────────────────────────────────── */
  async op_roster() {
    const records = [...this.keys.values()].sort((a, b) => b.created - a.created);
    return {
      ok: true,
      keys: records,
      byok: [...this.byok.values()].map((r) => ({ uid: r.uid, ref: r.ref, provider: r.provider, updated: r.updated, verified: r.verified })),
      pool: this.pool(),
      sync: { configured: githubConfigured(this.env), lastSync: this.lastSync, error: this.lastSyncError }
    };
  }
  async op_adminStats() {
    const keys = [...this.keys.values()];
    const users = new Set(keys.map((k) => k.uid));
    return {
      ok: true,
      totals: {
        keys: keys.length,
        activeKeys: keys.filter((k) => !k.revoked).length,
        users: users.size,
        byokUsers: this.byok.size,
        requestsToday: this.counters.requests,
        neuronsToday: this.counters.neurons,
        tokensIn: this.counters.tokensIn,
        tokensOut: this.counters.tokensOut
      },
      pool: this.pool(),
      sync: { configured: githubConfigured(this.env), lastSync: this.lastSync, error: this.lastSyncError }
    };
  }
  async op_publicStatus({ models = [] } = {}) {
    const pool = this.pool();
    return {
      ok: true,
      pool: {
        budget: pool.budget,
        spent: pool.spent,
        remaining: pool.remaining,
        percentRemaining: pool.budget ? Math.round(pool.remaining / pool.budget * 100) : 0,
        requestsToday: pool.requestsToday,
        requestCap: pool.requestCap,
        resetsAt: pool.resetsAt,
        exhausted: pool.remaining <= 0 || pool.requestsRemaining <= 0
      },
      models,
      updated: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async op_syncNow() {
    const result = await this.syncGithub({ force: true });
    return { ok: true, ...result };
  }
  /* ── GitHub mirror ─────────────────────────────────────────────────────── */
  async syncGithub({ force = false } = {}) {
    if (!githubConfigured(this.env)) return { skipped: "not_configured" };
    if (!this.dirtyKeys && !this.dirtyByok && !force) return { skipped: "clean" };
    if (!force && Date.now() - this.lastSync < 15e3) return { skipped: "coalesced" };
    try {
      if (this.dirtyKeys || force) {
        const records = [...this.keys.values()].sort((a, b) => a.created - b.created);
        const body = renderKeysFile(records, { day: this.counters.day, pool: this.pool() });
        await writeRepoFile(this.env, this.env.GITHUB_KEYS_PATH || "keys.js", body, "Update API key roster");
        this.dirtyKeys = false;
      }
      if (this.dirtyByok || force) {
        const body = renderByokFile([...this.byok.values()]);
        await writeRepoFile(this.env, this.env.GITHUB_BYOK_PATH || "byok.js", body, "Update BYOK ciphertext store");
        this.dirtyByok = false;
      }
      this.lastSync = Date.now();
      this.lastSyncError = "";
      return { synced: true };
    } catch (error) {
      this.lastSyncError = String(error?.message || error).slice(0, 200);
      return { error: this.lastSyncError };
    }
  }
  /* ── alarm: checkpoint counters, retry the mirror ──────────────────────── */
  async alarm() {
    try {
      await this.rollDayIfNeeded();
      if (this.dirtyCounters) await this.saveCounters();
      await this.syncGithub();
    } catch {
    } finally {
      await this.state.storage.setAlarm(Date.now() + 3e4);
    }
  }
};

// src/index.mjs
var VERSION = "1.0.0";
var MAX_CHAT_BODY = 128 * 1024;
var MAX_ACCOUNT_BODY = 8 * 1024;
var FRESH_AUTH_SECONDS = 300;
function doStub(env) {
  if (!env.GATEWAY) throw Object.assign(new Error("Gateway storage binding is missing."), { code: "misconfigured" });
  return env.GATEWAY.get(env.GATEWAY.idFromName("global"));
}
async function doCall(env, op, payload) {
  const res = await doStub(env).fetch(`https://gateway.internal/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    let message = "Gateway storage error.";
    try {
      message = (await res.json()).message || message;
    } catch {
    }
    throw Object.assign(new Error(message), { code: "storage_error" });
  }
  return res.json();
}
function finalize(response, request, env, requestId, mode = "api", extra = {}) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env, mode))) headers.set(k, v);
  headers.set("x-request-id", requestId);
  for (const [k, v] of Object.entries(extra)) {
    if (v === void 0 || v === null) continue;
    headers.set(k, String(v));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function apiError(status, message, type, code, headers = {}) {
  return errorResponse(status, message, type, code, headers);
}
function quotaError(result, requestId) {
  const headers = {};
  if (result.retryAfter) headers["retry-after"] = String(result.retryAfter);
  if (result.pool) {
    headers["x-ht-pool-remaining"] = String(result.pool.remaining ?? "");
  }
  const type = result.status === 401 ? "invalid_request_error" : "insufficient_quota";
  return {
    response: apiError(result.status, result.message, type, result.code, headers),
    headers
  };
}
function adminList(env, name) {
  return String(env[name] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isAdmin(user, env) {
  if (!user) return false;
  if (adminList(env, "ADMIN_UIDS").includes(String(user.uid).toLowerCase())) return true;
  if (user.emailVerified && adminList(env, "ADMIN_EMAILS").includes(String(user.email).toLowerCase())) return true;
  return false;
}
function authFailure(error) {
  const code = error?.code || "auth_failed";
  const map = {
    auth_missing: [401, "Sign in first: this endpoint needs a Firebase ID token."],
    auth_malformed: [401, "That sign-in token is not valid. Sign in again."],
    auth_expired: [401, "Your session expired. Sign in again."],
    auth_wrong_project: [401, "That account belongs to a different Firebase project. Use the AI-API sign-in."],
    auth_bad_signature: [401, "That sign-in token failed verification. Sign in again."],
    auth_verification_failed: [401, "Could not verify sign-in token. Try again shortly."],
    auth_misconfigured: [500, "Sign-in is not configured on the server yet."]
  };
  const [status, message] = map[code] || [401, "Sign-in could not be verified."];
  return { status, message, code };
}
async function requireUser(request, env) {
  try {
    const user = await verifyIdToken(bearer(request), env, env.__fetch || fetch);
    return { ok: true, user };
  } catch (error) {
    return { ok: false, ...authFailure(error) };
  }
}
function requireFresh(user) {
  if (!user.authTime) return false;
  return Date.now() / 1e3 - user.authTime <= FRESH_AUTH_SECONDS;
}
function requirePassphrase(request, env) {
  if (!env.ADMIN_PASSPHRASE) return { ok: false, code: "admin_disabled" };
  const supplied = request.headers.get("x-ht-admin-passphrase") || "";
  if (supplied.length !== env.ADMIN_PASSPHRASE.length) return { ok: false, code: "bad_passphrase" };
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied.charCodeAt(i) ^ env.ADMIN_PASSPHRASE.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, code: "bad_passphrase" };
}
async function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
function tooManyRequests(message = "Too many requests. Retry in a minute.", retryAfter = 60) {
  return { response: apiError(429, message, "rate_limit_exceeded", "rate_limit_exceeded", { "retry-after": String(retryAfter) }), headers: { "retry-after": String(retryAfter) } };
}
var publicStatusCache = { at: 0, body: null };
async function handlePublicStatus(request, env, requestId) {
  if (publicStatusCache.body && Date.now() - publicStatusCache.at < 1e4) {
    return finalize(json(publicStatusCache.body, 200, { "cache-control": "public, max-age=10" }), request, env, requestId, "api");
  }
  const status = await doCall(env, "publicStatus", {
    models: modelsPayload(env, { hasByok: true }).data.map((m) => ({
      id: m.id,
      label: m.x_ht.label,
      provider: m.x_ht.provider,
      free: m.x_ht.free_pool,
      requires_byok: Boolean(m.x_ht.requires_byok),
      available: m.x_ht.free_pool,
      streaming: m.x_ht.streaming,
      tools: m.x_ht.tools,
      max_output_tokens: m.x_ht.max_output_tokens
    }))
  });
  publicStatusCache = { at: Date.now(), body: status };
  return finalize(json(status, 200, { "cache-control": "public, max-age=10" }), request, env, requestId, "api");
}
async function handleModels(request, env, requestId) {
  const key = bearer(request);
  if (!key) return finalize(apiError(401, "Missing API key. Send `Authorization: Bearer ht-\u2026`.", "invalid_request_error", "invalid_api_key"), request, env, requestId);
  const auth = await doCall(env, "authorize", {
    key,
    ip: "",
    provider: "workers-ai",
    modelId: "",
    maxOutput: 0,
    inputTokens: 0,
    isFreePool: false,
    context: "models"
  });
  if (!auth.ok) return finalize(quotaError(auth).response, request, env, requestId);
  const byok = await doCall(env, "byokStatus", { uid: auth.uid });
  const payload = modelsPayload(env, { hasByok: Boolean(byok.connected) });
  return finalize(json(payload, 200, { "cache-control": "no-store" }), request, env, requestId, "api", {
    "x-ratelimit-limit-requests": String(auth.limits?.perKeyRpm ?? "")
  });
}
async function handleChat(request, env, ctx, requestId) {
  const key = bearer(request);
  if (!key) return finalize(apiError(401, "Missing API key. Send `Authorization: Bearer ht-\u2026`.", "invalid_request_error", "invalid_api_key"), request, env, requestId);
  const body = await readJson(request, MAX_CHAT_BODY);
  if (!body.ok) {
    return finalize(apiError(body.status, body.message, "invalid_request_error", "invalid_request"), request, env, requestId);
  }
  let modelId = typeof body.value.model === "string" ? body.value.model.trim() : "";
  if (!modelId) return finalize(apiError(400, "`model` is required. Call GET /v1/models for the allowlist.", "invalid_request_error", "model_required", {}, "model"), request, env, requestId);
  let autoResolved = null;
  if (modelId === AUTO_MODEL) {
    const probeUid = keyId(key);
    if (!probeUid) return finalize(apiError(401, "That API key is not valid.", "invalid_request_error", "invalid_api_key"), request, env, requestId);
    const owner = await doCall(env, "ownerForKey", { keyId: probeUid });
    autoResolved = owner?.ok && owner.hasByok ? AUTO_BYOK_MODEL : AUTO_FREE_MODEL;
    modelId = autoResolved;
  }
  const model = resolveModel(modelId);
  if (!model) {
    return finalize(apiError(400, `Model "${modelId.slice(0, 80)}" is not on this gateway's allowlist. See GET /v1/models.`, "invalid_request_error", "model_not_found", {}, "model"), request, env, requestId);
  }
  const normalized = normalizeChatRequest(body.value, model);
  if (!normalized.ok) {
    return finalize(apiError(400, normalized.message, "invalid_request_error", normalized.code || "invalid_request", {}, normalized.param || null), request, env, requestId);
  }
  const req = normalized.value;
  const isFreePool = model.provider === "workers-ai";
  const ip = await clientIp(request);
  const auth = await doCall(env, "authorize", {
    key,
    ip,
    provider: model.provider,
    modelId: model.id,
    maxOutput: req.maxTokens,
    inputTokens: req.inputTokens,
    isFreePool,
    context: "chat"
  });
  if (!auth.ok) {
    logEvent(env, { event: "denied", code: auth.code, model: model.id, day: utcDay() });
    return finalize(quotaError(auth).response, request, env, requestId);
  }
  const usageHeaders = {
    "x-ratelimit-limit-requests": String(auth.limits?.perKeyRpm ?? ""),
    "x-ht-pool-remaining": String(auth.limits?.freePool?.remaining ?? ""),
    "x-ht-daily-remaining": String(auth.limits?.remainingToday ?? "")
  };
  const settle = async (usage2) => {
    await doCall(env, "settle", {
      keyId: auth.keyId,
      uid: auth.uid,
      reservation: auth.reservation,
      reservationId: auth.reservationId,
      isFreePool,
      inputTokens: usage2.inputTokens || req.inputTokens,
      outputTokens: usage2.outputTokens || 0,
      success: true
    }).catch(() => {
    });
  };
  const started = Date.now();
  let result;
  try {
    if (model.provider === "workers-ai") {
      result = await callWorkersAI(env, model, req, { requestId });
    } else {
      const stored = await doCall(env, "byokGet", { uid: auth.uid });
      if (!stored.ok) {
        await doCall(env, "settle", { keyId: auth.keyId, uid: auth.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool: false, success: false }).catch(() => {
        });
        return finalize(apiError(400, "This model needs your own Groq API key. Connect one at https://htmltools.me/AI-API/Dashboard/.", "invalid_request_error", "provider_not_connected", {}, "model"), request, env, requestId);
      }
      const groqKey = await decryptSecret(stored.record.blob, env.BYOK_ENCRYPTION_KEY, byokContext(auth.uid, "groq"), "BYOK_ENCRYPTION_KEY");
      result = await callGroq(env, model, req, groqKey, { requestId, fetchImpl: env.__fetch || fetch });
    }
  } catch (error) {
    await doCall(env, "settle", { keyId: auth.keyId, uid: auth.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool, success: false }).catch(() => {
    });
    logEvent(env, { event: "provider_error", provider: model.provider, model: model.id, code: String(error?.code || "error").slice(0, 60), ms: Date.now() - started });
    const status = Number(error?.status) || (error?.code === "ciphertext_undecryptable" ? 409 : 502);
    const message = String(error?.message || "The provider request failed.").slice(0, 300);
    return finalize(apiError(status, message, "upstream_error", error?.code || "provider_error"), request, env, requestId);
  }
  if (result.streamed) {
    ctx.waitUntil(result.usage.then(settle).catch(() => {
    }));
    logEvent(env, { event: "chat", stream: true, provider: model.provider, model: model.id, key: auth.keyId, ms: Date.now() - started, pool: auth.limits?.freePool?.remaining });
    return finalize(result.response, request, env, requestId, "api", usageHeaders);
  }
  const usage = await result.usage;
  await settle(usage);
  logEvent(env, {
    event: "chat",
    stream: false,
    provider: model.provider,
    model: model.id,
    key: auth.keyId,
    in: usage.inputTokens,
    out: usage.outputTokens,
    ms: Date.now() - started
  });
  return finalize(result.response, request, env, requestId, "api", usageHeaders);
}
async function handleAccount(request, env, ctx, requestId, path, user) {
  const ip = await clientIp(request);
  const limited = await doCall(env, "limitCheck", { scope: "account", key: `${user.uid}:${ip}`, limit: 40, windowSec: 60 }).catch(() => ({ ok: true }));
  if (!limited.ok) return finalize(tooManyRequests().response, request, env, requestId, "site");
  if (path === "/account/me" && request.method === "GET") {
    const byok = await doCall(env, "byokStatus", { uid: user.uid });
    return finalize(json({
      uid: user.uid,
      ref: userRef(user.uid),
      name: displayName(user),
      email: user.email,
      emailVerified: user.emailVerified,
      provider: user.signInProvider,
      admin: isAdmin(user, env),
      fresh: requireFresh(user),
      byok: { connected: Boolean(byok.connected), provider: byok.provider, updated: byok.updated, verified: byok.verified },
      baseUrl: new URL(request.url).origin + "/v1",
      pool: (await doCall(env, "publicStatus", { models: [] })).pool
    }), request, env, requestId, "site");
  }
  if (path === "/account/keys" && request.method === "GET") {
    const keys = await doCall(env, "listKeys", { uid: user.uid });
    const usage = await doCall(env, "usage", { uid: user.uid });
    return finalize(json({ keys: keys.keys, usage: usage.usage, escrow: Boolean(env.KEY_ESCROW_SECRET) }), request, env, requestId, "site");
  }
  if (path === "/account/keys" && request.method === "POST") {
    const body = await readJson(request, MAX_ACCOUNT_BODY);
    if (!body.ok) return finalize(apiError(body.status, body.message, "invalid_request_error", "invalid_request"), request, env, requestId, "site");
    const label = typeof body.value.label === "string" ? body.value.label.trim().slice(0, 60) : "";
    if (!env.KEY_PEPPER) {
      return finalize(apiError(500, "Key creation is not configured on the server (KEY_PEPPER secret missing).", "server_error", "misconfigured"), request, env, requestId, "site");
    }
    const plaintext = generateKey();
    const id = keyId(plaintext);
    const salt = newSalt();
    const hash = await hashKey(plaintext, salt, env.KEY_PEPPER);
    let escrow = null;
    if (env.KEY_ESCROW_SECRET) {
      escrow = await encryptSecret(plaintext, env.KEY_ESCROW_SECRET, escrowContext(id), "KEY_ESCROW_SECRET").catch(() => null);
    }
    const created = await doCall(env, "createKey", {
      uid: user.uid,
      name: displayName(user),
      email: user.email,
      label,
      salt,
      hash,
      escrow,
      keyId: id
    });
    if (!created.ok) return finalize(apiError(400, created.message, "invalid_request_error", created.code || "key_limit"), request, env, requestId, "site");
    logEvent(env, { event: "key_created", key: id, user: userRef(user.uid) });
    return finalize(json({
      key: plaintext,
      id,
      record: created.record,
      notice: "Copy this key now. It cannot be shown again unless escrow is enabled by the operator.",
      baseUrl: new URL(request.url).origin + "/v1"
    }, 201), request, env, requestId, "site");
  }
  const keyMatch = /^\/account\/keys\/(ht-[a-z0-9]{10})\/(revoke|reveal)$/.exec(path);
  if (keyMatch) {
    if (request.method !== "POST") return finalize(apiError(405, "Use POST for this endpoint.", "invalid_request_error", "method_not_allowed"), request, env, requestId, "site");
    const [, id, action] = keyMatch;
    if (action === "revoke") {
      const result = await doCall(env, "revokeKey", { uid: user.uid, keyId: id });
      if (!result.ok) return finalize(apiError(result.code === "forbidden" ? 403 : 404, result.message, "invalid_request_error", result.code), request, env, requestId, "site");
      logEvent(env, { event: "key_revoked", key: id, user: userRef(user.uid) });
      return finalize(json({ revoked: true, record: result.record }), request, env, requestId, "site");
    }
    if (!requireFresh(user)) {
      return finalize(apiError(403, "Confirm your password again (sign in within the last 5 minutes) to view a key.", "invalid_request_error", "reauth_required"), request, env, requestId, "site");
    }
    if (!env.KEY_ESCROW_SECRET) {
      return finalize(apiError(409, "Keys are stored as one-way hashes on this deployment, so they cannot be shown again. Create a new key instead.", "invalid_request_error", "key_not_recoverable"), request, env, requestId, "site");
    }
    const limitedReveal = await doCall(env, "limitCheck", { scope: "reveal", key: `${user.uid}:${id}`, limit: 5, windowSec: 300 });
    if (!limitedReveal.ok) return finalize(tooManyRequests("Too many reveal attempts. Try again in a few minutes.").response, request, env, requestId, "site");
    const record = await doCall(env, "getKey", { keyId: id, uid: user.uid });
    if (!record.ok) return finalize(apiError(record.code === "forbidden" ? 403 : 404, record.message, "invalid_request_error", record.code), request, env, requestId, "site");
    if (!record.record.escrow) {
      return finalize(apiError(409, "This key was created before escrow was enabled, so it cannot be shown again.", "invalid_request_error", "key_not_recoverable"), request, env, requestId, "site");
    }
    try {
      const plaintext = await decryptSecret(record.record.escrow, env.KEY_ESCROW_SECRET, escrowContext(id), "KEY_ESCROW_SECRET");
      logEvent(env, { event: "key_revealed", key: id, user: userRef(user.uid) });
      return finalize(json({ key: plaintext, id }), request, env, requestId, "site");
    } catch {
      return finalize(apiError(409, "This key could not be decrypted. The escrow secret may have been rotated.", "server_error", "ciphertext_undecryptable"), request, env, requestId, "site");
    }
  }
  if (path === "/account/usage" && request.method === "GET") {
    const usage = await doCall(env, "usage", { uid: user.uid });
    return finalize(json(usage.usage), request, env, requestId, "site");
  }
  if (path === "/account/byok") {
    if (request.method === "GET") {
      const status = await doCall(env, "byokStatus", { uid: user.uid });
      return finalize(json({ ...status, encryptionConfigured: Boolean(env.BYOK_ENCRYPTION_KEY) }), request, env, requestId, "site");
    }
    if (request.method === "POST") {
      if (!requireFresh(user)) return finalize(apiError(403, "Confirm your password again to store a provider key.", "invalid_request_error", "reauth_required"), request, env, requestId, "site");
      if (!env.BYOK_ENCRYPTION_KEY) return finalize(apiError(500, "BYOK encryption is not configured on the server.", "server_error", "misconfigured"), request, env, requestId, "site");
      const body = await readJson(request, MAX_ACCOUNT_BODY);
      if (!body.ok) return finalize(apiError(body.status, body.message, "invalid_request_error", "invalid_request"), request, env, requestId, "site");
      const provider = String(body.value.provider || "groq");
      if (provider !== "groq") return finalize(apiError(400, 'Only provider "groq" is supported.', "invalid_request_error", "unsupported_provider"), request, env, requestId, "site");
      const apiKey = typeof body.value.key === "string" ? body.value.key.trim() : "";
      const verified = await verifyGroqKey(apiKey, env.__fetch || fetch);
      if (!verified.ok) return finalize(apiError(400, verified.message, "invalid_request_error", "invalid_provider_key"), request, env, requestId, "site");
      const blob = await encryptSecret(apiKey, env.BYOK_ENCRYPTION_KEY, byokContext(user.uid, "groq"), "BYOK_ENCRYPTION_KEY");
      const stored = await doCall(env, "byokSet", { uid: user.uid, ref: userRef(user.uid), provider: "groq", blob, verified: true });
      logEvent(env, { event: "byok_saved", user: userRef(user.uid) });
      return finalize(json({ connected: true, provider: "groq", updated: stored.updated, verified: true }), request, env, requestId, "site");
    }
    if (request.method === "DELETE") {
      await doCall(env, "byokDelete", { uid: user.uid });
      logEvent(env, { event: "byok_deleted", user: userRef(user.uid) });
      return finalize(json({ connected: false }), request, env, requestId, "site");
    }
  }
  return finalize(apiError(404, "No such account endpoint.", "invalid_request_error", "not_found"), request, env, requestId, "site");
}
async function handleAdmin(request, env, requestId, path, user) {
  if (!isAdmin(user, env)) {
    return finalize(apiError(403, "This endpoint is restricted to the gateway operator.", "invalid_request_error", "forbidden"), request, env, requestId, "site");
  }
  if (!requireFresh(user)) {
    return finalize(apiError(403, "Sign in again within the last 5 minutes to use admin tools.", "invalid_request_error", "reauth_required"), request, env, requestId, "site");
  }
  const pass = requirePassphrase(request, env);
  if (!pass.ok) {
    return finalize(apiError(
      pass.code === "admin_disabled" ? 503 : 403,
      pass.code === "admin_disabled" ? "Admin tools are disabled: set the ADMIN_PASSPHRASE secret and re-deploy." : "Admin passphrase is missing or incorrect.",
      "invalid_request_error",
      pass.code
    ), request, env, requestId, "site");
  }
  if (path === "/admin/roster" && request.method === "GET") {
    const roster = await doCall(env, "roster", {});
    return finalize(json({
      ...roster,
      escrow: Boolean(env.KEY_ESCROW_SECRET),
      keys: roster.keys.map((k) => ({
        id: k.id,
        uid: k.uid,
        name: k.name,
        email: k.email,
        label: k.label,
        created: k.created,
        lastUsed: k.lastUsed,
        revoked: Boolean(k.revoked),
        revokedAt: k.revokedAt,
        usage: k.usage,
        recoverable: Boolean(k.escrow)
      }))
    }), request, env, requestId, "site");
  }
  if (path === "/admin/stats" && request.method === "GET") {
    return finalize(json(await doCall(env, "adminStats", {})), request, env, requestId, "site");
  }
  if (path === "/admin/sync" && request.method === "POST") {
    return finalize(json(await doCall(env, "syncNow", {})), request, env, requestId, "site");
  }
  const adminReveal = /^\/admin\/keys\/(ht-[a-z0-9]{10})\/reveal$/.exec(path);
  if (adminReveal && request.method === "POST") {
    if (!env.KEY_ESCROW_SECRET) {
      return finalize(apiError(409, "Escrow is not enabled on this deployment, so keys cannot be recovered.", "invalid_request_error", "key_not_recoverable"), request, env, requestId, "site");
    }
    const limited = await doCall(env, "limitCheck", { scope: "admin-reveal", key: `admin:${user.uid}`, limit: 10, windowSec: 300 });
    if (!limited.ok) return finalize(tooManyRequests("Too many reveal attempts. Try again in a few minutes.").response, request, env, requestId, "site");
    const record = await doCall(env, "getKey", { keyId: adminReveal[1], asAdmin: true });
    if (!record.ok) return finalize(apiError(404, record.message, "invalid_request_error", record.code), request, env, requestId, "site");
    if (!record.record.escrow) {
      return finalize(apiError(409, "That key was created before escrow was enabled, so it cannot be recovered.", "invalid_request_error", "key_not_recoverable"), request, env, requestId, "site");
    }
    try {
      const plaintext = await decryptSecret(record.record.escrow, env.KEY_ESCROW_SECRET, escrowContext(adminReveal[1]), "KEY_ESCROW_SECRET");
      logEvent(env, { event: "key_revealed_admin", key: adminReveal[1], user: userRef(user.uid) });
      return finalize(json({ key: plaintext, id: adminReveal[1], owner: { name: record.record.name, email: record.record.email } }), request, env, requestId, "site");
    } catch {
      return finalize(apiError(409, "This key could not be decrypted. The escrow secret may have been rotated.", "server_error", "ciphertext_undecryptable"), request, env, requestId, "site");
    }
  }
  const revoke = /^\/admin\/keys\/(ht-[a-z0-9]{10})\/revoke$/.exec(path);
  if (revoke && request.method === "POST") {
    const result = await doCall(env, "revokeKey", { keyId: revoke[1], asAdmin: true });
    if (!result.ok) return finalize(apiError(404, result.message, "invalid_request_error", result.code), request, env, requestId, "site");
    logEvent(env, { event: "key_revoked_admin", key: revoke[1] });
    return finalize(json({ revoked: true, record: result.record }), request, env, requestId, "site");
  }
  return finalize(apiError(404, "No such admin endpoint.", "invalid_request_error", "not_found"), request, env, requestId, "site");
}
async function handleHtsilo(request, env, requestId, user) {
  if (String(env.HTSILO_ENABLED || "true") === "false") {
    return finalize(apiError(503, "HTSilo is switched off right now.", "server_error", "disabled"), request, env, requestId, "site");
  }
  const body = await readJson(request, 16 * 1024);
  if (!body.ok) return finalize(apiError(body.status, body.message, "invalid_request_error", "invalid_request"), request, env, requestId, "site");
  const raw = Array.isArray(body.value.messages) ? body.value.messages.slice(-8) : [];
  const messages = [];
  let chars = 0;
  for (const message of raw) {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = typeof message?.content === "string" ? message.content.slice(0, 2e3) : "";
    if (!content.trim()) continue;
    chars += content.length;
    messages.push({ role, content });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return finalize(apiError(400, '"messages" must end with a user message.', "invalid_request_error", "invalid_request"), request, env, requestId, "site");
  }
  if (chars > 4e3) {
    return finalize(apiError(413, "That message is too long for HTSilo (4,000 characters max).", "invalid_request_error", "request_too_large"), request, env, requestId, "site");
  }
  const model = resolveModel(env.HTSILO_MODEL || HTSILO_MODEL);
  if (!model) return finalize(apiError(503, "HTSilo model is not enabled.", "server_error", "model_not_found"), request, env, requestId, "site");
  const ip = await clientIp(request);
  const auth = await doCall(env, "siteAuthorize", {
    uid: user.uid,
    ip,
    provider: "workers-ai",
    modelId: model.id,
    maxOutput: 320,
    inputTokens: Math.ceil(chars / 4),
    kind: "htsilo"
  });
  if (!auth.ok) {
    const retry = auth.retryAfter ? { "retry-after": String(auth.retryAfter) } : {};
    return finalize(apiError(auth.status, auth.message, "insufficient_quota", auth.code, retry), request, env, requestId, "site");
  }
  const prompt = {
    messages: [{ role: "system", content: htsiloSystemPrompt(body.value.page) }, ...messages],
    maxTokens: 320,
    temperature: 0.6,
    stream: false,
    inputTokens: Math.ceil(chars / 4)
  };
  try {
    const result = await callWorkersAI(env, model, prompt, { requestId });
    const payload = await result.response.json();
    const usage = await result.usage;
    await doCall(env, "settle", {
      keyId: "",
      uid: user.uid,
      reservation: auth.reservation,
      reservationId: auth.reservationId,
      isFreePool: true,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      success: true
    }).catch(() => {
    });
    return finalize(json({
      reply: payload.choices?.[0]?.message?.content || "I did not get an answer that time \u2014 try asking again.",
      remaining: auth.remaining,
      model: model.id
    }), request, env, requestId, "site");
  } catch (error) {
    await doCall(env, "settle", { keyId: "", uid: user.uid, reservation: auth.reservation, reservationId: auth.reservationId, isFreePool: true, success: false }).catch(() => {
    });
    return finalize(apiError(502, "HTSilo could not reach the model. Try again in a moment.", "upstream_error", "provider_error"), request, env, requestId, "site");
  }
}
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const requestId = newRequestId();
    if (request.method === "OPTIONS") {
      const mode = path.startsWith("/v1") ? "api" : "site";
      return new Response(null, { status: 204, headers: { ...corsHeaders(request, env, mode), "x-request-id": requestId } });
    }
    try {
      if (path === "/health" && request.method === "GET") {
        return finalize(json({ ok: true, service: "htmltools-me-ai-api", version: VERSION }), request, env, requestId, "site", { "cache-control": "no-store" });
      }
      if (path === "/public/status" && request.method === "GET") {
        return await handlePublicStatus(request, env, requestId);
      }
      if (path === "/v1/models" && request.method === "GET") {
        return await handleModels(request, env, requestId);
      }
      if (path === "/v1/chat/completions") {
        if (request.method !== "POST") {
          return finalize(apiError(405, "Use POST for /v1/chat/completions.", "invalid_request_error", "method_not_allowed", { allow: "POST" }), request, env, requestId);
        }
        return await handleChat(request, env, ctx, requestId);
      }
      const needsUser = path.startsWith("/account") || path.startsWith("/admin") || path === "/htsilo/chat";
      if (needsUser) {
        const auth = await requireUser(request, env);
        if (!auth.ok) {
          return finalize(apiError(auth.status, auth.message, "invalid_request_error", auth.code), request, env, requestId, "site");
        }
        if (path.startsWith("/account")) return await handleAccount(request, env, ctx, requestId, path, auth.user);
        if (path.startsWith("/admin")) return await handleAdmin(request, env, requestId, path, auth.user);
        if (path === "/htsilo/chat") {
          if (request.method !== "POST") {
            return finalize(apiError(405, "Use POST for /htsilo/chat.", "invalid_request_error", "method_not_allowed"), request, env, requestId, "site");
          }
          return await handleHtsilo(request, env, requestId, auth.user);
        }
      }
      if (path.startsWith("/v1")) {
        return finalize(apiError(404, `No such API endpoint: ${path.slice(0, 60)}. See https://htmltools.me/AI-API/Docs/.`, "invalid_request_error", "not_found"), request, env, requestId);
      }
      return finalize(json({ error: { message: "Not found.", type: "invalid_request_error", code: "not_found" } }, 404), request, env, requestId, "site");
    } catch (error) {
      logEvent(env, { event: "unhandled", code: String(error?.code || "error").slice(0, 60), message: String(error?.message || "").slice(0, 120) });
      return finalize(
        apiError(500, "The gateway hit an unexpected error. If it persists, the operator needs to check the Worker logs.", "server_error", "internal_error"),
        request,
        env,
        requestId,
        path.startsWith("/v1") ? "api" : "site"
      );
    }
  }
};
export {
  GatewayState,
  index_default as default
};
