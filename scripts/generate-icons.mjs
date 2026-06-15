// Generate PWA PNG icons from public/favicon.svg using the already-installed Playwright.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const pub = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
const svg = readFileSync(pub('favicon.svg'), 'utf8');
const BG = '#1c1c2b'; // app theme color

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(size, innerFrac, file, bg = BG) {
  const inner = Math.round(size * innerFrac);
  const html = `<!doctype html><html><body style="margin:0;padding:0">
    <div id="c" style="width:${size}px;height:${size}px;background:${bg};display:flex;align-items:center;justify-content:center;overflow:hidden">
      <div style="width:${inner}px;height:${inner}px;display:flex;align-items:center;justify-content:center">${svg}</div>
    </div></body></html>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html);
  await page.$eval('svg', (el, s) => { el.setAttribute('width', s); el.setAttribute('height', s); }, inner);
  await (await page.$('#c')).screenshot({ path: pub(file) });
  console.log('wrote', file, `${size}x${size}`);
}

await render(192, 0.62, 'icon-192.png');               // standard
await render(512, 0.62, 'icon-512.png');               // standard
await render(512, 0.50, 'icon-512-maskable.png');      // extra padding for maskable safe zone
await render(180, 0.66, 'apple-touch-icon.png');       // iOS home screen
await browser.close();
console.log('done');
