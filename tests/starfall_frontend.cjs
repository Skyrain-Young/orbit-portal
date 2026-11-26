const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'web', 'portal', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve};};
function starsHarness({hidden = false, focused = true, reduced = false, dialog = false, quiet, onWarp = async () => true, arrival = false, hasContext = true, dpr = 1} = {}) {
  const timers = new Map(), frames = new Map(), listeners = {};
  let id = 0, now = 0, score = 0, warps = 0, resets = 0, paints = 0, resizeObserver;
  const arrivalTrace = {paints: [], dots: 0, preparation: 0, reveal: 0, complete: 0, callbacks: []};
  const document = {hidden, hasFocus: () => focused, querySelector: () => dialog ? {} : null,
    createElement: () => ({getContext: () => context})};
  const listen = (name, callback) => (listeners[name] ??= []).push(callback);
  document.addEventListener = listen;
  const gradient = {addColorStop() {}};
  const context = new Proxy({}, {get: (_, key) => key === 'clearRect' ? () => paints++ : key.startsWith('create') ? () => gradient : key === 'arc' ? () => {arrivalTrace.dots++;} : () => {}});
  const reduceChanges = [];
  const reduce = {matches: reduced, addEventListener: (_, fn) => reduceChanges.push(fn)};
  const sandbox = {document, AbortController, performance: {now: () => now},
    Math: Object.assign(Object.create(Math), {random: () => .9}),
    matchMedia: query => query.includes('reduced') ? reduce : {matches: false, addEventListener() {}},
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: dpr,
    requestAnimationFrame: fn => {frames.set(++id, fn); return id;},
    cancelAnimationFrame: key => frames.delete(key), clearTimeout: key => timers.delete(key),
    ResizeObserver: class {constructor(callback) {resizeObserver = callback;} observe() {} disconnect() {}}};
  sandbox.window = {addEventListener: listen, setTimeout: (fn, delay) => {timers.set(++id, {fn, delay}); return id;}};
  vm.runInNewContext(source('galaxy.js'), sandbox);
  const createGalaxy = sandbox.window.createGalaxyField;
  sandbox.window.createGalaxyField = (...args) => {
    const galaxy = createGalaxy(...args), warp = galaxy.warp, reset = galaxy.resetMotion, paint = galaxy.paint;
    galaxy.paint = options => {arrivalTrace.paints.push({...options}); return paint(options);};
    galaxy.warp = () => {warps++; return warp();};
    galaxy.resetMotion = () => {resets++; return reset();};
    return galaxy;
  };
  vm.runInNewContext(source('meteors.js'), sandbox);
  vm.runInNewContext(source('stars.js'), sandbox);
  const canvas = {getContext: () => hasContext ? context : null, clientWidth: 1200, clientHeight: 800,
    getBoundingClientRect: () => ({left: 0, top: 0, right: canvas.clientWidth, bottom: canvas.clientHeight, width: canvas.clientWidth, height: canvas.clientHeight})};
  const stop = sandbox.window.mountSpaceStars(canvas,
    {exclude: () => quiet, onBackgroundMeteor: () => score++, onWarp, arrival,
      prepareMeteorBurst: async () => {arrivalTrace.preparation++; return {};},
      onArrivalReveal: () => {arrivalTrace.reveal++; arrivalTrace.callbacks.push('reveal');},
      onArrivalComplete: () => {arrivalTrace.complete++; arrivalTrace.callbacks.push('complete');}});
  return {timers, frames, stop, canvas, paints: () => paints, arrivalTrace, score: () => score, warps: () => warps, resets: () => resets,
    resize(width, height) {canvas.clientWidth = width; canvas.clientHeight = height; resizeObserver?.();},
    event(name, event = {}) {for (const fn of listeners[name] ?? []) fn(event);},
    dialog(value) {dialog = value;},
    reduced(value) {reduce.matches = value; for (const fn of reduceChanges) fn();},
    focus(value) {focused = value; this.event(value ? 'focus' : 'blur');},
    hidden(value) {document.hidden = value; this.event('visibilitychange');},
    fire() {const [key, timer] = timers.entries().next().value; timers.delete(key); now += timer.delay; timer.fn();},
    paint(offset = 0) {now += offset; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now);}};
}
{
  const h = starsHarness();
  assert.equal([...h.timers.values()][0].delay, 14500);
  h.fire(); assert.equal(h.score(), 0, 'scheduling outside the viewport must not score');
  h.paint(); h.paint(220); assert.equal(h.score(), 1, 'only the first meteor has entered the viewport');
  h.focus(false); assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0, 'blur also pauses decorative star frames');
  h.paint(1000); assert.equal(h.score(), 1, 'the delayed second meteor must not score after blur');
  h.focus(true); assert.equal([...h.timers.values()][0].delay, 14500, 'resume waits the full interval');
  h.paint(1000); assert.equal(h.score(), 1, 'resume never catches up');
  h.fire(); h.paint(500); assert.equal(h.score(), 3, 'two newly visible meteors each add one point');
  h.paint(100); assert.equal(h.score(), 3, 'later frames do not duplicate points');
  h.hidden(true); assert.equal(h.timers.size, 0);
  h.hidden(false); assert.equal(h.timers.size, 1);
  h.stop(); assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0, 'unmount clears animation callbacks');
  h.focus(true); h.hidden(false); assert.equal(h.frames.size, 0, 'late events cannot restart a disposed field');
}
for (const options of [{hidden: true}, {focused: false}, {reduced: true}]) {
  const h = starsHarness(options); assert.equal(h.timers.size, 0); assert.equal(h.score(), 0);
  h.paint(100); assert.equal(h.frames.size, 0, 'hidden, unfocused or reduced-motion scenes never loop'); h.stop();
}
console.log('Background Starfall: actual visible entry, per-meteor scoring, dedupe, blur/hidden pause, no catch-up, reduced-motion and cleanup passed');

{
  const h = starsHarness({dpr: 3});
  assert.ok(h.canvas.width * h.canvas.height <= 2510000, 'decorative canvas has a pixel budget on high-DPI screens');
  h.stop();
}
for (const hz of [60, 75, 90, 120, 144]) {
  const h = starsHarness();
  for (let i = 0; i < hz * 2; i++) h.paint(1000 / hz);
  assert.ok(h.paints() >= 58 && h.paints() <= 62, `ambient canvas keeps about 30 fps on a ${hz} Hz display`);
  h.event('pointermove', {target: {closest: () => null}, pointerType: 'mouse', clientX: 600, clientY: 400});
  const before = h.paints();
  for (let i = 0; i < hz * 2; i++) h.paint(1000 / hz);
  assert.ok(h.paints() - before >= 118 && h.paints() - before <= 122, `pointer feedback keeps about 60 fps on a ${hz} Hz display`);
  h.focus(false); h.paint(5000); h.focus(true);
  const resumed = h.paints(); h.paint();
  assert.equal(h.paints(), resumed + 1, 'resume paints immediately after resetting its deadline');
  h.paint(1); assert.equal(h.paints(), resumed + 1, 'resume never replays missed paints');
  h.stop();
}

function backgroundClick(overrides = {}, ancestor = '') {
  return {button: 0, isPrimary: true, clientX: 600, clientY: 350, defaultPrevented: false,
    target: {closest(selector) {
      const parts = selector.replace(/[\"']/g, '').split(',').map(part => part.trim());
      return ancestor && parts.includes(ancestor) ? {} : null;
    }}, ...overrides};
}
async function checkWarpTrigger() {
  const h = starsHarness();
  h.event('pointerdown', backgroundClick()); h.event('click', backgroundClick());
  await flush(); assert.equal(h.warps(), 0, 'a single click preserves the quiet background');
  h.event('dblclick', backgroundClick());
  await flush(); assert.equal(h.warps(), 1, 'an approved double click starts a warp');
  for (const selector of ['a', 'button', 'input', 'select', 'textarea', 'label', 'dialog', '[role=button]',
    '[role=checkbox]', '[contenteditable]', '.player-hud', '.player-board', '.orbit-usage']) {
    h.event('dblclick', backgroundClick({}, selector));
  }
  await flush(); assert.equal(h.warps(), 1, 'links, controls and stats keep their normal double click behavior');
  for (const overrides of [{button: 1}, {button: 2}, {ctrlKey: true}, {metaKey: true}, {altKey: true},
    {shiftKey: true}, {defaultPrevented: true}, {clientX: -1}, {clientY: -1}, {clientX: 1201}, {clientY: 801}]) {
    h.event('dblclick', backgroundClick(overrides));
  }
  await flush(); assert.equal(h.warps(), 1, 'modified, prevented, secondary and out-of-canvas clicks are ignored');
  const resets = h.resets();
  h.focus(false); assert.ok(h.resets() > resets, 'blur discards warp history');
  h.event('dblclick', backgroundClick()); await flush(); assert.equal(h.warps(), 1, 'blur blocks a warp');
  h.focus(true); h.hidden(true); h.event('dblclick', backgroundClick());
  await flush(); assert.equal(h.warps(), 1, 'hidden pages block a warp');
  h.hidden(false); h.reduced(true); h.event('dblclick', backgroundClick());
  await flush(); assert.equal(h.warps(), 1, 'reduced motion blocks a warp');
  h.reduced(false); h.event('dblclick', backgroundClick()); await flush(); assert.equal(h.warps(), 2);
  h.stop(); h.event('dblclick', backgroundClick()); await flush(); assert.equal(h.warps(), 2, 'disposed scenes cannot warp');
  for (const options of [{dialog: true}, {quiet: {left: 560, right: 640, top: 300, bottom: 400, width: 80, height: 100}}]) {
    let requests = 0;
    const protectedScene = starsHarness({...options, onWarp: async () => {requests++; return true;}});
    protectedScene.event('dblclick', backgroundClick()); await flush();
    assert.equal(requests, 0, 'dialogs and the quiet stats region never request a paid warp'); protectedScene.stop();
  }
  const approval = deferred(); let requests = 0;
  const pending = starsHarness({onWarp: () => {requests++; return approval.promise;}});
  pending.event('dblclick', backgroundClick()); await flush();
  assert.equal(requests, 1); assert.equal(pending.warps(), 0, 'visual flight waits for debit approval');
  pending.event('dblclick', backgroundClick()); await flush();
  assert.equal(requests, 1, 'repeated double clicks do not create concurrent debit requests');
  approval.resolve(true); await flush(); assert.equal(pending.warps(), 1); pending.stop();
  for (const onWarp of [async () => false, async () => {throw Error('offline');}, async () => ({ok: true})]) {
    const denied = starsHarness({onWarp}); denied.event('dblclick', backgroundClick()); await flush();
    assert.equal(denied.warps(), 0, 'insufficient, failed and invalid approvals never play the effect'); denied.stop();
  }
  for (const change of [scene => scene.focus(false), scene => scene.hidden(true), scene => scene.reduced(true),
    scene => scene.dialog(true), scene => {scene.focus(false); scene.focus(true);}, scene => scene.stop()]) {
    const gate = deferred(), late = starsHarness({onWarp: () => gate.promise});
    late.event('dblclick', backgroundClick()); await flush(); change(late); gate.resolve(true); await flush();
    assert.equal(late.warps(), 0, 'late approval cannot replay after attention, modal or disposal changes'); late.stop();
  }
  console.log('Warp trigger: paid approval, no duplicate requests, protected controls, focus epochs, reduced motion and cleanup passed');
}

async function checkStartupArrival() {
  const brief = starsHarness({arrival: true});
  brief.paint(16);
  for (let index = 0; index < 61; index++) brief.paint(16);
  assert.equal(brief.arrivalTrace.reveal, 1, 'the homepage starts fading in during the one-second arrival');
  assert.equal(brief.arrivalTrace.complete, 0, 'arrival remains active just before one second');
  brief.paint(16);
  assert.equal(brief.arrivalTrace.complete, 1, 'arrival releases the homepage at about one second');
  brief.stop();
  let requests = 0;
  const h = starsHarness({arrival: true, onWarp: async () => {requests++; return true;}});
  assert.equal(h.timers.size, 0, 'arrival starts without a background meteor timer');
  h.event('pointermove', {...backgroundClick(), pointerType: 'mouse'});
  h.event('dblclick', backgroundClick());
  h.paint(16); await flush();
  assert.equal(requests, 0, 'startup and double clicks during arrival never submit paid warp intent');
  assert.equal(h.arrivalTrace.preparation, 0, 'hover scoring is suppressed during arrival');
  assert.equal(h.arrivalTrace.dots, 0, 'foreground constellation dots stay hidden during arrival');
  assert.equal(h.arrivalTrace.reveal, 0); assert.equal(h.arrivalTrace.complete, 0);
  const firstProgress = h.arrivalTrace.paints.at(-1)?.arrival;
  assert.ok(Number.isFinite(firstProgress) && firstProgress < .1, 'first arrival frame stays at the dark opening');
  h.paint(100000);
  assert.ok(h.arrivalTrace.paints.at(-1).arrival < .1, 'a stalled frame cannot skip directly to the homepage');
  assert.equal(h.arrivalTrace.reveal, 0);
  const beforePause = h.arrivalTrace.paints.at(-1).arrival;
  h.focus(false); assert.equal(h.frames.size, 0);
  h.paint(100000); assert.equal(h.arrivalTrace.paints.at(-1).arrival, beforePause);
  h.focus(true); h.paint(16);
  assert.ok(h.arrivalTrace.paints.at(-1).arrival - beforePause < .02, 'returning focus resumes rather than catching up');
  const beforeResize = h.arrivalTrace.paints.at(-1).arrival;
  h.resize(900, 700); h.paint(33);
  assert.ok(h.arrivalTrace.paints.at(-1).arrival >= beforeResize, 'resize preserves forward arrival progress');
  for (let index = 0; index < 150 && !h.arrivalTrace.complete; index++) h.paint(33);
  assert.deepEqual(h.arrivalTrace.callbacks, ['reveal', 'complete'], 'reveal precedes completion exactly once');
  assert.equal(h.score(), 0, 'decorative arrival adds no Starfall points');
  assert.equal(requests, 0, 'decorative arrival does not spend points or add a paid journey');
  assert.equal(h.arrivalTrace.preparation, 0);
  assert.equal(h.timers.size, 1, 'ambient meteor timing begins only after arrival');
  for (let index = 0; index < 10; index++) h.paint(33);
  assert.deepEqual(h.arrivalTrace.callbacks, ['reveal', 'complete']);
  h.event('dblclick', backgroundClick()); await flush();
  assert.equal(requests, 1, 'ordinary paid double-click travel resumes after arrival');
  h.stop(); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  for (const options of [{reduced: true}, {hasContext: false}]) {
    const skipped = starsHarness({arrival: true, ...options}); skipped.paint(16);
    assert.deepEqual(skipped.arrivalTrace.callbacks, ['reveal', 'complete'], 'motion preference and missing canvas context show the homepage');
    skipped.stop();
  }
  const reduced = starsHarness({arrival: true}); reduced.paint(16); reduced.reduced(true);
  assert.deepEqual(reduced.arrivalTrace.callbacks, ['reveal', 'complete'], 'enabling reduced motion immediately releases the homepage');
  reduced.paint(16); assert.equal(reduced.frames.size, 0); reduced.stop();
  const disposed = starsHarness({arrival: true}); disposed.paint(16); disposed.stop();
  disposed.focus(false); disposed.focus(true); disposed.paint(10000);
  assert.equal(disposed.arrivalTrace.complete, 0, 'disposing an intro cancels callbacks and future animation');
  assert.equal(disposed.frames.size, 0); assert.equal(disposed.timers.size, 0);
  console.log('Startup arrival: dark opening, no paid or scoring events, clamped lifecycle, pause/resume, resize, reduced motion and fallback passed');
}

async function checkTravelCadence() {
  for (const hz of [60, 75, 90, 120, 144]) {
    const arriving = starsHarness({arrival: true});
    for (let index = 0; index < Math.floor(hz / 2); index++) arriving.paint(1000 / hz);
    assert.ok(arriving.paints() >= 28 && arriving.paints() <= 32, `arrival keeps about 60 fps on a ${hz} Hz display`);
    assert.equal(arriving.arrivalTrace.complete, 0, 'cadence does not accelerate the one-second arrival');
    arriving.stop();
    const traveling = starsHarness();
    traveling.paint(1000 / hz);
    traveling.event('dblclick', backgroundClick()); await flush();
    assert.equal(traveling.warps(), 1);
    const before = traveling.paints();
    for (let index = 0; index < hz; index++) traveling.paint(1000 / hz);
    assert.ok(traveling.paints() - before >= 58 && traveling.paints() - before <= 62,
      `approved travel keeps about 60 fps without a pointer on a ${hz} Hz display`);
    traveling.stop();
  }
  console.log('Canvas cadence: idle, pointer, arrival and paid travel retain their frame budgets across 60–144 Hz displays');
}

async function checkPlayerQueue() {
  const created = [];
  class Element {
    constructor() {this.dataset = {}; this.nodes = new Map(); created.push(this);}
    querySelector(key) {if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key);}
    append() {} setAttribute() {} remove() {}
  }
  let focused = true, releaseProfile, failBackground = false, score = 0;
  const listeners = {}, posts = [];
  const listen = (name, fn) => (listeners[name] ??= []).push(fn);
  const document = {hidden: false, hasFocus: () => focused, createElement: () => new Element(), body: new Element(), addEventListener: listen};
  const profileGate = new Promise(resolve => releaseProfile = resolve);
  const sandbox = {document, AbortController, crypto: require('node:crypto').webcrypto,
    window: {addEventListener: listen}, matchMedia: () => ({matches: false}),
    MutationObserver: class {observe() {} disconnect() {}},
    performance: {now: () => 0}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (url, options = {}) => {
      if (url === '/api/player') {await profileGate; return {ok: true, json: async () => ({name: 'Viewer', meteors: score, csrf: 'test'})};}
      if (url === '/api/leaderboard') return {ok: true, json: async () => ({players: [], me: {name: 'Viewer', meteors: score}})};
      posts.push({url, body: JSON.parse(options.body)});
      if (failBackground && url.endsWith('/background')) throw Error('offline');
      score += JSON.parse(options.body).count;
      return {ok: true, status: 200, json: async () => ({name: 'Viewer', meteors: score, burst: {critical: false, duplicate: false}})};
    }};
  vm.runInNewContext(source('player.js'), sandbox);
  const player = sandbox.window.mountPortalPlayer(new Element(), {escape: String});
  const attention = value => {focused = value; for (const fn of listeners[value ? 'focus' : 'blur']) fn();};
  const flush = () => new Promise(resolve => setImmediate(resolve));
  player.recordBackground(); attention(false); attention(true); releaseProfile(); await flush();
  const hud = created.find(node => node.className === 'player-hud');
  assert.equal(hud.querySelector('.player-distance-value').textContent, '0', 'legacy profiles without distance render a safe zero');
  assert.equal(posts.length, 0, 'a delayed identity response cannot replay a meteor after focus changes');
  player.recordBackground(); await flush();
  assert.equal(posts.length, 1); assert.equal(posts[0].url, '/api/player/meteors/background'); assert.equal(posts[0].body.count, 1);
  attention(false); player.recordBackground(); await flush(); assert.equal(posts.length, 1);
  attention(true); failBackground = true; player.recordBackground(); await flush(); assert.equal(posts.length, 2);
  failBackground = false; attention(false); attention(true); await flush(); assert.equal(posts.length, 2, 'failed background points are not replayed');
  player.record({count: 3, event: 'a'.repeat(32)}); await flush();
  assert.equal(posts.length, 3); assert.equal(posts[2].url, '/api/player/meteors', 'hover scoring keeps its own endpoint');
  player.stop(); player.recordBackground(); await flush(); assert.equal(posts.length, 3);
  console.log('Starfall queue: focus epochs, no background/offline replay, per-star payload, hover compatibility and cleanup passed');
}
function paidPlayerHarness({initialScore = 6, initialDistance = 0, profileName = 'Viewer', profileGate, warpHandler, awardHandler, leaderboardHandler} = {}) {
  class Element {
    constructor() {this.dataset = {}; this.nodes = new Map(); this.children = []; this.textContent = '';}
    querySelector(key) {if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key);}
    append(...children) {this.children.push(...children);} setAttribute(name, value) {(this.attributes ??= {})[name] = value;} remove() {this.removed = true;}
  }
  let focused = true, score = initialScore, distance = initialDistance, debits = 0, profileCalls = 0, leaderboardCalls = 0, timerId = 0;
  const created = [], posts = [], ledger = new Map(), listeners = {}, timers = new Map(), frames = new Map();
  const listen = (name, fn) => (listeners[name] ??= []).push(fn);
  const document = {hidden: false, hasFocus: () => focused, createElement: () => {const node = new Element(); created.push(node); return node;},
    body: new Element(), addEventListener: listen};
  const reduced = {matches: false, addEventListener() {}};
  const profile = () => ({name: profileName, meteors: score, rank: score ? 1 : null, warpDistance: distance, warpRank: distance ? 1 : null});
  const reply = (status, data) => ({status, ok: status >= 200 && status < 300, json: async () => data});
  const charge = body => {
    if (ledger.has(body.event)) return reply(200, {...profile(), warp: {event: body.event, cost: 2, duplicate: true}});
    if (score < 2) return reply(409, {...profile(), code: 'insufficient_points', cost: 2, error: '积分不足，穿梭需要 2 分'});
    ledger.set(body.event, true); score -= 2; distance++; debits++;
    return reply(200, {...profile(), warp: {event: body.event, cost: 2, duplicate: false}});
  };
  const sandbox = {document, AbortController, crypto: require('node:crypto').webcrypto,
    window: {addEventListener: listen}, matchMedia: () => reduced,
    MutationObserver: class {observe() {} disconnect() {}}, performance: {now: () => 0},
    requestAnimationFrame: fn => {frames.set(++timerId, fn); return timerId;}, cancelAnimationFrame: key => frames.delete(key),
    setTimeout: (fn, delay) => {timers.set(++timerId, {fn, delay}); return timerId;}, clearTimeout: key => timers.delete(key),
    setInterval: (fn, delay) => {timers.set(++timerId, {fn, delay, repeat: true}); return timerId;}, clearInterval: key => timers.delete(key),
    fetch: async (url, options = {}) => {
      if (url === '/api/player') {profileCalls++; if (profileGate) await profileGate; return reply(200, {...profile(), csrf: 'test'});}
      if (url === '/api/leaderboard') {
        leaderboardCalls++;
        if (leaderboardHandler) return leaderboardHandler({call: leaderboardCalls, reply, profile});
        return reply(200, {players: [], warpPlayers: [], me: profile()});
      }
      const body = JSON.parse(options.body); posts.push({url, body, headers: options.headers});
      if (url === '/api/player/warp') {
        assert.deepEqual(Object.keys(body), ['event'], 'the browser submits intent, not a client-selected price');
        assert.match(body.event, /^[a-f0-9]{32}$/); assert.equal(options.headers['X-CSRF-Token'], 'test');
        return warpHandler ? warpHandler({body, charge, reply, profile, attempt: posts.filter(post => post.url === url).length}) : charge(body);
      }
      if (url === '/api/player/meteors' || url === '/api/player/meteors/background') {
        const award = () => {score += body.count; return reply(200, {...profile(), burst: {critical: false, duplicate: false}});};
        return awardHandler ? awardHandler({body, award, reply, profile}) : award();
      }
      throw Error('unexpected request: ' + url);
    }};
  vm.runInNewContext(source('player.js'), sandbox);
  const player = sandbox.window.mountPortalPlayer(new Element(), {escape: value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]))});
  const hud = created.find(node => node.className === 'player-hud');
  return {player, posts, timers, reduced, created, hud, score: () => score, distance: () => distance, debits: () => debits, profileCalls: () => profileCalls,
    displayed: () => hud.querySelector('.player-score-value').textContent,
    displayedDistance: () => hud.querySelector('.player-distance-value').textContent,
    bonus: () => hud.querySelector('.player-score-bonus').textContent,
    setServerScore(value) {score = value;},
    setServerDistance(value) {distance = value;},
    focus(value) {focused = value; for (const fn of listeners[value ? 'focus' : 'blur'] ?? []) fn();},
    hidden(value) {document.hidden = value; for (const fn of listeners.visibilitychange ?? []) fn();},
    async flush() {await flush(); const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(1000); await flush();},
  };
}

async function checkPaidWarpPlayer() {
  {
    const h = paidPlayerHarness(); await h.flush(); assert.equal(h.displayed(), '6');
    assert.equal(await h.player.warp(), true); await h.flush();
    assert.equal(h.score(), 4); assert.equal(h.debits(), 1); assert.equal(h.displayed(), '4');
    assert.equal(h.distance(), 1); assert.equal(h.displayedDistance(), '1', 'a confirmed paid flight adds one light year');
    assert.match(h.bonus(), /[−-]\s*2/, 'the HUD shows the actual two-point cost');
    assert.equal(h.posts.length, 1); h.player.stop();
  }
  {
    const h = paidPlayerHarness({initialScore: 1}); await h.flush();
    assert.equal(await h.player.warp(), false); await h.flush();
    assert.equal(h.score(), 1); assert.equal(h.debits(), 0); assert.equal(h.displayed(), '1');
    assert.equal(h.distance(), 0); assert.equal(h.displayedDistance(), '0', 'insufficient points cannot create distance');
    assert.match(h.bonus(), /积分不足/); assert.match(h.bonus(), /2/); h.player.stop();
  }
  {
    const h = paidPlayerHarness({initialScore: 1}); await h.flush(); h.setServerScore(3);
    assert.equal(await h.player.warp(), true, 'newly earned server points remain spendable before a HUD refresh');
    assert.equal(h.score(), 1); assert.equal(h.debits(), 1); h.player.stop();
  }
  {
    const gate = deferred(); const h = paidPlayerHarness({warpHandler: async ({body, charge}) => {await gate.promise; return charge(body);}});
    await h.flush(); const first = h.player.warp(); const repeated = h.player.warp(); await h.flush();
    assert.equal(h.posts.length, 1); assert.equal(h.debits(), 0); assert.equal(h.displayed(), '6', 'no speculative debit is shown');
    gate.resolve(); assert.equal(await first, true); await repeated; await h.flush();
    assert.equal(h.posts.length, 1); assert.equal(h.debits(), 1); assert.equal(h.displayed(), '4'); h.player.stop();
  }
  {
    const h = paidPlayerHarness({warpHandler: ({body, charge, attempt}) => {
      const response = charge(body); if (attempt === 1) throw Error('acknowledgement lost'); return response;
    }});
    await h.flush(); assert.equal(await h.player.warp(), true); await h.flush();
    assert.equal(h.posts.length, 2); assert.equal(h.posts[0].body.event, h.posts[1].body.event);
    assert.equal(h.debits(), 1, 'an uncertain response retries the same idempotency key'); assert.equal(h.score(), 4);
    assert.equal(h.distance(), 1); assert.equal(h.displayedDistance(), '1', 'an idempotent retry does not travel twice'); h.player.stop();
  }
  {
    const h = paidPlayerHarness({warpHandler: ({body, charge, reply, attempt}) => attempt === 1 ? reply(403, {error: 'renew session'}) : charge(body)});
    await h.flush(); assert.equal(await h.player.warp(), true); await h.flush();
    assert.equal(h.posts.length, 2); assert.equal(h.posts[0].body.event, h.posts[1].body.event);
    assert.ok(h.profileCalls() >= 2); assert.equal(h.debits(), 1); h.player.stop();
  }
  for (const change of [h => h.focus(false), h => h.hidden(true), h => {h.reduced.matches = true;},
    h => {h.focus(false); h.focus(true);}, h => h.player.stop()]) {
    const ready = deferred(); const h = paidPlayerHarness({profileGate: ready.promise});
    const pending = h.player.warp(); change(h); ready.resolve();
    assert.equal(await pending, false); await h.flush();
    assert.equal(h.posts.length, 0, 'waiting for identity cannot replay a paid intent after attention or disposal changes');
    h.player.stop();
  }
  for (const change of [h => h.focus(false), h => h.hidden(true), h => {h.reduced.matches = true;}, h => h.player.stop()]) {
    const gate = deferred(); const h = paidPlayerHarness({warpHandler: async ({body, charge}) => {await gate.promise; return charge(body);}});
    await h.flush(); const pending = h.player.warp(); await h.flush(); change(h); gate.resolve();
    assert.equal(await pending, false, 'a late debit acknowledgement never starts flight in an inactive or disposed view');
    h.player.stop();
  }
  {
    const h = paidPlayerHarness({warpHandler: () => {throw Error('offline');}}); await h.flush();
    assert.equal(await h.player.warp(), false); const attempts = h.posts.length;
    assert.ok(attempts <= 2); h.focus(false); h.focus(true); await h.flush();
    assert.equal(h.posts.length, attempts, 'failed paid actions are not queued for a later visit'); assert.equal(h.debits(), 0); h.player.stop();
  }
  {
    const stale = deferred(); const h = paidPlayerHarness({leaderboardHandler: ({call, reply, profile}) =>
      call === 2 ? stale.promise : reply(200, {players: [], me: profile()})});
    await h.flush(); h.focus(false); h.focus(true); await h.flush();
    assert.equal(await h.player.warp(), true); await h.flush();
    stale.resolve({ok: true, status: 200, json: async () => ({players: [], me: {name: 'Viewer', meteors: 6}})});
    await h.flush(); assert.equal(h.displayed(), '4', 'a pre-debit leaderboard response cannot restore spent points'); h.player.stop();
  }
  {
    const awardAck = deferred(); const h = paidPlayerHarness({awardHandler: async ({award}) => {
      const credited = award(); await awardAck.promise; return credited;
    }});
    await h.flush(); h.player.record({count: 3, event: 'a'.repeat(32)}); await h.flush();
    assert.equal(h.score(), 9); const pending = h.player.warp(); await h.flush();
    assert.deepEqual(h.posts.map(post => post.url), ['/api/player/meteors'], 'a paid warp waits for in-flight earnings to finish');
    awardAck.resolve(); assert.equal(await pending, true); await h.flush();
    assert.deepEqual(h.posts.map(post => post.url), ['/api/player/meteors', '/api/player/warp']);
    assert.equal(h.displayed(), '7', 'late earnings cannot overwrite the balance after a debit'); assert.equal(h.debits(), 1);
    assert.equal(h.displayedDistance(), '1', 'the flight still adds distance after earlier earnings settle'); h.player.stop();
  }
  {
    const warpAck = deferred(); const h = paidPlayerHarness({warpHandler: async ({body, charge}) => {
      await warpAck.promise; return charge(body);
    }});
    await h.flush(); const pending = h.player.warp(); await h.flush();
    h.player.record({count: 3, event: 'b'.repeat(32)}); await h.flush();
    assert.deepEqual(h.posts.map(post => post.url), ['/api/player/warp'], 'earnings arriving during a debit wait for its acknowledgement');
    warpAck.resolve(); assert.equal(await pending, true); await h.flush();
    assert.deepEqual(h.posts.map(post => post.url), ['/api/player/warp', '/api/player/meteors']);
    assert.equal(h.displayed(), '7'); assert.equal(h.score(), 7); assert.equal(h.debits(), 1);
    assert.equal(h.displayedDistance(), '1', 'later earnings preserve the acknowledged travel distance');
    assert.match(h.bonus(), /[−-]\s*2/, 'ordinary earnings preserve the cost feedback briefly'); h.player.stop();
  }
  console.log('Paid warp: authoritative debit, insufficient balance, idempotent retries, in-flight guard, attention epochs and stale refresh protection passed');
}


async function checkWarpDistance() {
  {
    const h = paidPlayerHarness({initialScore: 0, initialDistance: 8});
    await h.flush();
    assert.equal(h.displayedDistance(), '8', 'initial history renders even when the Starfall balance is zero');
    assert.match(h.hud.innerHTML, /player-score[\s\S]*player-metric-divider[\s\S]*player-distance/,
      'the personal distance sits to the right of Starfall with its own vertical divider');
    h.player.stop();
  }
  {
    const h = paidPlayerHarness({initialDistance: 3}); await h.flush();
    assert.equal(h.displayedDistance(), '3');
    h.setServerDistance(7); h.focus(false); h.focus(true); await h.flush();
    assert.equal(h.displayed(), '6');
    assert.equal(h.displayedDistance(), '7', 'a new distance is displayed when the point balance is unchanged');
    h.player.stop();
  }
  {
    const h = paidPlayerHarness({initialScore: 1, initialDistance: 4}); await h.flush();
    assert.equal(await h.player.warp(), false); await h.flush();
    assert.equal(h.displayedDistance(), '4', 'an unaffordable flight preserves existing distance'); h.player.stop();
  }
  {
    const escapedName = 'Warp <Pilot> & "Co"';
    const h = paidPlayerHarness({initialDistance: 5, leaderboardHandler: ({reply, profile}) => reply(200, {
      players: [{name: 'StarLeader', meteors: 99, rank: 1}, {name: 'Viewer', meteors: 6, rank: 2}],
      warpPlayers: [{name: 'Viewer', warpDistance: 5, rank: 1}, {name: escapedName, warpDistance: 4, rank: 2}],
      me: profile(),
    })});
    await h.flush();
    const wrapper = h.created.find(node => node.className === 'player-boards');
    const scoreBoard = h.created.find(node => node.className === 'player-board');
    const distanceBoard = h.created.find(node => node.className?.split(' ').includes('player-board--distance'));
    assert.ok(wrapper && scoreBoard && distanceBoard, 'each metric has its own leaderboard');
    assert.deepEqual(wrapper.children, [scoreBoard, distanceBoard, h.created.find(node=>node.className?.split(' ').includes('player-board--planets'))], 'creation rankings follow STAR and JUMP on the right');
    const scoreRows = scoreBoard.querySelector('ol').innerHTML.match(/<li\b[\s\S]*?<\/li>/g);
    const distanceRows = distanceBoard.querySelector('ol').innerHTML.match(/<li\b[\s\S]*?<\/li>/g);
    assert.equal(scoreRows.length, 6); assert.equal(distanceRows.length, 6, 'both rankings retain six visible places');
    assert.ok(scoreRows[0].includes('StarLeader') && !scoreRows[0].includes('Warp'));
    assert.ok(distanceRows[0].includes('Viewer') && !distanceRows[0].includes('StarLeader'));
    assert.match(scoreRows[1], /class="is-me"/); assert.match(distanceRows[0], /class="is-me"/);
    assert.match(distanceRows[1], /Warp &lt;Pilot&gt; &amp; &quot;Co&quot;/);
    assert.ok(!distanceRows[1].includes('<Pilot>'), 'ranked names remain escaped in titles and text');
    assert.equal(h.displayedDistance(), '5');
    h.player.stop();
    assert.ok(wrapper.removed && h.hud.removed, 'the HUD and both leaderboards are removed on disposal');
    assert.equal(h.timers.size, 0, 'distance refresh does not leak timers after disposal');
  }
  {
    const h = paidPlayerHarness({initialDistance: 2, leaderboardHandler: ({reply, profile}) =>
      reply(200, {players: [], me: profile()})});
    await h.flush();
    assert.equal(h.displayedDistance(), '2', 'older ranking responses can omit warpPlayers without dropping the profile distance');
    h.player.stop();
  }
  console.log('Warp distance: historical and unchanged-balance updates, idempotent travel, independent rankings, escaping and cleanup passed');
}

async function main() {await checkWarpTrigger(); await checkStartupArrival(); await checkTravelCadence(); await checkPlayerQueue(); await checkPaidWarpPlayer(); await checkWarpDistance();}
main().catch(error => {console.error(error); process.exitCode = 1;});

{
  const h=starsHarness();
  h.fire();h.paint(220);
  const before=h.paints(),score=h.score(),width=h.canvas.width;
  h.stop.setPaused(true);
  assert.equal(h.frames.size,0,'planet hover cancels the canvas frame, rather than just hiding it');
  assert.equal(h.timers.size,0,'planet hover stops new ambient meteor timers');
  h.paint(10000);
  h.event('pointermove',{target:{closest:()=>null},pointerType:'mouse',clientX:600,clientY:400});
  h.resize(1000,700);h.focus(true);h.hidden(false);
  assert.equal(h.canvas.width,width,'resize does not clear the frozen frame');
  assert.equal(h.frames.size,0,'pointer, focus, resize and visibility cannot restart a hovered field');
  assert.equal(h.paints(),before);assert.equal(h.score(),score,'paused meteors never score');
  h.stop.setPaused(false);
  assert.equal(h.canvas.width,1000,'deferred resize is applied on resume');
  assert.equal(h.timers.size,1,'resume starts a fresh meteor interval');
  h.paint();
  assert.equal(h.paints(),before+1,'resume paints immediately');
  h.paint(220);
  assert.equal(h.score(),score+1,'an in-flight meteor continues on its frozen timeline after a long pause');
  h.stop.setPaused(true);h.paint(5000);h.stop.setPaused(false);h.paint();
  assert.equal(h.score(),score+1,'repeated pauses cannot duplicate meteor scoring');
  h.stop();h.stop.setPaused(false);h.stop.setPaused(true);
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0,'late pause changes cannot revive a disposed scene');
}
