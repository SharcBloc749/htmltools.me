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
    <form id="runner-form"><button id="run">▶ Run</button><button id="copycode">✨ Copy code</button></form>
    <form id="order-form" action="/nowhere"><button id="danger" type="submit">Submit order</button></form>
    <button id="icon-only" type="button" aria-labelledby="icon-label"><svg viewBox="0 0 10 10"><title>Download</title></svg></button>
    <span id="icon-label" hidden>Download file</span>
    <div id="shadow-host"></div>
    <iframe id="runner-frame" title="Isolated runner"></iframe>
    <label for="name">Contact name</label><input id="name" type="text">
    <textarea id="html-editor" aria-label="HTML source editor"></textarea>
    <div id="rich-editor" contenteditable="true" aria-label="Rich text editor">Original content</div>
    <label for="minify">Minify output</label><input id="minify" type="checkbox">
    <select id="width" aria-label="Preview width"><option>responsive</option><option>480px</option></select>
    <a id="advanced" href="/HTML-Runner/Advanced">Advanced runner</a>
    <a id="external-docs" href="https://docs.example.test/guide">Read the guide</a>
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
  const installLayoutStubs = (win) => {
  win.HTMLElement.prototype.setPointerCapture = function () {};
  win.HTMLElement.prototype.releasePointerCapture = function () {};
  win.HTMLElement.prototype.hasPointerCapture = function () { return false; };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.getBoundingClientRect = function () {
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
    } else if (this.tagName === 'IFRAME') { width = 420; height = 260; left = 60; top = 320; }
    else if (this.tagName === 'BODY' || this.tagName === 'MAIN') { width = window.innerWidth; height = window.innerHeight; left = 0; top = 0; }
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} };
  };
  Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.getBoundingClientRect().width; } });
  Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.getBoundingClientRect().height; } });
  };
  installLayoutStubs(window);
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => imageData(imageIndex++);
  window.createImageBitmap = async () => ({ width: 400, height: 200, close() {} });
  if (speech) {
    window.SpeechRecognition = class {
      start() { this.started = true; window.__recognition = this; }
      stop() { if (this.onend) this.onend(); }
    };
  }
  window.addEventListener('error', (event) => errors.push(event.error || event.message));
  // Same-origin frame content, like an HTML Runner preview pane.
  const frameDoc = window.document.querySelector('#runner-frame').contentDocument;
  if (frameDoc.defaultView) installLayoutStubs(frameDoc.defaultView);
  frameDoc.body.innerHTML = '<div class="toolbar"><button id="frame-run">Run</button><button id="frame-clear" type="button">Clear</button></div>';
  // Open shadow root content, like a custom element toolbar.
  window.document.querySelector('#shadow-host').attachShadow({ mode: 'open' }).innerHTML = '<button id="shadow-apply" type="button">Apply changes</button>';
  const script = window.document.createElement('script');
  script.setAttribute('data-site-id', scriptSiteId);
  Object.defineProperty(window.document, 'currentScript', { configurable: true, value: script });
  window.eval(widgetSource);
  return { dom, window, requests, errors, storage };
}

async function flush() { await new Promise((resolve) => setTimeout(resolve, 0)); }
/* Drag/resize updates are applied once per animation frame. */
async function frame() { await new Promise((resolve) => setTimeout(resolve, 40)); }
function pointer(window, target, type, x, y, pointerId = 1, buttons = 1) {
  // Real pointer events cross shadow boundaries (composed: true); the widget tracks
  // pointer moves on the window so a fast drag keeps following the pointer.
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'buttons', { value: buttons });
  target.dispatchEvent(event);
}
function submit(window, shadow, text) {
  const input = shadow.querySelector('.silo-input');
  input.value = text;
  shadow.querySelector('.silo-compose').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
function lastReply(shadow) {
  const replies = shadow.querySelectorAll('.silo-assistant');
  return replies[replies.length - 1];
}
function replyAction(shadow, index = 0) {
  return lastReply(shadow).querySelectorAll('.silo-action')[index];
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


test('current-page context always includes live controls, never reads editor text, and transcripts survive a reload', async () => {
  const storage = makeStorage();
  const first = makeWidget({ storage });
  const { window, requests } = first;
  window.document.querySelector('#html-editor').value = '<h1>Private editor source</h1>';
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;
  assert.equal(shadow.querySelector('[data-include-editor]'), null, 'the editor opt-in control is gone');
  submit(window, shadow, 'What is on this page?');
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.pagePath, '/tools/editor');
  assert.match(requests[0].body.pageExcerpt, /Visible page information for the visitor/);
  assert.match(requests[0].body.pageExcerpt, /Save draft/, 'visible button labels are part of the current-page context');
  assert.doesNotMatch(requests[0].body.pageExcerpt, /Private editor source|Invisible page text|Existing field value/);
  assert.equal(requests[0].body.editorText, undefined, 'editor source is never read or sent');

  const controls = requests[0].body.controls;
  assert.ok(controls.some((control) => control.kind === 'button' && control.label === 'Save draft'), 'page buttons are described for the model');
  assert.ok(controls.some((control) => control.kind === 'field' && control.label === 'Contact name'), 'page fields are described for the model');
  assert.ok(controls.some((control) => control.kind === 'text'), 'visible page text blocks can be highlighted');
  assert.doesNotMatch(JSON.stringify(controls), /Private editor source|Invisible page text/, 'hidden and editor content is never exposed');
  assert.equal(window.document.querySelector('[data-siloai-control-id]'), null, 'the widget no longer writes marker attributes onto the host page');

  submit(window, shadow, 'Explain my HTML editor');
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.editorText, undefined);
  assert.ok(requests[1].body.controls.length > 0, 'controls are sent with every message, not only keyword-matched ones');
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


test('page actions highlight immediately and require confirmation before click, fill, and text edits', async () => {
  let clicked = 0;
  const responseFor = (body) => {
    const controls = body.controls || [];
    const byKind = (kind) => controls.filter((control) => control.kind === kind);
    if (/click the save button/i.test(body.message)) {
      return { reply: 'I found the save button.', action: { type: 'click', target: byKind('button')[0]?.id }, confirmAction: true };
    }
    if (/fill the contact name/i.test(body.message)) {
      const target = byKind('field').find((control) => control.label === 'Contact name');
      return { reply: 'I can fill that field.', action: { type: 'fill', target: target?.id, value: 'Ada Lovelace' }, confirmAction: true };
    }
    if (/edit the rich text/i.test(body.message)) {
      const target = byKind('field').find((control) => control.inputType === 'contenteditable');
      return { reply: 'I can update the editor.', action: { type: 'fill', target: target?.id, value: 'Updated safe text' }, confirmAction: true };
    }
    if (/change the intro/i.test(body.message)) {
      const target = byKind('text').find((control) => control.label.startsWith('Visible page information'));
      return { reply: 'I can rewrite that line.', action: { type: 'edit', target: target?.id, value: 'Rewritten by SiloAI.' }, confirmAction: true };
    }
    const target = byKind('text')[0];
    return { reply: 'I found something to point at.', action: { type: 'highlight', target: target?.id } };
  };
  const { dom, window, requests, errors } = makeWidget({ responseFor });
  const nameField = window.document.querySelector('#name');
  nameField.value = 'Existing field value must remain private';
  let dispatchedFormEvents = 0;
  nameField.addEventListener('input', () => { dispatchedFormEvents++; });
  nameField.addEventListener('change', () => { dispatchedFormEvents++; });
  window.document.querySelector('#save').addEventListener('click', () => { clicked++; });
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;

  submit(window, shadow, 'Click the save button'); await flush();
  assert.ok(requests[0].body.controls.some((control) => control.label === 'Save draft'));
  assert.doesNotMatch(JSON.stringify(requests[0].body.controls), /Existing field value must remain private/, 'form values are never sent as page-control context');
  assert.equal(clicked, 0, 'page buttons are not activated before the visitor confirms');
  replyAction(shadow).click();
  assert.equal(clicked, 1, 'a user-confirmed click activates the target button');

  submit(window, shadow, 'Fill the contact name'); await flush();
  assert.equal(nameField.value, 'Existing field value must remain private', 'field fills also wait for visitor confirmation');
  replyAction(shadow).click();
  assert.equal(nameField.value, 'Ada Lovelace');
  assert.equal(dispatchedFormEvents, 2, 'confirmed field edits dispatch input and change events for site frameworks');

  submit(window, shadow, 'Edit the rich text'); await flush();
  assert.equal(shadow.querySelectorAll('[data-siloai-highlight]').length, 0, 'no stale highlight overlay is left behind');
  replyAction(shadow).click();
  assert.equal(window.document.querySelector('#rich-editor').textContent, 'Updated safe text');

  submit(window, shadow, 'Highlight anything here'); await flush();
  const overlays = window.document.querySelectorAll('[data-siloai-highlight]');
  assert.equal(overlays.length, 2, 'a ring and its label are drawn on the page without a confirmation click');
  const ring = overlays[0];
  assert.equal(ring.style.left, '35px', 'the ring is positioned over the highlighted element');
  assert.equal(ring.style.top, '95px');
  assert.equal(ring.style.width, '110px');
  assert.ok(replyAction(shadow), 'the visitor can highlight it again');

  submit(window, shadow, 'Change the intro text'); await flush();
  const intro = window.document.querySelector('#intro');
  assert.equal(intro.textContent, 'Visible page information for the visitor.', 'text edits wait for confirmation');
  replyAction(shadow).click();
  assert.equal(intro.textContent, 'Rewritten by SiloAI.');
  const undo = lastReply(shadow).querySelectorAll('.silo-action.ghost')[0];
  assert.ok(undo, 'a text change can be undone');
  undo.click();
  assert.equal(intro.textContent, 'Visible page information for the visitor.');
  assert.deepEqual(errors, []);
  dom.window.close();
});


test('plain buttons, framed buttons, and shadow-DOM buttons are found, labelled, and clickable', async () => {
  let runClicks = 0;
  let frameClicks = 0;
  let shadowClicks = 0;
  let dangerClicks = 0;
  let formSubmits = 0;
  const responseFor = (body) => {
    const buttons = (body.controls || []).filter((control) => control.kind === 'button');
    const pick = (pattern) => buttons.find((control) => pattern.test(control.label));
    if (/click the run button/i.test(body.message)) return { reply: 'Found Run.', action: { type: 'click', target: pick(/^Run$/i)?.id }, confirmAction: true };
    if (/click the framed run/i.test(body.message)) return { reply: 'Found the framed Run.', action: { type: 'click', target: buttons.filter((control) => /^Run$/i.test(control.label))[1]?.id }, confirmAction: true };
    if (/click apply/i.test(body.message)) return { reply: 'Found Apply.', action: { type: 'click', target: pick(/Apply changes/i)?.id }, confirmAction: true };
    return { reply: 'Found the download button.', action: { type: 'highlight', target: pick(/Download/i)?.id } };
  };
  const { dom, window, requests, errors } = makeWidget({ responseFor });
  const doc = window.document;
  doc.querySelector('#run').addEventListener('click', () => { runClicks++; });
  doc.querySelector('#runner-form').addEventListener('submit', (event) => { formSubmits++; event.preventDefault(); });
  doc.querySelector('#danger').addEventListener('click', () => { dangerClicks++; });
  const frameDoc = doc.querySelector('#runner-frame').contentDocument;
  frameDoc.querySelector('#frame-run').addEventListener('click', () => { frameClicks++; });
  const shadowRoot = doc.querySelector('#shadow-host').shadowRoot;
  shadowRoot.querySelector('#shadow-apply').addEventListener('click', () => { shadowClicks++; });
  const shadow = doc.querySelector('#siloai-widget-host').shadowRoot;

  submit(window, shadow, 'What is on this page?'); await flush();
  const labels = requests[0].body.controls.map((control) => control.label);
  assert.ok(labels.includes('Run') && labels.includes('Copy code'), 'decorative glyphs are stripped from labels');
  assert.ok(labels.includes('Run'), 'a <button> with no type attribute is a real button, not an implicit submit');
  assert.ok(labels.includes('Clear'), 'buttons inside a same-origin frame are collected');
  assert.ok(labels.includes('Apply changes'), 'buttons inside open shadow roots are collected');
  assert.ok(labels.includes('Download file'), 'an icon-only button is labelled from aria-labelledby');
  const submitControl = (requests[0].body.controls || []).find((control) => control.label === 'Submit order');
  assert.ok(submitControl, 'an author-declared submit button is still listed so it can be highlighted');
  assert.equal(submitControl.clickable, false, 'but it is marked highlight-only');
  assert.doesNotMatch(JSON.stringify(requests[0].body.controls), /Existing field value/, 'field values are still never sent');

  submit(window, shadow, 'Click the run button please'); await flush();
  replyAction(shadow).click();
  assert.equal(runClicks, 1, 'the plain Run button is clickable after confirmation');
  assert.equal(formSubmits, 0, 'the synthetic click never submits the surrounding form');

  submit(window, shadow, 'Click the framed run button'); await flush();
  replyAction(shadow).click();
  assert.equal(frameClicks, 1, 'a button inside the isolated frame can be clicked');

  submit(window, shadow, 'Click apply changes'); await flush();
  replyAction(shadow).click();
  assert.equal(shadowClicks, 1, 'a shadow-DOM button can be clicked');
  assert.equal(dangerClicks, 0, 'submit buttons are never activated');

  submit(window, shadow, 'Highlight the download button'); await flush();
  const ring = frameDoc.createElement('div');
  void ring;
  const overlays = doc.querySelectorAll('[data-siloai-highlight]');
  assert.ok(overlays.length >= 2, 'a highlight ring is drawn for the icon-only button');

  const excerpt = requests[0].body.pageExcerpt;
  assert.match(excerpt, /Visible page information for the visitor/, 'the page excerpt is unchanged');
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('a reply without an action reports the controls the widget could actually see, and submit-only buttons are highlight-only', async () => {
  const responseFor = (body) => {
    const buttons = (body.controls || []).filter((control) => control.kind === 'button');
    if (/click the submit order/i.test(body.message)) {
      return { reply: 'That one only submits the form.', action: { type: 'click', target: buttons.find((control) => control.label === 'Submit order')?.id }, confirmAction: true };
    }
    return { reply: 'I could not find that button.', sources: [] };
  };
  const { dom, window, requests, errors } = makeWidget({ responseFor });
  let dangerClicks = 0;
  window.document.querySelector('#danger').addEventListener('click', () => { dangerClicks++; });
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;

  submit(window, shadow, 'highlight any button on my screen'); await flush();
  const status = shadow.querySelector('[data-status-text]').textContent;
  assert.match(status, /On this page I can see /, 'the visitor is told what SiloAI can reach');
  assert.match(status, /“Run”/, 'the visible button labels are named');
  assert.match(status, /button/, 'the summary counts buttons');

  submit(window, shadow, 'Click the submit order button'); await flush();
  replyAction(shadow).click();
  assert.equal(dangerClicks, 0, 'a highlight-only button is never clicked');
  assert.match(shadow.querySelector('[data-status-text]').textContent, /would submit a form or leave this page/);
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('the welcome card offers starter prompts and the widget keeps page hotkeys out of its own inputs', async () => {
  const { dom, window, requests, errors } = makeWidget();
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;
  shadow.querySelector('.silo-fab').click();
  const chips = shadow.querySelectorAll('.silo-chip');
  assert.equal(chips.length, 3, 'the empty state suggests what the assistant can do');
  chips[1].click();
  await flush();
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.message, /Highlight/i);
  assert.equal(shadow.querySelectorAll('.silo-chip').length, 0, 'the welcome card is replaced once the chat starts');
  assert.ok(requests[0].body.controls.length > 0, 'starter prompts already carry the page control map');

  let pageSaw = 0;
  window.document.addEventListener('keydown', () => { pageSaw++; });
  const input = shadow.querySelector('.silo-input');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }));
  assert.equal(pageSaw, 0, 'typing in the widget never triggers host-page shortcuts');
  shadow.querySelector('.silo-panel').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  assert.equal(shadow.querySelector('.silo-panel').hidden, true, 'Escape closes the chat window');
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('launcher drag, chat-window drag and resize, screenshot replacement, voice typing, and storage failures are handled', async () => {
  const storage = makeStorage();
  const { dom, window, requests, errors } = makeWidget({ storage, speech: true, imageData: (index) => `data:image/jpeg;base64,/9j/${index + 2}Q==` });
  const host = window.document.querySelector('#siloai-widget-host');
  const shadow = host.shadowRoot;
  const fab = shadow.querySelector('.silo-fab');
  assert.equal(shadow.querySelector('[data-resize-launcher]'), null, 'the launcher no longer has a resize handle');
  const initial = host.getBoundingClientRect();
  pointer(window, fab, 'pointerdown', initial.left + 15, initial.top + 15);
  pointer(window, fab, 'pointermove', initial.left + 65, initial.top + 55);
  await frame();
  assert.ok(parseFloat(host.style.left) > initial.left, 'the launcher can be dragged');
  // A release the widget never receives (dropped outside the window) must not leave
  // the launcher glued to the cursor: the next move with no button held ends it.
  // A fast flick: the final move arrives and the release follows immediately,
  // before the animation frame applies it. The launcher must still land there.
  pointer(window, fab, 'pointerdown', initial.left + 15, initial.top + 15, 2);
  pointer(window, fab, 'pointermove', initial.left + 215, initial.top + 115, 2);
  pointer(window, fab, 'pointerup', initial.left + 215, initial.top + 115, 2);
  await frame();
  const flickTarget = Math.min(initial.left + 200, window.innerWidth - 64);
  assert.equal(parseFloat(host.style.left), flickTarget, 'a fast flick lands exactly under the pointer');
  pointer(window, fab, 'pointerdown', initial.left + 15, initial.top + 15, 3);
  pointer(window, fab, 'pointermove', initial.left + 65, initial.top + 55, 3);
  await frame();
  const parked = parseFloat(host.style.left);
  pointer(window, fab, 'pointermove', initial.left + 300, initial.top + 120, 1, 0);
  await frame();
  pointer(window, fab, 'pointermove', initial.left + 400, initial.top + 200, 1, 0);
  await frame();
  assert.equal(parseFloat(host.style.left), parked, 'the launcher stops following once the button is released');
  pointer(window, fab, 'pointerup', initial.left + 65, initial.top + 55);
  assert.equal(shadow.querySelector('.silo-panel').hidden, true, 'dragging the launcher does not open the chat window');

  // Pressing without enough movement is a normal click.
  pointer(window, fab, 'pointerdown', 0, 0, 9);
  pointer(window, fab, 'pointerup', 0, 0, 9);
  fab.click();
  const panel = shadow.querySelector('.silo-panel');
  assert.equal(panel.hidden, false, 'a click after a drag still opens the chat window');

  const head = shadow.querySelector('[data-drag-handle]');
  const beforeDrag = parseFloat(panel.style.left);
  pointer(window, head, 'pointerdown', 60, 40, 4);
  pointer(window, head, 'pointermove', 0, 70, 4);
  await frame();
  pointer(window, head, 'pointerup', 0, 70, 4);
  assert.equal(parseFloat(panel.style.left), beforeDrag - 60, 'the chat window itself can be dragged by its header');
  // Releasing outside the window (blur) also ends the drag cleanly.
  const parkedPanel = parseFloat(panel.style.left);
  pointer(window, head, 'pointerdown', 60, 40, 5);
  window.dispatchEvent(new window.Event('blur'));
  pointer(window, head, 'pointermove', 0, 70, 5);
  await frame();
  assert.equal(parseFloat(panel.style.left), parkedPanel, 'a lost pointer release ends the window drag');

  const panelResize = shadow.querySelector('[data-resize-panel]');
  pointer(window, panelResize, 'pointerdown', 0, 0, 3);
  pointer(window, panelResize, 'pointermove', 80, 45, 3);
  await frame();
  pointer(window, panelResize, 'pointerup', 80, 45, 3);
  // Growth is clamped to the space left of/below the panel so the grip cannot drag
  // the window off-screen while resizing.
  const roomWidth = Math.max(240, window.innerWidth - parseFloat(panel.style.left) - 8);
  const roomHeight = Math.max(240, window.innerHeight - parseFloat(panel.style.top) - 8);
  assert.equal(panel.style.width, Math.min(470, roomWidth) + 'px');
  assert.equal(panel.style.height, Math.min(625, roomHeight) + 'px');
  const beforeKeyboard = parseFloat(panel.style.height);
  panelResize.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(parseFloat(panel.style.height), beforeKeyboard + 16, 'the chat window can also be resized from the keyboard');
  panelResize.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.equal(parseFloat(panel.style.height), beforeKeyboard, 'and shrinks again');

  const mic = shadow.querySelector('[data-voice]');
  assert.equal(mic.hidden, false);
  mic.click();
  assert.equal(mic.getAttribute('data-listening'), 'true');
  window.__recognition.onresult({ results: [[{ transcript: 'dictated words' }]] });
  assert.match(shadow.querySelector('.silo-input').value, /dictated words/);
  window.__recognition.onend();
  assert.equal(mic.getAttribute('data-listening'), 'false');

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
  assert.equal(shadow.querySelector('[data-attachment-name]').textContent, 'second.png');
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

test('navigation asks the visitor first, respects the model’s tab decision, and never leaves on its own', async () => {
  const responseFor = (body) => {
    const controls = body.controls || [];
    if (/advanced runner/i.test(body.message)) {
      return { reply: 'I can open the Advanced Runner for you.', action: { type: 'navigate', path: '/HTML-Runner/Advanced', title: 'Advanced Runner', newTab: false } };
    }
    if (/compare pages/i.test(body.message)) {
      return { reply: 'Here it is in a new tab so you keep this page.', action: { type: 'navigate', path: '/Library', newTab: true } };
    }
    if (/guide/i.test(body.message)) {
      const link = controls.find((control) => control.kind === 'link' && control.label === 'Read the guide');
      return { reply: 'The guide lives on another site.', action: { type: 'openLink', target: link?.id } };
    }
    return { reply: 'Nothing to do.' };
  };
  const { dom, window, requests, errors } = makeWidget({ responseFor });
  const opened = [];
  window.open = (url) => { opened.push(url); return { opener: {} }; };
  const shadow = window.document.querySelector('#siloai-widget-host').shadowRoot;

  submit(window, shadow, 'Take me to the advanced runner'); await flush();
  const linkControl = requests[0].body.controls.find((control) => control.kind === 'link' && control.label === 'Advanced runner');
  assert.deepEqual({ href: linkControl.href, external: linkControl.external, clickable: linkControl.clickable },
    { href: '/HTML-Runner/Advanced', external: false, clickable: false },
    'links carry their destination and stay highlight-only so the widget controls the opening');
  const primary = replyAction(shadow);
  assert.match(primary.textContent, /Go to “Advanced Runner” here/, 'the visitor gets a destination button instead of being sent away');
  assert.equal(opened.length, 0, 'nothing opens before the visitor presses the button');
  primary.click();
  assert.equal(opened.length, 0, 'a same-tab destination is not opened through window.open');
  assert.match(shadow.querySelector('[data-status-text]').textContent, /Opening…|Advanced/, 'the widget reports the pending open');
  assert.equal(primary.disabled, true, 'the card cannot be pressed twice');

  submit(window, shadow, 'I want to compare pages'); await flush();
  const newTabButton = replyAction(shadow);
  assert.match(newTabButton.textContent, /Open “\/Library” in a new tab/);
  assert.equal(opened.length, 0);
  newTabButton.click();
  assert.deepEqual(opened, ['https://example.test/Library'], 'the model’s new-tab decision is honoured');

  submit(window, shadow, 'Show me the guide'); await flush();
  const externalButton = replyAction(shadow);
  assert.match(externalButton.textContent, /in a new tab/, 'off-site links always open in a new tab');
  externalButton.click();
  assert.deepEqual(opened[1], 'https://docs.example.test/guide');
  assert.deepEqual(errors, []);
  dom.window.close();
});

test('the wider action vocabulary reaches the page: scrolling, finding, focusing, ticking, choosing, copying, selecting, and clearing', async () => {
  const responseFor = (body) => {
    const controls = body.controls || [];
    const pick = (kind, label) => controls.find((control) => control.kind === kind && control.label === label);
    if (/scroll to the bottom/i.test(body.message)) return { reply: 'Scrolling.', action: { type: 'scroll', position: 'bottom' } };
    if (/find the word/i.test(body.message)) return { reply: 'Looking for it.', action: { type: 'find', value: 'Visible page information' } };
    if (/focus the name field/i.test(body.message)) return { reply: 'Ready when you are.', action: { type: 'focus', target: pick('field', 'Contact name')?.id } };
    if (/minify/i.test(body.message)) return { reply: 'Ticking that.', action: { type: 'toggle', target: pick('check', 'Minify output')?.id, value: 'checked' } };
    if (/preview width/i.test(body.message)) return { reply: 'Choosing a width.', action: { type: 'select', target: pick('select', 'Preview width')?.id, value: '480px' } };
    if (/clear the name/i.test(body.message)) return { reply: 'Clearing it.', action: { type: 'clear', target: pick('field', 'Contact name')?.id } };
    const intro = controls.find((control) => control.kind === 'text' && control.label.startsWith('Visible page information'));
    if (/copy the intro/i.test(body.message)) return { reply: 'Copied for you.', action: { type: 'copy', target: intro?.id } };
    if (/select the intro/i.test(body.message)) return { reply: 'Selecting it.', action: { type: 'selectText', target: intro?.id } };
    if (/read the guide/i.test(body.message)) return { reply: 'Here is the address.', action: { type: 'click', target: pick('link', 'Read the guide')?.id }, confirmAction: true };
    return { reply: 'Nothing to do.' };
  };
  const { dom, window, requests, errors } = makeWidget({ responseFor });
  const doc = window.document;
  const scrolled = [];
  window.scrollTo = (options) => { scrolled.push(options.top); };
  window.scrollBy = (options) => { scrolled.push(options.top); };
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copied.push(text); } } });
  const shadow = doc.querySelector('#siloai-widget-host').shadowRoot;
  const status = () => shadow.querySelector('[data-status-text]').textContent;

  submit(window, shadow, 'What do you see?'); await flush();
  const kinds = requests[0].body.controls.reduce((all, control) => all.concat(control.kind), []);
  assert.ok(kinds.includes('check') && kinds.includes('select') && kinds.includes('link'), 'checkboxes, dropdowns, and links are described too');
  const check = requests[0].body.controls.find((control) => control.kind === 'check');
  assert.equal(check.state, 'unchecked', 'check state is reported without exposing values');
  const select = requests[0].body.controls.find((control) => control.kind === 'select');
  assert.deepEqual(select.options, ['responsive', '480px'], 'dropdown options are listed so the model can choose one');

  submit(window, shadow, 'Scroll to the bottom'); await flush();
  assert.ok(scrolled.length >= 1, 'page scrolling happens immediately');

  submit(window, shadow, 'Find the word visible'); await flush();
  assert.ok(doc.querySelectorAll('[data-siloai-find]').length >= 1, 'the phrase is marked on the page');
  assert.match(status(), /Found \d+ match/, 'the visitor is told how many matches were found');

  submit(window, shadow, 'Focus the name field'); await flush();
  replyAction(shadow).click();
  assert.equal(doc.activeElement.id, 'name', 'focus lands in the right field');
  assert.match(status(), /Ready to type/);

  submit(window, shadow, 'Tick minify'); await flush();
  assert.equal(doc.querySelector('#minify').checked, false, 'ticking waits for confirmation');
  replyAction(shadow).click();
  assert.equal(doc.querySelector('#minify').checked, true);

  submit(window, shadow, 'Set the preview width'); await flush();
  assert.equal(doc.querySelector('#width').value, 'responsive');
  replyAction(shadow).click();
  assert.equal(doc.querySelector('#width').value, '480px');

  submit(window, shadow, 'Clear the name'); await flush();
  doc.querySelector('#name').value = 'Ada';
  replyAction(shadow).click();
  assert.equal(doc.querySelector('#name').value, '');

  submit(window, shadow, 'Copy the intro'); await flush();
  replyAction(shadow).click();
  await flush();
  assert.match(copied[0] || '', /Visible page information/, 'the text block is copied to the clipboard');

  submit(window, shadow, 'Select the intro'); await flush();
  replyAction(shadow).click();
  assert.ok(String(window.getSelection()), 'text selection is performed on the page');

  submit(window, shadow, 'Read the guide'); await flush();
  replyAction(shadow).click();
  assert.match(status(), /would submit a form or leave this page/, 'an outward link is never clicked in place');
  assert.deepEqual(errors, []);
  dom.window.close();
});
