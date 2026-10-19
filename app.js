/* Batı Toroslar Jeoloji Atlası — MapLibre GL tabanlı etkileşimli jeoloji haritası */
(function(){
'use strict';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const VER='7', q=u=>u+(u.includes('?')?'&':'?')+'v='+VER;
const TERRAIN='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const BASEMAPS={
  etopo:{tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],max:19,attr:'Altlık © Esri, HERE, Garmin, OpenStreetMap'},
  topo:{tiles:['https://a.tile.opentopomap.org/{z}/{x}/{y}.png','https://b.tile.opentopomap.org/{z}/{x}/{y}.png','https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],max:17,attr:'© OpenTopoMap (CC-BY-SA), © OpenStreetMap'},
  sat:{tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],max:19,attr:'Görüntü © Esri, Maxar, Earthstar Geographics'},
  osm:{tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],max:19,attr:'© OpenStreetMap katkıcıları'}
};
let BM='etopo', bmErr={}, PIDX=[], hiddenSheets=new Set();
let GEO=null, UNITS=null, OVS=[], idx=[], grid=new Map(); const CELL=0.05;
let mode='info', selected=null, legendFocus=null, searchSet=null;
let A=null, secPts=null, lastSec=null, measurePts=[];

const map=new maplibregl.Map({container:'map',center:[30.6,38.2],zoom:7,maxPitch:75,hash:true,attributionControl:{compact:true},
  style:{version:8,glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':css('--bg')||'#f3f1ea'}}]}});
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');
map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');

/* ---------- styling sources ---------- */
map.on('load',async()=>{
  for(const [k,b] of Object.entries(BASEMAPS)){
    map.addSource('bm-'+k,{type:'raster',tiles:b.tiles,tileSize:256,maxzoom:b.max,attribution:b.attr});
    map.addLayer({id:'bm-'+k,type:'raster',source:'bm-'+k,layout:{visibility:k===BM?'visible':'none'}});
  }
  map.addSource('dem',{type:'raster-dem',tiles:[TERRAIN],encoding:'terrarium',tileSize:256,maxzoom:14,attribution:'Yükseklik: AWS Terrain Tiles (SRTM ve diğerleri)'});
  map.addSource('dem-h',{type:'raster-dem',tiles:[TERRAIN],encoding:'terrarium',tileSize:256,maxzoom:14});
  map.addLayer({id:'hill',type:'hillshade',source:'dem-h',paint:{'hillshade-exaggeration':0.35,'hillshade-shadow-color':'#3b3426'}});

  const [g,u,o,f]=await Promise.all([fetch(q('data/geology_parts.json')).then(r=>r.json()).then(L=>Promise.all(L.map(u=>fetch(q(u)).then(r=>r.json())))).then(P=>({type:'FeatureCollection',features:P.flatMap(x=>x.features)})),fetch(q('data/units.json')).then(r=>r.json()),fetch(q('data/overlays.json')).then(r=>r.json()),fetch(q('data/faults.geojson')).then(r=>r.json()).catch(()=>null)]);
  GEO=g; UNITS=u; OVS=o;
  buildIndex();
  // scanned sheet overlays (below vector)
  OVS.forEach(ov=>{const [W,S,E,N]=ov.bbox;
    map.addSource('ov-'+ov.id,{type:'image',url:ov.img,coordinates:[[W,N],[E,N],[E,S],[W,S]]});
    map.addLayer({id:'ov-'+ov.id,type:'raster',source:'ov-'+ov.id,layout:{visibility:'none'},paint:{'raster-opacity':0.85,'raster-fade-duration':0}});});
  map.addSource('geo',{type:'geojson',data:GEO,promoteId:'_i'});
  map.addLayer({id:'geo-fill',type:'fill',source:'geo',paint:{'fill-color':['get','c'],'fill-opacity':0.55}});
  map.addLayer({id:'geo-line',type:'line',source:'geo',paint:{'line-color':'#2b2b2b','line-width':['interpolate',['linear'],['zoom'],7,0.1,12,0.8],'line-opacity':0.6}});
  map.addLayer({id:'geo-sel',type:'line',source:'geo',filter:['==',['get','_i'],-1],paint:{'line-color':'#b8320f','line-width':3}});
  if(f){map.addSource('faults',{type:'geojson',data:f});
    map.addLayer({id:'faults',type:'line',source:'faults',paint:{'line-color':'#c4161c','line-width':['interpolate',['linear'],['zoom'],7,0.8,12,2.2]}});}
  // sheet frames + labels
  const frames={type:'FeatureCollection',features:[]};
  OVS.forEach(ov=>{const [W,S,E,N]=ov.bbox;frames.features.push({type:'Feature',properties:{t:ov.id},geometry:{type:'Polygon',coordinates:[[[W,S],[E,S],[E,N],[W,N],[W,S]]]}})});
  map.addSource('frames',{type:'geojson',data:frames});
  map.addLayer({id:'frames',type:'line',source:'frames',paint:{'line-color':'#444','line-width':1,'line-dasharray':[3,3]}});
  map.addLayer({id:'frames-lbl',type:'symbol',source:'frames',layout:{'text-field':['get','t'],'text-font':['Open Sans Semibold'],'text-size':12,'symbol-placement':'point'},paint:{'text-color':'#333','text-halo-color':'#fff','text-halo-width':1.5}});
  map.addSource('user',{type:'geojson',data:emptyFC()});
  addUserLayers();
  // formasyon kısaltmaları
  map.addSource('glbl',{type:'geojson',data:q('data/labels.geojson')});
  map.addLayer({id:'geo-lbl',type:'symbol',source:'glbl',minzoom:9,layout:{'text-field':['get','k'],'text-font':['Open Sans Semibold'],'text-size':['interpolate',['linear'],['zoom'],9,10,13,13],'symbol-sort-key':['-',0,['get','a']],'text-padding':3},paint:{'text-color':'#1a1a1a','text-halo-color':'rgba(255,255,255,.9)','text-halo-width':1.4}});
  // 1:100.000 pafta indeksi
  map.addSource('pidx',{type:'geojson',data:q('data/pafta_index.geojson')});
  map.addLayer({id:'pidx-fill',type:'fill',source:'pidx',paint:{'fill-color':'#2f5d50','fill-opacity':['case',['==',['get','ov'],1],0.06,0]}});
  map.addLayer({id:'pidx-line',type:'line',source:'pidx',paint:{'line-color':'#1d3b8a','line-width':['case',['==',['get','ov'],1],1.6,0.8],'line-opacity':0.8}});
  map.addLayer({id:'pidx-lbl',type:'symbol',source:'pidx',layout:{'text-field':['get','id'],'text-font':['Open Sans Semibold'],'text-size':['interpolate',['linear'],['zoom'],6,10,10,15],'text-allow-overlap':false},paint:{'text-color':['case',['==',['get','ov'],1],'#b8320f','#1d3b8a'],'text-halo-color':'#fff','text-halo-width':1.6}});
  ['frames','frames-lbl'].forEach(l=>map.setLayoutProperty(l,'visibility','none'));
  fetch(q('data/pafta_index.geojson')).then(r=>r.json()).then(j=>{PIDX=j.features});
  // drawing
  map.addSource('draw',{type:'geojson',data:emptyFC()});
  map.addLayer({id:'draw-line',type:'line',source:'draw',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#111','line-width':2.5}});
  map.addLayer({id:'draw-pt',type:'circle',source:'draw',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-color':'#111','circle-stroke-width':2}});
  map.addLayer({id:'draw-lbl',type:'symbol',source:'draw',filter:['has','l'],layout:{'text-field':['get','l'],'text-font':['Open Sans Semibold'],'text-size':13,'text-offset':[0,-1.3]},paint:{'text-color':'#111','text-halo-color':'#fff','text-halo-width':2}});
  map.addSource('cursor',{type:'geojson',data:emptyFC()});
  map.addLayer({id:'cursor',type:'circle',source:'cursor',paint:{'circle-radius':6,'circle-color':'#b8320f','circle-stroke-color':'#fff','circle-stroke-width':2}});

  if(!location.hash){const b=bounds();map.fitBounds(b,{padding:{top:70,bottom:40,left:30,right:innerWidth>860?430:30},duration:0});}
  $('#stat').textContent=`${UNITS.length} vektör pafta · ${GEO.features.length} poligon · ${OVS.length} taranmış pafta`;
  setHint();
  buildLegendSelect(); buildOverlayList();
});
function emptyFC(){return{type:'FeatureCollection',features:[]}}
function bounds(){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;idx.forEach(b=>{x0=Math.min(x0,b[0]);y0=Math.min(y0,b[1]);x1=Math.max(x1,b[2]);y1=Math.max(y1,b[3])});return[[x0,y0],[x1,y1]]}

/* ---------- spatial index & lookup ---------- */
function bboxOf(g){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const P=g.type==='Polygon'?[g.coordinates]:g.coordinates;for(const p of P)for(const [x,y] of p[0]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return[x0,y0,x1,y1]}
function buildIndex(){GEO.features.forEach((f,i)=>{f.properties._i=i;const b=bboxOf(f.geometry);idx.push(b);
  for(let gx=Math.floor(b[0]/CELL);gx<=Math.floor(b[2]/CELL);gx++)for(let gy=Math.floor(b[1]/CELL);gy<=Math.floor(b[3]/CELL);gy++){const k=gx+','+gy;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i)}})}
function inRing(x,y,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c}return c}
function inGeom(x,y,g){const P=g.type==='Polygon'?[g.coordinates]:g.coordinates;for(const p of P){if(inRing(x,y,p[0])){let h=false;for(let k=1;k<p.length;k++)if(inRing(x,y,p[k])){h=true;break}if(!h)return true}}return false}
function lookup(lon,lat){const c=grid.get(Math.floor(lon/CELL)+','+Math.floor(lat/CELL));if(!c)return null;for(const i of c){const b=idx[i];if(lon<b[0]||lon>b[2]||lat<b[1]||lat>b[3])continue;if(hiddenSheets.has(GEO.features[i].properties.s))continue;if(inGeom(lon,lat,GEO.features[i].geometry))return i}return null}
function info(i){const p=GEO.features[i].properties,sh=UNITS[p.s];return{sheet:sh,u:sh.units[p.u],si:p.s,ui:p.u}}
function neighbours(i){const f=GEO.features[i],b=idx[i],pad=0.0005,res=new Set(),s=f.properties.s;const cands=new Set();
  for(let gx=Math.floor((b[0]-pad)/CELL);gx<=Math.floor((b[2]+pad)/CELL);gx++)for(let gy=Math.floor((b[1]-pad)/CELL);gy<=Math.floor((b[3]+pad)/CELL);gy++)(grid.get(gx+','+gy)||[]).forEach(j=>cands.add(j));
  const pts=[];(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).forEach(p=>p.forEach(r=>{for(let k=0;k<r.length;k+=2)pts.push(r[k])}));
  for(const j of cands){if(j===i)continue;const g=GEO.features[j];if(g.properties.s!==s||g.properties.u===f.properties.u||res.has(g.properties.u))continue;const c=idx[j];
    if(c[0]>b[2]+pad||c[2]<b[0]-pad||c[1]>b[3]+pad||c[3]<b[1]-pad)continue;let hit=false;
    outer:for(const p of (g.geometry.type==='Polygon'?[g.geometry.coordinates]:g.geometry.coordinates))for(const r of p)for(let k=0;k<r.length;k+=2)for(let m=0;m<pts.length;m+=3){if(Math.abs(r[k][0]-pts[m][0])<pad&&Math.abs(r[k][1]-pts[m][1])<pad){hit=true;break outer}}
    if(hit)res.add(g.properties.u)}
  return res}

/* ---------- UI: tabs, modes ---------- */
$$('.tabs [role=tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
function showTab(id){$$('.tabs [role=tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===id));$$('.tab').forEach(t=>t.hidden=t.id!==id);$('#panel').classList.remove('min')}
$('#collapse').onclick=()=>$('#panel').classList.toggle('min');
$$('.modes button[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
function setMode(m){mode=m;$$('.modes button[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===m));A=null;measurePts=[];
  if(m!=='section'||!lastSec)setDraw([]);setHint();if(m==='section')showTab('t-section');if(m==='info')showTab('t-info');map.getCanvas().style.cursor=m==='info'?'':'crosshair'}
function setHint(t){$('#hint').textContent=t||({info:'Bilgi: haritada bir noktaya tıklayın.',section:"Kesit: başlangıç noktası A için tıklayın.",measure:'Ölçüm: noktalara tıklayın; bitirmek için çift tıklayın.'})[mode]}
function setDraw(features){const s=map.getSource('draw');if(s)s.setData({type:'FeatureCollection',features})}
const pt=(c,l)=>({type:'Feature',properties:l?{l}:{},geometry:{type:'Point',coordinates:c}});
const ln=c=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:c}});

/* ---------- click handling ---------- */
map.on('click',e=>{if(!GEO)return;const c=[e.lngLat.lng,e.lngLat.lat];
  if(mode==='info'&&userPopup(e))return;
  if(mode==='info'){const i=lookup(c[0],c[1]);showUnit(i,c);sheetBox(c);return}
  if(mode==='section'){if(!A||lastSec&&lastSec.done){A=c;lastSec=null;setDraw([pt(A,'A')]);setHint("Kesit: bitiş noktası A' için tıklayın.");return}
    const B=c;setDraw([ln([A,B]),pt(A,'A'),pt(B,"A'")]);setHint('Kesit hesaplanıyor…');runSection(A,B);return}
  if(mode==='measure'){measurePts.push(c);drawMeasure()}});
map.on('dblclick',e=>{if(mode==='measure'){e.preventDefault();drawMeasure(true);measurePts=[]}});
function hav(a,b){const R=6371,r=Math.PI/180,dl=(b[1]-a[1])*r,dn=(b[0]-a[0])*r;const s=Math.sin(dl/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(s))}
function drawMeasure(done){let d=0;for(let k=1;k<measurePts.length;k++)d+=hav(measurePts[k-1],measurePts[k]);
  const f=measurePts.map((p,k)=>pt(p,k===measurePts.length-1?(d<1?(d*1000).toFixed(0)+' m':d.toFixed(2)+' km'):null));if(measurePts.length>1)f.unshift(ln(measurePts));setDraw(f);
  setHint((done?'Ölçüm bitti: ':'Toplam: ')+(d<1?(d*1000).toFixed(0)+' m':d.toFixed(2)+' km')+(done?' · yeni ölçüm için tıklayın.':' · bitirmek için çift tıklayın.'))}

/* ---------- unit card & strat column ---------- */
function showUnit(i,c){
  if(i==null){$('#unitBody').className='muted';$('#unitBody').textContent='Bu nokta vektörleştirilmiş paftaların dışında. Taranmış pafta görüntülerini “Katmanlar” sekmesinden açabilirsiniz.';$('#colWrap').hidden=true;map.setFilter('geo-sel',['==',['get','_i'],-1]);return}
  const {sheet,u,ui}=info(i);selected=i;map.setFilter('geo-sel',['==',['get','_i'],i]);
  $('#unitBody').className='';
  $('#unitBody').innerHTML=`<div class="unit-head"><span class="sw" style="background:${u.col}"></span><div><div style="font-size:15px"><span class="code">${esc(u.c)}</span> · ${esc(u.n)}</div><div class="muted" style="font-size:12px">${esc(sheet.title)} · ${c[1].toFixed(5)}, ${c[0].toFixed(5)}</div></div></div>
  <dl><dt>Yaş</dt><dd>${esc(u.a)}</dd><dt>Litoloji</dt><dd>${esc(u.l)}</dd><dt>Tektonik birim / ortam</dt><dd>${esc(u.t||'—')}</dd><dt>Kot</dt><dd id="zHere" class="num">…</dd></dl>`;
  elevAt(c[0],c[1]).then(z=>{const el=$('#zHere');if(el)el.textContent=z==null?'alınamadı':Math.round(z)+' m'});
  const nb=neighbours(i);$('#colSheet').textContent=sheet.title;
  $('#colList').innerHTML=sortedUnits(sheet).map(x=>{const mk=x.k===ui?'●':nb.has(x.k)?(x.o<u.o?'▲':'▼'):'';
    return `<div class="r${x.k===ui?' sel':''}"><span class="mk">${mk}</span><span class="bar2" style="background:${x.col}"></span><span><span class="code">${esc(x.c)}</span> ${esc(x.n)}<span class="age">${esc(x.a)}</span></span></div>`}).join('');
  $('#colWrap').hidden=false;showTab('t-info');const s=$('#colList .sel');if(s)s.scrollIntoView({block:'nearest'});
}
function sortedUnits(sh){return sh.units.map((x,k)=>({...x,k})).filter(x=>x.c!=='Göl').sort((a,b)=>a.o-b.o)}

/* ---------- legend ---------- */
function buildLegendSelect(){const s=$('#legSheet');s.innerHTML=UNITS.map((u,i)=>`<option value="${i}">${esc(u.title)}</option>`).join('');s.onchange=renderLegend;renderLegend()}
function renderLegend(){const si=+$('#legSheet').value,sh=UNITS[si];
  $('#legList').innerHTML=sortedUnits(sh).map(x=>`<button class="r${legendFocus&&legendFocus[0]===si&&legendFocus[1]===x.k?' sel':''}" data-k="${x.k}"><span class="mk"></span><span class="bar2" style="background:${x.col}"></span><span><span class="code">${esc(x.c)}</span> ${esc(x.n)}<span class="age">${esc(x.a)} · ${esc(x.l)}</span></span></button>`).join('');
  $$('#legList button').forEach(b=>b.onclick=()=>{const k=+b.dataset.k;legendFocus=(legendFocus&&legendFocus[0]===si&&legendFocus[1]===k)?null:[si,k];
    searchSet=legendFocus?[si+':'+k]:null;applyFocus();renderLegend();if(legendFocus)zoomToSet(searchSet)})}
function applyFocus(){const op=+$('#geoOp').value;
  if(!searchSet){map.setPaintProperty('geo-fill','fill-opacity',op);return}
  map.setPaintProperty('geo-fill','fill-opacity',['case',['in',['concat',['to-string',['get','s']],':',['to-string',['get','u']]],['literal',searchSet]],Math.max(op,0.85),0.08])}
function zoomToSet(set){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,n=0;GEO.features.forEach((f,i)=>{if(set.includes(f.properties.s+':'+f.properties.u)){const b=idx[i];x0=Math.min(x0,b[0]);y0=Math.min(y0,b[1]);x1=Math.max(x1,b[2]);y1=Math.max(y1,b[3]);n++}});if(n)map.fitBounds([[x0,y0],[x1,y1]],{padding:60,maxZoom:12})}

/* ---------- search ---------- */
const norm=s=>String(s).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g,'');
$('#q').addEventListener('input',()=>{const q=norm($('#q').value.trim());const box=$('#qres');
  if(q.length<2){box.hidden=true;searchSet=legendFocus?searchSet:null;if(!legendFocus)applyFocus();return}
  const hits=[];UNITS.forEach((sh,si)=>sh.units.forEach((u,k)=>{if(u.c==='Göl')return;const t=norm(u.c+' '+u.n+' '+u.l+' '+u.a);if(t.includes(q))hits.push({si,k,u,sh})}));
  searchSet=hits.map(h=>h.si+':'+h.k);legendFocus=null;applyFocus();
  box.innerHTML=hits.length?`<button data-all="1"><span></span><span><b>${hits.length} birim</b> · tümünü haritada göster</span></button>`+hits.slice(0,60).map((h,i)=>`<button data-i="${i}"><span class="sw" style="width:16px;height:12px;background:${h.u.col}"></span><span><span class="code">${esc(h.u.c)}</span> ${esc(h.u.n)} <span class="muted">· ${esc(h.u.a)} · ${esc(h.sh.title)}</span></span></button>`).join(''):'<div class="note" style="padding:8px">Eşleşen birim yok.</div>';
  box.hidden=false;
  $$('#qres button').forEach(b=>b.onclick=()=>{if(b.dataset.all)zoomToSet(searchSet);else{const h=hits[+b.dataset.i];zoomToSet([h.si+':'+h.k]);$('#legSheet').value=h.si;legendFocus=[h.si,h.k];searchSet=[h.si+':'+h.k];applyFocus();renderLegend();showTab('t-legend')}box.hidden=true})});
$('#q').addEventListener('keydown',e=>{if(e.key==='Escape'){$('#q').value='';$('#qres').hidden=true;searchSet=null;legendFocus=null;applyFocus();renderLegend()}});

/* ---------- layers ---------- */
/* Google Map Tiles API (resmî; kullanıcının kendi API anahtarı ile) */
const GTYPES={groad:{mapType:'roadmap'},gsat:{mapType:'satellite'},ghyb:{mapType:'satellite',layerTypes:['layerRoadmap']},gter:{mapType:'terrain',layerTypes:['layerRoadmap']}};
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}}, lsSet=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch(e){}};
async function ensureGoogle(v){if(map.getLayer('bm-'+v))return true;const key=($('#gkey').value||'').trim();
  if(!key){setHint('Google altlığı için Katmanlar sekmesine Google Maps API anahtarınızı girin.');showTab('t-layers');return false}
  try{const r=await fetch('https://tile.googleapis.com/v1/createSession?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...GTYPES[v],language:'tr-TR',region:'TR'})});
    const j=await r.json();if(!r.ok||!j.session)throw new Error((j.error&&j.error.message)||('HTTP '+r.status));
    map.addSource('bm-'+v,{type:'raster',tiles:[`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${encodeURIComponent(key)}`],tileSize:j.tileWidth||256,maxzoom:22,attribution:'Harita verileri ©'+new Date().getFullYear()+' Google'});
    map.addLayer({id:'bm-'+v,type:'raster',source:'bm-'+v,layout:{visibility:'none'}},'bm-etopo');BASEMAPS[v]={google:1};return true}
  catch(err){setHint('Google altlığı açılamadı: '+err.message);return false}}
async function setBasemap(v){if(GTYPES[v]&&!(await ensureGoogle(v))){const r=$(`#basemaps input[value="${BM}"]`);if(r)r.checked=true;return}
  BM=v;Object.keys(BASEMAPS).forEach(k=>map.getLayer('bm-'+k)&&map.setLayoutProperty('bm-'+k,'visibility',v===k?'visible':'none'));const r=$(`#basemaps input[value="${v}"]`);if(r)r.checked=true}
$$('#basemaps input').forEach(r=>r.onchange=()=>setBasemap(r.value));
$('#gkey').value=lsGet('gkey')||'';
$('#gsave').onclick=()=>{const k=$('#gkey').value.trim();lsSet('gkey',k);Object.keys(GTYPES).forEach(v=>{if(map.getLayer('bm-'+v)){map.removeLayer('bm-'+v);map.removeSource('bm-'+v);delete BASEMAPS[v]}});
  $('#gstat').textContent=k?'Anahtar bu tarayıcıda kaydedildi. Bir Google altlığı seçin.':'Anahtar silindi.';if(GTYPES[BM])setBasemap('etopo')};
// altlık karoları yüklenemezse otomatik olarak sıradaki altlığa geç
map.on('error',e=>{const id=e.sourceId||'';if(!id.startsWith('bm-'))return;const k=id.slice(3);bmErr[k]=(bmErr[k]||0)+1;
  if(GTYPES[k])return;
  if(k===BM&&bmErr[k]===6){const order=['etopo','osm','sat','topo'].filter(x=>(bmErr[x]||0)<6);if(order.length){setBasemap(order[0]);setHint('Altlık yüklenemedi, '+({etopo:'Esri Topoğrafya',osm:'OSM',sat:'Uydu',topo:'OpenTopoMap'})[order[0]]+' altlığına geçildi.')}}});
$('#hill').onchange=e=>map.setLayoutProperty('hill','visibility',e.target.checked?'visible':'none');
function setTerrain(){const on=$('#t3d').checked,ex=+$('#exag').value;$('#exagV').textContent=ex+'×';
  if(on){map.setTerrain({source:'dem',exaggeration:ex});if(map.getPitch()<30)map.easeTo({pitch:60,duration:800})}else{map.setTerrain(null);map.easeTo({pitch:0,duration:600})}}
$('#t3d').onchange=()=>{setTerrain();sync3d()};
function sync3d(){$('#b3d').setAttribute('aria-pressed',$('#t3d').checked)}
$('#b3d').onclick=()=>{$('#t3d').checked=!$('#t3d').checked;setTerrain();sync3d()};$('#exag').oninput=()=>{if($('#t3d').checked)setTerrain();else $('#exagV').textContent=$('#exag').value+'×'};
$('#geoOn').onchange=e=>['geo-fill','geo-line'].forEach(l=>map.setLayoutProperty(l,'visibility',e.target.checked?'visible':'none'));
$('#geoOp').oninput=applyFocus;
$('#faultOn').onchange=e=>map.getLayer('faults')&&map.setLayoutProperty('faults','visibility',e.target.checked?'visible':'none');
$('#sheetOn').onchange=e=>['frames','frames-lbl'].forEach(l=>map.setLayoutProperty(l,'visibility',e.target.checked?'visible':'none'));
function buildOverlayList(){$('#ovList').innerHTML=OVS.map(o=>`<label><input type="checkbox" data-ov="${o.id}"><span class="id">${o.id}</span><span>${esc(o.title)}</span><button class="zoom" data-z="${o.id}" type="button">git</button></label>`).join('');
  $$('#ovList input').forEach(c=>c.onchange=()=>{map.setLayoutProperty('ov-'+c.dataset.ov,'visibility',c.checked?'visible':'none');countOv()});
  $$('#ovList .zoom').forEach(b=>b.onclick=e=>{e.preventDefault();const o=OVS.find(x=>x.id===b.dataset.z);map.fitBounds([[o.bbox[0],o.bbox[1]],[o.bbox[2],o.bbox[3]]],{padding:30})})}
function countOv(){$('#ovCount').textContent=$$('#ovList input').filter(c=>c.checked).length}
$('#ovAll').onclick=()=>{$$('#ovList input').forEach(c=>{c.checked=true;c.onchange()})};
$('#ovNone').onclick=()=>{$$('#ovList input').forEach(c=>{c.checked=false;c.onchange()})};
$('#ovOp').oninput=()=>OVS.forEach(o=>map.setPaintProperty('ov-'+o.id,'raster-opacity',+$('#ovOp').value));

/* ---------- kullanıcı dosyaları: KML / KMZ / GeoJSON / GPX ---------- */
const USER={feats:[],files:[],imgs:[]};
function addUserLayers(){
  const col=k=>['coalesce',['get',k],'#d4380d'];
  map.addLayer({id:'user-fill',type:'fill',source:'user',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':col('fill'),'fill-opacity':['coalesce',['get','fill-opacity'],0.35]}});
  map.addLayer({id:'user-line',type:'line',source:'user',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':col('stroke'),'line-width':['coalesce',['get','stroke-width'],2],'line-opacity':['coalesce',['get','stroke-opacity'],1]}});
  map.addLayer({id:'user-pt',type:'circle',source:'user',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':6,'circle-color':['coalesce',['get','icon-color'],['get','marker-color'],'#d4380d'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
  map.addLayer({id:'user-lbl',type:'symbol',source:'user',minzoom:9,filter:['all',['==',['geometry-type'],'Point'],['has','name']],layout:{'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':12,'text-offset':[0,1.1],'text-anchor':'top'},paint:{'text-color':'#111','text-halo-color':'#fff','text-halo-width':1.6}});
}
const KCOL=c=>{if(!c)return null;c=String(c).trim();if(/^[0-9a-f]{8}$/i.test(c))return{c:'#'+c.slice(6,8)+c.slice(4,6)+c.slice(2,4),a:parseInt(c.slice(0,2),16)/255};return null};
function cleanProps(p){const o={};for(const [k,v] of Object.entries(p||{})){if(v==null||typeof v==='object'&&!Array.isArray(v))continue;o[k]=v}
  // KML renklerini (aabbggrr) düzelt
  ['fill','stroke'].forEach(k=>{const r=KCOL(o[k]);if(r){o[k]=r.c;o[k+'-opacity']=r.a}});
  if(Array.isArray(o['stroke-width']))delete o['stroke-width'];
  return o}
function flatten(fc,file){const out=[];const add=(g,p)=>{if(!g)return;if(g.type==='GeometryCollection')g.geometries.forEach(x=>add(x,p));
    else if(g.type.startsWith('Multi')){const t=g.type.slice(5);g.coordinates.forEach(c=>out.push({type:'Feature',properties:p,geometry:{type:t,coordinates:c}}))}
    else out.push({type:'Feature',properties:p,geometry:g})};
  (fc.features||[fc]).forEach(f=>{const p=cleanProps(f.properties);p._file=file;p._u=USER.feats.length+out.length;add(f.geometry,p)});return out}
function safeHTML(html){const d=new DOMParser().parseFromString('<div>'+html+'</div>','text/html');const OK=new Set(['B','I','STRONG','EM','BR','P','DIV','SPAN','TABLE','TBODY','THEAD','TR','TD','TH','UL','OL','LI','H1','H2','H3','H4','SMALL','HR']);
  const walk=n=>{[...n.childNodes].forEach(c=>{if(c.nodeType===1){if(!OK.has(c.tagName)){c.replaceWith(...c.childNodes);walk(n);return}[...c.attributes].forEach(a=>c.removeAttribute(a.name));walk(c)}else if(c.nodeType!==3)c.remove()})};
  const root=d.body.firstChild;walk(root);return root.innerHTML}
function userPopup(e){const L=['user-pt','user-line','user-fill'].filter(l=>map.getLayer(l));const hit=map.queryRenderedFeatures(e.point,{layers:L});if(!hit.length)return false;
  const p=hit[0].properties;const skip=new Set(['_file','_u','fill','fill-opacity','stroke','stroke-width','stroke-opacity','icon','icon-color','icon-scale','icon-opacity','label-color','label-scale','marker-color','styleUrl','styleHash','styleMapHash','description','name','visibility','timestamp']);
  let h=`<div class="upop"><div class="eyebrow">${esc(p._file)}</div>${p.name?`<b>${esc(p.name)}</b>`:''}`;
  if(p.description){const dsc=typeof p.description==='string'?p.description:(p.description.value||'');h+=`<div class="udesc">${safeHTML(dsc)}</div>`}
  const rows=Object.entries(p).filter(([k])=>!skip.has(k));if(rows.length)h+='<table class="cross">'+rows.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')+'</table>';
  const i=lookup(e.lngLat.lng,e.lngLat.lat);if(i!=null){const x=info(i);h+=`<div class="note">Altındaki birim: <span class="code">${esc(x.u.c)}</span> ${esc(x.u.n)}</div>`}
  new maplibregl.Popup({maxWidth:'340px'}).setLngLat(e.lngLat).setHTML(h+'</div>').addTo(map);return true}
async function readUserFile(file){const name=file.name,ext=name.split('.').pop().toLowerCase();let fc=null,imgs=[];
  const parseXML=t=>new DOMParser().parseFromString(t,'text/xml');
  if(ext==='kmz'){const z=await JSZip.loadAsync(file);const ks=Object.keys(z.files).filter(n=>n.toLowerCase().endsWith('.kml'));if(!ks.length)throw new Error('KMZ içinde KML bulunamadı');
    const main=ks.find(n=>/(^|\/)doc\.kml$/i.test(n))||ks[0];const dom=parseXML(await z.file(main).async('text'));fc=toGeoJSON.kml(dom);imgs=await groundOverlays(dom,async href=>{const f=z.file(href.replace(/^\.\//,''));return f?URL.createObjectURL(await f.async('blob')):null})}
  else if(ext==='kml'){const dom=parseXML(await file.text());fc=toGeoJSON.kml(dom);imgs=await groundOverlays(dom,async href=>/^https?:/.test(href)?href:null)}
  else if(ext==='gpx'){fc=toGeoJSON.gpx(parseXML(await file.text()))}
  else if(ext==='geojson'||ext==='json'){fc=JSON.parse(await file.text())}
  else throw new Error('Desteklenmeyen dosya türü: .'+ext);
  return{fc,imgs}}
async function groundOverlays(dom,resolve){const out=[];const tx=(n,t)=>{const e=n.getElementsByTagName(t)[0];return e?e.textContent.trim():null};
  for(const g of [...dom.getElementsByTagName('GroundOverlay')]){const href=tx(g,'href');if(!href)continue;let coords=null;
    const q=g.getElementsByTagName('gx:LatLonQuad')[0]||g.getElementsByTagName('LatLonQuad')[0];
    if(q){const c=tx(q,'coordinates').split(/\s+/).map(s=>s.split(',').map(Number));if(c.length>=4)coords=[c[3],c[2],c[1],c[0]].map(p=>[p[0],p[1]])}
    else{const b=g.getElementsByTagName('LatLonBox')[0];if(b){const N=+tx(b,'north'),S=+tx(b,'south'),E=+tx(b,'east'),W=+tx(b,'west');coords=[[W,N],[E,N],[E,S],[W,S]]}}
    if(!coords)continue;const url=await resolve(href);if(url)out.push({name:tx(g,'name')||href,url,coords})}
  return out}
async function loadUserFiles(list){for(const file of list){setHint(file.name+' okunuyor…');
  try{const {fc,imgs}=await readUserFile(file);const feats=flatten(fc,file.name);USER.feats.push(...feats);map.getSource('user').setData({type:'FeatureCollection',features:USER.feats});
    const ids=[];imgs.forEach((im,k)=>{const id='uimg-'+USER.imgs.length;USER.imgs.push(id);ids.push(id);map.addSource(id,{type:'image',url:im.url,coordinates:im.coords});map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0.8,'raster-fade-duration':0}},'user-fill')});
    USER.files.push({name:file.name,n:feats.length,imgs:ids});renderUserList();
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const ext=c=>{if(typeof c[0]==='number'){x0=Math.min(x0,c[0]);y0=Math.min(y0,c[1]);x1=Math.max(x1,c[0]);y1=Math.max(y1,c[1])}else c.forEach(ext)};
    feats.forEach(f=>ext(f.geometry.coordinates));imgs.forEach(i=>ext(i.coords));
    if(x0<1e9)map.fitBounds([[x0,y0],[x1,y1]],{padding:60,maxZoom:15});
    setHint(`${file.name}: ${feats.length} öğe${imgs.length?`, ${imgs.length} görüntü`:''} yüklendi. Araziyi görmek için 3B düğmesine basın.`)}
  catch(err){setHint(file.name+' yüklenemedi: '+err.message)}}}
function renderUserList(){$('#userList').innerHTML=USER.files.map((f,i)=>`<label><span>${esc(f.name)}</span><span class="muted num">${f.n} öğe${f.imgs.length?' · '+f.imgs.length+' görüntü':''}</span><button class="zoom" type="button" data-rm="${i}">kaldır</button></label>`).join('');
  $$('#userList [data-rm]').forEach(b=>b.onclick=e=>{e.preventDefault();const f=USER.files[+b.dataset.rm];USER.feats=USER.feats.filter(x=>x.properties._file!==f.name);map.getSource('user').setData({type:'FeatureCollection',features:USER.feats});f.imgs.forEach(id=>{map.removeLayer(id);map.removeSource(id)});USER.files.splice(+b.dataset.rm,1);renderUserList()})}
$('#ufile').onchange=e=>{loadUserFiles([...e.target.files]);e.target.value=''};
$('#ubtn').onclick=()=>$('#ufile').click();
['dragenter','dragover'].forEach(t=>document.addEventListener(t,e=>{e.preventDefault();document.body.classList.add('drop')}));
['dragleave','drop'].forEach(t=>document.addEventListener(t,e=>{e.preventDefault();if(t==='drop'||e.target===document.documentElement||!e.relatedTarget)document.body.classList.remove('drop')}));
document.addEventListener('drop',e=>{if(e.dataTransfer&&e.dataTransfer.files.length)loadUserFiles([...e.dataTransfer.files])});

/* ---------- pafta indeksi: tıklanan pafta için aç/kapat ---------- */
function sheetAt(lon,lat){for(const f of PIDX){if(inRing(lon,lat,f.geometry.coordinates[0]))return f.properties.id}return null}
function vecFilter(){const h=[...hiddenSheets];const f=h.length?['!',['in',['get','s'],['literal',h]]]:null;['geo-fill','geo-line'].forEach(l=>map.setFilter(l,f));map.setFilter('geo-lbl',f)}
function sheetBox(c){const id=sheetAt(c[0],c[1]),box=$('#sheetBox');if(!id){box.hidden=true;return}
  const o=OVS.find(x=>x.id===id),si=UNITS.findIndex(u=>u.id===id);
  let h=`<div class="eyebrow">1:100.000 pafta · <span class="code">${esc(id)}</span>${o?' · '+esc(o.title):''}</div><div class="row2">`;
  if(o){const on=map.getLayoutProperty('ov-'+id,'visibility')==='visible';h+=`<button class="btn" data-sov="${id}">${on?'Taranmış paftayı kapat':'Taranmış paftayı aç'}</button>`}
  if(si>=0)h+=`<button class="btn" data-svec="${si}">${hiddenSheets.has(si)?'Vektör haritayı göster':'Vektör haritayı gizle'}</button>`;
  if(!o&&si<0)h+='<span class="note">Bu pafta henüz atlasta yok.</span>';
  box.innerHTML=h+'</div>';box.hidden=false;
  const b1=box.querySelector('[data-sov]');if(b1)b1.onclick=()=>{const cb=$(`#ovList input[data-ov="${id}"]`);cb.checked=!cb.checked;cb.onchange();sheetBox(c)};
  const b2=box.querySelector('[data-svec]');if(b2)b2.onclick=()=>{hiddenSheets.has(si)?hiddenSheets.delete(si):hiddenSheets.add(si);vecFilter();sheetBox(c)}}
$('#pidxOn').onchange=e=>['pidx-fill','pidx-line','pidx-lbl'].forEach(l=>map.setLayoutProperty(l,'visibility',e.target.checked?'visible':'none'));
$('#lblOn').onchange=e=>map.setLayoutProperty('geo-lbl','visibility',e.target.checked?'visible':'none');
$('#opQuick').oninput=e=>{$('#geoOp').value=e.target.value;applyFocus();$('#opV').textContent=Math.round(e.target.value*100)+'%'};
$('#geoOp').addEventListener('input',()=>{$('#opQuick').value=$('#geoOp').value;$('#opV').textContent=Math.round($('#geoOp').value*100)+'%'});

/* ---------- elevation from terrarium tiles ---------- */
const ZE=12, tileCache=new Map();
function tileXY(lon,lat,z){const n=2**z,x=(lon+180)/360*n,r=lat*Math.PI/180,y=(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n;return[x,y]}
function getTile(x,y){const k=x+'/'+y;if(tileCache.has(k))return tileCache.get(k);
  const p=fetch(TERRAIN.replace('{z}',ZE).replace('{x}',x).replace('{y}',y)).then(r=>{if(!r.ok)throw new Error(r.status);return r.blob()}).then(createImageBitmap).then(bm=>{const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(bm,0,0);return g.getImageData(0,0,256,256).data}).catch(()=>null);
  tileCache.set(k,p);return p}
async function elevAt(lon,lat){const [fx,fy]=tileXY(lon,lat,ZE);const tx=Math.floor(fx),ty=Math.floor(fy);const d=await getTile(tx,ty);if(!d)return null;
  const px=Math.min(255,Math.floor((fx-tx)*256)),py=Math.min(255,Math.floor((fy-ty)*256)),o=(py*256+px)*4;return d[o]*256+d[o+1]+d[o+2]/256-32768}

/* ---------- cross-section ---------- */
async function runSection(a,b){
  const D=hav(a,b),N=Math.max(100,Math.min(400,Math.round(D*25)));const pts=[];for(let k=0;k<N;k++){const t=k/(N-1);pts.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
  showTab('t-section');$('#secStatus').className='status';$('#secStatus').textContent='Yükseklikler okunuyor…';
  $('#secBody').className='';$('#secBody').textContent=`Kesit A–A': ${D.toFixed(2)} km, ${N} örnek nokta.`;
  const units=pts.map(p=>{const i=lookup(p[0],p[1]);return i==null?null:info(i)});
  let z=await Promise.all(pts.map(p=>elevAt(p[0],p[1])));let flat=false;
  if(z.some(v=>v==null)){if(z.every(v=>v==null)){flat=true;z=z.map(()=>0);$('#secStatus').className='status warn';$('#secStatus').textContent='Yükseklik karoları alınamadı (ağ bağlantısı?). Kesit düz yüzey olarak çizildi; yalnızca birim dizilimi gerçektir.'}
    else{let last=z.find(v=>v!=null);z=z.map(v=>v==null?last:(last=v))}}
  if(!flat)$('#secStatus').textContent=`Kot aralığı ${Math.round(Math.min(...z))}–${Math.round(Math.max(...z))} m · yükseklik: AWS Terrain Tiles z${ZE}.`;
  lastSec={a,b,D,pts,units,z,flat,done:true};drawSection();setHint("Kesit hazır. Grafiğin üzerinde gezinince haritada konum görünür. Yeni kesit için A noktasına tıklayın.");
}
function drawSection(){if(!lastSec)return;const {D,units,z,flat,pts}=lastSec,N=z.length,vex=+$('#vex').value;
  const zmin=Math.min(...z),zmax=Math.max(...z),pl=52,pr=14,pt=30,pb=38,W=Math.max(560,Math.min(1600,Math.round(D*80)));const strip=Math.max(80,Math.min(300,(zmax-zmin)*0.25||150));
  let lo=Math.floor((zmin-strip-100)/100)*100,hi=Math.ceil((zmax+150)/100)*100;if(flat){lo=-300;hi=150}
  const kmPx=(W-pl-pr)/D;let H=(hi-lo)*kmPx/1000*vex;H=Math.max(170,Math.min(560,H));const sy=H/(hi-lo);
  const X=k=>pl+(k/(N-1))*D*kmPx,Y=m=>pt+(hi-m)*sy,Ht=pt+H+pb;
  const ink=css('--ink'),mute=css('--mute'),gridc=css('--grid'),bg=css('--panel');
  let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" font-family="IBM Plex Sans Condensed, Arial Narrow, sans-serif" font-size="11"><rect width="100%" height="100%" fill="${bg}"/>`;
  const st=(hi-lo)>2000?500:(hi-lo)>800?200:100;for(let m=Math.ceil(lo/st)*st;m<=hi;m+=st)s+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(m)}" y2="${Y(m)}" stroke="${gridc}" stroke-width="0.5"/>${flat?'':`<text x="${pl-5}" y="${Y(m)+4}" text-anchor="end" fill="${mute}">${m}</text>`}`;
  const ks=D>30?5:D>12?2:D>4?1:0.5;for(let k=0;k<=D+1e-9;k+=ks){const x=pl+k*kmPx;s+=`<line x1="${x}" x2="${x}" y1="${pt}" y2="${pt+H}" stroke="${gridc}" stroke-width="0.5"/><text x="${x}" y="${pt+H+15}" text-anchor="middle" fill="${mute}">${+k.toFixed(1)}</text>`}
  s+=`<text x="${(pl+W-pr)/2}" y="${Ht-5}" text-anchor="middle" fill="${mute}">Mesafe (km) · düşey abartı ${vex}×</text>`;
  if(!flat)s+=`<text x="11" y="${pt+H/2}" transform="rotate(-90 11 ${pt+H/2})" text-anchor="middle" fill="${mute}">Kot (m)</text>`;
  const segs=[];let cur=null;for(let k=0;k<N;k++){const key=units[k]?units[k].si+':'+units[k].ui:'x';if(!cur||cur.key!==key){cur={key,u:units[k],k0:k,k1:k};segs.push(cur)}else cur.k1=k}
  for(const g of segs){const top=[],bot=[];const zs=g.k0>0?(z[g.k0]+z[g.k0-1])/2:z[0],ze=g.k1<N-1?(z[g.k1]+z[g.k1+1])/2:z[N-1];const xs=X(Math.max(0,g.k0-0.5)),xe=X(Math.min(N-1,g.k1+0.5));
    top.push([xs,Y(zs)]);for(let k=g.k0;k<=g.k1;k++)top.push([X(k),Y(z[k])]);top.push([xe,Y(ze)]);
    bot.push([xe,Y(ze-strip)]);for(let k=g.k1;k>=g.k0;k--)bot.push([X(k),Y(z[k]-strip)]);bot.push([xs,Y(zs-strip)]);
    s+=`<polygon points="${top.concat(bot).map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="${g.u?g.u.u.col:'#d4d0c6'}" stroke="#333" stroke-width="0.35"/>`;
    if(g.u&&(xe-xs)>24){const km=Math.round((g.k0+g.k1)/2);s+=`<text x="${((xs+xe)/2).toFixed(1)}" y="${(Y(z[km])-6).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" fill="${ink}">${esc(g.u.u.c)}</text>`}}
  s+=`<polyline points="${z.map((m,k)=>X(k).toFixed(1)+','+Y(m).toFixed(1)).join(' ')}" fill="none" stroke="${ink}" stroke-width="1.4"/>`;
  s+=`<text x="${pl}" y="${pt-10}" font-weight="600" fill="${ink}">A</text><text x="${W-pr}" y="${pt-10}" text-anchor="end" font-weight="600" fill="${ink}">A'</text>`;
  s+=`<text x="${(pl+W-pr)/2}" y="${pt-10}" text-anchor="middle" fill="${mute}">Renkli şerit: yüzeydeki birim (${Math.round(strip)} m kalınlıkta gösterim) · yüzey altı yorumlanmamıştır</text>`;
  s+=`<line id="cur" x1="0" x2="0" y1="${pt}" y2="${pt+H}" stroke="#b8320f" stroke-width="1" visibility="hidden"/></svg>`;
  lastSec.svg=s.replace(/<line id="cur"[^>]*\/>/,'');$('#secSvg').innerHTML=s;$('#secSvg').hidden=false;$('#secCtrl').hidden=false;
  const svg=$('#secSvg svg'),cl=svg.querySelector('#cur');
  svg.onmousemove=e=>{const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)*(W/r.width);const k=Math.round((x-pl)/(W-pl-pr)*(N-1));if(k<0||k>=N)return;
    cl.setAttribute('x1',X(k));cl.setAttribute('x2',X(k));cl.setAttribute('visibility','visible');map.getSource('cursor').setData({type:'FeatureCollection',features:[pt(pts[k])]});
    const u=units[k];setHint(`${(k/(N-1)*D).toFixed(2)} km · ${flat?'':Math.round(z[k])+' m · '}${u?u.u.c+' – '+u.u.n:'vektör pafta dışı'}`)};
  svg.onmouseleave=()=>{cl.setAttribute('visibility','hidden');map.getSource('cursor').setData(emptyFC())};
  $('#secTable tbody').innerHTML=segs.filter(g=>g.u).map(g=>`<tr><td class="num">${(g.k0/(N-1)*D).toFixed(2)}–${(g.k1/(N-1)*D).toFixed(2)}</td><td><span class="code">${esc(g.u.u.c)}</span> ${esc(g.u.u.n)}<div class="muted" style="font-size:11px">${esc(g.u.sheet.title)}</div></td><td>${esc(g.u.u.a)}</td><td>${esc(g.u.u.l)}</td></tr>`).join('');$('#secTable').hidden=false;
}
$('#vex').onchange=drawSection;
function download(name,data,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
$('#dlSvg').onclick=()=>lastSec&&download('jeolojik_kesit.svg',lastSec.svg,'image/svg+xml');
$('#dlCsv').onclick=()=>{if(!lastSec)return;const {pts,z,units,D,flat}=lastSec,N=z.length;let t='mesafe_km;boylam;enlem;kot_m;birim;birim_adi;yas;litoloji;pafta\n';
  pts.forEach((p,k)=>{const u=units[k];t+=[(k/(N-1)*D).toFixed(3),p[0].toFixed(6),p[1].toFixed(6),flat?'':Math.round(z[k]),u?u.u.c:'',u?u.u.n:'',u?u.u.a:'',u?u.u.l:'',u?u.sheet.title:''].map(v=>String(v).replace(/;/g,',')).join(';')+'\n'});
  download('jeolojik_kesit.csv','﻿'+t,'text/csv')};
})();
