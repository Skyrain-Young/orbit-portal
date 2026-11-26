window.mountPortalPlayer=(layout,{escape})=>{
  const events=new AbortController();let disposed=false,csrf='',profile,refreshTimer,retryTimer,flashTimer,scoreFrame=0;
  let displayedScore=0,targetScore=0,profileVersion=0;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const queue=[];let draining=false,drainSettled=Promise.resolve(),settleDrain,warpPending=false,warpSettled=Promise.resolve(),selectingName=false;
  const hud=document.createElement('div');hud.className='player-hud';
  hud.innerHTML='<div class="player-metrics"><span class="player-score" title="Starfall 分数" aria-label="Starfall 计数">☄ <span class="player-score-value">0</span><strong class="player-score-bonus" role="status" aria-live="polite" aria-atomic="true"></strong></span><span class="player-metric-divider" aria-hidden="true"></span><span class="player-distance" title="Warp distance (light-years)" aria-label="Warp distance (light-years)">↗ <span class="player-distance-value">0</span><span class="player-distance-unit">ly</span></span><span class="player-metric-divider" aria-hidden="true"></span><span class="player-planets" title="新建星球数量" aria-label="新建星球数量">⊕ <span class="player-planets-value">0</span></span></div><button class="player-name" type="button" title="点击选择昵称" aria-label="选择昵称">…</button>';
  const scoreValue=hud.querySelector('.player-score-value'),scoreBonus=hud.querySelector('.player-score-bonus'),distanceValue=hud.querySelector('.player-distance-value'),planetValue=hud.querySelector('.player-planets-value'),playerName=hud.querySelector('.player-name');
  layout.append(hud);
  const boards=document.createElement('div');boards.className='player-boards';
  const board=document.createElement('section');board.className='player-board';board.setAttribute('aria-label','STAR leaderboard');
  board.innerHTML='<div class="player-board-title">STAR</div><ol class="player-ranks"></ol>';
  const distanceBoard=document.createElement('section');distanceBoard.className='player-board player-board--distance';distanceBoard.setAttribute('aria-label','JUMP leaderboard');
  distanceBoard.innerHTML='<div class="player-board-title" title="Warp distance (light-years)">JUMP</div><ol class="player-ranks"></ol>';
  const planetBoard=document.createElement('section');planetBoard.className='player-board player-board--planets';planetBoard.setAttribute('aria-label','PLANET leaderboard');
  planetBoard.innerHTML='<div class="player-board-title" title="新建星球数量">PLANET</div><ol class="player-ranks"></ol>';
  boards.append(board,distanceBoard,planetBoard);
  const rankViews=[{node:board.querySelector('ol'),metric:'meteors',html:''},{node:distanceBoard.querySelector('ol'),metric:'warpDistance',html:''},{node:planetBoard.querySelector('ol'),metric:'planetCount',html:''}];
  const renderRanks=(players=[],warpPlayers=[],planetPlayers=[])=>{
    for(const [index,view] of rankViews.entries()){
      const rows=[players,warpPlayers,planetPlayers][index],metric=view.metric;
      const html=Array.from({length:6},(_,i)=>{
        const p=rows[i];
        return `<li class="${!p?'is-empty':p.name===profile?.name?'is-me':''}"><span class="player-place">${i+1}</span><span class="leader-name"${p?` title="${escape(p.name)}"`:''}>${p?escape(p.name):''}</span><span class="leader-score">${p?(p[metric]??0).toLocaleString('en-US'):''}</span></li>`;
      }).join('');
      if(html!==view.html){view.node.innerHTML=html;view.html=html;}
    }
  };
  renderRanks([]);
  // The stats block is mounted later in the portal bootstrap; attach below once ready.
  const attach=()=>{const anchor=layout.querySelector('.orbit-usage');if(anchor){anchor.append(boards);return true;}return false;};
  const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});
  if(!attach())observer.observe(layout,{childList:true});
  const dialog=document.createElement('dialog');dialog.className='layout-catalog player-editor';dialog.setAttribute('aria-label','选择昵称');
  dialog.innerHTML='<form><div class="player-editor-head"><h2>选择昵称</h2><button type="button" aria-label="关闭">×</button></div><input name="name" aria-label="昵称" minlength="2" maxlength="24" required autocomplete="nickname"><p class="player-error" role="alert"></p><button class="player-save">使用此昵称</button></form>';
  document.body.append(dialog);
  const update=(data,{animate=false}={})=>{
    if(disposed)return;profile={...profile,...data};profileVersion+=1;
    if(playerName.textContent!==profile.name)playerName.textContent=profile.name;
    const distance=(profile.warpDistance??0).toLocaleString('en-US');
    if(distanceValue.textContent!==distance)distanceValue.textContent=distance;
    const planets=(profile.planetCount??0).toLocaleString('en-US');
    if(planetValue.textContent!==planets)planetValue.textContent=planets;
    if(targetScore===profile.meteors)return;
    cancelAnimationFrame(scoreFrame);targetScore=profile.meteors;
    const from=displayedScore,start=performance.now();
    const render=time=>{
      const progress=animate&&!reduceMotion.matches?Math.min(1,(time-start)/700):1;
      const value=Math.round(from+(targetScore-from)*(1-Math.pow(1-progress,3)));
      if(displayedScore!==value){displayedScore=value;scoreValue.textContent=value.toLocaleString('en-US');}
      scoreFrame=progress<1?requestAnimationFrame(render):0;
    };
    render(start);
  };
  const flash=burst=>{
    if(hud.dataset.warpStatus&&!burst.critical)return;
    delete hud.dataset.charged;delete hud.dataset.critical;delete hud.dataset.warpStatus;
    scoreBonus.textContent=burst.critical?`+ ${burst.points.toLocaleString('en-US')}`:'';
    // Restart both effects even when two acknowledged bursts arrive close together.
    void hud.offsetWidth;
    hud.dataset.charged='true';if(burst.critical)hud.dataset.critical='true';
    clearTimeout(flashTimer);flashTimer=setTimeout(()=>{delete hud.dataset.charged;delete hud.dataset.critical;scoreBonus.textContent='';},1700);
  };
  const warpStatus=(message,error=false)=>{
    delete hud.dataset.charged;delete hud.dataset.critical;delete hud.dataset.warpStatus;
    scoreBonus.textContent=message;void hud.offsetWidth;hud.dataset.warpStatus=error?'error':'spent';
    clearTimeout(flashTimer);flashTimer=setTimeout(()=>{delete hud.dataset.warpStatus;scoreBonus.textContent='';},1700);
  };
  const getProfile=async()=>{const version=profileVersion,response=await fetch('/api/player',{signal:events.signal});if(!response.ok)throw Error();const data=await response.json();csrf=data.csrf;if(version===profileVersion)update(data);return data;};
  const refresh=async()=>{if(disposed||document.hidden||selectingName)return;const version=profileVersion;try{const r=await fetch('/api/leaderboard',{signal:events.signal});if(!r.ok)return;const data=await r.json();if(disposed||version!==profileVersion)return;
    if(data.me)update(data.me);
    renderRanks(data.players?.slice(0,6)??[],data.warpPlayers?.slice(0,6)??[],data.planetPlayers?.slice(0,6)??[]);
  }catch{}};
  const identityReady=getProfile().catch(()=>{if(!disposed)playerName.textContent='重试连接';});
  const ready=identityReady.then(refresh);
  hud.querySelector('button').onclick=async()=>{await identityReady;if(selectingName)return;if(!profile){try{await getProfile();await refresh();}catch{return;}}
    dialog.querySelector('input').value=profile.name;dialog.querySelector('.player-error').textContent='';dialog.showModal();dialog.querySelector('input').select();};
  dialog.querySelector('[aria-label="关闭"]').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    if(selectingName)return;
    const button=dialog.querySelector('.player-save'),errorLabel=dialog.querySelector('.player-error');
    const name=dialog.querySelector('input').value;
    selectingName=true;button.disabled=true;errorLabel.textContent='';
    try{
      await Promise.all([drainSettled,warpSettled]);
      await getProfile();
      const previousName=profile.name;
      const response=await fetch('/api/player',{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({name}),signal:events.signal});
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      if(data.name!==previousName&&!data.retainedProgress)queue.length=0;
      update(data);dialog.close();
    }catch(error){errorLabel.textContent=error.message||'暂时无法保存';}
    finally{
      selectingName=false;button.disabled=false;
      void refresh();void drain();
    }
  };
  const watching=()=>!document.hidden&&document.hasFocus();
  let focusVersion=0;
  const drain=async()=>{
    if(draining||warpPending||selectingName||disposed||!queue.length)return;draining=true;
    drainSettled=new Promise(resolve=>{settleDrain=resolve;});
    try{
      await ready;if(!profile)await getProfile();
      while(queue.length&&!disposed&&!selectingName){
        const item=queue[0],background=item.source==='background';
        if(background&&(!watching()||item.focusVersion!==focusVersion)){queue.shift();continue;}
        let r;
        try{r=await fetch('/api/player/meteors'+(background?'/background':''),{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(item.burst),keepalive:!background,signal:events.signal});}
        catch(error){if(background){queue.shift();continue;}throw error;}
        if(r.status===403||r.status===401){
          if(background)queue.shift();
          await getProfile();if(background)continue;throw Error('retry');
        }
        if(!r.ok){if(background||(r.status>=400&&r.status<500&&r.status!==429)){queue.shift();continue;}throw Error('retry');}
        const data=await r.json();queue.shift();if(disposed)return;
        update(data,{animate:data.burst?.critical===true});
        if(!data.burst?.duplicate)flash(data.burst??{critical:false});
        await refresh();
      }
    }catch{if(!disposed){clearTimeout(retryTimer);retryTimer=setTimeout(drain,4000);}}finally{draining=false;settleDrain?.();settleDrain=undefined;}
  };
  const attention=()=>{focusVersion+=1;if(watching()){refresh();drain();}};
  document.addEventListener('visibilitychange',attention,{signal:events.signal});
  window.addEventListener('blur',attention,{signal:events.signal});
  window.addEventListener('focus',attention,{signal:events.signal});
  refreshTimer=setInterval(refresh,30000);
  return {
    identityReady,
    refresh:()=>{if(selectingName)return;profileVersion+=1;return getProfile().then(refresh).catch(()=>{});},
    async warp(){
      if(disposed||warpPending||selectingName||!watching()||reduceMotion.matches)return false;
      warpPending=true;const version=focusVersion;
      let settleWarp;
      warpSettled=new Promise(resolve=>{settleWarp=resolve;});
      const active=()=>!disposed&&watching()&&!reduceMotion.matches&&version===focusVersion;
      const event=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      try{
        await ready;
        // Finish acknowledged earnings before spending, then hold later earnings until this request settles.
        await drainSettled;if(!active())return false;
        if(!profile)await getProfile();
        for(let attempt=0;attempt<2;attempt+=1){
          if(!active())return false;
          let response;
          try{response=await fetch('/api/player/warp',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({event}),signal:events.signal});}
          catch(error){if(!attempt&&active())continue;throw error;}
          if((response.status===401||response.status===403)&&!attempt){await getProfile();continue;}
          let data;
          try{data=await response.json();}catch(error){if(!attempt&&active())continue;throw error;}
          if(disposed)return false;
          if(!response.ok){
            if(response.status>=500&&!attempt&&active())continue;
            if(Number.isInteger(data.meteors))update(data);
            if(active())warpStatus(data.code==='insufficient_points'?'积分不足，需 2 分':'暂时无法穿梭',true);
            return false;
          }
          if(data.warp?.event!==event||data.warp.cost!==2||!Number.isInteger(data.meteors))throw Error('warp');
          update(data);void refresh();
          if(!active())return false;
          warpStatus('− 2');return true;
        }
        return false;
      }catch{if(active())warpStatus('连接失败，请重试',true);return false;}
      finally{warpPending=false;settleWarp();if(!disposed)drain();}
    },
    async prepare(count){
      await ready;if(disposed||selectingName)throw Error('player unavailable');if(!profile)await getProfile();
      for(let attempt=0;attempt<2;attempt+=1){
        const response=await fetch('/api/player/meteors/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({count}),signal:events.signal});
        if((response.status===401||response.status===403)&&!attempt){await getProfile();continue;}
        if(!response.ok)throw Error('prepare');return response.json();
      }
    },
    record(burst){if(disposed)return;if(typeof burst==='number'){const event=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');burst={count:burst,event};}if(!Number.isInteger(burst?.count)||burst.count<2||burst.count>5)return;queue.push({source:'hover',burst});drain();},
    recordBackground(){if(disposed||selectingName||!watching())return;const event=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');queue.push({source:'background',focusVersion,burst:{count:1,event}});drain();},
    stop(){disposed=true;events.abort();observer.disconnect();cancelAnimationFrame(scoreFrame);clearInterval(refreshTimer);clearTimeout(retryTimer);clearTimeout(flashTimer);hud.remove();boards.remove();dialog.remove();}};
};
