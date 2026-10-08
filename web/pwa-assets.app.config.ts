import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Home screen icons. iOS and Android mask these to their own shape, so the source is the full-bleed
// app-icon.svg with no padding. The ticket sits inside the maskable safe zone as drawn.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { sizes: [] },
    maskable: { ...minimal2023Preset.maskable, padding: 0 },
    apple: { ...minimal2023Preset.apple, padding: 0 },
  },
  images: ['public/app-icon.svg'],
});
