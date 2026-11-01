# SiloAI

SiloAI is a standalone site assistant. The dashboard is served at `/SiloAI/`; its Worker API is `https://siloai.bozhetarnikmatthew.workers.dev`. It is intentionally **not** linked from the HTMLTools Tools directory. The source is in this repository; an explicit open-source license has not yet been selected.

## What is included

- Firebase email/password and Google sign-in for website owners.
- Private Firebase RTDB entries at `siloai_users/{uid}/sites/{siteId}` that only contain each owner’s domain reference and creation time. Rules stay private to the matching UID.
- One-time domain verification at `/.well-known/siloai-verification.txt`.
- Same-host HTTPS crawler that reads robots.txt `Sitemap:` directives and sitemap files (including bounded sitemap indexes), follows internal links and declared same-host meta/JavaScript redirect targets (without executing scripts), skips common private-looking paths and non-HTML assets, and caps each crawl at 30 pages/320 KB per response/7,000 extracted characters per page. An oversized page is skipped without aborting other sitemap/link results; if all public pages exceed the cap, the refresh reports that explicitly. Page labels fall back from `<title>` to Open Graph/Twitter title metadata and then the first heading.
- Site-specific settings and public-page excerpts stored as JSON in the private GitHub repository under `SiloAI/sites/{sha256-domain-prefix}.json`. The GitHub token remains a Worker secret and is never sent to browsers. Last-check timestamps live in the Durable Object, so unchanged crawls do not create a GitHub commit.
- Owner-defined groups of related page paths, also used as extra crawl seeds on the next refresh.
- A small embeddable widget, retrieval of a few relevant page excerpts, citations, Worker-side caching, and daily stale refresh on active sites.
- An owner-only **Test AI** dashboard action that runs a tiny fixed-prompt inference through the same primary/retry/fallback path as chat without sending indexed site content.
- Navigation and page interaction are separately owner-controlled. Navigation is off by default and only targets indexed routes. Page interactions are on by default and can be switched off per site. They let SiloAI ring any visible control or text block, click non-submit buttons, fill safe text fields and explicit contenteditable editors, and rewrite the visible text of a page element (reversible with Undo). Highlights appear immediately; every click, fill, and text change requires visitor confirmation. The widget sends a compact, temporary map of visible controls (labels only, never values) with each question, so the assistant can act on elements that have no ID. The map covers plain `<button>` elements with no `type` attribute (which report `type="submit"` to script but behave like ordinary buttons), `role="button"` elements, button-styled links, `input type="button"`, controls inside same-origin iframes and open shadow roots, and icon-only buttons labelled through `aria-label`, `aria-labelledby`, `title`, or image/`svg` titles. Labels are the visible text with decorative glyphs removed, so `▶ Run` is reported as `Run`. Buttons whose markup explicitly declares `type="submit"`/`type="reset"`, submit inputs, and links that would leave the page are still listed so they can be highlighted, but they are marked `clickable: false` and the Worker refuses to click them. When a request about buttons or text produces no action, the widget tells the visitor exactly which controls it could see, and `SiloAI.inspect()` in the console returns the same list for an owner debugging an embed. SiloAI excludes standard submit/reset controls and blocks normal form submit events during a confirmed click, but site-defined button code can still have its own effects.
- Voice dictation is offered when the browser provides Web Speech recognition, with a visible listening state on the mic button. Visitors may optionally attach a screenshot for Gemma 4 Vision; images are compressed in-browser and sent only after the visitor attaches them. Each chat request includes up to 2,500 characters of visible text from the current page (viewport text first), excluding form controls and editable content. Editor/code text is never read or sent, and current field values are not collected.
- Conversations and full message histories are saved per site in the visitor’s localStorage, with controls to start a new conversation or reopen any saved conversation. Browser quota limits still apply; the widget removes saved screenshot payloads first and warns if text history cannot be persisted. The launcher has a fixed size and can be dragged anywhere in the viewport; the chat window can be dragged by its header and resized from its bottom-right corner (or with the arrow keys). Dragging uses pointer capture with one layout write per animation frame, and a drag ends if the pointer is released outside the window, the page loses focus, or a move arrives with no button held, so the launcher never sticks to the cursor. These layout adjustments are intentionally in-memory and reset on refresh/tab close.
- Per-IP and per-site request ceilings enforced by a Durable Object. The Worker returns a clear 503 if the limiter is missing instead of serving unmetered chat.
- Generated single-file `worker.js`, tests, and a Wrangler deploy configuration.

The crawler extracts text from server-delivered HTML. It does not execute a website’s JavaScript, authenticate into private areas, submit forms, or click arbitrary controls. The optional visitor-side interaction feature is separate from crawling and only acts on a small set of visible buttons/text fields after the site owner enables it and the visitor confirms the action. It recognizes same-host redirect hints in meta refresh tags and common `location` assignments/calls, then safely fetches those public targets. Owners can add exact tool-group paths as seeds (for example `/HTML-Runner/`); a typo or route mismatch will still miss the page, and a group cannot make inaccessible/private content visible.

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
3. **Deploy static files** so `/SiloAI/`, `/SiloAI/widget.js`, `/SiloAI/brandmark-mono.png`, `/SiloAI/brandmark-v2.png`, `/SiloAI/style.css`, `/SiloAI/app.js`, and `/SiloAI.png` are live on `https://htmltools.me`. No Tools directory or sitemap entry is included.
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
4. Add tool groupings such as `HTML Runner: /HTML-Runner/, /HTML-Runner/Advanced`, using each route exactly as it appears in the address bar. These paths are included as crawl seeds on the next manual refresh; other public pages remain discoverable automatically.
5. The widget’s generated install snippet uses the verified site ID. Paste it before the site’s closing `</body>` tag. **Let SiloAI navigate visitors** is off by default and only allows indexed-page navigation. **Allow page interactions** is on by default and can be switched off in the dashboard; it controls the constrained highlight/click/fill/text-edit actions, and visitors must confirm every page action. Saving the dialog stores an explicit `pageActionsMode` of `on` or `off`; the older `allowPageActions` boolean no longer disables interactions, so sites connected before this switch existed start working after the widget and Worker are redeployed. Standard submit/reset buttons are excluded; ordinary site buttons may still run their own page-defined effects when clicked.
6. Test in a fresh browser and check the browser console/network panel. Confirm `/chat/{siteId}` calls originate from `https://htmltools.eu.cc` and that the Worker returns page citations.

## Workers AI troubleshooting

If chat returns `502`, open the verified site in the owner dashboard and use **Test AI**. The check sends only a fixed, short prompt (up to 32 output tokens), returns which model answered, and does not include indexed pages or visitor content. It uses the same Gemma → no-thinking retry → Llama fallback path as chat and is owner-authenticated and rate-limited. If Test AI succeeds but the widget still fails, the provider binding can answer and the issue is more likely specific to the chat request/context path. If the probe fails too, the Worker logs a compact diagnostic (`category`, model ID, provider error code/status, a redacted provider message) without logging visitor content. In Cloudflare, open **Workers & Pages → siloai → Logs** and inspect the newest `[SiloAI] Owner AI self-test failed` or `[SiloAI] Workers AI inference failed` entry. `/health` reports configured model and binding presence but does not run inference. The backup model is smaller and may answer less precisely than Gemma; quota and oversized-input failures are not retried.

## Bandwidth and usage controls

- The dashboard emits a cache-busted `/SiloAI/widget.js?v=8` embed URL. The widget script also requires revalidation and replaces an older SiloAI widget instance if a current version is loaded afterward. Existing embeds without the query parameter continue to work, but owners should copy the newly generated snippet after deploying a widget update; an already-open page must be refreshed to load the new UI. The widget never downloads the full crawl index into each visitor’s browser. It sends the current path, document title, up to 2,500 characters of visible text from that page, recent short turns, and the new question; the Worker prioritizes an exact indexed route and retrieves a small set of relevant passages. Editable source/editor text is never read; only visible page text and control labels are sent. When neither an exact indexed excerpt nor a browser excerpt is available, the assistant is instructed not to present the homepage as the current page.
- The Worker caches private GitHub site JSON for five minutes in its isolate/Cloudflare Cache API. GitHub is not fetched for every message when that cache is warm.
- A crawl starts on initial verification and can refresh once a site is stale (24 hours) when its widget is used. Unvisited sites are not continually crawled.
- Initial crawl caps: 30 HTML pages, 320 KB per fetched page, 7,000 text characters saved per page, at most four concurrent page fetches, up to eight sitemap files and 500 sitemap URLs parsed, no external-host crawling, no common account/admin/API routes, and robots.txt checks.
- Crawl starts are capped at 12/day per site and 100/day across the service; manual refreshes also have a 15-minute per-site cooldown. At the hard per-crawl response limits, page payloads are bounded to about 960 MB/day across all 100 allowed crawls, plus small robots/sitemap and protocol overhead. This is far below 100 GB/day under the configured crawler limits.
- Chat caps are 12 requests/minute and 80/day per IP, 60/minute and 1,000/day per site, plus 120/minute and 500/day service-wide. Owner AI self-tests use a separate owner-keyed IP-style bucket with the same 12/minute and 80/day ceiling. The default model is Cloudflare Workers AI Gemma 4 26B A4B (`@cf/google/gemma-4-26b-a4b-it`) with thinking enabled and a 640-token completion ceiling. The Worker returns only the final answer, not recognized thinking/analysis sections. This larger reasoning model is slower and typically costs more than the previous Llama 3.2 3B model, especially if it generates long reasoning. Responses use bounded context and output. CDN caches, bounded responses, and rate limits reduce transfer; total traffic can still vary with widget loads and visitor counts.
- Site page text is not sent to visitors in bulk. Chat sends model input to Cloudflare Workers AI; that is separate from website bandwidth and still incurs model usage.

## Storage and privacy

The private GitHub repository is the Worker’s source of truth for site profile data. Firebase stores only owner-private references for dashboard listing. Crawl output includes extracted public page text; it should not include secrets. The crawler intentionally avoids rendering private routes, but public pages can still accidentally contain information an owner did not intend to expose. Owners should review site content, robots.txt, and indexed pages.

Conversation transcripts are kept in the visitor’s browser localStorage (not uploaded as conversation history storage) and are scoped by site ID. All saved conversations and their full message histories are retained in localStorage until the browser storage quota is reached; the visitor can start a new chat or reopen any saved conversation. If quota is reached, image previews are removed from stored history first; if text history still cannot be saved, the widget warns the visitor instead of silently claiming it was saved. Attached screenshots may be stored locally with the conversation. Each request shares at most 2,500 characters of visible current-page text (not form values). Source/editor content is never read or transmitted. Drag position and the chat-window size are deliberately not persisted and return to defaults after refresh. SiloAI does not inject or execute arbitrary JavaScript, intentionally submit forms, or activate standard submit/reset buttons. The available page actions are limited to highlighting any visible control or text block, visitor-confirmed non-submit button clicks, visitor-confirmed filling of non-sensitive text fields or contenteditable regions, and visitor-confirmed rewriting of one visible text element (reversible with Undo). Because ordinary page buttons run their own site code, visitors should review each requested action before confirming it. The browser validates the temporary control target again at the moment the visitor confirms.
