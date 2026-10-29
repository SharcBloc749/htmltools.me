import { initializeApp } from '@firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from '@firebase/auth';

// Public Firebase web configuration, shared with the existing HTMLTools login.
// Google must be enabled and deployment domains authorized in this Firebase project.
export const firebaseConfig = {
  apiKey: 'AIzaSyDke6bGfoJdP4U5lfA9hWHGFFTcDpWNNC8', authDomain: 'htmltools-library.firebaseapp.com',
  projectId: 'htmltools-library', storageBucket: 'htmltools-library.firebasestorage.app',
  messagingSenderId: '973699554480', appId: '1:973699554480:web:7543f6caa2ed6742092f75',
};
export function authError(error) {
  return ({
    'auth/popup-closed-by-user': 'Sign-in was cancelled. Your local files are unchanged.',
    'auth/cancelled-popup-request': 'A sign-in window is already open. Finish it, or try again.',
    'auth/popup-blocked': 'Your browser blocked the Google popup. Allow popups and try again, or use the redirect option below.',
    'auth/unauthorized-domain': 'This domain is not authorized for sign-in. The site owner must add it to Firebase Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled. The site owner must enable Google or Email/Password in Firebase Authentication → Sign-in method.',
    'auth/network-request-failed': 'Could not reach sign-in. Check your connection and try again. Your local editor still works.',
    'auth/invalid-credential': 'The email or password is incorrect. Please try again.',
    'auth/wrong-password': 'The email or password is incorrect. Please try again.',
    'auth/user-not-found': 'The email or password is incorrect. Please try again.',
    'auth/email-already-in-use': 'There is already an account with this email. Sign in instead, or reset your password.',
    'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Sign in using that method instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a little before trying again.',
    'auth/user-disabled': 'This account has been disabled. Contact the site owner.',
    'auth/web-storage-unsupported': 'Sign-in needs browser storage. Allow storage for this site and try again.',
  })[error?.code] || 'Sign-in could not finish. Please try again. Your local files are unchanged.';
}
export function initializeAuth({ toast, beforeRedirect, showDialog }) {
  const $ = id => document.getElementById(id);
  const auth = getAuth(initializeApp(firebaseConfig, 'authApp'));
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
  $('account-button').disabled = false;
  let mode = 'login', busy = false, user = null;
  function error(message) { $('auth-error').textContent = message; $('auth-error').hidden = false; }
  function setBusy(value, method = '') {
    busy = value;
    for (const id of ['auth-submit', 'google-sign-in', 'google-redirect', 'auth-sign-in-tab', 'auth-register-tab']) $(id).disabled = value;
    $('auth-submit').firstChild.textContent = value && method === 'email' ? 'One moment…' : mode === 'register' ? 'Create account' : 'Sign in';
    $('google-sign-in').querySelector('span').textContent = value && method === 'google' ? 'Opening Google…' : 'Continue with Google';
    $('auth-form').setAttribute('aria-busy', String(value));
  }
  function tab(next) {
    if (busy) return; mode = next; $('auth-error').hidden = true; $('auth-message').textContent = '';
    for (const [id, value] of [['auth-sign-in-tab', 'login'], ['auth-register-tab', 'register']]) { $(id).classList.toggle('active', mode === value); $(id).setAttribute('aria-pressed', String(mode === value)); }
    $('auth-name-group').hidden = mode !== 'register'; $('forgot-password').hidden = mode === 'register';
    $('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    if (mode === 'register') $('auth-password').minLength = 6; else $('auth-password').removeAttribute('minlength');
    setBusy(false);
  }
  function renderUser(value) {
    user = value; $('account-label').textContent = value ? value.displayName || value.email?.split('@')[0] || 'Account' : 'Sign in';
    $('account-button').title = value ? 'Your HTMLTools account' : 'Sign in to HTMLTools'; $('account-email').textContent = value?.email || '';
    if (value && $('auth-dialog').open) { $('auth-dialog').close(); toast('Signed in. Your workspace stays on this device.'); }
  }
  onAuthStateChanged(auth, renderUser, () => { /* The editor stays available when auth is offline. */ });
  getRedirectResult(auth).catch(cause => { if (cause.code !== 'auth/network-request-failed') { showDialog('auth-dialog'); error(authError(cause)); } });
  $('account-button').onclick = () => { if (user) { $('sign-out-error').hidden = true; showDialog('account-dialog'); } else { $('auth-error').hidden = true; $('auth-message').textContent = ''; showDialog('auth-dialog'); } };
  $('auth-sign-in-tab').onclick = () => tab('login'); $('auth-register-tab').onclick = () => tab('register');
  $('auth-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; $('auth-error').hidden = true; setBusy(true, 'email');
    try {
      const email = $('auth-email').value.trim(), password = $('auth-password').value;
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const name = $('auth-name').value.trim();
        if (name) { await updateProfile(credential.user, { displayName: name }); renderUser(credential.user); }
      } else await signInWithEmailAndPassword(auth, email, password);
      $('auth-password').value = '';
    } catch (cause) { error(authError(cause)); }
    finally { setBusy(false); }
  };
  $('google-sign-in').onclick = async () => {
    if (busy) return; $('auth-error').hidden = true; $('auth-message').textContent = ''; setBusy(true, 'google');
    try { await signInWithPopup(auth, provider); }
    catch (cause) {
      if (cause.code === 'auth/popup-closed-by-user') $('auth-message').textContent = authError(cause);
      else error(authError(cause));
      $('google-redirect').hidden = !['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(cause.code);
    } finally { setBusy(false); }
  };
  $('google-redirect').onclick = async () => {
    if (busy) return; setBusy(true, 'google'); $('auth-error').hidden = true;
    try {
      if (!await beforeRedirect()) { error('Save your project with Download before redirecting. Local saving is unavailable.'); return; }
      await signInWithRedirect(auth, provider);
    } catch (cause) { error(authError(cause)); }
    finally { setBusy(false); }
  };
  $('sign-out').onclick = async () => {
    $('sign-out').disabled = true;
    try { await signOut(auth); $('account-dialog').close(); toast('Signed out. Local files are still in this browser.'); }
    catch { $('sign-out-error').hidden = false; $('sign-out-error').textContent = 'Could not sign out. Please try again.'; }
    finally { $('sign-out').disabled = false; }
  };
  $('auth-dialog').addEventListener('close', () => { $('auth-password').value = ''; });
}
