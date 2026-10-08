import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Both src/ (dev) and dist/ (prod) sit one level below server/, so these
// relative paths resolve the same way in either mode.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const truthy = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

export const config = {
  version: process.env.CURATORR_VERSION ?? 'dev',
  port: Number(process.env.PORT ?? 7979),
  host: process.env.HOST ?? '0.0.0.0',
  configDir: path.resolve(process.env.CONFIG_DIR ?? path.join(repoRoot, 'config')),
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(repoRoot, 'web/dist')),
  demo: truthy(process.env.CURATORR_DEMO) || process.argv.includes('--demo'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
