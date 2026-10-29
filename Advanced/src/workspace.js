// Pure workspace operations shared by the UI, preview builder, and tests.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
export const MAX_FILES = 250;
export const EXTENSIONS = {
  html: ['HTML', 'html', 'Web page'], htm: ['HTML', 'html', 'Web page'],
  css: ['CSS', 'css', 'Stylesheet'], js: ['JavaScript', 'javascript', 'Browser JavaScript'],
  mjs: ['JavaScript', 'javascript', 'JavaScript module'], ts: ['TypeScript', 'typescript', 'Compiled in your browser'],
  jsx: ['JSX', 'jsx', 'Browser JavaScript with JSX'], tsx: ['TSX', 'tsx', 'TypeScript with JSX'],
  py: ['Python', 'python', 'Python 3 · standard library'], md: ['Markdown', 'markdown', 'Rendered document'],
  markdown: ['Markdown', 'markdown', 'Rendered document'], json: ['JSON', 'json', 'Validated data'],
  svg: ['SVG', 'xml', 'Vector image'], txt: ['Plain text', 'text', 'Text document'],
  xml: ['XML', 'xml', 'Text document'], yaml: ['YAML', 'text', 'Text document'], yml: ['YAML', 'text', 'Text document'],
  csv: ['CSV', 'text', 'Text document'], toml: ['TOML', 'text', 'Text document'],
};
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const extension = name => name.split('/').pop().split('.').pop().toLowerCase();
export const fileType = name => EXTENSIONS[extension(name)] || ['Plain text', 'text', 'Edit & download · no browser runtime'];
export const isScript = name => /\.(?:[cm]?js|ts|tsx|jsx)$/i.test(name);
export const isHTML = name => /\.html?$/i.test(name);
export const isImage = name => /\.(png|jpe?g|gif|webp|ico|avif)$/i.test(name);
export const byteSize = value => new TextEncoder().encode(value).length;
export const contentSize = file => file.binary ? file.content.length * 3 / 4 - (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0) : byteSize(file.content);
export function normalizePath(input) {
  const path = String(input).trim().replace(/\\/g, '/');
  if (!path || path === '__proto__' || path.length > 180 || path.startsWith('/') || /[\x00-\x1f<>:"|?*#%]/.test(path)) {
    throw new Error('Use a relative filename, up to 180 characters, without < > : " | ? * # or %.');
  }
  if (path.split('/').some(part => !part || part === '.' || part === '..' || part !== part.trim())) {
    throw new Error('Use a file or folder/file name without empty folders, . or .. segments.');
  }
  return path;
}
export function validateName(input, files, excludeId) {
  const name = normalizePath(input);
  if (files.some(file => file.id !== excludeId && file.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A file named “${name}” already exists.`);
  }
  return name;
}
export function makeFile(name, content = '', binary = false) {
  return { id: uid(), name: normalizePath(name), content, ...(binary ? { binary: true } : {}) };
}
export function nextName(name, files) {
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > name.lastIndexOf('/') + 1;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const ext = hasExtension ? name.slice(dot) : '';
  let n = 1;
  let result;
  do { result = `${stem}-copy${n === 1 ? '' : '-' + n}${ext}`; n++; }
  while (files.some(file => file.name.toLowerCase() === result.toLowerCase()));
  return result;
}
export function safeArchiveName(name) {
  return name.trim().replace(/[^a-z0-9._ -]/gi, '-').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 80) || 'my-project';
}
export function resolvePath(baseFile, relative) {
  const parts = relative.startsWith('/') ? [] : baseFile.split('/').slice(0, -1);
  for (const part of relative.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.join('/');
}
export function resolveFile(files, baseFile, specifier) {
  let path;
  try { path = decodeURIComponent(specifier.split(/[?#]/)[0]); } catch { return undefined; }
  const name = resolvePath(baseFile, path);
  const candidates = [name, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '/index.ts', '/index.js'].map(ext => name + ext)];
  return candidates.map(candidate => files.find(file => file.name === candidate)).find(Boolean);
}
export const templates = {
  html: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>My page</title>\n</head>\n<body>\n  <h1>Hello, world.</h1>\n</body>\n</html>\n',
  css: 'body {\n  font-family: system-ui, sans-serif;\n  padding: 2rem;\n  line-height: 1.6;\n}\n',
  js: 'console.log("Hello from JavaScript!");\n',
  ts: 'type Greeting = { message: string; year: number };\n\nconst greeting: Greeting = { message: "Hello from TypeScript!", year: new Date().getFullYear() };\nconsole.log(greeting);\n',
  py: 'from pathlib import Path\n\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("Python"))\nprint("Your project files:")\nfor file in sorted(Path(".").rglob("*")):\n    if file.is_file():\n        print(f"  {file}")\n',
  md: '# A little space for your ideas\n\nWrite, preview, and make something yours.\n\n- **Bold** ideas\n- Small experiments\n- A fresh start\n\n```js\nconsole.log("Hello, world.");\n```\n',
  json: '{\n  "name": "My project",\n  "ready": true,\n  "ideas": ["Build", "Experiment", "Learn"]\n}\n',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">\n  <rect width="400" height="300" rx="24" fill="#171717"/>\n  <circle cx="200" cy="130" r="55" fill="none" stroke="white" stroke-width="2"/>\n  <text x="200" y="235" text-anchor="middle" fill="white" font-family="sans-serif" font-size="18">A blank canvas.</text>\n</svg>\n',
  txt: '',
};
export function defaultWorkspace() {
  const html = makeFile('index.html', '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>A fresh start</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <main class="card">\n    <span class="eyebrow">A LITTLE ROOM TO EXPERIMENT</span>\n    <h1>Make something<br>good.</h1>\n    <p>An idea, a few lines of code, and a fresh start.<br>This space is yours.</p>\n    <button id="hello">Say hello <span aria-hidden="true">↗</span></button>\n    <div id="message" role="status"></div>\n    <footer>BUILT WITH CURIOSITY. PREVIEWED HERE.</footer>\n  </main>\n  <script type="module" src="script.js"></script>\n</body>\n</html>\n');
  const css = makeFile('styles.css', ':root { color-scheme: light; }\n* { box-sizing: border-box; }\nbody {\n  margin: 0; min-height: 100vh; display: grid; place-items: center;\n  background: #f5f4f0; color: #20201f;\n  font-family: system-ui, -apple-system, sans-serif;\n}\n.card { width: min(100%, 580px); padding: 56px 36px; }\n.eyebrow { font-size: 9px; letter-spacing: 2.4px; color: #777771; }\nh1 { font-size: clamp(42px, 7vw, 64px); font-weight: 500; line-height: 1.08; letter-spacing: -3px; margin: 28px 0 24px; }\np { color: #75756f; line-height: 1.9; font-size: 13px; }\nbutton { margin-top: 22px; border: 0; border-radius: 7px; background: #222220; color: #fff; padding: 13px 20px; cursor: pointer; font: inherit; font-size: 12px; }\nbutton span { margin-left: 28px; }\nbutton:hover { background: #40403b; }\n#message { font-size: 12px; min-height: 20px; padding-top: 16px; }\nfooter { margin-top: 72px; font-size: 8px; letter-spacing: 1.5px; color: #96968d; }\n');
  const js = makeFile('script.js', 'const button = document.querySelector("#hello");\nconst message = document.querySelector("#message");\n\nbutton.addEventListener("click", () => {\n  message.textContent = "Hello, maker. Nice to see you here.";\n  console.log("A little hello from your project.");\n});\n\nconsole.log("Your workspace is ready. Make it yours.");\n');
  const md = makeFile('README.md', '# A fresh start\n\nYour own little corner of the web.\n\n## Get comfortable\n\n- Edit any file, then hit **Run** (Ctrl / ⌘ + Enter).\n- Add files with the **+** button. Names can include folders.\n- Choose an entry file above the editor.\n- Select one, some, or all files to download.\n\n## Beyond the web\n\nAdd a `.ts` file to run TypeScript or a `.py` file to run Python. Markdown, JSON, SVG, images, and plain text also have previews. Other text files can be edited and downloaded; server-side languages need their own runtime.\n\nEverything stays in this browser. Sign-in does not enable cloud sync.\n');
  return { version: 3, name: 'Untitled project', files: [html, css, js, md], activeId: html.id, entryId: html.id };
}
export function validateWorkspace(value) {
  if (!value || value.version !== 3 || !Array.isArray(value.files) || !value.files.length || value.files.length > MAX_FILES) throw new Error('The saved workspace is invalid.');
  const seen = [], ids = new Set();
  let bytes = 0;
  for (const file of value.files) {
    if (!file || typeof file.id !== 'string' || !file.id || ids.has(file.id) || typeof file.name !== 'string' || typeof file.content !== 'string' || (file.binary !== undefined && typeof file.binary !== 'boolean')) throw new Error('The saved workspace contains invalid files.');
    validateName(file.name, seen);
    if (normalizePath(file.name) !== file.name || (file.binary && (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content) || file.content.length % 4))) throw new Error('The saved workspace contains an invalid path or image.');
    const size = contentSize(file);
    if (size > MAX_FILE_BYTES) throw new Error('A file exceeds the 2 MiB limit.');
    bytes += size;
    seen.push(file); ids.add(file.id);
  }
  if (bytes > MAX_PROJECT_BYTES) throw new Error('This project exceeds the 16 MiB limit.');
  const files = value.files.map(({ id, name, content, binary }) => ({ id, name, content, ...(binary ? { binary: true } : {}) }));
  return { version: 3, name: String(value.name || 'Untitled project').slice(0, 80), files, activeId: ids.has(value.activeId) ? value.activeId : files[0].id, entryId: ids.has(value.entryId) ? value.entryId : files[0].id };
}
export function relativePath(fromFile, toFile) {
  const from = fromFile.split('/').slice(0, -1), to = toFile.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return '../'.repeat(from.length) + to.join('/');
}
// Keep explicit local web references working after a rename or move.
// Python's dotted import names are deliberately not rewritten as file paths.
export function renameWorkspaceFile(workspace, id, input) {
  const name = validateName(input, workspace.files, id);
  const original = workspace.files;
  return original.map(file => {
    const newSource = file.id === id ? name : file.name;
    const rewrite = path => {
      if (!path || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(path)) return path;
      const target = resolveFile(original, file.name, path);
      if (!target || (target.id !== id && file.id !== id)) return path;
      const newTarget = target.id === id ? name : target.name;
      const suffix = path.match(/[?#].*$/)?.[0] || '';
      let result = path.startsWith('/') ? '/' + newTarget : relativePath(newSource, newTarget);
      if (path.startsWith('./') && !result.startsWith('.') && !result.startsWith('/')) result = './' + result;
      if (isScript(file.name) && !result.startsWith('.') && !result.startsWith('/')) result = './' + result;
      return result + suffix;
    };
    let content = file.content;
    if (!file.binary) {
      if (isHTML(file.name) || extension(file.name) === 'svg') content = content.replace(/(\b(?:src|href|poster)\s*=\s*)(["'])([^"']+)\2/gi, (_, prefix, quote, path) => prefix + quote + rewrite(path).replaceAll(quote, quote === "\"" ? "%22" : "%27") + quote);
      if (extension(file.name) === 'css' || isHTML(file.name)) {
        content = content.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi, (_, doubleQuoted, singleQuoted, bare) => {
          const result = rewrite(doubleQuoted ?? singleQuoted ?? bare).replace(/"/g, '%22');
          return `url("${result}")`;
        });
        content = content.replace(/(@import\s+)(["'])([^"']+)\2/gi, (_, prefix, quote, path) => prefix + quote + rewrite(path).replaceAll(quote, quote === "\"" ? "%22" : "%27") + quote);
      }
      if (isScript(file.name) || isHTML(file.name)) content = content.replace(/(\b(?:from|import)\s*|\b(?:import|fetch)\s*\(\s*)(["'])([^"']+)\2/g, (_, prefix, quote, path) => prefix + quote + rewrite(path).replaceAll(quote, quote === "\"" ? "%22" : "%27") + quote);
      if (['md', 'markdown'].includes(extension(file.name))) content = content.replace(/(\]\()([^\s)]+)(\))/g, (_, prefix, path, suffix) => prefix + rewrite(path) + suffix);
    }
    return { ...file, name: newSource, content };
  });
}
