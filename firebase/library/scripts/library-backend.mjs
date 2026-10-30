// Shared deployment/repair helpers for the htmltools2 Library callables.
// This script never contains credentials. It uses the operator's existing
// Firebase CLI login, FIREBASE_TOKEN, or Application Default Credentials.
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const PROJECT = 'htmltools2';
const REGION = 'us-central1';
const FUNCTIONS = [
  'createLibrarySession',
  'toggleBookLike',
  'recordBookView',
  'recordBookPlaytime',
  'rateBook',
  'previewLibraryEngagement',
  'shareLibraryEngagement'
];
const ORIGIN = 'https://htmltools.me';

function serviceName(fn) {
  return `projects/${PROJECT}/locations/${REGION}/services/${fn.toLowerCase()}`;
}

async function firebaseAuth() {
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const auth = require('firebase-tools/lib/auth');
  const apiv2 = require('firebase-tools/lib/apiv2');
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  await requireAuth({ project: PROJECT, ...(account || {}) });
  return apiv2;
}

export async function repairInvoker() {
  const apiv2 = await firebaseAuth();
  const run = require('firebase-tools/lib/gcp/run');
  const client = new apiv2.Client({ urlPrefix: 'https://run.googleapis.com', auth: true, apiVersion: 'v1' });
  for (const fn of FUNCTIONS) {
    const name = serviceName(fn);
    try {
      await run.setInvokerUpdate(PROJECT, name, ['public'], client);
      console.log(`public invoker OK: ${fn}`);
    } catch (error) {
      const status = error?.status || error?.context?.response?.statusCode;
      if (status === 404) {
        console.error(`MISSING: ${fn} is not deployed. Run npm run deploy first.`);
        throw error;
      }
      console.error(`FAILED: ${fn}: ${error.message}`);
      console.error('If this is 403, the operator needs roles/run.admin (or resourcemanager.projects.setIamPolicy) on htmltools2.');
      throw error;
    }
  }
}

export async function checkPreflight({ attempts = 6 } = {}) {
  const url = `https://${REGION}-${PROJECT}.cloudfunctions.net/createLibrarySession`;
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type'
        },
        signal: AbortSignal.timeout(15000)
      });
      const allow = res.headers.get('access-control-allow-origin');
      last = { status: res.status, allow };
      if ((res.status === 200 || res.status === 204) && allow === ORIGIN) {
        console.log(`preflight OK: HTTP ${res.status}, access-control-allow-origin: ${allow}`);
        return true;
      }
      console.warn(`preflight not ready (attempt ${i + 1}/${attempts}): HTTP ${res.status}, access-control-allow-origin: ${allow || '(missing)'}`);
    } catch (error) {
      last = { error: error.message };
      console.warn(`preflight check failed (attempt ${i + 1}/${attempts}): ${error.message}`);
    }
    if (i < attempts - 1) await delay(5000);
  }
  console.error('Callable preflight is still blocked. This is a deployment/IAM problem, not a Library rules problem.');
  console.error(JSON.stringify(last));
  return false;
}

const command = process.argv[2];
if (command === 'repair-invoker') {
  await repairInvoker();
} else if (command === 'check-preflight') {
  const ok = await checkPreflight();
  if (!ok) process.exitCode = 1;
} else if (command) {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 2;
}
