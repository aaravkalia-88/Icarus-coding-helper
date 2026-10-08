/* global THREE, REDUCE, RIG, WORLD, LOW, cvs, tx, vpW, vpH, scene, camera, renderer, clock, running, tPrev, queue, clamp, damp, cancelSceneFrame */
/* eslint-disable no-unused-vars -- functions are injected into Kage's existing boot/update loop. */
// ICARUS presentation on the verified Kage rig, damping, renderer and lifecycle.
let ICARUS_PROGRESS = 0;
let ICARUS_HERO_PROGRESS = 0;
let ICARUS_PAUSED = false;
let ICARUS_ART = null;
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'icarus-world') return;
  const value = event.data;
  if (Number.isFinite(value.progress)) ICARUS_PROGRESS = clamp(value.progress, 0, 1);
  if (Number.isFinite(value.heroProgress)) ICARUS_HERO_PROGRESS = clamp(value.heroProgress, 0, 1);
  if (!REDUCE && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    RIG.tmx = clamp(value.x, -1, 1); RIG.tmy = clamp(value.y, -1, 1);
  }
  if (typeof value.paused === 'boolean') {
    ICARUS_PAUSED = value.paused;
    if (ICARUS_PAUSED) { running = false; cancelSceneFrame(); }
    else if (window.__kage?.renderer && !document.hidden && !running) {
      running = true; tPrev = performance.now(); queue();
    }
  }
});

function icarusSculpturePose(progress, heroProgress, reduced) {
  if (reduced) return { open: 1, fall: 0, opacity: .56 };
  const ease = value => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
  };
  const open = ease((heroProgress - .12) / .58);
  const fall = ease((progress - .27) / .25);
  return { open, fall, opacity: .72 - fall * .35 };
}

function buildIcarusWorld() {
  scene.fog = null;
  scene.background = new THREE.Color(0x555e5b);
  const texture = new THREE.TextureLoader().load('/icarus-sky.webp');
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const uniforms = {
    uArt: { value: texture }, uT: WORLD.uT,
    uProgress: { value: 0 }, uPointer: { value: new THREE.Vector2() },
    uResolution: { value: new THREE.Vector2(vpW(), vpH()) },
  };
  const material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uArt;
      uniform vec2 uResolution, uPointer;
      uniform float uT, uProgress;
      void main(){
        vec2 uv=vUv;
        float aspect=uResolution.x/uResolution.y;
        float imageAspect=1080./931.;
        if(aspect>imageAspect) uv.y=1.-(1.-uv.y)*imageAspect/aspect;
        else uv.x=(uv.x-.5)*aspect/imageAspect+.5;
        float depth=sin(uProgress*3.14159);
        uv=(uv-.5)/(1.025+depth*.055)+.5;
        uv+=uPointer*vec2(.006,.004);
        uv.y-=uProgress*.035;
        vec2 sun=vec2(.575,.97);
        float nearSun=exp(-length(uv-sun)*13.);
        float heat=exp(-pow((uProgress-.24)*6.,2.));
        uv.x+=sin(uv.y*45.+uT*.7)*.0015*nearSun*heat;
        uv.y+=sin(uT*.08+uv.x*6.)*.0025;
        vec3 art=texture2D(uArt,clamp(uv,0.,1.)).rgb;
        vec3 cloud=texture2D(uArt,clamp(uv+vec2(sin(uT*.04)*.014,cos(uT*.035)*.009),0.,1.)).rgb;
        float cloudMask=smoothstep(.55,.8,dot(cloud,vec3(.299,.587,.114)));
        art=mix(art,cloud,cloudMask*.11);
        art+=vec3(.19,.12,.035)*nearSun*heat;
        float rebuild=exp(-pow((uProgress-.75)*5.,2.));
        art*=1.-rebuild*.27;
        art=mix(art,art*vec3(.88,.97,1.02),uProgress*.15);
        gl_FragColor=vec4(art,1.);
      }
    `,
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  plate.frustumCulled = false;
  plate.renderOrder = -10;
  scene.add(plate);

  const feather = cvs(64, 160), ctx = feather.getContext('2d');
  ctx.strokeStyle = 'rgba(242,225,187,.68)'; ctx.lineWidth = 1.2;
  ctx.fillStyle = 'rgba(237,223,190,.19)';
  ctx.beginPath(); ctx.moveTo(31,151); ctx.bezierCurveTo(3,103,7,39,34,8); ctx.bezierCurveTo(61,56,57,112,31,151); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(31,156); ctx.lineTo(34,16);
  for(let i=0;i<8;i++){const y=35+i*12;ctx.moveTo(33,y+12);ctx.lineTo(15,y);ctx.moveTo(33,y+12);ctx.lineTo(51,y-1);}
  ctx.stroke();
  const featherTexture=tx(feather);
  const count = LOW ? 24 : 56;
  const base = new THREE.PlaneGeometry(1, 1, 1, LOW ? 12 : 24);
  const ribbons = new THREE.InstancedBufferGeometry().copy(base);
  base.dispose();
  ribbons.instanceCount = count;
  ribbons.setAttribute('aFeather', new THREE.InstancedBufferAttribute(Float32Array.from({length:count}, (_,i)=>(i+.5)/count), 1));
  const sculptureUniforms = {
    uTex:{value:featherTexture}, uOpen:{value:0}, uFall:{value:0},
    uTime:{value:0}, uOpacity:{value:.72}, uAspect:{value:vpW()/vpH()},
    uScale:{value:1}, uCenter:{value:new THREE.Vector2(.37,.08)}, uPointer:{value:new THREE.Vector2()},
  };
  const sculpture = new THREE.Mesh(ribbons, new THREE.ShaderMaterial({
    transparent:true, depthTest:false, depthWrite:false, side:THREE.DoubleSide,
    uniforms:sculptureUniforms,
    vertexShader:`
      attribute float aFeather;
      uniform float uOpen,uFall,uTime,uAspect,uScale;
      uniform vec2 uCenter,uPointer;
      varying vec2 vUv;
      varying float vLight;
      void main(){
        vUv=uv;
        float t=uv.y, angle=aFeather*6.283185;
        float bend=sin(t*3.14159+angle)*.13;
        vec3 gathered=vec3(sin(angle)*(.055+t*.16)+bend*.32,
          .76-t*1.38+cos(angle)*.06,cos(angle)*.18);
        gathered.x+=position.x*.04;
        float arc=angle+t*.46+bend;
        float radius=.29+t*.34+sin(angle*3.)*.025;
        vec3 opened=vec3(cos(arc)*radius,sin(arc)*radius,
          sin(angle*2.+t*1.7)*.16);
        opened.xy+=vec2(-sin(arc),cos(arc))*position.x*.067;
        float drift=sin(angle+uTime*.08)*.6;
        vec2 small=vec2(position.x*.045,(t-.5)*.14);
        small=mat2(cos(drift),-sin(drift),sin(drift),cos(drift))*small;
        vec3 falling=vec3(sin(angle*3.17+aFeather*6.3)*uAspect*1.28,
          1.1-fract(aFeather*1.618+uTime*(.018+aFeather*.016))*2.2-uFall*.45,
          cos(angle)*.25);
        falling.xy+=small;
        vec3 p=mix(mix(gathered,opened,uOpen),falling,uFall);
        float perspective=1.+p.z*.24;
        vec2 projected=p.xy/perspective;
        projected.x/=uAspect;
        projected*=uScale;
        projected+=uCenter*(1.-uFall)+uPointer*.008;
        vLight=.56+.44*pow(abs(cos(arc+.7)),3.);
        gl_Position=vec4(projected,0.,1.);
      }
    `,
    fragmentShader:`
      varying vec2 vUv;
      varying float vLight;
      uniform sampler2D uTex;
      uniform float uOpacity;
      void main(){
        vec4 ink=texture2D(uTex,vUv);
        if(ink.a<.01)discard;
        vec3 gold=mix(vec3(.43,.31,.16),vec3(.98,.83,.52),vLight);
        gl_FragColor=vec4(gold,ink.a*uOpacity);
      }
    `,
  }));
  sculpture.frustumCulled=false;
  sculpture.renderOrder=2;
  scene.add(sculpture);
  ICARUS_ART={uniforms,sculptureUniforms,hero:0,lastTime:clock};
  addEventListener('pagehide',()=>{
    running=false;cancelSceneFrame();
    scene.traverse(object=>{
      object.geometry?.dispose();
      const materials=Array.isArray(object.material)?object.material:[object.material];
      materials.filter(Boolean).forEach(m=>m.dispose());
    });
    texture.dispose();featherTexture.dispose();renderer.dispose();
  },{once:true});
}

function updateIcarusWorld() {
  if(!ICARUS_ART)return;
  const {uniforms,sculptureUniforms}=ICARUS_ART;
  uniforms.uResolution.value.set(vpW(),vpH());
  uniforms.uProgress.value=REDUCE?0:RIG.smooth/5;
  uniforms.uPointer.value.set(REDUCE?0:RIG.mx,REDUCE?0:RIG.my);
  uniforms.uT.value=REDUCE?0:clock;
  const dt=Math.min(.05,Math.max(0,clock-ICARUS_ART.lastTime));
  ICARUS_ART.lastTime=clock;
  ICARUS_ART.hero=REDUCE?1:damp(ICARUS_ART.hero,ICARUS_HERO_PROGRESS,5.2,dt);
  const pose=icarusSculpturePose(RIG.smooth/5,ICARUS_ART.hero,REDUCE);
  const aspect=vpW()/vpH(), narrow=vpW()<700;
  sculptureUniforms.uOpen.value=pose.open;
  sculptureUniforms.uFall.value=pose.fall;
  sculptureUniforms.uOpacity.value=pose.opacity;
  sculptureUniforms.uTime.value=REDUCE?0:clock;
  sculptureUniforms.uAspect.value=aspect;
  sculptureUniforms.uScale.value=narrow?Math.min(.62,aspect*.6):1;
  sculptureUniforms.uCenter.value.set(narrow?0:.37,narrow?.40:.08);
  sculptureUniforms.uPointer.value.copy(uniforms.uPointer.value);
}
