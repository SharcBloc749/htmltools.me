import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup(input, deny = '') {
  const elements = new Map();
  const element = () => ({ append() {}, replaceChildren() {}, remove() {}, click() {}, value: '', files: [] });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  get('file').files = [{ size: raw.length, text: async () => raw }];
  get('threshold').value = '1'; get('deny').value = deny;
  const ctx = vm.createContext({ document: { getElementById: get, createElement: element, createTextNode: text => text }, TextEncoder, console, confirm: () => true });
  vm.runInContext(script, ctx);
  return { ctx, get, records: () => vm.runInContext('records', ctx) };
}
test('retains legitimate data and UIDs, quarantines transient presence and explicit flags', async () => {
  const s = setup({ users: { uid1: { conversations: { a: { text: 'Hello' } } } }, art_presence: { room: { uid1: {} } }, art_rooms: { flagged: { spam: true } } });
  await s.get('review').onclick();
  assert.equal(s.records().find(r => r.path === 'users/uid1').keep, true);
  assert.equal(s.records().find(r => r.path === 'art_presence/room').keep, false);
  assert.equal(s.records().find(r => r.path === 'art_rooms/flagged').keep, false);
});
test('quarantines nested manual deny path at containing record without deleting it', async () => {
  const s = setup({ users: { uid1: { conversations: { a: 'spam', b: 'legitimate' } }, uid2: { text: 'hello' } } }, 'users/uid1/conversations/a');
  await s.get('review').onclick();
  assert.equal(s.records()[0].keep, false);
  assert.equal(s.records()[0].value.conversations.b, 'legitimate');
  assert.equal(s.records()[1].keep, true);
});
test('large legitimate records can be reviewed rather than lost', async () => {
  const s = setup({ images: { uid1: { image: 'x'.repeat(2048) } } });
  await s.get('review').onclick();
  assert.equal(s.records()[0].keep, false);
  assert.equal(s.records()[0].value.image.length, 2048);
});
test('invalid input and invalid thresholds disable exports', async () => {
  for (const data of ['[]', 'null', '{broken']) {
    const s = setup(data); await s.get('review').onclick();
    assert.equal(s.get('download').disabled, true);
  }
  const s = setup({ users: {} }); s.get('threshold').value = '0';
  await s.get('review').onclick(); assert.equal(s.get('download').disabled, true);
});
test('record previews cannot execute untrusted export HTML', async () => {
  const s = setup({ users: { uid: { text: '<script>alert(1)</script>' } } });
  await s.get('review').onclick(); assert.equal(s.records()[0].value.text, '<script>alert(1)</script>');
  assert.ok(!script.includes('innerHTML'));
});
