# Firebase bandwidth audit and deployment runbook

**Project scope: `general-database-4cb1c` ONLY.** Do not copy these rules into the unrelated `htmltools-main`, Library or other Firebase projects. No live rules, data, Auth accounts or Cloudflare deployments have been changed by this branch.

## What changed

| Remaining tool | Audit finding | Change |
| --- | --- | --- |
| AI Playground | Sidebar downloaded every conversation's messages/attachments, and reloaded the list after responses. | Metadata-only `conversation_index/{uid}/playground`, indexed 50-row pages, atomic detail/index save/delete; payload fetched only when opening a thread. |
| Image Editor / Image Generator | Sidebar downloaded all generated/attached images in all histories before opening just one conversation. | Same paginated metadata design (`image_ai` / `image_gen`). Full image history loads only for the chosen conversation. |
| Research | History downloaded every session's full answers/sources. It also redirected to the now-removed Gemini login. | Metadata index (`research`), lazy session detail, login moved to AI Playground with a local return URL. |
| SlidesAI / Library | Whole public collection with all deck slides, SVG scenes/icons and owner email was fetched on every visit. | 50-row metadata pages, first-slide text/color preview only; full deck and graphics fetched on open. Newly saved records omit owner email. Untrusted slide markup is sanitized with vendored DOMPurify 3.4.17 (license in assets/vendor). |
| Art Museum / Upload | Whole artworks were used for a gallery; changing social data could retransmit artwork payloads. | Bounded metadata pages, PNG previews capped at 24 KiB; full snapshot fetched only on open/remix. Like flags are separate UID-owned leaves, count updates are atomic with a per-UID cooldown. Views count once per UID. Publishing/remix retain full artwork. |
| Art editor | Infinite chunks remained subscribed forever after panning; whole chunks were processed for every pixel edit; cursor fan-out was frequent. | Child-level pixel events; detach off-screen chunks and evict their pixels; max 81 visible chunk listeners with adaptive minimum zoom (no blank clipped region); 50 ms pixel-write batching and unchanged-pixel suppression. Hidden tabs go offline and reconnect when visible. Cursor writes capped at 4 Hz in the UI, 5 Hz by rules. Presence cleanup is re-registered on reconnect. |
| Art rooms | Room list was unbounded; invitation checks existed only in client code. | 50-row key-paginated personal room index. Rules require the correct join code, an unlocked room and no ban before membership permits any room read. Owner/member permissions apply to pixels/chat/presence. |
| Website Encryption | Uses Firebase **Auth only**; vault payloads are stored encrypted on GitHub by an external worker. | Refresh token once on 401; display a clear worker-project mismatch hint. No RTDB subscription exists here. Worker environment and ownership caveats below still require operator action. |
| Pasttime Login | Auth only. Current Pasttime main page is a discontinued-tool notice. | No database loop/read to fix. Login config already points at the new project. |
| Other login/tutorial pages | Firebase Auth only. | Retained and config audited. SlidesAI and Playground return URLs now reject cross-origin redirects. |

The six standalone GLM, ChatGPT, Claude, Gemini (including its Chat/login files), Grok and Deepseek directories were removed, along with directory/dashboard entries and sitemap URLs. `404.html` redirects unknown/retired URLs to `/AI-Playground/`, except valid saved Playground chat deep links, which must load the chat shell to avoid losing saved-thread routing. Shared model logos were retained for Playground.

### Budgets and UI behavior

- Lists query at most **50 metadata records per page**; “Load older” retrieves earlier pages using a timestamp plus key cursor (key-only for room indexes). No automatic fallback to a full payload collection is allowed. Search/sorting/statistics cover loaded pages, not an invisible database-wide scan. Load additional pages to include older items.
- Metadata never includes message histories, image histories, ciphertext or SVG scenes. Gallery preview images are at most 24 KiB each. Initial reads can still be up to approximately 1.2 MiB for 50 full-size Art thumbnails plus metadata/protocol overhead; this is a ceiling per list page, not an account/monthly quota.
- Detail cache: at most 10 items / 24 MiB per browser tab, five-minute freshness; save/delete updates or invalidates it. Reload to force a fresh other-device edit. Live room state is **not** cached this way.
- Clients refuse saves over **8 MiB**, or more than **200 messages/turns**, with an explicit error rather than silently truncating existing history. Start a new thread or reduce images. Existing records are not deleted by this branch. Rules constrain message keys, nested depth, allowed fields and individual string sizes; RTDB rules cannot calculate aggregate serialized JSON byte size, so the 8 MiB client guard is not a security boundary.
- Museum aggregate like counts live in metadata; only the current viewer's small per-piece like flags are read, never the list of all liker UIDs. Existing counts/flags can be backfilled. Legacy art without a PNG preview displays “Open to view artwork”; the original snapshot remains accessible on open/remix.
- Gallery social counts are snapshots, not a live subscription. Reload to see others' new likes/views. The previous click-based view counter now records one additional view per UID; existing counts are preserved by backfill.
- Art canvas zoom-out is now bounded by viewport size so a very wide zoom cannot open thousands of chunk listeners. Infinite panning/drawing is retained; the renderer only holds visible chunks. There is still deliberate owner-only whole-drawing export/publish/import traffic.

## Rules: what they enforce

`database.rules.json` is generated by `python3 build-rules.py` (run from any directory with Python 3). It denies unknown paths by default and includes:

- UID isolation for private histories and metadata; no private collection-wide payload reads.
- Mandatory indexed, limited metadata queries, including authenticated public galleries. Root/full public collection dumps are denied.
- Room ownership, immutable owner UID, invite-gated membership, bans, and own-UID presence writes. Join codes can be looked up only individually by authenticated users; the join-code collection cannot be listed.
- Per-UID presence update spacing (200 ms), atomic one-second room-chat cooldowns, one-second per-piece like cooldowns and one view per UID. These are server-side state checks, not just timers in JavaScript.
- Public record ownership and atomic index ownership validation; publishing Art requires ownership of its source room. Cross-user deletes/ownership changes are denied. Admin moderation uses the signed `admin: true` custom claim, **not a client-side email check**.
- Field allowlists, bounded string lengths, bounded array key ranges and finite nested provider-output depth. Old/retired chat collection paths are denied.

**Limits of these rules:** they are not a bandwidth firewall or bot detector. An authorized user can repeatedly fetch permitted records, create many records/accounts, or open busy rooms. Anonymous Art guests remain supported. RTDB security rules do not provide a global read rate limit, total monthly byte cap, reliable spam classification, per-user total storage quota, or atomic global account counter. Privileged Admin SDK/worker credentials bypass rules and need their own limits. Do not promise that rules alone make 120 GB impossible.

## REQUIRED rollout order — do not deploy the frontend by itself

1. **Maintenance window / backups.** Pause writes and keep old clients off the database during the cutover. Export the current destination RTDB and its current rules. Inventory any non-repository clients of this new general project: unknown paths will be denied. The user elected to let people create new Auth accounts; **this branch does not import Auth accounts or reassign old UID-owned data to new users.** Never grant a new account access to an old UID merely because the email matches.
2. **Install local admin/test tooling.** Use Node 22/24 LTS (24 recommended), Python 3 for regeneration/static tests, then `cd firebase` and `npm ci`. Admin commands require trusted local Application Default Credentials, or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file **outside the checkout**. Do not put keys in HTML or Git.
3. **Backfill existing destination indexes.** `node backfill-indexes.mjs` is a dry run. After reviewing it, `node backfill-indexes.mjs --apply`. It uses shallow REST key enumeration and reads each missing-index payload once, sequentially; this one-time administrative read can itself be substantial for a large database. It creates missing indexes only, does not modify histories/records or overwrite existing indexes, and migrates legacy museum like flags/counts into the small social nodes. Keep writes paused: it is not a conflict-resolution or Auth migration tool. New empty databases need no historical backfill. Inspect suspicious/oversized records manually rather than labeling all large art/images spam.
4. **Validate rules with the official emulator.** Install a supported Java runtime (Java 21 recommended for current Firebase tooling), then run from `firebase/`:

   ```sh
   npx firebase-tools emulators:exec --project demo-htmltools --only database "npm run test:rules"
   ```

   Never point emulator tests at production. Offline compiler/simulation tests (`npm test`) are useful but do not replace this official emulator gate. `npm run test:rules` intentionally skips without `FIREBASE_DATABASE_EMULATOR_HOST`; a skip is NOT a successful rules-integration run.
5. **Set moderator claim, if needed.** Find the trusted moderator's **new project's UID** in Firebase Console. Run `node set-admin.mjs THE_UID` to preview, then `node set-admin.mjs THE_UID --apply`. This preserves existing claims and sets `admin: true`. Sign out/in to get a fresh token. Do not use an email supplied by an untrusted client to assign roles.
6. **Deploy reviewed rules and clients together.** Only after the emulator passes and backups/backfill are verified, authenticate the Firebase CLI as the project administrator and run:

   ```sh
   npx firebase-tools deploy --only database --project general-database-4cb1c
   ```

   Alternatively paste the contents of `database.rules.json` into that project's RTDB Rules editor after review. Deploy this branch's static files in the same maintenance window. Old clients' whole-list reads will intentionally fail under the new rules. Do not loosen the rules to make an old client work; update the client. Clear stale browser caches if needed.
7. **Verify live endpoints and cost before ending maintenance.** Use the checklist below and a controlled RTDB profiler session. Compare bytes before/after for the same seeded histories and a multi-user Art room. No production profiler/login test has been performed from this sandbox.
8. **Rollback, if necessary.** Freeze writes, back up new changes, then restore the previous frontend and reviewed previous rules as a coordinated pair. Do not delete indexes, old UID data or the old Firebase project to “fix” an empty list.

## External workers: still an operator responsibility

Their deployed source and secrets are not in this checkout and cannot be changed by a static site branch.

- Website Encryption: set worker `FIREBASE_PROJECT_ID=general-database-4cb1c` and change its code fallback to that project. An old environment variable overrides a new fallback. Redeploy and test a fresh new-project token. Keep MASTER_KEY and the vault GitHub repo/token unchanged to preserve decryption.
- **Vault ownership warning:** the pasted vault worker stores users under email-derived folders and does not consistently check stored owner UID. New accounts must not inherit old vaults solely by matching email. Before reopening that worker to new registrations, add stored-UID ownership checks (or a carefully migrated UID-based namespace) to bootstrap/list/create/update/delete/plain-read operations. Existing encrypted records and public proxy URLs need an explicit migration/recovery policy. The frontend retry change is not a server-side ownership fix.
- AI Playground worker: update its `FIREBASE_WEB_API_KEY` environment variable/default to the **new project's** web API key. Existing environment settings override source defaults. All external workers need genuine token verification plus server-side per-UID/IP rate limits and bounded request/body/concurrency limits. CORS alone is not authentication or bot protection.

## REQUIRED ongoing abuse/cost controls

1. Register App Check for **every** browser client in this project and initialize it with your actual provider/site configuration. Observe valid traffic first, then enforce App Check on RTDB. No placeholder site key or pretend protection is embedded here; the registration/provider settings were not supplied. Test anonymous Art and all login flows before enforcement.
2. Put high-volume public operations behind a trusted service if you need real account/IP quotas, room admission limits or a global budget/kill switch. Anonymous account creation and authenticated repeated reads cannot be prevented by these ownership rules alone.
3. Set usage/billing alerts and review RTDB profiler output (for example `npx firebase-tools database:profile --project general-database-4cb1c`). **Budget alerts are notifications, not automatic spending caps.** Establish an operational response/kill switch if thresholds are exceeded.
4. Add a scheduled privileged cleanup job for expired presence and old room chat, with a reviewed retention policy. The UI only fetches the latest 50 chat entries; older chat can still accumulate in storage. Do not run recursive deletion without backup and review. Admin jobs must be bounded and independently rate-limited.
5. Plan a separate Cloud Storage migration for large images/art/deck assets, with Storage rules and quotas. Keeping binary base64 data in RTDB still costs bytes on deliberate detail opens; this branch removes the accidental all-history/all-gallery transfer, not the bytes of requested images.

## Acceptance checklist

- New account sign-in, Google sign-in, sign-out and return to Research/SlidesAI; external redirect parameters do not leave this origin.
- Playground save/reload/open/delete, model changes, images, new threads, saved deep links through 404, older-page loading, and visible save-limit errors.
- Image Editor/Generator: save/open/delete multiple histories; opening the list must not download other histories' images. URL-seeded image-generation prompts still work.
- Research save/title update/open/delete, older pages, pending/error turns, switching sessions while loading and background request completion.
- SlidesAI generation, first-slide list preview, open complete deck, slide navigation, PPTX download and moderator deletion. No private owner email in new public data.
- Art: guest and registered login, create/join/lock/rotate code/ban/unban; wrong-code joins denied; member cannot steal owner UID; drawing/erase/undo/fill/selection, finite and infinite canvases, panning/zoom, hidden-tab reconnect, chat cooldown, publish/remix, original artwork on open, likes and moderator deletion.
- Another UID, unauthenticated REST and over-limit/unbounded list queries are denied. Unknown/retired nodes are denied.
- Inspect Network/profiler: sidebar requests address only metadata indexes; payload requests are item-specific; off-screen Art chunks detach; counters don't retransmit snapshots.
- Test every retired path (case variants, nested Gemini chat URLs, trailing slashes): redirect to Playground. A valid Playground saved-chat URL must remain usable.

## Validation performed in this sandbox

- `npm test`: **16 passing tests**, including pagination/cache/atomic saves, catalog removal, reproducible rules generation, offline rules compilation and simulated access/control/cooldown tests.
- Changed inline scripts, shared helper and admin scripts syntax-checked; `git diff --check` passed.
- Official emulator integration suite supplied in `rules.test.mjs`, but **not executed here** (no Java/emulator runtime). It skips outside an emulator environment. The offline rules interpreter is test-only (Targaryen 3.1.0 with older dev dependencies); it is not shipped to browsers or used by admin runtime commands. Final approval requires the official emulator plus live smoke tests.
- No Firebase admin credentials, browser provider/site keys, billing dashboard access or deployed Cloudflare source were available. No claim is made that the screenshot's exact 126 GB cause is proven or that the live deployment has already been secured.
