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
