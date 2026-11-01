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
