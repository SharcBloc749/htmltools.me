// End-to-end coverage against the actual checked-in static build. No Firebase credentials needed.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { unzipSync, strFromU8 } from 'fflate';
import { createDevServer } from '../dev-server.mjs';

await mkdir(new URL('../.test-results/', import.meta.url), { recursive: true });
const artifacts = fileURLToPath(new URL('../.test-results/', import.meta.url));
// The npm-distributed headless binary includes the libraries needed in minimal Linux containers.
if (process.platform === 'linux' && !process.env.CHROMIUM_EXECUTABLE) {
  const { inflate } = await import('../node_modules/@sparticuz/chromium/build/esm/lambdafs.js');
  const libraries = await inflate(fileURLToPath(new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url)));
  process.env.LD_LIBRARY_PATH = `${libraries}/lib:${process.env.LD_LIBRARY_PATH || ''}`;
}
const server = createDevServer(); await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const base = `http://127.0.0.1:${server.address().port}/Advanced/`;
const browser = await playwright.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || await chromium.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], headless: true });
let page, context, checks = 0, compilerRequests = 0;
async function check(name, task) { await task(); checks++; console.log(`✓ ${name}`); }
async function fresh(viewport = { width: 1440, height: 940 }) {
  if (context) await context.close(); context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.route('https://**', route => route.abort());
  page = await context.newPage(); compilerRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/esbuild.wasm')) compilerRequests++; });
  page.on('pageerror', error => { console.error('Browser page error:', error.message); });
  await page.goto(base); await page.locator('.cm-content').waitFor();
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved locally');
  return page;
}
async function saved() { await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved locally'); }
async function code(content) { await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(content); }
async function selectEntry(name) { await page.locator('#entry-file').selectOption({ label: name }); }
async function runUntil(text) { await page.locator('#run-button:enabled').click(); await page.waitForFunction(text => document.querySelector('#console-output').textContent.includes(text), text, { timeout: 45000 }); }
async function addFile(name, template = 'txt') {
  await page.locator('#new-file').click(); await page.selectOption('#file-template', template); await page.fill('#file-name', name); await page.locator('#file-submit').click(); await page.locator('#file-dialog').waitFor({ state: 'hidden' });
}
async function importText(files) { await page.locator('#import-input').setInputFiles(files.map(([name, content]) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(content) }))); await page.waitForFunction(n => document.querySelectorAll('#file-list .file-row').length === n, 4 + files.length); }

try {
  await fresh();
  await check('starter project runs with local CSS, JavaScript, and console bridge', async () => {
    const button = page.frameLocator('#preview-frame').getByRole('button', { name: 'Say hello' }); await button.waitFor(); await button.click();
    await page.waitForFunction(() => document.querySelector('#console-output').textContent.includes('A little hello'));
    assert.match(await page.frameLocator('#preview-frame').locator('#message').textContent(), /Hello, maker/);
    assert.equal(compilerRequests, 0, 'ordinary web starter does not download a WASM compiler');
    await page.screenshot({ path: artifacts + 'desktop.png' });
  });
  await check('project and file renaming preserve source references', async () => {
    await page.locator('#project-name').click(); await page.fill('#project-name-input', 'My comfortable workspace'); await page.locator('#name-form').getByRole('button', { name: 'Save name' }).click();
    await page.getByRole('button', { name: 'Actions for styles.css', exact: true }).click(); await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await page.fill('#file-name', 'assets/theme.css'); await page.locator('#file-submit').click();
    await page.locator('#file-tabs').getByRole('tab', { name: 'index.html', exact: true }).click();
    assert.match(await page.locator('.cm-content').textContent(), /href="assets\/theme.css"/);
    await page.locator('#run-button').click(); await page.frameLocator('#preview-frame').getByRole('button', { name: 'Say hello' }).waitFor();
  });
  await check('single-file download has the chosen name and exact source content', async () => {
    await page.locator('#download-button').click(); await page.locator('#download-select-none').click();
    await page.locator('.download-file').filter({ hasText: 'assets/theme.css' }).locator('input').check();
    await page.fill('#download-name', 'my-style.css');
    const promise = page.waitForEvent('download'); await page.locator('#download-submit').click(); const download = await promise;
    assert.equal(download.suggestedFilename(), 'my-style.css'); assert.match(await readFile(await download.path(), 'utf8'), /font-family: system-ui/);
  });
  await check('arbitrary multi-file selection downloads only those paths in a named ZIP', async () => {
    await page.locator('#download-button').click(); await page.locator('#download-select-none').click();
    for (const name of ['assets/theme.css', 'script.js']) await page.locator('.download-file').filter({ hasText: name }).locator('input').check();
    await page.fill('#download-name', 'just-two.zip'); const promise = page.waitForEvent('download'); await page.locator('#download-submit').click(); const download = await promise;
    assert.equal(download.suggestedFilename(), 'just-two.zip'); const entries = unzipSync(new Uint8Array(await readFile(await download.path())));
    assert.deepEqual(Object.keys(entries), ['assets/theme.css', 'script.js']); assert.match(strFromU8(entries['script.js']), /addEventListener/);
  });
  await check('autosave survives reload without automatically executing restored code', async () => {
    await saved(); await page.reload(); await page.locator('.cm-content').waitFor(); await saved();
    assert.match(await page.locator('#project-name').textContent(), /My comfortable workspace/);
    assert.equal(await page.locator('#console-count').textContent(), '0'); assert.equal(await page.locator('#preview-placeholder').isVisible(), true);
    assert.equal(await page.locator('#runtime-status').textContent(), 'Ready when you are');
  });
  await check('file creation validates duplicates and deletion requires confirmation', async () => {
    await page.locator('#new-file').click(); await page.fill('#file-name', 'SCRIPT.js'); await page.locator('#file-submit').click();
    assert.match(await page.locator('#file-error').textContent(), /already exists/); await page.locator('#file-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await addFile('notes.md', 'md'); await page.getByRole('button', { name: 'Actions for notes.md', exact: true }).click(); await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.locator('#confirm-dialog').getByRole('button', { name: 'Keep it' }).click(); assert.equal(await page.getByRole('button', { name: 'Actions for notes.md', exact: true }).count(), 1);
  });
  await check('word wrap, font size, indentation, search, and keyboard resizing respond', async () => {
    await page.locator('#settings-button').click(); await page.selectOption('#setting-font', '16'); await page.selectOption('#setting-tab', '4'); await page.locator('#setting-wrap').check();
    await page.locator('#settings-dialog').getByRole('button', { name: 'All comfortable' }).click();
    assert.equal(await page.locator('.cm-content').evaluate(node => getComputedStyle(node).fontSize), '16px');
    assert.equal(await page.locator('#wrap-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('#find-button').click(); await page.locator('.cm-search input[name="search"]').fill('ideas'); await page.locator('.cm-search button[name="close"]').click();
    await page.locator('#vertical-resizer').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#vertical-resizer').getAttribute('aria-valuenow'), '55');
    await page.locator('#console-toggle').click(); assert.equal(await page.locator('#console-pane').evaluate(node => Math.round(node.getBoundingClientRect().height)), 37); await page.locator('#console-toggle').click();
  });
  await check('reference retains web snippets and adds Python and TypeScript search', async () => {
    await page.locator('#nav-reference').click(); await page.locator('[data-category="py"]').click();
    assert.equal(await page.locator('.reference-card').count(), 3); await page.locator('#reference-search').fill('files');
    assert.equal(await page.locator('.reference-card').count(), 1); await page.screenshot({ path: artifacts + 'reference.png' }); await page.locator('#nav-editor').click();
  });
  await check('Google and email sign-in remain optional and expose real form flows', async () => {
    await page.locator('#account-button').click(); await page.locator('#google-sign-in').waitFor(); assert.match(await page.locator('#google-sign-in').textContent(), /Continue with Google/);
    await page.locator('#auth-register-tab').click(); assert.equal(await page.locator('#auth-name-group').isVisible(), true); assert.equal(await page.locator('#auth-password').getAttribute('autocomplete'), 'new-password');
    await page.locator('#auth-sign-in-tab').click(); assert.equal(await page.locator('#auth-name-group').isVisible(), false);
    await page.screenshot({ path: artifacts + 'sign-in.png' }); await page.locator('#auth-dialog').getByRole('button', { name: 'Keep working locally' }).click();
  });

  await fresh();
  await check('TypeScript compiles local imports, JSON data, CSS imports, and top-level await', async () => {
    await importText([
      ['main.ts', 'import { double } from "./lib/helper";\nimport data from "./data.json";\nimport "./module.css";\nconst result: number = double(data.value);\nconsole.log("TS RESULT", result);\nconst fetched = await (await fetch("./data.json")).json();\nconsole.log("FETCH RESULT", fetched.value);'],
      ['lib/helper.ts', 'export const double = (value: number): number => value * 2;'],
      ['data.json', '{"value":21}'], ['module.css', 'body { border-top: 4px solid black; }'],
    ]);
    await runUntil('FETCH RESULT 21'); assert.match(await page.locator('#console-output').textContent(), /TS RESULT 42/);
  });
  await check('compilation errors are visible and Run recovers after fixing the file', async () => {
    await code('const broken: = ;'); await runUntil('Unexpected'); assert.match(await page.locator('#runtime-status').textContent(), /Could not run/); assert.equal(await page.locator('#run-button').isEnabled(), true);
    await code('const answer: number = 42; console.log("FIXED", answer);'); await runUntil('FIXED 42');
  });
  await check('JSON validation and Markdown previews are actual rendered documents', async () => {
    await selectEntry('data.json'); await page.locator('#run-button').click(); await page.frameLocator('#preview-frame').locator('pre').waitFor(); assert.match(await page.frameLocator('#preview-frame').locator('pre').textContent(), /"value": 21/);
    await addFile('safe.md', 'md'); await code('# Real heading\n\n**Bold** text.\n\n<script>console.log("UNSAFE SCRIPT")</script>\n<img src="x" onerror="console.log(\'UNSAFE IMAGE\')">');
    await page.locator('#run-button').click(); await page.frameLocator('#preview-frame').getByRole('heading', { name: 'Real heading' }).waitFor();
    assert.equal(await page.frameLocator('#preview-frame').locator('strong').textContent(), 'Bold');
    assert.doesNotMatch(await page.locator('#console-output').textContent(), /UNSAFE/);
  });
  await check('SVG preview renders valid XML; unsupported native files stay honest text previews', async () => {
    await addFile('drawing.svg', 'svg'); await page.locator('#run-button').click(); await page.frameLocator('#preview-frame').getByRole('img').waitFor();
    assert.equal(await page.frameLocator('#preview-frame').getByRole('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await addFile('main.cpp'); await code('#include <iostream>\nint main() { std::cout << "hello"; }'); await page.locator('#run-button').click();
    await page.frameLocator('#preview-frame').getByText('Text preview only.', { exact: false }).waitFor();
  });
  await check('preview code cannot access editor storage or forge parent console messages', async () => {
    await addFile('isolation.html', 'html');
    await code('<!doctype html><h1>Isolated</h1><script>try { parent.document.body; console.log("BAD ACCESS"); } catch { console.log("PARENT ISOLATED"); } try { localStorage.setItem("bad", "bad"); console.log("BAD STORAGE"); } catch { console.log("STORAGE ISOLATED"); } parent.postMessage({ workspaceToken: "fake", type: "console", level: "error", message: "FORGED" }, "*");</script>');
    await runUntil('STORAGE ISOLATED'); assert.match(await page.locator('#console-output').textContent(), /PARENT ISOLATED/); assert.doesNotMatch(await page.locator('#console-output').textContent(), /BAD|FORGED/);
  });

  await fresh();
  await check('classic deferred scripts, global handlers, inline CSS imports, spaced assets, and local page links work', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="black"/></svg>';
    const image = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    await importText([
      ['pages/demo.html', `<!doctype html><html><head><style>@import "../theme.css";</style><script defer src="../deferred.js"></script></head><body><h1 id="target">Deferred page</h1><button onclick="wave()">Wave</button><div id="art" style="background-image:url('../art/my image.svg')">Art</div><img alt="Data source" srcset="${image} 1x"><a href="about.html">Next page</a></body></html>`],
      ['deferred.js', 'console.log("DEFERRED FOUND", !!document.querySelector("#target")); function wave() { console.log("GLOBAL FUNCTION"); }'],
      ['theme.css', 'body { background: #f0f0f0; }'], ['art/my image.svg', svg], ['pages/about.html', '<!doctype html><h1>About this project</h1>'],
    ]);
    await runUntil('DEFERRED FOUND true');
    await page.frameLocator('#preview-frame').getByRole('button', { name: 'Wave' }).click();
    await page.waitForFunction(() => document.querySelector('#console-output').textContent.includes('GLOBAL FUNCTION'));
    assert.match(await page.frameLocator('#preview-frame').locator('#art').getAttribute('style'), /data:image\/svg\+xml;base64/);
    assert.equal(await page.frameLocator('#preview-frame').locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(240, 240, 240)');
    assert.match(await page.frameLocator('#preview-frame').getByRole('img').getAttribute('srcset'), new RegExp('base64,' + Buffer.from(svg).toString('base64').slice(0, 12)));
    await page.frameLocator('#preview-frame').getByRole('link', { name: 'Next page' }).click();
    await page.frameLocator('#preview-frame').getByRole('heading', { name: 'About this project' }).waitFor();
  });
  await check('console floods are bounded and filters and clearing still work', async () => {
    await addFile('logs.js', 'js'); await code('for (let i = 0; i < 2000; i++) console.log("line", i);'); await runUntil('Console output paused');
    assert.equal(await page.locator('#console-count').textContent(), '500');
    await page.selectOption('#console-filter', 'warn'); assert.equal(await page.locator('.console-entry').count(), 1);
    await page.locator('#clear-console').click(); assert.equal(await page.locator('#console-count').textContent(), '0');
  });

  await fresh();
  await check('Python runs local modules and reads sibling project files in an opaque worker', async () => {
    await importText([['main.py', 'import math\nfrom helper import greet\nfrom pathlib import Path\nprint(greet("maker"))\nprint("ROOT", math.isqrt(1764))\nprint("DATA", Path("numbers.txt").read_text())\nfrom js import self\nprint("ORIGIN", self.origin)'], ['helper.py', 'def greet(name):\n    return f"Hello, {name}!"'], ['numbers.txt', 'local data']]);
    await runUntil('ORIGIN null'); await page.waitForFunction(() => document.querySelector('#runtime-status').textContent === 'Python finished');
    assert.match(await page.locator('#console-output').textContent(), /Hello, maker!/); assert.match(await page.locator('#console-output').textContent(), /ROOT 42/); assert.match(await page.locator('#console-output').textContent(), /DATA local data/);
    await page.screenshot({ path: artifacts + 'python.png' });
  });
  await check('Stop terminates infinite Python without freezing the editor, and subsequent runs work', async () => {
    await code('print("LOOP STARTED", flush=True)\nwhile True:\n    pass'); await runUntil('LOOP STARTED'); await page.locator('#stop-button').click(); assert.equal(await page.locator('#runtime-status').textContent(), 'Preview stopped');
    await code('print("AFTER STOP")'); await runUntil('AFTER STOP'); await page.waitForFunction(() => document.querySelector('#runtime-status').textContent === 'Python finished');
  });
  await check('Python exceptions and interactive-input limitations are reported clearly', async () => {
    await code('raise ValueError("A useful error")'); await runUntil('A useful error'); await page.waitForFunction(() => document.querySelector('#runtime-status').textContent === 'Python stopped with an error');
    await code('input("Your name?")'); await runUntil('Interactive input() is not supported');
  });

  for (const width of [390, 320, 768]) {
    await fresh({ width, height: 844 });
    await check(`responsive ${width}px layout has usable file tools, preview, and dialogs without page overflow`, async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width <= 760) { await page.locator('#toggle-files').click(); assert.equal(await page.locator('#explorer').isVisible(), true); await page.locator('#new-file').click(); }
      else await page.locator('#new-file').click();
      await page.fill('#file-name', 'mobile.py'); await page.selectOption('#file-template', 'py'); await page.locator('#file-submit').click();
      const entryRect = await page.locator('#entry-file').boundingBox(), runRect = await page.locator('#run-button').boundingBox();
      assert.ok(entryRect.x + entryRect.width <= runRect.x, 'entry selector must not overlap Run');
      await page.locator('#run-button').click(); await page.waitForFunction(() => document.querySelector('#runtime-status').textContent === 'Python finished', { timeout: 45000 });
      assert.equal(await page.locator('#preview-frame').isVisible(), true); await page.screenshot({ path: artifacts + `mobile-${width}.png` });
      await page.locator('#download-button').click(); assert.equal(await page.locator('#download-dialog').isVisible(), true);
      const dialog = await page.locator('#download-dialog').boundingBox(); assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width);
      await page.locator('#download-dialog').getByRole('button', { name: 'Cancel' }).click();
    });
  }
  console.log(`\n${checks} browser scenarios passed. Screenshots: Advanced/.test-results/`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: artifacts + 'failure.png' }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
