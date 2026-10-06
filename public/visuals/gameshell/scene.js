import * as THREE from 'three';
import {toCreasedNormals, mergeGeometries} from './vendor/BufferGeometryUtils.js';

// A geometric reconstruction of the supplied exploded handheld photograph.
// Parts share one assembly axis; interrupted hover transitions keep their velocity.
const host = document.querySelector('#handheld');
const panel = host.closest('.panel');
const status = panel.querySelector('.assembly-status');
const hint = panel.querySelector('.assembly-hint');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Build in short slices, handing the main thread back to the page between them;
// this document shares a thread with the landing page, so one long build froze scrolling.
const yieldToPage=()=>new Promise(resolve=>setTimeout(resolve,0));
// Start the key-mesh downloads now so they arrive while the casing is being built.
const keyData=Object.fromEntries(['dpad','button-a','button-b','button-x','button-y'].map(name=>[name,
  fetch(new URL('./gameshell-assets/'+name+'.bin',import.meta.url)).then(r=>{if(!r.ok)throw Error('Key geometry failed: '+name);return r.arrayBuffer();})]));
for(const pending of Object.values(keyData))pending.catch(()=>{}); // surfaced when awaited below
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch {
  host.classList.add('unavailable');
  hint.textContent = '3D preview requires WebGL';
  throw new Error('WebGL is unavailable');
}
// Supersample fine product details even on standard-density displays.
renderer.setPixelRatio(2);
renderer.setClearColor(0xf6f6f6, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.append(renderer.domElement);
renderer.domElement.setAttribute('aria-hidden', 'true');
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 80);
camera.position.set(9, -7, 12);
camera.lookAt(0, .25, 0);
const pmrem = new THREE.PMREMGenerator(renderer);
// Product-photo studio: broad softboxes and dark flags produce real reflections
// across the existing surfaces, without painted-on highlights or extra parts.
const room = new THREE.Scene();
room.background = new THREE.Color(0x424240);
function softbox(w,h,position,intensity,color=0xffffff) {
  const material=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide});
  material.color.multiplyScalar(intensity);
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);
  panel.position.set(...position);panel.lookAt(0,0,0);room.add(panel);
}
softbox(5,10,[-6,5,7],2.4,0xfffdf9);
softbox(3,7,[-5,-2,10],1.7,0xf7f7f5);
softbox(2,9,[7,2,4],1.8,0xf1f1ee);
softbox(7,3,[0,8,-3],2.2);
softbox(6,8,[1,0,10],.55);
softbox(3,10,[-8,0,-2],.04);
const environment = pmrem.fromScene(room, .018);
scene.environment = environment.texture;
scene.environmentIntensity = 1.0;
room.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
pmrem.dispose();
await yieldToPage();
scene.add(new THREE.HemisphereLight(0xf6f6f3, 0x474743, .65));
const key = new THREE.DirectionalLight(0xfffdf9, 1.8);
key.position.set(-4, 8, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -8, right: 8, top: 9, bottom: -9, near: .1, far: 35 });
key.shadow.bias = -.0003;
key.shadow.normalBias = .012;
key.shadow.radius = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0xf0f0ed, .9);
rim.position.set(7, 2, -5);
scene.add(rim);

function grainTexture() {
  const size = 128, data = new Uint8Array(size * size * 4);
  let seed = 29;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 115 + (seed % 27);
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 8);
  t.needsUpdate = true;
  return t;
}
const micrograin = grainTexture();
const alloy = new THREE.MeshPhysicalMaterial({ color: 0xc4b69e, metalness: .72, roughness: .38, clearcoat: .16, clearcoatRoughness:.3, envMapIntensity:.72, bumpMap:micrograin, bumpScale:.003 });
const edge = new THREE.MeshStandardMaterial({ color: 0x817462, metalness: .94, roughness: .22 });
const bright = new THREE.MeshStandardMaterial({ color: 0xdfd3be, metalness: .9, roughness: .26 });
const black = new THREE.MeshPhysicalMaterial({ color: 0x1d1a16, metalness: 0, roughness: .48, envMapIntensity:.25, clearcoat: .08, clearcoatRoughness:.32, bumpMap:micrograin, bumpScale:.0015 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x2b2721, roughness: .94, bumpMap:micrograin, bumpScale:.004 });
// Alpha-blended resin with a clearcoat. Physical `transmission` was dropped: its
// extra full-scene pass hung the GPU on Windows/ANGLE and the page never painted.
const glass = new THREE.MeshPhysicalMaterial({ color: 0xe2d5bd, metalness: 0, roughness: .085, transparent: true, opacity: .20, depthWrite: false, clearcoat:.5, clearcoatRoughness:.12, side:THREE.DoubleSide });
const smoke = new THREE.MeshPhysicalMaterial({ color: 0xa0927c, metalness: 0, roughness: .12, transparent: true, opacity: .24, depthWrite: false, clearcoat:.35, clearcoatRoughness:.16, side:THREE.DoubleSide });
const pcbMat = new THREE.MeshPhysicalMaterial({ color: 0x353028, metalness: .12, roughness: .52, clearcoat:.22, bumpMap:micrograin,bumpScale:.002 });
const copper = new THREE.MeshStandardMaterial({ color: 0xb9a78b, metalness: .88, roughness: .28 });
const screenMat = new THREE.MeshStandardMaterial({color:0x242019,metalness:.18,roughness:.42,envMapIntensity:.15});
glass.forceSinglePass = smoke.forceSinglePass = true;

// Fine directional tool marks on the shield; moulded shell and rubber use finer grain.
const brushed=micrograin.clone();brushed.repeat.set(.14,38);brushed.needsUpdate=true;
const shieldMetal=alloy.clone();shieldMetal.roughness=.34;shieldMetal.bumpMap=brushed;shieldMetal.bumpScale=.002;

const device = new THREE.Group();
device.rotation.z = -.14;
scene.add(device);
const parts = [];
function assemblyPart(name, position, offset) {
  const group = new THREE.Group();
  group.name = name;
  group.userData.home = new THREE.Vector3(...position);
  group.userData.offset = new THREE.Vector3(...offset);
  group.position.copy(group.userData.home).add(group.userData.offset);
  parts.push(group);
  device.add(group);
  return group;
}
function rounded(w, h, r, x = 0, y = 0, hole = false) {
  const s = hole ? new THREE.Path() : new THREE.Shape();
  const l = x-w/2, b = y-h/2;
  s.moveTo(l+r,b); s.lineTo(l+w-r,b); s.quadraticCurveTo(l+w,b,l+w,b+r);
  s.lineTo(l+w,b+h-r); s.quadraticCurveTo(l+w,b+h,l+w-r,b+h);
  s.lineTo(l+r,b+h); s.quadraticCurveTo(l,b+h,l,b+h-r);
  s.lineTo(l,b+r); s.quadraticCurveTo(l,b,l+r,b);
  return s;
}
function circleHole(x,y,r) {
  const p=new THREE.Path();
  // The speaker perforations occupy only a few screen pixels: twelve segments
  // preserve their visible outline without tessellating each into eighty sides.
  if(r<.04){for(let i=0;i<12;i++){const a=-i*Math.PI/6;const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;i?p.lineTo(px,py):p.moveTo(px,py);}p.closePath();}
  else p.absarc(x,y,r,0,Math.PI*2,true);
  return p;
}
function crossShape(x,y,size=.73,hole=false) {
  const s=hole?new THREE.Path():new THREE.Shape(), a=size/2, b=size*.17;
  const pts=[[-b,-a],[b,-a],[b,-b],[a,-b],[a,b],[b,b],[b,a],[-b,a],[-b,b],[-a,b],[-a,-b],[-b,-b]];
  pts.forEach(([u,v],i)=>i?s.lineTo(x+u,y+v):s.moveTo(x+u,y+v));s.closePath();return s;
}
function solid(shape, depth, material, parent, z=0, bevel=.016) {
  const outline=shape.getPoints(1),extent=Math.max(...outline.map(p=>p.x))-Math.min(...outline.map(p=>p.x));
  const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSegments:extent>2?6:4,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:extent>2?32:12});
  geo.translate(0,0,-depth/2);
  if(bevel>0){const flat=geo.attributes.normal.array.slice();geo.scale(100,100,100);toCreasedNormals(geo,Math.PI*.38);geo.scale(.01,.01,.01);for(const g of geo.groups)if(g.materialIndex===0)for(let i=g.start*3;i<(g.start+g.count)*3;i++)geo.attributes.normal.array[i]=flat[i];}
  const m=new THREE.Mesh(geo,material);m.position.z=z;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function plate(w,h,r,depth,mat,parent,x=0,y=0,z=0) { return solid(rounded(w,h,r,x,y),depth,mat,parent,z); }
function box(w,h,d,mat,parent,x,y,z) { const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m; }
function disc(radius, depth, mat, parent, x,y,z, segments=64) { const m=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,depth,segments),mat);m.rotation.x=Math.PI/2;m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m; }
function screw(parent,x,y,z,scale=1) { disc(.045*scale,.025,bright,parent,x,y,z);box(.052*scale,.009,.007,black,parent,x,y,z+.015);box(.009,.052*scale,.007,black,parent,x,y,z+.016); }
function label(parent,text,x,y,z,w,h,color='#343a36',font='600 64px Arial') {
  const c=document.createElement('canvas');c.width=768;c.height=Math.max(64,Math.round(768*h/w));const ctx=c.getContext('2d');
  ctx.font=font.replace(/\d+px/,`${Math.round(c.height*.64)}px`);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,c.width/2,c.height/2,c.width-14);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));m.position.set(x,y,z);parent.add(m);return m;
}
function wire(parent,coords,mat=copper,radius=.009) {
  const curve=new THREE.CatmullRomCurve3(coords.map(p=>new THREE.Vector3(...p)));
  const m=new THREE.Mesh(new THREE.TubeGeometry(curve,12,radius,5,false),mat);parent.add(m);return m;
}

// Eight independently assembled modules, following the supplied GameShell image.
await yieldToPage();
const face=assemblyPart('Front shell',[0,0,.43],[-.38,.42,3.65]);
const shape=rounded(3.02,5.05,.22);
shape.holes.push(rounded(2.40,1.98,.065,0,1.24,true));
shape.holes.push(crossShape(-.76,-.67,.79,true));
const buttons=[[.73,-.40,'X'],[1.04,-.73,'A'],[.42,-.73,'Y'],[.73,-1.06,'B']];
buttons.forEach(([x,y])=>shape.holes.push(circleHole(x,y,.159)));
const smallKeys=[[-.93,.06],[-.54,.06],[.27,.06],[.69,.06]];
smallKeys.forEach(([x,y])=>shape.holes.push(rounded(.27,.13,.063,x,y,true)));
for(let row=0;row<5;row++)for(let col=0;col<16;col++){
  const x=(col-7.5)*.14,y=-1.63-row*.11;
  if(Math.abs(x)<1.10-row*.045)shape.holes.push(circleHole(x,y,.022));
}
solid(shape,.075,alloy,face,0,.012);
const faceWall=rounded(3.02,5.05,.22);faceWall.holes.push(rounded(2.89,4.92,.17,0,0,true));solid(faceWall,.33,alloy,face,-.18,.015);
const badge=rounded(.86,.17,.08,0,2.37);badge.holes.push(rounded(.80,.12,.055,0,2.37,true));solid(badge,.009,edge,face,.052,.002);
label(face,'OUTLIO',0,2.37,.056,.74,.105,'#515552');
for(const x of [-1.27,1.27]){
  plate(.035,1.55,.015,.023,bright,face,x,1.28,.058);
  for(const y of [.45,2.10])screw(face,x,y,.059,.48);
}
for(const [x,y] of [[-1.30,-2.22],[1.30,-2.22]])screw(face,x,y,.051,.65);
label(face,'MENU  SELECT',-.73,.24,.050,.69,.085,'#646662','500 45px Arial');
label(face,'START',.49,.25,.05,.44,.075,'#646662','500 45px Arial');
for(let i=0;i<4;i++)box(.027,.11,.1,edge,face,1.51,-1.9+i*.90,-.12);
box(.09,.14,.13,bright,face,1.52,1.69,-.12);
// Moulded attachment lugs and corner bosses are visible from the exploded side.
for(const x of [-1.38,1.38])for(const y of [-2.22,2.24]){disc(.07,.17,alloy,face,x,y,-.15);disc(.025,.012,black,face,x,y,-.055)}

function caseRim(parent,w,h,r,z,material=glass,depth=.18){const a=rounded(w,h,r);a.holes.push(rounded(w-.11,h-.11,Math.max(.025,r-.025),0,0,true));return solid(a,depth,material,parent,z,.012)}
function casePosts(parent,w,h,z){for(const x of [-w/2+.10,w/2-.10])for(const y of [-h/2+.10,h/2-.10]){disc(.059,.17,glass,parent,x,y,z-.035);screw(parent,x,y,z+.045,.48)}}
function casing(parent,w,h,depth=.20){plate(w,h,.09,.032,glass,parent,0,0,-depth/2);caseRim(parent,w,h,.09,0,glass,depth);casePosts(parent,w,h,depth/2-.03)}
function outlineLine(parent,w,h,r,z,mat=bright){const a=rounded(w,h,r);a.holes.push(rounded(w-.024,h-.024,r-.008,0,0,true));solid(a,.009,mat,parent,z,.002)}

await yieldToPage();
const display=assemblyPart('LCD module',[0,1.24,.225],[-.16,.20,1.98]);
casing(display,2.64,2.18,.17);
plate(2.54,2.08,.04,.065,edge,display,0,0,.01);
plate(2.41,1.95,.025,.018,rubber,display,0,0,.056);
plate(2.30,1.82,.022,.018,screenMat,display,0,0,.077);
// A sharp monochrome boot screen: vector-drawn mark, no blur or glow.
const bootBase=document.createElement('canvas');bootBase.width=1024;bootBase.height=768;
const bootCtx=bootBase.getContext('2d');bootCtx.fillStyle='#eceee9';
const cx=512,cy=285,radius=128,gap=5;
bootCtx.beginPath();bootCtx.arc(cx-gap,cy,radius,Math.PI/2,Math.PI*1.5);bootCtx.closePath();bootCtx.fill();
bootCtx.beginPath();bootCtx.arc(cx+gap,cy,radius,-Math.PI/2,Math.PI/2);bootCtx.closePath();bootCtx.fill();
const textBase=document.createElement('canvas');textBase.width=1024;textBase.height=768;
const textCtx=textBase.getContext('2d');textCtx.fillStyle='#eceee9';textCtx.font='500 112px Arial';textCtx.textAlign='center';textCtx.textBaseline='middle';textCtx.fillText('Outlio',512,525);
const bootTexture=new THREE.CanvasTexture(bootBase);bootTexture.colorSpace=THREE.SRGBColorSpace;
bootTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
const bootMaterial=new THREE.MeshBasicMaterial({map:bootTexture,transparent:true,depthWrite:false,toneMapped:false});
const bootScreen=new THREE.Mesh(new THREE.PlaneGeometry(2.05,1.54),bootMaterial);
bootScreen.position.set(0,0,.103);bootScreen.visible=false;display.add(bootScreen);
const textTexture=new THREE.CanvasTexture(textBase);textTexture.colorSpace=THREE.SRGBColorSpace;
textTexture.anisotropy=bootTexture.anisotropy;
const textMaterial=bootMaterial.clone();textMaterial.map=textTexture;
const screenName=new THREE.Mesh(bootScreen.geometry,textMaterial);screenName.position.copy(bootScreen.position);screenName.visible=false;display.add(screenName);
let bootStarted=-1,bootTimer=0;
function stopBlink(){clearTimeout(bootTimer);bootTimer=0;}
function updateBoot(now){
  if(assembled!==1||target!==1){
    stopBlink();bootScreen.visible=screenName.visible=false;bootStarted=-1;
    if(host.dataset.screenState!=='off')host.dataset.screenState='off';return;
  }
  if(bootStarted<0)bootStarted=now;
  const elapsed=now-bootStarted,phase=elapsed%5000;
  const dropout=!reduced.matches&&elapsed>=5000&&phase<110;
  screenName.visible=true;bootScreen.visible=!dropout;
  if(!reduced.matches&&!bootTimer&&visible&&!document.hidden){
    const delay=dropout?110-phase:5000-phase;
    bootTimer=setTimeout(()=>{bootTimer=0;wake();},Math.max(1,delay+1));
  }
  const screenState=dropout?'logo-off':'ready';
  if(host.dataset.screenState!==screenState)host.dataset.screenState=screenState;
}

outlineLine(display,2.52,2.055,.04,.06,bright);
for(const x of [-1.285,1.285])box(.021,1.8,.06,bright,display,x,0,.07);
box(.20,.075,.12,edge,display,1.32,-.70,0);
box(.42,.39,.013,copper,display,.5,-1.16,-.045);
for(let i=0;i<11;i++)box(.009,.35,.004,edge,display,.33+i*.03,-1.16,-.033);

await yieldToPage();
const mainboard=assemblyPart('Mainboard enclosure',[0,.52,-.09],[.10,.15,.17]);
casing(mainboard,2.64,1.83,.23);
const internalMetal=alloy.clone();internalMetal.color.set(0x9b8c75);internalMetal.roughness=.25;
plate(2.44,1.61,.065,.027,internalMetal,mainboard,0,0,-.07);
plate(.79,.59,.03,.07,black,mainboard,-.60,.27,.001);
plate(.52,.43,.02,.06,black,mainboard,.36,.32,.009);
for(let i=0;i<13;i++){box(.025,.06,.019,bright,mainboard,-.94+i*.055,.60,.01);box(.025,.06,.019,bright,mainboard,-.94+i*.055,-.04,.01)}
for(let i=0;i<11;i++)box(.11,.075,.036,i%3?black:bright,mainboard,-1.1+i*.215,-.52,.01);
for(let i=0;i<5;i++)box(.025,.24,.07,black,mainboard,1.32,.55-i*.30,.01);
for(const [x,y] of [[-1.30,.27],[-1.30,-.45],[.5,.89]])box(.2,.16,.12,edge,mainboard,x,y,0);
// The shallow raised maker badge is on the transparent enclosure lid.
const maker=rounded(1.54,.32,.13,0,-.16);maker.holes.push(rounded(1.48,.265,.11,0,-.16,true));solid(maker,.01,glass,mainboard,.144,.004);
label(mainboard,'CLOCKWORK',0,-.16,.151,1.37,.22,'#777c78','600 60px Arial');
for(const x of [-1.20,1.20])box(.028,1.41,.045,bright,mainboard,x,0,.14);

await yieldToPage();
const controls=assemblyPart('Keypad module',[0,-.67,.22],[-.10,-.22,1.84]);
casing(controls,2.68,1.88,.20);
plate(2.43,1.62,.055,.024,pcbMat,controls,0,0,-.08);
outlineLine(controls,2.66,1.86,.08,.12,bright);
disc(.49,.035,rubber,controls,-.76,0,.045);
for(const [x,y] of buttons)disc(.19,.03,rubber,controls,x,y+.67,.05);
// Original ClockworkPi geometry, extracted from their GPL-3.0 STL. No sprue.
async function originalKey(name,x,y,z){
  const buffer=await keyData[name];await yieldToPage();
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer),3));geometry.computeVertexNormals();geometry.scale(100,100,100);toCreasedNormals(geometry,Math.PI/4);geometry.scale(.01,.01,.01);
  const mesh=new THREE.Mesh(geometry,black);mesh.position.set(x,y,z);if(name!=='dpad')mesh.rotation.z=Math.PI*1.5;mesh.castShadow=true;mesh.receiveShadow=true;controls.add(mesh);
}
await Promise.all([originalKey('dpad',-.76,0,.070),...buttons.map(([x,y,char])=>originalKey(({X:'button-a',A:'button-y',Y:'button-b',B:'button-x'})[char],x,y+.67,.165))]);
for(const [x,y] of smallKeys){plate(.26,.12,.055,.13,black,controls,x,y+.67,.245);disc(.145,.025,rubber,controls,x,y+.67,.015)}
label(controls,'GAME',.13,.32,.13,.49,.12,'#959b96','600 48px Arial');
for(const x of [-1.24,1.24])for(const y of [-.81,.81])disc(.055,.25,glass,controls,x,y,.01);

await yieldToPage();
const battery=assemblyPart('Battery module',[0,-1.02,-.08],[.10,-.13,-.30]);
casing(battery,2.63,1.69,.28);
plate(2.31,1.34,.08,.18,internalMetal,battery,0,0,-.01);
plate(2.08,1.12,.08,.016,black,battery,0,0,.098);
label(battery,'CLOCKWORK',0,.20,.111,1.45,.17,'#666d68','500 60px Arial');
label(battery,'RECHARGEABLE Li-ion',0,-.02,.112,1.42,.09,'#656d67','400 42px Arial');
label(battery,'3.7V   1200mAh',0,-.20,.112,1.14,.09,'#656d67','400 42px Arial');
wire(battery,[[1.10,.55,.05],[1.18,.64,.09],[1.12,.86,.02]],black,.018);
box(.17,.11,.08,bright,battery,1.13,.72,.045);

await yieldToPage();
const io=assemblyPart('Speaker module',[0,-2.05,-.03],[.025,-.36,.86]);
casing(io,2.55,.43,.15);plate(2.31,.29,.025,.035,pcbMat,io,0,0,-.025);
for(let i=0;i<2;i++){plate(.77,.19,.022,.045,black,io,-.60+i*1.02,0,.02);for(let j=0;j<8;j++)box(.01,.12,.02,bright,io,-.91+i*1.02+j*.09,0,.05)}
for(let i=0;i<6;i++)box(.07,.05,.02,bright,io,-.99+i*.38,.13,.015);

await yieldToPage();
const rear=assemblyPart('Rear casing',[0,0,-.14],[.35,-.38,-1.86]);
plate(3.02,5.05,.22,.038,smoke,rear,0,0,-.18);
caseRim(rear,3.02,5.05,.22,0,smoke,.39);
outlineLine(rear,3.035,5.065,.22,.195,edge);
outlineLine(rear,2.89,4.92,.18,-.13,bright);
for(const x of [-1.38,1.38])for(const y of [-2.26,-1.05,.07,1.08,2.25]){
  box(.12,.048,.28,glass,rear,x,y,-.018);
  disc(.066,.29,glass,rear,x,y,-.025);disc(.026,.025,edge,rear,x,y,.13);
}
const batterySeam=rounded(2.58,1.82,.08,0,-1.16);batterySeam.holes.push(rounded(2.55,1.79,.07,0,-1.16,true));solid(batterySeam,.008,edge,rear,-.153,.002);
for(let i=0;i<5;i++)box(.66,.024,.018,glass,rear,0,-1.5+i*.085,-.145);
label(rear,'CLOCKWORK',0,.36,-.145,1.42,.19,'#5c635e','600 62px Arial');
plate(.29,.08,.026,.06,glass,rear,0,-2.19,-.13);
box(.22,.09,.12,edge,rear,1.44,1.75,.015);

await yieldToPage();
const cap=assemblyPart('Case lock',[1.53,1.71,.20],[.57,1.06,-1.465]);
const capRing=new THREE.Shape();capRing.absarc(0,0,.18,0,Math.PI*2);capRing.holes.push(circleHole(0,0,.10));solid(capRing,.115,black,cap,0,.007);
for(let i=0;i<22;i++){const a=i*Math.PI/11;const tooth=box(.022,.046,.12,black,cap,Math.cos(a)*.181,Math.sin(a)*.181,0);tooth.rotation.z=a;}
box(.23,.063,.047,bright,cap,0,0,.065);box(.14,.019,.011,black,cap,0,0,.096);

// Batch stationary opaque details within each moving module. Shapes and normals
// remain unchanged; each shared material now costs one draw call per module.
for(const part of parts){
  await yieldToPage();
  const batches=new Map();
  for(const child of [...part.children]){
    if(!child.isMesh||Array.isArray(child.material)||child.material.transparent)continue;
    const key=child.material;
    if(!batches.has(key))batches.set(key,[]);
    batches.get(key).push(child);
  }
  for(const [material,meshes] of batches){
    if(meshes.length<2)continue;
    const geometries=meshes.map(mesh=>{
      mesh.updateMatrix();let g=mesh.geometry.clone();
      if(g.index){const plain=g.toNonIndexed();g.dispose();g=plain;}
      if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
      g.applyMatrix4(mesh.matrix);return g;
    });
    // Non-indexed merge: re-welding ~300k identical vertices only changed indexing,
    // never shading, and was the longest single freeze while the card loaded.
    const geometry=mergeGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    const combined=new THREE.Mesh(geometry,material);combined.castShadow=true;combined.receiveShadow=true;part.add(combined);
    for(const mesh of meshes){part.remove(mesh);mesh.geometry.dispose();}
  }
}
// All mesh-local transforms are static; only their parent modules animate.
device.traverse(node=>{if(node.isMesh){node.updateMatrix();node.matrixAutoUpdate=false;}});
const progressControl=document.querySelector('#progress'),assembleControl=document.querySelector('#assemble'),explodeControl=document.querySelector('#explode');
let lastProgress=-1;

let assembled=0,velocity=0,target=0,pinned=false,hovered=false,focused=false;
let frame=0,previous=0,visible=true,pointerX=0,pointerY=0;
const homeRotation={x:0,y:0,z:-.14};
function setTarget() {
  target=(pinned||hovered||focused)?1:0;
  panel.setAttribute('aria-pressed',String(Boolean(target)));
  status.textContent=target?'ASSEMBLING':'EXPLODED VIEW';
  hint.textContent=target?'Move away to separate':'Hover to Assemble';
  if(!target)pointerX=pointerY=0;
  if(reduced.matches){assembled=target;velocity=0;}
  wake();
}
panel.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hovered=true;setTarget();}});
panel.addEventListener('pointerleave',()=>{hovered=false;pointerX=pointerY=0;setTarget();});
// Restored pointer tilt (same range and damping as the original study), now gated:
// only once fully assembled, and only while the cursor is over the console itself.
// Elsewhere in the panel it eases back to rest, and an idle pointer renders nothing.
panel.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse')return;
  let x=0,y=0;
  if(assembled===1&&hostRect){
    // Cached rect (refreshed on resize): no layout read per mouse event.
    const r=hostRect;
    const cx=camera.left+(e.clientX-r.left)/r.width*(camera.right-camera.left);
    const cy=camera.top-(e.clientY-r.top)/r.height*(camera.top-camera.bottom);
    if(cx>=onMinX&&cx<=onMaxX&&cy>=onMinY&&cy<=onMaxY){
      x=((cx-onMinX)/(onMaxX-onMinX)-.5)*.05;
      y=(.5-(cy-onMinY)/(onMaxY-onMinY))*.035;
    }
  }
  if(x!==pointerX||y!==pointerY){pointerX=x;pointerY=y;wake();}
});
panel.addEventListener('focus',()=>{focused=true;setTarget();});
panel.addEventListener('blur',()=>{focused=false;pinned=false;setTarget();});
panel.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse'){pinned=!pinned;focused=false;setTarget();}});
panel.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pinned=!pinned;focused=false;setTarget();}if(e.key==='Escape'){pinned=hovered=focused=false;setTarget();}});
reduced.addEventListener('change',()=>setTarget());
document.querySelector('#assemble')?.addEventListener('click',()=>{pinned=true;hovered=focused=false;setTarget()});
document.querySelector('#explode')?.addEventListener('click',()=>{pinned=hovered=focused=false;setTarget()});
document.querySelector('#progress')?.addEventListener('input',e=>{pinned=hovered=focused=false;assembled=target=+e.target.value/100;velocity=0;wake()});
function pose() {
  const spread=1-assembled,percent=Math.round(assembled*100);
  if(percent!==lastProgress||assembled===0||assembled===1){if(progressControl)progressControl.value=percent;assembleControl?.setAttribute('aria-pressed',String(assembled===1));explodeControl?.setAttribute('aria-pressed',String(assembled===0));lastProgress=percent;}
  for(const part of parts){
    part.scale.z=1;
    part.position.copy(part.userData.home);
    
    part.position.addScaledVector(part.userData.offset,spread);
  }
  // The assembled console gains just enough presence to retain the composition.
  device.scale.setScalar(1+assembled*.16);
  cap.rotation.y=assembled*Math.PI/2;
  
}
pose();
// Fit BOTH states using the exploded geometry, so assembly never crops a part.
device.updateMatrixWorld(true);
camera.updateMatrixWorld(true);
let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
// The assembled console's own footprint, for the hover-tilt hit area.
let onMinX=Infinity,onMaxX=-Infinity,onMinY=Infinity,onMaxY=-Infinity;
const vertex=new THREE.Vector3();
for(const fitState of [0,1]){
await yieldToPage();
assembled=fitState;pose();device.updateMatrixWorld(true);
device.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const positions=mesh.geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    vertex.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    minX=Math.min(minX,vertex.x);maxX=Math.max(maxX,vertex.x);
    minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
    if(fitState===1){onMinX=Math.min(onMinX,vertex.x);onMaxX=Math.max(onMaxX,vertex.x);onMinY=Math.min(onMinY,vertex.y);onMaxY=Math.max(onMaxY,vertex.y);}
  }
});
}
assembled=0;pose();device.updateMatrixWorld(true);
const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
// Subtle baked ambient shadows anchor the product inside its modal.
// These two cached textures add no blur pass or additional shadow-map render.
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=256;shadowCanvas.height=256;
const shadowCtx=shadowCanvas.getContext('2d');
const falloff=shadowCtx.createRadialGradient(128,128,8,128,128,124);
falloff.addColorStop(0,'rgba(64,53,37,.19)');falloff.addColorStop(.42,'rgba(64,53,37,.10)');falloff.addColorStop(1,'rgba(64,53,37,0)');
shadowCtx.fillStyle=falloff;shadowCtx.fillRect(0,0,256,256);
const ambientTexture=new THREE.CanvasTexture(shadowCanvas);ambientTexture.colorSpace=THREE.SRGBColorSpace;
const ambientMaterial=new THREE.SpriteMaterial({map:ambientTexture,transparent:true,depthWrite:false,toneMapped:false});
const ambientShadow=new THREE.Sprite(ambientMaterial);
ambientShadow.position.set(centerX+.35,centerY-.40,-25).applyMatrix4(camera.matrixWorld);
ambientShadow.scale.set((maxX-minX)*1.06,(maxY-minY)*.94,1);scene.add(ambientShadow);
const contactMaterial=ambientMaterial.clone();contactMaterial.opacity=.65;
const contactShadow=new THREE.Sprite(contactMaterial);
contactShadow.position.set(centerX+.28,minY+.16,-24).applyMatrix4(camera.matrixWorld);
contactShadow.scale.set((maxX-minX)*.62,(maxY-minY)*.14,1);scene.add(contactShadow);

// Resting frames keep the supersampled finish. Frames in motion (assembling,
// tilting) render at the display's own density, which is the bulk of the GPU
// cost; the first still frame after motion restores full quality.
let hostRect=null,restRatio=2,motionRatio=1,activeRatio=0,moving=false;
function applyRatio(ratio) {
  if(ratio===activeRatio||!hostRect)return;
  activeRatio=ratio;renderer.setPixelRatio(ratio);renderer.setSize(hostRect.width,hostRect.height,false);
}
function resize() {
  const rect=host.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const {width,height}=rect,sizeChanged=!hostRect||width!==hostRect.width||height!==hostRect.height;
  hostRect=rect;
  restRatio=Math.min(Math.max(devicePixelRatio,2),2.5,Math.sqrt(2000000/(width*height)));
  motionRatio=Math.min(Math.max(devicePixelRatio,1),restRatio);
  if(sizeChanged){
    activeRatio=0;
    const aspect=width/height,half=Math.max((maxY-minY)*.5,(maxX-minX)*.5/aspect)*1.10;
    camera.left=centerX-half*aspect;camera.right=centerX+half*aspect;
    camera.top=centerY+half;camera.bottom=centerY-half;camera.updateProjectionMatrix();
  }
  applyRatio(moving?motionRatio:restRatio);wake();
}
new ResizeObserver(resize).observe(host);
window.addEventListener('resize',resize,{passive:true});
new IntersectionObserver(es=>{visible=es[0].isIntersecting;if(visible)wake();else{stopBlink();cancelAnimationFrame(frame);frame=0;}},{rootMargin:'0px'}).observe(panel);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();else{stopBlink();cancelAnimationFrame(frame);frame=0;}});
function wake(){if(!frame&&visible&&!document.hidden)frame=requestAnimationFrame(render);}
let lastShadowPose="",shadowTilt="0,0",lastState="";
function render(now){
  frame=0;if(!visible||document.hidden)return;const dt=Math.min((now-previous)/1000||.016,.05);previous=now;
  if(!reduced.matches){
    // Critically damped spring: no bounce, and no restart on a mid-flight reversal.
    const omega=9,displacement=assembled-target,decay=Math.exp(-omega*dt),carry=(velocity+omega*displacement)*dt;
    assembled=target+(displacement+carry)*decay;velocity=(velocity-omega*carry)*decay;
    if(Math.abs(assembled-target)<.00015&&Math.abs(velocity)<.001){assembled=target;velocity=0;}
  }
  pose();
  device.rotation.x=THREE.MathUtils.damp(device.rotation.x,reduced.matches?0:pointerY,6,dt);
  device.rotation.y=THREE.MathUtils.damp(device.rotation.y,reduced.matches?0:pointerX,6,dt);
  device.rotation.z=homeRotation.z;
  updateBoot(now);
  const assembling=Math.abs(assembled-target)>.00001;
  const tilting=Math.abs(device.rotation.x-(reduced.matches?0:pointerY))>.0001||Math.abs(device.rotation.y-(reduced.matches?0:pointerX))>.0001;
  moving=assembling||tilting;
  applyRatio(moving?motionRatio:restRatio);
  // Screen blinking does not change lighting: reuse the full-quality shadow map.
  // The tilt is only a degree or two, so its shadow refreshes once it settles
  // rather than re-rendering the shadow pass on every pointer frame.
  if(!tilting)shadowTilt=device.rotation.x.toFixed(4)+','+device.rotation.y.toFixed(4);
  const shadowPose=assembled+','+shadowTilt;
  if(shadowPose!==lastShadowPose){renderer.shadowMap.needsUpdate=true;lastShadowPose=shadowPose;}
  renderer.render(scene,camera);
  // DOM writes only on change: per-frame attribute writes forced style recalcs.
  const state=assembled===1?'assembled':assembled===0?'exploded':'transitioning';
  if(state!==lastState){host.dataset.state=lastState=state;}
  const statusText=assembled===1?'ASSEMBLED':assembled===0?'EXPLODED VIEW':'ASSEMBLY / '+Math.round(assembled*100)+'%';
  if(status.textContent!==statusText)status.textContent=statusText;
  if(moving)wake();
}
// Compile every shader before the first frame (in parallel where the driver
// allows it), so the card's first paint no longer freezes the page.
await renderer.compileAsync(scene,camera);
resize();
host.classList.add('ready');
panel.dataset.engine='three';

