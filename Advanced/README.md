# Advanced workspace

A static, local-first coding workspace for HTMLTools. The editor, icons, syntax support, compiler, and Python runtime are hosted in this directory; the workspace does not depend on an editor CDN or an AI service.

## Use it

- Create any UTF-8 text file; names can include folders (`src/helper.ts`). Import multiple text files, supported images, or a ZIP. Imports merge into the current project and ask before replacing matching filenames.
- Choose a **Run file** (entry) and press **Run** or **Ctrl / ⌘ + Enter**. Switching editor tabs does not change the entry. A newly created or imported file becomes the entry; the file-actions menu can run any specific file.
- Rename the project by clicking its name. Rename files from their actions menu or with **F2**. Explicit local HTML, CSS, JS/TS, and Markdown references are updated on file moves/renames; Python dotted imports and runtime-generated paths may need manual updates.
- **Download** opens a file picker. Export one original file, any subset, or the whole project. Multiple files are zipped with their relative paths preserved. A single file can also be zipped to keep its folder path. The download filename is editable.
- Autosave uses IndexedDB, not an account or a server. Preferences use localStorage. Save failures are visible; export a backup before leaving if saving is unavailable. **Ctrl / ⌘ + S** forces a local save, and **Ctrl / ⌘ + Shift + S** opens downloads.
- Restored code is **not** executed automatically. Only the newly created built-in starter is initially previewed. Auto-run is opt-in and never runs Python.
- The layout supports editor-only, split, and preview-only modes. At tablet and phone widths (980px and below), the file explorer becomes a drawer so the editor is not squeezed into three columns. Use **Files** / the folder button to open it, and the layout buttons to switch editor/preview. Split view remains available above 640px. Resizers support pointer capture and arrow keys. CodeMirror provides real scrollable syntax highlighting, undo per file, completion, find/replace, bracket matching, and folding. Press **Escape, then Tab** to leave the editor by keyboard.

## Appearance and branding

The header, sign-in dialog, and downloads handoff use the site's original `/logo3.png` HTMLTools logo. Do not replace it with the generic code icon used by editor actions. The UI keeps the black-and-white theme, a single project/run toolbar, and readable monochrome syntax. New preferences default to a 14px editor font; explicit saved preferences and existing projects are preserved. The simplified built-in starter only applies to new workspaces.

## What runs

| Files | Behavior |
| --- | --- |
| `.html`, `.htm` | Sandboxed browser page; local stylesheet, script, image, and page-link references resolve against project files. |
| `.css` | Linked stylesheets, CSS imports, and local `url()` assets work. A CSS entry uses a sample page. |
| `.js`, `.mjs`, `.ts`, `.jsx`, `.tsx` | Browser execution. esbuild bundles local modules/JSON/CSS and transpiles TypeScript/JSX. TypeScript compilation is **not type checking**. JSX needs its runtime imports; React is not preinstalled. |
| `.py` | Python 3.13 (Pyodide 0.29.3), standard library and local imports. Project files are placed under `/workspace`, which is the working directory. Each run starts fresh. |
| `.md`, `.markdown` | Markdown preview with sanitized HTML. |
| `.json` | JSON validation and formatted preview. |
| `.svg`, PNG, JPEG, GIF, WebP, ICO, AVIF | Image preview. SVG must be valid XML. |
| Other UTF-8 text | Edit, rename, text-preview, and download. **Not** native or server-side execution. |

There is no server runtime, npm installation, Node.js environment, native compiler, or third-party Python package installation. Python's `input()` is intentionally unsupported and reports a useful error; use a project text file instead. Browser-compatible packages may be imported using full HTTPS ESM URLs when their CORS policy allows it. Relative `fetch()` calls in browser code can read files from the project. Dynamically generated asset URLs and nested iframe projects are not a full virtual web server.

The preview has `sandbox="allow-scripts"` **without** `allow-same-origin`, navigation, or popup permissions. Console messages are checked against the active iframe and per-run token, rendered as text, and bounded to the latest 500 entries. Runs stop forwarding after 1,000 console messages. Python runs in a worker owned by that opaque-origin iframe, not in the authenticated editor origin. Runtime resources are fetched by the parent and transferred into the sandbox; no cross-origin isolation headers are required. Stop unloads the preview and terminates its Python worker. Blocking DOM JavaScript can still require a browser reload in engines that schedule sandboxed frames on the same thread.

Limits: **250 files, 2 MiB per file, 16 MiB per project**. ZIP paths, entry counts, and advertised uncompressed sizes are checked before decompression. Unsupported binaries and unsafe paths are rejected. Downloading a selection does not add unselected dependencies: include any referenced files yourself.

## Sign-in / Google setup

The workspace is usable without signing in. Email/password, registration, and **Continue with Google** use the same public Firebase web configuration and `authApp` name as the existing HTMLTools login (`htmltools-library`). No account data is written to the database, and signing in does **not** enable cloud project sync. Sign-out deliberately does not delete local project files.

Before deploying, the Firebase project owner must verify:

1. **Authentication → Sign-in method:** enable **Google** with a support email, and **Email/Password** if desired.
2. **Authentication → Settings → Authorized domains:** include each actual deployment hostname (`htmltools.me`, `www.htmltools.me` if used). Add `localhost` explicitly for local OAuth testing if it is not already listed. Preview hosts need their exact hostname; do not assume a wildcard is accepted.
3. Keep the configured Firebase auth domain (`htmltools-library.firebaseapp.com`) and the Firebase-managed OAuth handler/redirect URI in the Google provider setup. No client secret belongs in this repository.
4. Test successful login, popup cancellation/blocking, sign-out, and returning users on the deployed HTTPS origin. The popup flow is the default. An explicitly selected redirect fallback saves the workspace first; browsers with third-party-storage restrictions may require Firebase's same-site auth-helper configuration for redirect sign-in. On a static custom-domain host, allowing the Google popup is generally preferable to relying on cross-site redirect storage.

The UI reports disabled-provider and unauthorized-domain errors with configuration guidance instead of pretending sign-in succeeded. Automated tests cover the button/form behavior and error mapping; a real Google account authorization cannot be completed by the offline test suite.

## Develop and deploy

Node 22+ is recommended. From this directory:

```sh
npm ci
npm run build
npm run dev
# http://localhost:8000/Advanced/
```

`dev` serves the repository on `0.0.0.0:8000`, permits proxied preview hosts, and redirects the server root to `/Advanced/`. Override the port with `PORT=...`. Alternatively, serve the repository root using `python3 -m http.server 8000 --bind 0.0.0.0` and navigate to `/Advanced/`.

**Production is still a static site.** The compiled `assets/*.js`, compiler WASM, Python assets, and licenses are checked in so the existing GitHub Pages-style deployment does not need a Node build step. Run `npm run build` after changing `src/` and deploy the entire `Advanced/` directory, not just `index.html`. Serve `.wasm` as `application/wasm`. Compiler and Python resources are loaded only when needed; ordinary standalone JavaScript and CSS run natively without downloading the compiler.

The `/Advanced/Download/` URL is retained as an explanatory handoff to the new file-download picker (`/Advanced/?download=1`), not an obsolete base64 copy of the old editor/AI panel. The app itself is no longer a standalone HTML download; use the repository and local server instructions above.

```sh
npm test                         # workspace, path, rename, ZIP, storage, auth contracts
npm run test:browser              # actual built site, Chromium, no OAuth credentials
node --test ../tests/*.test.mjs   # existing repository regressions
npm audit --omit=dev
```

The browser suite starts and closes its own static server, exercises web/TypeScript/Python execution and downloads, verifies sandbox isolation and stopping infinite Python, and checks toolbar/logo geometry across 24 viewport widths from 320px to 1920px, plus phone/tablet file tools, downloads, settings, and sign-in dialogs. It uses an npm-distributed Chromium in minimal Linux environments; set `CHROMIUM_EXECUTABLE` to use an existing browser elsewhere. Screenshots in `.test-results/` and `node_modules/` are ignored. Third-party licenses are in `assets/THIRD_PARTY_NOTICES.txt` and `assets/python/*-LICENSE`.
