# Worker source — htmltools.me AI API

Runtime: Cloudflare Workers. The source is ten ES modules in `src/`; `worker.js` in this
directory is the **generated single-file bundle** (see [Single-file deploy](#single-file-deploy-workerjs)).
Static pages live one directory up; the full operator runbook, deployment steps and
security model are in [`../README.md`](../README.md).

```bash
npm install     # wrangler + esbuild
npm test        # 42 tests, no network, no credentials
npm run bundle  # regenerate worker.js from src/
npm run doctor  # check a deployed gateway and print the exact fix
npx wrangler dev
npx wrangler deploy
npx wrangler tail
```

## File map

| File | Responsibility |
| --- | --- |
| `src/index.mjs` | Router + all HTTP handlers, readiness (`/health`), and actionable 503s. Explicit allowlist; unknown paths 404. Re-exports `GatewayState`. |
| `src/state.mjs` | Durable Object: key hashes, revocation, rate windows, Neuron budget with reserve/settle, BYOK blobs, counters, GitHub sync alarm. |
| `src/firebase.mjs` | Verifies Firebase ID tokens against Google's public JWKS. No Admin SDK, no service account. |
| `src/keys.mjs` | `ht-` key format, id derivation, salted SHA-256 hashing, verification. |
| `src/crypto.mjs` | HKDF-SHA-256 → AES-256-GCM for BYOK blobs and optional escrow. Context binds ciphertext to uid/key id. |
| `src/github.mjs` | Private-repo roster: read/write `keys.js` and `byok.js`, render/parse helpers. |
| `src/models.mjs` | The only model tables. Provider, caps, tool support and estimated Neuron rates. |
| `src/providers.mjs` | Request validation, Workers AI call + OpenAI translation (including SSE), Groq proxy, key check. |
| `src/siloai.mjs` | SiloAI: fixed system prompt, model id, and the branded base URL it quotes. |
| `src/util.mjs` | JSON/error envelopes, CORS, body limits, hex/base64, timing-safe compare. |
| `scripts/bundle.mjs` | esbuild build that produces the single-file `worker.js`. |
| `worker.js` | **Generated.** The whole Worker in one pasteable module. Never edit by hand. |

## Single-file deploy (`worker.js`)

Two ways to ship this Worker. Both run the same code.

### A. wrangler (recommended)

```bash
cd AI-API/worker
npm install
npx wrangler login
npx wrangler deploy
```

wrangler reads `wrangler.toml`, uploads all ten modules, creates the
`htmltools-me-ai-api` Worker and the `GatewayState` Durable Object, and keeps the
bindings in sync. Redeploys are one command, and `npx wrangler rollback` undoes them.

### B. Dashboard editor (single file)

If you cannot run commands locally, deploy `worker.js` by hand. It is the entire Worker —
all ten modules inlined, no imports left — so nothing else needs uploading.

1. Open **Cloudflare dashboard → Workers & Pages → Create → Worker**, name it
   `htmltools-me-ai-api`, deploy the hello-world version, then **Edit code**.
2. Delete the sample, open `AI-API/worker/worker.js` from this repo, and paste the
   whole file (≈110 KB). **Deploy**.
3. Settings you must add by hand, because they normally come from `wrangler.toml`:

   | Where | Setting | Value |
   | --- | --- | --- |
   | Settings → Variables | `FIREBASE_PROJECT_ID` | `general-database-4cb1c` |
   | Settings → Variables | `GITHUB_REPO` | `owner/name` of your **private** key repo (or leave unset) |
   | Settings → Variables | `GITHUB_BRANCH` / `GITHUB_KEYS_PATH` / `GITHUB_BYOK_PATH` | `main` / `keys.js` / `byok.js` |
   | Settings → Variables | `FREE_DAILY_NEURONS` … `BYOK_DAILY_REQUESTS` | optional; see `wrangler.toml` for defaults |
   | Settings → Variables | `SILOAI_ENABLED` / `SILOAI_MODEL` / `SILOAI_DAILY_MESSAGES` / `SILOAI_RPM` | `true` / `@cf/meta/llama-3.1-8b-instruct` / `15` / `4` |
   | Settings → Variables | `ADMIN_UIDS` / `ADMIN_EMAILS` | optional operator allowlist |
   | Settings → Variables | `API_CORS_ORIGINS` / `SITE_CORS_ORIGINS` | `*` / `https://htmltools.me,https://www.htmltools.me` |
   | Settings → Secrets | `KEY_PEPPER`, `GITHUB_TOKEN`, `BYOK_ENCRYPTION_KEY`, `ADMIN_PASSPHRASE`, `KEY_ESCROW_SECRET` | generated locally, pasted into the prompt |
   | Settings → Bindings → Workers AI | binding name `AI` | required for the free pool and SiloAI |
   | Settings → Bindings → Durable Object | binding name `GATEWAY`, class `GatewayState` | required — quotas, keys and revocation live here |

   Use **SQLite-backed** Durable Objects when the dashboard offers the choice; the
   migration in `wrangler.toml` (`new_sqlite_classes`) is the same thing.

**Dashboard caveats.** The editor only ever holds one file, so it cannot show you the
module split — always regenerate `worker.js` from `src/` rather than editing the paste
buffer. Dashboard deploys are not reproducible: there is no lockfile, no
`wrangler rollback`, and no `wrangler tail` pairing. For anything beyond a first smoke
test, deploy with wrangler.

### Keeping `worker.js` current

```bash
cd AI-API/worker
npm run bundle     # rewrites worker.js from src/*.mjs
npm test           # the bundle tests run against worker.js, incl. the DO class
```

`tests/bundle.test.mjs` imports `worker.js` and exercises `/health`, `/v1/models`, a keyed
completion and the anonymous-traffic refusal, so a stale or broken bundle fails CI. The
bundle was also booted under real `workerd` (`npx wrangler dev --config <config pointing at
worker.js>`): `/health` 200, `/public/status` 200 with a live Durable Object, unknown path
404, anonymous `/v1/chat/completions` 401.

Commit the regenerated file whenever `src/` changes. `worker.js` is generated — a change
made in the dashboard editor will be lost on the next `wrangler deploy`.

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
