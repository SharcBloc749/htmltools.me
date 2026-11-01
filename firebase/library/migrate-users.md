# One-time migration: move existing accounts to htmltools2

The Library pages now sign in directly against the **htmltools2** Auth project
(no Cloud Function session bridge). Existing accounts live in the legacy
**htmltools-library** project, so import them once — users keep the **same
email and password**, no re-registration:

```powershell
# from this directory (firebase/library), using the firebase CLI you already installed
npx firebase-tools auth:export users.json --project htmltools-library
npx firebase-tools auth:import users.json --project htmltools2
```

- This works on the free Spark plan (Auth import/export does not require Blaze).
- Run it with the same Google account you used for `firebase login`
  (neocities31@gmail.com works, since `htmltools2` is in its project list).
- `users.json` contains password hashes — treat it as a secret: delete it
  after the import (`Remove-Item users.json`) and never commit it.
- Re-running is safe: `auth:import` upserts by UID.

After the import + after deploying the updated site and rules, users sign in
on https://htmltools.me/Library/ exactly as before.

## Optional: restore the owner custom claim

The Admin panel gates on the signed-in owner email, so it works without any
claim. If you later deploy the Cloud Functions engagement backend, mint the
`libraryOwner` claim for the owner account with the Admin SDK
(`firebase-admin`) using a service-account key for `htmltools2`.

## Grant the owner claim (Admin/Library panel)

Privileged Admin/Library actions are authorized **server-side** by RTDB rules
that require the `libraryOwner` custom claim — devtools can't forge it. With the
Cloud Functions not deployed, mint the claim once with the Admin SDK (free):

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\...\htmltools2-firebase-adminsdk-....json"
node set-owner-claim.mjs
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS
```

Only `matthewbozhe@gmail.com` receives the claim, so only that account can use
the Admin tools. (The engagement preview/share tools still need the optional
Cloud Functions backend and stay offline otherwise.)
