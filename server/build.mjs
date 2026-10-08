// Bundles the server (and the shared workspace) into dist/index.js.
// Runtime dependencies stay external and are installed with `npm ci --omit=dev`.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const rootPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = process.env.CURATORR_VERSION || rootPkg.version;

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
  define: { 'process.env.CURATORR_VERSION': JSON.stringify(version) },
  logLevel: 'info',
});
