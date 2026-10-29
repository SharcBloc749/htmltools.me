import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { extension, isHTML, isScript, resolveFile, resolvePath } from './workspace.js';
import { compile, cssURLs, dataURL, mime } from './compiler.js';
import { pythonWorkerMain } from './python-worker.js';

export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const scriptJSON = data => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const previewStyle = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f7f7f4;color:#292928;font:14px/1.85 system-ui,sans-serif}main{max-width:780px;margin:auto;padding:44px 36px}h1,h2,h3{line-height:1.3;letter-spacing:-.025em}h1{font-size:34px}h2{margin-top:1.6em}a{color:inherit;text-decoration:underline;text-underline-offset:3px}img,svg{max-width:100%}pre{background:#ebebe7;padding:18px;border-radius:8px;overflow:auto;line-height:1.7}code{font-family:ui-monospace,monospace;font-size:.88em}p code,li code{background:#eaeae6;padding:2px 5px;border-radius:4px}blockquote{border-left:2px solid #aaa;margin-left:0;padding-left:20px;color:#777}table{border-collapse:collapse;width:100%}th,td{padding:8px 12px;border:1px solid #d4d4cf;text-align:left}.note{font:11px/1.7 system-ui,sans-serif;color:#777;border-bottom:1px solid #ddd;padding:14px 24px}hr{border:0;border-top:1px solid #ddd;margin:30px 0}`;
const documentHTML = (body, style = previewStyle) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>${body}</body></html>`;

// Runs only inside sandbox="allow-scripts". No allow-same-origin, popups, or navigation.
function consoleBridge(token, entry, project) {
  let consoleMessages = 0;
  const send = (type, payload) => {
    if (type === 'console' && ++consoleMessages > 1000) {
      if (consoleMessages === 1001) parent.postMessage({ workspaceToken: token, type: 'console', level: 'warn', message: 'Console output paused after 1,000 messages. Rerun to reset.' }, '*');
      return;
    }
    parent.postMessage({ workspaceToken: token, type, ...payload }, '*');
  };
  const serialize = value => {
    try {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      if (typeof value === 'undefined') return 'undefined';
      if (typeof value === 'function') return value.toString();
      const seen = new WeakSet();
      return JSON.stringify(value, (key, item) => {
        if (typeof item === 'bigint') return String(item) + 'n';
        if (item && typeof item === 'object') { if (seen.has(item)) return '[Circular]'; seen.add(item); }
        return item;
      }, 2) ?? String(value);
    } catch { return String(value); }
  };
  ['log', 'info', 'warn', 'error', 'debug', 'table'].forEach(level => {
    const original = console[level];
    console[level] = (...args) => { send('console', { level: level === 'table' || level === 'debug' ? 'log' : level, message: args.map(serialize).join(' ').slice(0, 16000) }); original?.apply(console, args); };
  });
  console.assert = (condition, ...args) => { if (!condition) console.error('Assertion failed:', ...args); };
  window.addEventListener('error', event => { if (event.message) send('console', { level: 'error', message: `${event.message}${event.lineno ? ' (line ' + event.lineno + ')' : ''}` }); }, true);
  window.addEventListener('unhandledrejection', event => send('console', { level: 'error', message: serialize(event.reason) }));
  window.addEventListener('load', () => send('ready', {}));
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[data-workspace-file]');
    if (anchor) { event.preventDefault(); send('navigate', { id: anchor.dataset.workspaceFile }); }
  });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (!path || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) return nativeFetch(input, options);
    let decoded;
    try { decoded = decodeURIComponent(path.split(/[?#]/)[0]); } catch { return Promise.reject(new Error(`Invalid project URL: ${path}`)); }
    const parts = decoded.startsWith('/') ? [] : entry.split('/').slice(0, -1);
    for (const part of decoded.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
    const file = project[parts.join('/')];
    if (!file) return Promise.reject(new Error(`Project file not found: ${path}`));
    const bytes = file.binary ? Uint8Array.from(atob(file.content), char => char.charCodeAt(0)) : file.content;
    return Promise.resolve(new Response(bytes, { status: 200, headers: { 'Content-Type': file.mime } }));
  };
}
function injectBridge(doc, token, entry, files) {
  const script = doc.createElement('script');
  const project = Object.fromEntries(files.map(file => [file.name, { content: file.content, binary: Boolean(file.binary), mime: mime(file.name) }]));
  script.textContent = `(${consoleBridge.toString()})(${scriptJSON(token)},${scriptJSON(entry.name)},${scriptJSON(project)});`;
  doc.head.prepend(script);
  // srcdoc's default base URL is the editor. Prevent accidental requests to editor routes.
  doc.querySelectorAll('base').forEach(base => base.remove());
  const base = doc.createElement('base'); base.href = 'about:blank'; doc.head.prepend(base);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
function rewriteAssets(doc, entry, files) {
  for (const node of doc.querySelectorAll('[style]')) node.setAttribute('style', cssURLs(node.getAttribute('style'), entry, files));
  for (const node of doc.querySelectorAll('[src], [poster], a[href], [srcset]')) {
    for (const attr of ['src', 'poster', 'href']) {
      if (!node.hasAttribute(attr) || (attr === 'href' && node.tagName !== 'A') || node.tagName === 'SCRIPT') continue;
      const path = node.getAttribute(attr);
      if (!path || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(path)) continue;
      const file = resolveFile(files, entry.name, path);
      if (!file) continue;
      if (attr === 'href' && isHTML(file.name)) { node.dataset.workspaceFile = file.id; node.setAttribute('href', '#'); }
      else node.setAttribute(attr, dataURL(file));
    }
    if (node.hasAttribute('srcset') && !/\bdata:/i.test(node.getAttribute('srcset'))) {
      node.setAttribute('srcset', node.getAttribute('srcset').split(',').map(candidate => {
        const [path, ...descriptor] = candidate.trim().split(/\s+/);
        if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) return candidate;
        const file = resolveFile(files, entry.name, path);
        return file ? `${dataURL(file)} ${descriptor.join(' ')}` : candidate;
      }).join(', '));
    }
  }
}
export async function buildPreview(entry, files, token) {
  const ext = extension(entry.name);
  let source, notice = '';
  const warnings = [];
  if (isHTML(entry.name)) {
    const doc = new DOMParser().parseFromString(entry.content, 'text/html');
    for (const link of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
      const path = link.getAttribute('href');
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) continue;
      const file = resolveFile(files, entry.name, path);
      if (!file) throw new Error(`“${entry.name}” links to missing stylesheet “${path}”.`);
      const result = await compile(file, files);
      const style = doc.createElement('style'); style.textContent = result.css; link.replaceWith(style); warnings.push(...result.warnings);
    }
    let inlineStyle = 0;
    for (const style of doc.querySelectorAll('style')) {
      if (/@import\b/i.test(style.textContent)) {
        const virtual = { id: 'inline-style', name: `${entry.name}.inline-${inlineStyle++}.css`, content: style.textContent };
        const result = await compile(virtual, [...files.filter(file => file.name !== virtual.name), virtual]);
        style.textContent = result.css; warnings.push(...result.warnings);
      } else style.textContent = cssURLs(style.textContent, entry, files);
    }
    for (const script of doc.querySelectorAll('script')) {
      const path = script.getAttribute('src');
      if (path && /^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) continue;
      const type = script.getAttribute('type') || '';
      if (type && !['module', 'text/javascript', 'application/javascript', 'text/typescript'].includes(type)) continue;
      if (!path) {
        // Inline modules can import other files in the project too.
        if (script.textContent.trim() && (type === 'module' || type === 'text/typescript')) {
          const inline = { id: 'inline', name: `${entry.name}.inline.${type === 'text/typescript' ? 'ts' : 'js'}`, content: script.textContent };
          const result = await compile(inline, [...files.filter(file => file.name !== inline.name), inline]); script.textContent = result.js; script.type = 'module';
          if (result.css) { const style = doc.createElement('style'); style.textContent = result.css; doc.head.append(style); }
        }
        continue;
      }
      const file = resolveFile(files, entry.name, path);
      if (!file) throw new Error(`“${entry.name}” references missing script “${path}”.`);
      const result = await compile(file, files);
      script.removeAttribute('integrity'); script.removeAttribute('crossorigin');
      if (type === 'module' || /\.(?:ts|tsx|jsx|mjs)$/i.test(file.name)) script.type = 'module';
      // A data URL preserves classic-script globals and async/defer behavior;
      // converting a deferred head script to inline code would run it too early.
      script.setAttribute('src', dataURL({ name: 'compiled.js', content: result.js }));
      script.textContent = ''; warnings.push(...result.warnings);
      if (result.css) { const style = doc.createElement('style'); style.textContent = result.css; doc.head.append(style); }
    }
    rewriteAssets(doc, entry, files);
    // outerHTML serializes script/style text literally; escape closing tags in generated code/data.
    for (const script of doc.querySelectorAll('script')) script.textContent = script.textContent.replace(/<\/script/gi, '<\\/script');
    return { html: injectBridge(doc, token, entry, files), warnings, mode: 'Web preview' };
  }
  if (isScript(entry.name)) {
    const result = await compile(entry, files);
    source = documentHTML(`<main><div style="font:11px ui-monospace,monospace;color:#777">${escapeHTML(entry.name)}</div><h1>Your program is running.</h1><p>Console output appears below. Edit, experiment, repeat.</p></main>`);
    const doc = new DOMParser().parseFromString(source, 'text/html');
    if (result.css) { const style = doc.createElement('style'); style.textContent = result.css; doc.head.append(style); }
    const script = doc.createElement('script'); script.type = 'module'; script.textContent = result.js.replace(/<\/script/gi, '<\\/script'); doc.body.append(script);
    return { html: injectBridge(doc, token, entry, files), warnings: result.warnings, mode: ext === 'ts' || ext === 'tsx' ? 'TypeScript' : 'JavaScript' };
  }
  if (ext === 'md' || ext === 'markdown') {
    source = documentHTML(`<main>${DOMPurify.sanitize(marked.parse(entry.content), { ADD_ATTR: ['target'] })}</main>`);
  } else if (ext === 'json') {
    const formatted = JSON.stringify(JSON.parse(entry.content), null, 2);
    source = documentHTML(`<div class="note">VALID JSON · ${escapeHTML(entry.name)}</div><main><pre style="background:transparent;padding:0">${escapeHTML(formatted)}</pre></main>`);
  } else if (ext === 'svg' || entry.binary) {
    if (ext === 'svg') {
      const xml = new DOMParser().parseFromString(entry.content, 'image/svg+xml');
      if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') throw new Error('This SVG is not valid XML with an <svg> root element.');
    }
    source = documentHTML(`<main style="min-height:100vh;display:grid;place-items:center"><img alt="${escapeHTML(entry.name)}" src="${dataURL(entry)}"></main>`);
  } else if (ext === 'css') {
    const result = await compile(entry, files);
    source = documentHTML(`<main><h1>Stylesheet preview</h1><p>This sample page uses <strong>${escapeHTML(entry.name)}</strong>. To style your actual page, select its HTML entry instead.</p><section class="card"><h2>A heading</h2><p>A paragraph with a <a href="#">link</a>.</p><button>A button</button><ul><li>First idea</li><li>Next idea</li></ul></section></main>`, result.css);
  } else {
    if (!['txt', 'csv', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) notice = 'Text preview only. This file type needs its own runtime to execute.';
    source = documentHTML(`${notice ? `<div class="note">${notice}</div>` : ''}<main><pre style="background:transparent;padding:0;white-space:pre-wrap">${escapeHTML(entry.content)}</pre></main>`);
  }
  const doc = new DOMParser().parseFromString(source, 'text/html'); rewriteAssets(doc, entry, files);
  return { html: injectBridge(doc, token, entry, files), warnings, mode: ext === 'md' || ext === 'markdown' ? 'Markdown' : ext === 'json' ? 'JSON' : ext === 'svg' || entry.binary ? 'Image preview' : ext === 'css' ? 'CSS preview' : 'Text preview' };
}

let pythonAssetsPromise;
export function loadPythonAssets() {
  if (!pythonAssetsPromise) pythonAssetsPromise = Promise.all(['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'].map(async name => {
    const response = await fetch(new URL(`./python/${name}`, import.meta.url));
    if (!response.ok) throw new Error(`Could not load Python (${name}). Check your connection and try again.`);
    return [name, await response.arrayBuffer()];
  })).then(Object.fromEntries).catch(error => { pythonAssetsPromise = null; throw error; });
  return pythonAssetsPromise;
}
function pythonFrame(token, workerSource) {
  const send = (type, payload) => parent.postMessage({ workspaceToken: token, type, ...payload }, '*');
  const output = document.getElementById('output');
  const status = document.getElementById('status');
  const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
  worker.onmessage = event => {
    const { level, message } = event.data;
    if (level === 'done' || level === 'failed') { status.textContent = message; send('finished', { failed: level === 'failed' }); }
    else {
      status.textContent = 'Running Python…';
      const line = document.createElement('div'); line.textContent = message; if (level === 'error') line.style.color = '#f3aaaa'; output.append(line);
      if (output.childElementCount > 500) output.firstElementChild.remove();
      send('console', { level, message });
    }
  };
  worker.onerror = event => { send('console', { level: 'error', message: event.message || 'Python worker could not start.' }); send('finished', { failed: true }); status.textContent = 'Python could not start.'; };
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.workspaceToken === token && event.data.type === 'python-init') {
      const { assets, files, entry } = event.data;
      worker.postMessage({ assets, files, entry }, Object.values(assets));
    }
  }, { once: true });
  window.addEventListener('unload', () => worker.terminate());
  send('python-ready', {});
}
export function pythonPreview(token, entry) {
  return documentHTML(`<main><div style="font:11px ui-monospace,monospace;color:#aaa">${escapeHTML(entry.name)} · PYTHON 3</div><h2 id="status">Starting Python…</h2><pre id="output" style="background:transparent;padding:0;white-space:pre-wrap"></pre></main><script>(${pythonFrame.toString()})(${scriptJSON(token)},${scriptJSON(`(${pythonWorkerMain.toString()})();`)});</script>`, previewStyle + 'body{background:#181818;color:#eee}');
}
