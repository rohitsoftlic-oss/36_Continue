(()=>{
'use strict';

// --- DOM helpers ---
const $=id=>document.getElementById(id);

// --- DOM refs ---
const C=$('c'), PANE=$('stagePane'), WRAP=$('wrap'), SPLIT=$('split'), TIMELINE=$('timeline'), ERR=$('err');
const STAGE_DOM=$('stageDom'), MOVE_LABEL_X=$('moveLabelX'), MOVE_LABEL_Y=$('moveLabelY');
const UI={ h:$('h'), w:$('w'), set:$('set'), fit:$('fit'), one:$('one'), show:$('showstage'), zoom:$('zoom'),
           btnRulers:$('btnRulers'), btnGuides:$('btnGuides'), btnLock:$('btnLock'), btnClear:$('btnClear'),
           stageColor:$('stageColor') };
const TL={ addLayerBtn:$('tlAddLayer'), deleteLayerBtn:$('tlDeleteLayer'), status:$('tlStatus'),
           framesHeader:$('tlFramesHeader'), layerList:$('tlLayerList'), frameList:$('tlFrameList'), body:$('tlBody'),
           toolbar:$('timelineToolbar'), host:$('timeline'), header:$('tlHeader') };

const timelineState={ frameCount:120, layers:[], selectedLayerId:null, selectedFrame:0, nextId:1 };
const POP=$('guidePop'), gVal=$('gVal'), gSave=$('gSave'), gCancel=$('gCancel');
const TOOL_STRIP = $('toolStrip');

// --- State ---
const S={ stageW:1080, stageH:1920, stageColor:'#4A4A4A', bg:'#252525', tx:0, ty:0, scale:1,
          rulers:true, guides:true, guidesLocked:false, guidesX:[], guidesY:[], activeTool:'select' };

const RTop=28, RLeft=24;
const DPR=()=>window.devicePixelRatio||1;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const clampScale=s=>Math.min(10,Math.max(0.05,s));
document.addEventListener('contextmenu', e=> e.preventDefault(), {passive:false});

// --- History ---
const HISTORY=[]; const FUTURE=[]; const MAXH=2000;
const snapshot=()=> JSON.stringify({S});
const restore=snap=>{ const o=JSON.parse(snap); Object.assign(S,o.S); };
const pushHist=()=>{ HISTORY.push(snapshot()); if(HISTORY.length>MAXH) HISTORY.shift(); FUTURE.length=0; };

// --- Error surface ---
window.addEventListener('error', (e)=>{ ERR.textContent='JS Error: '+(e.message||e.error||'unknown'); ERR.classList.remove('hidden'); });
window.addEventListener('unhandledrejection', (e)=>{ ERR.textContent='Promise Error: '+(e.reason && (e.reason.message||e.reason)); ERR.classList.remove('hidden'); });

// --- Tools panel ---
function setActiveTool(id){
  S.activeTool = id;
  document.querySelectorAll('.tool-btn').forEach(b=> b.classList.toggle('selected', b.getAttribute('data-tool')===id));
}
if (TOOL_STRIP){
  TOOL_STRIP.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tool-btn'); if (!btn) return;
    setActiveTool(btn.getAttribute('data-tool'));
  });
  setActiveTool('select');
}

// --- Timeline model ---
function createLayer(name){
  const label = name || `Layer ${timelineState.nextId}`;
  return { id: timelineState.nextId++, name: label, visible:true, locked:false, keyframes:new Set([0]) };
}
function layerIndexById(id){ return timelineState.layers.findIndex(l=>l.id===id); }
function getLayer(id){ return timelineState.layers[layerIndexById(id)] || null; }
function ensureTimelineSelection(){
  if (!timelineState.layers.length){ timelineState.selectedLayerId=null; timelineState.selectedFrame=0; return; }
  if (!getLayer(timelineState.selectedLayerId)){
    timelineState.selectedLayerId = timelineState.layers[0].id;
  }
  timelineState.selectedFrame = clamp(Math.round(timelineState.selectedFrame), 0, timelineState.frameCount-1);
}
function insertLayer(layer, index){
  const idx = clamp(index, 0, timelineState.layers.length);
  timelineState.layers.splice(idx, 0, layer);
}
function addLayer(afterId){
  const layer = createLayer();
  let idx = 0;
  if (afterId!=null){
    const existing = layerIndexById(afterId);
    idx = existing>=0 ? existing+1 : 0;
  }
  insertLayer(layer, idx);
  timelineState.selectedLayerId = layer.id;
  timelineState.selectedFrame = 0;
  renderTimeline();
}
function deleteSelectedLayer(){
  if (timelineState.layers.length<=1) return;
  const idx = layerIndexById(timelineState.selectedLayerId);
  if (idx<0) return;
  timelineState.layers.splice(idx,1);
  const nextIdx = clamp(idx-1, 0, timelineState.layers.length-1);
  timelineState.selectedLayerId = timelineState.layers[nextIdx]?.id || null;
  renderTimeline();
}
function setSelectedLayer(id){
  const layer = getLayer(id);
  if (!layer) return;
  timelineState.selectedLayerId = layer.id;
  renderTimeline();
}
function setSelectedFrame(frame){
  timelineState.selectedFrame = clamp(Math.round(frame), 0, timelineState.frameCount-1);
  renderTimeline();
}
function toggleLayerVisibility(id){
  const layer = getLayer(id); if(!layer) return;
  layer.visible=!layer.visible;
  renderTimeline();
}
function toggleLayerLock(id){
  const layer = getLayer(id); if(!layer) return;
  layer.locked=!layer.locked;
  renderTimeline();
}
function renameLayer(id){
  const layer = getLayer(id); if(!layer) return;
  const next = prompt('Layer name', layer.name);
  if (next!=null){
    const trimmed = next.trim();
    if (trimmed){ layer.name=trimmed; renderTimeline(); }
  }
}
function toggleKeyframe(id, frame){
  const layer = getLayer(id); if(!layer || layer.locked) return;
  const target = clamp(frame, 0, timelineState.frameCount-1);
  if (layer.keyframes.has(target)){
    if (layer.keyframes.size>1 && target!==0){ layer.keyframes.delete(target); }
  } else {
    layer.keyframes.add(target);
  }
  timelineState.selectedLayerId = id;
  timelineState.selectedFrame = target;
  renderTimeline();
}
function computeRangeFlags(layer){
  const frameCount = timelineState.frameCount;
  const keys = Array.from(layer.keyframes).filter(f=>f>=0 && f<frameCount).sort((a,b)=>a-b);
  if (!keys.length){ keys.push(0); layer.keyframes.add(0); }
  const flags = new Array(frameCount).fill(false);
  for(let i=0;i<keys.length;i++){
    const start = keys[i];
    const end = (i+1<keys.length)?keys[i+1]:frameCount;
    for(let f=start+1; f<end; f++){ flags[f]=true; }
  }
  return { keys:new Set(keys), spans:flags };
}
function updateTimelineStatus(){
  if (!TL.status) return;
  const layer = getLayer(timelineState.selectedLayerId);
  if (!layer){ TL.status.textContent=''; return; }
  const frameLabel = `F${timelineState.selectedFrame+1}`;
  const visibility = layer.visible? 'Visible' : 'Hidden';
  const locked = layer.locked? 'Locked' : 'Unlocked';
  TL.status.textContent = `${layer.name} — ${frameLabel} (${visibility}, ${locked})`;
}
function renderTimeline(){
  if (!TL.layerList || !TL.frameList || !TL.framesHeader) return;
  ensureTimelineSelection();
  TL.layerList.innerHTML='';
  TL.frameList.innerHTML='';
  TL.framesHeader.innerHTML='';
  const frameCount = timelineState.frameCount;
  const frameTemplate = `repeat(${frameCount}, var(--timeline-frame-width))`;
  const frameWidthExpr = `calc(var(--timeline-frame-width) * ${frameCount})`;
  TL.framesHeader.style.gridTemplateColumns = frameTemplate;
  TL.framesHeader.style.minWidth = frameWidthExpr;
  TL.framesHeader.style.width = frameWidthExpr;
  for(let i=0;i<frameCount;i++){
    const num = document.createElement('div');
    num.className='frame-number';
    if ((i+1)%5===0){ num.classList.add('major'); num.textContent=String(i+1); }
    TL.framesHeader.appendChild(num);
  }
  if (!timelineState.layers.length){
    const empty=document.createElement('div');
    empty.className='timeline-empty';
    empty.textContent='No layers — add one to start animating';
    TL.layerList.appendChild(empty.cloneNode(true));
    TL.frameList.appendChild(empty);
    updateTimelineStatus();
    if (TL.deleteLayerBtn) TL.deleteLayerBtn.disabled=true;
    syncTimelineMetrics();
    syncTimelineScroll();
    return;
  }
  const layersFrag=document.createDocumentFragment();
  const framesFrag=document.createDocumentFragment();
  timelineState.layers.forEach((layer, idx)=>{
    const row=document.createElement('div');
    row.className='layer-row';
    row.dataset.layerId=String(layer.id);
    if (layer.id===timelineState.selectedLayerId) row.classList.add('selected');
    if (layer.locked) row.classList.add('locked');
    if (!layer.visible) row.classList.add('hidden');

    const indexLabel=document.createElement('div');
    indexLabel.className='layer-index';
    indexLabel.textContent=String(timelineState.layers.length-idx);
    row.appendChild(indexLabel);

    const controls=document.createElement('div');
    controls.className='layer-controls';
    const visBtn=document.createElement('button');
    visBtn.className='layer-toggle visibility'+(layer.visible?' on':'');
    visBtn.dataset.action='toggleVisible';
    visBtn.dataset.layerId=String(layer.id);
    visBtn.title=layer.visible?'Hide layer':'Show layer';
    visBtn.textContent=layer.visible?'👁':'🚫';
    controls.appendChild(visBtn);
    const lockBtn=document.createElement('button');
    lockBtn.className='layer-toggle lock'+(layer.locked?' on':'');
    lockBtn.dataset.action='toggleLock';
    lockBtn.dataset.layerId=String(layer.id);
    lockBtn.title=layer.locked?'Unlock layer':'Lock layer';
    lockBtn.textContent=layer.locked?'🔒':'🔓';
    controls.appendChild(lockBtn);
    row.appendChild(controls);

    const name=document.createElement('div');
    name.className='layer-name';
    name.textContent=layer.name;
    name.title='Double-click to rename';
    row.appendChild(name);
    layersFrag.appendChild(row);

    const frameRow=document.createElement('div');
    frameRow.className='frame-row';
    frameRow.dataset.layerId=String(layer.id);
    frameRow.style.gridTemplateColumns=frameTemplate;
    frameRow.style.minWidth = frameWidthExpr;
    frameRow.style.width = frameWidthExpr;
    const meta=computeRangeFlags(layer);
    for(let f=0;f<frameCount;f++){
      const cell=document.createElement('div');
      cell.className='frame-cell';
      cell.dataset.layerId=String(layer.id);
      cell.dataset.frame=String(f);
      if (layer.locked) cell.classList.add('locked');
      if (!layer.visible) cell.classList.add('hidden');
      if (meta.keys.has(f)) cell.classList.add('keyframe');
      else if (meta.spans[f]) cell.classList.add('range');
      else cell.classList.add('blank');
      if (layer.id===timelineState.selectedLayerId && f===timelineState.selectedFrame) cell.classList.add('selected');
      frameRow.appendChild(cell);
    }
    framesFrag.appendChild(frameRow);
  });
  TL.layerList.appendChild(layersFrag);
  TL.frameList.appendChild(framesFrag);
  if (TL.deleteLayerBtn) TL.deleteLayerBtn.disabled = timelineState.layers.length<=1;
  updateTimelineStatus();
  syncTimelineMetrics();
  syncTimelineScroll();
}
function handleLayerListClick(e){
  const btn = e.target.closest('.layer-toggle');
  if (btn){
    const id = Number(btn.dataset.layerId);
    if (btn.dataset.action==='toggleVisible') toggleLayerVisibility(id);
    else if (btn.dataset.action==='toggleLock') toggleLayerLock(id);
    e.stopPropagation();
    return;
  }
  const row = e.target.closest('.layer-row');
  if (!row) return;
  setSelectedLayer(Number(row.dataset.layerId));
}
function handleLayerListDoubleClick(e){
  const row = e.target.closest('.layer-row');
  if (!row) return;
  if (e.target.classList.contains('layer-name')){
    renameLayer(Number(row.dataset.layerId));
  }
}
function handleFrameClick(e){
  const cell = e.target.closest('.frame-cell');
  if (!cell) return;
  const layerId = Number(cell.dataset.layerId);
  const frame = Number(cell.dataset.frame);
  timelineState.selectedLayerId = layerId;
  timelineState.selectedFrame = frame;
  renderTimeline();
}
function handleFrameDoubleClick(e){
  const cell = e.target.closest('.frame-cell');
  if (!cell) return;
  const layerId = Number(cell.dataset.layerId);
  const frame = Number(cell.dataset.frame);
  toggleKeyframe(layerId, frame);
}
function syncTimelineScroll(){
  if (!TL.body || !TL.framesHeader) return;
  TL.framesHeader.style.transform = `translateX(${-TL.body.scrollLeft}px)`;
}
function syncTimelineMetrics(){
  if (!TL.host) return;
  if (TL.toolbar){
    const rect = TL.toolbar.getBoundingClientRect();
    if (rect && rect.height){
      TL.host.style.setProperty('--timeline-toolbar-height', `${Math.round(rect.height)}px`);
    }
  }
  if (TL.header){
    const headerRect = TL.header.getBoundingClientRect();
    if (headerRect && headerRect.height){
      const offset = Math.round(headerRect.height + 12);
      TL.host.style.setProperty('--timeline-header-offset', `${offset}px`);
    }
  }
}
function bootTimeline(){
  if (!TL.layerList) return;
  timelineState.layers.length=0;
  timelineState.nextId=1;
  for(let i=0;i<3;i++){
    timelineState.layers.unshift(createLayer());
  }
  timelineState.selectedLayerId = timelineState.layers[0]?.id || null;
  timelineState.selectedFrame = 0;
  syncTimelineMetrics();
  renderTimeline();
}

if (TL.layerList){
  TL.layerList.addEventListener('click', handleLayerListClick);
  TL.layerList.addEventListener('dblclick', handleLayerListDoubleClick);
}
if (TL.frameList){
  TL.frameList.addEventListener('click', handleFrameClick);
  TL.frameList.addEventListener('dblclick', handleFrameDoubleClick);
}
if (TL.body){
  TL.body.addEventListener('scroll', ()=>{ syncTimelineScroll(); });
}
if (TL.addLayerBtn){
  TL.addLayerBtn.addEventListener('click', (e)=>{
    const after = e.shiftKey ? timelineState.selectedLayerId : null;
    addLayer(after);
  });
}
if (TL.deleteLayerBtn){
  TL.deleteLayerBtn.addEventListener('click', ()=>{ deleteSelectedLayer(); });
}

// --- Drawing ---
const ctx=C.getContext('2d');

function drawRulers(w,h){
  if(!S.rulers) return;
  ctx.save();
  ctx.fillStyle='#171717'; ctx.fillRect(0,0,w,RTop); ctx.fillRect(0,0,RLeft,h);
  ctx.strokeStyle='#2e2e2e'; ctx.strokeRect(0,0,w,RTop); ctx.strokeRect(0,0,RLeft,h);
  ctx.fillStyle='#b0b0b0'; ctx.font='11px system-ui,sans-serif'; ctx.textBaseline='middle'; ctx.textAlign='center';

  const toSX=(x)=>S.tx+x*S.scale, toSY=(y)=>S.ty+y*S.scale;
  const steps=[1,2,5,10,20,50,100,200,500,1000]; let step=steps[0];
  for(const s of steps){ if(s*S.scale>=100){ step=s; break; } }
  const r=PANE.getBoundingClientRect(); const wpx=r.width, hpx=r.height;
  const xMinW=(-S.tx)/S.scale, xMaxW=(wpx-S.tx)/S.scale;
  for(let x=Math.floor(xMinW/step)*step; x<=xMaxW; x+=step){
    const sx=Math.round(toSX(x));
    ctx.strokeStyle='#2e2e2e'; ctx.beginPath(); ctx.moveTo(sx,RTop); ctx.lineTo(sx,RTop-8); ctx.stroke();
    const label=Math.round(x - S.stageW/2);
    if (sx>RLeft+4 && sx<w-12) ctx.fillText(String(label), sx, RTop/2);
  }
  const yMinW=(-S.ty)/S.scale, yMaxW=(hpx-S.ty)/S.scale;
  for(let y=Math.floor(yMinW/step)*step; y<=yMaxW; y+=step){
    const sy=Math.round(toSY(y));
    ctx.strokeStyle='#2e2e2e'; ctx.beginPath(); ctx.moveTo(RLeft,sy); ctx.lineTo(RLeft+8,sy); ctx.stroke();
    const label=Math.round(S.stageH - y);
    if (sy>RTop+10 && sy<h-10){ ctx.save(); ctx.translate(RLeft/2, sy); ctx.rotate(-Math.PI/2); ctx.fillText(String(label), 0, 0); ctx.restore(); }
  }
  ctx.restore();
}

function drawGuides(){
  if (!S.guides) return;
  ctx.save();
  ctx.lineWidth=Math.max(1, 1.25/S.scale);
  ctx.setLineDash([]);
  ctx.strokeStyle='rgba(255,255,255,.35)';
  const cx=S.stageW/2, by=S.stageH;
  ctx.beginPath(); ctx.moveTo(cx,-1e5); ctx.lineTo(cx,1e5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-1e5,by); ctx.lineTo(1e5,by); ctx.stroke();
  for(const g of S.guidesX){ const pos=g.pos!=null?g.pos:g; ctx.strokeStyle=g.color||'#61dafb'; ctx.beginPath(); ctx.moveTo(pos,-1e5); ctx.lineTo(pos,1e5); ctx.stroke(); }
  for(const g of S.guidesY){ const pos=g.pos!=null?g.pos:g; ctx.strokeStyle=g.color||'#61dafb'; ctx.beginPath(); ctx.moveTo(-1e5,pos); ctx.lineTo(1e5,pos); ctx.stroke(); }
  ctx.restore();
}

function draw(){
  const r=PANE.getBoundingClientRect();
  const w=Math.max(2, r.width|0), h=Math.max(2, r.height|0);
  C.width=Math.round(w*DPR()); C.height=Math.round(h*DPR());
  C.style.width=w+'px'; C.style.height=h+'px';

  ctx.setTransform(DPR(),0,0,DPR(),0,0);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle=S.bg; ctx.fillRect(0,0,w,h);

  ctx.save();
  ctx.translate(S.tx,S.ty);
  ctx.scale(S.scale,S.scale);

  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=18; ctx.shadowOffsetY=4;
  ctx.fillStyle=S.stageColor; ctx.fillRect(0,0,S.stageW,S.stageH);
  ctx.restore();

  drawGuides();

  ctx.lineWidth=Math.max(1,2/S.scale); ctx.strokeStyle='#e5e7eb'; ctx.strokeRect(0,0,S.stageW,S.stageH);
  ctx.restore();

  drawRulers(w,h);
  UI.zoom.textContent=(S.scale*100|0)+'%';
  ensureDomFallback();
}

function fit(){
  const r=PANE.getBoundingClientRect();
  const pad=120 + (S.rulers? Math.max(RTop,RLeft):0);
  const sx=(r.width-pad)/S.stageW, sy=(r.height-pad)/S.stageH;
  const s=clampScale(Math.min(sx,sy));
  S.scale=s; const cx=r.width/2, cy=r.height/2; S.tx=cx-(S.stageW*s)/2; S.ty=cy-(S.stageH*s)/2; draw();
}

function center(){
  const r=PANE.getBoundingClientRect(); const cx=r.width/2, cy=r.height/2;
  S.tx=cx-(S.stageW*S.scale)/2; S.ty=cy-(S.stageH*S.scale)/2; draw();
}

function smoothZoom(px,py,f){
  const s0=S.scale, s1=clampScale(s0*f); if(s0===s1) return;
  const rect=C.getBoundingClientRect(); const x=px-rect.left, y=py-rect.top;
  const wx=(x-S.tx)/s0, wy=(y-S.ty)/s0; S.tx=x-wx*s1; S.ty=y-wy*s1; S.scale=s1; draw();
}

// --- Fallback stage (visible by default; hidden when canvas renders) ---
function stageVisibleRect(){
  const r=PANE.getBoundingClientRect();
  const sx=S.tx, sy=S.ty, sw=S.stageW*S.scale, sh=S.stageH*S.scale;
  const x0=sx, y0=sy, x1=sx+sw, y1=sy+sh;
  const visW = Math.min(r.width, Math.max(0, Math.min(x1, r.width) - Math.max(x0, 0)));
  const visH = Math.min(r.height, Math.max(0, Math.min(y1, r.height) - Math.max(y0, 0)));
  return {r, x0,y0,x1,y1, visW, visH, sw, sh};
}
function ensureDomFallback(){
  const m = stageVisibleRect();
  const ok = (m.visW>=40 && m.visH>=40 && m.sw>1 && m.sh>1);
  if(!ok){
    STAGE_DOM.style.display='block';
    STAGE_DOM.style.left='50%'; STAGE_DOM.style.top='50%'; STAGE_DOM.style.transform='translate(-50%,-50%)';
    STAGE_DOM.style.width='60%'; STAGE_DOM.style.height='60%';
    STAGE_DOM.style.background=S.stageColor;
  } else {
    STAGE_DOM.style.display='none';
  }
}

// --- UI ---
function flash(el){ el.classList.add('flash'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('flash'),160); }
const onlyDigits=v=>String(v).replace(/[^0-9]/g,'');

UI.h.addEventListener('input',()=> UI.h.value=onlyDigits(UI.h.value));
UI.w.addEventListener('input',()=> UI.w.value=onlyDigits(UI.w.value));
UI.h.addEventListener('keydown',e=>{ if(e.key==='Enter'){ UI.set.click(); } });
UI.w.addEventListener('keydown',e=>{ if(e.key==='Enter'){ UI.set.click(); } });
UI.set.onclick=()=>{ pushHist(); S.stageH=parseInt(UI.h.value,10)||S.stageH; S.stageW=parseInt(UI.w.value,10)||S.stageW; fit(); flash(UI.set); };
UI.fit.onclick=()=>{ fit(); flash(UI.fit); };
UI.one.onclick=()=>{ S.scale=1; center(); flash(UI.one); };
UI.show.onclick=()=>{ S.scale=0.6; center(); fit(); STAGE_DOM.style.display='none'; draw(); flash(UI.show); };
UI.stageColor.addEventListener('input', ()=>{ S.stageColor=UI.stageColor.value; draw(); });
UI.btnRulers.onclick=()=>{ pushHist(); S.rulers=!S.rulers; UI.btnRulers.classList.toggle('on',S.rulers); draw(); };
UI.btnGuides.onclick=()=>{ pushHist(); S.guides=!S.guides; UI.btnGuides.classList.toggle('on',S.guides); draw(); };
UI.btnLock.onclick=()=>{ S.guidesLocked=!S.guidesLocked; UI.btnLock.classList.toggle('on',S.guidesLocked); };
UI.btnClear.onclick=()=>{ if(S.guidesLocked) return; pushHist(); S.guidesX.length=0; S.guidesY.length=0; draw(); };
document.addEventListener('click', (e)=>{ const btn=e.target.closest && e.target.closest('.btn,.icon-btn'); if(btn) flash(btn); }, true);

// --- Input: pan & zoom ---
let spaceDown=false, panning=false, ps={x:0,y:0,tx:0,ty:0};

window.addEventListener('keydown',(e)=>{
  const t=e.target, tag=(t&&t.tagName)||'';
  const k=(e.key||'').toLowerCase();
  if (!(tag==='INPUT' || tag==='TEXTAREA' || (t&&t.isContentEditable))){
    if (e.ctrlKey || e.metaKey){
      if (k==='z' && !e.shiftKey){ if(HISTORY.length){ FUTURE.push(snapshot()); restore(HISTORY.pop()); draw(); } e.preventDefault(); return; }
      if (k==='y' || (k==='z' && e.shiftKey)){ if(FUTURE.length){ HISTORY.push(snapshot()); restore(FUTURE.pop()); draw(); } e.preventDefault(); return; }
      e.preventDefault(); return;
    }
  }
  if (e.code==='Space'){ spaceDown=true; document.body.style.cursor='grabbing'; }
}, true);
window.addEventListener('keyup', (e)=>{ if(e.code==='Space'){ spaceDown=false; document.body.style.cursor=''; }}, {passive:true});

C.addEventListener('mousedown',(e)=>{
  if (e.button===1 || e.button===2 || e.buttons===4 || (e.button===0 && spaceDown)){
    panning=true; ps={x:e.clientX,y:e.clientY,tx:S.tx,ty:S.ty}; e.preventDefault(); return;
  }
});
window.addEventListener('mousemove',(e)=>{ if(!panning) return; S.tx=ps.tx+(e.clientX-ps.x); S.ty=ps.ty+(e.clientY-ps.y); draw(); });
window.addEventListener('mouseup',()=>{ panning=false; });

function wheelToZoomFactor(e){
  let dy=e.deltaY; if(e.deltaMode===1) dy*=16; if(e.deltaMode===2) dy*=100;
  const k = e.ctrlKey ? 0.0018 : 0.0012;
  return Math.exp(-dy * k);
}
function pointInStage(px,py){
  const r=PANE.getBoundingClientRect();
  return (px>=r.left && px<=r.right && py>=r.top && py<=r.bottom);
}
function wheelZoom(e){
  if (!pointInStage(e.clientX, e.clientY)) return;
  const f=wheelToZoomFactor(e); smoothZoom(e.clientX,e.clientY,f); e.preventDefault();
}
PANE.addEventListener('wheel', wheelZoom, {passive:false});
C.addEventListener('wheel', wheelZoom, {passive:false});
document.addEventListener('wheel', wheelZoom, {passive:false});

// Safari pinch
let _gScale=1;
window.addEventListener('gesturestart', (e)=>{ _gScale=1; e.preventDefault(); }, {passive:false});
window.addEventListener('gesturechange', (e)=>{
  const cx = e.clientX || (window.innerWidth/2), cy = e.clientY || (window.innerHeight/2);
  const f = e.scale / _gScale; _gScale = e.scale; smoothZoom(cx, cy, f); e.preventDefault();
}, {passive:false});
window.addEventListener('gestureend', (e)=>{ e.preventDefault(); }, {passive:false});

// Keyboard +/-
window.addEventListener('keydown', (e)=>{
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.isContentEditable)) return;
  if (e.key==='=' || e.key==='+'){ smoothZoom(window.innerWidth/2, window.innerHeight/2, 1.06); e.preventDefault(); }
  else if (e.key==='-'){ smoothZoom(window.innerWidth/2, window.innerHeight/2, 1/1.06); e.preventDefault(); }
}, {passive:false});

// --- Guides ---
function worldFromClient(px,py){ const rect=C.getBoundingClientRect(); const x=px-rect.left, y=py-rect.top; return {x:(x-S.tx)/S.scale, y:(y-S.ty)/S.scale}; }
function screenFromWorldX(x){ return S.tx + x*S.scale; }
function screenFromWorldY(y){ return S.ty + y*S.scale; }
function guideAtIndex(axis,i){ const arr=axis==='x'?S.guidesX:S.guidesY; const g=arr[i]; return (g&&g.pos!=null)?g:(arr[i]={pos:g,color:'#61dafb'}); }
function nearestGuideIndex(axis, clientX, clientY){
  const tol=16; if(axis==='x'){ let best=-1,bd=1e9; const px=clientX-C.getBoundingClientRect().left;
    for(let i=0;i<S.guidesX.length;i++){ const sx=screenFromWorldX(guideAtIndex('x',i).pos); const d=Math.abs(px-sx); if(d<bd){ bd=d; best=i; } } return bd<=tol?best:-1;
  } else { let best=-1,bd=1e9; const py=clientY-C.getBoundingClientRect().top;
    for(let i=0;i<S.guidesY.length;i++){ const sy=screenFromWorldY(guideAtIndex('y',i).pos); const d=Math.abs(py-sy); if(d<bd){ bd=d; best=i; } } return bd<=tol?best:-1; }
}
function isNearIntersection(clientX, clientY){
  const ix=nearestGuideIndex('x',clientX,clientY), iy=nearestGuideIndex('y',clientX,clientY);
  return {ix,iy,ok:ix>=0&&iy>=0};
}

function nearestPos(arr, target){ let best=null, bd=Infinity; for(const g of arr){ const p=g.pos!=null?g.pos:g; const d=Math.abs(p-target); if(d<bd){ bd=d; best=p; } } return best; }
function placeLabelForX(pos){
  const rect = C.getBoundingClientRect();
  const nearY = nearestPos(S.guidesY, S.stageH/2) ?? (S.stageH/2);
  const sx = rect.left + S.tx + pos*S.scale;
  const sy = rect.top  + S.ty + nearY*S.scale;
  const left = Math.max(rect.left+10, Math.min(rect.right-10, sx + 12));
  const top  = Math.max(rect.top +10, Math.min(rect.bottom-10, sy - 12));
  return { left, top, txt: String(Math.round(pos - S.stageW/2)) };
}
function placeLabelForY(pos){
  const rect = C.getBoundingClientRect();
  const nearX = nearestPos(S.guidesX, S.stageW/2) ?? (S.stageW/2);
  const sx = rect.left + S.tx + nearX*S.scale;
  const sy = rect.top  + S.ty + pos*S.scale;
  const left = Math.max(rect.left+10, Math.min(rect.right-10, sx + 12));
  const top  = Math.max(rect.top +10, Math.min(rect.bottom-10, sy - 12));
  return { left, top, txt: String(Math.round(S.stageH - pos)) };
}
function clearTempLabels(){ document.querySelectorAll('.guide-label.temp').forEach(n=>n.remove()); }
function showAllLabels(){
  clearTempLabels();
  for(const g of S.guidesX){ const p=g.pos!=null?g.pos:g; const L=placeLabelForX(p); const d=document.createElement('div'); d.className='guide-label temp'; d.textContent=L.txt; d.style.left=L.left+'px'; d.style.top=L.top+'px'; document.body.appendChild(d); }
  for(const g of S.guidesY){ const p=g.pos!=null?g.pos:g; const L=placeLabelForY(p); const d=document.createElement('div'); d.className='guide-label temp'; d.textContent=L.txt; d.style.left=L.left+'px'; d.style.top=L.top+'px'; document.body.appendChild(d); }
}
let tempTimer=null; function pulseAllLabels(){ clearTimeout(tempTimer); showAllLabels(); tempTimer=setTimeout(clearTempLabels, 1000); }
function showMoveLabelX(pos){ const L=placeLabelForX(pos); MOVE_LABEL_X.textContent=L.txt; MOVE_LABEL_X.style.left=L.left+'px'; MOVE_LABEL_X.style.top=L.top+'px'; MOVE_LABEL_X.classList.remove('hidden'); }
function showMoveLabelY(pos){ const L=placeLabelForY(pos); MOVE_LABEL_Y.textContent=L.txt; MOVE_LABEL_Y.style.left=L.left+'px'; MOVE_LABEL_Y.style.top=L.top+'px'; MOVE_LABEL_Y.classList.remove('hidden'); }
function hideMoveLabels(){ MOVE_LABEL_X.classList.add('hidden'); MOVE_LABEL_Y.classList.add('hidden'); }

// Popover edit
let popState=null;
function openPop(clientX, clientY, axis, index){
  const arr = axis==='x'? S.guidesX : S.guidesY;
  const g = arr[index]; const pos=g.pos!=null?g.pos:g; const color=g.color||'#61dafb';
  const val = axis==='x' ? Math.round(pos - S.stageW/2) : Math.round(S.stageH - pos);
  gVal.value = String(val);
  POP.style.left=(clientX+10)+'px'; POP.style.top=(clientY+10)+'px'; POP.classList.remove('hidden');
  popState = { axis, index, color };
  POP.querySelectorAll('.sw').forEach(btn=>{
    btn.classList.toggle('selected', btn.getAttribute('data-c')===color);
    btn.onclick=()=>{
      POP.querySelectorAll('.sw').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      popState.color = btn.getAttribute('data-c');
    };
  });
}
function closePop(){ POP.classList.add('hidden'); popState=null; }
gCancel.onclick=closePop;
gSave.onclick=()=>{
  if(!popState) return;
  const arr = popState.axis==='x'? S.guidesX : S.guidesY;
  let pos = parseInt(gVal.value,10) || 0;
  if (popState.axis==='x') pos = pos + S.stageW/2; else pos = S.stageH - pos;
  const color = popState.color || '#61dafb';
  const g = arr[popState.index];
  pushHist();
  if (g.pos!=null){ g.pos = pos; g.color = color; } else { arr[popState.index] = { pos, color }; }
  closePop(); draw(); pulseAllLabels();
};

let dragGuide=null;
C.addEventListener('mousedown',(e)=>{
  if (e.button!==0) return;
  if (!POP.classList.contains('hidden') && !POP.contains(e.target)) closePop();

  const rect=C.getBoundingClientRect(), px=e.clientX-rect.left, py=e.clientY-rect.top;
  const world=worldFromClient(e.clientX,e.clientY);

  // Alt + Left => delete
  if (e.altKey && !S.guidesLocked){
    const {ix,iy}=isNearIntersection(e.clientX,e.clientY);
    if (ix>=0||iy>=0){ pushHist(); if(ix>=0) S.guidesX.splice(ix,1); if(iy>=0) S.guidesY.splice(iy,1); draw(); e.preventDefault(); return; }
  }

  // Create from rulers (corner first)
  if (S.rulers && !S.guidesLocked){
    if (px < RLeft && py < RTop){ dragGuide={axis:'both',posX:world.x,posY:world.y,preview:true}; showMoveLabelX(dragGuide.posX); showMoveLabelY(dragGuide.posY); showAllLabels(); e.preventDefault(); return; }
    if (py < RTop){ dragGuide={axis:'y',pos:world.y,preview:true}; showMoveLabelY(dragGuide.pos); showAllLabels(); e.preventDefault(); return; }
    if (px < RLeft){ dragGuide={axis:'x',pos:world.x,preview:true}; showMoveLabelX(dragGuide.pos); showAllLabels(); e.preventDefault(); return; }
  }

  // Ctrl + Left => edit popover
  if (e.ctrlKey && !S.guidesLocked){
    const ix=nearestGuideIndex('x',e.clientX,e.clientY), iy=nearestGuideIndex('y',e.clientX,e.clientY);
    if (ix>=0){ openPop(e.clientX,e.clientY,'x',ix); e.preventDefault(); return; }
    if (iy>=0){ openPop(e.clientX,e.clientY,'y',iy); e.preventDefault(); return; }
  }

  // Move existing (intersection -> both)
  if (!S.guidesLocked){
    const {ix,iy,ok}=isNearIntersection(e.clientX,e.clientY);
    if (ok){ pushHist(); dragGuide={axis:'both',preview:false,moveIndexX:ix,moveIndexY:iy}; showMoveLabelX(guideAtIndex('x',ix).pos); showMoveLabelY(guideAtIndex('y',iy).pos); showAllLabels(); e.preventDefault(); return; }
    if (ix>=0){ pushHist(); dragGuide={axis:'x',pos:guideAtIndex('x',ix).pos,preview:false,moveIndex:ix}; showMoveLabelX(dragGuide.pos); showAllLabels(); e.preventDefault(); return; }
    if (iy>=0){ pushHist(); dragGuide={axis:'y',pos:guideAtIndex('y',iy).pos,preview:false,moveIndex:iy}; showMoveLabelY(dragGuide.pos); showAllLabels(); e.preventDefault(); return; }
  }
});

window.addEventListener('mousemove',(e)=>{
  if(!dragGuide) return;
  const w=worldFromClient(e.clientX,e.clientY);
  draw();
  if (dragGuide.axis==='x'){
    let v=w.x; if(e.shiftKey) v=Math.round(v/10)*10; dragGuide.pos=v;
    if (dragGuide.moveIndex!=null) guideAtIndex('x',dragGuide.moveIndex).pos=v;
    showMoveLabelX(v); showAllLabels();
    const c=C.getContext('2d'); c.save(); c.setTransform(1,0,0,1,0,0); c.translate(S.tx,S.ty); c.scale(S.scale,S.scale);
    c.lineWidth=Math.max(1,1.25/S.scale); c.strokeStyle='#61dafb'; c.beginPath(); c.moveTo(v,-1e5); c.lineTo(v,1e5); c.stroke(); c.restore(); return;
  }
  if (dragGuide.axis==='y'){
    let v=w.y; if(e.shiftKey) v=Math.round(v/10)*10; dragGuide.pos=v;
    if (dragGuide.moveIndex!=null) guideAtIndex('y',dragGuide.moveIndex).pos=v;
    showMoveLabelY(v); showAllLabels();
    const c=C.getContext('2d'); c.save(); c.setTransform(1,0,0,1,0,0); c.translate(S.tx,S.ty); c.scale(S.scale,S.scale);
    c.lineWidth=Math.max(1,1.25/S.scale); c.strokeStyle='#61dafb'; c.beginPath(); c.moveTo(-1e5,v); c.lineTo(1e5,v); c.stroke(); c.restore(); return;
  }
  let vx=w.x, vy=w.y; if(e.shiftKey){ vx=Math.round(vx/10)*10; vy=Math.round(vy/10)*10; }
  if (dragGuide.moveIndexX!=null) guideAtIndex('x',dragGuide.moveIndexX).pos=vx; else dragGuide.posX=vx;
  if (dragGuide.moveIndexY!=null) guideAtIndex('y',dragGuide.moveIndexY).pos=vy; else dragGuide.posY=vy;
  showMoveLabelX(vx); showMoveLabelY(vy); showAllLabels();
  if (dragGuide.preview){
    const c=C.getContext('2d'); c.save(); c.setTransform(1,0,0,1,0,0); c.translate(S.tx,S.ty); c.scale(S.scale,S.scale);
    c.lineWidth=Math.max(1,1.25/S.scale); c.strokeStyle='#61dafb';
    c.beginPath(); c.moveTo(vx,-1e5); c.lineTo(vx,1e5); c.stroke();
    c.beginPath(); c.moveTo(-1e5,vy); c.lineTo(1e5,vy); c.stroke(); c.restore();
  }
});

window.addEventListener('mouseup',()=>{
  if(!dragGuide) return;
  hideMoveLabels(); clearTempLabels();
  if (dragGuide.preview){
    pushHist();
    if (dragGuide.axis==='x') S.guidesX.push({pos:dragGuide.pos, color:'#61dafb'});
    else if (dragGuide.axis==='y') S.guidesY.push({pos:dragGuide.pos, color:'#61dafb'});
    else { S.guidesX.push({pos:dragGuide.posX, color:'#61dafb'}); S.guidesY.push({pos:dragGuide.posY, color:'#61dafb'}); }
  }
  dragGuide=null; draw(); pulseAllLabels();
});

// --- Timeline side-by-side (grid) ---
const LS_KEY='animate_tl_px_nomod36'; const LS_KEY_PREV=LS_KEY+'_prev';
let timelinePx=0; let timelinePrevPx=360;
function clampTimelinePx(px){
  const wrapW = WRAP.getBoundingClientRect().width || 1;
  const minStage = 200; const maxPx = Math.max(0, wrapW - minStage);
  return Math.max(0, Math.min(maxPx, Math.round(px)));
}
function applyOverlay(){
  timelinePx = clampTimelinePx(timelinePx);
  TIMELINE.style.width = timelinePx + 'px';
  WRAP.style.gridTemplateColumns = `1fr 8px ${timelinePx}px`;
}
function loadOverlay(){
  try{
    const v = localStorage.getItem(LS_KEY); if(v!=null) timelinePx = Number(v);
    const pv = localStorage.getItem(LS_KEY_PREV); if(pv!=null) timelinePrevPx = Number(pv);
  }catch(e){}
  if (isNaN(timelinePx)) timelinePx = 0;
  if (isNaN(timelinePrevPx) || timelinePrevPx<=0) timelinePrevPx = 360;
  applyOverlay();
}
function saveOverlay(){ try{ localStorage.setItem(LS_KEY, String(timelinePx)); localStorage.setItem(LS_KEY_PREV, String(timelinePrevPx)); }catch(e){} }
let resizing=false, startX=0, startPx=0;
SPLIT.addEventListener('mousedown',(e)=>{ resizing=true; startX=e.clientX; startPx=timelinePx; e.preventDefault(); });
window.addEventListener('mousemove',(e)=>{ if(!resizing) return; const dx = e.clientX - startX; timelinePx = clampTimelinePx(startPx - dx); if (timelinePx>0) timelinePrevPx = timelinePx; applyOverlay(); draw(); });
window.addEventListener('mouseup',()=>{ if(!resizing) return; resizing=false; saveOverlay(); });
SPLIT.addEventListener('dblclick',()=>{ if (timelinePx>0){ timelinePrevPx=timelinePx; timelinePx=0; } else { timelinePx=timelinePrevPx>0?timelinePrevPx:360; } applyOverlay(); saveOverlay(); draw(); });
window.addEventListener('keydown',(e)=>{
  if((e.key==='t'||e.key==='T') && !e.ctrlKey && !e.metaKey){ if(e.shiftKey){ const wrapW = WRAP.getBoundingClientRect().width||1; timelinePrevPx = Math.round(wrapW*0.30); timelinePx=timelinePrevPx; } else { if (timelinePx>0){ timelinePrevPx=timelinePx; timelinePx=0; } else { timelinePx=timelinePrevPx>0?timelinePrevPx:360; } } applyOverlay(); saveOverlay(); draw(); e.preventDefault(); }
},{passive:false});
window.addEventListener('resize', ()=>{ applyOverlay(); syncTimelineMetrics(); draw(); }, {passive:true});

// --- Boot ---
function init(){
  try{
    bootTimeline();
    UI.h.value=S.stageH; UI.w.value=S.stageW; UI.stageColor.value=S.stageColor;
    loadOverlay();
    let tries=0;
    (function waitSize(){
      const r=PANE.getBoundingClientRect();
      if ((r.width>=240 && r.height>=220) || tries>20){
        draw(); fit(); STAGE_DOM.style.display='none';
      } else { tries++; requestAnimationFrame(waitSize); }
    })();
  }catch(e){ ERR.textContent=String(e); ERR.classList.remove('hidden'); }
}
init();

})(); 
