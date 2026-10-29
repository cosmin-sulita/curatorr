import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // web's tests cover lib/'s pure modules, which load without a browser.
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
  },
});
