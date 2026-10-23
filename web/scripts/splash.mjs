// The startup images an iPhone shows between tapping Curatorr's home screen icon and the app's first paint: the ink
// background with the logo in the middle, where the launch screen (Launch in src/App.tsx) draws it, so the hand-over
// doesn't move. Run by `npm run icons`; it writes public/splash/ and the links between the markers in index.html.
//
// iOS only shows an image of exactly the screen's size, chosen by its link's media query. The queries leave out
// device-height: iOS 27 measures it as Safari's window when the app is added (WebKit bug 326500), and then no image
// ever shows. Width and pixel ratio alone tell the iPhones iOS 26 and later run on apart.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// sharp comes with @vite-pwa/assets-generator, which makes the other icons.
const sharp = createRequire(import.meta.url)('sharp');

const INK = '#0c0f1e';
/** The logo's size in points, as Launch draws it. */
const LOGO = 96;
const OUT = 'public/splash';
const MARKERS = ['<!-- splash:start -->', '<!-- splash:end -->'];

/** Portrait screens in points, with their pixel ratio. */
const PHONES = [
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 428, height: 926, ratio: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { width: 420, height: 912, ratio: 3 }, // Air
  { width: 414, height: 896, ratio: 3 }, // 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // 11
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 390, height: 844, ratio: 3 }, // 12, 12 Pro, 13, 13 Pro, 14, 16e
  { width: 375, height: 812, ratio: 3 }, // 11 Pro, 12 mini, 13 mini
  { width: 375, height: 667, ratio: 2 }, // SE (2nd and 3rd generation)
];

const svg = readFileSync('public/logo.svg');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const links = [];
for (const { width, height, ratio } of PHONES) {
  const size = LOGO * ratio;
  const logo = await sharp(svg, { density: (72 * size) / 64 }).resize(size, size).png().toBuffer();
  const file = `iphone-${width}x${height}@${ratio}x.png`;
  await sharp({ create: { width: width * ratio, height: height * ratio, channels: 3, background: INK } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${file}`);
  const media = `(device-width: ${width}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`;
  links.push(`    <link rel="apple-touch-startup-image" media="${media}" href="/splash/${file}" />`);
}

const html = readFileSync('index.html', 'utf8');
const [start, end] = MARKERS.map((m) => html.indexOf(m));
if (start < 0 || end < start) throw new Error(`index.html needs ${MARKERS.join(' … ')}`);
writeFileSync(
  'index.html',
  `${html.slice(0, start + MARKERS[0].length)}\n${links.join('\n')}\n    ${html.slice(end)}`,
);
console.log(`Wrote ${PHONES.length} startup images to ${OUT} and their links to index.html`);
