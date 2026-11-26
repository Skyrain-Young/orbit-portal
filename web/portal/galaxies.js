/* Shared galaxy navigation, orbital travel and seat creation. */
window.mountGalaxyNavigation=({resume,prepareTravel,hole,layout,scene,apps,groups,layouts,apply,geometry,points,accelerate,motion})=>{
  const events=new AbortController(),{signal}=events;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  reduced.addEventListener('change',()=>{if(reduced.matches)vortex?.finish();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)vortex?.finish();},{signal});
  const names={main:'主星系',business:'业务',dev:'开发',other:'其他'};
  let current='main',traveling=false,disposed=false,vortex=null,selectedSeat='',replaceAppId=null,requestId='',submitting=false;
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const menu=document.createElement('nav');menu.className='galaxy-menu';menu.setAttribute('aria-label','选择星系');
  menu.innerHTML=Object.entries(names).map(([key,label])=>`<button type="button" data-galaxy="${key}" aria-current="${key===current?'true':'false'}">${label}</button>`).join('');hole.append(menu);
  const trigger=hole.querySelector('button');trigger.setAttribute('aria-label','选择星系');trigger.addEventListener('click',()=>hole.toggleAttribute('data-menu-open'),{signal});
  hole.addEventListener('pointerleave',()=>hole.removeAttribute('data-menu-open'),{signal});
  hole.addEventListener('keydown',event=>{if(event.key==='Escape'){hole.removeAttribute('data-menu-open');trigger.blur();}},{signal});
  const dialog=document.createElement('dialog');dialog.className='galaxy-add';dialog.setAttribute('aria-label','添加应用');
  dialog.innerHTML=`<form><header><h2>添加应用</h2><button type="button" data-close aria-label="关闭添加应用">×</button></header><div class="galaxy-add-tabs"><button type="button" data-mode="existing" aria-pressed="true">已有应用</button><button type="button" data-mode="new" aria-pressed="false">新链接 · 100 ☄</button></div><div data-existing><select aria-label="选择已有应用" name="existing"></select></div><div data-new hidden><input name="url" type="url" aria-label="应用链接" placeholder="粘贴应用链接" maxlength="2048"><input name="name" aria-label="应用名称" placeholder="应用名称" maxlength="80"><select name="group" aria-label="应用分类">${Object.entries(groups).map(([key,label])=>`<option value="${escape(key)}">${escape(label)}</option>`).join('')}</select></div><p role="alert"></p><button type="submit" class="galaxy-add-submit">放入轨道</button></form>`;
  document.body.append(dialog);
  let mode='existing';const form=dialog.querySelector('form'),submit=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]');
  function setMode(next){mode=next;form.querySelector('[data-existing]').hidden=next!=='existing';form.querySelector('[data-new]').hidden=next!=='new';form.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));submit.textContent=next==='new'?'创建 · 100 ☄':replaceAppId?'替换应用':'放入轨道';error.textContent='';requestId='';}
  form.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode),{signal}));
  form.addEventListener('input',()=>{requestId='';},{signal});
  form.querySelector('[data-close]').addEventListener('click',()=>{if(!submitting)dialog.close();},{signal});
  dialog.addEventListener('close',()=>resume(),{signal});
  dialog.addEventListener('cancel',e=>{if(submitting)e.preventDefault();},{signal});
  async function change(next){
    if(next===current||traveling||submitting||disposed||layout.hasAttribute('data-transitioning')||dialog.open)return;
    traveling=true;hole.removeAttribute('data-menu-open');trigger.blur();layout.dataset.galaxyTravel='true';
    layout.querySelector('.orbit-layout-toggle').disabled=true;menu.querySelectorAll('button').forEach(b=>b.disabled=true);accelerate();
    prepareTravel();
    const canAnimate=()=>motion()&&!document.hidden;
    const showNext=()=>{
      current=next;apply(layouts[current]);layout.dataset.galaxy=current;
      menu.querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',String(b.dataset.galaxy===current)));
    };
    try{
      if(canAnimate())vortex=window.createGalaxyVortex?.({scene,center:geometry()});
      if(vortex)await vortex.play();
      if(disposed)return;
      showNext();
      if(vortex&&canAnimate()){
        hole.classList.add('galaxy-whitehole');
        await vortex.play(true);
      }
    }catch{
      // A lost graphics context must never strand navigation or hide the apps.
      if(!disposed&&current!==next)showNext();
    }
    finally{
      vortex?.stop();vortex=null;hole.classList.remove('galaxy-whitehole');
      delete layout.dataset.galaxyTravel;
      layout.querySelector('.orbit-layout-toggle').disabled=false;
      menu.querySelectorAll('button').forEach(b=>b.disabled=false);
      traveling=false;resume();
    }
  }
  menu.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>change(button.dataset.galaxy),{signal}));
  scene.addEventListener('click',event=>{
    const anchor=event.target.closest('[data-vacancy],[data-replace-seat]');if(!anchor)return;event.preventDefault();
    if(traveling||submitting||layout.hasAttribute('data-transitioning'))return;
    selectedSeat=anchor.dataset.replaceSeat||anchor.dataset.vacancy;
    replaceAppId=anchor.dataset.replaceSeat?layouts[current][selectedSeat]:null;
    const title=replaceAppId?'替换应用':'添加应用';
    dialog.setAttribute('aria-label',title);form.querySelector('h2').textContent=title;
    form.querySelector('[data-close]').setAttribute('aria-label','关闭'+title);
    form.reset();requestId='';setMode('existing');
    const occupied=new Set(Object.values(layouts[current]));
    const available=apps.filter(a=>a.id!==replaceAppId).sort((a,b)=>Number(occupied.has(a.id))-Number(occupied.has(b.id)));
    form.elements.existing.innerHTML='<option value="">选择应用</option>'+available.map(a=>`<option value="${escape(a.id)}" ${occupied.has(a.id)?'disabled':''}>${escape(a.name)}${occupied.has(a.id)?' · 已在当前星系':''}</option>`).join('');
    form.elements.group.value={business:'business',dev:'dev',other:'external'}[current]||Object.keys(groups)[0];
    dialog.showModal();
  },{signal});
  form.elements.url.addEventListener('change',()=>{try{const u=new URL(form.elements.url.value);if(!form.elements.name.value)form.elements.name.value=u.hostname;}catch{}},{signal});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submitting)return;
    const payload={galaxy:current,seat:selectedSeat,event:requestId||Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')};requestId=payload.event;
    if(replaceAppId)payload.replaceAppId=replaceAppId;
    if(mode==='existing'){if(!form.elements.existing.value){error.textContent='请选择应用';return;}payload.appId=form.elements.existing.value;}
    else{payload.url=form.elements.url.value;payload.name=form.elements.name.value;payload.group=form.elements.group.value;}
    submitting=true;submit.disabled=true;error.textContent='';
    try{
      const identity=await fetch('/api/player').then(r=>r.json());
      const response=await fetch('/api/galaxies/applications',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':identity.csrf},body:JSON.stringify(payload),signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'添加失败，请重试');
      if(!apps.some(a=>a.id===result.app.id))apps.push(result.app);
      layouts[current][selectedSeat]=result.app.id;apply(layouts[current]);dialog.close();layout.dispatchEvent(new Event('dio:application-added',{bubbles:true}));
      const born=points().find(p=>p.seat===selectedSeat);
      if(born&&motion()){born.anchor.classList.add('galaxy-birth');born.anchor.addEventListener('animationend',()=>born.anchor.classList.remove('galaxy-birth'),{once:true,signal});}
    }catch(e){if(e.name!=='AbortError')error.textContent=e.message;}
    finally{submitting=false;submit.disabled=false;}
  },{signal});
  return {stop(){disposed=true;events.abort();vortex?.stop();menu.remove();dialog.remove();}};
};
