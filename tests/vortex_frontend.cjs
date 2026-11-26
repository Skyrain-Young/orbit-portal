const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'portal', 'galaxy-vortex.js'), 'utf8');

async function completes(promise) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Renderer left navigation waiting after completion or cancellation')), 250);
    })]);
  } finally { clearTimeout(timer); }
}

function setup({webgl = true, canvas2d = true, compilation = true, width = 1440, height = 900, ratio = 2} = {}) {
  const frames = new Map(), draws = [], captures = [], surfaces = [], strokes = [];
  const allocated = new Set(), released = new Set(), values = {};
  let nextFrame = 0, now = 0, lost = false, observer, disconnects = 0, losses = 0, saved = 0;
  const resource = kind => { const value = {kind}; allocated.add(value); return value; };
  const release = value => { if (value) released.add(value); };
  const gl = {
    createShader: () => resource('shader'), createProgram: () => resource('program'),
    createBuffer: () => resource('buffer'), createTexture: () => resource('texture'),
    deleteShader: release, deleteProgram: release, deleteBuffer: release, deleteTexture: release,
    shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, useProgram() {},
    getShaderParameter: () => compilation, getProgramParameter: () => true,
    bindBuffer() {}, bufferData() {}, getAttribLocation: () => 0,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, bindTexture() {}, texParameteri() {}, pixelStorei() {},
    getUniformLocation: (_, name) => name,
    uniform1i(name, value) { values[name] = value; },
    uniform1f(name, value) { assert.ok(Number.isFinite(value)); values[name] = value; },
    uniform2f(name, x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); values[name] = [x, y]; },
    texImage2D(...args) { const image = args.at(-1); captures.push({width: image.width, height: image.height}); },
    viewport() {}, drawArrays() { draws.push({...values}); },
    isContextLost: () => lost,
    getExtension: () => ({loseContext() { lost = true; losses++; }}),
  };
  const brush = {
    setTransform() {}, transform() {},
    save() { saved++; }, restore() { saved--; },
    createLinearGradient: () => ({addColorStop() {}}),
    stroke(outline) { strokes.push(outline); },
    drawImage(...args) { surfaces.push(args); },
    setLineDash() {}, beginPath() {}, arc() {}, fill() {}, fillText() {},
  };
  const canvases = [];
  const scene = {
    dataset: {}, clientWidth: width, clientHeight: height, children: [],
    getBoundingClientRect() { return {width: this.clientWidth, height: this.clientHeight, left: 20, top: 30}; },
    append(canvas) { this.children.push(canvas); },
    querySelector: selector => selector === '.orbit-blackhole' ? {clientHeight: 240} : null,
    querySelectorAll: selector => selector === '.orbit-track' ? [
      {style: {}, classList: {contains: () => false}, getCTM: () => ({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}),
        getAttribute: () => 'M100,200 L300,400'},
      {style: {visibility: 'hidden'}, getCTM: () => ({})},
    ] : selector === '.orbit-satellite' ? [
      {hidden: false, querySelector: () => ({
        getBoundingClientRect: () => ({left: 120, top: 230, width: 40, height: 40}),
        querySelector: () => planet,
      })},
      {hidden: true, querySelector() { throw Error('Hidden planets must not be captured'); }},
    ] : [],
  };
  const planet = {name: 'actual loaded surface'};
  const sandbox = {
    window: {}, devicePixelRatio: ratio, performance: {now: () => now},
    getComputedStyle: () => ({opacity: '.2', strokeWidth: '.8', stroke: '#b3dbec'}),
    Path2D: class { constructor(outline) { this.outline = outline; } },
    ResizeObserver: class {
      constructor(callback) { observer = callback; }
      observe(value) { assert.equal(value, scene); }
      disconnect() { disconnects++; }
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    document: {createElement(tag) {
      assert.equal(tag, 'canvas');
      const listeners = new Map();
      const canvas = {
        dataset: {}, width: 300, height: 150, listeners,
        setAttribute() {},
        getContext: type => type === 'webgl' ? (webgl ? gl : null) : (canvas2d ? brush : null),
        addEventListener(type, listener) { listeners.set(type, listener); },
        remove() { scene.children = scene.children.filter(item => item !== canvas); },
      };
      canvases.push(canvas); return canvas;
    }},
  };
  vm.runInNewContext(source, sandbox);
  const renderer = sandbox.window.createGalaxyVortex({scene, center: {cx: 936, cy: 432, rx: 390, ry: 220}});
  return {
    renderer, scene, frames, draws, captures, surfaces, strokes, allocated, released, canvases, planet,
    disconnects: () => disconnects, losses: () => losses, saved: () => saved,
    tick(time) {
      now = time;
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(callback => callback(now));
    },
    resize(w, h) { scene.clientWidth = w; scene.clientHeight = h; observer(); },
    lose() { lost = true; canvases[0].listeners.get('webglcontextlost')(); },
    restore() { lost = false; },
  };
}

(async () => {
  for (const options of [{webgl: false}, {compilation: false}, {canvas2d: false}]) {
    const h = setup(options);
    assert.equal(h.renderer, null, 'unavailable graphics returns a usable navigation fallback');
    assert.equal(h.scene.children.length, 0, 'failed setup leaves no overlay behind');
    assert.equal(h.released.size, h.allocated.size, 'failed setup releases every allocated graphics resource');
  }

  {
    const h = setup();
    let exited = false;
    const exit = h.renderer.play().then(() => { exited = true; });
    assert.equal(h.scene.dataset.vortex, 'true');
    assert.equal(h.draws.at(-1).progress, 0, 'departure starts at the unwarped source image');
    assert.deepEqual(h.draws.at(-1).center, [936, 432]);
    assert.equal(h.surfaces.length, 1, 'only visible real planet canvases are captured');
    assert.deepEqual(h.surfaces[0], [h.planet, 100, 200, 40, 40], 'snapshot preserves scene-relative planet position and size');
    assert.equal(h.strokes.length, 1, 'hidden seat segments are excluded from the snapshot');
    assert.equal(h.saved(), 0, 'drawing state is balanced');
    assert.ok(h.captures[0].width <= 1920 && h.captures[0].height <= 1440, 'retina snapshots have a bounded pixel budget');
    h.tick(374); await Promise.resolve();
    assert.equal(exited, false, 'departure does not finish before its 375 ms budget');
    h.tick(375); await completes(exit);
    assert.equal(h.draws.at(-1).progress, 1);
    assert.equal(h.frames.size, 0);
    let entered = false;
    const entry = h.renderer.play(true).then(() => { entered = true; });
    assert.equal(h.draws.at(-1).progress, 1, 'arrival starts inside the horizon');
    assert.equal(h.captures.length, 2, 'arrival captures the replacement galaxy');
    h.tick(749); await Promise.resolve(); assert.equal(entered, false);
    h.tick(750); await completes(entry);
    assert.equal(h.draws.at(-1).progress, 0, 'arrival lands exactly on the ordinary orbital image');
    assert.equal(h.frames.size, 0, 'the full journey schedules no frames beyond .75 seconds');
    h.renderer.stop();
    assert.equal(h.scene.dataset.vortex, undefined);
    assert.equal(h.scene.children.length, 0);
    assert.equal(h.disconnects(), 1);
    assert.equal(h.released.size, h.allocated.size);
    assert.equal(h.losses(), 1, 'the temporary WebGL context is released');
    assert.equal(h.canvases[1].width, 1, 'the temporary source image releases its backing store');
  }

  {
    const h = setup();
    const pending = h.renderer.play();
    h.tick(250); h.renderer.finish(); await completes(pending);
    assert.equal(h.frames.size, 0, 'manual finish resolves waiting navigation and cancels the clock');
    const entry = h.renderer.play(true);
    assert.equal(h.frames.size, 1, 'ordinary finish still permits the destination phase');
    h.renderer.finish(); await completes(entry); h.renderer.stop();
  }

  for (const interruption of ['context loss', 'resize', 'dispose']) {
    const h = setup();
    const pending = h.renderer.play();
    h.tick(100);
    if (interruption === 'context loss') { h.lose(); h.restore(); }
    else if (interruption === 'resize') h.resize(900, 720);
    else h.renderer.stop();
    await completes(pending);
    assert.equal(h.frames.size, 0, `${interruption} releases an awaited journey`);
    const count = h.captures.length;
    await completes(h.renderer.play(true));
    assert.equal(h.captures.length, count, `${interruption} never starts an arrival using stale geometry or a dead context`);
    assert.equal(h.frames.size, 0);
    if (interruption !== 'dispose') h.renderer.stop();
    assert.equal(h.scene.dataset.vortex, undefined);
    assert.equal(h.scene.children.length, 0);
    assert.equal(h.released.size, h.allocated.size);
  }

  {
    const h = setup();
    const pending = h.renderer.play();
    h.resize(1440, 900);
    assert.equal(h.frames.size, 1, 'the initial ResizeObserver notification does not interrupt an unchanged scene');
    h.renderer.finish(); await completes(pending); h.renderer.stop();
  }
  console.log('Vortex: bounded real-scene capture, 375 + 375 ms timing, fallback, finish, context loss, resize and disposal passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
