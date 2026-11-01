import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const widgetSource = await readFile(new URL('../widget.js', import.meta.url), 'utf8');
const siteId = 'abcdef0123456789abcdef01';
const pageMarkup = `
  <main>
    <h1>Page-specific title</h1>
    <p id="intro">Visible page information for the visitor.</p>
    <div style="opacity:0"><p>Invisible page text must never be shared.</p></div>
    <button id="save" type="button">Save draft</button>
    <label for="name">Contact name</label><input id="name" type="text" aria-label="Contact name">
    <textarea id="html-editor" aria-label="HTML source editor"></textarea>
    <div id="rich-editor" contenteditable="true" aria-label="Rich text editor">Original content</div>
  </main>`;

function makeStorage(initial = {}, { failWrites = false, failCount = 0 } = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  let remainingFailures = failCount;
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (failWrites || remainingFailures > 0) { remainingFailures--; throw new DOMException('Storage is full', 'QuotaExceededError'); } values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
    values,
  };
}

function makeWidget({ responseFor = () => ({ reply: 'SiloAI test answer.', sources: [] }), storage = makeStorage(), speech = false, imageData = () => 'data:image/jpeg;base64,/9j/2Q==', scriptSiteId = siteId } = {}) {
  const requests = [];
  const errors = [];
  let imageIndex = 0;
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>Current route</title></head><body>${pageMarkup}</body></html>`, {
    url: 'https://example.test/tools/editor',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  window.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    return { ok: true, status: 200, json: async () => responseFor(body) };
  };
  window.HTMLElement.prototype.setPointerCapture = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    let ancestor = this;
    while (ancestor && ancestor.nodeType === 1) {
      if (ancestor.hidden || ancestor.hasAttribute('hidden')) return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
      ancestor = ancestor.parentElement;
    }
    let width = 100; let height = 24; let left = 40; let top = 100;
    if (this.id === 'siloai-widget-host') {
      width = parseFloat(this.style.width) || 64; height = parseFloat(this.style.height) || 64;
      left = this.style.left ? parseFloat(this.style.left) : window.innerWidth - (parseFloat(this.style.right) || 20) - width;
      top = this.style.top ? parseFloat(this.style.top) : window.innerHeight - (parseFloat(this.style.bottom) || 20) - height;
    } else if (this.classList?.contains('silo-panel')) {
      width = parseFloat(this.style.width) || 390; height = parseFloat(this.style.height) || 580;
      left = parseFloat(this.style.left) || 20; top = parseFloat(this.style.top) || 20;
    } else if (this.tagName === 'BODY' || this.tagName === 'MAIN') { width = window.innerWidth; height = window.innerHeight; left = 0; top = 0; }
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.getBoundingClientRect().width; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.getBoundingClientRect().height; } });
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => imageData(imageIndex++);
  window.createImageBitmap = async () => ({ width: 400, height: 200, close() {} });
  if (speech) {
    window.SpeechRecognition = class {
      start() { this.started = true; window.__recognition = this; }
    };
  }
  window.addEventListener('error', (event) => errors.push(event.error || event.message));
  const script = window.document.createElement('script');
  script.setAttribute('data-site-id', scriptSiteId);
  Object.defineProperty(window.document, 'currentScript', { configurable: true, value: script });
  window.eval(widgetSource);
  return { dom, window, requests, errors, storage };
}

async function flush() { await new Promise((resolve) => setTimeout(resolve, 0)); }
function pointer(window, target, type, x, y, pointerId = 1) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  target.dispatchEvent(event);
}
function submit(window, shadow, text) {
  const input = shadow.querySelector('.silo-input');
  input.value = text;
  shadow.querySelector('.silo-compose').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}


test('widget rejects an invalid embed without blocking a later valid instance and replaces an older instance', () => {
  const invalid = makeWidget({ scriptSiteId: 'not-a-valid-site-id' });
  assert.equal(invalid.window.document.querySelector('#siloai-widget-host'), null);
  const validScript = invalid.window.document.createElement('script');
  validScript.setAttribute('data-site-id', siteId);
  Object.defineProperty(invalid.window.document, 'currentScript', { configurable: true, value: validScript });
  invalid.window.eval(widgetSource);
  assert.ok(invalid.window.document.querySelector('#siloai-widget-host')?.shadowRoot, 'a later valid snippet initializes normally');

  const host = invalid.window.document.querySelector('#siloai-widget-host');
  host.shadowRoot.querySelector('.silo-fab').remove();
  invalid.window.__siloaiLoadedVersion = undefined;
  const oldHost = invalid.window.document.createElement('div');
  oldHost.id = 'siloai-widget-host'; oldHost.textContent = 'Old SiloAI instance';
  host.replaceWith(oldHost);
  invalid.window.eval(widgetSource);
  assert.equal(invalid.window.document.querySelectorAll('#siloai-widget-host').length, 1);
  assert.ok(invalid.window.document.querySelector('#siloai-widget-host')?.shadowRoot, 'the current version replaces the stale widget host');
  invalid.dom.window.close();
});


test('current-page context is sent, editor content is opt-in, and transcripts survive a reload', async () => {
  const storage = makeStorage();
  const first = makeWidget({ storage });
  const { window, requests } = first;
  window.document.querySelector('#html-editor').value = '<h1>Private editor source</h1>';
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;
  submit(window, shadow, 'What is on this page?');
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.pagePath, '/tools/editor');
  assert.match(requests[0].body.pageExcerpt, /Visible page information for the visitor/);
  assert.match(requests[0].body.pageExcerpt, /Save draft/, 'visible button labels are part of the current-page context');
  assert.doesNotMatch(requests[0].body.pageExcerpt, /Private editor source|Invisible page text|Existing field value/);
  assert.equal(requests[0].body.editorText, undefined, 'editor source must not be read/sent unless opted in');

  shadow.querySelector('[data-include-editor]').checked = true;
  submit(window, shadow, 'Explain my HTML editor');
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.editorText, '<h1>Private editor source</h1>');
  const saved = JSON.parse(storage.getItem(`siloai.conversations.${siteId}`));
  assert.equal(saved.conversations.length, 1);
  assert.equal(saved.conversations[0].messages.length, 4);

  first.dom.window.close();
  const reloaded = makeWidget({ storage });
  const reloadedShadow = reloaded.window.document.querySelector('#siloai-widget-host').shadowRoot;
  assert.equal(reloadedShadow.querySelectorAll('.silo-msg').length, 4);
  assert.match(reloadedShadow.querySelector('.silo-user').textContent, /What is on this page/);
  assert.deepEqual(reloaded.errors, []);
  reloaded.dom.window.close();
});


test('every saved conversation is browsable, with full message history retained beyond the previous cap', () => {
  const conversations = Array.from({ length: 27 }, (_, index) => ({
    id: `thread-${index}`,
    title: `Saved conversation ${index}`,
    updatedAt: index + 1,
    messages: Array.from({ length: 45 }, (__, messageIndex) => ({
      role: messageIndex % 2 ? 'assistant' : 'user',
      content: `Thread ${index} message ${messageIndex}`,
      sources: [],
    })),
  }));
  const storage = makeStorage({ [`siloai.conversations.${siteId}`]: { activeId: conversations[26].id, conversations } });
  const { dom, window } = makeWidget({ storage });
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;
  shadow.querySelector('[data-history]').click();
  assert.equal(shadow.querySelectorAll('[data-conversation-menu] button').length, 27);
  assert.equal(shadow.querySelectorAll('.silo-messages .silo-msg').length, 45);
  shadow.querySelector('[data-new]').click();
  const saved = JSON.parse(storage.getItem(`siloai.conversations.${siteId}`));
  assert.equal(saved.conversations.length, 28, 'starting a new chat does not evict older conversations');
  assert.equal(saved.conversations.find((thread) => thread.id === 'thread-26').messages.length, 45);
  assert.deepEqual(window.__errors || [], []);
  dom.window.close();
});


test('confirmed page actions can highlight, click a button, fill a field, and edit contenteditable text', async () => {
  const clicked = { count: 0 };
  const responseFor = (body) => {
    const controls = body.controls || [];
    if (/click the save button/i.test(body.message)) {
      const target = controls.find((control) => control.kind === 'button');
      return { reply: 'I found the save button.', action: { type: 'click', target: target?.id }, confirmAction: true };
    }
    if (/fill the contact name/i.test(body.message)) {
      const target = controls.find((control) => control.kind === 'field' && control.inputType === 'text');
      return { reply: 'I can fill that field.', action: { type: 'fill', target: target?.id, value: 'Ada Lovelace' }, confirmAction: true };
    }
    if (/edit the rich text/i.test(body.message)) {
      const target = controls.find((control) => control.kind === 'field' && control.inputType === 'contenteditable');
      return { reply: 'I can update the editor.', action: { type: 'fill', target: target?.id, value: 'Updated safe text' }, confirmAction: true };
    }
    const target = controls.find((control) => control.kind === 'text');
    return { reply: 'I found the heading.', action: { type: 'highlight', target: target?.id } };
  };
  const { dom, window, requests, errors } = makeWidget({ responseFor });
  const nameField = window.document.querySelector('#name');
  nameField.value = 'Existing field value must remain private';
  let dispatchedFormEvents = 0;
  nameField.addEventListener('input', () => { dispatchedFormEvents++; });
  nameField.addEventListener('change', () => { dispatchedFormEvents++; });
  window.document.querySelector('#save').addEventListener('click', () => { clicked.count++; });
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;

  submit(window, shadow, 'Click the save button'); await flush();
  assert.ok(requests[0].body.controls.some((control) => control.label === 'Save draft'));
  assert.doesNotMatch(JSON.stringify(requests[0].body.controls), /Existing field value must remain private/, 'form values are never sent as page-control context');
  assert.equal(clicked.count, 0, 'page buttons are not activated before the visitor confirms');
  shadow.querySelector('.silo-action').click();
  assert.equal(clicked.count, 1, 'a user-confirmed click activates the target button');

  submit(window, shadow, 'Fill the contact name'); await flush();
  assert.equal(nameField.value, 'Existing field value must remain private', 'field fills also wait for visitor confirmation');
  shadow.querySelectorAll('.silo-action')[1].click();
  assert.equal(nameField.value, 'Ada Lovelace');
  assert.equal(dispatchedFormEvents, 2, 'confirmed field edits dispatch input and change events for site frameworks');

  submit(window, shadow, 'Edit the rich text'); await flush();
  const richEditorControl = requests[2].body.controls.find((control) => control.inputType === 'contenteditable');
  assert.equal(richEditorControl.label, 'Rich text editor', 'editable content is not exposed as the control label');
  shadow.querySelectorAll('.silo-action')[2].click();
  assert.equal(window.document.querySelector('#rich-editor').textContent, 'Updated safe text');

  submit(window, shadow, 'Highlight the intro'); await flush();
  shadow.querySelectorAll('.silo-action')[3].click();
  const highlightedControl = requests[3].body.controls.find((control) => control.kind === 'text');
  const highlightedElement = window.document.querySelector(`[data-siloai-control-id="${highlightedControl.id}"]`);
  assert.equal(highlightedElement.style.outline, '3px solid #f0f0f0');
  assert.deepEqual(errors, []);
  dom.window.close();
});


test('launcher drag/resize, chat-window resize, screenshot replacement, voice typing, and storage failures are handled', async () => {
  const storage = makeStorage();
  const { dom, window, requests, errors } = makeWidget({ storage, speech: true, imageData: (index) => `data:image/jpeg;base64,/9j/${index + 2}Q==` });
  const host = window.document.querySelector('#siloai-widget-host');
  const shadow = host.shadowRoot;
  const fab = shadow.querySelector('.silo-fab');
  const initial = host.getBoundingClientRect();
  pointer(window, fab, 'pointerdown', initial.left + 15, initial.top + 15);
  pointer(window, fab, 'pointermove', initial.left + 65, initial.top + 55);
  pointer(window, fab, 'pointerup', initial.left + 65, initial.top + 55);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(parseFloat(host.style.left) > initial.left, 'the launcher can be dragged');

  const launcherSize = shadow.querySelector('[data-resize-launcher]');
  pointer(window, launcherSize, 'pointerdown', 0, 0, 2);
  pointer(window, launcherSize, 'pointermove', 24, 24, 2);
  pointer(window, launcherSize, 'pointerup', 24, 24, 2);
  assert.equal(host.style.width, '88px', 'the launcher has a working resize handle');
  launcherSize.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(host.style.width, '104px', 'launcher resizing also works from the keyboard');

  fab.click();
  const panel = shadow.querySelector('.silo-panel');
  assert.equal(panel.hidden, false);
  const panelResize = shadow.querySelector('[data-resize-panel]');
  pointer(window, panelResize, 'pointerdown', 0, 0, 3);
  pointer(window, panelResize, 'pointermove', 80, 45, 3);
  pointer(window, panelResize, 'pointerup', 80, 45, 3);
  assert.equal(panel.style.width, '470px');
  assert.equal(panel.style.height, '625px');
  panelResize.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(panel.style.height, '641px', 'the chat window can also be resized from the keyboard');

  const mic = shadow.querySelector('[data-voice]');
  assert.equal(mic.hidden, false);
  mic.click();
  window.__recognition.onresult({ results: [[{ transcript: 'dictated words' }]] });
  assert.match(shadow.querySelector('.silo-input').value, /dictated words/);
  window.__recognition.onend();

  const fileInput = shadow.querySelector('[data-image-file]');
  const firstFile = new window.File(['first image'], 'first.png', { type: 'image/png' });
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [firstFile] });
  fileInput.dispatchEvent(new window.Event('change'));
  assert.equal(shadow.querySelector('.silo-send').disabled, true, 'sending waits while an image is being compressed');
  await flush();
  const secondFile = new window.File(['second image'], 'second.png', { type: 'image/png' });
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [secondFile] });
  fileInput.dispatchEvent(new window.Event('change'));
  await flush();
  assert.equal(shadow.querySelectorAll('[data-attachment-image]').length, 1);
  assert.equal(shadow.querySelector('.silo-attachment').hidden, false);
  submit(window, shadow, 'What is in my screenshot?');
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.image, 'data:image/jpeg;base64,/9j/3Q==', 'only the latest of two selected images is attached to the prompt');
  assert.equal(shadow.querySelector('.silo-attachment').hidden, true, 'the attachment is cleared after sending');
  assert.deepEqual(errors, []);
  dom.window.close();

  const noStorage = makeWidget({ storage: makeStorage({}, { failWrites: true }) });
  const noStorageShadow = noStorage.window.document.querySelector('#siloai-widget-host').shadowRoot;
  submit(noStorage.window, noStorageShadow, 'This should still answer');
  await flush();
  assert.match(noStorageShadow.querySelector('[data-storage-status]').textContent, /could not save chat history/i);
  assert.equal(noStorage.requests.length, 1, 'storage failure does not break chat');
  assert.deepEqual(noStorage.errors, []);
  noStorage.dom.window.close();

  const oldThread = { id: 'quota-thread', title: 'Saved thread', updatedAt: 1, messages: [
    { role: 'user', content: 'Earlier screenshot', imageData: 'data:image/jpeg;base64,/9j/2Q==', sources: [] },
  ] };
  const quotaStorage = makeStorage({ [`siloai.conversations.${siteId}`]: { activeId: oldThread.id, conversations: [oldThread] } }, { failCount: 1 });
  const quotaWidget = makeWidget({ storage: quotaStorage });
  const quotaShadow = quotaWidget.window.document.querySelector('#siloai-widget-host').shadowRoot;
  submit(quotaWidget.window, quotaShadow, 'Continue this conversation');
  await flush();
  const quotaSaved = JSON.parse(quotaStorage.getItem(`siloai.conversations.${siteId}`));
  assert.equal(quotaSaved.conversations.length, 1);
  assert.equal(quotaSaved.conversations[0].messages[0].imageData, '', 'image payloads are the first data removed when storage quota is hit');
  assert.match(quotaShadow.querySelector('[data-storage-status]').textContent, /attached images were removed/i);
  assert.equal(quotaWidget.requests.length, 1, 'a recovered quota condition still allows chat');
  assert.deepEqual(quotaWidget.errors, []);
  quotaWidget.dom.window.close();
});
