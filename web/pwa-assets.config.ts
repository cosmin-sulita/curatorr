import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerate the committed icons with `npm run icons` after changing public/logo.svg.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.25, resizeOptions: { background: '#0c0f1e' } },
    apple: { ...minimal2023Preset.apple, padding: 0.2, resizeOptions: { background: '#0c0f1e' } },
  },
  images: ['public/logo.svg'],
});
