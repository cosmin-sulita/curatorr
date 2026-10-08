import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerate the committed icons with `npm run icons` after changing public/logo.svg or public/app-icon.svg.
// The rounded logo.svg gives the favicon and the plain manifest icons; the home screen icons come from
// pwa-assets.app.config.ts.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { sizes: [] },
    apple: { sizes: [] },
  },
  images: ['public/logo.svg'],
});
