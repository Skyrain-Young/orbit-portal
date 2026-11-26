/* One continuous velocity field deforms the real orbital image, including
 * individual planet pixels. No independently rotating planet cutouts. */
(() => {
  const vertex=`attribute vec2 position;varying vec2 uv;
    void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
  const fragment=`precision highp float;
    varying vec2 uv;
    uniform sampler2D image;
    uniform vec2 resolution,center;
    uniform float progress,direction,radius,horizon;
    vec4 sampleScene(vec2 p){
      vec2 q=p/resolution;
      if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return vec4(0.);
      // DOM canvas uploads keep their first (top) row at texture v=0.
      return texture2D(image,q);
    }
    void main(){
      vec2 p=vec2(uv.x,1.-uv.y)*resolution-center;
      float r=length(p),angle=atan(p.y,p.x);
      // Early rotation gives way to accelerating infall. The same inverse
      // polar map applies to every pixel of the tracks and planetary surfaces.
      float collapse=max(.012,pow(1.-progress,1.12));
      float sourceRadius=r/collapse;
      float depth=sourceRadius/radius;
      float velocity=.42+1.65/pow(.32+depth,1.3);
      float turn=direction*progress*progress*5.6*velocity;
      float shear=smoothstep(.04,.72,progress);
      float exposure=shear*(.018+.06*progress)*velocity;
      vec4 color=vec4(0.);
      // Curved shutter trails and a small radial diffusion erase the hard
      // planetary silhouette as tidal shear winds it into an accretion arc.
      for(int i=0;i<13;i++){
        float tap=(float(i)-6.)/6.;
        float a=angle-turn+tap*exposure;
        float rr=sourceRadius+sin(float(i)*2.4)*shear*(2.+4.2*progress);
        color+=sampleScene(center+vec2(cos(a),sin(a))*rr)/13.;
      }
      // Alpha is premultiplied when uploading, so faint wisps retain their
      // original color without dark edges or a rectangular framebuffer.
      float edge=smoothstep(horizon*.78,horizon*1.08,r);
      float fade=1.-smoothstep(.88,1.,progress);
      color*=edge*fade;
      color.rgb*=1.+shear*.45;
      gl_FragColor=color;
    }`;

  window.createGalaxyVortex=({scene,center})=>{
    const canvas=document.createElement('canvas');
    canvas.className='galaxy-vortex';canvas.setAttribute('aria-hidden','true');
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'low-power'});
    if(!gl)return null;
    let program,buffer,texture,frame=0,settle,stopped=false,interrupted=false;
    const shaders=[];
    function release(){
      shaders.forEach(shader=>gl.deleteShader(shader));shaders.length=0;
      if(buffer)gl.deleteBuffer(buffer);if(texture)gl.deleteTexture(texture);if(program)gl.deleteProgram(program);
    }
    try{
      const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Vortex shader');return shader;};
      program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Vortex program');
      gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      shaders.forEach(shader=>gl.deleteShader(shader));shaders.length=0;
    }catch{release();gl.getExtension('WEBGL_lose_context')?.loseContext();return null;}
    const uniforms=Object.fromEntries(['image','resolution','center','progress','direction','radius','horizon'].map(name=>[name,gl.getUniformLocation(program,name)]));
    scene.append(canvas);canvas.dataset.renderer='differential-vortex';
    const snapshot=document.createElement('canvas'),brush=snapshot.getContext('2d');
    if(!brush){canvas.remove();release();gl.getExtension('WEBGL_lose_context')?.loseContext();return null;}
    let width,height;
    function capture(){
      const bounds=scene.getBoundingClientRect();width=bounds.width;height=bounds.height;
      const ratio=Math.min(devicePixelRatio||1,1.5,1920/width,1440/height);
      canvas.width=snapshot.width=Math.max(1,Math.round(width*ratio));
      canvas.height=snapshot.height=Math.max(1,Math.round(height*ratio));
      brush.setTransform(ratio,0,0,ratio,0,0);
      // SVG CTMs include both elliptical phase and camera; matching those
      // matrices prevents a jump between the live scene and its flow texture.
      for(const path of scene.querySelectorAll('.orbit-track')){
        const style=getComputedStyle(path),matrix=path.getCTM();
        if(path.style.visibility==='hidden'||!matrix)continue;
        brush.save();brush.transform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);
        brush.globalAlpha=Number(style.opacity);brush.lineWidth=Number.parseFloat(style.strokeWidth)||.8;
        if(path.classList.contains('orbit-track--wide')){
          const gradient=brush.createLinearGradient(0,height,width,0);gradient.addColorStop(0,'#accdff14');gradient.addColorStop(.4,'#bbd9ff4d');gradient.addColorStop(.75,'#d6f0ffa6');gradient.addColorStop(1,'#accdff1f');brush.strokeStyle=gradient;
        }else brush.strokeStyle=style.stroke;
        brush.stroke(new Path2D(path.getAttribute('d')));brush.restore();
      }
      for(const satellite of scene.querySelectorAll('.orbit-satellite')){
        if(satellite.hidden)continue;
        const lens=satellite.querySelector('.orbit-lens'),rect=lens.getBoundingClientRect();
        const x=rect.left-bounds.left,y=rect.top-bounds.top,surface=lens.querySelector('canvas');
        if(surface)brush.drawImage(surface,x,y,rect.width,rect.height);
        else{
          brush.save();brush.strokeStyle='#b6d4ffa6';brush.fillStyle='#8fbcf514';brush.lineWidth=1.25;brush.setLineDash([3,4]);
          brush.beginPath();brush.arc(x+rect.width/2,y+rect.height/2,rect.width/2-.7,0,Math.PI*2);brush.fill();brush.stroke();brush.restore();
          brush.fillStyle='#c6dcfa';brush.font='18px system-ui';brush.textAlign='center';brush.textBaseline='middle';brush.fillText('+',x+rect.width/2,y+rect.height/2);
        }
      }
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,snapshot);
      gl.viewport(0,0,canvas.width,canvas.height);gl.uniform1i(uniforms.image,0);gl.uniform2f(uniforms.resolution,width,height);
      gl.uniform2f(uniforms.center,center.cx,center.cy);gl.uniform1f(uniforms.radius,Math.max(center.rx,center.ry));
      gl.uniform1f(uniforms.horizon,(scene.querySelector('.orbit-blackhole')?.clientHeight||240)*.1705);
    }
    function draw(progress,direction){
      if(stopped||gl.isContextLost())return;
      gl.uniform1f(uniforms.progress,progress);gl.uniform1f(uniforms.direction,direction);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    function finish(){cancelAnimationFrame(frame);frame=0;settle?.();settle=null;}
    const interrupt=()=>{interrupted=true;finish();};
    const resize=new ResizeObserver(()=>{
      if(width&&(scene.clientWidth!==width||scene.clientHeight!==height))interrupt();
    });
    resize.observe(scene);
    canvas.addEventListener('webglcontextlost',interrupt);
    return {
      play(entering=false){
        if(stopped||interrupted||gl.isContextLost())return Promise.resolve();
        capture();
        const direction=entering?-1:1;
        draw(entering?1:0,direction);
        scene.dataset.vortex='true';
        return new Promise(resolve=>{
          settle=resolve;const start=performance.now();
          function tick(now){
            const t=Math.min(1,(now-start)/375);
            // Entry decelerates into the same original orbital coordinates.
            const progress=entering?Math.pow(1-t,1.45):Math.pow(t,1.18);
            draw(progress,direction);
            if(t<1)frame=requestAnimationFrame(tick);else finish();
          }
          frame=requestAnimationFrame(tick);
        });
      },
      finish,
      stop(){stopped=true;finish();resize.disconnect();delete scene.dataset.vortex;canvas.remove();release();gl.getExtension('WEBGL_lose_context')?.loseContext();snapshot.width=snapshot.height=1;}
    };
  };
})();
