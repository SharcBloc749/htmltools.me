// Bridges the existing htmltools-library Auth session into the htmltools2 data
// project. The custom token is minted only by a Cloud Function after verifying
// the old ID token; browser email checks never grant access.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { getAuth, signInWithCustomToken, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

export function createLibraryBridge(oldApp, newApp) {
  const newFunctions = getFunctions(newApp, 'us-central1');
  const dataAuth = getAuth(newApp);
  let pending = null;
  let owner = false;
  async function connect() {
    const user = oldApp && getAuth(oldApp).currentUser;
    if (!user) { owner = false; await signOut(dataAuth).catch(() => {}); return { owner: false, user: null }; }
    const idToken = await user.getIdToken();
    const { data } = await httpsCallable(newFunctions, 'createLibrarySession')({ idToken });
    if (!data?.customToken) throw new Error('Library session was not issued.');
    const credential = await signInWithCustomToken(dataAuth, data.customToken);
    owner = data.owner === true;
    return { owner, user: credential.user };
  }
  return {
    dataAuth,
    get owner() { return owner; },
    ready() { if (!pending) pending = connect().finally(() => { pending = null; }); return pending; },
    async call(name, payload) {
      try { return await httpsCallable(newFunctions, name)(payload); }
      catch (error) {
        const code = error?.code || '';
        if (code === 'functions/internal' || code === 'functions/unavailable' || code === 'internal' || code === 'unavailable') {
          throw new Error('The Library backend is unreachable. Deploy firebase/library functions and ensure the Cloud Run services allow public invocation (see firebase/library/README.md).');
        }
        if (String(code).includes('appCheck')) {
          throw new Error('Firebase App Check rejected this site. Configure a valid App Check key for htmltools.me or disable App Check enforcement until it is registered.');
        }
        throw error;
      }
    },
    async signOutData() { owner = false; await signOut(dataAuth).catch(() => {}); }
  };
}
