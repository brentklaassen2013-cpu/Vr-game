const B = BABYLON;
const canvas = document.getElementById('game');
const engine = new B.Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });

const ui = {
  boot: document.getElementById('boot'), status: document.getElementById('bootStatus'), enter: document.getElementById('enterVR'), preview: document.getElementById('desktopStart'),
  hud: document.getElementById('hud'), toast: document.getElementById('toast'), hpBar: document.getElementById('hpBar'), hpText: document.getElementById('hpText'),
  batBar: document.getElementById('batBar'), batText: document.getElementById('batText'), chaosBar: document.getElementById('chaosBar'), chaosText: document.getElementById('chaosText'),
  rank: document.getElementById('rankText'), score: document.getElementById('scoreText'), mode: document.getElementById('modeText'), shift: document.getElementById('shiftText')
};

const DEFAULT_META = {level:1,survivalLevel:1,xp:0,coins:0,bestRank:'D',totalKOs:0,bestCombo:0,shifts:0,freeCrates:0,unlockedBats:['STANDARD','CHROME','NIGHT','EMBER','VOLT','EXECUTIVE','FROST','TOXIC','GRAVITY','CARBON','GOLD','NEON'],unlockedSkins:['CLASSIC','POTATO','EMBER_SKIN','FROST_SKIN','VOLT_SKIN','ROBOT','ALIEN','TOXIC_SKIN','ROCK','NEON','VOID','GOLD'],unlockedMaps:['FLOOR 13','ARCHIVE','BREAKROOM','SERVER','ROOFTOP','PARKING','HR MAZE','IT LAB','CAFETERIA','PENTHOUSE'],selectedBat:'STANDARD',selectedSkin:'POTATO',selectedMap:'FLOOR 13',cameraMode:'OFFICE CAM',contentVersion:'1.8',settings:{moveSpeed:2.2,snapTurn:30,haptics:true,music:true}};
function loadMeta(){
  try{
    const raw=localStorage.getItem('crazyOfficeNightShiftMeta');
    const parsed=raw?JSON.parse(raw):{};
    const merged={...DEFAULT_META,...parsed,settings:{...DEFAULT_META.settings,...(parsed.settings||{})}};
    const union=(a,b)=>Array.from(new Set([...(a||[]),...(b||[])]));
    merged.unlockedBats=union(DEFAULT_META.unlockedBats,parsed.unlockedBats);
    merged.unlockedSkins=union(DEFAULT_META.unlockedSkins,parsed.unlockedSkins);
    merged.unlockedMaps=union(DEFAULT_META.unlockedMaps,parsed.unlockedMaps);
    merged.survivalLevel=Math.max(1,Number(parsed.survivalLevel||1));
    if(parsed.contentVersion!=='1.8'){
      merged.contentVersion='1.8';
      merged.selectedSkin='POTATO';
      try{localStorage.setItem('crazyOfficeNightShiftMeta',JSON.stringify(merged));}catch{}
    }
    return merged;
  }catch(e){ console.warn('Meta save could not be read; using defaults.',e); return {...DEFAULT_META,settings:{...DEFAULT_META.settings}}; }
}

const G = {
  state: 'hub', mode: 'SURVIVAL', hp: 100, maxHp: 100, score: 0, chaos: 0, combo: 0, comboT: 0, kills: 0, blocks: 0, perfectBlocks: 0, propHits: 0, bestCombo: 0,
  level: 1, xp: 0, coins: 0, promotionEvery: 3, nextPromotion: 3, difficulty: 1, wave: 0, shiftTime: 0, lastIncident: '', incidentT: 0,
  bat: { durability: 100, max: 100, broken: false, respawnT: 0, crack: 0 },
  upgrade: { power: 1, defense: 1, improvised: 1, durability: 1, recovery: 0 },
  props: [], npcs: [], hazards: [], fx: [], lobbyMeshes: [], arenaMeshes: [], blockers: [], xr: null, right: null, left: null, batMesh: null, batTip: null, handState: new Map(), handVisuals: {left:null,right:null}, playerBodyRoot:null,
  desktop: false, lastT: performance.now(), directorT: 0, spawnT: 0, bossSpawned: false, boss: null, ended: false, endTimer: null, attackGrace: 0, damageFlashT: 0, musicT: 0, lastMusicBand: '', lastRank: 'D',
  objective: null, meta: loadMeta(), risers: [], joystick:new B.Vector2(0,0), turnAxis:0, turnLatch:false, stationInfo:null, waveTransition:false, waveToken:0
};

const AudioCtor=window.AudioContext||window.webkitAudioContext;
const audio=AudioCtor?new AudioCtor():null;
function tone(freq=220,dur=.08,type='sine',gain=.05,slide=0){
  if(!audio)return; if(audio.state==='suspended') audio.resume().catch(()=>{});
  const o=audio.createOscillator(), g=audio.createGain(); o.type=type; o.frequency.setValueAtTime(freq,audio.currentTime); if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide),audio.currentTime+dur);
  g.gain.setValueAtTime(gain,audio.currentTime); g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+dur); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime+dur);
}
function impactSound(material='wood',power=1){ const m={metal:[180,'square'],glass:[620,'triangle'],ceramic:[420,'triangle'],plastic:[260,'square'],wood:[140,'sine']}[material]||[170,'sine']; tone(m[0]*(1+Math.random()*.12),.05+.04*power,m[1],.025+.035*power,-m[0]*.3); }
function musicPulse(){
  if(G.state!=='shift'||G.meta.settings?.music===false)return; const band=G.boss?'boss':G.chaos>72?'mayhem':G.chaos>35?'tension':'shift';
  if(band!==G.lastMusicBand){G.lastMusicBand=band; tone(band==='boss'?52:band==='mayhem'?78:band==='tension'?98:118,.16,'sine',.012,band==='boss'?18:35);}
  const f=band==='boss'?58:band==='mayhem'?82:band==='tension'?110:132; tone(f,.055,'sine',band==='shift'?.006:.009,0);
}
function announce(text,kind='info'){ toast(text,kind==='boss'?2100:1200); if(kind==='good')tone(330,.12,'triangle',.035,150); else if(kind==='danger')tone(105,.1,'square',.04,-40); }
function haptic(ctrl,power=.4,dur=35){ if(G.meta.settings?.haptics===false)return; try{ctrl?.inputSource?.gamepad?.hapticActuators?.[0]?.pulse(Math.min(1,power),dur);}catch{} }

function mat(scene,name,color,rough=.7){ const m=new B.PBRMaterial(name,scene); m.albedoColor=B.Color3.FromHexString(color); m.roughness=rough; m.metallic=rough<.4?.45:.05; return m; }
function box(scene,name,pos,scale,color,parent=null){ const x=B.MeshBuilder.CreateBox(name,{size:1},scene); x.position.copyFrom(pos); x.scaling.copyFrom(scale); x.material=mat(scene,name+'Mat',color); if(parent)x.parent=parent; return x; }
function capsule(scene,name,pos,height,radius,color,parent=null){let x;if(B.MeshBuilder.CreateCapsule)x=B.MeshBuilder.CreateCapsule(name,{height,radius,tessellation:12,subdivisions:4},scene);else{x=B.MeshBuilder.CreateSphere(name,{diameter:radius*2,segments:10},scene);x.scaling.y=Math.max(1,height/(radius*2));}x.position.copyFrom(pos);x.material=mat(scene,name+'Mat',color);if(parent)x.parent=parent;return x;}
function label(scene,text,pos,size=1.1,color='#ffffff'){ const p=B.MeshBuilder.CreatePlane('label',{width:2.6*size,height:.52*size},scene); p.position.copyFrom(pos); p.billboardMode=B.Mesh.BILLBOARDMODE_Y; const tex=new B.DynamicTexture('labelTex',{width:1024,height:220},scene,true); tex.hasAlpha=true; tex.drawText(text,null,150,'bold 100px Arial',color,'transparent',true,true); const m=new B.StandardMaterial('labelMat',scene); m.diffuseTexture=tex; m.emissiveTexture=tex; m.opacityTexture=tex; m.disableLighting=true; p.material=m; return p; }
function toast(s,ms=1200){ ui.toast.textContent=s; ui.toast.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>ui.toast.classList.remove('show'),ms); }

function saveMeta(){ try{localStorage.setItem('crazyOfficeNightShiftMeta',JSON.stringify(G.meta));}catch(e){console.warn('Meta save failed.',e);} }
function careerTier(){ return Math.min(5,Math.floor(Math.max(0,(G.meta.level||1)-1)/2)); }
function salaryTier(){ const c=G.meta.coins||0; return c>=3000?'EXECUTIVE':c>=1500?'MIDNIGHT':c>=600?'CHROME':'STANDARD'; }
function batColor(){ return selectedBatDef().color; }


function controllerNode(ctrl){ return ctrl?.grip || ctrl?.pointer || null; }
function disposeMeshSafe(m){ try{m?.dispose?.(false,true);}catch{} }
function clearPlayerVisuals(){
  disposeMeshSafe(G.handVisuals.left); disposeMeshSafe(G.handVisuals.right); G.handVisuals.left=null; G.handVisuals.right=null;
  disposeMeshSafe(G.playerBodyRoot); G.playerBodyRoot=null;
}
function buildHandVisual(scene, hand, ctrl){
  const node=controllerNode(ctrl); if(!node) return null;
  const old=G.handVisuals[hand]; if(old) disposeMeshSafe(old);
  const skin=selectedSkinDef();
  const root=new B.TransformNode(`playerHand_${hand}`,scene); root.parent=node;
  root.position=new B.Vector3(hand==='left'?-0.025:0.025,-0.04,0.06);
  root.rotationQuaternion=B.Quaternion.Identity();
  if(skin.id==='POTATO'){
    const palm=B.MeshBuilder.CreateSphere(`potatoPalm_${hand}`,{diameter:.12,segments:12},scene); palm.parent=root; palm.scaling=new B.Vector3(1.18,.95,1.3); palm.material=mat(scene,`potatoHandMat_${hand}`,'#b9833d',.95); const spotMat=mat(scene,`potatoSpotMat_${hand}`,'#6d431f',.98); for(let si=0;si<3;si++){const sp=B.MeshBuilder.CreateSphere(`potatoSpot_${hand}_${si}`,{diameter:.018,segments:6},scene);sp.parent=root;sp.position=new B.Vector3((si-1)*.025,.03,.058+si*.01);sp.material=spotMat;}
    for(let i=0;i<4;i++){
      const finger=B.MeshBuilder.CreateCapsule(`potatoFinger_${hand}_${i}`,{radius:.018,height:.08,subdivisions:4},scene); finger.parent=root; finger.position=new B.Vector3((i-1.5)*.018,.01,.06+i*.005); finger.rotation.z=(hand==='left'?-1:1)*(.15+i*.03); finger.rotation.x=Math.PI/2.4; finger.material=palm.material;
    }
    const thumb=B.MeshBuilder.CreateCapsule(`potatoThumb_${hand}`,{radius:.02,height:.07,subdivisions:4},scene); thumb.parent=root; thumb.position=new B.Vector3(hand==='left'?-0.055:0.055,-.005,.02); thumb.rotation.x=Math.PI/2.1; thumb.rotation.z=(hand==='left'?-1:1)*0.85; thumb.material=palm.material;
  }else{
    const palm=box(scene,`glove_${hand}`,new B.Vector3(0,0,0),new B.Vector3(.085,.065,.12), skin.shirt, root);
    const cuff=box(scene,`cuff_${hand}`,new B.Vector3(0,-.045,-.025),new B.Vector3(.1,.03,.08), skin.accent, root);
    palm.material.roughness=.92; cuff.material.roughness=.88;
  }
  G.handVisuals[hand]=root; return root;
}
function rebuildPlayerBody(scene){
  disposeMeshSafe(G.playerBodyRoot); G.playerBodyRoot=null;
  const cam=(G.xr?.baseExperience?.camera)||scene.activeCamera; if(!cam) return;
  const skin=selectedSkinDef();
  const root=new B.TransformNode('playerBodyRoot',scene); root.parent=cam; root.position=new B.Vector3(0,-1.0,0.12);
  if(skin.id==='POTATO'){
    const torso=B.MeshBuilder.CreateSphere('potatoTorso',{diameter:.55,segments:14},scene); torso.parent=root; torso.scaling=new B.Vector3(1.0,1.15,.95); torso.position.y=.18; torso.material=mat(scene,'potatoBodyMat','#b9833d',.98);
    const cheekL=B.MeshBuilder.CreateSphere('potatoCheekL',{diameter:.36,segments:14},scene); cheekL.parent=root; cheekL.position=new B.Vector3(-.16,-.06,-.15); cheekL.scaling=new B.Vector3(1.08,1.0,1.28); cheekL.material=torso.material;
    const cheekR=cheekL.clone('potatoCheekR'); cheekR.parent=root; cheekR.position.x=.13; root.metadata={potato:true,cheeks:[cheekL,cheekR],torso};
    const tie=box(scene,'potatoTie',new B.Vector3(0,.05,.24),new B.Vector3(.055,.22,.04), '#5a2d0c', root);
    const legL=box(scene,'potLegL',new B.Vector3(-.11,-.34,0),new B.Vector3(.09,.28,.09),'#2a1c15',root);
    const legR=box(scene,'potLegR',new B.Vector3(.11,-.34,0),new B.Vector3(.09,.28,.09),'#2a1c15',root);
    legL.material=legR.material=mat(scene,'potLegMat','#2a1c15',.9);
  }else{
    const torso=box(scene,'playerTorso',new B.Vector3(0,.14,0),new B.Vector3(.3,.5,.22),skin.shirt,root);
    const tie=box(scene,'playerTie',new B.Vector3(0,.04,.14),new B.Vector3(.06,.24,.03),skin.accent,root);
    const hips=box(scene,'playerHips',new B.Vector3(0,-.16,0),new B.Vector3(.28,.12,.18),'#1c1f25',root);
    hips.material.roughness=.9;
  }
  if(skin.id!=='POTATO'){
    const accentMat=mat(scene,'skinAccentVisual',skin.accent||'#ffffff',.38);accentMat.emissiveColor=B.Color3.FromHexString(skin.accent||'#ffffff').scale(.22);
    if(skin.id==='ROBOT'){for(const x of [-.25,.25]){const pad=box(scene,'robotShoulder',new B.Vector3(x,.32,0),new B.Vector3(.12,.12,.18),skin.accent,root);pad.rotation.z=x<0?-.25:.25;}}
    if(skin.id==='ALIEN'){for(const x of [-.08,.08]){const stalk=capsule(scene,'alienAntenna',new B.Vector3(x,.58,.02),.2,.018,skin.accent,root);stalk.rotation.z=x<0?-.25:.25;const orb=B.MeshBuilder.CreateSphere('alienOrb',{diameter:.06,segments:8},scene);orb.parent=root;orb.position=new B.Vector3(x*1.25,.69,.02);orb.material=accentMat;}}
    if(skin.id==='GOLD'){for(let i=-1;i<=1;i++){const spike=B.MeshBuilder.CreateCylinder('crownSpike',{height:.18,diameterTop:0,diameterBottom:.08,tessellation:8},scene);spike.parent=root;spike.position=new B.Vector3(i*.09,.62,0);spike.material=accentMat;}}
    if(['EMBER_SKIN','FROST_SKIN','VOLT_SKIN','NEON','VOID'].includes(skin.id)){const ring=B.MeshBuilder.CreateTorus('skinEnergyRing',{diameter:.48,thickness:.025,tessellation:20},scene);ring.parent=root;ring.position=new B.Vector3(0,-.02,0);ring.rotation.x=Math.PI/2;ring.material=accentMat;}
    if(skin.id==='ROCK'){const plate=box(scene,'rockChest',new B.Vector3(0,.17,.23),new B.Vector3(.25,.24,.045),skin.accent,root);plate.rotation.z=.06;}
  }
  G.playerBodyRoot=root;
}
function updatePlayerBodyVisual(dt){
  const r=G.playerBodyRoot;if(!r||!r.metadata?.potato)return;const speed=Math.min(1,Math.hypot(G.joystick.x||0,G.joystick.y||0));const hit=G.damageFlashT>0?1:0;const jig=Math.sin(performance.now()*.012)*(0.025+speed*.035+hit*.035);
  const cs=r.metadata.cheeks||[];cs.forEach((c,i)=>{if(!c||c.isDisposed?.())return;c.scaling.y=1+Math.abs(jig)*(i?1.05:.9);c.scaling.z=1.28+jig*(i?-1:1);});if(r.metadata.torso&&!r.metadata.torso.isDisposed?.())r.metadata.torso.scaling.x=1+jig*.18;
}
function refreshPlayerCosmetics(){
  clearPlayerVisuals();
  if(scene){
    if(G.left) buildHandVisual(scene,'left',G.left);
    if(G.right) buildHandVisual(scene,'right',G.right);
    rebuildPlayerBody(scene);
  }
}
function npcPalette(role,type='worker'){
  if(type==='boss') return {shirt:'#7a2032',accent:'#ffd166',skin:'#d7a17e'};
  if(role==='thrower') return {shirt:'#48617b',accent:'#79c7ff',skin:'#d0a37f'};
  if(role==='flanker') return {shirt:'#375d49',accent:'#76efb2',skin:'#c99570'};
  return {shirt:'#5f4b8b',accent:'#ff9aa2',skin:'#d8ab88'};
}


const CATALOG={
  bats:[
    {id:'STANDARD',name:'Office Slugger',color:'#704329',handle:'#171513',ring:'#d7c7a0',power:1.00,dur:1.00,ability:'BALANCED'},
    {id:'CHROME',name:'Chrome Deadline',color:'#bbc5cf',handle:'#252b30',ring:'#66d9ff',power:1.04,dur:1.18,ability:'DURABLE'},
    {id:'NIGHT',name:'Night Shift',color:'#182234',handle:'#07090d',ring:'#7d6dff',power:1.08,dur:1.10,ability:'COMBO'},
    {id:'EMBER',name:'Overtime Ember',color:'#c74728',handle:'#29110c',ring:'#ffae45',power:1.12,dur:.96,ability:'BURN'},
    {id:'VOLT',name:'Power Surge',color:'#d8f044',handle:'#1b2412',ring:'#7dffdb',power:1.08,dur:1.04,ability:'CHAIN'},
    {id:'EXECUTIVE',name:'Executive Order',color:'#8c5bff',handle:'#1d1538',ring:'#f2d7ff',power:1.14,dur:1.13,ability:'EXECUTE'},
    {id:'FROST',name:'Cold Email',color:'#9fdcf5',handle:'#142b36',ring:'#ffffff',power:1.07,dur:1.15,ability:'SLOW'},
    {id:'TOXIC',name:'Toxic Workplace',color:'#70cc47',handle:'#183412',ring:'#caff72',power:1.10,dur:1.02,ability:'POISON'},
    {id:'GRAVITY',name:'Heavy Meeting',color:'#554d66',handle:'#151219',ring:'#d0b7ff',power:1.18,dur:.92,ability:'KNOCKBACK'},
    {id:'CARBON',name:'Carbon Copy',color:'#272b31',handle:'#0a0b0d',ring:'#aab4c0',power:1.11,dur:1.25,ability:'REINFORCED'},
    {id:'GOLD',name:'Golden Promotion',color:'#d6a62b',handle:'#3b2605',ring:'#fff0a4',power:1.13,dur:1.18,ability:'SCORE'},
    {id:'NEON',name:'Neon Resignation',color:'#ff4fd8',handle:'#201126',ring:'#4ff7ff',power:1.09,dur:1.08,ability:'COMBO'}
  ],
  skins:[
    {id:'CLASSIC',name:'Classic',shirt:'#d5d7dc',accent:'#cf334e',ability:'Balanced'},
    {id:'POTATO',name:'Potato Boss',shirt:'#b9833d',accent:'#5a2d0c',hand:'#b9833d',ability:'Thick Skin'},
    {id:'EMBER_SKIN',name:'Firestarter',shirt:'#7e251b',accent:'#ff8a3d',ability:'Burn'},
    {id:'FROST_SKIN',name:'Deep Freeze',shirt:'#9bdcf5',accent:'#e9fbff',ability:'Slow'},
    {id:'VOLT_SKIN',name:'Live Wire',shirt:'#39448f',accent:'#e9ff58',ability:'Chain'},
    {id:'ROBOT',name:'Office Bot',shirt:'#69737d',accent:'#55d9ff',ability:'Reinforced'},
    {id:'ALIEN',name:'Alien Intern',shirt:'#5e8d52',accent:'#b9ff88',ability:'Knockback'},
    {id:'TOXIC_SKIN',name:'Toxic HR',shirt:'#355b24',accent:'#9eff45',ability:'Poison'},
    {id:'ROCK',name:'Stone Manager',shirt:'#55545b',accent:'#c8c4c0',ability:'Armor'},
    {id:'NEON',name:'Neon',shirt:'#e75aff',accent:'#54f7ff',ability:'Fast Feet'},
    {id:'VOID',name:'Void',shirt:'#18151f',accent:'#a36cff',ability:'Hazard Guard'},
    {id:'GOLD',name:'King of Overtime',shirt:'#b98a24',accent:'#fff0a4',ability:'Bonus Score'}
  ],
  maps:[
    {id:'FLOOR 13',name:'Floor 13 Open Office'},
    {id:'ARCHIVE',name:'Archive Lockdown'},
    {id:'BREAKROOM',name:'Breakroom After Hours'},
    {id:'SERVER',name:'Server Basement'},
    {id:'ROOFTOP',name:'Rooftop Overtime'},
    {id:'PARKING',name:'Parking Garage'},
    {id:'HR MAZE',name:'HR Cubicle Maze'},
    {id:'IT LAB',name:'IT Repair Lab'},
    {id:'CAFETERIA',name:'Night Cafeteria'},
    {id:'PENTHOUSE',name:'Executive Penthouse'}
  ],
  props:['MUG','CHAIR','MONITOR','PRINTER','KEYBOARD','WATERCOOLER','LAPTOP','FOLDER','CART','EXTINGUISHER']
};
function normalizeMetaSelection(){
  let changed=false;
  if(!CATALOG.bats.some(x=>x.id===G.meta.selectedBat)){G.meta.selectedBat='STANDARD';changed=true;}
  if(!CATALOG.skins.some(x=>x.id===G.meta.selectedSkin)){G.meta.selectedSkin='POTATO';changed=true;}
  if(!CATALOG.maps.some(x=>x.id===G.meta.selectedMap)){G.meta.selectedMap='FLOOR 13';changed=true;}
  G.meta.unlockedBats=CATALOG.bats.map(x=>x.id);G.meta.unlockedSkins=CATALOG.skins.map(x=>x.id);G.meta.unlockedMaps=CATALOG.maps.map(x=>x.id);
  if(changed)saveMeta();
}
normalizeMetaSelection();
function selectedBatDef(){return CATALOG.bats.find(x=>x.id===G.meta.selectedBat)||CATALOG.bats[0];}
function selectedSkinDef(){return CATALOG.skins.find(x=>x.id===G.meta.selectedSkin)||CATALOG.skins[0];}
function skinAbility(){return selectedSkinDef().ability||'Balanced';}
function skinDefenseMul(){const a=skinAbility();return a==='Armor'?.82:a==='Thick Skin'?.9:a==='Hazard Guard'?.94:1;}
function skinMoveMul(){return skinAbility()==='Fast Feet'?1.12:1;}
function skinPropMul(){return skinAbility()==='Thick Skin'?1.18:1;}
function cycleOwned(kind){
  const cat=kind==='bat'?CATALOG.bats:kind==='skin'?CATALOG.skins:CATALOG.maps;
  const field=kind==='bat'?'unlockedBats':kind==='skin'?'unlockedSkins':'unlockedMaps';
  const sel=kind==='bat'?'selectedBat':kind==='skin'?'selectedSkin':'selectedMap';
  const owned=new Set(G.meta[field]||[]); const options=cat.filter(x=>owned.has(x.id)); if(!options.length)return;
  let i=options.findIndex(x=>x.id===G.meta[sel]); G.meta[sel]=options[(i+1+options.length)%options.length].id; saveMeta();
  toast(`${kind.toUpperCase()} • ${G.meta[sel]}`,1000); rebuildHubLabels?.(); refreshPlayerCosmetics?.();
}
function openCrate(){
  const cost=50;
  if(G.meta.coins<cost){toast(`NEED ${cost} COINS`,1000);return;}
  G.meta.coins-=cost;
  const reward=[25,40,60,80,120][Math.floor(Math.random()*5)];
  G.meta.coins+=reward; saveMeta();
  announce(`OFFICE CRATE • +${reward} COINS`,'good'); tone(240,.22,'triangle',.05,320); rebuildHubLabels?.();
}
function stationText(id){
  if(id==='CRATES')return `CRATES
${G.meta.freeCrates||0?`${G.meta.freeCrates} FREE`:'50 COINS'}`;
  if(id==='CAMERA')return `CAMERA
${G.meta.cameraMode||'OFFICE CAM'}`;
  if(id==='MAPS')return `MAPS
${G.meta.selectedMap}`;
  if(id==='PROPS')return `PROPS
PHYSICS LAB`;
  if(id==='BATS'){const b=selectedBatDef();return `BATS
${b.name} • ${b.ability||'BALANCED'}`;}
  if(id==='SKINS'){const sk=selectedSkinDef();return `SKINS
${sk.name} • ${sk.ability||'Balanced'}`;}
  if(id==='SETTINGS')return `SETTINGS
MOVE ${Number(G.meta.settings?.moveSpeed||2.2).toFixed(1)} • TURN ${G.meta.settings?.snapTurn||30}°`;
  return id;
}
function stationAction(id){
  if(id==='CRATES')openCrate();
  else if(id==='CAMERA'){const a=['OFFICE CAM','SELFIE','SPECTATOR'];let i=a.indexOf(G.meta.cameraMode);G.meta.cameraMode=a[(i+1+a.length)%a.length];saveMeta();toast(`CAMERA • ${G.meta.cameraMode}`,1000);rebuildHubLabels?.();}
  else if(id==='MAPS')cycleOwned('map');
  else if(id==='BATS')cycleOwned('bat');
  else if(id==='SKINS')cycleOwned('skin');
  else if(id==='PROPS'){spawnShowcaseProp(scene);}
  else if(id==='SETTINGS'){const presets=[{name:'COMFORT',moveSpeed:1.6,snapTurn:30,haptics:true,music:true},{name:'STANDARD',moveSpeed:2.2,snapTurn:30,haptics:true,music:true},{name:'FAST',moveSpeed:3.2,snapTurn:45,haptics:true,music:true},{name:'QUIET',moveSpeed:2.2,snapTurn:30,haptics:false,music:false}];let i=presets.findIndex(x=>Math.abs(x.moveSpeed-(G.meta.settings?.moveSpeed||2.2))<.01&&x.haptics===G.meta.settings?.haptics&&x.music===G.meta.settings?.music);const n=presets[(i+1+presets.length)%presets.length];G.meta.settings={...G.meta.settings,...n};saveMeta();toast(`SETTINGS • ${n.name}`,1000);rebuildHubLabels?.();}
}
function spawnShowcaseProp(scene){ if(G.state!=='hub')return; const types=['mug','keyboard','monitor','chair'];const t=types[Math.floor(Math.random()*types.length)]; const p=makeProp(scene,t,new B.Vector3(0,.35,-.7),{material:t==='chair'?'metal':t==='mug'?'ceramic':'plastic',mass:t==='chair'?6:2,damage:t==='chair'?24:12,size:t==='chair'?[.55,1,.55]:[.42,.35,.35]}); p.showcase=true; p.vel.y=2.4; announce(`PHYSICS LAB • ${t.toUpperCase()}`,'good'); }
let rebuildHubLabels=()=>{};

function chooseObjective(){
  const pool=[
    {id:'ko',label:'Clean House: 8 KOs',target:8,reward:75,progress:()=>G.kills},
    {id:'prop',label:'Improvised: 4 prop hits',target:4,reward:85,progress:()=>G.propHits},
    {id:'score',label:'Performance: 4500 score',target:4500,reward:80,progress:()=>G.score},
    {id:'chaos',label:'Cause 85% chaos',target:85,reward:80,progress:()=>G.chaos}
  ];
  if((G.meta.survivalLevel||1)>=3) pool.push({id:'combo',label:'Team Spirit: reach x9 combo',target:9,reward:110,progress:()=>G.bestCombo});
  if((G.meta.survivalLevel||1)>=5) pool.push({id:'blocks',label:'Risk Control: 3 perfect blocks',target:3,reward:135,progress:()=>G.perfectBlocks});
  const o={...pool[Math.floor(Math.random()*pool.length)],done:false}; G.objective=o;
}
function objectiveTick(){ if(!G.objective||G.objective.done)return; if(G.objective.progress()>=G.objective.target){G.objective.done=true;addScore(500,'OBJECTIVE');toast(`SURVIVAL CHALLENGE COMPLETE • +500 SCORE`,1800);tone(380,.18,'triangle',.04,260);} }
function checkBlock(baseDamage,attacker){
  for(const st of G.handState.values()){
    const p=st.grabbing; if(!p)continue; const pos=p.mesh.getAbsolutePosition(); const pp=playerPos(scene); if(B.Vector3.Distance(pos,pp)<.9){
      const perfect=(p._lastHandVel?.length?.()||0)>1.15; G.blocks++; if(perfect){G.perfectBlocks++;addScore(190,'PERFECT BLOCK');announce('PERFECT BLOCK','good');} else addScore(95,'BLOCK');
      impactSound(p.material,perfect?1:.8); haptic(st.ctrl,perfect?.8:.55,perfect?65:45); p.vel.addInPlace(attacker.root.position.subtract(pp).normalize().scale(perfect?2.4:1.4)); if(perfect&&attacker)attacker.attackT+=.65; return true;
    }
  } return false;
}
function npcAttack(npc,baseDamage,why){ if(G.attackGrace>0)return; if(checkBlock(baseDamage,npc)){tone(120,.05,'square',.025);G.attackGrace=.18;return;} damagePlayer(baseDamage,why); G.attackGrace=G.hp<35?.72:.34; }

function addScore(v,why=''){ G.score+=Math.round(v*(1+G.chaos/180)); G.combo=Math.min(16,G.combo+1); G.bestCombo=Math.max(G.bestCombo,G.combo); G.comboT=2.8; G.chaos=Math.min(100,G.chaos+Math.min(8,v*.025)); if(why && G.combo%4===0) toast(`${why}  x${G.combo}`); }
function rank(){ const s=G.score; return s>9000?'S':s>6000?'A':s>3500?'B':s>1500?'C':'D'; }
function updateHUD(){
  ui.hpBar.style.width=`${Math.max(0,G.hp/G.maxHp*100)}%`; ui.hpText.textContent=Math.ceil(G.hp);
  ui.batBar.style.width=`${Math.max(0,G.bat.durability/G.bat.max*100)}%`; ui.batText.textContent=G.bat.broken?'BROKEN':`${Math.ceil(G.bat.durability)}%`;
  ui.chaosBar.style.width=`${G.chaos}%`; ui.chaosText.textContent=`${Math.round(G.chaos)}%`; ui.rank.textContent=rank(); ui.score.textContent=G.score.toLocaleString();
  const lvl=G.meta.survivalLevel||1;
  ui.mode.textContent=G.state==='hub'?`SURVIVAL • LEVEL ${lvl}`:`LEVEL ${lvl} • WAVE ${G.wave}/5`;
  ui.shift.textContent=G.state==='hub'?`${G.meta.coins} COINS • MAP ${G.meta.selectedMap} • SKIN ${G.meta.selectedSkin}`:(G.boss&&!G.boss.dead?`BOSS HP ${Math.max(0,Math.ceil(G.boss.hp))}/${Math.ceil(G.boss.maxHp)} • ONE LIFE`:`${G.meta.coins} COINS • KOs ${G.kills} • COMBO x${G.combo}`);
  const rr=rank(); if(G.state==='shift'&&rr!==G.lastRank){G.lastRank=rr;announce(`PERFORMANCE RANK ${rr}`,'good');}
}

function clearList(list){for(const m of [...list]){try{m?.dispose?.(false,true);}catch{}}list.length=0;}
function disposeProp(p){if(!p)return;try{p.mesh?.dispose?.(false,true);}catch{}const i=G.props.indexOf(p);if(i>=0)G.props.splice(i,1);}
function makeScene(){
  const scene=new B.Scene(engine);scene.clearColor=new B.Color4(.025,.03,.045,1);scene.gravity=new B.Vector3(0,-9.81,0);scene.collisionsEnabled=true;
  const cam=new B.UniversalCamera('previewCam',new B.Vector3(0,1.65,-5),scene);cam.attachControl(canvas,true);cam.speed=.09;cam.minZ=.05;
  const hemi=new B.HemisphericLight('hemi',new B.Vector3(.2,1,.1),scene);hemi.intensity=.55;
  const key=new B.DirectionalLight('key',new B.Vector3(-.4,-1,.3),scene);key.position=new B.Vector3(5,8,-6);key.intensity=1.15;
  buildHub(scene);scene.onBeforeRenderObservable.add(()=>tick(scene));return scene;
}

function buildHub(scene){
  if(G.endTimer){clearTimeout(G.endTimer);G.endTimer=null;}
  for(const [hand,st] of G.handState){ if(st.grabbing)releaseGrab(hand,st.ctrl); st.grabbing=null; st.prevPos=null; }
  G.state='hub'; G.ended=false; G.blockers=[]; clearList(G.arenaMeshes); clearList(G.lobbyMeshes); G.props.splice(0).forEach(disposeProp); for(const n of G.npcs) n.dispose(); G.npcs=[]; for(const h of G.hazards){try{h.mesh.dispose()}catch{}} G.hazards=[]; G.boss=null; if(G.batMesh){try{G.batMesh.dispose(false,true)}catch{} G.batMesh=null;G.batTip=null;}
  const floor=box(scene,'elevatorFloor',new B.Vector3(0,-.08,0),new B.Vector3(4.4,.15,4.4),'#2b2f39'); G.lobbyMeshes.push(floor);
  const back=box(scene,'elevatorBack',new B.Vector3(0,2.2,2.1),new B.Vector3(4.4,4.5,.18),'#161a22'); G.lobbyMeshes.push(back);
  const left=box(scene,'elevatorLeft',new B.Vector3(-2.1,2.2,0),new B.Vector3(.18,4.5,4.4),'#191d25'); G.lobbyMeshes.push(left);
  const right=box(scene,'elevatorRight',new B.Vector3(2.1,2.2,0),new B.Vector3(.18,4.5,4.4),'#191d25'); G.lobbyMeshes.push(right);
  const ceiling=box(scene,'elevatorCeiling',new B.Vector3(0,4.4,0),new B.Vector3(4.4,.15,4.4),'#0e1117'); G.lobbyMeshes.push(ceiling);
  const sign=label(scene,'CRAZY OFFICE  //  NIGHT SHIFT',new B.Vector3(0,3.35,2),.7,'#f8fbff'); G.lobbyMeshes.push(sign);
  const sub=label(scene,'PUNCH IN. CAUSE PROBLEMS. GET PROMOTED.',new B.Vector3(0,2.9,2),.45,'#9ae7ff'); G.lobbyMeshes.push(sub);
  const lvl=G.meta.survivalLevel||1;
  const console=box(scene,'console_SURVIVAL',new B.Vector3(0,1.05,1.85),new B.Vector3(1.5,.72,.34),'#ff9d22'); console.metadata={interact:'mode',mode:'SURVIVAL'}; G.lobbyMeshes.push(console);
  const startLabel=label(scene,`START SURVIVAL\nLEVEL ${lvl}`,new B.Vector3(0,1.62,1.66),.46,'#fff2d1'); G.lobbyMeshes.push(startLabel);
  const rack=box(scene,'batRack',new B.Vector3(1.65,1.1,-1.7),new B.Vector3(.55,1.6,.3),'#323746'); G.lobbyMeshes.push(rack);
  const tip=label(scene,'ONE LIFE • 5 WAVES • +10 COINS EACH WAVE\nTRIGGER TO START',new B.Vector3(0,.72,1.7),.42,'#cfefff'); G.lobbyMeshes.push(tip); const career=label(scene,`LEVEL ${G.meta.survivalLevel||1}  •  ${G.meta.coins} COINS  •  ALL GEAR OWNED`,new B.Vector3(0,2.35,2),.34,'#9aa8ff'); G.lobbyMeshes.push(career);
  G.risers=[]; const ids=['CRATES','CAMERA','MAPS','PROPS','BATS','SKINS','SETTINGS'];
  const positions=[[-1.55,-1.0],[-.52,-1.3],[.52,-1.3],[1.55,-1.0],[-1.25,-.15],[0,-.45],[1.25,-.15]];
  const stationLabels=[];
  ids.forEach((id,i)=>{const [x,z]=positions[i];const root=new B.TransformNode('riser_'+id,scene);root.position=new B.Vector3(x,-1.05,z);const base=box(scene,'station_'+id,new B.Vector3(0,.48,0),new B.Vector3(.72,.92,.58),i%2?'#243044':'#2f3b4d',root);base.metadata={interact:'station',station:id};const cap=box(scene,'stationCap_'+id,new B.Vector3(0,.98,0),new B.Vector3(.78,.08,.64),'#65c8ff',root);cap.metadata={interact:'station',station:id};const l=label(scene,stationText(id),new B.Vector3(0,1.42,0),.22,'#e9f8ff');l.parent=root;l.position=new B.Vector3(0,1.42,0);stationLabels.push({id,l});G.lobbyMeshes.push(root);G.risers.push({root,targetY:0,t:i*.06});});
  rebuildHubLabels=()=>{for(const it of stationLabels){try{it.l.dispose(false,true)}catch{}; const root=G.lobbyMeshes.find(x=>x.name==='riser_'+it.id); if(root){const l=label(scene,stationText(it.id),new B.Vector3(0,1.42,0),.22,'#e9f8ff');l.parent=root;l.position=new B.Vector3(0,1.42,0);it.l=l;}} updateHUD();};
  updateHUD();
}

function startShift(scene,mode='SURVIVAL'){
  if(G.endTimer){clearTimeout(G.endTimer);G.endTimer=null;}
  clearList(G.lobbyMeshes); G.blockers=[]; G.state='shift'; G.mode='SURVIVAL'; G.ended=false; G.waveTransition=false; G.waveToken++; G.hp=100; G.maxHp=100; G.score=0; G.chaos=0; G.combo=0; G.kills=0; G.blocks=0; G.perfectBlocks=0; G.propHits=0; G.bestCombo=0; G.wave=1; G.shiftTime=0; G.difficulty=1+Math.max(0,(G.meta.survivalLevel||1)-1)*.12; G.spawnT=0; G.directorT=0; G.incidentT=0; G.bossSpawned=false; G.boss=null; G.lastRank='D'; G.attackGrace=1.15; G.musicT=0; G.lastMusicBand=''; G.nextPromotion=4; G.upgrade={power:1,defense:1,improvised:1,durability:1,recovery:0};
  const lvl=G.meta.survivalLevel||1; G.maxHp=Math.max(82,100-Math.floor((lvl-1)*1.5)); if(skinAbility()==='Thick Skin')G.maxHp+=14; G.hp=G.maxHp; const bd=selectedBatDef(); G.upgrade.power*=bd.power; {const sd=selectedSkinDef();const durBonus=sd.ability==='Reinforced'?1.28:1;G.bat={durability:100*bd.dur*durBonus,max:100*bd.dur*durBonus,broken:false,respawnT:0,crack:0};} chooseObjective();
  buildArena(scene); spawnWave(scene,waveEnemyCount()); spawnBat(scene); refreshPlayerCosmetics(); toast(`SURVIVAL LEVEL ${lvl} • WAVE 1`,1700); tone(90,.35,'sawtooth',.04,180); updateHUD();
}

function addBlocker(mesh,pad=.34){ if(!mesh)return mesh; G.blockers.push({mesh,pad}); return mesh; }
function fixedBox(scene,name,pos,scale,color,pad=.34){ const m=box(scene,name,pos,scale,color); G.arenaMeshes.push(m); addBlocker(m,pad); return m; }
function isBlockedXZ(x,z,radius=.34){
  return G.blockers.some(b=>{
    const m=b.mesh;if(!m||m.isDisposed?.())return false;
    try{m.computeWorldMatrix(true);const bb=m.getBoundingInfo().boundingBox;const mn=bb.minimumWorld,mx=bb.maximumWorld;const pad=(b.pad||0)+radius;return x>mn.x-pad&&x<mx.x+pad&&z>mn.z-pad&&z<mx.z+pad;}catch{return false;}
  });
}
function isBlockedPoint(x,y,z,radius=.08){
  return G.blockers.some(b=>{const m=b.mesh;if(!m||m.isDisposed?.())return false;try{m.computeWorldMatrix(true);const bb=m.getBoundingInfo().boundingBox,mn=bb.minimumWorld,mx=bb.maximumWorld;const pad=(b.pad||0)*.35+radius;return x>mn.x-pad&&x<mx.x+pad&&y>mn.y-radius&&y<mx.y+radius&&z>mn.z-pad&&z<mx.z+pad;}catch{return false;}});
}
function moveNpcWithCollision(npc,delta){
  const old=npc.root.position.clone(), next=old.add(delta); next.x=Math.max(-6.72,Math.min(6.72,next.x)); next.z=Math.max(-6.72,Math.min(6.72,next.z));
  const radius=npc.type==='boss'?.52:.34;
  if(!isBlockedXZ(next.x,next.z,radius)){npc.root.position.x=next.x;npc.root.position.z=next.z;return;}
  let moved=false;
  if(!isBlockedXZ(next.x,old.z,radius)){npc.root.position.x=next.x;moved=true;}
  if(!isBlockedXZ(npc.root.position.x,next.z,radius)){npc.root.position.z=next.z;moved=true;}
  if(!moved && delta.lengthSquared()>.000001){
    const side=new B.Vector3(-delta.z,0,delta.x).normalize().scale(delta.length()*1.25*(Math.sin(npc.t*1.7)>=0?1:-1));
    const alt=old.add(side); if(!isBlockedXZ(alt.x,alt.z,radius)){npc.root.position.x=alt.x;npc.root.position.z=alt.z;}
  }
}
function safeEnemySpawn(i=0,radius=.38){
  const spots=[[-5.9,-5.7],[5.9,-5.7],[-5.9,5.4],[5.9,5.4],[0,-6.0],[0,5.8],[-6.0,0],[6.0,0],[-4.8,0],[4.8,0],[0,-4.8],[0,4.8]];
  for(let k=0;k<spots.length;k++){const q=spots[(i+k)%spots.length];if(!isBlockedXZ(q[0],q[1],radius))return new B.Vector3(q[0]+(Math.random()-.5)*.22,0,q[1]+(Math.random()-.5)*.22);}
  return new B.Vector3((Math.random()-.5)*2,0,(Math.random()-.5)*2);
}
function waveEnemyCount(){ const lvl=G.meta.survivalLevel||1; return Math.min(11,3+G.wave+Math.floor((lvl-1)*.45)); }
function awardWaveCoins(){ G.meta.coins=(G.meta.coins||0)+10; saveMeta(); announce(`WAVE ${G.wave} CLEARED • +10 COINS`,'good'); tone(430,.16,'triangle',.04,180); }
function completeLevel(){ if(G.ended||G.state!=='shift')return; G.meta.survivalLevel=(G.meta.survivalLevel||1)+1; G.meta.shifts=(G.meta.shifts||0)+1; saveMeta(); G.ended=true; G.waveTransition=false; G.state='ending'; toast(`LEVEL COMPLETE • NEXT: LEVEL ${G.meta.survivalLevel}`,2500); G.endTimer=setTimeout(()=>{G.endTimer=null;buildHub(scene);},2300); }
function queueNextWave(){
  if(G.waveTransition||G.ended||G.state!=='shift')return;
  G.waveTransition=true; const cleared=G.wave, token=++G.waveToken; awardWaveCoins();
  for(const p of G.props)p.thrownByNPCUntil=0;for(const h of G.hazards){try{h.mesh.dispose()}catch{}}G.hazards=[];
  if(cleared>=5){setTimeout(()=>{if(token!==G.waveToken)return;G.waveTransition=false;completeLevel();},1200);return;}
  toast(`WAVE ${cleared} CLEAR • NEXT WAVE IN 2…`,1600); G.attackGrace=2.2;
  setTimeout(()=>{if(token!==G.waveToken||G.state!=='shift'||G.ended)return;G.wave=cleared+1;G.difficulty+=.15;G.waveTransition=false;if(G.wave===5){spawnBoss(scene);spawnWave(scene,Math.min(4,1+Math.floor((G.meta.survivalLevel||1)/3)));}else spawnWave(scene,waveEnemyCount());toast(`WAVE ${G.wave}/5`,1100);updateHUD();},1800);
}

function buildArena(scene){
  G.blockers=[];
  const map=G.meta.selectedMap||'FLOOR 13';
  const themes={
    'FLOOR 13':{floor:'#202632',wall:'#111722',accent:'#55b8ff',name:'FLOOR 13 • OPEN OFFICE'},
    'ARCHIVE':{floor:'#25282a',wall:'#151719',accent:'#7bd3a8',name:'ARCHIVE LOCKDOWN'},
    'BREAKROOM':{floor:'#30272a',wall:'#191318',accent:'#ff7186',name:'BREAKROOM AFTER HOURS'},
    'SERVER':{floor:'#151d23',wall:'#081018',accent:'#4fffd1',name:'SERVER BASEMENT'},
    'ROOFTOP':{floor:'#30343b',wall:'#12151c',accent:'#b4d7ff',name:'ROOFTOP OVERTIME'},
    'PARKING':{floor:'#292b2d',wall:'#17191b',accent:'#ffd05e',name:'PARKING GARAGE P3'},
    'HR MAZE':{floor:'#26242c',wall:'#17141d',accent:'#d497ff',name:'HR CUBICLE MAZE'},
    'IT LAB':{floor:'#19252b',wall:'#0c161a',accent:'#63ffe0',name:'IT REPAIR LAB'},
    'CAFETERIA':{floor:'#302c27',wall:'#1b1714',accent:'#ffb45f',name:'NIGHT CAFETERIA'},
    'PENTHOUSE':{floor:'#25232d',wall:'#111019',accent:'#e0bdff',name:'EXECUTIVE PENTHOUSE'}
  };
  const t=themes[map]||themes['FLOOR 13'];
  const floor=box(scene,'officeFloor',new B.Vector3(0,-.12,0),new B.Vector3(15,.2,15),t.floor); G.arenaMeshes.push(floor);
  [[-7.4,2,0,.2,4,15],[7.4,2,0,.2,4,15],[0,2,7.4,15,4,.2],[0,2,-7.4,15,4,.2]].forEach((w,i)=>fixedBox(scene,'wall'+i,new B.Vector3(w[0],w[1],w[2]),new B.Vector3(w[3],w[4],w[5]),i===2?'#0b1018':t.wall,.08));
  const panel=(x,y,z,sx,sy,sz,c)=>{const m=box(scene,'detailPanel',new B.Vector3(x,y,z),new B.Vector3(sx,sy,sz),c);G.arenaMeshes.push(m);return m;};
  const desk=(x,z,rot=0)=>{const d=fixedBox(scene,'desk',new B.Vector3(x,.72,z),new B.Vector3(1.85,.16,.9),'#5a4738',.22);d.rotation.y=rot;makeProp(scene,'monitor',new B.Vector3(x,.98,z),{material:'plastic',mass:4,damage:18,size:[.55,.42,.14]});makeProp(scene,'keyboard',new B.Vector3(x,.84,z-.3),{material:'plastic',mass:1,damage:9,size:[.58,.06,.2]});return d;};
  const pillar=(x,z,c='#454b54')=>fixedBox(scene,'pillar',new B.Vector3(x,1.5,z),new B.Vector3(.65,3,.65),c,.2);
  const rail=(x,z,sx,sz,c='#65707c')=>fixedBox(scene,'barrier',new B.Vector3(x,.65,z),new B.Vector3(sx,1.3,sz),c,.18);

  if(map==='FLOOR 13'){
    [[-3.8,-3.3],[3.8,-3.3],[-3.8,3.2],[3.8,3.2]].forEach(([x,z],i)=>desk(x,z,i%2?Math.PI:0));
    fixedBox(scene,'meetingTable',new B.Vector3(0,.72,0),new B.Vector3(2.7,.18,1.45),'#46505e',.3);
    pillar(-1.8,0);pillar(1.8,0);
    panel(0,2.55,7.25,4.5,.18,.04,t.accent); panel(-6.8,2.1,0,.05,2.4,3.5,'#223649');
  } else if(map==='ARCHIVE'){
    for(let z of [-3.6,-1.2,1.2,3.6]) for(let x of [-3.8,0,3.8]) fixedBox(scene,'archiveShelf',new B.Vector3(x,1.25,z),new B.Vector3(1.65,2.5,.48),'#3b4650',.28);
    rail(0,-5.8,4.5,.22,'#59636c'); makeProp(scene,'cart',new B.Vector3(0,.55,5.1),{material:'metal',mass:9,damage:30,size:[.8,1.05,.58]});
  } else if(map==='BREAKROOM'){
    [[-3.7,-2.7],[0,-2.7],[3.7,-2.7],[-1.8,2.4],[2.0,2.4]].forEach(([x,z])=>{fixedBox(scene,'canteenTable',new B.Vector3(x,.7,z),new B.Vector3(1.8,.15,1.05),'#6a5247',.24);makeProp(scene,'mug',new B.Vector3(x+.35,.9,z),{material:'ceramic',mass:.5,damage:14,size:[.18,.22,.18]});});
    fixedBox(scene,'kitchenCounter',new B.Vector3(0,.75,5.7),new B.Vector3(5.6,1.5,.7),'#4e555b',.25); makeProp(scene,'microwave',new B.Vector3(-2,.95,5.2),{material:'metal',mass:10,damage:34,size:[.7,.5,.55]});
  } else if(map==='SERVER'){
    for(let x of [-4.8,-2.4,0,2.4,4.8]){fixedBox(scene,'serverRack',new B.Vector3(x,1.45,2.6),new B.Vector3(1.05,2.9,.75),'#172735',.26);panel(x,1.5,2.18,.65,1.9,.04,'#1e8390');}
    for(let x of [-3.6,0,3.6])fixedBox(scene,'serverRackRear',new B.Vector3(x,1.45,-3.2),new B.Vector3(1.25,2.9,.75),'#172735',.26);
    makeProp(scene,'extinguisher',new B.Vector3(-5.7,.55,-5.4),{material:'metal',mass:4,damage:24,size:[.28,1,.28]});
  } else if(map==='ROOFTOP'){
    pillar(-4,-4,'#616974');pillar(4,-4,'#616974');pillar(-4,4,'#616974');pillar(4,4,'#616974');
    fixedBox(scene,'roofVentA',new B.Vector3(-2.7,.65,1.5),new B.Vector3(2.0,1.3,1.2),'#59626d',.25); fixedBox(scene,'roofVentB',new B.Vector3(2.5,.5,-2.0),new B.Vector3(1.6,1.0,1.5),'#59626d',.25);
    rail(0,6.7,12.5,.25); rail(0,-6.7,12.5,.25); rail(6.7,0,.25,12.5); rail(-6.7,0,.25,12.5);
  } else if(map==='PARKING'){
    for(let x of [-4.5,0,4.5])for(let z of [-3.4,3.4])pillar(x,z,'#66696d');
    rail(-2.8,0,3.6,.45,'#c09b37'); rail(3.0,1.7,3.4,.45,'#c09b37');
    panel(0,.03,0,12,.02,.18,'#d0b34b'); makeProp(scene,'cart',new B.Vector3(5,.55,-4.5),{material:'metal',mass:9,damage:30,size:[.8,1.05,.58]});
  } else if(map==='HR MAZE'){
    const walls=[[-4.2,-3.6,4.8,.25],[-.8,-1.5,.25,4.6],[3.2,-3.0,.25,5.0],[-3.2,1.7,.25,4.0],[1.7,2.2,4.2,.25],[4.1,4.5,.25,3.0]];
    walls.forEach(([x,z,sx,sz])=>fixedBox(scene,'cubicleWall',new B.Vector3(x,1.0,z),new B.Vector3(sx,2.0,sz),'#455166',.18));
    desk(-5.2,4.8);desk(4.8,-4.8);
  } else if(map==='IT LAB'){
    for(let x of [-4.5,-1.5,1.5,4.5]){desk(x,3.5);desk(x,-3.5,Math.PI);}
    fixedBox(scene,'repairBench',new B.Vector3(0,.8,0),new B.Vector3(3.4,.2,1.2),'#3d5157',.28); pillar(-5.6,0,'#2b6269');pillar(5.6,0,'#2b6269');
    for(let i=0;i<4;i++)makeProp(scene,'laptop',new B.Vector3(-2.1+i*1.4,1.0,0),{material:'metal',mass:2.5,damage:16,size:[.46,.1,.32]});
  } else if(map==='CAFETERIA'){
    for(let z of [-3.5,0,3.5])for(let x of [-3.6,0,3.6])fixedBox(scene,'cafeTable',new B.Vector3(x,.72,z),new B.Vector3(1.45,.14,.9),'#6b5543',.22);
    fixedBox(scene,'servingLine',new B.Vector3(-5.7,.8,0),new B.Vector3(.8,1.6,8.8),'#5a6066',.25); fixedBox(scene,'vending',new B.Vector3(5.75,1.1,3.7),new B.Vector3(.85,2.2,1.2),'#303b4a',.25);
  } else if(map==='PENTHOUSE'){
    fixedBox(scene,'execDesk',new B.Vector3(0,.78,4.2),new B.Vector3(4.3,.2,1.3),'#62472f',.32); fixedBox(scene,'conference',new B.Vector3(0,.75,-1.2),new B.Vector3(4.8,.18,1.6),'#3d3947',.3);
    pillar(-5,-2,'#504b59');pillar(5,-2,'#504b59'); panel(0,2.5,7.2,6,.2,.04,'#8e69b7');
    for(let i=0;i<6;i++){const a=i/6*Math.PI*2;makeProp(scene,'chair',new B.Vector3(Math.cos(a)*3.0,.5,-1.2+Math.sin(a)*1.6),{material:'metal',mass:6,damage:24,size:[.55,1,.55]});}
  }
  // universal detail/props
  for(let i=0;i<4;i++){makeProp(scene,'chair',new B.Vector3(-5.6+i*3.7,.5,-5.5+(i%2)*.8),{material:'metal',mass:6,damage:24,size:[.55,1,.55]});}
  makeProp(scene,'printer',new B.Vector3(-5.6,.62,5.4),{material:'plastic',mass:8,damage:30,size:[.75,.55,.65]});
  makeProp(scene,'watercooler',new B.Vector3(5.7,.8,5.35),{material:'plastic',mass:10,damage:34,size:[.55,1.6,.55]});
  const title=label(scene,`${t.name}\nLEVEL ${G.meta.survivalLevel||1}`,new B.Vector3(0,3.55,7.12),.5,t.accent); G.arenaMeshes.push(title);
  makeProp(scene,'camera',new B.Vector3(-1.0,.35,-1.0),{material:'plastic',mass:1.3,damage:8,size:[.34,.28,.5]});
}
function makeProp(scene,type,pos,opt={}){
  const s=opt.size||[.45,.45,.45], mesh=box(scene,'prop_'+type,pos,new B.Vector3(...s),type==='mug'?'#d9e2e8':type==='printer'?'#767d87':type==='chair'?'#394452':type==='camera'?'#16191f':'#2f6a87');
  mesh.metadata={kind:'prop'}; const p={mesh,type,material:opt.material||'plastic',mass:opt.mass||2,damage:opt.damage||12,integrity:opt.integrity||Math.max(18,(opt.mass||2)*10),vel:B.Vector3.Zero(),ang:B.Vector3.Zero(),heldBy:null,npcOwner:null,grounded:true,life:0,lastHit:0,broken:false}; G.props.push(p); return p;
}

function spawnBat(scene){
  if(G.batMesh) try{G.batMesh.dispose(false,true)}catch{};
  const bd=selectedBatDef(); const root=new B.TransformNode('batRoot',scene);
  const bodyMat=mat(scene,'batBodyMat',bd.color,.62), handleMat=mat(scene,'batHandleMat',bd.handle||'#151515',.95), ringMat=mat(scene,'batRingMat',bd.ring||'#eeeeee',.32);
  const barrel=B.MeshBuilder.CreateCylinder('batBarrel',{height:.92,diameterTop:.14,diameterBottom:.085,tessellation:16},scene); barrel.parent=root; barrel.position.y=.44; barrel.material=bodyMat;
  const handle=B.MeshBuilder.CreateCylinder('batHandle',{height:.42,diameterTop:.085,diameterBottom:.105,tessellation:14},scene); handle.parent=root; handle.position.y=-.23; handle.material=handleMat;
  for(let i=0;i<5;i++){const wrap=B.MeshBuilder.CreateTorus('gripWrap'+i,{diameter:.108,thickness:.012,tessellation:14},scene);wrap.parent=root;wrap.position.y=-.39+i*.075;wrap.rotation.x=Math.PI/2;wrap.material=ringMat;}
  const knob=B.MeshBuilder.CreateCylinder('batKnob',{height:.07,diameter:.15,tessellation:16},scene);knob.parent=root;knob.position.y=-.47;knob.material=ringMat;
  const collar=B.MeshBuilder.CreateTorus('batCollar',{diameter:.13,thickness:.018,tessellation:16},scene);collar.parent=root;collar.position.y=.03;collar.rotation.x=Math.PI/2;collar.material=ringMat;
  const logo=B.MeshBuilder.CreateBox('batLogo',{width:.055,height:.18,depth:.008},scene);logo.parent=root;logo.position=new B.Vector3(0,.58,.071);logo.material=ringMat;
  if(bd.ability&&bd.ability!=='BALANCED'&&bd.ability!=='DURABLE'){ringMat.emissiveColor=B.Color3.FromHexString(bd.ring||'#ffffff').scale(.35);for(let i=0;i<2;i++){const effectRing=B.MeshBuilder.CreateTorus('abilityRing'+i,{diameter:.155+i*.015,thickness:.012,tessellation:16},scene);effectRing.parent=root;effectRing.position.y=.28+i*.34;effectRing.rotation.x=Math.PI/2;effectRing.material=ringMat;}}
  if(bd.ability==='KNOCKBACK'){const cap=B.MeshBuilder.CreateCylinder('heavyCap',{height:.11,diameter:.19,tessellation:14},scene);cap.parent=root;cap.position.y=.86;cap.material=ringMat;}
  if(bd.ability==='EXECUTE'){const fin=B.MeshBuilder.CreateBox('execFin',{width:.035,height:.32,depth:.17},scene);fin.parent=root;fin.position.y=.5;fin.material=ringMat;fin.rotation.y=Math.PI/4;}
  const tip=B.MeshBuilder.CreateSphere('batTip',{diameter:.15,segments:12},scene);tip.parent=root;tip.position.y=.92;tip.scaling.y=.55;tip.material=bodyMat;
  root.metadata={kind:'bat'}; G.batMesh=root; G.batTip=tip; if(G.right)attachBatToController(G.right);
}

class NPC{
  constructor(scene,pos,type='worker'){
    this.scene=scene; this.type=type; this.role=type==='boss'?'boss':(Math.random()<.07?'thrower':Math.random()<.5?'flanker':'pressure');
    const roleStats=this.role==='thrower'?{hp:.9,speed:.9,damage:.62}:this.role==='flanker'?{hp:.94,speed:1.18,damage:.9}:{hp:1.12,speed:1.0,damage:1.08};
    const lvl=G.meta.survivalLevel||1,scale=1+(lvl-1)*.10+(G.wave-1)*.12; this.hp=(type==='boss'?420+lvl*70:(82+Math.random()*22)*roleStats.hp*scale); this.maxHp=this.hp; this.speed=(type==='boss'?1.22:(1.0+Math.random()*.42)*roleStats.speed)*Math.min(1.28,1+(lvl-1)*.018+(G.wave-1)*.025); this.damage=(type==='boss'?17+lvl*1.2:(7+Math.random()*4.5)*roleStats.damage)*Math.min(1.8,1+(lvl-1)*.07+(G.wave-1)*.08); this.state='seek'; this.t=0; this.attackT=Math.random(); this.windup=0; this.pendingAttack=''; this.hesitate=Math.random()*.5; this.prop=null; this.dead=false; this.lastBatHit=0; this.phase=1; this.throwWindup=0; this.burnT=0;this.burnDps=0;this.poisonT=0;this.poisonDps=0;this.slowT=0;
    this.root=new B.TransformNode('npc',scene); this.root.position.copyFrom(pos);
    const pal=npcPalette(this.role,type); const scaleBody=type==='boss'?1.18:1;
    const body=capsule(scene,'npcBody',new B.Vector3(0,1.08,0),.95*scaleBody,.24*scaleBody,pal.shirt,this.root);body.scaling.z=.78;
    const hips=B.MeshBuilder.CreateSphere('npcHips',{diameter:.46*scaleBody,segments:10},scene);hips.position=new B.Vector3(0,.56,0);hips.scaling=new B.Vector3(1.15,.62,.82);hips.material=mat(scene,'npcHipsMat',type==='boss'?'#351219':'#20242c',.88);hips.parent=this.root;
    const head=B.MeshBuilder.CreateSphere('npcHead',{diameter:(type==='boss'?.52:.44),segments:12},scene); head.position=new B.Vector3(0,type==='boss'?1.88:1.76,0); head.material=mat(scene,'skin',pal.skin,.95); head.parent=this.root;
    const eyeMat=mat(scene,'npcEyeMat','#14161b',.8);for(const ex of [-.075,.075]){const eye=B.MeshBuilder.CreateSphere('npcEye',{diameter:.045,segments:6},scene);eye.parent=head;eye.position=new B.Vector3(ex,.035,.205);eye.material=eyeMat;}
    const tie=box(scene,'npcTie',new B.Vector3(0,1.12,-.245),new B.Vector3(.065,.34,.028),pal.accent,this.root);
    const armL=capsule(scene,'npcArmL',new B.Vector3(-.34,1.12,0),.58,.07,pal.shirt,this.root); armL.rotation.z=.22;
    const armR=capsule(scene,'npcArmR',new B.Vector3(.34,1.12,0),.58,.07,pal.shirt,this.root); armR.rotation.z=-.22;
    const legL=capsule(scene,'npcLegL',new B.Vector3(-.13,.23,0),.55,.075,'#252933',this.root);
    const legR=capsule(scene,'npcLegR',new B.Vector3(.13,.23,0),.55,.075,'#252933',this.root);
    this.armL=armL;this.armR=armR;this.legL=legL;this.legR=legR;this.bodyVisual=body;
    if(this.role==='thrower'){ const glasses=box(scene,'npcGlasses',new B.Vector3(0,1.78,.205),new B.Vector3(.33,.08,.025),'#111319',this.root); this.hitMeshes=[body,hips,head,tie,armL,armR,legL,legR,glasses]; }
    else { this.hitMeshes=[body,hips,head,tie,armL,armR,legL,legR]; }
    this.hitMeshes.forEach(m=>m.metadata={npc:this});
    this.nameLabel=label(scene,type==='boss'?'LEVEL BOSS':(this.role==='thrower'?'THROWER':this.role==='flanker'?'FLANKER':'PRESSURE'),new B.Vector3(0,2.32,0),.32,type==='boss'?'#ff6680':'#ffffff'); this.nameLabel.parent=this.root; this.nameLabel.position=new B.Vector3(0,2.32,0);
    const hbMat=new B.StandardMaterial('hpBgMat',scene); hbMat.diffuseColor=new B.Color3(.06,.06,.07); hbMat.emissiveColor=new B.Color3(.06,.06,.07); hbMat.disableLighting=true; const hfMat=new B.StandardMaterial('hpFillMat',scene); hfMat.diffuseColor=type==='boss'?new B.Color3(1,.18,.3):new B.Color3(.18,.95,.34); hfMat.emissiveColor=hfMat.diffuseColor.scale(.8); hfMat.disableLighting=true; this.hpBarBg=B.MeshBuilder.CreatePlane('npcHpBg',{width:.95,height:.12},scene); this.hpBarBg.parent=this.root; this.hpBarBg.position=new B.Vector3(0,2.12,-.015); this.hpBarBg.billboardMode=B.Mesh.BILLBOARDMODE_Y; this.hpBarBg.material=hbMat; this.hpBarFill=B.MeshBuilder.CreatePlane('npcHpFill',{width:.89,height:.075},scene); this.hpBarFill.parent=this.root; this.hpBarFill.position=new B.Vector3(0,2.12,-.03); this.hpBarFill.billboardMode=B.Mesh.BILLBOARDMODE_Y; this.hpBarFill.material=hfMat;
  }
  dispose(){ if(this.prop)this.dropProp(); try{this.root.dispose(false,true)}catch{} }
  dropProp(){ if(!this.prop)return; const p=this.prop; const world=p.mesh.getAbsolutePosition().clone(); p.mesh.setParent(null); p.mesh.position.copyFrom(world); p.npcOwner=null; p.vel=new B.Vector3((Math.random()-.5)*2,1,(Math.random()-.5)*2); this.prop=null; }
  claimProp(){
    let best=null,bd=3.2; for(const p of G.props){ if(p.heldBy||p.npcOwner||p.broken||p.mass>9)continue; const d=B.Vector3.Distance(p.mesh.getAbsolutePosition(),this.root.position); if(d<bd){best=p;bd=d;} }
    if(best){ this.prop=best; best.npcOwner=this; best.mesh.parent=this.root; best.mesh.position=new B.Vector3(.52,1.05,-.12); best.grounded=false; tone(190,.05,'square',.02); }
  }
  throwProp(playerPos){ if(!this.prop)return; const p=this.prop; p.mesh.setParent(null); p.mesh.position=this.root.position.add(new B.Vector3(0,1.2,0)); let d=playerPos.subtract(p.mesh.position).normalize(); p.vel=d.scale(4.2+Math.min(1.1,G.wave*.12)).add(new B.Vector3(0,.82,0)); p.npcOwner=null; p.thrownByNPCUntil=performance.now()+2200; this.prop=null; impactSound(p.material,.7); }
  hit(dmg,dir,kind='bat'){
    if(this.dead)return; this.hp-=dmg; if(this.hpBarFill){const f=Math.max(0,this.hp/this.maxHp);this.hpBarFill.scaling.x=f;this.hpBarFill.position.x=-(.89*(1-f))/2;} this.root.position.addInPlace(dir.scale(.04)); addScore(kind==='prop'?70:55,kind==='prop'?'IMPROVISED':'HIT'); if(kind==='prop')G.propHits++;
    if(this.prop && Math.random()<.35)this.dropProp(); this.attackT=Math.max(this.attackT,.12); if(this.type==='boss'){const next=this.hp<this.maxHp*.32?3:this.hp<this.maxHp*.67?2:1;if(next!==this.phase){this.phase=next;announce(`BOSS PHASE ${next}`,'boss');tone(62-next*4,.3,'sawtooth',.05,55);}} if(this.hp<=0)this.die(dir);
  }
  die(dir){ this.dead=true;this.ragdollT=1.2;this.ragdollVel=(dir?.clone?.()||new B.Vector3(0,0,1)).scale(this.type==='boss'?1.4:2.4).add(new B.Vector3(0,this.type==='boss'?.8:1.4,0));this.ragdollSpin=(Math.random()<.5?-1:1)*(this.type==='boss'?1.2:2.3); G.kills++; addScore(this.type==='boss'?1600:320,this.type==='boss'?'BOSS DOWN':'KO'); tone(this.type==='boss'?70:110,.18,'sawtooth',.05,-50); this.dropProp(); for(const m of this.hitMeshes)m.material.albedoColor.scaleInPlace(.55); setTimeout(()=>{this.dispose(); G.npcs=G.npcs.filter(n=>n!==this);},1250); if(this.type!=='boss'&&G.upgrade.recovery>0)G.hp=Math.min(G.maxHp,G.hp+G.upgrade.recovery); if(G.kills>=G.nextPromotion){ promote(); G.nextPromotion+=G.promotionEvery; } if(this.type==='boss'){ toast('FINAL WAVE BOSS DOWN',1800); } }
  update(dt,playerPos){
    if(this.dead){if(this.ragdollT>0){this.ragdollT-=dt;this.ragdollVel.y-=5.5*dt;const d=this.ragdollVel.scale(dt);moveNpcWithCollision(this,d);this.root.position.y=Math.max(0,this.root.position.y+d.y);this.root.rotation.z+=this.ragdollSpin*dt;}return;} this.t+=dt;
    if(this.burnT>0){this.burnT=Math.max(0,this.burnT-dt);this.hp-=this.burnDps*dt;}
    if(this.poisonT>0){this.poisonT=Math.max(0,this.poisonT-dt);this.hp-=this.poisonDps*dt;}
    if(this.slowT>0)this.slowT=Math.max(0,this.slowT-dt);
    if(this.hpBarFill){const f=Math.max(0,this.hp/this.maxHp);this.hpBarFill.scaling.x=f;this.hpBarFill.position.x=-(.89*(1-f))/2;}
    if(this.hp<=0){this.die(new B.Vector3(0,0,1));return;}
    this.attackT=Math.max(0,this.attackT-dt);
    if(this.throwWindup>0){this.throwWindup-=dt;if(this.armR)this.armR.rotation.x=-1.1+this.throwWindup*.5;if(this.throwWindup<=0&&this.prop){this.throwProp(playerPos);this.attackT=2.35+Math.random()*.55;}return;}
    if(this.windup>0){this.windup-=dt;if(this.armR)this.armR.rotation.x=-.9;if(this.windup<=0){npcAttack(this,this.pendingAttack==='prop'?this.damage*.82:this.damage,this.pendingAttack==='prop'?'IMPROVISED HIT':'PAPERWORK PUNCH');this.pendingAttack='';this.attackT=this.type==='boss'?.72:1.15+Math.random()*.55;}return;}
    const to=playerPos.subtract(this.root.position), dist=Math.sqrt(to.x*to.x+to.z*to.z), dir=new B.Vector3(to.x,0,to.z); if(dir.lengthSquared()>0.001)dir.normalize(); this.root.rotation.y=Math.atan2(dir.x,dir.z);
    const stride=Math.sin(this.t*7)*Math.min(1,dist/2);if(this.armL){this.armL.rotation.x=stride*.38;this.armR.rotation.x=-stride*.38;this.legL.rotation.x=-stride*.28;this.legR.rotation.x=stride*.28;}if(this.bodyVisual)this.bodyVisual.position.y=1.08+Math.abs(Math.sin(this.t*7))*.025;
    if(this.type==='boss'){
      const rate=this.phase===3?.48:this.phase===2?.32:.2; if(Math.random()<dt*rate && G.hazards.length<4)spawnHazard(this.scene,playerPos,this.phase);
    }
    if(!this.prop && this.role==='thrower' && dist<5.4 && Math.random()<dt*.42) this.claimProp();
    if(this.prop){ if(dist>2.35){moveNpcWithCollision(this,dir.scale(this.speed*(this.slowT>0?.62:1)*dt*.75));} else if(this.attackT<=0){ if(this.role==='thrower' || dist>1.45){this.throwWindup=.72; this.attackT=.72; announce('INCOMING THROW','danger');} else {this.windup=.34;this.pendingAttack='prop';announce('INCOMING SWING','danger');} } return; }
    if(this.role==='flanker' && dist>1.4){ const side=new B.Vector3(-dir.z,0,dir.x).scale(Math.sin(this.t*1.6)*.8); moveNpcWithCollision(this,dir.add(side).normalize().scale(this.speed*(this.slowT>0?.62:1)*dt)); }
    else if(dist>1.15) moveNpcWithCollision(this,dir.scale(this.speed*(this.slowT>0?.62:1)*dt));
    else if(this.attackT<=0){ if(G.chaos>75 && Math.random()<.14){this.attackT=.55;return;} this.windup=this.type==='boss'?.42:.3; this.pendingAttack='fist'; if(this.type==='boss')announce('MANAGER ATTACK','danger'); }
  }}

function spawnWave(scene,count){
  count=Math.max(1,Math.min(11,count)); for(let i=0;i<count;i++)G.npcs.push(new NPC(scene,safeEnemySpawn(i,.38),'worker'));
}
function spawnBoss(scene){ if(G.bossSpawned)return; G.bossSpawned=true; G.attackGrace=1.1; const b=new NPC(scene,safeEnemySpawn(5,.55),'boss'); G.boss=b; G.npcs.push(b); announce(`LEVEL ${G.meta.survivalLevel||1} • FINAL WAVE BOSS`,'boss'); tone(58,.6,'sawtooth',.06,70); }
function spawnHazard(scene,target,phase=1){
  if(!scene||G.state!=='shift'||G.waveTransition)return;
  const m=B.MeshBuilder.CreateCylinder('hazard',{diameter:1.6,height:.025,tessellation:32},scene);m.position=new B.Vector3(target.x,.02,target.z);
  const mm=new B.StandardMaterial('hazmat',scene);mm.diffuseColor=new B.Color3(.8,.05,.12);mm.emissiveColor=new B.Color3(.5,.01,.03);mm.alpha=.45;m.material=mm;m.scaling.scaleInPlace(1+(phase-1)*.18);
  const h={mesh:m,t:phase===3?.92:1.15,armed:false,damage:16+phase*4};G.hazards.push(h);
  setTimeout(()=>{if(!m||m.isDisposed?.()||G.state!=='shift')return;h.armed=true;m.scaling.scaleInPlace(1.6);tone(95,.12,'square',.04,100);},800);
}
function incident(scene){
  if(G.state!=='shift'||G.waveTransition||G.boss)return;
  const pool=['LIGHTS OUT','PRINTER PANIC','COFFEE RUSH','FIRE DRILL'].filter(x=>x!==G.lastIncident);const x=pool[Math.floor(Math.random()*pool.length)];G.lastIncident=x;
  announce(`OFFICE INCIDENT • ${x}`,x==='COFFEE RUSH'?'good':'danger');tone(160,.12,'sawtooth',.035,140);
  if(x==='PRINTER PANIC'){for(let i=0;i<2;i++){const p=makeProp(scene,'printer',safeEnemySpawn(i,.3).add(new B.Vector3(0,.7,0)),{material:'plastic',mass:8,damage:28,size:[.75,.55,.65]});p.vel=new B.Vector3((Math.random()-.5)*4,2.4,(Math.random()-.5)*4);}}
  if(x==='COFFEE RUSH'){G.attackGrace=Math.max(G.attackGrace,1.1);G.chaos=Math.min(100,G.chaos+8);}
  if(x==='FIRE DRILL'){G.chaos=Math.min(100,G.chaos+16);G.attackGrace=Math.max(G.attackGrace,.7);}
  if(x==='LIGHTS OUT'){const l=scene.getLightByName('hemi');if(l){l.intensity=.18;setTimeout(()=>{const ll=scene.getLightByName('hemi');if(ll)ll.intensity=.55;},4200);}}
}

function damagePlayer(v,why='HIT'){
  v=(v/G.upgrade.defense)*skinDefenseMul(); if(why==='BOSS HAZARD'&&skinAbility()==='Hazard Guard')v*=.72; G.hp=Math.max(0,G.hp-v); G.damageFlashT=.18; toast(`-${Math.round(v)} HP • ${why}`,650); tone(80,.07,'square',.035,-30); if(G.hp<=0)endShift('TERMINATED');
}
function promote(){
  const opts=[]; if(G.upgrade.power<1.6)opts.push('power'); if(G.upgrade.defense<1.5)opts.push('defense'); if(G.upgrade.improvised<1.7)opts.push('improvised'); if(G.upgrade.durability<1.6)opts.push('durability'); opts.push('recovery'); const k=opts[Math.floor(Math.random()*opts.length)];
  if(k==='power')G.upgrade.power+=.12; if(k==='defense')G.upgrade.defense+=.1; if(k==='improvised')G.upgrade.improvised+=.15; if(k==='durability')G.upgrade.durability+=.12; if(k==='recovery')G.upgrade.recovery+=3;
  G.hp=Math.min(G.maxHp,G.hp+10); const names={power:'POWER PLAY',defense:'HR ARMOR',improvised:'OFFICE MENACE',durability:'LOCKED IN',recovery:'SECOND WIND'}; toast(`PROMOTION • ${names[k]}`,1800); tone(330,.18,'triangle',.04,260);
}
function damageBat(v){ if(G.bat.broken)return; G.bat.durability=Math.max(0,G.bat.durability-v/G.upgrade.durability); const pct=G.bat.durability/G.bat.max; const c=pct<.25?3:pct<.5?2:pct<.75?1:0; if(c>G.bat.crack){G.bat.crack=c; if(G.batMesh){G.batMesh.scaling.x=1-c*.035;G.batMesh.scaling.z=1-c*.035;} tone(210-c*35,.09,'square',.04,-90); toast(c===3?'BAT CRITICAL':'BAT CRACKED',900);} if(G.bat.durability<=0)breakBat(); }
function breakBat(){ G.bat.broken=true; G.bat.respawnT=4.5; if(G.batMesh)G.batMesh.setEnabled(false); tone(95,.22,'square',.07,-60); toast('BAT BROKE • USE THE OFFICE',1800); }
function restoreBat(){ G.bat.broken=false; G.bat.durability=G.bat.max; G.bat.crack=0; if(G.batMesh){G.batMesh.setEnabled(true);G.batMesh.scaling.copyFromFloats(1,1,1);} tone(250,.08,'triangle',.035,120); toast('REPLACEMENT BAT',1000); }

function playerPos(scene){ const cam=scene.activeCamera; return cam?.globalPosition||cam?.position||new B.Vector3(0,1.6,0); }
function endShift(reason){
  if(G.ended||G.state!=='shift')return; G.ended=true; G.waveTransition=false; G.waveToken++; G.state='ending'; G.meta.totalKOs=(G.meta.totalKOs||0)+G.kills; G.meta.bestCombo=Math.max(G.meta.bestCombo||0,G.bestCombo); saveMeta();
  toast(`${reason} • LEVEL ${G.meta.survivalLevel||1} • COINS ${G.meta.coins}`,2400); G.endTimer=setTimeout(()=>{G.endTimer=null;buildHub(scene);},2200);
}


function updateJoystickMovement(scene,dt){
  if(!G.xr||G.desktop)return; const cam=G.xr.baseExperience?.camera; if(!cam)return;
  const dead=.16, x=Math.abs(G.joystick.x)>dead?G.joystick.x:0, y=Math.abs(G.joystick.y)>dead?G.joystick.y:0;
  if(x||y){const f=cam.getDirection(B.Axis.Z);f.y=0;if(f.lengthSquared()>.001)f.normalize();const r=cam.getDirection(B.Axis.X);r.y=0;if(r.lengthSquared()>.001)r.normalize();const speed=(G.meta.settings?.moveSpeed||2.2)*skinMoveMul();const d=f.scale(-y*speed*dt).add(r.scale(x*speed*dt));if(G.state==='shift'){const ox=cam.position.x,oz=cam.position.z,nx=ox+d.x,nz=oz+d.z;if(!isBlockedXZ(nx,nz,.28)){cam.position.x=nx;cam.position.z=nz;}else{if(!isBlockedXZ(nx,oz,.28))cam.position.x=nx;if(!isBlockedXZ(cam.position.x,nz,.28))cam.position.z=nz;}}else cam.position.addInPlace(d);}
  const turn=Math.abs(G.turnAxis)>.72?Math.sign(G.turnAxis):0;
  if(turn&&!G.turnLatch){G.turnLatch=true;const a=(G.meta.settings?.snapTurn||30)*Math.PI/180*turn;cam.rotationQuaternion=cam.rotationQuaternion||B.Quaternion.Identity();cam.rotationQuaternion=B.Quaternion.RotationAxis(B.Axis.Y,a).multiply(cam.rotationQuaternion);tone(180,.025,'sine',.01);}
  if(!turn)G.turnLatch=false;
}
function updateRisers(dt){for(const r of G.risers){if(!r.root||r.root.isDisposed?.())continue;r.t-=dt;if(r.t>0)continue;const d=r.targetY-r.root.position.y;r.root.position.y+=d*Math.min(1,dt*7);}}

function tick(scene){
  const now=performance.now(),dt=Math.min(.033,(now-G.lastT)/1000); G.lastT=now; updateRisers(dt); updateJoystickMovement(scene,dt); updatePlayerBodyVisual(dt); const pp=playerPos(scene); if(G.state==='shift'){
    G.shiftTime+=dt; G.directorT+=dt; G.incidentT+=dt; G.attackGrace=Math.max(0,G.attackGrace-dt); G.damageFlashT=Math.max(0,G.damageFlashT-dt); const key=scene.getLightByName('key'); if(key)key.intensity=G.damageFlashT>0?1.7:1.15; G.musicT-=dt; if(G.musicT<=0){G.musicT=G.boss?.38:G.chaos>70?.48:.72;musicPulse();} if(G.comboT>0){G.comboT-=dt;if(G.comboT<=0)G.combo=0;} else G.chaos=Math.max(0,G.chaos-dt*1.6);
    if(G.bat.broken){G.bat.respawnT-=dt;if(G.bat.respawnT<=0)restoreBat();}
    for(const n of [...G.npcs])n.update(dt,pp);
    updateProps(dt,pp); updateHazards(dt,pp); updateBatCombat(scene,dt); objectiveTick();
    const alive=G.npcs.filter(n=>!n.dead).length;
    if(alive===0&&!G.waveTransition) queueNextWave();
    if(G.incidentT>22 && !G.boss){G.incidentT=0;incident(scene);}
  } else if(G.state==='hub'){updateProps(dt,pp);}
  updateHUD();
}

function updateHazards(dt,pp){ if(G.hazards.length>6){for(const h of G.hazards.splice(0,G.hazards.length-6)){try{h.mesh.dispose()}catch{}}} for(const h of [...G.hazards]){ h.t-=dt; if(h.armed && h.t<.25 && B.Vector3.DistanceSquared(h.mesh.position,new B.Vector3(pp.x,h.mesh.position.y,pp.z))<2.0){damagePlayer(h.damage||18,'BOSS HAZARD');h.armed=false;} if(h.t<=0){h.mesh.dispose();G.hazards.splice(G.hazards.indexOf(h),1);} } }
function updateProps(dt,pp){
  if(G.props.length>64){for(const p of [...G.props]){if(G.props.length<=64)break;if(!p.heldBy&&!p.npcOwner&&p.type!=='camera')disposeProp(p);}}
  for(const p of [...G.props]){ if(p.heldBy||p.npcOwner)continue; if(p.vel.lengthSquared()<.003){p.vel.scaleInPlace(.85);continue;} p.grounded=false; p.vel.y-=9.81*dt; const old=p.mesh.position.clone();p.mesh.position.addInPlace(p.vel.scale(dt));if(G.state==='shift'&&isBlockedPoint(p.mesh.position.x,p.mesh.position.y,p.mesh.position.z,.08)){p.mesh.position.x=old.x;p.mesh.position.z=old.z;p.vel.x*=-.22;p.vel.z*=-.22;} p.vel.scaleInPlace(.994); if(p.mesh.position.y<.12){p.mesh.position.y=.12;p.vel.y=Math.abs(p.vel.y)*.18;p.vel.x*=.72;p.vel.z*=.72; if(Math.abs(p.vel.y)<.5)p.vel.y=0;} if(Math.abs(p.mesh.position.x)>8.5||Math.abs(p.mesh.position.z)>8.5){p.mesh.position.x=Math.max(-7,Math.min(7,p.mesh.position.x));p.mesh.position.z=Math.max(-7,Math.min(7,p.mesh.position.z));p.vel.scaleInPlace(.35);}
    const speed=p.vel.length(); if(speed>2.8){ for(const n of G.npcs){ if(n.dead)continue; const d=B.Vector3.Distance(p.mesh.position,n.root.position.add(new B.Vector3(0,1,0))); if(d<.8 && performance.now()-p.lastHit>450){p.lastHit=performance.now(); n.hit(p.damage*Math.min(1.8,speed/5)*G.upgrade.improvised*skinPropMul(),p.vel.normalize(),'prop'); impactSound(p.material,Math.min(1,speed/8)); p.integrity-=Math.max(1,speed*.9); if(p.integrity<=0&&!p.broken){p.broken=true;addScore(120,'PROPERTY DAMAGE');tone(150,.08,'square',.025,-70);p.mesh.scaling.scaleInPlace(.72);p.damage*=.62;} p.vel.scaleInPlace(.35);} }
      if(B.Vector3.Distance(p.mesh.position,pp)<.65 && (p.thrownByNPCUntil||0)>performance.now() && performance.now()-p.lastHit>450){p.lastHit=performance.now();damagePlayer(Math.max(2,Math.min(8,p.damage*.22)),'THROWN OBJECT');p.thrownByNPCUntil=0;p.vel.scaleInPlace(.22);} }
  }
}

function attachBatToController(ctrl){ if(!G.batMesh||!ctrl)return; G.batMesh.parent=ctrl.grip||ctrl.pointer; G.batMesh.position=new B.Vector3(0,0,-.08); G.batMesh.rotationQuaternion=B.Quaternion.FromEulerAngles(Math.PI/2,0,0); }
function applyCombatAbility(n,dir){
  if(!n||n.dead)return; const bat=selectedBatDef(), sa=skinAbility(); const a=bat.ability||'';
  if(a==='BURN'||sa==='Burn'){n.burnT=Math.max(n.burnT,2.8);n.burnDps=Math.max(n.burnDps,5.5);}
  if(a==='POISON'||sa==='Poison'){n.poisonT=Math.max(n.poisonT,4);n.poisonDps=Math.max(n.poisonDps,3.4);}
  if(a==='SLOW'||sa==='Slow'){n.slowT=Math.max(n.slowT,2.4);}
  if(a==='KNOCKBACK'||sa==='Knockback'){moveNpcWithCollision(n,dir.scale(n.type==='boss'?.28:.7));}
  if(a==='EXECUTE'&&n.hp>0&&n.hp<n.maxHp*.18)n.hit(Math.min(42,n.maxHp*.12),dir,'ability');
  if(a==='CHAIN'||sa==='Chain'){const other=G.npcs.find(o=>o!==n&&!o.dead&&B.Vector3.Distance(o.root.position,n.root.position)<2.6);if(other&&Math.random()<.3){other.hit(10,dir,'ability');tone(680,.045,'square',.025,-180);}}
  if(a==='COMBO'){G.combo=Math.min(99,G.combo+1);G.comboT=3.5;}
  if(a==='SCORE'||sa==='Bonus Score')G.score+=20;
}
function updateBatCombat(scene,dt){
  if(G.bat.broken||!G.batMesh||!G.right)return; const st=G.handState.get('right'); if(!st)return; const p=(G.batTip||G.batMesh).getAbsolutePosition(); if(!st.prevBat)st.prevBat=p.clone(); const vel=p.subtract(st.prevBat).scale(1/Math.max(dt,.008)); st.prevBat.copyFrom(p); const speed=vel.length(); if(speed<1.9)return; for(const n of G.npcs){if(n.dead)continue; if(performance.now()-n.lastBatHit<330)continue; const center=n.root.position.add(new B.Vector3(0,1.1,0)); if(B.Vector3.Distance(p,center)<.95){n.lastBatHit=performance.now(); const dmg=(12+speed*5.5)*G.upgrade.power; n.hit(dmg,vel.normalize(),'bat'); applyCombatAbility(n,vel.normalize()); damageBat(.8+speed*.16); impactSound('wood',Math.min(1,speed/8)); haptic(G.right,Math.min(1,.25+speed*.07),40);}}
}

async function setupXR(scene){
  if(G.xr)return G.xr; ui.status.textContent='Preparing WebXR…'; const xr=await scene.createDefaultXRExperienceAsync({floorMeshes:[]}); G.xr=xr;
  xr.input.onControllerAddedObservable.add(ctrl=>{
    ctrl.onMotionControllerInitObservable.add(mc=>{
      const handed=ctrl.inputSource.handedness||'none'; G.handState.set(handed,{ctrl,grabbing:null,prevPos:null,prevBat:null}); if(handed==='right'){G.right=ctrl;attachBatToController(ctrl);} if(handed==='left')G.left=ctrl; buildHandVisual(scene,handed,ctrl); refreshPlayerCosmetics();
      const grip=mc.getComponent('xr-standard-squeeze'); if(grip){ grip.onButtonStateChangedObservable.add(()=>{ if(grip.changes.pressed){ if(grip.pressed)tryGrab(scene,handed,ctrl); else releaseGrab(handed,ctrl); } }); }
      const trig=mc.getComponent('xr-standard-trigger'); if(trig){ trig.onButtonStateChangedObservable.add(()=>{if(trig.changes.pressed&&trig.pressed)triggerInteract(scene,ctrl);}); }
      const stick=mc.getComponent('xr-standard-thumbstick'); if(stick){stick.onAxisValueChangedObservable.add(v=>{if(handed==='left'){G.joystick.x=v.x||0;G.joystick.y=v.y||0;}else if(handed==='right'){G.turnAxis=v.x||0;}});}
    });
  });
  xr.input.onControllerRemovedObservable.add(ctrl=>{
    const handed=ctrl.inputSource?.handedness||'none';
    releaseGrab(handed,ctrl);
    G.handState.delete(handed);
    if(G.handVisuals[handed]){disposeMeshSafe(G.handVisuals[handed]); G.handVisuals[handed]=null;}
    if(handed==='right')G.right=null;
    if(handed==='left'){G.left=null;G.joystick.set(0,0);} if(handed==='right')G.turnAxis=0; refreshPlayerCosmetics();
  });
  xr.baseExperience.sessionManager.onXRSessionInit.add(()=>{ui.boot.style.display='none';ui.hud.style.display='flex';});
  xr.baseExperience.sessionManager.onXRSessionEnded.add(()=>{
    for(const [hand,st] of [...G.handState]) releaseGrab(hand,st.ctrl);
    G.handState.clear(); G.right=null; G.left=null; clearPlayerVisuals();
    ui.boot.style.display='flex';
  });
  return xr;
}

function controllerPos(ctrl){ return (ctrl.grip||ctrl.pointer)?.absolutePosition?.clone?.() || (ctrl.grip||ctrl.pointer)?.getAbsolutePosition?.() || B.Vector3.Zero(); }
function triggerInteract(scene,ctrl){ if(G.state==='shift'){const handed=ctrl.inputSource?.handedness||'none';const st=G.handState.get(handed);if(st?.grabbing?.type==='camera'){addScore(65,'SNAPSHOT');tone(720,.04,'square',.03,-180);haptic(ctrl,.25,25);toast('OFFICE CAM • SNAPSHOT',700);return;}return;} if(G.state!=='hub')return; const node=ctrl.pointer||ctrl.grip; if(!node)return; const origin=node.getAbsolutePosition(); const fwd=B.Vector3.TransformNormal(new B.Vector3(0,0,1),node.getWorldMatrix()).normalize(); const ray=new B.Ray(origin,fwd,8); const hit=scene.pickWithRay(ray,m=>m.metadata?.interact); if(hit?.hit&&hit.pickedMesh){const md=hit.pickedMesh.metadata;if(md.interact==='mode')startShift(scene,'SURVIVAL');else if(md.interact==='station')stationAction(md.station);return;} const p=origin; let best=null,bd=1.6; for(const m of scene.meshes){if(m.metadata?.interact){const d=B.Vector3.Distance(p,m.getAbsolutePosition());if(d<bd){best=m;bd=d;}}} if(best){if(best.metadata.interact==='mode')startShift(scene,'SURVIVAL');else stationAction(best.metadata.station);} }
function tryGrab(scene,handed,ctrl){ if(G.state!=='shift')return; if(handed==='right'&&!G.bat.broken)return; const st=G.handState.get(handed); if(!st||st.grabbing)return; const p=controllerPos(ctrl); let best=null,bd=1.05; for(const pr of G.props){if(pr.heldBy||pr.npcOwner)continue;const d=B.Vector3.Distance(p,pr.mesh.getAbsolutePosition());if(d<bd){best=pr;bd=d;}} if(!best)return; best.thrownByNPCUntil=0; best.heldBy=handed; best.mesh.setParent(ctrl.grip||ctrl.pointer); best.mesh.position=B.Vector3.Zero(); st.grabbing=best; st.prevPos=p; tone(210,.04,'triangle',.02);haptic(ctrl,.18,20); }
function releaseGrab(handed,ctrl){ const st=G.handState.get(handed); if(!st?.grabbing)return; const pr=st.grabbing; let v=pr._lastHandVel?.clone?.()||B.Vector3.Zero(); const max=11;if(v.length()>max)v.normalize().scaleInPlace(max); pr.mesh.setParent(null); pr.heldBy=null; pr.vel=v.scale(.9); pr._lastHandVel=null; st.grabbing=null; st.prevPos=null; tone(140,.035,'sine',.015); }

function updateGrabVelocity(){ for(const [hand,st] of G.handState){ if(!st.grabbing)continue; const p=controllerPos(st.ctrl); if(st.prevPos)st.grabbing._lastHandVel=p.subtract(st.prevPos).scale(60); st.prevPos=p; } }
sceneTickGrabHack();
function sceneTickGrabHack(){ engine.onBeginFrameObservable.add(updateGrabVelocity); }

const scene=makeScene();
window.scene=scene;

ui.enter.onclick=async()=>{ try{if(audio)await audio.resume(); const xr=await setupXR(scene); await xr.baseExperience.enterXRAsync('immersive-vr','local-floor');}catch(e){console.error(e);ui.status.textContent='WebXR could not start here. Use HTTPS in a compatible headset browser.';} };
ui.preview.onclick=()=>{G.desktop=true;ui.boot.style.display='none';ui.hud.style.display='flex';startShift(scene,'SURVIVAL'); refreshPlayerCosmetics();};

window.addEventListener('keydown',e=>{ if(!G.desktop)return; if(e.code==='KeyR')buildHub(scene); if((e.code==='Digit1'||e.code==='Digit2'||e.code==='Enter')&&G.state==='hub')startShift(scene,'SURVIVAL'); });
window.addEventListener('resize',()=>engine.resize());
engine.runRenderLoop(()=>scene.render());
ui.status.textContent='Reborn 1.8 ready • stable boot + survival gauntlet';
window.__CRAZY_OFFICE_READY=true; window.dispatchEvent(new Event('crazy-office-ready'));
updateHUD();
