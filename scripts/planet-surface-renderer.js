/* Offline-only planet surface renderer, preserved from Planet study V3 (soft illumination). Texture maps: Solar System Scope / INOVE, CC BY 4.0.
 * Sources and adaptation notes: /assets/textures/README.md
 * Spherical projection and lighting are rendered locally; no external requests.
 */
window.renderPlanetSurfaces=root=>{
  const events=new AbortController();
  let disposed=false;
  const profiles={
    core:{map:'earth_daymap',clouds:true,kind:'ocean',longitude:-.18,tilt:-23,phase:.56,air:[.09,.28,.65]},
    git:{map:'mars',kind:'regolith',longitude:1.3,tilt:17,phase:.4},
    doc:{map:'moon',kind:'regolith',longitude:.25,tilt:-12,phase:.32},
    week:{map:'jupiter',kind:'gas',longitude:2.1,tilt:-11,phase:.6,air:[.27,.2,.11]},
    flow:{map:'saturn',kind:'gas',longitude:-.8,tilt:25,phase:.52,air:[.26,.21,.14]},
    gpu:{map:'uranus',kind:'gas',longitude:.5,tilt:67,phase:.44,air:[.1,.3,.38]},
    bi:{map:'neptune',kind:'gas',longitude:1.6,tilt:-21,phase:.66,air:[.06,.16,.55]},
    seek:{map:'venus_surface',kind:'regolith',longitude:-1.9,tilt:8,phase:.48},
  };
  const linear=Float32Array.from({length:256},(_,i)=>{
    const c=i/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);
  });
  const encode=c=>Math.round(Math.max(0,Math.min(1,c<=.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-.055))*255);
  const textures=new Map();
  const load=name=>{
    if(!textures.has(name))textures.set(name,(async()=>{
      const response=await fetch(`/assets/textures/2k_${name}.jpg`,{signal:events.signal});
      if(!response.ok)throw Error('Texture unavailable');
      const bitmap=await createImageBitmap(await response.blob());
      try{
        if(disposed)throw Error('Disposed');
        const surface=document.createElement('canvas');surface.width=1024;surface.height=512;
        const context=surface.getContext('2d',{willReadFrequently:true});
        context.drawImage(bitmap,0,0,surface.width,surface.height);
        return {pixels:context.getImageData(0,0,surface.width,surface.height).data,width:surface.width,height:surface.height};
      }finally{bitmap.close();}
    })());
    return textures.get(name);
  };
  // Bilinear sampling wraps longitude and clamps latitude at the poles.
  const sample=(texture,u,v,out)=>{
    const {pixels,width,height}=texture;
    const fx=((u%1+1)%1)*width-.5,fy=Math.max(0,Math.min(height-1,v*(height-1)));
    const ix=Math.floor(fx),iy=Math.floor(fy),a=fx-ix,b=fy-iy;
    const x0=(ix+width)%width,x1=(x0+1)%width,y1=Math.min(height-1,iy+1);
    const p00=(iy*width+x0)*4,p10=(iy*width+x1)*4,p01=(y1*width+x0)*4,p11=(y1*width+x1)*4;
    for(let c=0;c<3;c++)out[c]=
      (linear[pixels[p00+c]]*(1-a)+linear[pixels[p10+c]]*a)*(1-b)+
      (linear[pixels[p01+c]]*(1-a)+linear[pixels[p11+c]]*a)*b;
  };
  const render=(canvas,p,texture,clouds)=>{
    if(disposed||!canvas.isConnected)return;
    const size=256,radius=size/2-.75,context=canvas.getContext('2d');
    if(!context)return;
    canvas.width=canvas.height=size;
    const image=context.createImageData(size,size),pixels=image.data;
    const tilt=p.tilt*Math.PI/180,ct=Math.cos(tilt),st=Math.sin(tilt),cl=Math.cos(p.longitude),sl=Math.sin(p.longitude);
    const sunLength=Math.hypot(-.8,.45,p.phase),lx=-.8/sunLength,ly=.45/sunLength,lz=p.phase/sunLength;
    // A broad, softly weighted source makes the terminator gradual without
    // blurring the photographic surface itself. This is an artistic UI light.
    const tangentLength=Math.hypot(lx,ly),ux=-ly/tangentLength,uy=lx/tangentLength;
    const vx=-lz*uy,vy=lz*ux,vz=lx*uy-ly*ux;
    const lights=[{x:lx,y:ly,z:lz,weight:.18}];
    for(const [angle,weight,offset] of [[.14,.09,0],[.32,.28/6,.5]]){
      for(let i=0;i<6;i++){
        const a=(i+offset)*Math.PI/3,c=Math.cos(a),s=Math.sin(a);
        lights.push({x:lx*Math.cos(angle)+(ux*c+vx*s)*Math.sin(angle),
          y:ly*Math.cos(angle)+(uy*c+vy*s)*Math.sin(angle),
          z:lz*Math.cos(angle)+vz*s*Math.sin(angle),weight});
      }
    }
    const color=[0,0,0],cloud=[0,0,0];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const nx=(x+.5-size/2)/radius,ny=-(y+.5-size/2)/radius,r2=nx*nx+ny*ny;
      if(r2>=1)continue;
      const nz=Math.sqrt(1-r2),mu0=Math.max(0,nx*lx+ny*ly+nz*lz);
      // Tilt and rotate the surface in 3D before mapping longitude / latitude.
      const tx=ct*nx+st*ny,ty=-st*nx+ct*ny,tz=nz;
      const sx=cl*tx+sl*tz,sz=-sl*tx+cl*tz;
      const u=.5+Math.atan2(sx,sz)/(2*Math.PI),v=.5-Math.asin(Math.max(-1,Math.min(1,ty)))/Math.PI;
      sample(texture,u,v,color);
      let light=.003;
      for(const source of lights){
        const m=Math.max(0,nx*source.x+ny*source.y+nz*source.z);
        const scattering=m/(m+nz+.0001);
        light+=source.weight*(p.kind==='regolith'?.32*m+.68*1.5*scattering:.98*m);
      }
      let cover=0;
      if(clouds){sample(clouds,u+.015,v,cloud);cover=Math.min(.82,Math.pow(cloud[0],.7)*.78);}
      const edge=Math.pow(1-nz,7)*Math.pow(mu0,.65);
      const offset=(y*size+x)*4;
      for(let c=0;c<3;c++){
        const albedo=color[c]*(1-cover)+[.76,.79,.82][c]*cover;
        const air=p.air?p.air[c]*edge*.07:0;
        pixels[offset+c]=encode(albedo*light+air);
      }
      pixels[offset+3]=Math.round(Math.min(1,(1-Math.sqrt(r2))*radius)*255);
    }
    context.putImageData(image,0,0);
    canvas.dataset.material='photo-v3-soft';
  };
  root.querySelectorAll('.planet-surface').forEach(canvas=>{
    const p=profiles[canvas.dataset.surface];if(!p)return;
    Promise.all([load(p.map),p.clouds?load('earth_clouds').catch(()=>null):null])
      .then(([texture,clouds])=>render(canvas,p,texture,clouds))
      .catch(()=>{if(!disposed)canvas.dataset.material='legacy-fallback';});
  });
  return ()=>{disposed=true;events.abort();textures.clear();};
};
