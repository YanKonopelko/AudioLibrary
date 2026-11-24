/* Wavebox: buildless, dependency-free, compatible with GitHub project Pages. */
'use strict';
(() => {
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const time = seconds => { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2,'0')}`; };
const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
const readStored = (key, fallback) => {try { const v=JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v.filter(x=>typeof x==='string') : fallback; } catch { return fallback; }};
const saveStored = (key, value) => {try {localStorage.setItem(key,JSON.stringify(value));} catch { /* Private browsing may disable storage. */ }};
const state = {catalog:null, tracks:[], byId:new Map(), categories:new Map(), favorites:new Set(readStored('wavebox.favorites',[])), recent:readStored('wavebox.recent',[]), view:'all', category:'', query:'', source:'', duration:'', sort:'default', page:1, pageSize:60, results:[], current:null, localServer:false, audioBase:'', files:new Map(), pendingTrack:null, objectUrl:null, error:false};
const audio = $('#audio');
audio.volume = .5;
let toastTimer, searchTimer, seekingTo = null;

const synonyms = {
 'шаги':['footstep','step','walking'], 'шаг':['step','footstep'], 'ходьба':['walk','walking'], 'бег':['run','running'], 'прыжок':['jump','bounce'], 'прыжки':['jump','bounce'],
 'кнопка':['button','click','interface'], 'клик':['click','button'], 'нажатие':['click','press'], 'монеты':['coin','pickup','collect'], 'монета':['coin','pickup'], 'подбор':['pickup','collect'],
 'победа':['win','success','victory'], 'награда':['reward','success','pickup'], 'поражение':['failure','lose','negative'], 'ошибка':['error','failure','negative'],
 'взрыв':['explosion','blast','explode'], 'взрывы':['explosion','blast','explode'], 'огонь':['fire','flame'], 'выстрел':['gunshot','gun','rifle'], 'выстрелы':['gunshot','gun','rifle'],
 'дождь':['rain','drizzle'], 'гром':['thunder'], 'ветер':['wind'], 'вода':['water','liquid'], 'капли':['drip','drop'], 'всплеск':['splash'],
 'дверь':['door'], 'металл':['metal','steel','iron','aluminum'], 'дерево':['wood','wooden'], 'стекло':['glass'], 'камень':['stone','rock'],
 'сирена':['siren','alarm'], 'тревога':['alarm','alert','emergency'], 'лазер':['laser','ray'], 'магия':['magic','spell','energy'], 'монстр':['monster','beast','creature'],
 'робот':['robot','mech','servo'], 'двигатель':['engine','motor'], 'машина':['car','vehicle','machine'], 'голос':['vocal','voice','human'], 'собака':['dog','bark'], 'кошка':['cat','meow'],
 'птицы':['bird'], 'птица':['bird'], 'лес':['forest','jungle'], 'ночь':['night'], 'город':['city','urban','traffic'], 'свуш':['swoosh','whoosh','swish'], 'удар':['impact','hit','thump'], 'удары':['impact','hit'],
 'колокол':['bell','bong'], 'таймер':['timer','countdown'], 'ретро':['retro','arcade'], 'интерфейс':['interface','button','beep'], 'телефон':['phone','telephone']
};

function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200); }
function openDialog(id) { closeSidebar(); if (!$(id).open) $(id).showModal(); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded','false'); }
function categoryFor(track) { return state.categories.get(track.category); }
function sourceName(track) { return track.source==='adobe' ? 'Adobe Audition' : 'Game Sound FX'; }
function formatFor(track) { return state.localServer||state.files.has(track.id)||state.audioBase?'WAV':track.preview?'OPUS':'WAV'; }
function durationLabel(seconds) { return seconds<1 ? `${seconds.toFixed(2).replace('.',',')} с` : time(seconds); }

function readUrl() {
 const params=new URLSearchParams(location.search);
 const cat=params.get('category')||'';
 state.category=state.categories.has(cat)?cat:'';
 state.view=['all','favorites','recent'].includes(params.get('view'))?params.get('view'):'all';
 state.query=(params.get('q')||'').slice(0,300);
 state.source=['adobe','game-sound-fx'].includes(params.get('source'))?params.get('source'):'';
 state.duration=['short','medium','long','ambient'].includes(params.get('duration'))?params.get('duration'):'';
 state.sort=['default','name','duration-asc','duration-desc','size'].includes(params.get('sort'))?params.get('sort'):'default';
 $('#search').value=state.query; $('#source-filter').value=state.source; $('#duration-filter').value=state.duration; $('#sort').value=state.sort;
}
function writeUrl() {
 const p=new URLSearchParams();
 if(state.category)p.set('category',state.category);
 if(state.view!=='all')p.set('view',state.view);
 if(state.query)p.set('q',state.query);
 if(state.source)p.set('source',state.source);
 if(state.duration)p.set('duration',state.duration);
 if(state.sort!=='default')p.set('sort',state.sort);
 history.replaceState(null,'',`${location.pathname}${p.size?'?'+p:''}${location.hash}`);
}
function renderCategories() {
 $('#category-nav').innerHTML=state.catalog.categories.filter(c=>c.count).map(c=>`<button class="nav-item ${state.category===c.id?'active':''}" data-category="${c.id}" aria-pressed="${state.category===c.id}">${icon(c.icon)}<span>${escapeHtml(c.name)}</span><span class="nav-count">${number(c.count)}</span></button>`).join('');
 $('#quick-categories').innerHTML=['interface','retro','footsteps','ambience'].map(id=>{ const c=state.categories.get(id);return `<button class="quick-card ${state.category===id?'active':''}" data-category="${id}" style="--category-color:${c.color}" aria-pressed="${state.category===id}"><span class="quick-icon">${icon(c.icon)}</span><span class="quick-copy"><strong>${escapeHtml(c.name)}</strong><span>${number(c.count)} звуков</span></span></button>`; }).join('');
 $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view&&!state.category);b.setAttribute('aria-pressed',String(b.dataset.view===state.view&&!state.category));});
 $('#favorites-count').textContent=number(state.favorites.size);
}
function filterTracks(reset=true) {
 if(!state.catalog)return;
 if(reset)state.page=1;
 const tokens=state.query.toLowerCase().replace(/ё/g,'е').trim().split(/\s+/).filter(Boolean);
 const terms=tokens.map(t=>synonyms[t]?[t,...synonyms[t]]:[t]);
 const recentOrder=new Map(state.recent.map((id,i)=>[id,i]));
 state.results=state.tracks.filter(t=>{
  if(state.category&&t.category!==state.category)return false;
  if(state.view==='favorites'&&!state.favorites.has(t.id))return false;
  if(state.view==='recent'&&!recentOrder.has(t.id))return false;
  if(state.source&&t.source!==state.source)return false;
  if(state.duration==='short'&&t.duration>=2)return false;
  if(state.duration==='medium'&&(t.duration<2||t.duration>=10))return false;
  if(state.duration==='long'&&(t.duration<10||t.duration>30))return false;
  if(state.duration==='ambient'&&t.duration<=30)return false;
  return terms.every(alternatives=>alternatives.some(term=>t.searchText.includes(term)));
 });
 const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
 if(state.sort==='name')state.results.sort((a,b)=>collator.compare(a.name,b.name));
 else if(state.sort==='duration-asc')state.results.sort((a,b)=>a.duration-b.duration);
 else if(state.sort==='duration-desc')state.results.sort((a,b)=>b.duration-a.duration);
 else if(state.sort==='size')state.results.sort((a,b)=>a.bytes-b.bytes);
 else if(state.view==='recent')state.results.sort((a,b)=>recentOrder.get(a.id)-recentOrder.get(b.id));
 state.page=Math.min(state.page,Math.max(1,Math.ceil(state.results.length/state.pageSize)));
 let title=state.category?state.categories.get(state.category).name:state.view==='favorites'?'Избранное':state.view==='recent'?'Недавно слушали':'Все звуки';
 $('#library-title').firstChild.textContent=`${title} `;
 $('#breadcrumb-current').textContent=title;
 $('#result-count').textContent=number(state.results.length);
 $('#library-subtitle').textContent=state.category?state.categories.get(state.category).description:state.view==='favorites'?'Звуки, которые хочется сохранить.':state.view==='recent'?'Вернитесь к тому, что уже нашли.':'Слушайте. Находите. Создавайте.';
 $('#reset-filters').hidden=!(state.query||state.category||state.source||state.duration||state.view!=='all'||state.sort!=='default');
 renderCategories();renderTracks();writeUrl();
}
function waveform(track) {
 return track.peaks.map(p=>`<span style="--height:${Math.max(5,p)}%"></span>`).join('');
}
function renderTracks() {
 const list=$('#track-list');list.setAttribute('aria-busy','false');
 if(!state.results.length){
  const title=state.view==='favorites'&&!state.query?'Пока без избранного':state.view==='recent'&&!state.query?'Здесь появятся ваши находки':'Такого звука пока не нашли';
  const msg=state.view==='favorites'?'Нажмите на сердечко рядом со звуком, чтобы сохранить его.':state.view==='recent'?'Прослушайте любой звук — и он появится здесь.':'Попробуйте другой запрос или уберите один из фильтров.';
  list.innerHTML=`<div class="empty-state">${icon(state.view==='favorites'?'heart':state.view==='recent'?'clock':'search')}<h3>${title}</h3><p>${msg}</p><button class="button button-outline" data-reset>Показать все звуки</button></div>`;
 }else{
  list.innerHTML=state.results.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(t=>{
   const c=categoryFor(t),current=state.current?.id===t.id,playing=current&&!audio.paused,favorite=state.favorites.has(t.id);
   return `<article class="track ${current?'selected':''} ${playing?'playing':''}" data-id="${t.id}" style="--category-color:${c.color}"><button class="track-play" data-action="play" aria-label="${playing?'Пауза':'Слушать'}: ${escapeHtml(t.name)}">${icon(playing?'pause':'play')}</button><div class="track-name"><button class="track-title" data-action="play" title="${escapeHtml(t.originalName)}">${escapeHtml(t.name)}</button><div class="track-meta"><button class="category-tag" data-category="${c.id}">${escapeHtml(c.name)}</button><span class="source-tag">${sourceName(t)}</span></div></div><button class="track-wave" data-action="seek" aria-label="Слушать с выбранной позиции: ${escapeHtml(t.name)}">${waveform(t)}</button><span class="track-duration" title="${t.duration.toFixed(2)} секунд">${durationLabel(t.duration)}</span><span class="track-format" title="Исходник WAV: ${number(t.sampleRate)} Гц · ${t.channels} кан. · ${size(t.bytes)}">${formatFor(t)}</span><div class="track-actions"><button class="icon-button ${favorite?'is-favorite':''}" data-action="favorite" aria-label="${favorite?'Убрать из избранного':'В избранное'}: ${escapeHtml(t.name)}" aria-pressed="${favorite}">${icon('heart')}</button><button class="icon-button" data-action="download" aria-label="Скачать: ${escapeHtml(t.name)}" title="Скачать ${formatFor(t)} · ${size(formatFor(t)==='WAV'?t.bytes:t.preview.bytes)}">${icon('download')}</button></div></article>`;
  }).join('');
 }
 const count=state.results.length,max=Math.max(1,Math.ceil(count/state.pageSize));
 $('#pagination').hidden=!count;
 $('#page-info').textContent=`${number((state.page-1)*state.pageSize+1)}–${number(Math.min(state.page*state.pageSize,count))} из ${number(count)}`;
 $('#page-number').textContent=`${state.page} / ${max}`;
 $('#previous-page').disabled=state.page===1;$('#next-page').disabled=state.page===max;
 updatePlaybackUi();
}
function resetFilters(){ Object.assign(state,{view:'all',category:'',query:'',source:'',duration:'',sort:'default'});$('#search').value='';$('#source-filter').value='';$('#duration-filter').value='';$('#sort').value='default';filterTracks(); }
function chooseCategory(id) { state.category=state.category===id?'':id;state.view='all';filterTracks();closeSidebar(); }
function toggleFavorite(track) {
 if(state.favorites.has(track.id))state.favorites.delete(track.id);else state.favorites.add(track.id);
 saveStored('wavebox.favorites',[...state.favorites]);
 if(state.view==='favorites')filterTracks(false);else{renderTracks();$('#favorites-count').textContent=number(state.favorites.size);}
 updatePlayerFavorite();
}
function updatePlayerFavorite(){
 if(!state.current)return;
 const yes=state.favorites.has(state.current.id),b=$('#player-favorite');b.classList.toggle('is-favorite',yes);b.setAttribute('aria-pressed',String(yes));b.setAttribute('aria-label',yes?'Убрать текущий звук из избранного':'Добавить текущий звук в избранное');
}
function urlFor(track) {
 const file=state.files.get(track.id);
 if(file)return {url:URL.createObjectURL(file),object:true};
 if(state.localServer)return {url:new URL(track.path.split('/').map(encodeURIComponent).join('/'),document.baseURI).href};
 if(state.audioBase)return {url:state.audioBase.replace(/\/$/,'')+'/'+track.path.replace(/^audio\//,'').split('/').map(encodeURIComponent).join('/')};
 if(track.preview)return {url:new URL(track.preview.path,document.baseURI).href,name:track.originalName.replace(/\.wav$/i,'.ogg')};
 return null;
}
function playTrack(track, seekRatio=null) {
 if(!track)return;
 if(state.current?.id===track.id&&audio.src){
  if(seekRatio!==null&&Number.isFinite(audio.duration))audio.currentTime=seekRatio*audio.duration;
  if(seekRatio!==null||audio.paused)audio.play().catch(handlePlayError);else audio.pause();
  return;
 }
 const resolved=urlFor(track);
 if(!resolved){state.pendingTrack=track;openDialog('#connect-dialog');return;}
 audio.pause();
 if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);
 state.objectUrl=resolved.object?resolved.url:null;state.current=track;state.error=false;seekingTo=seekRatio;
 audio.src=resolved.url;
 $('#player-title').textContent=track.name;$('#player-title').title=track.originalName;
 $('#player-category').textContent=`${categoryFor(track).name} · ${sourceName(track)}`;
 $('#player-art').innerHTML=icon(categoryFor(track).icon);$('#player-art').style.color=categoryFor(track).color;
 $('#player-play').disabled=false;$('#player-favorite').disabled=false;$('#player-download').disabled=false;$('#next-track').disabled=false;$('#seek').disabled=false;
 $('#total-time').textContent=time(track.duration);$('#current-time').textContent='0:00';
 updatePlaybackUi();updatePlayerFavorite();audio.play().catch(handlePlayError);
}
function handlePlayError(error){
 if(error.name==='AbortError')return;
 if(state.error)return;state.error=true;
 toast(error.name==='NotAllowedError'?'Нажмите Play, чтобы разрешить воспроизведение.':'Не удалось воспроизвести файл. Проверьте, подключена ли папка со звуками.');
 updatePlaybackUi();
}
function updatePlaybackUi(){
 const playing=state.current&&!audio.paused;
 $('#player-play').innerHTML=icon(playing?'pause':'play');$('#player-play').setAttribute('aria-label',playing?'Пауза':'Воспроизвести');
 $$('.track').forEach(row=>{
  const active=row.dataset.id===state.current?.id,on=active&&!audio.paused;
  row.classList.toggle('selected',active);row.classList.toggle('playing',on);
  const b=row.querySelector('.track-play');b.innerHTML=icon(on?'pause':'play');
  const track=state.byId.get(row.dataset.id);b.setAttribute('aria-label',`${on?'Пауза':'Слушать'}: ${track.name}`);
 });
 updateTime();
}
function updateTime(){
 const fraction=Number.isFinite(audio.duration)&&audio.duration>0?audio.currentTime/audio.duration:0;
 $('#current-time').textContent=time(audio.currentTime);
 if(document.activeElement!==$('#seek'))$('#seek').value=String(Math.round(fraction*1000));
 $('#seek').style.setProperty('--progress',`${fraction*100}%`);
 $$('.track-wave span.past').forEach(b=>b.classList.remove('past'));
 if(state.current){
  const row=$(`.track[data-id="${state.current.id}"]`);
  if(row)row.querySelectorAll('.track-wave span').forEach((bar,i)=>bar.classList.toggle('past',i/64<fraction));
 }
}
function playNext(){
 if(!state.current||!state.results.length)return;
 const index=state.results.findIndex(t=>t.id===state.current.id);
 playTrack(state.results[(index+1)%state.results.length]);
}
function downloadTrack(track){
 const resolved=urlFor(track);
 if(!resolved){state.pendingTrack=null;openDialog('#connect-dialog');return;}
 const a=document.createElement('a');a.href=resolved.url;a.download=resolved.name||track.originalName;a.rel='noopener';if(state.audioBase&&!resolved.object&&!state.localServer)a.target='_blank';document.body.appendChild(a);a.click();a.remove();
 if(resolved.object)setTimeout(()=>URL.revokeObjectURL(resolved.url),60000);
}
function connectionUi(){
 const connected=state.localServer||!!state.audioBase||state.files.size>0||state.tracks.some(t=>t.preview);
 const count=state.files.size;
 $('#connection-state').textContent=state.localServer?'Оригиналы WAV подключены':state.audioBase?'Аудиохранилище подключено':count?`Подключено ${number(count)} WAV`:state.tracks.some(t=>t.preview)?'Вся библиотека онлайн':'Каталог звуков';
 $('#connection-state').classList.toggle('connected',connected);$('#connection-banner').hidden=connected;
}
async function connectFiles(files){
 if(!state.catalog)return;
 $('#folder-status').textContent='Сопоставляем файлы с каталогом…';
 await new Promise(resolve=>setTimeout(resolve,10));
 const index=new Map();
 for(const file of files){
  const key=file.name.toLowerCase()+'|'+file.size;
  if(!index.has(key))index.set(key,[]);index.get(key).push(file);
 }
 for(const track of state.tracks){
  const candidates=index.get(track.originalName.toLowerCase()+'|'+track.bytes);
  if(!candidates)continue;
  const expected=track.path.replace(/^audio\//,'').toLowerCase();
  const matched=candidates.find(f=>(f.webkitRelativePath||f._relativePath||'').toLowerCase().endsWith(expected))||candidates.find(f=>(f.webkitRelativePath||f._relativePath||'').toLowerCase().endsWith(track.sourcePath.toLowerCase()))||(candidates.length===1?candidates[0]:null);
  if(matched)state.files.set(track.id,matched);
 }
 connectionUi();renderTracks();
 if(state.files.size){
  $('#folder-status').textContent=`Подключено ${number(state.files.size)} из ${number(state.tracks.length)} звуков.`;
  $('#connect-dialog').close();toast(`Подключено ${number(state.files.size)} звуков. Можно слушать!`);
  if(state.pendingTrack){const t=state.pendingTrack;state.pendingTrack=null;playTrack(t);}
 }else { $('#folder-status').textContent='Звуки из каталога не найдены. Выберите папку audio или папку с распакованными WAV-файлами.'; }
 $('#folder-input').value='';
}

document.addEventListener('click',event=>{
 const catButton=event.target.closest('[data-category]');if(catButton){chooseCategory(catButton.dataset.category);return;}
 const view=event.target.closest('[data-view]');if(view){state.view=view.dataset.view;state.category='';filterTracks();closeSidebar();return;}
 const control=event.target.closest('[data-action]');
 if(control){
  const row=control.closest('[data-id]'),track=state.byId.get(row?.dataset.id);if(!track)return;
  if(control.dataset.action==='play')playTrack(track);
  if(control.dataset.action==='favorite')toggleFavorite(track);
  if(control.dataset.action==='download')downloadTrack(track);
  if(control.dataset.action==='seek'){const r=control.getBoundingClientRect();playTrack(track,Math.min(.99,Math.max(0,(event.clientX-r.left)/r.width)));}
 }
 if(event.target.closest('[data-reset]'))resetFilters();
 if(event.target.closest('.connect-button'))openDialog('#connect-dialog');
 if(event.target.closest('[data-close]'))event.target.closest('dialog').close();
});
$('#search-form').addEventListener('submit',event=>event.preventDefault());
$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=$('#search').value.slice(0,300);filterTracks();},130);});
for(const [id,key] of [['source-filter','source'],['duration-filter','duration'],['sort','sort']])$('#'+id).addEventListener('change',()=>{state[key]=$('#'+id).value;filterTracks();});
$('#reset-filters').addEventListener('click',resetFilters);
for(const [id,delta] of [['previous-page',-1],['next-page',1]])$('#'+id).addEventListener('click',()=>{state.page+=delta;filterTracks(false);$('.library-heading').scrollIntoView({block:'start'});});
$('#player-play').addEventListener('click',()=>playTrack(state.current));
$('#next-track').addEventListener('click',playNext);
$('#player-favorite').addEventListener('click',()=>state.current&&toggleFavorite(state.current));
$('#player-download').addEventListener('click',()=>state.current&&downloadTrack(state.current));
$('#seek').addEventListener('input',()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number($('#seek').value)/1000*audio.duration;updateTime();});
$('#volume').addEventListener('input',()=>{audio.volume=Number($('#volume').value);audio.muted=false;$('#mute').setAttribute('aria-pressed','false');$('#volume').style.setProperty('--progress',`${audio.volume*100}%`);});
$('#mute').addEventListener('click',()=>{audio.muted=!audio.muted;$('#mute').setAttribute('aria-pressed',String(audio.muted));$('#mute').setAttribute('aria-label',audio.muted?'Включить звук':'Выключить звук');});
$('#loop').addEventListener('click',()=>{audio.loop=!audio.loop;$('#loop').setAttribute('aria-pressed',String(audio.loop));});
audio.addEventListener('timeupdate',updateTime);
audio.addEventListener('play',updatePlaybackUi);audio.addEventListener('pause',updatePlaybackUi);audio.addEventListener('ended',updatePlaybackUi);
audio.addEventListener('playing',()=>{
 if(!state.current)return;
 state.recent=[state.current.id,...state.recent.filter(id=>id!==state.current.id)].slice(0,100);saveStored('wavebox.recent',state.recent);
});
audio.addEventListener('loadedmetadata',()=>{if(seekingTo!==null&&Number.isFinite(audio.duration)){audio.currentTime=seekingTo*audio.duration;seekingTo=null;}$('#total-time').textContent=time(audio.duration);});
audio.addEventListener('error',()=>handlePlayError({name:'MediaError'}));
$('#pick-folder').addEventListener('click',()=>$('#folder-input').click());
$('#folder-input').addEventListener('change',()=>connectFiles([...$('#folder-input').files]).catch(()=>toast('Не удалось подключить папку. Попробуйте ещё раз.')));
$('#menu-button').addEventListener('click',()=>{const on=$('#sidebar').classList.toggle('open');$('#menu-button').setAttribute('aria-expanded',String(on));});
$('#sidebar-scrim').addEventListener('click',closeSidebar);
$('#about-button').addEventListener('click',()=>openDialog('#about-dialog'));
$('#shortcuts-button').addEventListener('click',()=>openDialog('#shortcuts-dialog'));
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')closeSidebar();
 if(event.ctrlKey||event.metaKey||event.altKey||event.target.matches('input,textarea,select')||$('dialog[open]'))return;
 if(event.key==='/'){event.preventDefault();$('#search').focus();}
 if(event.code==='Space'&&!event.target.matches('button,a')){event.preventDefault();if(state.current)playTrack(state.current);}
 if(event.key.toLowerCase()==='n')playNext();
 if(event.key==='?')openDialog('#shortcuts-dialog');
});
window.addEventListener('popstate',()=>{readUrl();filterTracks();});
window.addEventListener('beforeunload',()=>{if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);});

async function init(){
 const [catalogResponse,configResponse,localResponse]=await Promise.allSettled([fetch('data/catalog.json'),fetch('config.json'),fetch('local-library.json')]);
 if(catalogResponse.status!=='fulfilled'||!catalogResponse.value.ok)throw Error('Catalog unavailable');
 state.catalog=await catalogResponse.value.json();
 state.categories=new Map(state.catalog.categories.map(c=>[c.id,c]));state.tracks=state.catalog.tracks;
 state.byId=new Map(state.tracks.map(t=>[t.id,t]));
 state.favorites=new Set([...state.favorites].filter(id=>state.byId.has(id)));state.recent=state.recent.filter(id=>state.byId.has(id));
 for(const t of state.tracks){const c=categoryFor(t);t.searchText=`${t.originalName} ${t.sourcePath} ${c.name} ${c.description} ${sourceName(t)}`.toLowerCase().replace(/ё/g,'е');}
 if(configResponse.status==='fulfilled'&&configResponse.value.ok){const config=await configResponse.value.json();if(typeof config.audioBaseUrl==='string'&&/^https?:\/\//.test(config.audioBaseUrl))state.audioBase=config.audioBaseUrl;}
 if(localResponse.status==='fulfilled'&&localResponse.value.ok){try{state.localServer=(await localResponse.value.json()).available===true;}catch{/* GitHub may return an HTML 404 page. */}}
 const stats=state.catalog.stats;
 $('#all-count').textContent=number(stats.count);$('#total-sounds').textContent=number(stats.count);$('#total-categories').textContent=number(state.catalog.categories.filter(c=>c.count).length);$('#category-count').textContent=number(state.catalog.categories.filter(c=>c.count).length);
 $('#about-stats').innerHTML=`<span><strong>${number(stats.count)}</strong>звуков</span><span><strong>${(stats.duration/3600).toFixed(1)}</strong>часов аудио</span><span><strong>${(stats.bytes/1073741824).toFixed(1)} ГБ</strong>оригиналов</span>`;
 readUrl();filterTracks();connectionUi();
}
init().catch(()=>{ $('#track-list').setAttribute('aria-busy','false');$('#track-list').innerHTML=`<div class="empty-state">${icon('info')}<h3>Не удалось открыть каталог</h3><p>Запустите сайт через Start Library.cmd или обновите страницу.<br>Для первого импорта: python scripts/import_audio.py</p><button class="button button-outline" onclick="location.reload()">Попробовать снова</button></div>`; });
})();
