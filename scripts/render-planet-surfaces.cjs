// One-time asset generation; no browser package or pixel renderer is used at runtime.
// Run with Playwright installed: node scripts/render-planet-surfaces.cjs
// --check compares checked-in PNG pixels to the current renderer without writing files.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const surfaces = ['core', 'git', 'doc', 'week', 'flow', 'gpu', 'bi', 'seek'];
const destination = path.join(root, 'web/portal/textures/surfaces');
const check = process.argv.includes('--check');

(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<html><body>${surfaces.map(name => `<canvas class="planet-surface" data-surface="${name}" width="256" height="256"></canvas>`).join('')}<script src="/renderer.js"></script><script>renderPlanetSurfaces(document.body)</script></body></html>`);
        return;
      }
      const match = url.pathname.match(/^\/assets\/textures\/(2k_[a-z_]+\.jpg|surfaces\/(?:core|git|doc|week|flow|gpu|bi|seek)\.png)$/);
      if (url.pathname !== '/renderer.js' && !match) {
        response.writeHead(404); response.end(); return;
      }
      const file = url.pathname === '/renderer.js' ? path.join(__dirname, 'planet-surface-renderer.js') : path.join(root, 'web/portal/textures', match[1]);
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'image/jpeg');
      response.end(await fs.readFile(file));
    } catch (error) {
      response.writeHead(500); response.end(String(error));
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({headless: true, channel: 'chrome'});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.material === 'photo-v3-soft'));
    const images = await page.evaluate(() => [...document.querySelectorAll('canvas')].map(canvas => ({name: canvas.dataset.surface, png: canvas.toDataURL('image/png').split(',')[1]})));
    if (!check) {
      await fs.mkdir(destination, {recursive: true});
      for (const {name, png} of images) await fs.writeFile(path.join(destination, `${name}.png`), Buffer.from(png, 'base64'));
    }
    // Compare the raster drawn by the live loader to the former canvas surface,
    // including transparent edge pixels. This catches accidental visual changes.
    const comparison = await page.evaluate(async () => {
      const results = [];
      for (const original of document.querySelectorAll('canvas.planet-surface')) {
        const image = await createImageBitmap(await (await fetch(`/assets/textures/surfaces/${original.dataset.surface}.png`)).blob());
        const restored = document.createElement('canvas'); restored.width = restored.height = 256;
        const context = restored.getContext('2d'); context.drawImage(image, 0, 0); image.close();
        const expected = original.getContext('2d').getImageData(0, 0, 256, 256).data;
        const actual = context.getImageData(0, 0, 256, 256).data;
        let different = 0, largest = 0;
        for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) { different++; largest = Math.max(largest, Math.abs(actual[i] - expected[i])); }
        results.push({name: original.dataset.surface, differentChannels: different, largestDifference: largest});
      }
      return results;
    });
    if (comparison.some(result => result.differentChannels)) throw Error(`Surface pixels differ: ${JSON.stringify(comparison)}`);
    const bytes = images.reduce((sum, image) => sum + Buffer.from(image.png, 'base64').length, 0);
    console.log(`${check ? 'Verified' : 'Generated and verified'} ${images.length} surfaces (${bytes} bytes); all 256 × 256 RGBA pixels match the original renderer.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
