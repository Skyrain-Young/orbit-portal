const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'portal', 'portal.js'), 'utf8');

function portal({motion = true, reduced = false, failure = false, previousVisitor = null} = {}) {
  const listeners = {}, rootListeners = {}, windowListeners = {}, stage = {inert: true}, layout = {}, errorButton = {};
  const calls = {opened: 0, paid: 0, stopped: 0};
  const storage = new Map([['dio-visitor', previousVisitor]]);
  const attributes = new Set(['aria-busy']);
  const root = {
    dataset: {arrival: 'waiting'}, classList: {toggle() {}}, innerHTML: '',
    addEventListener(name, fn) {(rootListeners[name] ??= []).push(fn);},
    querySelector(selector) {
      return selector === '#layout-stage' ? stage : selector === '.orbit-layout' ? layout : selector === 'button' ? errorButton : {};
    },
    hasAttribute(name) {return name === 'data-arrival' ? Object.hasOwn(this.dataset, 'arrival') : attributes.has(name);},
    removeEventListener() {},
    removeAttribute(name) {if (name === 'data-arrival') delete this.dataset.arrival; else attributes.delete(name);},
  };
  const document = {title: '', querySelector: selector => selector === '#prototype' ? root : null,
    addEventListener(name, fn) {(listeners[name] ??= []).push(fn);}};
  const stop = () => {calls.stopped++;};
  const stopStars = Object.assign(stop, {setPaused(value) {(calls.pauses ??= []).push(value);}});
  const usage = Object.assign(stop, {refresh() {}});
  let resolveCatalog;
  const catalogReady = new Promise(resolve => {resolveCatalog = resolve;});
  const sandbox = {
    document, matchMedia: () => ({matches: reduced}),
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)}, crypto: require('node:crypto').webcrypto,
    location: {reload() {}},
    fetch: async (url, options) => {
      if (url === '/api/catalog') return catalogReady;
      if (url === '/api/events') calls.event = JSON.parse(options.body);
      return {ok: true, json: async () => ({layouts:{main:{}}})};
    },
    window: {
      createLayoutCatalog: () => ({dialog: {open: false}, open() {calls.opened++;}}),
      portalLayouts: {orbit: options => {calls.orbit = options; return stop;}},
      mountPortalPlayer: () => ({identityReady: Promise.resolve(), prepare() {}, record() {}, recordBackground() {}, warp() {calls.paid++;}, stop}),
      mountPlanetSurfaces: () => stop,
      mountPortalUsage: () => usage,
      mountSpaceStars: (_, options) => {calls.stars = options; return stopStars;},
      addEventListener(name, fn) {(windowListeners[name] ??= []).push(fn);},
    },
  };
  const completion = vm.runInNewContext(source, sandbox);
  return {root, stage, calls, completion, attributes, storage,
    load() {resolveCatalog({ok: !failure, json: async () => ({apps: [], groups: {}, slots: {}, site: {title: 'Orbit Portal', motion}})});},
    key(target = {closest() {}}) {for (const listener of listeners.keydown ?? []) listener({key: ' ', code: 'Space', target, preventDefault() {}});},
    click(control, detail) {document.activeElement = control; for (const listener of rootListeners.click ?? []) listener({target: {closest: () => control}, detail});},
    leave() {for (const listener of windowListeners.pagehide ?? []) listener({persisted: false});},
  };
}

async function main() {
  const previousVisitor = 'a'.repeat(32);
  const h = portal({previousVisitor});
  assert.equal(h.root.dataset.arrival, 'waiting'); assert.equal(h.stage.inert, true);
  assert.equal(h.calls.opened, 0, 'loading never exposes or activates homepage controls');
  h.load(); await h.completion;
  assert.equal(h.storage.get('orbit-visitor'), previousVisitor, 'existing visitor IDs survive the rename');
  assert.equal(h.calls.event.visitor, previousVisitor);
  assert.equal(h.root.dataset.arrival, 'travel'); assert.equal(h.stage.inert, true);
  assert.equal(h.calls.stars.arrival, true, 'the background receives a decorative arrival request');
  h.key(); assert.equal(h.calls.opened, 0, 'keyboard shortcuts stay blocked during arrival');
  h.calls.stars.onArrivalReveal();
  assert.equal(h.root.dataset.arrival, 'revealing'); assert.equal(h.stage.inert, true, 'fading controls remain inert until landing');
  h.key(); assert.equal(h.calls.opened, 0);
  h.calls.stars.onArrivalComplete();
  assert.equal(h.root.hasAttribute('data-arrival'), false); assert.equal(h.stage.inert, false);
  assert.equal(h.attributes.has('aria-busy'), false);
  assert.equal(h.calls.paid, 0, 'bootstrapping arrival never calls the paid travel operation');
  h.key(); assert.equal(h.calls.opened, 1, 'ordinary homepage shortcuts become available after landing');
  const logo = {blurred: 0, blur() {this.blurred++;}};
  h.click(logo, 1); assert.equal(logo.blurred, 1, 'pointer clicks release homepage button focus');
  h.click(logo, 0); assert.equal(logo.blurred, 1, 'keyboard clicks retain focus for navigation');
  h.key({closest: selector => selector === 'button' ? logo : null});
  assert.equal(h.calls.opened, 2, 'Space opens the catalog even when a homepage button has focus');
  h.calls.orbit.onBackgroundPause(true);h.calls.orbit.onBackgroundPause(false);
  assert.deepEqual(h.calls.pauses,[true,false],'the production portal wires planet attention to the shared starfield');
  h.leave(); assert.equal(h.calls.stopped, 5, 'page disposal stops all mounted portal layers');
  for (const options of [{motion: false}, {reduced: true}]) {
    const skipped = portal(options); skipped.load(); await skipped.completion;
    assert.equal(skipped.root.hasAttribute('data-arrival'), false);
    assert.equal(skipped.stage.inert, false, 'disabled or reduced motion never strands an invisible homepage');
    assert.equal(skipped.calls.stars?.arrival ?? false, false);
    skipped.calls.orbit.onBackgroundPause(true);skipped.calls.orbit.onBackgroundPause(false);
    skipped.key(); assert.equal(skipped.calls.opened, 1);
  }
  const failed = portal({failure: true}); failed.load(); await failed.completion;
  assert.equal(failed.root.hasAttribute('data-arrival'), false);
  assert.equal(failed.stage.inert, false); assert.equal(failed.attributes.has('aria-busy'), false);
  assert.match(failed.root.innerHTML, /portal-error/, 'catalog failures show a usable recovery view instead of a dark screen');
  console.log('Portal arrival bootstrap: inert loading/fade, callback release, keyboard gates, free decoration, reduced/off fallbacks and error recovery passed');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
