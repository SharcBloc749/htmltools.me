// Bridges the existing htmltools-library Auth session into the htmltools2 data
// project. The custom token is minted only by a Cloud Function after verifying
// the old ID token; browser email checks never grant access.
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { getAuth, signInWithCustomToken, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const BACKEND_BACKOFF_MS = 30_000;

function normalizeLibraryError(error) {
  const code = String(error?.code || '');
  if (code === 'functions/internal' || code === 'functions/unavailable' || code === 'internal' || code === 'unavailable') {
    return new Error('The Library backend is unreachable. Deploy firebase/library functions and run npm run repair-invoker (see firebase/library/README.md).');
  }
  if (code.includes('appCheck')) {
    return new Error('Firebase App Check rejected this site. Configure a valid App Check key for htmltools.me or disable App Check enforcement until it is registered.');
  }
  if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
    return new Error('Your Library session expired. Sign out and sign in again.');
  }
  return error;
}

export function createLibraryBridge(oldApp, newApp) {
  const newFunctions = getFunctions(newApp, 'us-central1');
  const dataAuth = getAuth(newApp);
  let pending = null;
  let owner = false;
  let sessionUid = null;
  let lastFailureAt = 0;
  let lastFailure = null;

  async function connect() {
    const user = oldApp && getAuth(oldApp).currentUser;
    if (!user) {
      owner = false;
      sessionUid = null;
      lastFailure = null;
      lastFailureAt = 0;
      await signOut(dataAuth).catch(() => {});
      return { owner: false, user: null };
    }
    // Reuse an already-minted data session for the same legacy UID. This avoids
    // hammering createLibrarySession on every like/playtime/rating call.
    if (sessionUid === user.uid && dataAuth.currentUser) {
      return { owner, user: dataAuth.currentUser };
    }
    try {
      const idToken = await user.getIdToken();
      const { data } = await httpsCallable(newFunctions, 'createLibrarySession')({ idToken });
      if (!data?.customToken) throw new Error('Library session was not issued.');
      const credential = await signInWithCustomToken(dataAuth, data.customToken);
      owner = data.owner === true;
      sessionUid = user.uid;
      lastFailure = null;
      lastFailureAt = 0;
      return { owner, user: credential.user };
    } catch (error) {
      owner = false;
      sessionUid = null;
      lastFailure = normalizeLibraryError(error);
      lastFailureAt = Date.now();
      throw lastFailure;
    }
  }

  return {
    dataAuth,
    get owner() { return owner; },
    ready() {
      if (pending) return pending;
      if (lastFailure && Date.now() - lastFailureAt < BACKEND_BACKOFF_MS) return Promise.reject(lastFailure);
      pending = connect().finally(() => { pending = null; });
      return pending;
    },
    async call(name, payload) {
      await this.ready();
      try { return await httpsCallable(newFunctions, name)(payload); }
      catch (error) { throw normalizeLibraryError(error); }
    },
    async signOutData() {
      owner = false;
      sessionUid = null;
      lastFailure = null;
      lastFailureAt = 0;
      await signOut(dataAuth).catch(() => {});
    }
  };
}
