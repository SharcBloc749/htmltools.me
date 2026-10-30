# Worker source — htmltools.me AI API

Runtime: Cloudflare Workers (module syntax, no build step). Static pages live one
directory up; the full operator runbook, deployment steps and security model are in
[`../README.md`](../README.md).

```bash
npm test        # 31 tests, no network, no credentials
npx wrangler dev
npx wrangler deploy
npx wrangler tail
```

## File map

| File | Responsibility |
| --- | --- |
| `src/index.mjs` | Router + all HTTP handlers. Explicit allowlist; unknown paths 404. Exports `GatewayState`. |
| `src/state.mjs` | Durable Object: key hashes, revocation, rate windows, Neuron budget with reserve/settle, BYOK blobs, counters, GitHub sync alarm. |
| `src/firebase.mjs` | Verifies Firebase ID tokens against Google's public JWKS. No Admin SDK, no service account. |
| `src/keys.mjs` | `ht-` key format, id derivation, salted SHA-256 hashing, verification. |
| `src/crypto.mjs` | HKDF-SHA-256 → AES-256-GCM for BYOK blobs and optional escrow. Context binds ciphertext to uid/key id. |
| `src/github.mjs` | Private-repo roster: read/write `keys.js` and `byok.js`, render/parse helpers. |
| `src/models.mjs` | The only model tables. Provider, caps, tool support and estimated Neuron rates. |
| `src/providers.mjs` | Request validation, Workers AI call + OpenAI translation (including SSE), Groq proxy, key check. |
| `src/htsilo.mjs` | Fixed system prompt and model for the in-site helper. |
| `src/util.mjs` | JSON/error envelopes, CORS, body limits, hex/base64, timing-safe compare. |

## Invariants the tests protect

1. No route reaches `env.AI.run` without a valid `ht-` key or a verified Firebase session.
2. `env.AI.run` appears only in `providers.mjs`; `index.mjs` never calls a provider directly.
3. The model tables are closed — there is no `startsWith('@cf/')` pass-through.
4. Every `/v1` error uses the OpenAI envelope and carries a stable `code`.
5. Prompt and completion text never reach the logger.
6. A Durable Object restart rehydrates keys and revocations from storage (and, if empty,
   from the private roster).

## Request lifecycle (chat)

```
POST /v1/chat/completions
  → bearer format check
  → body parse (128 KB cap) + allowlist + parameter clamps
  → DO authorize: key hash → rpm → daily caps → reserve Neurons → counters
  → provider call (Workers AI binding, or Groq with decrypted BYOK key)
  → stream (usage settles when the stream closes) or JSON (settles inline)
  → response with x-request-id, x-ratelimit-*, x-ht-* headers
```

Errors from the provider refund the Neuron reservation (`success:false`) and return
`502 upstream_error`; quota denials happen **before** the provider call, so a 429 never
costs a Neuron.

## Local notes

- `node --test tests/` uses a real `GatewayState` with in-memory storage, a mock `AI`
  binding and locally signed RS256 tokens. No Cloudflare account is touched.
- `wrangler dev` will not have `AI`, `GATEWAY` or the secrets unless you provide them;
  use `--local` with a `.dev.vars` file (git-ignored) if you need a live-ish loop.
  Never commit `.dev.vars`.
