import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
test('Library chat no longer exposes or handles the /ai command',()=>{
  const s=read('Library/index.html');
  for(const token of ['/ai','getGroqKey','fetchAI','cw-ai-hint','onChatInput'])assert.ok(!s.includes(token),token);
});
test('likes use the verified callable and refresh visible card state',()=>{
  const s=read('Library/index.html');
  assert.ok(s.includes("libraryBridge.call('toggleBookLike'"));
  assert.ok(s.includes('data-like-id'));assert.ok(s.includes('renderPins();renderBooks();'));
  assert.ok(!s.includes("updates['books/'+book._origId+'/likes']"));
  const player=read('Library/book/index.html');assert.ok(player.includes("libraryBridge.call('toggleBookLike'"));
});
test('admin engagement is owner-only and preview-gated',()=>{
  const s=read('Admin/Library/index.html');
  assert.ok(s.includes('libraryBridge.owner'));assert.ok(s.includes("libraryBridge.call('previewLibraryEngagement'"));
  assert.ok(s.includes("libraryBridge.call('shareLibraryEngagement'"));assert.ok(s.includes('id="eng-share-btn"'));
  assert.ok(s.includes('disabled>Share'));assert.ok(!s.includes("get(ref(newDb,'siteConfig/adminEmails'))"));
});
test('Library pages do not ship the broken hardcoded App Check key',()=>{
  for(const f of ['Library/index.html','Library/book/index.html','Library/Studio/index.html','Library/Studio/Upload/index.html','Admin/Library/index.html']){
    const s=read(f);
    assert.ok(!s.includes('6LeRK88sAAAAAG_yDwCD-DIfZdl6oqWAYCTJRdmhb'),f);
    assert.ok(!s.includes('ReCaptchaV3Provider'),f);
    assert.ok(s.includes('initializeLibraryAppCheck'),f);
  }
  const helper=read('assets/library-app-check.js');
  assert.ok(helper.includes('meta[name="library-app-check"]'));
  assert.ok(helper.includes('if (!siteKey) return null'));
});
test('callable functions declare production CORS and public Cloud Run invoker',()=>{
  const s=read('firebase/library/server/index.js');
  assert.ok(s.includes('cors: LIBRARY_ORIGINS'));
  assert.ok(s.includes("invoker: 'public'"));
  assert.ok(s.includes('https://htmltools.me'));
  assert.ok(s.includes('https://www.htmltools.me'));
  assert.ok(s.includes('verifyIdToken'));
  assert.ok(s.includes('librarySession'));
});
test('bridge surfaces actionable backend/App Check errors for sessions and calls',()=>{
  const s=read('assets/library-session.js');
  assert.ok(s.includes('Library backend returned an internal error'));
  assert.ok(s.includes('no owner UID is required'));
  assert.ok(s.includes('App Check rejected this site'));
  assert.ok(s.includes("catch (error) {\n      throw explain(error);"));
  assert.ok(s.includes("getFunctions(newApp, 'us-central1')"));
});
test('owner access and Library sessions work without a UID configuration',()=>{
  const backend=read('firebase/library/server/index.js');
  const admin=read('Admin/Library/index.html');
  assert.ok(backend.includes("const OWNER_EMAIL = 'matthewbozhe@gmail.com'"));
  assert.ok(backend.includes('token.email_verified === true'));
  assert.ok(backend.includes('token.email.toLowerCase() === OWNER_EMAIL'));
  assert.ok(backend.includes('libraryOwner: true'));
  assert.ok(!backend.includes('LIBRARY_OWNER_UID'));
  assert.ok(admin.includes('verified owner account'));
});
