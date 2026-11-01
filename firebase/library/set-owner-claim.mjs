// One-time (and re-runnable): grant the `libraryOwner` custom claim to the owner
// account in the htmltools2 data project. The RTDB rules enforce this claim
// server-side for every privileged Admin/Library write — a client-side email
// check in devtools can never satisfy it.
//
// Usage (free Spark plan is fine, no Blaze needed):
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\...\htmltools2-firebase-adminsdk-....json"   # PowerShell
//   GOOGLE_APPLICATION_CREDENTIALS=./htmltools2-service-account.json node set-owner-claim.mjs # bash
//   node set-owner-claim.mjs
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const OWNER_EMAIL = 'matthewbozhe@gmail.com';
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the htmltools2 service-account JSON path first.');
  process.exit(1);
}
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf8'))), projectId: 'htmltools2' });
const auth = getAuth(app);
const user = await auth.getUserByEmail(OWNER_EMAIL);
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), libraryOwner: true });
console.log(`libraryOwner claim set for ${OWNER_EMAIL} (uid ${user.uid})`);
process.exit(0);
