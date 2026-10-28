# Safe Firebase cutover

## What is and is not done

The 23 HTML pages in this repository referencing `website-encryption-htmltools` now target `general-database-4cb1c`. Other Firebase projects are intentionally unchanged. No production data, accounts, rules, worker deployment, or Cloudflare configuration has been modified by these files. Do **not** deploy the frontend before completing the migration below. The screenshot shows download usage, not its cause; it cannot establish whether bots, legitimate artwork/history downloads, or worker traffic caused it.

This is an RTDB migration. Inventory Firestore, Storage objects, custom claims, provider settings, email templates, authorized domains, MFA, worker-side encrypted records, and other services separately. An RTDB export does not contain them. Do not put service-account keys, exports, password hashes, or private worker secrets in this repository or upload them to the review page on a third-party host.

## 1. Back up and freeze writes

1. Schedule maintenance and prevent source and destination writes during the final export/copy/verification. Back up both projects, their rules, indexes and Auth configuration. Keep a rollback plan. Old sessions will not be valid in the new project.
2. Firebase Console → old project → Realtime Database → Export JSON. Prefer per-collection exports for very large data (the review page expects a root object, e.g. `{"art_rooms": {...}}`). Do not make rules public to export.
3. Open `index.html` from this directory locally. It has no SDK, external resources, telemetry, or requests. Load the export, optionally specify verified abusive paths, analyze, and review records. Download **approved-data.json** and **review-report.json**. Keep both private.
4. Default quarantine: transient `art_presence`, explicit top-record `spam` / `isSpam` flags, records over the chosen size threshold, and paths you manually list. Nested manual deny paths quarantine the containing record so account data is never partially and silently removed. Large images, pixel canvases, and long histories can be legitimate — restore them with the checkbox after review. Unknown collections and accounts are retained. This is heuristic screening, not a guaranteed spam detector. Inspect nested histories and interdependent room/join-code/user indexes together; remove orphaned references deliberately. No automatic account deletion or content-keyword censorship.

## 2. Preserve Authentication UIDs and passwords

Public API keys do not grant admin access. Use the Firebase CLI **on your own trusted machine**, authenticated as an administrator for both projects:

```sh
npx firebase-tools login
npx firebase-tools auth:export /private/path/source-users.json --format=json --project website-encryption-htmltools
```

Keep this export unchanged for backup. If filtering accounts, review each UID and all of its owned/referenced data; do not infer spam from an unverified email address. Retain the UIDs of every migrated legitimate account.

For Firebase's standard SCRYPT password hashes, open the **source project's** Authentication → Users → password hash parameters. Use those exact values with the import (do not use destination hash parameters):

```sh
npx firebase-tools auth:import /private/path/source-users.json --project general-database-4cb1c \
  --hash-algo=SCRYPT --hash-key='SOURCE_SIGNER_KEY' \
  --salt-separator='SOURCE_SALT_SEPARATOR' --rounds=SOURCE_ROUNDS --mem-cost=SOURCE_MEM_COST
```

These are placeholders, not values supplied by this repository. Consult `npx firebase-tools auth:import --help` if the source uses a different hash algorithm. Do not run until the destination Auth user list is empty or you have reviewed UID/email collisions and backed it up; imports can alter existing accounts. CLI arguments may remain in shell history: use a private administrative environment and clear sensitive history as appropriate. Never put these parameters into HTML or Git. If you cannot export hash parameters, use a password-reset migration instead; do not claim existing passwords are preserved.

Enable the same Google/email/other providers in the destination, configure OAuth consent/redirects, authorized domains (including htmltools.me), email actions/templates, and provider credentials. Verify provider links, disabled status and custom claims against the export. The standard export/import is not a complete backup of every advanced Auth feature (e.g. MFA); handle those explicitly if used. Test a real email/password account and Google account and confirm the **same UID** owns the copied records. Users must sign in again.

## 3. Copy reviewed RTDB records (dry-run first)

Install Node 22+ and authenticate via a trusted local Application Default Credentials setup (or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account file **outside the checkout**). Credentials must have destination RTDB admin access.

```sh
cd maintenance/firebase-migration
npm ci
node import-data.mjs /private/path/approved-data.json
# Review conflicts and paths. This next command actually writes:
node import-data.mjs /private/path/approved-data.json --apply
```

Destination is hard-coded; there is no source database access and no source deletion. Only reviewed data is read from disk. Imports run sequentially with atomic create-only transactions at collection/child boundaries, skipping conflicts rather than overwriting them. A collection with a scalar/array value is treated as one record. Nulls are skipped rather than deleting data. Oversized records abort. Exit code 2 means existing destination records were preserved and require review. Restarting after an interruption is safe for already copied records; it does not merge partially existing records. Do not blindly resolve conflicts by deleting destination data.

Export the destination and compare imported paths/values locally with the approved export, accounting for deliberately skipped conflicts. Check parent/child links and ownership with the original UIDs. Keep backups until acceptance tests pass. The importer does not upload Storage blobs or re-encrypt worker secrets.

## 4. Server-side settings and abuse protection (required)

The worker URLs were deliberately **not** replaced: their Cloudflare hostnames are not Firebase project identifiers. Worker source/config is not present in this checkout. Update every deployed worker that validates old Firebase tokens or reads/writes the old database: destination project ID, token issuer `https://securetoken.google.com/general-database-4cb1c`, audience, database URL, admin credentials, and any other project bindings. Preserve encryption keys needed to read encrypted records; changing Firebase config alone cannot migrate encrypted worker storage. Never embed service-account credentials in frontend HTML. Redeploy workers and test an authenticated request using a **new-project** ID token.

Deploy reviewed deny-by-default database rules and required query indexes **before public launch**. Port source rules carefully, not permissive test rules. Private histories should only be accessible at the requesting UID; room membership/ownership and server-side length/size constraints need validation. Public Art and SlidesAI sharing require purpose-built public read scopes, authenticated ownership checks and immutable owner IDs. No universal rules file is provided because the worker schema/claims and current rules were not supplied; guessing could expose secrets or break tools. Test rules using the Firebase emulator, including unauthenticated reads/writes, another user's UID, forged ownership, oversized records and unauthorized deletes.

App Check enforcement (after registering and testing clients), worker-side rate limits, quotas and abuse monitoring are necessary for real bot protection. Client throttles are not security controls. Frontend API keys are public identifiers, not database authorization.

## 5. Bandwidth findings and changes

- Art museum used a whole-collection `value` subscription, rebuilding the collection for every view/like. It now subscribes once with child events so collection-level snapshots aren't rebuilt for each change. Initial loading still reads all artwork, and a changed artwork still includes its payload; a paginated metadata-only index is the recommended follow-up for a large collection.
- Art cursors were written at up to ~16.7 Hz. They are now capped at 4 Hz and suppressed in hidden tabs. Heartbeats skip hidden tabs/recent cursor writes; presence setup is guarded against duplicate listeners/timers. Unchanged pixel writes are skipped. Collaborative drawing remains enabled.
- Chat tools read whole per-user histories on load, including potentially large image messages. SlidesAI reads the full public deck library. These are one-time reads, not polling loops, but can still be expensive. They have deliberately **not** been truncated: silently limiting records would hide existing conversations/decks. A metadata index plus paginated lists/lazy detail reads is a separate schema migration requiring backfill and matching rules.
- Art presence still has fan-out proportional to room occupancy; a large active room can cost significant bandwidth even without spam. Monitor room sizes and use server-side admission/rate limits.

## Acceptance / rollback

Before publishing: verify imported counts and sample values, matching Auth UIDs, password and Google login, password reset, private-history isolation, chat save/reload/delete, image generation/editing, public deck save/open/download, Art room join/draw/chat/presence/publish/remix/likes/delete, and website-encryption worker secret access with the new token issuer. Watch RTDB profiler and console usage during controlled tests; compare bytes and operations rather than assuming the screenshot's 128 GB was all abuse.

If cutover fails, stop writes, preserve new-project changes, restore frontend config and worker bindings together, and reconcile writes before retrying. Never delete the old project just because the new page loads.

Changes here apply only to `SharcBloc749/htmltools.me`. Other repositories or externally deployed workers have not been modified. Production Firebase services are unavailable from this sandbox; live login, rules, worker compatibility and data integrity must be verified administratively before deployment.

## Local checks

Run `node --test review.test.mjs` for the offline review tests. The changed inline scripts and admin importer were syntax checked. These checks do not replace production integration tests. A GitHub code search for the old project ID under `SharcBloc749` returned only the 23 affected pages in this repository; GitHub indexing is not proof that external/private deployments contain no references.
