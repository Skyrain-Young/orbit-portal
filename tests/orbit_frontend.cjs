// Exercise the production orbit scheduler with deterministic frames and DOM writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.ORBIT_SOURCE || path.join(__dirname, '..', 'web', 'portal', 'orbit.js'), 'utf8');

function portal({galaxies=false,width=1440,height=900,initialSlots,blackHole=false}={}) {
  let now = 0, nextFrame = 0;
  const frames = new Map(), writes = [], sceneReads = [];
  const mutationObservers = [];
  const target = () => {
    const listeners = new Map();
    return {
      addEventListener(name, callback) {if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback);},
      emit(name, event = {}) {for (const callback of listeners.get(name) || []) callback({pointerType:'mouse', ...event});},
    };
  };
  function element(name) {
    const attributes = new Map(), styles = new Map();
    return Object.assign(target(), {
      name, clientWidth:width, clientHeight:height, offsetTop:820, offsetLeft:95, offsetWidth:24,
      dataset:new Proxy({}, {set(object, key, value) {writes.push([name,'dataset',key]); object[key] = value; return true;}}),
      style:new Proxy({
        getPropertyValue(key) {return styles.get(key) || '';},
        setProperty(key, value) {writes.push([name,'style',key]); styles.set(key, value);},
      }, {set(object, key, value) {writes.push([name,'style',key]); object[key] = value; styles.set(key, value); return true;}}),
      classList:{add(){},remove(){}},append(){},
      hasAttribute(key){return attributes.has(key);},
      getAttribute(key) {return attributes.get(key) ?? null;},
      setAttribute(key, value) {writes.push([name,'attr',key]); attributes.set(key, String(value));},
      removeAttribute(key) {writes.push([name,'remove',key]); attributes.delete(key);},
      toggleAttribute(key, enabled) {enabled ? this.setAttribute(key, '') : this.removeAttribute(key);},
      matches:() => true,
      querySelector:() => null,
      getBoundingClientRect:() => ({left:0,top:0,right:1440,bottom:900}),
    });
  }
  const selectors = new Map();
  for (const name of ['orbit-layout','orbit-scene','orbit-atmosphere','orbit-paths','orbit-world','orbit-layout-toggle','orbit-wordmark','orbit-keyboard-hint']) selectors.set('.'+name, element(name));
  Object.defineProperties(selectors.get('.orbit-scene'), {
    clientWidth:{get() {sceneReads.push('width');return width;}},
    clientHeight:{get() {sceneReads.push('height');return height;}},
  });
  selectors.get('.orbit-layout').querySelector = name => selectors.get(name);
  const positions = ['core','git','doc','week','flow','gpu','bi','seek',...(galaxies?['extra1','extra2']:[])];
  const ids = ['google','youtube','github','wikipedia','google-maps','mdn','openstreetmap','internet-archive',...(galaxies?['extra1','extra2']:[])];
  const sizes = [108,76,68,63,53,54,58,48,48,48];
  const satellites = ids.map((id, i) => {
    const node = element(id), anchor = element(id+'-anchor');
    node.append=()=>{};node.size = sizes[i]; node.anchor = anchor;
    node.querySelector = name => name === 'a' ? anchor : null;
    selectors.set(`[data-planet="${galaxies?'seat-'+positions[i]:id}"]`, node);
    selectors.set(`[data-orbit-segment="${positions[i]}"]`, element(positions[i]+'-path'));
    return node;
  });
  for (const name of ['wide','cross','inner']) {
    selectors.set(`[data-orbit-ring="${name}"]`, element(name+'-ring'));
    selectors.set(`[data-orbit-trail="${name}"]`, element(name+'-trail'));
  }
  const dialog = Object.assign(element('catalog'), {open:false});
  const root = {querySelector:name => selectors.get(name),dispatchEvent(){}};
  let hole;const haloStates=[],backgroundStates=[];
  const document = Object.assign(target(), {createElement:tag=>{const node=element(tag);if(tag==='div'){hole=node;const button=element('hole-trigger');node.querySelector=()=>button;}return node;},hidden:false, querySelector:selector => selector==='dialog[open]'&&!dialog.open?null:dialog});
  const reduced = Object.assign(target(), {matches:false});
  let galaxyOptions;
  const window = Object.assign(target(), {createPortalBlackHole:()=>({setActive:value=>haloStates.push(value),accelerate(){},destroy(){}}),matchMedia:() => reduced,mountGalaxyNavigation:options=>{galaxyOptions=options;return {stop(){}};}});
  const sandbox = {
    window, document, AbortController, Event, performance:{now:() => now},
    getComputedStyle:node => ({letterSpacing:'-10px', getPropertyValue:() => String(node.size)}),
    requestAnimationFrame:callback => {frames.set(++nextFrame, callback); return nextFrame;},
    cancelAnimationFrame:id => frames.delete(id),
    ResizeObserver:class {constructor(callback) {this.callback=callback;} observe() {} disconnect() {}},
    MutationObserver:class {constructor(callback) {mutationObservers.push(callback);} observe() {} disconnect() {}},
  };
  vm.runInNewContext(source, sandbox);
  const slots=Object.fromEntries(positions.map((p,i)=>[p,ids[i]]));
  const stop = window.portalLayouts.orbit({root, apps:ids.map(id=>({id, name:id})), slots, link:()=>'', escape:x=>x, icon:()=>'', onBackgroundPause:value=>backgroundStates.push(value),site:{title:'Orbit Portal',motion:true,blackHole,...(galaxies?{galaxies:{main:initialSlots||slots}}:{})}});
  const step = (count = 1) => {for (let index=0;index<count;index++) {now += 1000/60; const pending=[...frames.values()]; frames.clear(); pending.forEach(callback=>callback(now));}};
  return {
    selectors, satellites, writes, sceneReads, frames, step, stop, document, reduced,galaxyOptions,hole,haloStates,backgroundStates,
    toggle:() => selectors.get('.orbit-layout-toggle').emit('click'),
    dialog(open) {dialog.open=open; mutationObservers.forEach(callback=>callback());},
    progress:() => Number(selectors.get('.orbit-layout').style.getPropertyValue('--list-progress')),
    position:node => node.style.getPropertyValue('transform').match(/[-\d.]+(?=px)/g).map(Number),
  };
}

{
  const h=portal();
  h.step(5);
  assert.equal(h.progress(),0,'the current default view remains orbit');
  assert.equal(h.frames.size,1,'the initial orbit animates without needing a layout toggle');
  h.toggle();h.step(40);
  assert.equal(h.progress(),1,'the morph reaches the list in 600 ms');
  assert.equal(h.frames.size,0,'the stationary list has no orbit frame loop');
  h.toggle();h.step(40);
  assert.equal(h.progress(),0,'the morph reaches orbit in 600 ms');
  const first=h.position(h.satellites[0]);
  h.writes.length=0;h.step(10);
  assert.notDeepEqual(h.position(h.satellites[0]),first,'orbital positions advance');
  assert.equal(h.writes.filter(([,type,key])=>type==='attr'&&key==='d').length,0,'ordinary orbital motion reuses the sampled track paths');
  assert.equal(h.writes.filter(([,type,key])=>type==='style'&&key.startsWith('--')).length,0,'ordinary orbital motion does not invalidate inherited sizing properties');
  const hovered=h.satellites[0], anchor=h.position(hovered);
  hovered.anchor.emit('pointerenter');
  for(let i=0;i<240;i++) {
    h.step();
    const current=h.position(hovered);
    assert.ok(Math.abs(current[0]-anchor[0])<.02 && Math.abs(current[1]-anchor[1])<.02,'hover zoom keeps its hit target under the pointer');
  }
  assert.equal(h.frames.size,0,'settled hover stops the orbit frame loop');
  assert.ok(h.writes.filter(([,type,key])=>type==='style'&&key==='--orbit-camera').every(([name])=>name==='orbit-atmosphere'),
    'camera scale only invalidates the atmosphere subtree');
  h.writes.length=0;h.step(30);
  assert.equal(h.writes.length,0,'settled hover produces no DOM mutations');
  hovered.emit('pointerleave');h.step(240);
  const resumed=h.position(hovered);h.step(10);
  assert.notDeepEqual(h.position(hovered),resumed,'leaving a settled hover resumes orbital motion');
  h.dialog(true);h.step(240);
  assert.equal(h.frames.size,0,'an open catalog suspends the orbit once its camera returns');
  h.dialog(false);h.step(10);
  assert.equal(h.frames.size,1,'closing the catalog resumes the orbit');
  h.document.hidden=true;h.document.emit('visibilitychange');
  assert.equal(h.frames.size,0,'hidden pages cancel the orbit frame');
  h.document.hidden=false;h.document.emit('visibilitychange');h.step(2);
  assert.equal(h.frames.size,1,'visible pages wake the orbit');
  h.stop();assert.equal(h.frames.size,0,'unmount cancels pending work');
}
{
  const h=portal();h.step(2);h.toggle();h.step(40);
  h.toggle();h.step(9);
  const before=h.progress();h.toggle();
  assert.equal(h.progress(),before,'reversing a morph does not jump its geometry');
  h.step(45);
  assert.equal(h.progress(),1);assert.equal(h.frames.size,0);
  h.toggle();h.step(40);h.reduced.matches=true;h.reduced.emit('change');h.step(3);
  assert.equal(h.frames.size,0,'reduced motion disables orbital scheduling');
  h.toggle();h.step(3);
  assert.equal(h.progress(),1,'reduced motion switches layouts immediately');
  assert.equal(h.selectors.get('.orbit-wordmark').style.transform,'none');
  h.reduced.matches=false;h.reduced.emit('change');h.step(3);
  h.toggle();h.step(40);assert.equal(h.frames.size,1,'re-enabling motion wakes the next transition');
  h.stop();
}
{
  const h=portal({galaxies:true,blackHole:true});h.step(8);
  const svg=h.selectors.get('.orbit-paths'),world=h.selectors.get('.orbit-world'),hovered=h.satellites[1];
  const before=h.position(hovered);
  h.sceneReads.length=0;
  hovered.anchor.emit('pointerenter');h.step(240);
  assert.equal(h.sceneReads.length,0,'orbit zoom frames reuse the scene dimensions from resize');
  assert.equal(world.getAttribute('transform'),null,'zoom keeps the track group geometry intact');
  const matrix=svg.style.getPropertyValue('transform');
  const [dx,dy,scale]=matrix.match(/translate3d\(([^,]+)px, ([^,]+)px, 0\) scale\(([^)]+)\)/).slice(1).map(Number);
  assert.equal(scale,1.85,'the track layer reaches the hover camera scale');
  assert.ok(Math.abs(before[0]*scale+dx-before[0])<.002&&Math.abs(before[1]*scale+dy-before[1])<.002,
    'track zoom uses the same pivot as the hovered planet');
  assert.deepEqual(h.position(hovered),before,'the selected planet stays anchored after galaxy travel');
  const layout=h.selectors.get('.orbit-layout');layout.dataset.galaxyTravel='true';
  h.galaxyOptions.prepareTravel();
  assert.equal(layout.dataset.focused,undefined,'travel clears stale hover focus');
  assert.equal(svg.style.getPropertyValue('transform'),'none','travel starts with the shared screen camera restored');
  assert.ok(h.satellites.every(node=>node.dataset.active===undefined),'travel clears all prior active planet markers');
  for(const point of h.galaxyOptions.points()){
    const index=['core','git','doc','week','flow','gpu','bi','seek','extra1','extra2'].indexOf(point.seat);
    const [x,y]=h.position(h.satellites[index]);
    assert.ok(Math.abs(x-point.x)<.002&&Math.abs(y-point.y)<.002,'travel samples the visible planet coordinates');
  }
  h.stop();
}
for(const width of [390,618,900,1440]){
  const h=portal({galaxies:true,blackHole:true,width});h.step(3);
  h.hole.setAttribute('data-menu-open','');
  h.toggle();
  assert.equal(h.hole.hidden,true,'hide the entry while layouts morph');
  h.step(40);
  assert.equal(h.progress(),1);
  assert.equal(h.hole.hidden,false,'list view has its own visible galaxy entry');
  assert.equal(h.haloStates.at(-1),true,'the list halo keeps flowing');
  const holePosition=h.position(h.hole);
  assert.ok(holePosition[1]<h.position(h.satellites[0])[1]-65,'entry sits above the first row');
  const center=h.galaxyOptions.geometry();
  assert.deepEqual(holePosition,[center.cx,center.cy],'travel targets the visible list black hole');
  h.dialog(true);h.step(2);
  assert.equal(h.hole.hidden,true,'the catalog still hides the entry');
  h.dialog(false);h.step(2);
  assert.equal(h.hole.hidden,false);
  assert.equal(h.hole.hasAttribute('data-menu-open'),false,'touch menu state cannot leak into a later layout');
  const positions=h.satellites.map(node=>h.position(node));
  assert.equal(new Set(positions.map(p=>p[0])).size,2,'ten seats still fit in two columns');
  assert.equal(new Set(positions.map(p=>p[1])).size,5,'ten seats use five rows');
  for(const node of h.satellites){
    const [x]=h.position(node),size=parseFloat(node.style.getPropertyValue('--planet-size'));
    const rowWidth=parseFloat(node.style.getPropertyValue('--app-width'));
    assert.ok(x-size/2>=0&&x-size/2+rowWidth<=width,'every list link stays inside the viewport');
  }
  assert.equal(h.frames.size,0,'galaxy-enabled lists remain idle');
  h.galaxyOptions.apply({core:'google',extra2:'extra2'});h.step(2);
  const visible=h.satellites.filter(p=>!p.hidden);
  assert.equal(visible.length,4,'only two vacant seats remain visible after an update');
  assert.equal(new Set(visible.map(p=>h.position(p)[1])).size,2,'sparse galaxies compact without holes left by hidden seats');
  assert.equal(h.progress(),1,'editing the current galaxy preserves the list layout');
  assert.equal(h.hole.hidden,false);
  assert.deepEqual(h.position(h.hole),holePosition,'changing galaxy density does not move the list entry');
  h.toggle();h.step(10);const progress=h.progress();h.toggle();
  assert.equal(h.progress(),progress,'reversing with ten seats remains continuous');
  h.step(40);h.toggle();h.step(40);
  assert.equal(h.progress(),0);assert.equal(h.hole.hidden,false);
  assert.equal(h.haloStates.at(-1),true);
  h.selectors.get('.orbit-layout').dataset.galaxyTravel='true';h.galaxyOptions.prepareTravel();h.step(2);
  h.toggle();assert.equal(h.progress(),0,'layout switches are blocked during a galaxy flight');
  assert.equal(h.frames.size,0,'galaxy flight does not run a second orbit frame loop');
  h.stop();
}
{
  const h=portal({galaxies:true,initialSlots:{core:'google',extra2:'extra2'}});
  assert.equal(h.satellites.filter(p=>!p.hidden).length,4,'initial loading applies the same two-vacancy limit as later edits');
  h.reduced.matches=true;h.reduced.emit('change');h.toggle();h.step(2);
  assert.equal(h.progress(),1);assert.equal(h.frames.size,0,'galaxy-enabled reduced-motion list switches are immediate and idle');
  h.stop();
}
console.log('Orbit scheduling, stable geometry, anchored zoom and reversal checks passed');

{
  const h=portal({blackHole:true}); h.step(5);
  const first=h.satellites[0], second=h.satellites[1];
  const layout=h.selectors.get('.orbit-layout');
  first.anchor.emit('pointerenter');
  assert.equal(h.backgroundStates.at(-1),true,'hover immediately pauses the shared starfield');
  assert.equal(h.haloStates.at(-1),false,'hover immediately pauses the black hole');
  assert.equal(layout.hasAttribute('data-background-paused'),true,'decorative CSS pauses with the canvases');
  h.step(240);
  assert.equal(h.haloStates.at(-1),false,'camera frames cannot restart the black hole during hover');
  first.emit('pointerleave');h.step(2);
  assert.equal(h.backgroundStates.at(-1),true,'pointer exit keeps the background paused during camera return');
  assert.equal(h.haloStates.at(-1),false,'the black hole stays paused during camera return');
  assert.equal(layout.dataset.focused,undefined,'the hover highlight clears immediately');
  second.anchor.emit('pointerenter');h.step(30);
  assert.deepEqual(h.backgroundStates,[true],'re-entering during return keeps a continuous background pause');
  second.emit('pointerleave');h.step(240);
  assert.deepEqual(h.backgroundStates,[true,false],'the background resumes once the camera is back');
  assert.equal(h.haloStates.at(-1),true,'the black hole resumes once the camera is back');
  assert.equal(layout.hasAttribute('data-background-paused'),false,'decorative CSS resumes with the canvases');
  h.toggle();h.step(40);
  second.anchor.emit('focus');h.step(2);
  assert.equal(h.backgroundStates.at(-1),true,'keyboard focus also pauses in list view');
  assert.equal(h.haloStates.at(-1),false);
  second.anchor.emit('blur');h.step(2);
  assert.equal(h.backgroundStates.at(-1),false,'leaving keyboard focus releases the pause');
  first.anchor.emit('pointerenter');h.dialog(true);h.step(2);
  assert.equal(h.backgroundStates.at(-1),false,'opening the catalog clears the planet pause');
  assert.equal(h.haloStates.at(-1),false,'the catalog still owns its independent black hole stop');
  h.dialog(false);h.step(2);assert.equal(h.haloStates.at(-1),true);
  h.stop();
}
