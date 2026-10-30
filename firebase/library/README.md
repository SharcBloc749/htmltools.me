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
   This now does three things in order:
   1. `firebase deploy --only functions,database --non-interactive`
   2. `npm run repair-invoker` — grants `roles/run.invoker` to `allUsers` on every Library Cloud Run service, using your Firebase CLI login / ADC. This repairs already-private v2 callable services that a normal redeploy does not make public.
   3. `npm run check-preflight` — sends an actual browser-style `OPTIONS` preflight to `createLibrarySession` and fails if `Access-Control-Allow-Origin: https://htmltools.me` is missing.

   The static frontend must be deployed in the same window. Old clients that write counters directly will be denied.
5. Sign out/in as `matthewbozhe@gmail.com`, open `/Admin/Library/`, and verify non-owner accounts are denied. Test like/unlike from `/Library/` and the player, then preview/Share a small engagement total and confirm exact sums in `bookStats`.

### GitHub Actions deploy (optional but recommended)

`.github/workflows/deploy-library-backend.yml` deploys the Library backend on pushes to `main` that touch `firebase/library/**`, and can also be run manually from **Actions → Deploy Library backend**.

Add these repository **Actions secrets**:

- `FIREBASE_SERVICE_ACCOUNT_HTMLTOOLS2` — preferred. JSON key for a service account with Firebase deploy permissions on `htmltools2` and Cloud Run IAM permission to set invoker (`roles/run.admin` or equivalent).
- `LIBRARY_OWNER_UID` — the UID printed by `node set-owner.mjs` for verified `matthewbozhe@gmail.com`.
- Optional fallback: `FIREBASE_TOKEN` from `firebase login:ci` if you are not using a service-account key.

If the credentials are absent, the workflow warns and skips instead of pretending the backend is deployed.

## Callable CORS / invoker (fixes `createLibrarySession` preflight failures)

A browser `POST .../createLibrarySession` that fails preflight with **no `Access-Control-Allow-Origin` header** usually means the request never reached the callable handler: the Cloud Run service is private (IAM 403) or the function was not deployed (404). Firebase Auth inside the handler cannot run until Cloud Run lets the request through.

The functions now declare:

```js
cors: ['https://htmltools.me', 'https://www.htmltools.me'],
invoker: 'public'
```

`invoker: 'public'` is **not** anonymous data access. Every handler still verifies a Firebase ID token, the `librarySession` claim, and (for owner controls) `LIBRARY_OWNER_UID`.

Redeploy and repair IAM with the built-in helper:

```sh
cd firebase/library
npm run deploy
```

`npm run deploy` automatically runs `repair-invoker` and `check-preflight`. If you only need to repair an already-deployed backend:

```sh
npm run repair-invoker
npm run check-preflight
```

The helper uses your Firebase CLI login / ADC and the Cloud Run Admin API, so it does not require a separate `gcloud` install. The operator still needs permission to set Cloud Run IAM (`roles/run.admin` or equivalent). If an organization policy blocks `allUsers`, the helper will fail with the IAM error; that policy must be changed by an org admin.

Manual equivalent, if you prefer `gcloud`:

```sh
for svc in createlibrarysession togglebooklike recordbookview recordbookplaytime ratebook previewlibraryengagement sharelibraryengagement; do
  gcloud run services add-iam-policy-binding "$svc" \
    --project htmltools2 --region us-central1 \
    --member allUsers --role roles/run.invoker
done
```

Quick preflight check from any machine:

```sh
curl -i -X OPTIONS https://us-central1-htmltools2.cloudfunctions.net/createLibrarySession \
  -H 'Origin: https://htmltools.me' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Expect `HTTP/2 204` (or 200) and `access-control-allow-origin: https://htmltools.me`. A 403/404 without that header is an IAM/deployment problem, not a Library rules problem.

## Firebase App Check

The previous hardcoded reCAPTCHA v3 site key was rejected by Google on `htmltools.me` (`appCheck/recaptcha-error`, HTTP 400), which broke RTDB listeners and callable context. The frontend now uses `assets/library-app-check.js` and **does not initialize App Check unless a page supplies a valid key**:

```html
<meta name="library-app-check" content="YOUR_SITE_KEY" data-provider="recaptcha-v3">
```

Supported providers: `recaptcha-v3` (default) and `recaptcha-enterprise`.

Until a key is registered for `htmltools.me` / `www.htmltools.me` in Firebase App Check, **do not enable App Check enforcement** on the `htmltools2` Realtime Database or callable functions. If enforcement is already on, either disable it in the Firebase console or add a working key to the Library pages and redeploy the static site. App Check is anti-abuse only; it does not replace Firebase Auth, server-minted owner claims, or RTDB rules.

## Safety limits

- Per Share: views ≤ 10,000,000; likes ≤ 1,000,000; hours ≤ 100,000; likes ≤ views.
- Catalog safety cap: 5,000 published books.
- Allocations use bounded jitter (0.75–1.25× the mean before rounding), exact largest-remainder totals, and per-book likes ≤ views. When the total is at least the book count, every book receives a positive share.
- Adjustments are recorded separately (`adjustedViews`, `adjustedLikes`, `adjustedPlaytimeSeconds`) and audited in `engagementShares`/`activityLog`; they do not fabricate individual liker UIDs or play sessions.

## Validation in this checkout

`npm test` runs 15 allocation, frontend-contract and rules-generation tests. The official emulator suite is supplied in `rules.test.mjs`; it skips unless `FIREBASE_DATABASE_EMULATOR_HOST` is set. No production Firebase deployment or live owner login was performed from this sandbox.
