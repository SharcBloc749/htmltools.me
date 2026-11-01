# HTMLTools

*One hub. Every shortcut.*

HTMLTools is a directory of web utilities, coding sandboxes, AI tools, media apps, and other useful shortcuts.

[Visit the site](https://htmltools.me) · [Browse the tools](https://htmltools.me/Tools/)

## The directory

The directory's tool list changes over time; one recent snapshot had 18 tools in five categories:

- **Popular:** HTMLTools Browser, AI Playground, MatTube, HTML Library, MatTok
- **AI:** SiloAI (the site assistant, embedded on 22 pages), Make Your Own AI, AI Image Editor, AI Image Generator, Research AI (chat models are consolidated in AI Playground)
- **Tech:** Past Time, Website Encryption, Make a Website, Advanced Workspace, HTMLTools Proxy, Translator
- **Media:** Remove Background, Art
- **Communication:** HTMeet

The list changes over time; the [live directory](https://htmltools.me/Tools/) has the latest version. Some tools are separate apps or rely on external services.

Almost every HTML page in this repository loads the SiloAI assistant (`/SiloAI/widget.js`) as the last element of its `<body>`; the Library book reader is the exception. It makes no network request until a visitor actually opens the chat, and it is served with `must-revalidate`, so a widget update reaches every page without editing any snippet.

## Using the directory

Search by name, description, category, or domain. Filter by category, sort by featured order, name, or category, and switch between grid and list views. Press `/` to focus search and `Escape` to leave it. Starred tools are saved in your browser.

## Run locally

From the repository root, start a local server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Tools that depend on APIs, sign-in, or hosted services may need additional configuration.

---

Made by Matthew · [htmltools.me](https://htmltools.me)

## Firebase project migration

The old website-encryption Firebase configuration has been replaced in the affected tools. **Complete the administrative migration before deploying these changes.** See [the migration runbook](maintenance/firebase-migration/README.md) for account/password migration, worker updates, database rules, verification and rollback. The [offline HTML review page](maintenance/firebase-migration/index.html) screens an exported RTDB JSON file without sending it to a server.

## Firebase bandwidth controls

See [the Firebase deployment and bandwidth runbook](firebase/README.md). The new metadata indexes must be backfilled before deploying the new query-restricted rules and clients together. Rules are specific to `general-database-4cb1c`, not the other Firebase projects used by this repository.

## AI API gateway

[AI-API](AI-API/README.md) is an OpenAI-compatible gateway at
<https://htmltools.me/AI-API>: `GET /v1/models` and `POST /v1/chat/completions` with
`ht-` API keys, streaming and tool calling, backed by Cloudflare Workers AI (shared free
pool) or a user's own Groq key. Users sign in with the `general-database-4cb1c` Firebase
project, create and revoke hashed keys, and see their usage and limits.

The Worker source lives in `AI-API/worker/`; it is deployed separately from Pages and
needs the `AI` binding, the `GatewayState` Durable Object and four secrets. See the
[operator runbook](AI-API/README.md) for the deploy order, free-tier arithmetic and the
documented limits. The worker suite runs with `cd AI-API/worker && npm test`.

## Advanced coding workspace

[Advanced](Advanced/README.md) is a local-first, multi-file editor with sandboxed web and TypeScript execution, isolated Python, document previews, editable filenames, and selective ZIP downloads. It remains a static deployment; the checked-in assets are rebuilt with `cd Advanced && npm ci && npm run build`. See its README for local development, tests, file limits, and the Firebase Google sign-in deployment checklist.
