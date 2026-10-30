// Bundles the server (and the shared workspace) into dist/index.js.
// Runtime dependencies stay external and are installed with `npm ci --omit=dev`.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// A release is a new section at the top of CHANGELOG.md, so its first heading is the version being built (read as
// isVersion in shared/src/changelog.ts does, and as CI checks it). Without one, the build stops: the package.json files'
// 0.0.0 is only there for npm, and a wrong version would tell admins an update is waiting.
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const version = /^## (\d+\.\d+\.\d+)/m.exec(changelog)?.[1];
if (!version) throw new Error("CHANGELOG.md's first '## ' heading must be the version, as '## x.y.z (date)'");

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
