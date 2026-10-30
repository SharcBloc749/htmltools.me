// Builds the single-file Worker bundle that can be pasted into the Cloudflare
// dashboard editor. The modular source in src/ stays the source of truth.
//
//   npm run bundle      ->  worker.js
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const result = await build({
  entryPoints: [join(root, 'src/index.mjs')],
  outfile: join(root, 'worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  minify: false,
  legalComments: 'none',
  banner: {
    js: [
      '// htmltools.me AI API gateway — generated file, do not edit.',
      '// Source: AI-API/worker/src/*.mjs  ·  rebuild with: npm run bundle',
      '// Deploy with `npx wrangler deploy` (preferred) or paste into the',
      '// Cloudflare dashboard editor together with the bindings listed in',
      '// AI-API/worker/README.md.',
    ].join('\n'),
  },
  metafile: true,
});

const inputs = Object.keys(result.metafile.inputs).length;
console.log(`worker.js written from ${inputs} source files`);
