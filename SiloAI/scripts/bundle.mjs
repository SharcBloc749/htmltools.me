import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.mjs'],
  outfile: 'worker.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: '/* Generated from src/index.mjs. Run npm run bundle; do not hand-edit. */' },
});
console.log('Bundled src/index.mjs -> worker.js');
