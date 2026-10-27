# Library bandwidth — why the RTDB burned ~8 GB, and what changed

## The problem

Firebase Realtime Database bills **downloads** — bytes every client reads.

The `books` node was never “just stats”. Every game published in the old Studio wrote
a full record there, including:

* `logoImage` / `bgImage` — **base64 data URLs** (up to 2 MB each),
* sometimes `code` — the **entire game HTML**,
* per-game settings, likes, views, playtime…

That made `books` ~**29 MB** (the *Storage* number in the billing console).

Three things then re-downloaded that whole node:

| Where | When | Cost |
| --- | --- | --- |
| `Library/index.html` → `get(ref(db,'books'))` | on every visit **and every 2 minutes while the tab stayed open** | ~29 MB each time — one open tab ≈ 900 MB/hour |
| `Library/book/index.html` → `get(ref(db,'books/<id>'))` | on every game launch | up to a few MB per play |
| `Library/Studio/index.html`, `Admin/index.html`, `Admin/Library/index.html` | on load (admin panels also kept a live listener) | ~29 MB per visit |

## The fix

`books` is no longer read wholesale anywhere.

1. **New tiny mirror node `bookStats/<id>`** (~100–300 bytes per game) holds everything
   the UI actually needs: `likes`, `views`, `playtimeSeconds`, `ratingAvg`,
   `ratingCount`, `likedBy`, `undeletable`, `chatEnabled`, `chatScope`,
   `allowViewCode`, `ownerId`, `ownerName`, `collaborators`, `createdAt`.
2. **Every write goes to both nodes in one atomic multi-path update**
   (`bookPatch()` in Library / Studio / Upload), so likes, views, ratings, playtime and
   chat settings stay in sync without ever reading the heavy node.
3. **One-time migration** (`buildStatsMirrorOnce()`): the first visitor copies the
   existing counters out of `books` into `bookStats`. It writes a ~40-byte probe first,
   so if the node is not writable it backs off **without** downloading anything, and it
   stamps `localStorage` so a browser never retries more than once a day.
4. **The player page** reads `bookStats/<id>` instead of the whole `books/<id>` record.
5. **Removed** the `onValue(ref(db,'comments'))` listener on the Library page — it pulled
   *every* comment on the site on every visit just to count them.
   (`commentCounts` already provides the numbers; a single game's comments are still
   fetched when you open its modal.)
6. Stats refresh on the Library page is throttled to **10 minutes** instead of 2.
7. Admin dashboard now builds its numbers from the GitHub index + `bookStats`.

## One-time manual step (recommended)

The database itself is still ~29 MB of dead blobs. Purge them once:

**Admin → Library → Tools → “RTDB Bandwidth Cleanup”**

1. **Scan** — reports how much of `books` / `bookCode` / `recentlyDeleted` is base64
   images and legacy code.
2. **Purge Safe Blobs** — removes only blobs that already exist on GitHub (images are
   read from the GitHub index, never from RTDB; code blobs are only removed for games
   present in the index). Anything not backed by GitHub is kept.

After that `books` is ~200 KB, so even the admin panels are cheap.

## Firebase rules

If likes/views ever show `0` in the Library after deploying, the mirror node is not
writable. Add:

```json
"bookStats": { ".read": true, ".write": "auth != null" }
```

Check the browser console — the migration logs either
`[Stats] Mirrored N games into bookStats` (good) or a permission warning (bad).

## Expected result

| Action | Before | After |
| --- | --- | --- |
| Open Library | ~29 MB | ~15 KB (+ GitHub index from Cloudflare, which is not RTDB traffic) |
| Library left open 1 h | ~900 MB | < 100 KB |
| Play a game | 0.2–2 MB | < 1 KB |
| Open Admin dashboard | ~29 MB | ~15 KB |
