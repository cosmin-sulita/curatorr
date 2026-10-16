import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const LICENSES = 'licenses.md';

/**
 * build.license only covers what the JavaScript imports. The Archivo font comes in through CSS, and the
 * service worker bundles Workbox, so their notices go in the same file.
 */
function moreLicenses(): Plugin {
  const require = createRequire(import.meta.url);
  const entry = (title: string, pkg: string) => {
    const { version, license } = require(`${pkg}/package.json`) as { version: string; license: string };
    const text = readFileSync(require.resolve(`${pkg}/LICENSE`), 'utf8').trim();
    return `## ${title} - ${version} (${license})\n\n${text}\n`;
  };
  return {
    name: 'curatorr:more-licenses',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const file = bundle[LICENSES];
        if (file?.type !== 'asset') return this.error(`${LICENSES} wasn't generated`);
        file.source = [
          String(file.source).trimEnd(),
          entry('@fontsource-variable/archivo', '@fontsource-variable/archivo'),
          // Every workbox-* module carries this same notice.
          entry('workbox-core and the other Workbox modules in the service worker', 'workbox-core'),
        ].join('\n\n');
      },
    },
  };
}

/**
 * Brotli and gzip copies of the text files, beside them in dist, for the server to send to browsers that accept them.
 * Browsers only offer brotli over HTTPS, so gzip covers the plain-HTTP address on the home network.
 */
function precompress(): Plugin {
  return {
    name: 'curatorr:precompress',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        for (const file of Object.values(bundle)) {
          if (!/\.(js|css|html|svg|md)$/.test(file.fileName)) continue;
          const source = Buffer.from(file.type === 'chunk' ? file.code : file.source);
          // Too small to gain from it.
          if (source.length < 1024) continue;
          const br = brotliCompressSync(source, { params: { [zlib.BROTLI_PARAM_QUALITY]: zlib.BROTLI_MAX_QUALITY } });
          this.emitFile({ type: 'asset', fileName: `${file.fileName}.br`, source: br });
          this.emitFile({ type: 'asset', fileName: `${file.fileName}.gz`, source: gzipSync(source, { level: 9 }) });
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    moreLicenses(),
    precompress(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Curatorr',
        short_name: 'Curatorr',
        description: "Pick tonight's movie from your own library.",
        theme_color: '#0c0f1e',
        background_color: '#0c0f1e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['entertainment'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: { maxEntries: 600, maxAgeSeconds: THIRTY_DAYS },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/plex\.tv\/users\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'avatars', cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/image/') || url.pathname.startsWith('/api/demo/art/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'library-images',
              expiration: { maxEntries: 600, maxAgeSeconds: THIRTY_DAYS },
            },
          },
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:7979' },
  },
  build: {
    target: 'es2022',
    // The minified bundle drops the libraries' licence comments, so their notices ship in a file of their own.
    license: { fileName: LICENSES },
  },
});
