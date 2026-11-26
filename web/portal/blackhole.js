/* Selected circular halo, promoted from the local visual study. */
(() => {
  const vertex=`attribute vec2 position;varying vec2 uv;
    void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
  const fragment=`precision highp float;
    varying vec2 uv;
    uniform vec2 resolution;
    uniform float time,flowTravel,burstEnergy;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=noise(p)*a;p=mat2(1.62,1.17,-1.17,1.62)*p+.37;a*=.5;}return v;}
    float gaussian(float x,float w){return exp(-x*x/(w*w));}
    float flowingTexture(float angle,float depth,float travel){
      // Angular speed falls continuously with radius: the innermost gas leads.
      float speed=.65+3.95*exp(-max(depth,0.)*20.);
      float a=angle+travel*speed;
      vec2 around=vec2(cos(a),sin(a));
      // Long tangential wisps, with finer variation across the width of the halo.
      return fbm(around*3.2+vec2(depth*83.,depth*47.));
    }
    vec3 circularHalo(float r,float angle,float shadow){
      float depth=r-shadow;
      // Two overlapping flow fields fade before each reset. This avoids both a
      // visible phase jump and endlessly winding the radial shear into tight lines.
      float cycle=fract(flowTravel*.25);
      float phaseA=cycle*4.-2.,phaseB=fract(cycle+.5)*4.-2.;
      float weightA=1.-abs(cycle*2.-1.);
      float texture=mix(flowingTexture(angle,depth,phaseB),flowingTexture(angle,depth,phaseA),weightA);
      float wisps=smoothstep(.29,.68,texture);
      // The crescent's lighting direction stays fixed; only its fine gas texture flows.
      float side=.5+.5*cos(angle-2.18),bright=pow(side,4.4);
      float breath=1.+.10*sin(time*.67+.6);
      float edge=.008+.0015*sin(time*.67);
      float rim=gaussian(depth-edge,.0029+.0022*bright);
      float shoulder=gaussian(depth-edge-.010,.016*breath);
      vec3 pearl=mix(vec3(.36,.49,.72),vec3(1.,.88,.69),bright);
      vec3 light=pearl*(rim*(.055+bright*2.8)*(.52+.48*wisps)+shoulder*bright*.23);
      float atmosphere=gaussian(depth-.045,.046*breath);
      vec3 mist=mix(vec3(.20,.32,.59),vec3(.64,.76,1.),wisps);
      light+=mist*atmosphere*(.055+.19*wisps*wisps)*(.45+.55*side);
      float filament=gaussian(depth-.032,.0045)*smoothstep(.42,.66,texture);
      light+=vec3(.70,.79,1.)*filament*(.08+.17*side);
      // A circular falloff is the entire silhouette: no nebular band or radial tails.
      light*=breath*(1.+burstEnergy*.13)*(1.-smoothstep(.105,.18,depth));
      return light;
    }
    void main(){
      vec2 p=(uv-.5)*2.;p.x*=resolution.x/resolution.y;
      float r=length(p),shadow=.341;
      float outside=smoothstep(shadow-.001,shadow+.003,r);
      vec3 light=circularHalo(r,atan(p.y,p.x),shadow)*outside;
      vec3 color=vec3(1.)-exp(-light*1.55);
      float alpha=max((1.-outside)*.999,clamp(max(color.r,max(color.g,color.b))*1.42,0.,1.));
      gl_FragColor=vec4(color/max(alpha,.001),alpha);
    }`;
  window.createPortalBlackHole=(canvas,{motion=true}={})=>{
    const events=new AbortController(),{signal}=events;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false,powerPreference:'low-power'});
    let program,buffer,uniforms,frame=0,previous=0,time=0,travel=0,energy=0,age=1.5,duration=1.5,active=true,alive=true;
    const shaders=[];
    const ease=t=>t*t*t*(10+t*(-15+6*t));
    const animated=()=>motion&&!reduced.matches;
    function release(){
      if(!gl)return;
      shaders.forEach(shader=>gl.deleteShader(shader));shaders.length=0;
      if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);
    }
    function fallback(){cancelAnimationFrame(frame);frame=0;canvas.dataset.renderer='unavailable';canvas.hidden=true;}
    try{
      if(!gl)throw Error('WebGL unavailable');
      function compile(type,source){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Shader compilation failed');return shader;}
      const v=compile(gl.VERTEX_SHADER,vertex),f=compile(gl.FRAGMENT_SHADER,fragment);
      program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Shader link failed');
      gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      uniforms=Object.fromEntries(['resolution','time','flowTravel','burstEnergy'].map(name=>[name,gl.getUniformLocation(program,name)]));
      shaders.forEach(shader=>gl.deleteShader(shader));shaders.length=0;
      canvas.dataset.renderer='webgl-circular-halo';
    }catch{release();gl?.getExtension('WEBGL_lose_context')?.loseContext();gl=null;fallback();}
    canvas.dataset.flowState='idle';
    function draw(){
      if(!gl||!alive||!active||document.hidden)return;
      gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);
      gl.uniform1f(uniforms.time,time);gl.uniform1f(uniforms.flowTravel,travel);gl.uniform1f(uniforms.burstEnergy,energy);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    function tick(now){
      frame=0;if(!gl||!alive||!active||document.hidden)return;
      if(!previous||now-previous>=1000/30){
        const dt=previous?Math.min(.1,(now-previous)/1000):0;previous=now;
        time+=dt;travel+=dt*.085;
        if(age<duration){const before=age/duration;age=Math.min(duration,age+dt);const t=age/duration;travel+=(ease(t)-ease(before))*2.8;energy=16*t*t*(1-t)*(1-t);if(age===duration)canvas.dataset.flowState='idle';}
        travel%=4;draw();
      }
      if(animated())frame=requestAnimationFrame(tick);
    }
    function request(){if(gl&&alive&&active&&!document.hidden&&animated()&&!frame)frame=requestAnimationFrame(tick);}
    function resize(){const r=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5,700/Math.max(1,r.width),450/Math.max(1,r.height));canvas.width=Math.max(1,Math.round(r.width*ratio));canvas.height=Math.max(1,Math.round(r.height*ratio));draw();request();}
    function visibility(){cancelAnimationFrame(frame);frame=0;previous=0;draw();request();}
    function preference(){if(!animated()){age=duration;energy=0;canvas.dataset.flowState='idle';}visibility();}
    const observer=new ResizeObserver(resize);observer.observe(canvas);
    document.addEventListener('visibilitychange',visibility,{signal});reduced.addEventListener('change',preference,{signal});
    canvas.addEventListener('webglcontextlost',()=>{release();gl=null;fallback();},{signal});resize();
    return {
      setActive(value){if(active===!!value)return;active=!!value;visibility();},
      accelerate(seconds=1.5){
        if(!gl||!animated()||(age<duration&&seconds>=duration))return;
        // A click during camera return can queue the effect until drawing resumes.
        duration=Math.max(.1,Math.min(1.5,seconds));age=0;energy=0;
        canvas.dataset.flowState='flowing';request();
      },
      destroy(){alive=false;cancelAnimationFrame(frame);observer.disconnect();events.abort();release();gl?.getExtension('WEBGL_lose_context')?.loseContext();}
    };
  };
})();
