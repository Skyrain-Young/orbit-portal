const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..','web','portal',name+'.js'),'utf8');
// Execute the real widgets with deterministic frames and observable DOM writes.
function harness({reduced=false}={}){
  let writes=0,now=0,id=0;
  const elements=[],frames=new Map(),intervals=[];
  class Element{
    constructor(){this.nodes=new Map();this.attrs={};this.dataset=new Proxy({},{set:(o,k,v)=>{writes++;o[k]=v;return true;}});elements.push(this);}
    querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
    set textContent(v){writes++;this.text=v;}get textContent(){return this.text;}
    set innerHTML(v){writes++;this.html=v;}get innerHTML(){return this.html;}
    setAttribute(k,v){writes++;this.attrs[k]=v;}
    removeAttribute(k){writes++;delete this.attrs[k];if(k.startsWith('data-'))delete this.dataset[k.slice(5)];}
    append(){} remove(){} addEventListener(){}
  }
  const document={hidden:false,hasFocus:()=>true,createElement:()=>new Element(),body:new Element(),addEventListener(){}};
  const sandbox={window:{addEventListener(){}},document,AbortController,crypto:require('node:crypto').webcrypto,
    performance:{now:()=>now},matchMedia:()=>({matches:reduced}),MutationObserver:class{observe(){}disconnect(){}},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
    setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout:()=>1,clearTimeout(){}};
  return {sandbox,elements,Element,frames,intervals,writes:()=>writes,
    tick(time){now=time;const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn(now));}};
}
async function usage(){
  const h=harness();
  let data={visits:100,weekVisits:20,browsers:5,clicks:50,trend:Array.from({length:7},(_,i)=>({date:`day${i}`,count:i}))};
  h.sandbox.fetch=async()=>({ok:true,json:async()=>structuredClone(data)});
  vm.runInNewContext(source('usage'),h.sandbox);
  const stop=h.sandbox.window.mountPortalUsage(new h.Element(),{motion:true});
  await stop.refresh();assert.equal(h.frames.size,1,'initial values still animate');
  const panel=h.elements.find(e=>e.className==='orbit-usage');
  h.tick(100);const originalFrame=[...h.frames.keys()][0];
  await stop.refresh();assert.equal([...h.frames.keys()][0],originalFrame,'unchanged poll must preserve in-progress animation');
  for(let t=200;t<=1000;t+=100)h.tick(t);
  assert.equal(panel.querySelector('[data-metric="visits"]').textContent,'100');
  const before=h.writes();await stop.refresh();assert.equal(h.frames.size,0,'settled unchanged counts must not schedule frames');
  assert.equal(h.writes(),before,'unchanged summary must not mutate DOM');
  data={...data,visits:101};await stop.refresh();assert.equal(h.frames.size,1);
  h.tick(1500);h.tick(2000);assert.equal(panel.querySelector('[data-metric="visits"]').textContent,'101');
  assert.equal(panel.querySelector('[data-metric="clicks"]').textContent,'50');
  const previousChart=panel.querySelector('.usage-chart').innerHTML;
  data.trend[6].count=10;await stop.refresh();
  assert.notEqual(panel.querySelector('.usage-chart').innerHTML,previousChart,'changed trends must update');
  assert.match(panel.querySelector('.usage-trend').attrs['aria-label'],/10$/);
  assert.equal(h.frames.size,0,'a trend-only update must not animate unchanged totals');
  stop();assert.equal(h.frames.size,0);
  for(const options of [{motion:false,reduced:false},{motion:true,reduced:true}]){
    const z=harness(options);
    z.sandbox.fetch=async()=>({ok:true,json:async()=>({...data,visits:0,weekVisits:0,browsers:0,clicks:0})});
    vm.runInNewContext(source('usage'),z.sandbox);
    const end=z.sandbox.window.mountPortalUsage(new z.Element(),options);await end.refresh();z.tick(1);
    const zp=z.elements.find(e=>e.className==='orbit-usage');
    for(const key of ['visits','weekVisits','browsers','clicks']){
      assert.equal(zp.querySelector(`[data-metric="${key}"]`).textContent,'0','initial zeros replace loading placeholders');
    }
    assert.equal(z.frames.size,0);end();
  }
  console.log('Usage: initial/in-flight animation, zero DOM writes on unchanged polls, changed totals and motion-off zeros passed');
}
async function player(){
  const h=harness();let name='Viewer',score=5,distance=2,planets=0;
  h.sandbox.fetch=async url=>({ok:true,json:async()=>url==='/api/player'?{name,meteors:score,warpDistance:distance,planetCount:planets,csrf:'test'}:{players:[{name,meteors:score}],warpPlayers:[{name,warpDistance:distance}],planetPlayers:[{name,planetCount:planets}],me:{name,meteors:score,warpDistance:distance,planetCount:planets}}});
  vm.runInNewContext(source('player'),h.sandbox);const p=h.sandbox.window.mountPortalPlayer(new h.Element(),{escape:String});
  await new Promise(resolve=>setImmediate(resolve));
  const hud=h.elements.find(e=>e.className==='player-hud'),board=h.elements.find(e=>e.className==='player-board');
  assert.equal(hud.querySelector('.player-name').textContent,name);assert.equal(hud.querySelector('.player-score-value').textContent,'5');
  const before=h.writes();await h.intervals[0]();assert.equal(h.writes(),before,'unchanged leaderboard and profile must not mutate DOM');
  name='Renamed';score=6;await h.intervals[0]();assert.equal(hud.querySelector('.player-name').textContent,name);assert.equal(hud.querySelector('.player-score-value').textContent,'6');
  assert.match(board.querySelector('ol').innerHTML,/<li class="is-me">.*Renamed/,'new nickname must retain own-row highlight in same response');
  distance=3;await h.intervals[0]();assert.equal(hud.querySelector('.player-distance-value').textContent,'3');
  const distanceBoard=h.elements.find(e=>e.className==='player-board player-board--distance');
  assert.match(distanceBoard.querySelector('ol').innerHTML,/<li class="is-me">.*Renamed.*>3<\/span>/,'distance-only updates retain own-row identity');
  planets=2;await p.refresh();
  assert.equal(hud.querySelector('.player-planets-value').textContent,'2','creation count updates even when the star balance is unchanged');
  const planetBoard=h.elements.find(e=>e.className==='player-board player-board--planets');
  assert.match(planetBoard.querySelector('ol').innerHTML,/<li class="is-me">.*Renamed.*>2<\/span>/,'creation ranking highlights the current player');
  const after=h.writes();await h.intervals[0]();assert.equal(h.writes(),after);p.stop();
  console.log('Player: initial identity, zero DOM writes on unchanged polls, score/name refresh and own-row highlight passed');
}
(async()=>{await usage();await player();})().catch(e=>{console.error(e);process.exitCode=1;});
