/* Procedural spherical surfaces: local, deterministic, no external image assets. */
window.mountLegacyPlanetSurfaces=root=>{
  const hash=(x,y,z,seed)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^seed;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;};
  const fade=t=>t*t*(3-2*t),mix=(a,b,t)=>a+(b-a)*t;
  const noise=(x,y,z,seed)=>{const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),a=fade(x-ix),b=fade(y-iy),c=fade(z-iz);return mix(mix(mix(hash(ix,iy,iz,seed),hash(ix+1,iy,iz,seed),a),mix(hash(ix,iy+1,iz,seed),hash(ix+1,iy+1,iz,seed),a),b),mix(mix(hash(ix,iy,iz+1,seed),hash(ix+1,iy,iz+1,seed),a),mix(hash(ix,iy+1,iz+1,seed),hash(ix+1,iy+1,iz+1,seed),a),b),c);};
  const fbm=(x,y,z,s)=>noise(x,y,z,s)*.55+noise(x*2,y*2,z*2,s)*.27+noise(x*5,y*5,z*5,s)*.12+noise(x*13,y*13,z*13,s)*.06;
  const profiles={core:{type:'ocean',base:[28,93,128],land:[107,126,84],seed:13},git:{type:'rock',base:[148,72,44],land:[203,142,90],seed:28},doc:{type:'moon',base:[111,115,123],land:[192,195,193],seed:52},week:{type:'gas',base:[128,102,71],land:[219,190,147],seed:19},flow:{type:'gas',base:[89,84,127],land:[180,162,185],seed:72},gpu:{type:'ice',base:[52,108,137],land:[140,198,208],seed:35},bi:{type:'ocean',base:[32,59,114],land:[76,119,100],seed:47},seek:{type:'moon',base:[100,85,70],land:[179,162,133],seed:94}};
  root.querySelectorAll('.planet-surface').forEach(canvas=>{
    const p=profiles[canvas.dataset.surface],ctx=canvas.getContext('2d');if(!ctx||!p)return;
    const size=224,image=ctx.createImageData(size,size),data=image.data;
    const craters=Array.from({length:18},(_,i)=>({x:hash(i,0,0,p.seed)*1.7-.85,y:hash(i,1,0,p.seed)*1.7-.85,r:.035+hash(i,2,0,p.seed)*.15}));
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const nx=(x+.5-size/2)/(size/2-1),ny=(y+.5-size/2)/(size/2-1),r2=nx*nx+ny*ny;if(r2>1)continue;
      const nz=Math.sqrt(1-r2),u=nx*3+12,v=ny*3+9,w=nz*3+7,n=fbm(u,v,w,p.seed);
      let tone=n,cloud=0,crater=1;
      if(p.type==='gas')tone=.5+.28*Math.sin(ny*34+n*13)+.16*Math.sin(ny*79+n*8);
      if(p.type==='ice')tone=.35+n*.5+.08*Math.sin(ny*55+n*10);
      if(p.type==='ocean'){tone=Math.max(0,Math.min(1,(n-.49)*12));cloud=Math.max(0,(fbm(u*2+8,v*2,w*2,p.seed+3)-.57)*4);}
      if(p.type==='moon')for(const c of craters){const d=Math.hypot(nx-c.x,ny-c.y)/c.r;if(d<1.12)crater*=d<.82?.67+Math.max(0,ny-c.y)*2:1.18;}
      const light=Math.max(0,nx*-.48+ny*-.5+nz*.72),diffuse=.055+.945*Math.pow(light,.8),rim=Math.pow(1-nz,3);
      for(let c=0;c<3;c++){let color=mix(p.base[c],p.land[c],Math.max(0,Math.min(1,tone)));color=mix(color,225,Math.min(.7,cloud));color*=crater;const atmosphere=p.type==='ocean'||p.type==='ice'?[36,85,137][c]*rim*Math.max(.05,light):0;data[(y*size+x)*4+c]=Math.min(255,color*diffuse+atmosphere);}
      data[(y*size+x)*4+3]=Math.min(255,(1-r2)*14000);
    }
    ctx.putImageData(image,0,0);
  });
};
