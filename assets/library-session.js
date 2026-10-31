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
  function explain(error) {
    const code = error?.code || '';
    const details = String(error?.message || '');
    if (String(code).includes('appCheck') || /app.?check/i.test(details)) {
      return new Error('Firebase App Check rejected this site. Configure a valid App Check key for htmltools.me or disable App Check enforcement until it is registered.');
    }
    if (['functions/internal', 'internal'].includes(code)) {
      return new Error('The Library backend returned an internal error. Deploy the current firebase/library Cloud Functions to htmltools2 (no owner UID is required); if it continues, check the function logs.');
    }
    if (['functions/unavailable', 'unavailable'].includes(code)) {
      return new Error('The Library backend is unavailable. Check that firebase/library functions are deployed and the Cloud Run services allow public invocation (see firebase/library/README.md).');
    }
    return error;
  }
  async function connect() {
    const user = oldApp && getAuth(oldApp).currentUser;
    if (!user) { owner = false; await signOut(dataAuth).catch(() => {}); return { owner: false, user: null }; }
    try {
      const idToken = await user.getIdToken();
      const { data } = await httpsCallable(newFunctions, 'createLibrarySession')({ idToken });
      if (!data?.customToken) throw new Error('Library session was not issued.');
      const credential = await signInWithCustomToken(dataAuth, data.customToken);
      owner = data.owner === true;
      return { owner, user: credential.user };
    } catch (error) {
      throw explain(error);
    }
  }
  return {
    dataAuth,
    get owner() { return owner; },
    ready() { if (!pending) pending = connect().finally(() => { pending = null; }); return pending; },
    async call(name, payload) {
      try { return await httpsCallable(newFunctions, name)(payload); }
      catch (error) { throw explain(error); }
    },
    async signOutData() { owner = false; await signOut(dataAuth).catch(() => {}); }
  };
}
