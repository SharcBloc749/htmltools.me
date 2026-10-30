# htmltools.me AI API — operator guide

An OpenAI-compatible AI gateway for `htmltools.me/AI-API`, running on the existing
Cloudflare Worker `htmltools-me-ai-api`. This directory contains the static site
(`/AI-API/*` on Cloudflare Pages) and the Worker source (`worker/`).

> **Nothing here is deployed.** The static pages can ship with the next Pages deploy;
> the Worker needs a deploy, a Durable Object migration and four secrets before it
> answers a single request. Follow [Deployment](#deployment) in order.

---

## 1. What this is, and what it deliberately is not

**Is:** a documented allowlist gateway with two providers.

| Provider | Who pays | Reachable models |
| --- | --- | --- |
| Cloudflare Workers AI (`AI` binding) | Your Cloudflare account's daily free Neuron allowance | three enabled `@cf/...` models |
| Groq (the user's own key) | The user's Groq account | six allowlisted Groq model ids |

**Is not:**

- an OpenRouter-style router with paid upstreams (no AWS, no OpenAI/Anthropic billing);
- a reseller of Workers AI — free-pool requests fail closed at the daily cap;
- a place where prompts are stored. Only counters, timestamps and key ids are kept.

There is **no unauthenticated endpoint that reaches AI**. Every `/v1` request needs a
live `ht-…` key, `POST /htsilo/chat` needs a verified Firebase session, and anything
not explicitly routed returns `404`. The old public "AI test" route cannot survive a
deploy of this `src/index.mjs` because it has no such route.

---

## 2. Architecture

```
Browser (Pages: htmltools.me/AI-API/*)
  │  Firebase ID token (management)      ht-… API key (OpenAI clients)
  ▼
Cloudflare Worker  htmltools-me-ai-api
  ├─ Firebase ID-token verification  ← Google public JWKS (no admin SDK, no service account)
  ├─ Router allowlist, body/token limits, CORS split (site vs API)
  ├─ GatewayState Durable Object (single instance, strongly consistent)
  │    • key hashes, revocations, per-key/per-user/site limits
  │    • daily Neuron budget with reserve-then-settle
  │    • BYOK ciphertexts, usage counters, 14-day history
  ├─ Workers AI binding  AI  → @cf/... models (free pool)
  └─ Groq API            → user's own key, decrypted per request
                │
                └─ best-effort mirror (alarm + on key change)
                     ▼
        PRIVATE GitHub repo (yours): keys.js and byok.js
```

### Why a Durable Object instead of Firebase RTDB or KV

The requirement "do not rely on eventually consistent storage alone for strict global
quotas or immediate revocation" rules out KV, GitHub reads and RTDB as the authority.
A single Durable Object serialises "authenticate → check limits → reserve budget →
return", so two concurrent requests cannot both spend the last 20 Neurons. Key records
are persisted synchronously on create/revoke, then mirrored to GitHub.

Firebase is used for **authentication only**. RTDB is not used: it is eventually
consistent, it would add read/write bandwidth to a project that already has documented
bandwidth problems, and it is not needed to prove identity. `FIREBASE_PROJECT_ID` is
the only identity configuration; there are no Firebase admin credentials anywhere.

### Storage layout

| Where | What | Trust |
| --- | --- | --- |
| Durable Object storage | `key:<id>` salted hash + metadata, `byok:<uid>` ciphertext, counters | **Authoritative** |
| Private GitHub repo `keys.js` | Human-readable roster (`ht-3jhnnuj2tg - John Doe - johndoe@example.com`) plus hashes/usage | Durable mirror, seeds an empty DO |
| Private GitHub repo `byok.js` | AES-GCM ciphertexts only | Durable mirror |
| Worker secrets | `KEY_PEPPER`, `GITHUB_TOKEN`, `BYOK_ENCRYPTION_KEY`, `ADMIN_PASSPHRASE`, optional `KEY_ESCROW_SECRET` | Encrypted, never in Git |

The full key is returned exactly once, at creation. The roster stores a 13-character
public id, a 16-byte salt, a SHA-256 hash of `salt ‖ pepper ‖ key`, and owner metadata.
If you want the operator to be able to reveal keys later, enable escrow (section 7) —
that is an explicit trade-off, not a default.

---

## 3. Free-tier reality check

Cloudflare's free allocation is **10,000 Neurons per day per account**, resetting at
00:00 UTC. The gateway caps itself at **6,000** by default, leaving room for AI
Playground, HTSilo and estimation error.

Measured in requests, using the gateway's own estimates:

| Model | Neurons per typical request (1,500 in / 300 out) | Requests per 6,000 Neurons |
| --- | --- | --- |
| `@cf/meta/llama-3.2-3b-instruct` | ~7 | ~850 |
| `@cf/meta/llama-3.1-8b-instruct` | ~17 | ~350 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | ~100 | ~60 |

Your estimate of **10 requests/minute continuously (≈14,400/day)** is therefore
roughly **40×** what the shared pool can serve. That is not a bug to fix; it is the
free tier. The design response is:

- the pool stops cleanly at the cap with `429 free_pool_exhausted` and a `Retry-After`
  to the next UTC midnight — **no paid fallback**;
- the UI and docs say so plainly, and point at bring-your-own-key;
- BYOK Groq traffic does not consume the pool at all, so volume users pay nobody but
  Groq (whose free plan is itself rate-limited: e.g. 30 RPM, 1,000 RPD, 100K TPD for
  `llama-3.3-70b-versatile` as of October 2026).

**If you ever need the free pool to serve real volume, the only options are paying
Cloudflare for Neurons (Workers Paid, $5/month minimum + $0.011/1,000 Neurons) or
adding a funded provider. Both are cost decisions — this branch enables neither.**

Workers free plan limits also apply: 100,000 requests/day, 10 ms CPU per request
(I/O and streaming wait time are not CPU), Durable Objects 100,000 requests/day. The
expected ~14,400 requests/day fits, but the DO adds about two calls per API request.

---

## 4. Resources to create

1. **Cloudflare Worker** `htmltools-me-ai-api` (already exists — this replaces its code).
2. **Workers AI binding** named `AI` (already bound).
3. **Durable Object** class `GatewayState` (created by the migration in `wrangler.toml`).
4. **Four Worker secrets** (section 6).
5. **One private GitHub repository** for the roster, plus a fine-grained token.
6. **Firebase project** `general-database-4cb1c`: Email/Password and Google providers
   enabled, `htmltools.me` in authorized domains. No new Firebase product is needed.
7. **Cloudflare Pages**: nothing new — the existing project publishes this folder's
   static files with the rest of the site.

---

## 5. Deployment

### 5.1 Private GitHub roster repository

1. Create a **private** repo, e.g. `SharcBloc749/htmltools-ai-keys`. No initial files
   are required; the Worker creates `keys.js` and `byok.js` on first use.
2. Create a **fine-grained personal access token** limited to that repository with
   **Contents: Read and write** only. No other scopes.
3. Set `GITHUB_REPO = "SharcBloc749/htmltools-ai-keys"` in `AI-API/worker/wrangler.toml`.
4. Store the token as a Worker secret (`GITHUB_TOKEN`) — never in the repo, never in
   the chat, never in a page.

If you leave `GITHUB_REPO` empty the gateway still works, but the roster is not
mirrored and an empty Durable Object would start with no keys.

### 5.2 Firebase (identity)

1. Firebase Console → project **general-database-4cb1c** → Authentication → Sign-in
   method: enable **Email/Password** and **Google** (both are already used by other
   tools in the repo; skip if enabled).
2. Authentication → Settings → Authorized domains: `htmltools.me`,
   `www.htmltools.me`, and the Pages preview domain if you use one.
3. Nothing else. No service account, no Admin SDK key, no RTDB rules change.

**Will users need a separate login? Yes — for most of them.** The Main login
(`/Login/`, `/Main/`) authenticates against `htmltools-library` and `htmltools-main`.
This gateway trusts **only** tokens from `general-database-4cb1c`, the project used by
AI Playground and Website Encryption. Consequences:

- someone who has only used Main/Login must create an account once on the AI-API
  dashboard (or sign in to AI Playground);
- someone who already uses AI Playground or Website Encryption can sign in directly;
- a token from another project is rejected with `auth_wrong_project`, and the dashboard
  says why.

Merging the projects would be a much larger migration; it is not part of this change.

### 5.3 Worker deploy

From the repository root:

```bash
cd AI-API/worker
npx wrangler login           # or export CLOUDFLARE_API_TOKEN=... locally
npx wrangler deploy          # uploads src/index.mjs + the GatewayState migration
```

`wrangler deploy` replaces the entire script. Any old "public test" route disappears.
Afterwards check the Worker's **Triggers** tab: there should be only the `workers.dev`
URL (and a custom domain only if you deliberately add one).

### 5.4 Secrets

Generate values locally and paste them **only** into the `wrangler secret put` prompt:

```bash
openssl rand -base64 48        # KEY_PEPPER          (required)
openssl rand -base64 32        # BYOK_ENCRYPTION_KEY (required for BYOK)
openssl rand -base64 32        # ADMIN_PASSPHRASE    (required for admin tools)
openssl rand -base64 32        # KEY_ESCROW_SECRET   (required for key recovery)

cd AI-API/worker
npx wrangler secret put KEY_PEPPER
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put BYOK_ENCRYPTION_KEY
npx wrangler secret put ADMIN_PASSPHRASE
npx wrangler secret put KEY_ESCROW_SECRET
```

Order matters only in that `KEY_PEPPER` must exist before anyone creates a key:
changing it later invalidates every issued key (they must be recreated).

`ADMIN_PASSPHRASE` is what the operator types in the dashboard's Admin tab, on top of a
Firebase sign-in that is both allowlisted and less than five minutes old. Leave it unset
to disable admin tools entirely (`503 admin_disabled`).

### 5.5 Admin allowlist

In `wrangler.toml` set `ADMIN_UIDS` to your Firebase UID (dashboard → account card shows
a `ref`, but the UID itself is in Firebase Console → Authentication → Users). Optionally
`ADMIN_EMAILS`, honoured only when Firebase marks the email verified. Redeploy after
changing vars (they are not secrets).

### 5.6 Cloudflare Pages

The static pages need no build step. Deploy the repository as usual; then check:

- `https://htmltools.me/AI-API/`
- `https://htmltools.me/AI-API/Docs/`
- `https://htmltools.me/AI-API/Dashboard/`
- `https://htmltools.me/AI-API/Playground/`

Pages serves `/AI-API/` from `AI-API/index.html`. The pages are plain HTML + two shared
assets (`assets/theme.css`, `assets/app.js`, `assets/config.js`, `assets/htsilo.js`).

---

## 6. Verification checklist

```bash
BASE=https://htmltools-me-ai-api.bozhetarnikmatthew.workers.dev

curl -s $BASE/health                                   # {"ok":true,...}, no AI work
curl -s $BASE/public/status | head -c 400               # pool + models
curl -s -o /dev/null -w '%{http_code}\n' $BASE/v1/models            # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/chat/completions \
  -d '{"model":"@cf/meta/llama-3.1-8b-instruct","messages":[{"role":"user","content":"hi"}]}'  # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/chat -d '{}'                          # 404
```

Then in the browser:

1. Sign in on the dashboard; confirm your name/email and the account `ref`.
2. Create a key; confirm it is shown once and appears in the table as active.
3. Click “Show key”, confirm your password, and check the key that comes back matches.
4. Call the API with it; confirm `GET /v1/models` and a chat completion.
5. Revoke it; confirm the next call returns `key_revoked`.
5. Connect a Groq key; call `llama-3.3-70b-versatile`; confirm usage does not touch the
   pool. Disconnect; confirm `provider_not_connected`.
6. Check the private repo: `keys.js` should contain a `// ht-… - Your Name - you@…`
   line and hashes, never a plaintext key.
7. Ask HTSilo one question while signed in; ask again signed out (must say sign in).
8. Watch `npx wrangler tail` during a streaming call; confirm the log lines contain
   model/key id/latency but **not** your prompt.

---

## 7. Key recovery (escrow) — enabled by design

The product decision is: an owner can see their key again, but only after re-entering their
Firebase password (or re-running the Google popup). That needs a recoverable copy, so the
gateway stores one — encrypted, not plaintext.

**What is in the private roster.** For every key, `keys.js` contains:

```
// ht-3jhnnuj2tg - John Doe - johndoe@example.com
{ id, salt, hash, uid, name, email, created, lastUsed, revoked, usage,
  escrow: { v: 1, iv: "<base64>", ct: "<base64>" } }
```

- `hash` is the salted SHA-256 used to authenticate every request.
- `escrow` is the key encrypted with AES-256-GCM under a key derived by HKDF-SHA-256 from
  `KEY_ESCROW_SECRET`, with the key id as HKDF context and AAD. It is unreadable without
  that Worker secret.
- The plaintext key itself is never written to the file, the Durable Object, logs or the
  database. Storing plaintext would mean anyone with read access to the repo (or a leaked
  token, backup or screenshot) holds live credentials; this design gives the same "show my
  key" feature without that.

**Owner flow.** Dashboard → “Show key” → password dialog → Firebase re-authenticates
client-side (the password never goes to the gateway) → `POST /account/keys/{id}/reveal`
with the fresh ID token → the Worker checks the token's `auth_time` is under five minutes
old, decrypts, and returns the key once. Five attempts per five minutes. Revoked keys can
still be read by their owner but no longer work.

**Operator flow.** The Admin tab lists every key with a “Show” button:
`POST /admin/keys/{id}/reveal` needs an allowlisted UID, a sign-in under five minutes old
and the admin passphrase. Use it only when an owner asks for help.

**Rotating `KEY_ESCROW_SECRET`** makes every stored ciphertext undecryptable (keys keep
working, because authentication uses the hash). Users would need to create new keys to get
a recoverable copy again. Treat it like the pepper.

**If you leave it unset,** key creation still works, but the dashboard shows
“Key recovery is off on this deployment” and reveal returns `409 key_not_recoverable`.
That is the safe fallback, not the intended setup.

## 8. Use your own Groq key (BYOK)

- Stored as `{v:1, iv, ct}` — AES-256-GCM, key derived with HKDF-SHA-256 from
  `BYOK_ENCRYPTION_KEY` with context `byok:groq:<firebase-uid>` and the same string as
  AAD, so a ciphertext moved between accounts fails to decrypt.
- The key is validated with a non-inference `GET /models` call to Groq before storage.
- The dashboard can delete it at any time (`DELETE /account/byok`); the ciphertext and
  the `byok.js` entry are removed on the next sync.
- Rotating `BYOK_ENCRYPTION_KEY` makes all stored ciphertexts unreadable; users must
  reconnect. Plan rotations with that in mind.

---

## 9. Security model

| Threat | Control |
| --- | --- |
| Stolen key | Hashed storage, one-time display, immediate revocation, per-key limits |
| Key brute force | 30 chars from a 31-symbol alphabet (~148 bits) plus a server-side pepper |
| Stolen roster file | Contains only salted hashes; useless without `KEY_PEPPER` |
| Forged Firebase token | RS256 signature check against Google JWKS, `aud`/`iss`/`exp`/`sub` |
| Cross-project token | `aud` must be `general-database-4cb1c` |
| Anonymous quota drain | No unauthenticated AI route; HTSilo requires a session; body/token caps |
| Concurrent budget overshoot | Reserve-before-call inside one serialised Durable Object |
| Prompt leakage | No prompt storage; metadata-only logs; enforced in tests |
| Admin abuse | Allowlisted UID + fresh sign-in + passphrase + 5-minute auth window |
| Runaway cost | Provider/model allowlist, output caps, daily cap, no paid fallback |

Residual risks worth stating plainly:

- A holder of a valid key can spend that account's daily share and its per-minute
  allowance; that is the point of a key. Limits bound the damage.
- Cloudflare and Groq process prompts under their own terms; the gateway cannot promise
  provider-side retention behaviour.
- The Durable Object is a single logical instance. It is not a bottleneck at these
  volumes, but it is a single point of failure for quota decisions.
- Counters are checkpointed every 30 seconds; a crash can lose a few seconds of
  accounting. The 6,000/10,000 budget margin absorbs that.

---

## 10. Operations

**Rotate the pepper:** every key becomes invalid. Announce it, then
`wrangler secret put KEY_PEPPER` and clear old records if you like (they stop working).

**Emergency stop:** set `FREE_DAILY_NEURONS = "0"` and redeploy, or revoke keys. HTSilo
shares the pool, so it stops too. BYOK traffic continues because it spends the user's
quota, not yours.

**Roster out of sync:** `POST /admin/sync` (dashboard button) or wait for the 30-second
alarm. The DO remains authoritative.

**Undo a bad deploy:** `npx wrangler rollback` (Cloudflare keeps recent versions). The
Durable Object migration is additive and safe to keep.

**Cost guardrail:** stay on the Workers **Free** plan. Do not add a payment method to
the account without deciding what the failure mode should be; Workers AI on the paid
plan bills Neurons beyond the free allocation.

---

## 11. Verified in this branch vs. needs live credentials

Verified by automated tests (`cd AI-API/worker && npm test`, 31 tests, also run from the
repository root suite):

- routing allowlist, 404s, no anonymous AI path;
- key format, salted hashing, one-time display, revocation, restart persistence;
- per-key/per-user/site rate limits, reservation and `free_pool_exhausted`;
- OpenAI response shape, SSE translation, tool-call mapping (mocked provider);
- Firebase verification: valid, forged signature, expired, wrong project;
- BYOK encryption/uid binding/removal and Groq routing (mocked Groq);
- owner reveal with a fresh token (and refusal with a stale one), operator reveal with escrow;
- HTSilo auth and limits; CORS split; prompt text never logged;
- private roster rendering and a secret scan of the Worker tree.

Needs a live deployment to confirm (no credentials in this sandbox):

- the exact Workers AI model ids and streaming chunk shapes on your account;
- real Neuron usage per request (the gateway's rates are estimates);
- real Groq error strings and free-tier behaviour;
- Google sign-in popup and password re-authentication on the real domain;
- GitHub Contents API writes with your token and repo.

---

## 12. Decisions

1. ~~Escrow~~ **decided: enabled.** Password-gated reveal is part of the product; set
   `KEY_ESCROW_SECRET` as described in section 7.
2. **Free-pool budget:** 6,000 Neurons is a judgement call to protect AI Playground.
   Raise it if you are happy for the pool to serve more before it stops.
3. **Workers plan:** staying on Free keeps cost at $0 and means the pool simply stops.
   Upgrading to Workers Paid is the only way to exceed 10,000 Neurons/day, and it bills.
4. **Custom domain:** `api.htmltools.me` would look cleaner than the `workers.dev` URL,
   but every base URL in the docs and configs would need updating at once.
5. **Account unification:** keep the separate `general-database-4cb1c` login (current
   behaviour) or plan a migration of Main accounts into it later.

None of these require code changes beyond what is already configurable.
