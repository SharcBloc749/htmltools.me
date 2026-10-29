import * as esbuild from 'esbuild-wasm';
import { extension, resolveFile, isImage } from './workspace.js';
import { fileBytes, encodeBinary } from './archive.js';
let initialized;
export function initializeCompiler() {
  if (!initialized) initialized = esbuild.initialize({ wasmURL: new URL('./esbuild.wasm', import.meta.url).href, worker: true }).catch(error => { initialized = null; throw error; });
  return initialized;
}
export const mime = name => ({ html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon' }[extension(name)] || 'text/plain');
export const dataURL = file => `data:${mime(file.name)};base64,${file.binary ? file.content : encodeBinary(fileBytes(file))}`;
export function cssURLs(content, file, files) {
  return content.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi, (match, doubleQuoted, singleQuoted, bare) => {
    const path = doubleQuoted ?? singleQuoted ?? bare;
    if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(path)) return match;
    const asset = resolveFile(files, file.name, path);
    if (!asset) throw new Error(`“${file.name}” references missing asset “${path}”.`);
    const fragment = path.includes('#') ? '#' + path.split('#')[1] : '';
    return `url("${dataURL(asset)}${fragment}")`;
  });
}
export async function compile(file, files) {
  const ext = extension(file.name);
  // Ordinary web pages should not download a compiler. Load WASM only for typed
  // code or an actual module graph; CSS and standalone JS can run natively.
  if (ext === 'css' && !/@import\b/i.test(file.content)) return { js: '', css: cssURLs(file.content, file, files), warnings: [] };
  if (['js', 'mjs'].includes(ext) && !/\b(?:import|export|require|module|exports)\b/.test(file.content)) {
    return { js: file.content + '\n//# sourceURL=workspace/' + encodeURI(file.name), css: '', warnings: [] };
  }
  await initializeCompiler();
  const result = await esbuild.build({
    entryPoints: [file.name], bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser',
    outfile: extension(file.name) === 'css' ? '/output.css' : '/output.js', logLevel: 'silent',
    sourcemap: 'inline', legalComments: 'none',
    plugins: [{ name: 'workspace', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (/^(?:https?:|data:|blob:|\/\/)/i.test(args.path)) return { path: args.path, external: true };
        const found = args.kind === 'entry-point' ? files.find(item => item.name === args.path) : resolveFile(files, args.importer, args.path);
        if (found) return { path: found.name, namespace: 'workspace' };
        return { errors: [{ text: `Cannot find “${args.path}”${args.importer ? ` imported by “${args.importer}”` : ''}. Add the file to this project, or use a full https:// ESM URL for a browser-compatible package.` }] };
      });
      build.onLoad({ filter: /.*/, namespace: 'workspace' }, args => {
        const source = files.find(item => item.name === args.path);
        if (source.binary || isImage(source.name) || extension(source.name) === 'svg') return { contents: dataURL(source), loader: 'text' };
        const ext = extension(source.name);
        const loader = { js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'tsx', jsx: 'jsx', css: 'css', json: 'json' }[ext] || 'text';
        return { contents: ext === 'css' ? cssURLs(source.content, source, files) : source.content, loader };
      });
    } }],
  });
  return {
    js: result.outputFiles.find(output => output.path.endsWith('.js'))?.text || '',
    css: result.outputFiles.find(output => output.path.endsWith('.css'))?.text || '',
    warnings: result.warnings.map(warning => warning.text),
  };
}
