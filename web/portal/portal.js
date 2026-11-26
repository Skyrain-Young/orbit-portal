(async () => {
  const root=document.querySelector('#prototype');
  let stage=root.querySelector('#layout-stage');
  const revealArrival=()=>{if(root.hasAttribute('data-arrival'))root.dataset.arrival='revealing';};
  const completeArrival=()=>{root.removeAttribute('data-arrival');if(stage)stage.inert=false;root.removeAttribute('aria-busy');};
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link=(app,html=escape(app.name),className='')=>`<a class="${escape(className)}" data-app-id="${escape(app.id)}" href="${escape(app.url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
  try {
    const response=await fetch('/api/catalog'); if(!response.ok)throw Error();
    const {apps,groups,slots,site}=await response.json();
    const galaxyResponse=await fetch('/api/galaxies');if(!galaxyResponse.ok)throw Error('星系加载失败');
    const {layouts:galaxies}=await galaxyResponse.json();
    document.title=site.title;
    root.classList.toggle('motion-off',!site.motion);
    if(!stage){root.innerHTML='<div class="mist-light" aria-hidden="true"><div class="mist-wash"></div><canvas class="mist-stars"></canvas></div><div id="layout-stage" inert></div>';stage=root.querySelector('#layout-stage');}
    const arrival=site.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.inert=arrival;
    if(arrival)root.dataset.arrival='travel';
    const catalog=window.createLayoutCatalog({apps,groups,link,escape});
    let stopStars;
    const stopOrbit=window.dioLayouts.orbit({root:stage,apps,link,escape,onBackgroundPause:paused=>stopStars?.setPaused?.(paused),icon:window.dioPrototypeIcon,slots,site:{...site,planetScale:2/3,blackHole:true,galaxies,groups}});
    const player=window.mountPortalPlayer(root.querySelector('.orbit-layout'),{escape});
    const refreshPlayer=()=>player.refresh?.();
    root.addEventListener('dio:application-added',refreshPlayer);
    let stopSurfaces=window.mountPlanetSurfaces(root);
    const refreshSurfaces=()=>{stopSurfaces?.();stopSurfaces=window.mountPlanetSurfaces(root);};
    root.addEventListener('dio:surfaces',refreshSurfaces);
    stopStars=site.motion ? window.mountSpaceStars(root.querySelector('canvas'), {arrival,onArrivalReveal:revealArrival,onArrivalComplete:completeArrival,starDensity:site.starDensity,meteorIntervalMin:site.meteorIntervalMin,meteorIntervalMax:site.meteorIntervalMax,exclude:()=>{const region=root.querySelector('.orbit-usage');if(!region)return;const boxes=[region,...region.querySelectorAll('.player-board')].map(node=>node.getBoundingClientRect());const left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top)),right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));return {left,top,right,bottom,width:right-left,height:bottom-top};},prepareMeteorBurst:count=>player.prepare(count),onMeteorBurst:burst=>player.record(burst),onBackgroundMeteor:()=>player.recordBackground(),onWarp:()=>player.warp()}) : null;
    root.addEventListener('click',event=>{
      // Pointer clicks must not leave homepage controls armed for the next Space.
      const control=event.target.closest?.('button,a[href]');
      if(event.detail>0&&control===document.activeElement)control.blur();
    });
    document.addEventListener('keydown',event=>{
      if(event.defaultPrevented||root.hasAttribute('data-arrival'))return;
      if(document.querySelector('dialog[open]')&&!catalog.dialog.open)return;
      const editing=event.target.closest?.('input,textarea,select,[contenteditable],[role="textbox"]');
      const composing=event.isComposing||event.keyCode===229||event.key==='Process'||event.key==='Dead';
      if(composing){if(!catalog.dialog.open&&!editing&&!event.metaKey&&!event.ctrlKey&&!event.altKey)catalog.open();return;}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();catalog.open();return;}
      if(catalog.dialog.open||editing||event.metaKey||event.ctrlKey||event.altKey)return;
      if(event.code==='Space'||event.key===' '){event.preventDefault();if(!event.repeat)catalog.open();return;}
      if([...event.key].length===1&&event.key.trim()){event.preventDefault();catalog.open('all',event.key);}
    });
    let visitor='';
    try{visitor=localStorage.getItem('dio-visitor')||'';if(!/^[a-f0-9]{32}$/.test(visitor)){visitor=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');localStorage.setItem('dio-visitor',visitor);}}catch{}
    const record=event=>player.identityReady.then(()=>fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),keepalive:true})).catch(()=>{});
    const stopUsage=window.mountPortalUsage(root.querySelector('.orbit-layout'), {motion:site.motion});
    record({kind:'visit',visitor}).finally(()=>stopUsage.refresh());
    const click=event=>{if(event.type==='auxclick'&&event.button!==1)return;const anchor=event.target.closest('a[data-app-id]');if(anchor)record({kind:'click',app:anchor.dataset.appId}).finally(()=>stopUsage.refresh());};
    document.addEventListener('click',click);document.addEventListener('auxclick',click);
    window.addEventListener('pagehide',event=>{if(!event.persisted){stopOrbit?.();stopStars?.();stopUsage?.();stopSurfaces?.();root.removeEventListener('dio:surfaces',refreshSurfaces);root.removeEventListener('dio:application-added',refreshPlayer);player.stop();}},{once:true});
    if(!arrival)completeArrival();
  }catch(error){completeArrival();root.innerHTML='<div class="portal-error"><p>暂时无法加载应用目录</p><button type="button">重新加载</button></div>';root.querySelector('button').onclick=()=>location.reload();}
})();
