const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'portal', 'galaxy.js'), 'utf8');

function field(width = 1440, height = 900, ratio = 1, options = {}) {
  let allocations = 0;
  const draws = [], images = [];
  const gradient = {addColorStop() {}};
  const brush = new Proxy({}, {get: (_, key) => key.startsWith('create') ? () => gradient : () => {}});
  const states = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const multiply = ([a, b, c, d, e, f]) => {
    const [u, v, w, x, y, z] = transform;
    transform = [u*a+w*b, v*a+x*b, u*c+w*d, v*c+x*d, u*e+w*f+y, v*e+x*f+z];
  };
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() {states.push([this.globalAlpha, this.globalCompositeOperation, [...transform]]);},
    restore() {[this.globalAlpha, this.globalCompositeOperation, transform] = states.pop();},
    translate(x, y) {multiply([1, 0, 0, 1, x, y]);},
    rotate(angle) {multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]);},
    scale(x, y) {multiply([x, 0, 0, y, 0, 0]);},
    drawImage(image, x, y, width, height) {
      assert.ok([x, y, width, height, this.globalAlpha, ...transform].every(Number.isFinite));
      assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
      const [a, b, c, d, e, f] = transform;
      const extentX = Math.hypot(a, b) * width, extentY = Math.hypot(c, d) * height;
      draws.push({image: image.id, x: a*x+c*y+e, y: b*x+d*y+f,
        centerX: a*(x+width/2)+c*(y+height/2)+e, centerY: b*(x+width/2)+d*(y+height/2)+f,
        width: extentX, height: extentY, alpha: this.globalAlpha});
    },
  };
  const sandbox = {window: {}, document: {createElement(tag) {
    assert.equal(tag, 'canvas');
    const image = {id: allocations++, getContext: () => brush};
    images.push(image);
    return image;
  }}};
  vm.runInNewContext(source, sandbox);
  const galaxy = sandbox.window.createGalaxyField(context, options);
  galaxy.resize(width, height, ratio);
  return {
    resize: galaxy.resize, warp: galaxy.warp, resetMotion: galaxy.resetMotion, isWarping: galaxy.isWarping, images,
    allocations: () => allocations,
    paint(options) {
      draws.length = 0;
      galaxy.paint(options);
      assert.equal(context.globalAlpha, 1, 'decorative alpha must not leak into foreground stars');
      assert.equal(context.globalCompositeOperation, 'source-over', 'foreground keeps ordinary compositing');
      assert.deepEqual(transform, [1, 0, 0, 1, 0, 0], 'warp transforms must not leak into the foreground');
      assert.equal(states.length, 0, 'canvas save/restore remains balanced');
      return draws.map(draw => ({...draw}));
    },
  };
}
const aspect = draw => Math.max(draw.width / draw.height, draw.height / draw.width);

{
  const h = field();
  assert.equal(h.allocations(), 6, 'each tint caches a plain and flare sprite');
  const initial = h.paint({animate: false});
  assert.ok(initial.length > 40 && initial.length <= 240, 'default desktop field is visibly populated at forty percent');
  assert.deepEqual(h.paint({animate: false, elapsed: 100000, pointer: {x: 700, y: 400}}), initial,
    'reduced motion freezes flight, shimmer and pointer displacement');
  for (let index = 0; index < 90; index++) h.paint({elapsed: 33, animate: true});
  assert.equal(h.allocations(), 6, 'animation reuses cached sprite canvases');
  h.resize(1200, 800, 1);
  assert.equal(h.allocations(), 6, 'ordinary resizes reuse sprites');
  h.resize(1200, 800, 2);
  assert.equal(h.allocations(), 12, 'DPR changes rebuild the six sprites once');
  h.resize(1200, 800, 4);
  assert.equal(h.allocations(), 12, 'DPR above two is capped');
  assert.ok(h.images.every(image => image.width <= 128 && image.height <= 128));
}
{
  const a = field(), b = field();
  assert.deepEqual(a.paint({animate: false}), b.paint({animate: false}), 'initial star layouts are seeded');
  const dense = field(1440, 900, 1, {density: 100}).paint({animate: false});
  const sparse = field(1440, 900, 1, {density: 10}).paint({animate: false});
  const normal = a.paint({animate: false});
  assert.ok(sparse.length < normal.length && normal.length < dense.length, 'configured density changes visible stars');
  assert.ok(normal.length < dense.length * .55, 'default density substantially reduces the previous full field');
  const phone = field(390, 844).paint({animate: false});
  assert.ok(phone.length > 10 && phone.length <= 60, 'default phone density stays bounded');
  assert.ok(field(8192, 8192, 1, {density: 100}).paint({animate: false}).length <= 600, 'large monitors stay capped');
  const long = field(), capped = field();
  assert.deepEqual(long.paint({elapsed: 100000}), capped.paint({elapsed: 64}),
    'long frame delays cannot jump flight or repulsion ahead');
}
{
  const moving = field(), control = field();
  let displaced, steady;
  for (let index = 0; index < 90; index++) {
    displaced = moving.paint({elapsed: 33, pointer: {x: 720, y: 400}});
    steady = control.paint({elapsed: 33});
  }
  assert.equal(displaced.length, steady.length, 'central repulsion does not change edge culling');
  let affected = 0;
  for (let index = 0; index < steady.length; index++) {
    const delta = Math.hypot(displaced[index].x - steady[index].x, displaced[index].y - steady[index].y);
    assert.ok(delta <= 16.00001, 'repulsion stays within sixteen CSS pixels');
    if (delta > .1) affected++;
  }
  assert.ok(affected > 0, 'the pointer actually displaces nearby stars');
  assert.deepEqual(moving.paint({animate: false, elapsed: 99999}), control.paint({animate: false}),
    'switching to reduced motion immediately clears prior pointer offsets');
  assert.deepEqual(moving.paint({animate: false}), control.paint({animate: false}),
    'subsequent static redraws remain stable');
}
{
  const warped = field(), ordinary = field();
  warped.warp(); assert.equal(warped.isWarping(), true);
  const flight = warped.paint({elapsed: 33}), idle = ordinary.paint({elapsed: 33});
  assert.ok(flight.some(draw => aspect(draw) > 2), 'click warp visibly stretches stars into trails');
  assert.notDeepEqual(flight.map(({centerX, centerY}) => ({centerX, centerY})), idle.map(({centerX, centerY}) => ({centerX, centerY})),
    'warp advances the starfield rather than merely changing its glow');
  assert.equal(warped.allocations(), 6, 'warp reuses the cached sprite canvases');
  const sustained = field(); sustained.warp();
  let cruising;
  for (let index = 0; index < 30; index++) cruising = sustained.paint({elapsed: 33});
  assert.ok(cruising.some(draw => aspect(draw) > 5), 'a jump retains clear radial trails after a full second of travel');
  let settled;
  for (let index = 0; index < 600; index++) settled = warped.paint({elapsed: 33});
  assert.ok(settled.every(draw => aspect(draw) < 1.01), 'a click settles back to ordinary round stars');
  assert.equal(warped.isWarping(), false, 'settled flight permits the ordinary idle frame budget');
  const twice = field(), repeated = field();
  twice.warp(); twice.warp();
  for (let index = 0; index < 20; index++) repeated.warp();
  assert.deepEqual(twice.paint({elapsed: 33}), repeated.paint({elapsed: 33}), 'repeated clicks keep a bounded boost');
  const long = field(), capped = field(); long.warp(); capped.warp();
  assert.deepEqual(long.paint({elapsed: 100000}), capped.paint({elapsed: 64}), 'warped frames also cap long time gaps');
  const paused = field();
  const initial = paused.paint({animate: false});
  paused.warp();
  assert.deepEqual(paused.paint({animate: false, elapsed: 33}), initial, 'reduced motion blocks flight and trails');
  paused.warp(); paused.paint({elapsed: 33}); paused.resetMotion();
  const reset = paused.paint({animate: false});
  assert.ok(reset.every(draw => aspect(draw) < 1.01), 'reset clears warp trails');
  assert.deepEqual(paused.paint({animate: false, elapsed: 10000}), reset, 'reset leaves a stable static frame');
  paused.warp(); paused.resize(1200, 800);
  assert.equal(paused.isWarping(), false, 'resizing never carries a stale flight burst into the new viewport');
}
{
  const intro = field();
  assert.deepEqual(intro.paint({elapsed: 16, arrival: 0}), [], 'arrival begins with only the CSS background and light wash');
  assert.deepEqual(intro.paint({elapsed: 16, arrival: .08}), [], 'the dark opening has no full-field star flash');
  const birth = intro.paint({elapsed: 16, arrival: .16}).filter(draw => draw.alpha > 0);
  assert.ok(birth.length > 0 && birth.some(draw => aspect(draw) > 1.5), 'stars emerge as the existing radial warp trails');
  const radius = draw => Math.hypot(draw.centerX - 720, draw.centerY - 414) / Math.hypot(1440, 900);
  assert.ok(birth.every(draw => radius(draw) < .2), 'the first visible stars are born near the focal center');
  const ambient = field().paint({animate: false});
  assert.ok(ambient.some(draw => radius(draw) > .3), 'the ordinary field extends beyond the initial central birth region');
  for (let index = 0; index < 180; index++) intro.paint({elapsed: 16, arrival: index / 179});
  assert.equal(intro.allocations(), 6, 'arrival reuses the same cached sprites as paid travel');
  const landed = intro.paint({elapsed: 0, arrival: 1});
  assert.ok(landed.length > 40 && landed.every(draw => aspect(draw) < 1.01), 'arrival lands in a populated calm starfield');
  assert.deepEqual(intro.paint({elapsed: 0}), landed, 'omitting arrival after landing preserves star positions, shapes and brightness');
  assert.equal(intro.isWarping(), false, 'decorative arrival leaves no manual paid-warp boost behind');
  const reduced = field(); const still = reduced.paint({animate: false});
  assert.deepEqual(reduced.paint({animate: false, elapsed: 100000, arrival: .5}), still,
    'reduced motion bypasses arrival and keeps the ordinary static field visible');
}
console.log('Galaxy: density settings, seeded stars, cached sprites, bounded pointer motion, click warp, decay, reset and reduced motion passed');
