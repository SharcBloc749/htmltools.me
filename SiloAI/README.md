# SiloAI

SiloAI is a standalone site assistant. The dashboard is served at `/SiloAI/`; its Worker API is `https://siloai.bozhetarnikmatthew.workers.dev`. It is intentionally **not** linked from the HTMLTools Tools directory. The source is in this repository; an explicit open-source license has not yet been selected.

## What is included

- Firebase email/password and Google sign-in for website owners.
- Private Firebase RTDB entries at `siloai_users/{uid}/sites/{siteId}` that only contain each owner’s domain reference and creation time. Rules stay private to the matching UID.
- One-time domain verification at `/.well-known/siloai-verification.txt`.
- Same-host HTTPS crawler that reads robots.txt, optionally reads sitemap.xml, follows internal links, skips common private-looking paths and non-HTML assets, and caps a crawl at 30 pages/320 KB per response/7,000 extracted characters per page.
- Site-specific settings and public-page excerpts stored as JSON in the private GitHub repository under `SiloAI/sites/{sha256-domain-prefix}.json`. The GitHub token remains a Worker secret and is never sent to browsers. Last-check timestamps live in the Durable Object, so unchanged crawls do not create a GitHub commit.
- Owner-defined groups of related page paths.
- A small embeddable widget, retrieval of a few relevant page excerpts, citations, Worker-side caching, and daily stale refresh on active sites.
- Navigation assistance disabled by default. If the owner enables it, the model can suggest a route only when that exact route is in the index. The visitor confirmation is on by default.
- Per-IP and per-site request ceilings enforced by a Durable Object. The Worker returns a clear 503 if the limiter is missing instead of serving unmetered chat.
- Generated single-file `worker.js`, tests, and a Wrangler deploy configuration.

The initial crawler extracts text from server-delivered HTML. It does not execute a website’s JavaScript, authenticate into private areas, submit forms, or click arbitrary controls. Owners can organize discovered routes, but they cannot make inaccessible/private content visible by adding a path group.

## Development and validation

Node 22 or newer is recommended.

```sh
cd SiloAI
npm ci
npm test
npm run bundle
node --check worker.js
npx wrangler deploy --dry-run --outdir /tmp/siloai-dry-run
```

`worker.js` is generated from `src/index.mjs`; do not edit the bundle by hand. The Node suite uses mocked model, GitHub, site and rate-limit responses. It does not prove that live Firebase, GitHub, Cloudflare AI or your test website is configured correctly.

The Firebase rules generator lives at `../firebase/build-rules.py`; rules are tested offline with:

```sh
cd ../firebase
python3 build-rules.py
npm run test:rules:offline
```

## Required before the first live test

1. **GitHub repository binding.** `wrangler.toml` targets `SharcBloc749/HTMLTools.me-Database`. The Worker secret name must be `GITHUB_TOKEN`, and the fine-grained token must have Contents read/write permission only on that private repository.
2. **Deploy the RTDB rules change** to `general-database-4cb1c`. The change adds only the private `siloai_users` branch and preserves the other generated rules. First run the offline test above. To deploy with Firebase CLI access:

   ```sh
   cd firebase
   npx firebase-tools deploy --only database --project general-database-4cb1c
   ```

   Do not paste tokens or service-account keys into chat or Git.
3. **Deploy static files** so `/SiloAI/`, `/SiloAI/widget.js`, `/SiloAI/brandmark-v2.png`, `/SiloAI/style.css`, `/SiloAI/app.js`, and `/SiloAI.png` are live on `https://htmltools.me`. No Tools directory or sitemap entry is included.
4. **Deploy the Worker** from this directory. Its Wrangler name is `siloai`, its AI binding is `AI`, and its Durable Object binding/migration is `LIMITER` / `SiloLimiter`:

   ```sh
   cd SiloAI
   npm ci
   npm run test
   npm run bundle
   npx wrangler deploy --config wrangler.toml
   ```

   This deployment targets the existing `siloai.bozhetarnikmatthew.workers.dev` Worker name and adds the SQLite-backed Durable Object migration. The existing Cloudflare `AI` binding and `GITHUB_TOKEN` secret should remain configured. Wrangler authentication is required; it is not performed by this repository.
5. Check `https://siloai.bozhetarnikmatthew.workers.dev/health`. It should report `ai`, `storage`, `auth`, and `limits` as `true`. Health never returns secret values.
6. Ensure Firebase Auth has the `htmltools.me` authorized domain and that email/password and (if desired) Google sign-in are enabled.

### Verify and embed on `htmltools.eu.cc`

1. Open `https://htmltools.me/SiloAI/`, sign in, and add `https://htmltools.eu.cc`.
2. Publish a UTF-8 text file at `https://htmltools.eu.cc/.well-known/siloai-verification.txt` containing exactly the value shown by the dashboard, for example `siloai-verification=<generated-value>` (without angle brackets). Do not reuse the example; copy the generated value.
3. Press **Verify & crawl**. The first request checks the file, then reads up to 30 public HTML pages. A page rejected by robots.txt or a site that renders its content only in JavaScript may not be indexed.
4. Add tool groupings such as `Library: /Library, /Library/Studio, /Library/Studio/Upload`, if those paths belong to that site. Grouping helps explanations; it does not limit automatic discovery.
5. Keep answer-only as the default. The widget’s generated install snippet uses the verified site ID. Paste it before the site’s closing `</body>` tag.
6. Test in a fresh browser and check the browser console/network panel. Confirm `/chat/{siteId}` calls originate from `https://htmltools.eu.cc` and that the Worker returns page citations.

## Workers AI troubleshooting

If chat returns `502`, the Worker now logs a compact diagnostic (`category`, model ID, provider error code/status) without logging the visitor’s message or indexed page text. It also returns a specific safe hint when Cloudflare reports a model-agreement, account-access, plan, quota, capacity, or model-ID problem. In Cloudflare, open **Workers & Pages → siloai → Logs** and inspect the newest `[SiloAI] Workers AI inference failed` entry. The model binding can be present while inference still fails; `/health` only confirms that the binding exists. Retry after a capacity error, check the model agreement/access on the Cloudflare AI model page when indicated, and verify the configured `AI_MODEL` if the diagnostic says the model is unavailable.

## Bandwidth and usage controls

- The widget never downloads the full crawl index into each visitor’s browser. It sends the current path, recent short turns, and the new question; the Worker retrieves a small set of relevant passages.
- The Worker caches private GitHub site JSON for five minutes in its isolate/Cloudflare Cache API. GitHub is not fetched for every message when that cache is warm.
- A crawl starts on initial verification and can refresh once a site is stale (24 hours) when its widget is used. Unvisited sites are not continually crawled.
- Initial crawl caps: 30 HTML pages, 320 KB per fetched page, 7,000 text characters saved per page, at most four concurrent page fetches, no external-host crawling, no common account/admin/API routes, and robots.txt checks.
- Crawl starts are capped at 12/day per site and 100/day across the service; manual refreshes also have a 15-minute per-site cooldown. At the hard per-crawl response limits, page payloads are bounded to about 960 MB/day across all 100 allowed crawls, plus small robots/sitemap and protocol overhead. This is far below 100 GB/day under the configured crawler limits.
- Chat caps are 12 requests/minute and 80/day per IP, 60/minute and 1,000/day per site, plus 120/minute and 500/day service-wide. The default model is the lower-cost Workers AI Llama 3.2 3B model with a 320-token output ceiling. Responses use bounded context and output. CDN caches, bounded responses, and rate limits reduce transfer; total traffic can still vary with widget loads and visitor counts.
- Site page text is not sent to visitors in bulk. Chat sends model input to Cloudflare Workers AI; that is separate from website bandwidth and still incurs model usage.

## Storage and privacy

The private GitHub repository is the Worker’s source of truth for site profile data. Firebase stores only owner-private references for dashboard listing. Crawl output includes extracted public page text; it should not include secrets. The crawler intentionally avoids rendering private routes, but public pages can still accidentally contain information an owner did not intend to expose. Owners should review site content, robots.txt, and indexed pages.

The dashboard does not yet include deletion/export, a CMS webhook, arbitrary clicks/form submission, or JavaScript-rendered-page support. Navigation assistance only proposes paths from the indexed page list; the browser checks same-origin and asks the visitor when confirmation is enabled.
