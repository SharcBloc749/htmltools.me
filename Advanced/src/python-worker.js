// This function is serialized into a worker owned by an opaque-origin sandbox.
// It must stay self-contained: user Python never runs in the editor's origin.
export function pythonWorkerMain() {
  self.onmessage = async event => {
    const { assets, files, entry } = event.data;
    let messages = 0;
    const send = (level, message) => {
      if (++messages <= 1000) self.postMessage({ level, message: String(message).slice(0, 16000) });
      else if (messages === 1001) self.postMessage({ level: 'warn', message: 'Console output paused after 1,000 messages. Rerun to reset.' });
    };
    const urls = [];
    const blobURL = (bytes, type) => {
      const url = URL.createObjectURL(new Blob([bytes], { type })); urls.push(url); return url;
    };
    try {
      const originalFetch = self.fetch.bind(self);
      self.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url || String(input);
        if (url === 'https://runtime.invalid/pyodide.asm.wasm') {
          return Promise.resolve(new Response(assets['pyodide.asm.wasm'], { headers: { 'Content-Type': 'application/wasm' } }));
        }
        if (url.startsWith('https://runtime.invalid/')) return Promise.reject(new Error('Only the Python standard library is included. Third-party packages are not installed.'));
        return originalFetch(input, init);
      };
      importScripts(blobURL(assets['pyodide.js'], 'text/javascript'));
      importScripts(blobURL(assets['pyodide.asm.js'], 'text/javascript'));
      const py = await self.loadPyodide({
        indexURL: 'https://runtime.invalid/', packageBaseUrl: 'https://runtime.invalid/',
        lockFileContents: JSON.parse(new TextDecoder().decode(assets['pyodide-lock.json'])),
        stdLibURL: blobURL(assets['python_stdlib.zip'], 'application/zip'),
        stdout: text => send('log', text), stderr: text => send('error', text),
        stdin: () => { throw new Error('Interactive input() is not supported. Use a project text file instead.'); },
      });
      py.FS.mkdirTree('/workspace');
      for (const file of files) {
        const path = '/workspace/' + file.name;
        py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        const bytes = file.binary ? Uint8Array.from(atob(file.content), char => char.charCodeAt(0)) : new TextEncoder().encode(file.content);
        py.FS.writeFile(path, bytes);
      }
      py.FS.chdir('/workspace');
      py.globals.set('__entry_path', '/workspace/' + entry);
      await py.runPythonAsync('import sys, os, runpy, builtins\ndef __workspace_no_input(*args, **kwargs):\n    raise RuntimeError("Interactive input() is not supported. Use a project text file instead.")\nbuiltins.input = __workspace_no_input\nsys.path.insert(0, "/workspace")\nsys.path.insert(0, os.path.dirname(__entry_path))\nrunpy.run_path(__entry_path, run_name="__main__")');
      self.postMessage({ level: 'done', message: 'Python finished.' });
    } catch (error) {
      send('error', error.message || error); self.postMessage({ level: 'failed', message: 'Python stopped with an error.' });
    } finally { urls.forEach(url => URL.revokeObjectURL(url)); self.close(); }
  };
}
