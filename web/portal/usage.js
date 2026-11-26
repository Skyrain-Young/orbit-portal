/* Public aggregate only; detailed analytics stay in /admin. */
window.mountPortalUsage = (layout, {motion}) => {
  const panel=document.createElement('section');
  panel.className='orbit-usage';
  panel.setAttribute('aria-label','累计访问统计及近7天访问');
  panel.dataset.demo='false';
  panel.innerHTML=`<div class="usage-horizon" aria-hidden="true"><span></span></div>
    <div class="usage-primary"><span class="usage-period" title="近7天访问数"><span>7D</span><span data-metric="weekVisits">—</span></span></div>
    <svg class="usage-trend" viewBox="0 0 260 108" role="img" aria-label="近7天每日访问星链图"><g class="usage-chart"></g></svg>
    <div class="usage-secondary"><div><span class="usage-number" data-metric="visits" title="累计总访问数">—</span><span class="usage-label">VISITS</span></div><div><span class="usage-number" data-metric="browsers">—</span><span class="usage-label" title="累计独立浏览器，按匿名标识去重">VISITORS</span></div><div><span class="usage-number" data-metric="clicks">—</span><span class="usage-label" title="累计应用启动次数">LAUNCHES</span></div></div>`;
  layout.append(panel);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const controller=new AbortController();
  const keys=['visits','weekVisits','browsers','clicks'];
  const metrics=Object.fromEntries(keys.map(key=>[key,panel.querySelector(`[data-metric="${key}"]`)]));
  const chart=panel.querySelector('.usage-chart'),trend=panel.querySelector('.usage-trend');
  const values=new Map(),targets=new Map();let frame=0,disposed=false,inFlight=false;
  const animate=data=>{
    // A poll during an existing count-up must not restart the same animation.
    if(keys.every(key=>targets.get(key)===data[key]))return;
    cancelAnimationFrame(frame);
    const starts={};const end={};
    for(const key of keys){starts[key]=values.get(key)||0;end[key]=data[key];targets.set(key,data[key]);}
    const start=performance.now();
    const step=now=>{
      const t=!motion||reduce.matches?1:Math.min(1,(now-start)/1000);
      for(const key of keys){const value=Math.round(starts[key]+(end[key]-starts[key])*(1-Math.pow(1-t,3)));if(values.get(key)!==value){values.set(key,value);metrics[key].textContent=value.toLocaleString('en-US');}}
      frame=t<1&&!disposed?requestAnimationFrame(step):0;
    };
    frame=requestAnimationFrame(step);
  };
  const refresh=async()=>{
    if(disposed||document.hidden||inFlight)return;
    inFlight=true;
    try{
      const response=await fetch('/api/usage/summary',{signal:controller.signal});
      if(!response.ok)throw Error();
      const data=await response.json();
      if(disposed)return;
      animate(data);
      const rows=data.trend.slice(-7);
      // Avoid restarting the traveling light when a refresh returns unchanged data.
      const chartKey=JSON.stringify(rows);
      if(panel.dataset.chart!==chartKey){
        const max=Math.max(1,...rows.map(row=>row.count));
        const points=rows.map((row,i)=>({x:10+i*40,y:76-row.count/max*55,count:row.count,date:row.date}));
        const path='M'+points.map(p=>`${p.x},${p.y.toFixed(1)}`).join(' L');
        const segments=points.slice(1).map((p,i)=>`<path class="usage-chain-pulse" style="--i:${i}" d="M${points[i].x},${points[i].y} L${p.x},${p.y}"/>`).join('');
        const stars=points.map((p,i)=>`<g class="usage-chart-star" style="--i:${i}" transform="translate(${p.x} ${p.y})"><title>Day ${i+1}: ${p.count}</title><circle class="usage-star-halo" r="9"/><path class="usage-star-flare" d="M-6 0H6 M0-6V6"/><circle class="usage-star-core" r="2"/></g><text class="usage-day" x="${p.x}" y="103">${String(i+1).padStart(2,'0')}</text>`).join('');
        chart.innerHTML=`<path class="usage-chain-base" d="${path}"/>${segments}${stars}`;
        trend.setAttribute('aria-label',`近7天每日访问：${rows.map(r=>r.count).join('、')}`);
        panel.dataset.chart=chartKey;
      }
      if(panel.dataset.ready!=='true')panel.dataset.ready='true';
      if(panel.dataset.unavailable)panel.removeAttribute('data-unavailable');
    }catch(error){if(!disposed){panel.dataset.unavailable='true';panel.dataset.ready='true';}}
    finally{inFlight=false;}
  };
  const timer=setInterval(refresh,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();},{signal:controller.signal});
  const stop=()=>{disposed=true;controller.abort();clearInterval(timer);cancelAnimationFrame(frame);panel.remove();};
  stop.refresh=refresh;
  return stop;
};
