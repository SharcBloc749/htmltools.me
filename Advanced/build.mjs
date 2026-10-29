import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
await mkdir('assets/python', { recursive: true });
for (const file of await readdir('assets')) if (/^(?:app|chunk-[A-Z0-9]+)\.js(?:\.LEGAL\.txt)?$/.test(file)) await unlink(path.join('assets', file));
for (const file of ['PYODIDE-LICENSE', 'PYTHON-LICENSE']) await copyFile('licenses/' + file, 'assets/python/' + file);
await build({ entryPoints: ['src/app.js'], outdir: 'assets', entryNames: '[name]', chunkNames: 'chunk-[hash]', bundle: true, splitting: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'linked', logLevel: 'info' });
await copyFile('node_modules/esbuild-wasm/esbuild.wasm', 'assets/esbuild.wasm');
for (const file of ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) await copyFile('node_modules/pyodide/' + file, 'assets/python/' + file);
for (const file of ['assets/esbuild.wasm', 'assets/python/pyodide.asm.wasm']) await chmod(file, 0o644);
// Include license texts for shipped dependencies, including transitive packages.
const visited = new Set(), notices = [];
async function dependency(name, from) {
  let directory = from, found;
  while (directory.startsWith(root)) {
    const candidate = path.join(directory, 'node_modules', name);
    try { await readFile(path.join(candidate, 'package.json')); found = candidate; break; } catch { directory = path.dirname(directory); }
  }
  if (!found || visited.has(found)) return; visited.add(found);
  const info = JSON.parse(await readFile(path.join(found, 'package.json'), 'utf8'));
  let license = '';
  for (const file of await readdir(found)) if (/^(?:licen[sc]e|copying)(?:\..*)?$/i.test(file)) license += await readFile(path.join(found, file), 'utf8') + '\n';
  notices.push(`${'='.repeat(72)}\n${info.name}@${info.version} · ${info.license || 'See upstream license'}\n${license || (name === 'pyodide' ? 'See PYODIDE-LICENSE and PYTHON-LICENSE in this directory.\n' : '')}`);
  for (const child of Object.keys(info.dependencies || {})) await dependency(child, found);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const name of Object.keys(pkg.dependencies)) await dependency(name, root);
await writeFile('assets/THIRD_PARTY_NOTICES.txt', notices.sort().join('\n'));
console.log('Built static workspace with locally hosted TypeScript and Python runtimes.');
