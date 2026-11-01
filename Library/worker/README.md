# Library Games Worker (`black-field-f5e8`)

This worker is the GitHub-backed store behind the Library:

- `GET  /github/index.json` — catalog of all games (metadata only)
- `GET  /github/game/<id>` — raw HTML of one game (≤ 1 MB per file)
- `POST /github/saveGame` — save/update a game (origin-checked)
- `POST /github/deleteGame` — delete a game (origin-checked)
- `POST /github/repair` — replace the whole index (origin-checked)
- `GET  /Library/book/<id>` — serves the book page (needs `ASSETS` binding or `SITE_ORIGIN`)

Allowed origins are hardcoded in `worker.js` (`https://htmltools.me`,
`https://www.htmltools.me`, and the nekoweb mirrors).

## Secrets to set (via `wrangler secret put <NAME>`, never commit values)

| Secret | Required | What to put |
|---|---|---|
| `GITHUB_REPO` | yes | The private repo that stores the games, as `owner/repo` (e.g. `yourname/htmltools-games`). The repo must contain `Games/index.json` and `Games/<id>.html` files. |
| `GITHUB_TOKEN` | yes | A GitHub Personal Access Token (fine-grained or classic) with **Contents: Read and write** permission on that repo. Create one at github.com → Settings → Developer settings → Personal access tokens. Treat it like a password — only ever paste it into `wrangler secret put`, never into chat or files. |
| `GITHUB_BRANCH` | no | Branch to read/write. Defaults to `main`. |
| `SITE_ORIGIN` | no* | A separate HTTPS origin (e.g. `https://htmltools.me`) used only to serve the `/Library/book/<id>` page when there is no `ASSETS` binding. Must not be the worker's own host. |

\* Alternatively configure an `[assets]` binding in `wrangler.toml` (see the
commented block there) to serve the book page directly from the worker.

## Verify

```
curl https://black-field-f5e8.bozhetarnikmatthew.workers.dev/github/index.json
# → 200 with {"version":...,"games":{...}}   (500 "Missing GitHub configuration" = secrets not set)
```

If the worker is unreachable or erroring, the Library pages automatically fall
back to Firebase RTDB (`bookStats` mirror + `books/<id>/code`), so uploads and
playback still work — but likes/stats sync and the shared GitHub catalog need
this worker healthy.

---

# Studio AI Worker (`aged-heart-d9b9`)

`ai-worker.js` serves `/studio/ai` and `/studio/ai/quota` for the Library
Studio's AI generate/edit/remix. It verifies the caller's Firebase ID token
(now against **htmltools2**, legacy `htmltools-library` tokens still accepted).

Deploy: `npx wrangler deploy -c ai-wrangler.toml` from this directory.

## Secrets (set with `wrangler secret put <NAME>` — never commit values, never paste them in chat)

| Secret | Required | What to put |
|---|---|---|
| `GEMINI_API_KEY` | for Gemini models | Google AI Studio API key (ai.google.dev) |
| `GEMINI_PERSONAL_API_KEY` | for personal Gemini route | Another Google AI Studio key |
| `GEMINI_PERSONAL_MODEL` | optional | e.g. `gemini-2.5-flash` |
| `AWS_ACCESS_KEY_ID` | for Claude via Bedrock | AWS access key with Bedrock model access |
| `AWS_SECRET_ACCESS_KEY` | for Claude via Bedrock | matching AWS secret key |
| `AWS_REGION` | optional | defaults to `us-east-2` |
| `EXTENSION_AUTH_TOKEN` | for the browser-extension route | any long random string you invent |
| `FIREBASE_PROJECT_ID` | optional | defaults to `htmltools2` now |

Plus one **KV binding** `AI_QUOTA` (see `ai-wrangler.toml` — set the real
namespace id there; quota tracking needs it, without it the worker answers
503 for quota endpoints).
