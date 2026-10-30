# HTML Library secure engagement backend

This package targets **htmltools2** (data) and verifies sessions from **htmltools-library** (Auth). It does not modify the unrelated `general-database-4cb1c` rules in `../`.

## What changed

- `/Admin/Library/` accepts only the verified owner. The browser receives a short-lived data-project custom token with a server-minted `libraryOwner` claim; legacy `siteConfig/adminEmails` allowlists are ignored and cannot be written by clients.
- Likes, views, playtime and ratings are written by callable Cloud Functions using the Admin SDK. RTDB rules deny direct client counter writes, including writes by an owner browser session.
- `/Library/` chat no longer contains the `/ai` command or browser-side Groq key fetch.
- Owner-only **Engagement** panel: enter total views, likes and hours, preview a bounded random split across every published book, then **Share**. The sum of per-book additions equals the entered totals exactly. Existing counters are preserved. Each preview can be applied once; retries are idempotent per book.

## Deployment (operator required)

1. Install dependencies:
   ```sh
   cd firebase/library
   npm ci
   cd server && npm ci && cd ..
   ```
2. Configure the owner UID **server-side**. With trusted ADC for the legacy Auth project:
   ```sh
   node set-owner.mjs
   ```
   Copy the printed `LIBRARY_OWNER_UID=...` into `firebase/library/.env` (see `.env.example`). Never put this value or service-account keys in HTML/Git.
3. Validate rules with the official emulator (Java 21+):
   ```sh
   npx firebase-tools emulators:exec --project demo-htmltools-library --only database "npm run test:rules"
   ```
4. Back up the current `htmltools2` RTDB rules/data. Deploy functions and rules together:
   ```sh
   npm run deploy
   ```
   The static frontend must be deployed in the same window. Old clients that write counters directly will be denied.
5. Sign out/in as `matthewbozhe@gmail.com`, open `/Admin/Library/`, and verify non-owner accounts are denied. Test like/unlike from `/Library/` and the player, then preview/Share a small engagement total and confirm exact sums in `bookStats`.

## Safety limits

- Per Share: views ≤ 10,000,000; likes ≤ 1,000,000; hours ≤ 100,000; likes ≤ views.
- Catalog safety cap: 5,000 published books.
- Allocations use bounded jitter (0.75–1.25× the mean before rounding), exact largest-remainder totals, and per-book likes ≤ views. When the total is at least the book count, every book receives a positive share.
- Adjustments are recorded separately (`adjustedViews`, `adjustedLikes`, `adjustedPlaytimeSeconds`) and audited in `engagementShares`/`activityLog`; they do not fabricate individual liker UIDs or play sessions.

## Validation in this checkout

`npm test` runs 10 allocation, frontend-contract and rules-generation tests. The official emulator suite is supplied in `rules.test.mjs`; it skips unless `FIREBASE_DATABASE_EMULATOR_HOST` is set. No production Firebase deployment or live owner login was performed from this sandbox.
