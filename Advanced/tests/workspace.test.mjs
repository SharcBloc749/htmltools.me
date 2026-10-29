import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, validateName, makeFile, defaultWorkspace, validateWorkspace, nextName, safeArchiveName, resolveFile, renameWorkspaceFile, MAX_FILE_BYTES, MAX_PROJECT_BYTES, templates, contentSize } from '../src/workspace.js';
import { cssURLs } from '../src/compiler.js';
import { scriptJSON, escapeHTML } from '../src/preview.js';
import { zipFiles, fileBytes, importFiles } from '../src/archive.js';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { authError, firebaseConfig } from '../src/auth.js';
import { loadSettings, defaults, clearRetiredAssistant } from '../src/storage.js';

test('default project has stable file references, valid IDs, and an HTML entry', () => {
  const project = validateWorkspace(defaultWorkspace());
  assert.equal(project.files.length, 4);
  assert.equal(new Set(project.files.map(file => file.id)).size, 4);
  assert.equal(project.files.find(file => file.id === project.entryId).name, 'index.html');
  assert.match(project.files[0].content, /href="styles.css"/);
  assert.match(project.files[0].content, /src="script.js"/);
});
test('filenames support folders, unicode, spaces, extension changes, and Windows import paths', () => {
  assert.equal(normalizePath('  src\\a.ts  '), 'src/a.ts');
  assert.equal(normalizePath('notes/café today.md'), 'notes/café today.md');
  for (const name of ['', '../secret', 'a/../b', '/root.txt', 'a//b', './a', 'a/./b', 'a/ b', 'bad\0.js', 'a:b', 'a#b', 'a%b']) assert.throws(() => normalizePath(name), undefined, name);
});
test('duplicates are rejected case-insensitively, while a file can keep its own name', () => {
  const file = makeFile('src/App.ts');
  assert.throws(() => validateName('src/app.ts', [file]), /already exists/);
  assert.equal(validateName(file.name, [file], file.id), file.name);
});
test('duplicate filenames and download names remain deterministic', () => {
  const files = ['src/a.ts', 'src/a-copy.ts', 'src/a-copy-2.ts'].map(name => makeFile(name));
  assert.equal(nextName('src/a.ts', files), 'src/a-copy-3.ts');
  assert.equal(nextName('LICENSE', []), 'LICENSE-copy');
  assert.equal(safeArchiveName('../../My / project?'), '-..-My---project-');
  assert.equal(safeArchiveName(''), 'my-project');
});
test('extensionless, parent, root, and index imports resolve only inside the workspace', () => {
  const files = ['lib/greet.ts', 'src/main.ts', 'lib/index.js', 'data.json'].map(name => makeFile(name));
  assert.equal(resolveFile(files, 'src/main.ts', '../lib/greet').name, 'lib/greet.ts');
  assert.equal(resolveFile(files, 'src/main.ts', '/data.json?v=1').name, 'data.json');
  assert.equal(resolveFile(files, 'main.js', './lib').name, 'lib/index.js');
  assert.equal(resolveFile(files, 'main.js', './missing'), undefined);
});
test('renaming a stylesheet updates HTML references and preserves its identity', () => {
  const project = defaultWorkspace(); const css = project.files[1];
  const files = renameWorkspaceFile(project, css.id, 'assets/theme.css');
  assert.match(files[0].content, /href="assets\/theme.css"/);
  assert.equal(files[1].id, css.id); assert.equal(files[1].name, 'assets/theme.css');
  assert.equal(project.files[1].name, 'styles.css', 'operation does not mutate input');
});
test('moving a module rewrites both incoming imports and outgoing relative paths', () => {
  const main = makeFile('src/main.ts', 'import { n } from "./helper";\nconst r = await fetch("../data.json");');
  const helper = makeFile('src/helper.ts', 'export const n = 3;');
  const page = makeFile('index.html', '<script type="module" src="src/main.ts"></script>');
  const project = { files: [main, helper, page, makeFile('data.json', '{}')] };
  const files = renameWorkspaceFile(project, main.id, 'code/app.ts');
  assert.match(files[0].content, /from "\.\.\/src\/helper.ts"/);
  assert.match(files[0].content, /fetch\("\.\.\/data.json"\)/);
  assert.match(files[2].content, /src="code\/app.ts"/);
});
test('renaming a local module updates imports, not external URLs or unrelated string values', () => {
  const helper = makeFile('lib/helper.ts', 'export const n = 3;');
  const main = makeFile('app.ts', 'import { n } from "./lib/helper";\nimport x from "https://example.test/helper.ts";\nconst label = "./lib/helper";');
  const files = renameWorkspaceFile({ files: [main, helper] }, helper.id, 'lib/calc.ts');
  assert.match(files[0].content, /from "\.\/lib\/calc.ts"/);
  assert.match(files[0].content, /https:\/\/example.test\/helper.ts/);
  assert.match(files[0].content, /label = "\.\/lib\/helper"/);
});
test('saved workspaces reject corrupt IDs, unsafe paths, invalid images and oversized content', () => {
  const project = defaultWorkspace();
  assert.throws(() => validateWorkspace({ ...project, files: [] }));
  assert.throws(() => validateWorkspace({ ...project, files: [project.files[0], project.files[0]] }));
  assert.throws(() => validateWorkspace({ ...project, files: [{ ...project.files[0], name: '../escape' }] }));
  assert.throws(() => validateWorkspace({ ...project, files: [{ ...project.files[0], name: undefined }] }));
  assert.throws(() => validateWorkspace({ ...project, files: [{ ...project.files[0], binary: true, content: 'not!base64' }] }));
  assert.throws(() => validateWorkspace({ ...project, files: [makeFile('large.txt', 'x'.repeat(MAX_FILE_BYTES + 1))] }), /2 MiB/);
  assert.throws(() => validateWorkspace({ ...project, files: Array.from({ length: 9 }, (_, i) => makeFile(i + '.txt', 'x'.repeat(MAX_FILE_BYTES))) }), /16 MiB/);
  const restored = validateWorkspace({ ...project, activeId: 'missing', entryId: 'missing' });
  assert.equal(restored.activeId, project.files[0].id); assert.equal(restored.entryId, project.files[0].id);
});
test('ZIP export contains exactly the selection, with names, UTF-8 content and folder paths intact', () => {
  const files = [makeFile('notes/café.md', '# Café ☕'), makeFile('src/main.py', 'print("Hi!")'), makeFile('not-selected.js', 'secret')];
  const entries = unzipSync(zipFiles(files.slice(0, 2)));
  assert.deepEqual(Object.keys(entries), ['notes/café.md', 'src/main.py']);
  assert.equal(strFromU8(entries['notes/café.md']), '# Café ☕');
  assert.equal(strFromU8(entries['src/main.py']), 'print("Hi!")');
  assert.throws(() => zipFiles([]), /Select at least one/);
});
test('single-file bytes preserve source content without HTML wrapping', () => {
  assert.equal(strFromU8(fileBytes(makeFile('main.ts', templates.ts))), templates.ts);
  assert.deepEqual(Array.from(fileBytes(makeFile('image.png', 'AAECAw==', true))), [0, 1, 2, 3]);
});
test('multiple files and ZIPs import atomically, preserving paths and supported image bytes', async () => {
  const zip = new File([zipFiles([makeFile('src/main.py', 'print(42)'), makeFile('image.png', 'AAECAw==', true)])], 'project.zip');
  const files = await importFiles([zip, new File(['# Hello'], 'README.md')]);
  assert.deepEqual(files.map(file => file.name), ['src/main.py', 'image.png', 'README.md']);
  assert.equal(files[1].binary, true); assert.equal(files[1].content, 'AAECAw==');
  assert.equal(files[2].content, '# Hello');
});
test('imports reject traversal, duplicate names, invalid UTF-8, binary text, and corrupt ZIPs', async () => {
  for (const [name, bytes] of [['../escape.txt', 'no'], ['binary.txt', new Uint8Array([0, 1, 2])], ['invalid.txt', new Uint8Array([255, 255])]]) await assert.rejects(importFiles([new File([bytes], name)]));
  await assert.rejects(importFiles([new File(['x'], 'A.txt'), new File(['y'], 'a.txt')]), /more than one/);
  await assert.rejects(importFiles([new File(['bad zip'], 'bad.zip')]));
  await assert.rejects(importFiles([new File([zipSync({ '../unsafe.js': strToU8('bad') })], 'unsafe.zip')]));
});
test('ZIP advertised sizes and counts are checked before decompression', async () => {
  const oversized = zipSync({ 'large.txt': strToU8('x'.repeat(MAX_FILE_BYTES + 1)) });
  await assert.rejects(importFiles([new File([oversized], 'large.zip')]), /ZIP exceeds/);
  const many = Object.fromEntries(Array.from({ length: 251 }, (_, i) => [i + '.txt', strToU8('x')]));
  await assert.rejects(importFiles([new File([zipSync(many)], 'many.zip')]), /ZIP exceeds/);
});
test('settings tolerate corrupted or blocked storage and migrate non-secret preferences', () => {
  globalThis.localStorage = { getItem: () => '{corrupt' };
  assert.deepEqual(loadSettings(), defaults);
  globalThis.localStorage = { getItem: key => key === 'ahr2_settings' ? '{"wordwrap":true,"autorun":true}' : null };
  assert.equal(loadSettings().wordWrap, true); assert.equal(loadSettings().autoRun, true);
  globalThis.localStorage = { getItem: () => '{"fontSize":999,"tabSize":8,"autoRun":"yes"}' };
  assert.equal(loadSettings().fontSize, 13); assert.equal(loadSettings().tabSize, 2); assert.equal(loadSettings().autoRun, false);
  const removed = []; globalThis.localStorage = { removeItem: key => removed.push(key) }; clearRetiredAssistant();
  assert.deepEqual(removed, ['ahr2_ai', 'ahr2_aichat']); delete globalThis.localStorage;
});
test('Google sign-in uses the existing account project and has actionable deployment and cancellation errors', () => {
  assert.equal(firebaseConfig.projectId, 'htmltools-library');
  assert.match(authError({ code: 'auth/unauthorized-domain' }), /Authorized domains/);
  assert.match(authError({ code: 'auth/operation-not-allowed' }), /enable Google/);
  assert.match(authError({ code: 'auth/popup-blocked' }), /redirect/);
  assert.match(authError({ code: 'auth/popup-closed-by-user' }), /cancelled/);
  assert.match(authError({ code: 'auth/network-request-failed' }), /editor still works/);
});
test('quoted CSS assets with spaces, encoded URLs, and moved image references resolve safely', () => {
  const image = makeFile('images/my photo.png', 'AAECAw==', true);
  const style = makeFile('theme.css', `body { background: url('images/my photo.png'); }`);
  assert.match(cssURLs(style.content, style, [style, image]), /url\("data:image\/png;base64,AAECAw=="\)/);
  assert.equal(resolveFile([image], 'main.js', './images/my%20photo.png').id, image.id);
  const renamed = renameWorkspaceFile({ files: [style, image] }, image.id, 'images/new picture.png');
  assert.match(renamed[0].content, /url\("images\/new picture.png"\)/);
  assert.throws(() => cssURLs('url("missing.png")', style, [style]), /missing asset/);
});
test('renames encode apostrophes rather than breaking single-quoted imports or HTML attributes', () => {
  const helper = makeFile('helper.js', 'export const n = 1;');
  const main = makeFile('main.js', "import { n } from './helper.js';");
  const page = makeFile('index.html', "<script type='module' src='helper.js'></script>");
  const files = renameWorkspaceFile({ files: [main, page, helper] }, helper.id, "maker's.js");
  assert.match(files[0].content, /from '\.\/maker%27s.js'/);
  assert.match(files[1].content, /src='maker%27s.js'/);
  assert.equal(resolveFile(files, 'main.js', './maker%27s.js').id, helper.id);
});
test('binary sizes exclude base64 padding and permit files exactly at the limit', () => {
  assert.equal(contentSize(makeFile('a.png', 'AA==', true)), 1);
  assert.equal(contentSize(makeFile('a.png', 'AAE=', true)), 2);
  const file = makeFile('limit.png', Buffer.alloc(MAX_FILE_BYTES).toString('base64'), true);
  assert.equal(contentSize(file), MAX_FILE_BYTES);
  assert.doesNotThrow(() => validateWorkspace({ version: 3, files: [file], activeId: file.id, entryId: file.id }));
});
test('preview serialization cannot break out of script or HTML contexts', () => {
  const hostile = '</script><img src=x onerror="alert(1)">\u2028\u2029';
  const serialized = scriptJSON({ text: hostile });
  assert.ok(!serialized.includes('<')); assert.ok(!serialized.includes('\u2028')); assert.deepEqual(JSON.parse(serialized), { text: hostile });
  assert.ok(!escapeHTML(hostile).includes('<img')); assert.throws(() => normalizePath('__proto__'));
});
