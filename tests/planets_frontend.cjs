const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const portal = path.join(__dirname, '..', 'web', 'portal');
const source = fs.readFileSync(path.join(portal, 'planets.js'), 'utf8');
const names = ['core', 'git', 'doc', 'week', 'flow', 'gpu', 'bi', 'seek'];
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(initialNames=names) {
  const requests = [], cachedSurfaces = [];
  const makeCanvas = name => {
    const calls = [];
    const sources = [];
    const context = {
      createRadialGradient() { return {addColorStop() {}}; },
      beginPath() {}, arc() {},
      fill() { calls.push('fallback'); },
      clearRect() { calls.push('clear'); },
      drawImage(source) {
        assert.notEqual(source.closed, true, 'drawing never uses a released ImageBitmap');
        calls.push('image');sources.push(source);
      },
    };
    return {dataset: {surface: name}, isConnected: true, calls, sources, getContext: () => context};
  };
  let closes = 0;
  const sandbox = {
    window: {portalPlanetStyles:JSON.parse(fs.readFileSync(path.join(portal,'textures/planet-library.json'),'utf8'))}, AbortController,
    document: {createElement(tag) {assert.equal(tag,'canvas');const canvas=makeCanvas();cachedSurfaces.push(canvas);return canvas;}},
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({url, options, resolve, reject})),
    createImageBitmap: async () => ({closed:false,close() { this.closed=true;closes++; }}),
  };
  vm.runInNewContext(source, sandbox);
  const mount = (surfaceNames=names) => {
    const canvases=surfaceNames.map(makeCanvas);
    const stop = sandbox.window.mountPlanetSurfaces({querySelectorAll: () => canvases});
    return {canvases,stop};
  };
  return {requests, ...mount(initialNames), mount, cachedSurfaces, closes: () => closes};
}

function finishLoads(harness) {
  harness.requests.forEach(request => request.resolve({ok: true, blob: async () => ({})}));
  return tick();
}

(async () => {
  const scripts = [...fs.readFileSync(path.join(portal, 'index.html'), 'utf8').matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.some(script => /\/planets\.js\?/.test(script)), 'the portal loads the lightweight surface loader');
  assert.ok(!scripts.some(script => /planets-legacy|planet-surface-renderer/.test(script)),
    'expensive procedural and photographic renderers stay outside page startup');
  let payload = 0;
  for (const name of names) {
    const png = fs.readFileSync(path.join(portal, 'textures', 'surfaces', `${name}.png`));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} is a PNG`);
    assert.equal(png.readUInt32BE(16), 256, `${name} retains the original raster width`);
    assert.equal(png.readUInt32BE(20), 256, `${name} retains the original raster height`);
    payload += png.length;
  }
  assert.ok(payload < 1024 * 1024, 'the complete planet payload stays below 1 MiB instead of loading 5 MB of source maps');

  let h = setup();
  assert.equal(h.requests.length, 8);
  assert.ok(h.requests.every(request => /^\/assets\/textures\/surfaces\/\w+\.png$/.test(request.url)),
    'startup requests pre-rendered surfaces only, never the 2k source maps');
  assert.ok(h.canvases.every(canvas => canvas.calls.join() === 'fallback' && canvas.width === 256 && canvas.height === 256),
    'a cheap fallback is available before any request resolves');
  await finishLoads(h);
  assert.ok(h.canvases.every(canvas => canvas.dataset.material === 'photo-v3-soft' && canvas.calls.join() === 'fallback,clear,image'));
  assert.equal(h.closes(), 8, 'successful decoding releases every bitmap');
  assert.equal(h.cachedSurfaces.length, 8, 'each allowed material retains one independent pixel cache');
  h.stop();
  const remounted=h.mount([...names,'seek']);
  assert.equal(h.requests.length, 8, 'galaxy remounts reuse loaded surfaces without requesting them again');
  assert.ok(remounted.canvases.every(canvas=>canvas.dataset.material==='photo-v3-soft'&&canvas.calls.join()==='clear,image'),
    'replacement canvases contain the real surface synchronously for the galaxy travel snapshot');
  assert.ok(remounted.canvases.every(canvas=>h.cachedSurfaces.includes(canvas.sources[0])),
    'the persistent source is a copied canvas, never a closed bitmap or an old mounted canvas');
  assert.equal(h.cachedSurfaces.length, 8, 'duplicate and repeated mounts stay within the eight-surface cache');
  remounted.stop();

  h=setup([...names,'seek']);
  await finishLoads(h);
  assert.equal(h.cachedSurfaces.length,8,'concurrent duplicate loads reuse one retained surface');
  assert.equal(h.closes(),9,'duplicate decodes are also closed after their pixels have been reused');

  h = setup();
  h.requests.forEach(request => request.resolve({ok: false}));
  await tick();
  assert.ok(h.canvases.every(canvas => canvas.dataset.material === 'shaded-fallback' && canvas.calls.join() === 'fallback'),
    'unavailable assets retain the usable placeholder');
  h = setup();
  h.requests.forEach(request => request.reject(Error('offline')));
  await tick();
  assert.ok(h.canvases.every(canvas => canvas.calls.join() === 'fallback'), 'network failures are handled without clearing the surface');

  h = setup();
  h.stop();
  assert.ok(h.requests.every(request => request.options.signal.aborted), 'unmount aborts all outstanding fetches');
  await finishLoads(h);
  assert.equal(h.closes(), 8, 'a late decode still releases its bitmap after unmount');
  assert.ok(h.canvases.every(canvas => canvas.calls.join() === 'fallback'), 'late results never paint after unmount');
  assert.equal(h.cachedSurfaces.length, 0, 'aborted loads do not retain decoded pixels');
  const afterAbort=h.mount();
  assert.equal(h.requests.length,16,'a later mount can retry aborted loads');
  await finishLoads(h);
  assert.ok(afterAbort.canvases.every(canvas=>canvas.dataset.material==='photo-v3-soft'),'a later mount recovers normally after cancellation');

  h = setup();
  h.canvases.forEach(canvas => { canvas.isConnected = false; });
  await finishLoads(h);
  assert.equal(h.closes(), 8);
  assert.ok(h.canvases.every(canvas => canvas.calls.join() === 'fallback'), 'detached canvases are not painted');
  assert.equal(h.cachedSurfaces.length, 0, 'detached mounts do not retain decoded pixels');
  h=setup(JSON.parse(fs.readFileSync(path.join(portal,'textures/planet-library.json'),'utf8')).map(style=>style.id));
  await finishLoads(h);
  assert.equal(h.cachedSurfaces.length,30,'all thirty manifest styles can be loaded and cached');
  assert.ok(h.canvases.every(canvas=>canvas.dataset.material==='photo-v3-soft'),'no new style is left on a fallback');
  console.log('Planets: bounded PNG payload, no startup renderers, immediate fallback, load/failure/abort lifecycle and bitmap cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
