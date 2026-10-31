import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('SiloAI dashboard, widget, source Worker, and generated Worker are present', async () => {
  for (const path of ['../index.html', '../app.js', '../style.css', '../widget.js', '../worker.js', '../brandmark.svg', '../src/index.mjs', '../wrangler.toml']) {
    assert.ok((await text(path)).length > 0, `${path} should exist and not be empty`);
  }
  const widget = await text('../widget.js');
  assert.match(widget, /SiloAI\/brandmark\.svg/);
  assert.match(widget, /\.silo-fab img\{display:block;width:100%;height:100%/);
  const wrangler = await text('../wrangler.toml');
  assert.match(wrangler, /name\s*=\s*"siloai"/);
  assert.match(wrangler, /binding\s*=\s*"AI"/);
  assert.match(wrangler, /class_name\s*=\s*"SiloLimiter"/);
  assert.doesNotMatch(wrangler, /GITHUB_TOKEN\s*=\s*"[A-Za-z0-9_]/);
});

test('SiloAI is deliberately not promoted in the Tools directory or sitemap', async () => {
  const directory = await readFile(new URL('../../Tools/index.html', import.meta.url), 'utf8');
  const sitemap = await readFile(new URL('../../sitemap1.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(directory, /SiloAI/i);
  assert.doesNotMatch(sitemap, /SiloAI/i);
});
