// Dry-run helper: prints the legacy Auth UID for the verified owner email.
// Copy the UID into LIBRARY_OWNER_UID in firebase/library/.env, then deploy.
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const app = initializeApp({ credential: applicationDefault(), projectId: 'htmltools-library' });
try {
  const user = await getAuth(app).getUserByEmail('matthewbozhe@gmail.com');
  if (!user.emailVerified) throw new Error('Owner email is not verified in Firebase Auth.');
  console.log('LIBRARY_OWNER_UID=' + user.uid);
  console.log('Set this value in firebase/library/.env (server-side only), then deploy functions.');
} finally { await deleteApp(app); }
