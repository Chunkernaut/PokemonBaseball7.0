// Browser UI. All league moves validated by server.js; solo challenge stays in localStorage.
(async()=>{
'use strict';
const B=window.Baseball;
const DATA=await fetch('/pokemon-data.json').then(r=>r.json());
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const nameOf=id=>DATA.names[Number(id)-1]||'Unknown';
const img=(id,shiny=false)=>`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny?'shiny/':''}${Number(id)}.png`;
const SLOTS=B.SLOTS.map(x=>x.id);
let league=null,view='home',selected=null,swapFrom=null,page=0,search='',sort='dex',teamView=null,sound=localStorage.getItem('pb-sound')!=='off',solo=null,soloSelected=null;
let pollBusy=false,showToastTimer=0,soloSearch='',lastSeasonPoll=0,lastTurnKey='',lastActivityAt=0;
let orderExpanded=sessionStorage.getItem('pb-order-expanded')==='yes',lastWarningKey='',favoriteCode=null;
let favorites=new Set(),spectating=false;
let weekly=null,weeklySelected=null,weeklySearch='',weeklyFilter='all',weeklyShowCompare=null,weeklyInspect=null,weeklySort='official';
function loadFavorites(code,status){
  if(favoriteCode!==code){favoriteCode=code;try{favorites=new Set(JSON.parse(sessionStorage.getItem('pb-favorites-'+code)||'[]'));}catch{favorites=new Set();}}
  if(status!=='draft'&&favorites.size){favorites.clear();sessionStorage.removeItem('pb-favorites-'+code);}
}
function updateFavorites(){try{sessionStorage.setItem('pb-favorites-'+favoriteCode,JSON.stringify([...favorites]));}catch{}}
function savedLeagues(){return Object.entries(seatMap()).filter(([c,v])=>/^[A-HJ-NP-Z2-9]{5}$/.test(c)&&v?.seat&&v?.token).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,30)}
// Personal achievements are browser-local (not accounts or server-side trophies).
const RECORD_KEY='pb-record-book-v6';
function recordBook(){try{return JSON.parse(localStorage.getItem(RECORD_KEY)||'{}')||{}}catch{return {}}}
function streak(games){let best=0,current=0;for(const game of games||[]){if(game.win){current++;best=Math.max(best,current)}else current=0;}return best;}
function recordSeason(key,label,wins,losses,score,stats,games,champion=false){
 if(!key||!stats)return;const book=recordBook();book.seasons=book.seasons||{};
 if(book.seasons[key])return;
 const b=stats.batters||[],maxHR=Math.max(0,...b.map(x=>x.hr||0));
 const run={key,label,wins,losses,score,champion,maxHR,streak:streak(games),date:new Date().toISOString()};
 book.seasons[key]=run;
 const all=Object.values(book.seasons).slice(-100);if(all.length>60)book.seasons=Object.fromEntries(all.slice(-60).map(x=>[x.key,x]));
 try{localStorage.setItem(RECORD_KEY,JSON.stringify(book))}catch{}
 renderRecordBook();
}
function renderRecordBook(){const el=$('record-book');if(!el)return;
 const seasons=Object.values(recordBook().seasons||{}),best=(fn)=>seasons.length?Math.max(...seasons.map(fn)):0;
 const achievements=[['First Pitch',seasons.length>=1],['100-Win Club',seasons.some(x=>x.wins>=100)],['Perfect 162',seasons.some(x=>x.wins===162)],['League Champion',seasons.some(x=>x.champion)],['Heavy Hitter',seasons.some(x=>x.maxHR>=45)],['Unstoppable',seasons.some(x=>x.streak>=12)]];
 el.innerHTML=seasons.length?`<div class="record-digest"><div><small>Seasons played</small><b>${seasons.length}</b></div><div><small>Most wins</small><b>${best(x=>x.wins)}</b></div><div><small>Top team score</small><b>${best(x=>x.score)} / 1000</b></div><div><small>Best win streak</small><b>${best(x=>x.streak)}</b></div><div><small>Most HR by one Pokémon</small><b>${best(x=>x.maxHR)}</b></div></div><h3>Achievements</h3><div class="achievement-list">${achievements.map(([name,earned])=>`<span class="achievement ${earned?'earned':'locked'}">${esc(name)}</span>`).join('')}</div><h3>Recent seasons</h3><div class="record-history">${seasons.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(x=>`<div><b>${esc(x.label)}</b><span>${x.wins}–${x.losses} · ${x.score}/1000${x.champion?' · Champion':''}</span></div>`).join('')}</div>`:'<p class="muted">Complete a Solo Challenge or a Fantasy season to start tracking personal records and achievements on this browser.</p>';
}
function renderSavedLeagues(){const el=$('past-leagues-list');if(!el)return;const past=savedLeagues();el.innerHTML=past.length?past.map(([c,s])=>`<div class="past-row"><div><b>League ${esc(c)}</b><small>Played or joined ${new Date(s.at).toLocaleDateString()}</small></div><button class="btn small secondary" data-rejoin="${esc(c)}">Open league</button></div>`).join(''):'<p class="muted">No leagues joined on this browser yet.</p>';}

const seatsKey='pokemon-baseball-league-seats';
function seatMap(){try{return JSON.parse(localStorage.getItem(seatsKey)||'{}')}catch{return {}}}
function saveSeat(c,seat,token){const s=seatMap();s[c]={seat,token,at:Date.now()};localStorage.setItem(seatsKey,JSON.stringify(s));renderSavedLeagues();}
function auth(){return league&&seatMap()[league.code]?{code:league.code,...seatMap()[league.code]}:{code:league?.code};}
function me(){if(spectating)return null;return league?.seats.find(x=>x.id===auth().seat)||null;}
function myTeam(){return league?.teams[auth().seat]||{};}
function notify(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');clearTimeout(showToastTimer);showToastTimer=setTimeout(()=>e.classList.remove('show'),3500);}
async function api(action,body,method='POST'){
  let url='/api/game?a='+encodeURIComponent(action);
  if(method==='GET')url+='&'+new URLSearchParams(body).toString();
  const res=await fetch(url,method==='GET'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const out=await res.json().catch(()=>({}));if(!res.ok)throw Error(out.error||'Request failed');return out;
}
async function act(action,extra={}){try{const out=await api(action,{...auth(),...extra});if(out.league){league=out.league;renderLeague();}return out}catch(e){notify(e.message);return null}}
function soundPick(){if(!sound)return;try{const AC=window.AudioContext||window.webkitAudioContext;const c=new AC(),o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=660;g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.09,c.currentTime+.015);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.2);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.22);setTimeout(()=>c.close(),350);}catch{}}
// Short two-note chime for the NEW on-clock seat; subject to browser audio permission.
function soundTurn(){if(!sound)return;try{const A=window.AudioContext||window.webkitAudioContext;const a=new A();[0,.14].forEach((offset,i)=>{const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+offset;o.type='sine';o.frequency.value=i?880:660;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.065,t+.018);g.gain.exponentialRampToValueAtTime(.0001,t+.17);o.connect(g).connect(a.destination);o.start(t);o.stop(t+.18);});setTimeout(()=>a.close(),700);}catch{}}
function soundWarning(){if(!sound)return;try{
 const Audio=window.AudioContext||window.webkitAudioContext,context=new Audio();
 [0,.18,.36].forEach((delay)=>{const t=context.currentTime+delay,osc=context.createOscillator(),gain=context.createGain();osc.type='sine';osc.frequency.setValueAtTime(525,t);gain.gain.setValueAtTime(.0001,t);gain.gain.linearRampToValueAtTime(.025,t+.04);gain.gain.exponentialRampToValueAtTime(.0001,t+.14);osc.connect(gain).connect(context.destination);osc.start(t);osc.stop(t+.15);});
 setTimeout(()=>context.close(),1100);
 }catch{}}
async function playerActivity(){if(view!=='league'||league?.status!=='draft'||!me()||me().cpu)return;const t=Date.now();if(t-lastActivityAt<2600)return;lastActivityAt=t;
 try{const out=await api('activity',auth());if(out.league?.ver!==league?.ver){league=out.league;renderLeague();}}catch{} }
function draftOrderMarkup(){if(!league)return '';const n=league.seats.length,total=n*SLOTS.length,current=league.picks.length;
 const lines=Array.from({length:total},(_,i)=>{const round=Math.floor(i/n),ix=i%n,s=league.seats[round%2===0?ix:n-1-ix];return {i,round,s};});
 const entry=x=>`<div class="order-entry ${x.i===current?'now':''} ${x.i<current?'picked':''}"><span class="order-num">#${x.i+1}</span><button type="button" class="order-team-link" data-preview-team="${esc(x.s.id)}" aria-label="View ${esc(x.s.name)} team">${esc(x.s.name)}</button><small>Round ${x.round+1}${x.s.cpu?' · CPU':x.s.auto?' · AUTO':''}</small></div>`;
 const next=lines.slice(current,Math.min(total,current+4));
 return `<details id="draft-order-details" class="draft-order-toggle" ${orderExpanded?'open':''}><summary>Draft order <span class="order-mini">${next.map(x=>`#${x.i+1} ${esc(x.s.name)}`).join(' · ')||'Draft complete'}</span><span class="order-toggle-label">${orderExpanded?'Hide':'Expand'}</span></summary><div class="order-grid">${lines.map(entry).join('')}</div></details>`;
}
let teamPreviewEl=null,teamPreviewAnchor=null;
function closeTeamPreview(){if(teamPreviewEl)teamPreviewEl.remove();teamPreviewEl=null;teamPreviewAnchor=null;}
function positionTeamPreview(){
 if(!teamPreviewEl||!teamPreviewAnchor?.isConnected)return closeTeamPreview();
 const rect=teamPreviewAnchor.getBoundingClientRect(),width=teamPreviewEl.offsetWidth,height=teamPreviewEl.offsetHeight;
 const left=Math.max(8,Math.min(innerWidth-width-8,rect.left));
 const availableBelow=innerHeight-rect.bottom-10;
 const top=availableBelow>=Math.min(height,350)?rect.bottom+7:Math.max(8,rect.top-height-7);
 teamPreviewEl.style.left=left+'px';teamPreviewEl.style.top=Math.max(8,Math.min(innerHeight-height-8,top))+'px';
}
function openTeamPreview(button){
 if(!league)return;const id=button.dataset.previewTeam,seat=league.seats.find(s=>s.id===id);
 if(!seat)return;if(teamPreviewAnchor===button){closeTeamPreview();return;}
 closeTeamPreview();teamPreviewAnchor=button;
 const roster=league.teams[id]||{},count=B.SLOTS.filter(s=>roster[s.id]).length;
 teamPreviewEl=document.createElement('div');teamPreviewEl.id='draft-team-preview';teamPreviewEl.className='draft-team-preview';
 teamPreviewEl.setAttribute('role','dialog');teamPreviewEl.setAttribute('aria-label',seat.name+' roster');
 teamPreviewEl.innerHTML=`<div class="team-preview-title"><div><b>${esc(seat.name)}</b><span>${count}/15 drafted${seat.cpu?' · CPU':''}</span></div><button type="button" data-preview-close="1" aria-label="Close team preview">×</button></div><div class="team-preview-slots">${B.SLOTS.map(slot=>{const poke=roster[slot.id];return `<div class="team-preview-slot"><span>${slot.id}</span>${poke?`<img src="${img(poke)}" alt="" loading="lazy"><b>${esc(nameOf(poke))}</b>`:'<em>—</em>'}</div>`;}).join('')}</div>`;
 document.body.append(teamPreviewEl);positionTeamPreview();
}
document.addEventListener('pointerdown',event=>{if(teamPreviewEl&&!teamPreviewEl.contains(event.target)&&!event.target.closest('[data-preview-team]'))closeTeamPreview();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeTeamPreview();});
document.addEventListener('scroll',()=>{if(teamPreviewEl)positionTeamPreview();},true);
window.addEventListener('resize',()=>{if(teamPreviewEl)positionTeamPreview();});
function route(next){closeTeamPreview();view=next;for(const section of ['home','league','solo','weekly'])$(section+'-view').hidden=next!==section;window.scrollTo({top:0});}
function home(){stopPlayback();league=null;spectating=false;selected=null;swapFrom=null;route('home');history.pushState({},'','/draft');refreshLobbies();renderSavedLeagues();renderRecordBook();}
async function openLeague(code,push=true,spectator=false){const c=code.toUpperCase().trim();spectating=!!spectator;try{const out=await api('state',{code:c},'GET');league=out.league;loadFavorites(league.code,league.status);teamView=null;selected=null;swapFrom=null;route('league');if(push)history.pushState({},'',spectator?'/draft?watch='+c:'/draft?c='+c);renderLeague();}catch(e){notify(e.message);home();}}
function atTurn(){if(!league||league.status!=='draft')return null;const n=league.seats.length,k=league.picks.length,round=Math.floor(k/n),idx=k%n;return league.seats[round%2===0?idx:n-1-idx];}
function fieldSVG(){return `<svg viewBox="0 0 960 720" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><defs><radialGradient id="grass"><stop stop-color="#2b8960"/><stop offset="1" stop-color="#0e4b39"/></radialGradient><pattern id="mow" width="100" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(-36)"><rect width="50" height="100" fill="#ffffff" opacity=".025"/></pattern></defs><rect width="960" height="720" fill="#0b2d2c"/><path d="M480 655 L88 245 Q155 110 320 87 Q480 40 640 87 Q805 110 872 245 Z" fill="url(#grass)" stroke="#d0bd83" stroke-width="7"/><path d="M480 655 L88 245 Q155 110 320 87 Q480 40 640 87 Q805 110 872 245 Z" fill="url(#mow)"/><path d="M480 655 L88 245 M480 655 L872 245" fill="none" stroke="#f1f0dc" stroke-width="3"/><path d="M480 337 L643 495 L480 652 L317 495 Z" fill="#b98854" stroke="#d8ae74" stroke-width="4"/><path d="M480 378 L602 495 L480 612 L358 495 Z" fill="#277851" opacity=".94"/><path d="M468 630 L480 620 L492 630 L488 642 L472 642 Z" fill="#fff"/><rect x="627" y="488" width="16" height="16" fill="white" transform="rotate(45 635 496)"/><rect x="472" y="345" width="16" height="16" fill="white" transform="rotate(45 480 353)"/><rect x="317" y="488" width="16" height="16" fill="white" transform="rotate(45 325 496)"/><ellipse cx="480" cy="503" rx="26" ry="21" fill="#c7965f"/><text x="480" y="45" text-anchor="middle" fill="#d0e7d9" font-weight="800" opacity=".75" letter-spacing="8" font-size="16">POKÉMON BALLPARK</text></svg>`;}
function typeBadges(types){return `<span class="type-badges">${types.map(t=>`<span class="type-badge type-${esc(t)}">${esc(t.toUpperCase())}</span>`).join('')}</span>`;}
function fieldMarkup(roster,canEdit=false,shiny=[]){
 const shinySet=new Set(shiny);
 const field=`<div class="field" id="field-surface">${fieldSVG()}<div class="field-spots">${B.FIELD_SLOTS.map(s=>{
  const id=roster[s.id];return `<button type="button" class="field-spot ${id?'filled':'empty'} ${swapFrom===s.id&&canEdit?'selected':''}" data-slot="${s.id}" ${id?`data-inspect="${id}"`:''} style="left:${s.x}%;top:${s.y}%" aria-label="${esc(s.name)}, ${id?esc(nameOf(id)):'empty'}">${id?`<img class="sprite" src="${img(id,shinySet.has(id))}" alt="" loading="lazy" ${canEdit?'draggable="true"':'draggable="false"'} onerror="this.style.visibility='hidden'">`:''}<span class="spot-pos">${s.id}${id&&shinySet.has(id)?' ✨':''}</span><span class="spot-name">${id?'': 'OPEN'}</span></button>`;
 }).join('')}</div></div>`;
 const bench=`<div class="bench-wrap"><div class="bench-title">DUGOUT · 5 FLEXIBLE BENCH SLOTS</div><div class="bench-line">${B.BENCH_SLOTS.map(s=>{const id=roster[s.id];return `<button type="button" data-slot="${s.id}" ${id?`data-inspect="${id}"`:''} class="bench-spot ${id?'filled':'empty'} ${swapFrom===s.id&&canEdit?'selected':''}" aria-label="${s.name}, ${id?nameOf(id):'empty'}">${id?`<img src="${img(id,shinySet.has(id))}" alt="" loading="lazy" ${canEdit?'draggable="true"':'draggable="false"'}/>`:''}<strong>${s.id}</strong><span>${id?esc(nameOf(id)):'OPEN'}</span></button>`;}).join('')}</div></div>`;
 return `<div class="field-and-bench">${field}${bench}</div>`;
}
function rosterList(roster){return `<div class="roster-grid">${B.SLOTS.map(s=>{const id=roster[s.id];return `<div class="slot-row" ${id?`data-inspect="${id}"`:''}><strong>${s.id}</strong><span>${id?esc(nameOf(id)):'—'}</span></div>`;}).join('')}</div>`;}
function scorecards(roster){const complete=B.SLOTS.every(s=>roster[s.id]);if(!complete)return `<p class="info">Draft all 15 Pokémon to reveal your Team Score. ${B.SLOTS.filter(s=>roster[s.id]).length}/15 filled.</p>`;
 const x=B.scoreTeam(DATA,roster);return `<div class="score-cards"><div class="scorecard"><b>${x.score}</b><span>TEAM / 1000</span></div><div class="scorecard"><b>${x.offense}</b><span>HITTING / 1000</span></div><div class="scorecard"><b>${x.pitching}</b><span>PITCHING / 1000</span></div><div class="scorecard"><b>${x.defense}</b><span>FIELDING / 1000</span></div></div><p class="hintline">Bench Pokémon replace tired starters throughout the season. Only the ten starting positions contribute to the initial score.</p>`;}
function inlineBaseStats(id){
 const p=DATA.mons[Number(id)-1];if(!p)return '';
 const stats=[['HP',p.hp],['ATK',p.atk],['DEF',p.def],['SpA',p.spa],['SpD',p.spd],['SPE',p.spe]];
 return `<span class="pokemon-stat-strip" aria-label="Base stats: ${stats.map(([k,v])=>k+' '+v).join(', ')}">${stats.map(([k,v])=>`<span class="pokemon-stat-pair"><small>${k}</small><b>${v}</b></span>`).join('')}</span>`;
}
function candidateCard(id,action,selectedId,locked=false){
 const p=DATA.mons[Number(id)-1];
 return `<button type="button" class="pokemon-card draft-candidate ${Number(selectedId)===Number(id)?'active':''} ${locked?'legend-locked':''}" ${action} ${locked?'disabled title="Legendary cap reached (3 of 3)"':''}><img src="${img(id)}" alt="" loading="lazy"><span class="candidate-identity"><b class="nm">${esc(nameOf(id))}</b>${typeBadges(p.types)}</span>${inlineBaseStats(id)}</button>`;
}
// Compact, raw-stat hover view for rostered Pokémon only. Draft candidates still
// require an intentional click to inspect; hidden fits remain hidden everywhere.
let rosterScout=null,rosterScoutTarget=null;
function scoutTarget(el){return el?.closest?.('.field-spot[data-inspect], .bench-spot[data-inspect], .slot-row[data-inspect], .batting-order-row[data-inspect]')||null;}
function dismissRosterScout(){if(rosterScout)rosterScout.hidden=true;rosterScoutTarget=null;}
function positionRosterScout(target){
 if(!rosterScout||rosterScout.hidden||!target?.isConnected)return;
 const rect=target.getBoundingClientRect(),width=rosterScout.offsetWidth,height=rosterScout.offsetHeight;
 const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2));
 const above=rect.top-height-12;
 const top=above>=8?above:Math.min(window.innerHeight-height-8,rect.bottom+12);
 rosterScout.style.left=left+'px';rosterScout.style.top=Math.max(8,top)+'px';
}
function showRosterScout(target){
 if(!target)return dismissRosterScout();
 const id=Number(target.dataset.inspect),p=DATA.mons[id-1];if(!p)return dismissRosterScout();
 if(!rosterScout){rosterScout=document.createElement('div');rosterScout.id='roster-scout';rosterScout.setAttribute('role','tooltip');document.body.append(rosterScout);}
 if(target!==rosterScoutTarget){
  rosterScoutTarget=target;
  const stats=[['HP',p.hp],['ATK',p.atk],['DEF',p.def],['SpA',p.spa],['SpD',p.spd],['SPE',p.spe]];
  rosterScout.innerHTML=`<div class="roster-scout-header"><img src="${img(id)}" alt=""><div><b>${esc(nameOf(id))}</b>${typeBadges(p.types)}</div></div><div class="roster-scout-stats">${stats.map(([label,value])=>`<span><small>${label}</small><b>${value}</b></span>`).join('')}</div><p>Height ${ (DATA.heights[id-1]/10).toFixed(1)} m · Weight ${p.kg.toFixed(1)} kg</p>`;
 }
 rosterScout.hidden=false;positionRosterScout(target);
}
document.addEventListener('pointerover',e=>{const target=scoutTarget(e.target);if(target&&target!==rosterScoutTarget)showRosterScout(target);});
document.addEventListener('pointerout',e=>{const target=scoutTarget(e.target);if(target&&target===rosterScoutTarget&&!target.contains(e.relatedTarget))dismissRosterScout();});
document.addEventListener('focusin',e=>{const target=scoutTarget(e.target);if(target)showRosterScout(target);});
document.addEventListener('focusout',e=>{if(rosterScoutTarget&&!rosterScoutTarget.contains(e.relatedTarget))dismissRosterScout();});
document.addEventListener('scroll',()=>{if(rosterScoutTarget?.isConnected)positionRosterScout(rosterScoutTarget);else dismissRosterScout();},true);
window.addEventListener('resize',()=>dismissRosterScout());
// Nine batters only. Every entry is a genuine copy of the current starter by Pokémon ID.
// Batting order is editable in lineup phase, never in the live draft or during simulation.
function battingOrderMarkup(roster,order,context,locked=false){
 const nine=B.battingStarters(roster);if(nine.length!==9)return '';
 const list=B.normalizeBattingOrder(roster,order);
 const position=id=>B.FIELD_IDS.find(k=>roster[k]===id)||'—';
 const placeText=i=>['Leadoff','Second','Third','Cleanup','Fifth','Sixth','Seventh','Eighth','Ninth'][i];
 return `<section class="panel compact batting-order-panel" id="batting-order-editor"><div class="sectionhead batting-editor-title"><h3>Set your batting order</h3><span class="baggie">${locked?'Locked':'Lineup stage · 9 batters'}</span></div>
 <p class="batting-explainer"><b>How it works:</b> Your nine hitters take turns batting in this order. The first spots usually bat more often; the middle spots are useful for bringing teammates home. Your pitcher does not bat because you have a DH. This order is randomly filled in at the start — change it however you like.</p>
 <div class="batting-quicktips" aria-label="Batting order tips"><span><b>1–2</b> Reach base</span><span><b>3–5</b> Drive in runs</span><span><b>6–9</b> Round out the lineup</span></div>
 <div class="batting-order-list">${list.map((id,i)=>`<div class="batting-order-row" data-inspect="${id}"><span class="batting-rank">${i+1}</span><img src="${img(id)}" alt="" loading="lazy"><div class="batting-info"><b>${esc(nameOf(id))}</b><small>${esc(position(id))} · ${placeText(i)}</small></div>
 <label class="batting-jump-label">Bat #<select class="batting-jump" data-batto="1" data-batindex="${i}" data-batcontext="${context}" aria-label="Move ${esc(nameOf(id))} to a batting spot" ${locked?'disabled':''}>${Array.from({length:9},(_,j)=>`<option value="${j+1}" ${j===i?'selected':''}>${j+1}</option>`).join('')}</select></label>
 <div class="batting-arrows"><button class="btn small quiet" data-batmove="-1" data-batindex="${i}" data-batcontext="${context}" ${locked||i===0?'disabled':''} aria-label="Move ${esc(nameOf(id))} up">Up</button><button class="btn small quiet" data-batmove="1" data-batindex="${i}" data-batcontext="${context}" ${locked||i===8?'disabled':''} aria-label="Move ${esc(nameOf(id))} down">Down</button></div></div>`).join('')}</div>
 <div class="toolbar batting-editor-actions"><button class="btn small secondary" data-bat-shuffle="${context}" ${locked?'disabled':''}>Shuffle batting order</button><span class="hintline">Use Bat # to jump straight to a spot, or use Up and Down.</span></div></section>`;
}
async function changeBattingOrder(context,order){
 if(context==='league'&&view==='league'&&league?.status==='lineup'&&me()){
  if((league.readySeats||[]).includes(me().id))return notify('Click I’m not ready to edit your batting order.');
  return act('batting',{order});
 }
 if(context==='weekly'&&view==='weekly'&&weekly&&!weekly.entry){weekly.order=order;saveWeekly();renderWeekly();return;}
 if(context==='solo'&&view==='solo'&&solo&&!solo.result){
  solo.battingOrder=order;saveSolo();renderSolo();
 }
}
function awardsMarkup(awards,teamNames={}){if(!awards?.length)return '';
 return `<section class="panel awards-panel"><div class="sectionhead"><h3>Season honors</h3><span class="baggie">Based on performance</span></div><div class="award-grid">${awards.filter(a=>a.id).map(a=>`<article class="award-card"><img src="${img(a.id)}" alt=""><div><small>${esc(a.name)}</small><b>${esc(nameOf(a.id))}</b><span>${a.team&&teamNames[a.team]?esc(teamNames[a.team])+' · ':''}${esc(a.why)}</span></div></article>`).join('')}</div><p class="hintline">Gold Glove reflects defensive fit, innings played and actual fielding errors. Rookie of the Year is restricted to Pokémon with base-stat totals of 400 or less.</p></section>`;
}
function seasonNarrative(result,isLeague=false){
 if(!result)return '';
 const w=isLeague?result.w:result.wins,l=isLeague?result.l:result.losses;
 const total=w+l,pct=total?(100*w/total).toFixed(1):'0';
 const mood=w>=110?'an outstanding year':w>=81?'a strong season':'a season with room to improve';
 return `<div class="season-narrative"><strong>Season in review:</strong> ${w} wins and ${l} losses (${pct}% win rate) made for ${mood}. The full player breakdown below highlights the batting, pitching, and endurance contributions behind that record. ${isLeague?'The World Series winner is decided separately in the championship series.':'Your bench replacements and batting order helped shape every matchup.'}</div>`;
}
function statsDigest(stats){if(!stats)return '';
 const hitters=(stats.batters||[]).filter(x=>x.pa>0),pitch=(stats.pitchers||[]).filter(x=>x.g>0);
 const top=(a,metric)=>[...a].sort((x,y)=>metric(y)-metric(x))[0];
 const sl=top(hitters,x=>Number(x.ops)||0),hr=top(hitters,x=>x.hr||0),ace=top(pitch,x=>x.so||0),dur=top(stats.batters||[],x=>x.g||0);
 const items=[sl&&['On-base impact',sl,sl.ops+' OPS','AVG + on-base + extra bases'],hr&&['Home-run leader',hr,hr.hr+' HR','Most balls hit out of the park'],ace&&['Pitching strikeouts',ace,ace.so+' K','Batters retired on strikes'],dur&&['Iron Pokémon',dur,dur.g+' games','Most games played this season']].filter(Boolean);
 return `<div class="stat-digest">${items.map(([label,x,val,why])=>`<div class="digest-card"><span>${esc(label)}</span><b>${esc(nameOf(x.id))}</b><strong>${esc(val)}</strong><small>${esc(why)}</small></div>`).join('')}</div>`;
}
// The guide lives in a single, persistent <details> at the foot of the site. No hidden
// position-fit scores or percentages are shown; tier labels summarize engine weights.
async function refreshLobbies(){try{const out=await api('lobbies',{},'GET');$('lobbies-list').innerHTML=out.lobbies.length?out.lobbies.map(l=>`<div class="lobby-row"><div><b>League ${esc(l.code)}</b><br><span>${esc(B.MODES[l.mode]?.name)} · ${l.joined}/${l.size} teams · ${l.timer?l.timer+'s':'No'} timer</span></div><button class="btn small secondary" data-joinpublic="${esc(l.code)}">Join</button></div>`).join(''):'<div class="muted">No public lobbies right now. Create one above!</div>';}catch{$('lobbies-list').textContent='Unable to load lobbies.';}}
function chatMarkup(){if(!league)return '';const lines=[...league.chat.map(m=>({at:m.at,sys:m.sys,txt:m.t,seat:m.s})),...league.picks.map((p,i)=>({at:p.at,sys:true,txt:`Pick ${i+1}: ${(league.seats.find(s=>s.id===p.s)||{}).name} selected ${nameOf(p.p)} (${p.slot})${p.shiny?' ✨ SHINY':''}`}))].sort((a,b)=>a.at-b.at).slice(-80);
  return `<section class="panel compact"><h3 style="margin-bottom:10px">League chat & picks</h3><div class="chat-log" id="chat-log">${lines.length?lines.map(m=>`<div class="chat-line ${m.sys?'system':''}">${m.sys?esc(m.txt):`<b>${esc((league.seats.find(s=>s.id===m.seat)||{}).name||'?')}:</b> ${esc(m.txt)}`}</div>`).join(''):'<div class="muted">No messages yet.</div>'}</div>${me()?`<form class="chat-input" id="chat-form"><input name="message" maxlength="220" placeholder="Message your league…" required aria-label="Chat message"><button class="btn small primary">Send</button></form>`:'<p class="info">Join the league to chat.</p>'}</section>`;}
function renderLeague(){if(!league)return;
 loadFavorites(league.code,league.status);
 const oldPool=$('fantasy-pool-scroll'),oldPoolPosition=oldPool?.scrollTop??0;
 const oldOrder=$('draft-order-details');if(oldOrder)orderExpanded=oldOrder.open;

  $('league-code').textContent=league.code;
  $('league-phase').textContent=league.status==='lobby'?'WAITING ROOM':league.status==='draft'?'LIVE SNAKE DRAFT':league.status==='lineup'?'LINEUP MANAGEMENT':'BASEBALL SEASON';
  $('league-title').textContent=league.status==='lobby'?'Fantasy draft lobby':league.status==='draft'?'Draft day':league.status==='lineup'?'Set your lineup':'Season results';
  $('league-meta').textContent=`${B.MODES[league.set.mode]?.name} · ${league.seats.length}/${league.set.size} teams · ${league.set.timer?league.set.timer+'-second':'Untimed'} picks · ${league.set.legends?'Legendaries on':'No legendaries'}`;
  if(league.status==='draft'&&selected&&league.picks.some(p=>p.p===selected))selected=null;
  if(league.status==='lobby')renderLobby();else if(league.status==='draft'||league.status==='lineup')renderDraft();else renderSeason();
  const pool=$('fantasy-pool-scroll');if(pool)pool.scrollTop=oldPoolPosition;
  const log=$('chat-log');if(log)log.scrollTop=log.scrollHeight;
}
function renderLobby(){const mineSeat=me(),isHost=!!mineSeat?.host;
  $('league-content').innerHTML=`<div class="lobby-two"><section class="panel"><div class="panel-tag">LEAGUE MEMBERS</div><h2>${league.seats.length} / ${league.set.size} teams joined</h2><div class="league-seats">${league.seats.map((s,i)=>`<div class="seat"><span class="number">${i+1}</span><div class="mid"><b>${esc(s.name)}</b> ${s.host?'<span class="baggie">HOST</span>':''} ${s.cpu?'<span class="baggie warn">CPU</span>':''}<br><small>${s.id===mineSeat?.id?'Your team':s.cpu?'Computer controlled':'Human player'}</small></div>${isHost&&!s.host?`<span class="seat-tools">${league.set.order==='set'?`<button class="btn small quiet" data-seat="${s.id}" data-op="up">↑</button><button class="btn small quiet" data-seat="${s.id}" data-op="down">↓</button>`:''}<button class="btn small danger" data-seat="${s.id}" data-op="kick">×</button></span>`:''}</div>`).join('')}${Array.from({length:Math.max(0,league.set.size-league.seats.length)},()=>'<div class="seat"><span class="number">—</span><div class="mid muted">Open seat</div></div>').join('')}</div>${isHost?`<div class="toolbar" style="margin-top:14px"><button id="add-cpu" class="btn secondary" ${league.seats.length>=league.set.size?'disabled':''}>+ Add CPU</button><button id="start-league" class="btn primary" ${league.seats.length!==league.set.size?'disabled':''}>Start draft</button></div><p class="info">Host controls: fill all seats, then start. If you choose a set order, use ↑ / ↓ to rearrange seats.</p>`:'<p class="info">Share the code with friends. The host starts the draft when the lobby is full.</p>'}</section>
  <div class="stack"><section class="panel compact"><div class="panel-tag">LEAGUE SETTINGS</div><p class="muted">${league.set.pub?'Public — visible in open lobbies':'Private — link or code only'} · ${league.set.order==='set'?'Set order':'Random order'}</p>${isHost?`<div class="toolbar" style="margin-top:12px"><button data-change="pub" class="btn small secondary">Toggle visibility</button><button data-change="order" class="btn small secondary">Toggle draft order</button><button data-change="timer" class="btn small secondary">Change timer</button><button data-change="mode" class="btn small secondary">Change pool</button><button data-change="legends" class="btn small secondary">Toggle legendaries</button><button data-change="size" class="btn small secondary">Change team count</button></div>`:''}</section>${chatMarkup()}</div></div>`;
}
function poolMarkup(){if(!league)return '';
 const on=league.status==='draft'&&me()?.id===atTurn()?.id;
 let ids=B.pool(DATA,league.set.mode,league.set.legends).filter(id=>!league.picks.some(p=>p.p===id));
 if(search)ids=ids.filter(id=>nameOf(id).toLowerCase().includes(search.toLowerCase()));
 const sortNum={total:id=>{const x=DATA.mons[id-1];return x.hp+x.atk+x.def+x.spa+x.spd+x.spe;},hp:id=>DATA.mons[id-1].hp,atk:id=>DATA.mons[id-1].atk,def:id=>DATA.mons[id-1].def,spa:id=>DATA.mons[id-1].spa,spd:id=>DATA.mons[id-1].spd,spe:id=>DATA.mons[id-1].spe,kg:id=>DATA.mons[id-1].kg,height:id=>DATA.heights[id-1]};
 if(sort==='name')ids.sort((a,b)=>nameOf(a).localeCompare(nameOf(b)));else if(sortNum[sort])ids.sort((a,b)=>sortNum[sort](b)-sortNum[sort](a));
 ids.sort((a,b)=>Number(favorites.has(b))-Number(favorites.has(a)));
 return `<section class="panel compact pool-panel"><div class="statusbar"><b>Pokémon selection</b><span class="baggie">${ids.length} available</span></div><div class="pool-controls"><input id="pool-search" placeholder="Search Pokémon..." aria-label="Search Pokémon" value="${esc(search)}"><select id="pool-sort" aria-label="Sort Pokémon">${[['dex','Dex #'],['name','Name'],['total','Total stats'],['hp','HP'],['atk','Attack'],['def','Defense'],['spa','Sp. Atk'],['spd','Sp. Def'],['spe','Speed'],['kg','Weight'],['height','Height']].map(([k,n])=>`<option value="${k}" ${k===sort?'selected':''}>${n}</option>`).join('')}</select></div><div class="pokemon-pool full-list inline-stats-pool" id="fantasy-pool-scroll">${ids.map(id=>`<div class="pokemon-tile ${selected===id?'active':''} ${favorites.has(id)?'is-favorite':''}">${candidateCard(id,`data-mon="${id}" aria-label="Select ${esc(nameOf(id))} to draft"`,selected)}<button type="button" class="favorite-toggle" data-favorite="${id}" aria-label="${favorites.has(id)?'Remove '+esc(nameOf(id))+' from favorites':'Favorite '+esc(nameOf(id))}" aria-pressed="${favorites.has(id)}" title="${favorites.has(id)?'Remove favorite':'Add favorite'}">${favorites.has(id)?'★':'☆'}</button></div>`).join('')}</div><p class="hintline">Six base stats are displayed beside every Pokémon. Select one, then choose an empty position on your turn. Favorites remain at the top until the draft ends.</p></section>`;
}
function renderDraft(){closeTeamPreview();const mineSeat=me(),my=!!mineSeat,turn=atTurn(),onTurn=league.status==='draft'&&turn?.id===mineSeat?.id;
 const roster=my?myTeam():(league.teams[teamView||league.seats[0].id]||{}),filled=Object.keys(roster).length,canEdit=my&&['draft','lineup'].includes(league.status);
 const choiceHint=!my?'Spectator mode: follow team rosters and league results live. Your view is read-only.':league.status==='lineup'?'Rearrange your players before the 90-second lineup lock.':onTurn?(selected?`Selected ${nameOf(selected)}. Choose an empty position.`:'Your pick: select a Pokémon and assign it to any empty position.'):`${turn?turn.name:'Another team'} is choosing. You can compare base stats and rearrange drafted players.`;
 const sec=Math.max(0,Math.ceil(((league.lineupDeadline||0)-Date.now())/1000));
 const turnStrip=league.status==='draft'?`<section class="panel draft-top-bar ${onTurn?'on-clock':''}"><div class="draft-turn-row"><div class="turn-main"><b>${onTurn?'YOUR TURN TO PICK':esc(turn?.name||'Draft')+' is on the clock'}</b><span>Round ${Math.floor(league.picks.length/league.seats.length)+1}/15 · Pick ${league.picks.length+1}/${league.set.size*15}${turn?.auto?' · Auto-draft':''}</span></div><div class="turn-clock" id="clock">${league.set.timer?'Clock':'Untimed'}</div></div>${draftOrderMarkup()}</section>`:
 `<section class="panel draft-top-bar lineup-clock-panel"><div class="draft-turn-row"><div class="turn-main"><b>Lineup adjustment</b><span>Swap Pokémon and customize your batting order. DH starts with your strongest hitter. All human teams ready starts early.</span></div><div class="turn-clock" id="lineup-clock">${sec}s</div></div>${draftOrderMarkup()}</section>`;
 $('league-content').innerHTML=`<div class="draft-page">${turnStrip}${league.status==='lineup'?`<section class="lineup-help" role="note"><b>Lineup stage:</b> You have 90 seconds to swap starters and bench Pokémon, then rearrange the nine batters below. Your strongest hitter starts at DH, but you may move them. Click I’m ready when finished; the season begins once everyone is ready.</section>`:''}<div class="league-shell draft-workspace"><div class="stack"><section class="panel compact draft-field-panel"><div class="statusbar"><span class="label">${my?'YOUR BASEBALL DIAMOND':'WATCHING: '+esc(league.seats.find(s=>s.id===(teamView||league.seats[0].id))?.name||'Team')}</span><span class="baggie">${filled}/15 Pokémon</span>${league.status==='lineup'&&my?'<button type="button" class="btn small secondary" data-scroll-batting="1">Edit batting order</button>':''}</div>${scorecards(roster)}${fieldMarkup(roster,canEdit,league.shinies)}<p class="info compact-instruction">${esc(choiceHint)}</p>${rosterList(roster)}</section></div><div class="stack draft-pool-column">${league.status==='draft'?poolMarkup():`<section class="panel compact ready-panel"><h3>Lineups lock in <span id="lineup-count-inline">${sec}</span>s</h3><p class="muted">Change your lineup and batting order before confirming.</p><div class="ready-progress">${league.seats.map(s=>`<span class="ready-chip ${(s.cpu||s.auto||(league.readySeats||[]).includes(s.id))?'ready':''}">${esc(s.name)} · ${(s.cpu||s.auto||(league.readySeats||[]).includes(s.id))?'Ready':'Not ready'}</span>`).join('')}</div>${my?`<button class="btn primary wide" id="lineup-ready">${(league.readySeats||[]).includes(mineSeat.id)?'I’m not ready':'I’m ready'}</button>`:''}</section>${my?battingOrderMarkup(roster,league.battingOrders?.[mineSeat.id],'league',(league.readySeats||[]).includes(mineSeat.id)):''}` }</div></div><div class="draft-lower">${chatMarkup()}</div></div>`;
 if(league.status==='draft'){const key=league.code+':'+league.picks.length;if(lastTurnKey!==key){lastTurnKey=key;lastWarningKey='';if(onTurn)soundTurn();}}
 updateClock();wireField('league');
}
function updateClock(){
 if(league?.status==='draft'){
 const el=$('clock'),sec=league.deadline?Math.max(0,Math.ceil((league.deadline-Date.now())/1000)):null;
 if(el){el.textContent=sec===null?'No timer':`${sec}s left`;el.classList.toggle('warn',sec!==null&&sec<=10);}
 if(sec!==null&&sec>0&&sec<=10&&me()?.id===atTurn()?.id&&!me()?.auto){const key=league.code+':'+league.picks.length;if(lastWarningKey!==key){lastWarningKey=key;soundWarning();}}
 }
 if(league?.status==='lineup'){const sec=Math.max(0,Math.ceil(((league.lineupDeadline||0)-Date.now())/1000));const a=$('lineup-clock'),b=$('lineup-count-inline');if(a)a.textContent=`${sec}s`;if(b)b.textContent=sec;}
}
function statsDropdown(stats){return `<details class="stats-dropdown"><summary>Season statistics · Batting & pitching</summary><div class="stats-dropdown-body">${seasonStatsTable(stats)}</div></details>`;}
function seasonStatsTable(stats){if(!stats)return '';const batting=(stats.batters||[]).filter(x=>x.pa>0),pitching=(stats.pitchers||[]).filter(x=>x.g>0);
return `<div class="stat-results"><h3>Season performance breakdown</h3><p class="hintline">Look at the leaders first, then explore the full tables. OPS combines on-base percentage and slugging; higher is better. Rest counts games missed to recover energy.</p>${statsDigest(stats)}<h3>Individual batting statistics</h3><p class="hintline">AVG: hits per at-bat · OBP: ability to reach base · SLG: extra-base hitting power · RBI: runs batted in · E: fielding errors · CS: caught stealing · SB%: stolen-base success rate</p><div class="table-viewport"><table class="stat-table"><thead><tr><th>Pokémon</th><th>G</th><th>Rest</th><th>OPS</th><th>AVG</th><th>OBP</th><th>SLG</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>R</th><th>E</th><th>SB</th><th>CS</th><th>SB%</th><th>BB</th><th>SO</th></tr></thead><tbody>${batting.map(x=>`<tr data-inspect="${x.id}"><td>${esc(nameOf(x.id))}</td><td>${x.g}</td><td>${x.rested||0}</td><td>${x.ops||".000"}</td><td>${x.avg}</td><td>${x.obp}</td><td>${x.slg}</td><td>${x.h}</td><td>${x.doubles||0}</td><td>${x.triples||0}</td><td>${x.hr}</td><td>${x.rbi}</td><td>${x.r}</td><td>${x.e||0}</td><td>${x.sb}</td><td>${x.cs||0}</td><td>${x.sbpct||"—"}</td><td>${x.bb}</td><td>${x.k}</td></tr>`).join('')}</tbody></table></div><h3>Pitching statistics</h3><p class="hintline">ERA: earned runs allowed per nine innings (lower is better) · WHIP: walks and hits allowed per inning (lower is better) · IP: innings pitched · W/L: pitching decisions · QS: at least six innings with three or fewer earned runs · CG: complete game</p><div class="table-viewport"><table class="stat-table"><thead><tr><th>Pokémon</th><th>G</th><th>Rest</th><th>IP</th><th>ERA</th><th>WHIP</th><th>W</th><th>L</th><th>QS</th><th>CG</th><th>SO</th><th>BB</th><th>ER</th></tr></thead><tbody>${pitching.map(x=>`<tr data-inspect="${x.id}"><td>${esc(nameOf(x.id))}</td><td>${x.g}</td><td>${x.rested||0}</td><td>${x.ip}</td><td>${x.era}</td><td>${x.whip}</td><td>${x.w||0}</td><td>${x.l||0}</td><td>${x.qs||0}</td><td>${x.cg||0}</td><td>${x.so}</td><td>${x.bb}</td><td>${x.er}</td></tr>`).join('')}</tbody></table></div></div>`;}
const playback={key:'',index:0,timer:null,paused:false,speed:1000,completedKey:'',seriesActive:false,seriesDone:false,seriesIndex:0};
function stopPlayback(){if(playback.timer)clearTimeout(playback.timer);playback.timer=null;}
function initPlayback(key){if(playback.key===key)return;stopPlayback();playback.key=key;playback.index=0;playback.paused=false;playback.seriesActive=false;playback.seriesDone=false;playback.seriesIndex=0;}
function schedulePlayback(){if(playback.paused||playback.timer)return;const total=view==='solo'?solo?.result?.games.length:league?.season?.games.length;if(!total||playback.index>=total)return;
 const step=()=>{playback.timer=null;if(playback.paused)return;const games=view==='solo'?solo?.result?.games:league?.season?.games;if(!games)return;playback.index=Math.min(games.length,playback.index+1);if(playback.index>=games.length)playback.completedKey=playback.key;if(view==='solo')renderSolo();else renderLeague();};
 const games=view==='solo'?solo?.result?.games:league?.season?.games,last=games[Math.max(0,playback.index-1)];const events=view==='solo'?last?.tired:last?[...(last.homeEvents?.tired||[]),...(last.awayEvents?.tired||[])]:[];
 // Solo playback runs twice as fast as the same selected fantasy playback speed.
 const factor=view==='solo'?.5:1;
 playback.timer=setTimeout(step,Math.round((playback.index&&(events?.length||last?.special?.length)?Math.max(playback.speed===200?580:1700,Math.round(playback.speed*1.6)):playback.speed)*factor));
}
const EVENT_LABELS={walkoff:'WALK-OFF HOME RUN!',no_hitter:'NO-HITTER!',extras:'EXTRA INNINGS',grand_slam:'GRAND SLAM!',comeback:'INCREDIBLE COMEBACK!',dominant:'DOMINANT GAME!',three_homers:'THREE-HOME-RUN GAME!'};
function specialMarkup(game){if(!game)return '';
 const list=(game.special||[]).filter(x=>x.type!=='ninth_inning_rally');
 const innings=game.innings??game.inningsHome?.length??9;
 if(innings>9&&!list.some(x=>x.type==='extras'))list.unshift({type:'extras',inning:innings});
 // The event card exists only for the most recently displayed game. It disappears
 // on the next playback step along with the previous score and its player sprite.
 return list.length?`<div class="special-moments">${list.map(x=>{
   const pokemon=Number(x.player)>0?`<img class="event-pokemon-sprite" src="${img(x.player)}" alt="${esc(nameOf(x.player))}" loading="eager">`:'';
   const desc=x.type==='extras'?x.inning+' innings played':x.type==='comeback'?'Rallied from '+x.deficit+' runs down':x.type==='walkoff'?'Game-winning final swing':x.type==='no_hitter'?'Zero hits allowed':x.type==='grand_slam'?'Four-run home run':x.type==='three_homers'?x.count+' home runs in one game':x.type==='dominant'?'Won '+x.margin+'–0':'';
   return `<div class="special-moment event-${esc(x.type)}">${pokemon}<div><b>${EVENT_LABELS[x.type]||'SPECIAL EVENT'}</b><small>${Number(x.player)>0?esc(nameOf(x.player))+' · ':''}${esc(desc)}</small></div></div>`;
 }).join('')}</div>`:'';
}
function dominantSide(game){const ev=(game?.special||[]).find(x=>x.type==='dominant');return ev?ev.team:null;}
function fatigueMarkup(events){const tired=events?.tired||[],sub=events?.substitutions||[],rested=events?.rested||[];
 return `<div class="fatigue-card"><h3>Energy & substitutions</h3>${tired.length?`<p class="notice">Tired this game: ${tired.map(x=>`${esc(nameOf(x.id))} (${esc(x.position)})`).join(', ')}. Out for exactly the next game.</p>`:'<p class="hintline">No new tired Pokémon.</p>'}${sub.length?`<p class="hintline">Substitutes: ${sub.map(x=>`${esc(nameOf(x.in))} replaces ${esc(nameOf(x.out))} at ${x.position}`).join(' · ')}</p>`:''}${rested.length?`<p class="hintline">Rested this game, returning next: ${rested.map(id=>esc(nameOf(id))).join(', ')}</p>`:''}</div>`;}
function playbackControls(total){return `<div class="playback-controls"><div class="progress-track"><div class="progress-bar" style="width:${Math.round(100*playback.index/total)}%"></div></div><div class="toolbar"><b>Game ${playback.index} / ${total}</b><button id="play-pause" class="btn small secondary">${playback.paused?'Resume':'Pause'}</button><button id="play-next" class="btn small secondary">Next game</button><button id="play-speed" class="btn small quiet">Speed: ${playback.speed>=1700?'Slow':playback.speed>=1000?'Normal':'Fast'}</button><button id="play-skip" class="btn small quiet">Skip to final results</button>${playback.completedKey===playback.key?'<button id="play-replay" class="btn small primary">Rewatch simulation</button>':''}</div></div>`;}
// The World Series is a separate, gold-framed broadcast. Skipping regular-season
// playback only jumps to THIS presentation; it never bypasses the championship.
function beginWorldSeries(){playback.seriesActive=true;playback.seriesDone=false;playback.seriesIndex=0;playback.paused=false;}
function scheduleWorldSeries(season){if(playback.paused||playback.timer||!playback.seriesActive)return;
 const series=season.playoff||[];
 if(playback.seriesIndex>=series.length){
  playback.timer=setTimeout(()=>{playback.timer=null;if(!playback.seriesActive||playback.paused)return;playback.seriesActive=false;playback.seriesDone=true;playback.completedKey=playback.key;if(view==='league'&&league?.status==='season')renderLeague();},playback.speed===200?650:1450);
  return;
 }
 playback.timer=setTimeout(()=>{playback.timer=null;if(!playback.seriesActive||playback.paused)return;
  playback.seriesIndex++;
  if(view==='league'&&league?.status==='season')renderLeague();
 },playback.speed===200?700:playback.speed===1700?2600:1750);
}
function worldSeriesMarkup(season){const series=season.playoff||[],last=series[playback.seriesIndex-1],names=Object.fromEntries(league.seats.map(x=>[x.id,x.name]));
 const wins={};for(const g of series.slice(0,playback.seriesIndex)){const w=g.hs>g.as?g.h:g.a;wins[w]=(wins[w]||0)+1;}
 const finalists=[...new Set(series.flatMap(g=>[g.h,g.a]))];
 if(playback.seriesActive)scheduleWorldSeries(season);
 return `<section class="world-series-stage" id="world-series-stage"><div class="world-series-kicker">WORLD SERIES · BEST OF SEVEN</div><h2>Championship Broadcast</h2><p class="world-series-desc">Regular season complete. Now watch the final series before the champion is crowned.</p><div class="ws-tally">${finalists.map(id=>`<div><b>${esc(names[id])}</b><strong>${wins[id]||0}</strong><span>wins</span></div>`).join('<div class="ws-vs">VS</div>')}</div><div class="ws-game">${last?`<div class="overline">WORLD SERIES GAME ${last.game} / 7</div><div class="ws-result"><span>${esc(names[last.a])}</span><strong>${last.as} – ${last.hs}</strong><span>${esc(names[last.h])}</span></div><p>${last.inningsHome?.length||9} innings · ${esc(names[last.hs>last.as?last.h:last.a])} wins Game ${last.game}</p>${specialMarkup(last)}`:'<p>World Series first pitch coming up…</p>'}</div><div class="ws-playback-actions"><span>Game ${playback.seriesIndex} of ${series.length}</span><button class="btn small secondary" id="play-pause">${playback.paused?'Resume':'Pause'}</button><button class="btn small secondary" id="play-next">Next World Series game</button></div></section>`;
}
function leaguePlayback(season){initPlayback('league:'+league.code+':'+season.seed);const total=season.games.length,last=season.games[playback.index-1];
 if(playback.index>=total&&!playback.seriesDone&&!playback.seriesActive)beginWorldSeries();
 if(playback.seriesActive)return worldSeriesMarkup(season);
 const played=season.games.slice(0,playback.index),teamStats=Object.fromEntries(league.seats.map(x=>[x.id,{w:0,l:0}]));for(const g of played){const win=g.hs>g.as?g.h:g.a,lose=g.hs>g.as?g.a:g.h;teamStats[win].w++;teamStats[lose].l++;}
 const teams=Object.fromEntries(league.seats.map(x=>[x.id,x.name]));
 const result=last?`<div class="game-recap"><div class="panel-tag">GAME ${playback.index} · ${last.extras?'EXTRA INNINGS':'REGULAR SEASON'}</div>${last.extras?`<div class="extras-head">EXTRA INNINGS · ${last.inningsHome.length} INNINGS PLAYED</div>`:''}<div class="game-scoreline"><span class="${dominantSide(last)===0?'dominant-winner':''}">${esc(teams[last.a])}</span><strong class="${last.special?.some(e=>e.type==='walkoff')?'walkoff-score':''}">${last.as} — ${last.hs}${last.special?.some(e=>e.type==='no_hitter'&&e.player>0)?`<span class="nohit-player"><img src="${img(last.special.find(e=>e.type==='no_hitter'&&e.player>0).player)}" alt=""> ${esc(nameOf(last.special.find(e=>e.type==='no_hitter'&&e.player>0).player))} · NO-HITTER</span>`:''}</strong><span class="${dominantSide(last)===1?'dominant-winner':''}">${esc(teams[last.h])}</span></div><p class="hintline">${last.extras?'Extra innings · ':''}${last.ai} away hits · ${last.hi} home hits</p>${specialMarkup(last)}<div class="fatigue-duo"><div><strong>${esc(teams[last.a])}</strong>${fatigueMarkup(last.awayEvents)}</div><div><strong>${esc(teams[last.h])}</strong>${fatigueMarkup(last.homeEvents)}</div></div></div>`:'<p class="info">Press play to watch all the matchups, one game at a time.</p>';
 if(playback.index<total)schedulePlayback();
 return `<section class="panel playback-panel"><h2>162-game fantasy league playback</h2><p class="muted">Games unfold one by one. Fatigue, rest days, and substitutes are displayed after each result.</p>${playbackControls(total)}${result}<div class="table-viewport"><table class="stat-table"><thead><tr><th>Live standings</th><th>W</th><th>L</th></tr></thead><tbody>${league.seats.map(s=>`<tr><td>${esc(s.name)}</td><td>${teamStats[s.id].w}</td><td>${teamStats[s.id].l}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function soloPlayback(result){
 initPlayback('solo:'+solo.seed+':'+result.simId);
 const total=result.games.length,last=result.games[playback.index-1];
 if(playback.index<total)schedulePlayback();
 const wins=result.games.slice(0,playback.index).filter(g=>g.win).length;
 let recap='<div class="game-recap">Preparing season...</div>';
 if(last){
   const ownTeam=last.home?1:0,winTeam=last.win?ownTeam:1-ownTeam;
   const dominant=dominantSide(last);
   const awayName=last.home?last.opponent:'Your Team',homeName=last.home?'Your Team':last.opponent;
   const awayClass=dominant===0&&winTeam===0?'dominant-winner':'';
   const homeClass=dominant===1&&winTeam===1?'dominant-winner':'';
   const hitterNoHit=(last.special||[]).find(e=>e.type==='no_hitter'&&e.player>0);
   recap=`<div class="game-recap"><div class="panel-tag">GAME ${last.number} OF 162</div>${last.innings>9?`<div class="extras-head">EXTRA INNINGS · ${last.innings} INNINGS PLAYED</div>`:''}
     <div class="game-scoreline"><span class="${awayClass}">${esc(awayName)}</span><strong class="${last.special?.some(e=>e.type==='walkoff')?'walkoff-score':''}">${last.home?last.them:last.us} — ${last.home?last.us:last.them}${hitterNoHit?`<span class="nohit-player"><img src="${img(hitterNoHit.player)}" alt="${esc(nameOf(hitterNoHit.player))}"> ${esc(nameOf(hitterNoHit.player))} · NO-HITTER</span>`:''}</strong><span class="${homeClass}">${esc(homeName)}</span></div>
     <p class="outcome-label ${last.win?'win':'loss'}">${last.win?'VICTORY':'DEFEAT'} · ${last.hits} team hits · ${last.innings} innings</p>
     ${specialMarkup(last)}${fatigueMarkup(last)}</div>`;
 }
 return `<section class="panel playback-panel" id="solo-playback-panel"><h2>162-game challenge · ${wins}–${playback.index-wins}</h2><p class="muted">Automatic rest and the best available bench replacement are tracked for each game. Playback is twice the speed of fantasy games.</p>${playbackControls(total)}${recap}</section>`;
}
function postseasonMarkup(season){if(!season?.bracket?.length)return '';
 const names=Object.fromEntries(league.seats.map(s=>[s.id,s.name]));
 const rounds=[...new Set(season.bracket.map(s=>s.round))];
 return `<section class="panel bracket-panel"><div class="sectionhead"><h2>Postseason bracket</h2><span class="baggie">Play-in, semifinals & championship</span></div><p class="hintline">Higher seeds receive byes when necessary. Series are best-of-three in the Wild Card, best-of-five in the semifinals, and best-of-seven in the World Series.</p><div class="bracket-grid">${rounds.map(round=>`<div class="bracket-round"><h3>${esc(round)}</h3>${season.bracket.filter(x=>x.round===round).map(ser=>`<article class="bracket-match"><div class="${ser.winner===ser.teamA?'advancing':''}"><span>${esc(names[ser.teamA])}</span><strong>${ser.winA}</strong></div><div class="${ser.winner===ser.teamB?'advancing':''}"><span>${esc(names[ser.teamB])}</span><strong>${ser.winB}</strong></div><details><summary>Series games (${ser.games.length})</summary><div class="bracket-game-list">${ser.games.map(g=>`<p>Game ${g.game}: ${esc(names[g.a])} ${g.as} – ${g.hs} ${esc(names[g.h])}</p>`).join('')}</div></details></article>`).join('')}</div>`).join('')}</div></section>`;
}
function renderSeason(){const season=league.season,key=teamView||me()?.id||league.seats[0]?.id,roster=league.teams[key],ss=season.stats[key],champ=league.seats.find(s=>s.id===season.champion)?.name;
 const playbackUI=leaguePlayback(season),done=playback.index>=season.games.length;
 if(!done||playback.seriesActive){$('league-content').innerHTML=playbackUI;return;}
 if(me()){const mineRow=season.standings.find(x=>x.id===me().id);if(mineRow)recordSeason('league:'+league.code+':'+season.seed,'Fantasy League '+league.code,mineRow.w,mineRow.l,mineRow.score.score,season.stats[me().id],season.games.filter(x=>x.h===me().id||x.a===me().id).map(g=>({win:(g.hs>g.as?g.h:g.a)===me().id})),season.champion===me().id);}
 const seriesWins=season.playoff.reduce((a,g)=>{const winner=g.hs>g.as?g.h:g.a;a[winner]=(a[winner]||0)+1;return a;},{});
 const runner=season.standings.filter(x=>x.id!==season.champion).find(x=>seriesWins[x.id]!=null);
 const opponent=season.playoff.length?league.seats.find(s=>s.id!==(season.champion)&&season.playoff.some(g=>g.h===s.id||g.a===s.id))?.name:'Runner-up';
 $('league-content').innerHTML=`<div class="toolbar completed-replay"><button id="save-image" class="btn primary">Save Image</button><button id="play-replay" class="btn small secondary">Rewatch simulation</button></div><div class="championship-top"><div class="champion champion-v4"><div class="overline">🏆 WORLD SERIES CHAMPIONS</div><h2>${esc(champ)}</h2><div class="series-record">${seriesWins[season.champion]||4} – ${runner?seriesWins[runner.id]||0:Math.min(3,season.playoff.length-4)}</div><p>vs ${esc(opponent||'Finalist')} · Best-of-seven</p><p>162-game regular season · ${season.standings.find(x=>x.id===season.champion)?.w||0} wins</p></div>${chatMarkup()}</div>${postseasonMarkup(season)}${awardsMarkup(season.awards,Object.fromEntries(league.seats.map(s=>[s.id,s.name])))}<div class="results-full"><section class="panel"><div class="sectionhead"><h2>My team & league rosters</h2><div class="toolbar"><span class="baggie">15 Pokémon per team</span><button data-save-image="1" class="btn small primary">Save Image</button></div></div><div class="team-tabs">${league.seats.map(s=>`<button class="btn small ${key===s.id?'primary':'quiet'}" data-viewteam="${s.id}">${esc(s.name)}</button>`).join('')}</div><div class="large-field">${fieldMarkup(roster,false,league.shinies)}</div>${scorecards(roster)}${seasonNarrative(season.standings.find(s=>s.id===key),true)}</section><section class="panel"><h2>Final standings</h2><div class="table-viewport"><table class="stat-table"><thead><tr><th>Team</th><th>W</th><th>L</th><th>Run differential</th><th>Team Score</th></tr></thead><tbody>${season.standings.map((s,i)=>`<tr><td>${i+1}. ${esc(s.name)}</td><td>${s.w}</td><td>${s.l}</td><td>${s.rs-s.ra}</td><td>${s.score.score}</td></tr>`).join('')}</tbody></table></div>${statsDropdown(ss)}</section><section class="panel"><h2>World Series · Game-by-game</h2><div class="table-viewport"><table class="games-table"><tbody>${season.playoff.map(g=>`<tr><td>Game ${g.game}</td><td>${esc(league.seats.find(s=>s.id===g.h)?.name)}</td><td>${g.hs}–${g.as}</td><td>${esc(league.seats.find(s=>s.id===g.a)?.name)}</td><td>${(g.special||[]).map(e=>EVENT_LABELS[e.type]||'').filter(Boolean).join(', ')}</td></tr>`).join('')}</tbody></table></div></section><section class="panel"><details><summary>Browse all ${season.games.length} regular-season games</summary><div class="game-scroll"><table class="games-table"><tbody>${season.games.map(g=>`<tr><td>#${g.n}</td><td>${esc(league.seats.find(s=>s.id===g.h)?.name)}</td><td>${g.hs}–${g.as}</td><td>${esc(league.seats.find(s=>s.id===g.a)?.name)}</td><td>${g.inningsHome.length} inn.</td><td>${(g.special||[]).map(e=>EVENT_LABELS[e.type]||'').filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody></table></div></details></section><div class="toolbar"><button id="copy-results" class="btn secondary">Copy final standings</button><button id="export-results" class="btn secondary">Export league JSON</button></div></div>`;
}
function wireField(context){
 if(context==='league'&&(!me()||!['draft','lineup'].includes(league.status)))return;
 const targets=document.querySelectorAll('[data-slot]');
 for(const target of targets){
  target.addEventListener('dragover',ev=>{if(ev.dataTransfer.types.includes('text/plain')){ev.preventDefault();ev.dataTransfer.dropEffect='move';}});
  target.addEventListener('drop',async ev=>{
   ev.preventDefault();const from=ev.dataTransfer.getData('text/plain'),to=target.dataset.slot;
   if(!from||from===to||!SLOTS.includes(from)||!SLOTS.includes(to))return;
   if(context==='league'){const out=await act('move',{from,to});if(out)soundPick();}
   else if(context==='weekly')weeklySwap(from,to);
   else await soloSwap(from,to);
  });
 }
 for(const sprite of document.querySelectorAll('[data-slot] img[draggable="true"]')){
  sprite.addEventListener('dragstart',ev=>{
   const parent=sprite.closest('[data-slot]'),slot=parent?.dataset.slot;
   const roster=context==='solo'?solo?.roster:context==='weekly'?weekly?.roster:myTeam();
   if(!slot||!roster?.[slot]){ev.preventDefault();return;}
   ev.stopPropagation();ev.dataTransfer.setData('text/plain',slot);
   ev.dataTransfer.effectAllowed='move';
   ev.dataTransfer.setDragImage(sprite,sprite.clientWidth/2,sprite.clientHeight/2);
  });
 }
}
async function fieldTap(slot){if(view==='solo')return soloFieldTap(slot);if(view==='weekly')return weeklyFieldTap(slot);
  if(view!=='league'||!me()||!['draft','lineup'].includes(league.status))return;
  if(selected&&league.status==='draft'&&atTurn()?.id===me().id){
    if(myTeam()[slot])return notify('Choose an empty position to draft into. To swap, clear your selected Pokémon.');
    const id=selected;selected=null;const out=await act('pick',{p:id,slot});if(out){soundPick();if(out.league.picks.at(-1)?.shiny)notify(`✨ SHINY ${nameOf(id)}! (1 in 8192)`); }return;
  }
  if(!swapFrom){if(!myTeam()[slot])return notify('Choose a Pokémon or select an occupied position first.');swapFrom=slot;renderLeague();return;}
  if(swapFrom===slot){swapFrom=null;renderLeague();return;}
  const from=swapFrom;swapFrom=null;const out=await act('move',{from,to:slot});if(out)soundPick();
}
function initSolo(force=false){try{if(!force)solo=JSON.parse(localStorage.getItem('pokemon-baseball-solo')||'null')}catch{}
  if(!solo||force){solo={seed:Math.floor(Math.random()*2**30),mode:'wild',variant:'17-0',legends:true,roster:{},roll:null,rollIndex:0,typeRerolls:1,genRerolls:1,monRerolls:5,shiny:[],result:null};}
  if(solo.result && Object.keys(solo.roster||{}).length!==15)solo.result=null; if(Object.keys(solo.roster||{}).length>=15)solo.roll=null;else if(!solo.roll)nextSoloRoll();saveSolo();}
function saveSolo(){localStorage.setItem('pokemon-baseball-solo',JSON.stringify(solo));}
function nextSoloRoll(){const taken=Object.values(solo.roster);solo.roll=solo.variant==='151'?null:B.roll(DATA,solo.seed,solo.rollIndex++,taken,solo.mode,solo.legends&&taken.filter(id=>DATA.leg.includes(id)).length<3);
  if(solo.variant==='151'){const avail=B.pool(DATA,'kanto',true).filter(id=>!taken.includes(id));solo.roll={id:avail[Math.floor(B.rand(solo.seed,++solo.rollIndex)*avail.length)]};}}
function soloLegendCount(){return Object.values(solo?.roster||{}).filter(id=>DATA.leg.includes(id)).length;}
function soloLegendBlocked(id){return solo?.variant==='17-0'&&soloLegendCount()>=3&&DATA.leg.includes(Number(id));}
function soloChoices(){const taken=Object.values(solo.roster);return solo.variant==='151'?[solo.roll.id]:B.choicesFor(DATA,solo.roll,taken,solo.mode,solo.legends);}

function startSolo(){initSolo();route('solo');history.pushState({},'','/draft?solo=1');renderSolo();}
function renderSolo(){const roster=solo.roster,filled=Object.keys(roster).length,done=filled===15,p=solo.roll,choices=done?[]:soloChoices();
 if(done&&!solo.battingOrder){solo.battingOrder=B.seededOrder(roster,solo.seed^0xBAD52);saveSolo();}
 const soloPlaybackKey=done&&solo.result?'solo:'+solo.seed+':'+solo.result.simId:'';
 const display=done&&solo.result&&(playback.key!==soloPlaybackKey||playback.index<solo.result.games.length)?soloPlayback(solo.result):'';
 const pickUI=!done?`<section class="panel compact"><div class="panel-tag">DRAFT PICK ${filled+1} / 15</div><h2>${solo.variant==='151'?'Random Kanto Pokémon':`${B.REGIONS[p.gen]} · ${p.type.toUpperCase()}`}</h2><p class="info">${choices.filter(id=>!soloLegendBlocked(id)).length} available Pokémon — review their base stats.${solo.variant==='17-0'?` Legendaries: ${soloLegendCount()}/3.`:''}</p><input id="solo-search" class="solo-search" placeholder="Search your available choices…" value="${esc(soloSearch)}"><div class="pokemon-pool inline-stats-pool solo-inline-pool" style="max-height:480px;margin-top:12px">${choices.filter(id=>nameOf(id).toLowerCase().includes(soloSearch.toLowerCase())).map(id=>candidateCard(id,`data-solomon="${id}" aria-label="Select ${esc(nameOf(id))}"`,soloSelected,soloLegendBlocked(id))).join('')}</div><div class="toolbar" style="margin-top:12px">${solo.variant==='151'?`<button class="btn small secondary" id="reroll-mon" ${solo.monRerolls<=0?'disabled':''}>Reroll (${solo.monRerolls})</button>`:`<button class="btn small secondary" id="reroll-type" ${solo.typeRerolls<=0?'disabled':''}>Reroll type (${solo.typeRerolls})</button><button class="btn small secondary" id="reroll-gen" ${solo.genRerolls<=0?'disabled':''}>Reroll region (${solo.genRerolls})</button>`}</div></section>`:`<section class="panel compact"><h2>15 Pokémon drafted</h2>${!solo.result?`<div class="lineup-help solo-lineup-help" role="note"><b>Set your lineup:</b> Swap Pokémon between starters and bench on the diamond, then reorder your nine batters here. Your strongest hitter starts at DH, but you can change it before pressing Start the season.</div>`:''}<p class="muted">Arrange your starting ten and five bench Pokémon, then play 162 games with rest days and substitutions.</p>${!solo.result?battingOrderMarkup(roster,solo.battingOrder,'solo'):''}<button id="simulate-solo" class="btn primary wide">${solo.result?'Simulate a new season':'Start the season'}</button></section>`;
 $('solo-content').innerHTML=`<div id="solo-season-results" ${done&&solo.result?'':'hidden'}>${display}${done&&solo.result&&playback.index>=solo.result.games.length?`<section class="panel season-final"><div class="toolbar completed-replay"><button id="save-image" class="btn primary">Save Image</button><button id="play-replay" class="btn small secondary">Rewatch simulation</button></div><h2>Final record: ${solo.result.wins}–${solo.result.losses} ${solo.result.perfect?'🏆 PERFECT SEASON':''}</h2><p class="muted">Team ${solo.result.rating.score}/1000 · Hitting ${solo.result.rating.offense}/1000 · Pitching ${solo.result.rating.pitching}/1000 · Fielding ${solo.result.rating.defense}/1000 · 162 games completed</p>${seasonNarrative(solo.result)}${awardsMarkup(solo.result.awards,{solo:'Your Team'})}${statsDropdown(solo.result.stats)}<details><summary>All 162 box scores</summary><div class="game-scroll"><table class="games-table"><tbody>${solo.result.games.map(g=>`<tr><td>${g.number}</td><td>${esc(g.opponent)}</td><td>${g.win?'W':'L'}</td><td>${g.us}–${g.them}</td><td>${g.innings} inn.</td></tr>`).join('')}</tbody></table></div></details></section>`:''}</div><div class="draft-layout solo-workspace"><div class="draft-main"><section class="panel"><div class="statusbar"><span class="label">YOUR BALLPARK</span><span class="baggie">${filled}/15 Pokémon</span>${done&&solo.result&&playback.index>=solo.result.games.length?'<button data-save-image="1" class="btn small primary">Save Image</button>':''}${done&&!solo.result?'<button type="button" class="btn small secondary" data-scroll-batting="1">Edit batting order</button>':''}</div>${scorecards(roster)}${fieldMarkup(roster,true,solo.shiny)}<p class="info">Select a Pokémon to place on the field or bench. Click two occupied slots to swap them. The starter at each position automatically returns after one rest game.</p>${rosterList(roster)}</section></div><aside class="draft-aside"><section class="panel compact"><div class="panel-tag">SOLO CHALLENGE SETTINGS</div><div class="toolbar"><button id="solo-mode-17" class="btn small ${solo.variant==='17-0'?'primary':'secondary'}">162–0 challenge</button><button id="solo-mode-151" class="btn small ${solo.variant==='151'?'primary':'secondary'}">151 challenge</button></div><p class="info">${solo.variant==='151'?'One random Gen 1 Pokémon each pick; five rerolls.':'Roll a generation and type, then choose one matching Pokémon. Maximum three legendaries.'}</p>${!filled?`<label class="hintline">Pokémon pool <select id="solo-pool">${Object.entries(B.MODES).map(([k,v])=>`<option value="${k}" ${solo.mode===k?'selected':''}>${v.name}</option>`).join('')}</select></label><label class="check"><input type="checkbox" id="solo-legends" ${solo.legends?'checked':''}> Allow legendaries</label>`:''}</section>${pickUI}</aside></div>`;wireField('solo');if(done&&solo.result&&playback.index>=solo.result.games.length)recordSeason('solo:'+solo.seed+':'+solo.result.simId,'Solo '+(solo.variant==='151'?'151':'162–0'),solo.result.wins,solo.result.losses,solo.result.rating.score,solo.result.stats,solo.result.games);
}
async function soloSwap(from,to){
 const roster=solo?.roster;if(!roster||!roster[from]||from===to)return;
 const held=roster[from],other=roster[to];roster[to]=held;
 if(other)roster[from]=other;else delete roster[from];
 solo.battingOrder=B.normalizeBattingOrder(roster,solo.battingOrder);soloSelected=null;swapFrom=null;solo.result=null;stopPlayback();playback.key='';saveSolo();renderSolo();
}
async function soloFieldTap(slot){if(!solo)return;const team=solo.roster;
  if(soloSelected){if(soloLegendBlocked(soloSelected))return notify('The 162–0 challenge allows only three Legendary Pokémon.');if(team[slot])return notify('That position is taken — select an empty position');
    team[slot]=soloSelected;soloSelected=null;swapFrom=null;if(Object.keys(team).length<15)nextSoloRoll();else {B.preferStrongestDH(DATA,team);solo.battingOrder=B.seededOrder(team,solo.seed^0xBAD52);}solo.result=null;saveSolo();soundPick();renderSolo();return;
  }
  if(!swapFrom){if(!team[slot])return notify('Choose a Pokémon from the offer');swapFrom=slot;renderSolo();return;}
  if(swapFrom===slot){swapFrom=null;renderSolo();return;}
  const from=swapFrom;await soloSwap(from,slot);
}
// Weekly 151. The server is authoritative for the common pool and official season.
// Browser-local work-in-progress rosters are editable; official submissions cannot be edited.
const WEEKLY_TOKEN='pb-weekly-browser-token-v7';
function weeklyToken(){let t=localStorage.getItem(WEEKLY_TOKEN);if(!t){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);t=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');localStorage.setItem(WEEKLY_TOKEN,t);}return t;}
function weeklySaveKey(id){return 'pb-weekly-open-draft-v7:'+id;}
function saveWeekly(){if(!weekly)return;try{localStorage.setItem(weeklySaveKey(weekly.week),JSON.stringify({roster:weekly.roster,order:weekly.order,name:weekly.name}));}catch{}}
async function weeklyApi(action,params={},method='GET'){
 const url='/api/weekly?a='+encodeURIComponent(action),args={...params,token:weeklyToken()};
 const response=await fetch(method==='GET'?url+'&'+new URLSearchParams(args):url,method==='GET'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
 const out=await response.json().catch(()=>({}));if(!response.ok)throw Error(out.error||'Weekly request failed');return out;
}
async function openWeekly(id,push=true){stopPlayback();try{
 const response=await weeklyApi('overview',id?{week:id}:{});
 const saved=JSON.parse(localStorage.getItem(weeklySaveKey(response.week))||'{}');
 const draft=saved.roster&&typeof saved.roster==='object'?saved.roster:{};
 weekly={...response,roster:response.own?.roster||draft,order:response.own?.battingOrder||saved.order||null,name:response.own?.name||saved.name||'My Weekly Team',entry:response.own||null,officialEntry:response.own||null,practiceResult:null,compare:{left:null,right:null},compared:null};
 weeklySelected=null;swapFrom=null;weeklySearch='';weeklyFilter='all';weeklyShowCompare=null;route('weekly');if(push)history.pushState({},'','/draft?weekly='+response.week);renderWeekly();
 }catch(e){notify(e.message);if(view!=='weekly')home();}}
function weeklySwap(from,to){if(!weekly||weekly.entry||!weekly.roster[from]||from===to)return;
 const old=weekly.roster[to];weekly.roster[to]=weekly.roster[from];if(old)weekly.roster[from]=old;else delete weekly.roster[from];
 weekly.order=B.normalizeBattingOrder(weekly.roster,weekly.order);swapFrom=null;weeklySelected=null;saveWeekly();renderWeekly();}
function weeklyFieldTap(slot){if(!weekly||weekly.entry||!SLOTS.includes(slot))return;
 const roster=weekly.roster;
 if(weeklySelected){if(roster[slot])return notify('Choose an empty position, or clear the Pokémon already there.');if(Object.values(roster).includes(weeklySelected))return notify('That Pokémon is already on the roster.');
  roster[slot]=weeklySelected;weeklySelected=null;swapFrom=null;if(Object.keys(roster).length===15){B.preferStrongestDH(DATA,roster);weekly.order=B.seededOrder(roster,weekly.seed^0x719151);}
  saveWeekly();renderWeekly();return;}
 if(!swapFrom){if(!roster[slot])return notify('Choose a Pokémon from the weekly pool first.');swapFrom=slot;renderWeekly();return;}
 if(swapFrom===slot){swapFrom=null;renderWeekly();return;}
 weeklySwap(swapFrom,slot);
}
function weeklyProfile(){const records=Object.values(recordBook().seasons||{}).filter(x=>x.label?.startsWith('Weekly 151 ')).sort((a,b)=>b.label.localeCompare(a.label));
 const rank=weekly.entries.find(x=>x.id===weekly.officialEntry?.id)?.rank;
 const allWeeks=records.map(x=>x.label.slice('Weekly 151 '.length)).sort((a,b)=>b.localeCompare(a));let streak=allWeeks.length?1:0;
 for(let i=1;i<allWeeks.length;i++)if((Date.parse(allWeeks[i-1])-Date.parse(allWeeks[i]))===7*86400000)streak++;else break;
 const badges=[['Weekly Champion',rank===1],['Top 10 Finish',rank>0&&rank<=10],['Perfect Season',records.some(x=>x.wins===162)],['Iron Roster',weekly.honors?.some(x=>x.title==='Iron Roster'&&x.entryId===weekly.officialEntry?.id)],['Weekly Regular',records.length>=3]];
 return `<section class="panel weekly-profile"><div class="sectionhead"><h2>Your weekly record book</h2><span class="baggie">Stored in this browser</span></div><div class="record-digest"><div><small>Weeks entered</small><b>${records.length}</b></div><div><small>Best season</small><b>${Math.max(0,...records.map(x=>x.wins))} wins</b></div><div><small>Highest Team Score</small><b>${Math.max(0,...records.map(x=>x.score))}/1000</b></div><div><small>Consecutive weeks</small><b>${streak}</b></div></div><div class="achievement-list">${badges.map(([n,earned])=>`<span class="achievement ${earned?'earned':'locked'}">${n}</span>`).join('')}</div><p class="hintline">Cosmetic milestones only; they do not grant gameplay bonuses. Historical official rosters and rankings come from the league server; these participation stats are local.</p></section>`;}
function weeklyLeaderboard(){const original=weekly.entries||[],list=weeklySort==='official'?[...original]:[...original].sort((a,b)=>weeklySort==='score'?b.score-a.score:weeklySort==='runs'?b.runsFor-a.runsFor:weeklySort==='prevention'?a.runsAgainst-b.runsAgainst:b.runDifferential-a.runDifferential);return `<section class="panel weekly-leaderboard"><div class="sectionhead"><h2>Weekly leaderboard</h2><span class="baggie">${list.length} official ${list.length===1?'entry':'entries'}</span></div><div class="weekly-leader-controls"><label>View<select id="weekly-board-view"><option value="all">Overall standings</option><option value="mine">My ranking</option></select></label><label>Sort by<select id="weekly-board-sort"><option value="official" ${weeklySort==='official'?'selected':''}>Official ranking</option><option value="diff" ${weeklySort==='diff'?'selected':''}>Run differential</option><option value="score" ${weeklySort==='score'?'selected':''}>Team Score</option><option value="runs" ${weeklySort==='runs'?'selected':''}>Runs scored</option><option value="prevention" ${weeklySort==='prevention'?'selected':''}>Fewest runs allowed</option></select></label></div><p class="hintline">Ranked by wins, then run differential, then Team Score. Complete rosters unlock after the weekly deadline. Only one ranked submission per browser identity; a verified global identity system will require accounts.</p><div class="table-viewport"><table class="stat-table"><thead><tr><th>Rank</th><th>Manager</th><th>Record</th><th>Run diff.</th><th>Team Score</th><th>Roster</th></tr></thead><tbody>${list.length?list.map(row=>`<tr class="${weekly.entry?.id===row.id?'weekly-my-entry':''}"><td>${row.rank}</td><td>${esc(row.name)}</td><td>${row.wins}–${row.losses}</td><td>${row.runDifferential>0?'+':''}${row.runDifferential}</td><td>${row.score}/1000</td><td>${row.rosterVisible?`<button class="btn small quiet" data-week-detail="${row.id}">View team</button>`:'Hidden until Monday'}</td></tr>`).join(''):'<tr><td colspan="6">No official teams submitted yet. You could be first.</td></tr>'}</tbody></table></div></section>`;}
function weeklyHonors(){if(!weekly.closed||!weekly.honors?.length)return '';
 return `<section class="panel"><h2>Weekly honors</h2><div class="weekly-honors">${weekly.honors.map(h=>`<div><small>${esc(h.title)}</small><b>${esc(h.name)}</b><span>${esc(h.reason)}</span></div>`).join('')}</div></section>`;
}
function weeklyTeamSummary(team,title){if(!team)return '';const roster=team.roster||{},order=team.battingOrder||[],p=team.stats?.pitchers?.filter(x=>x.g>0).sort((a,b)=>b.so-a.so)[0];
 return `<section class="weekly-compare-team"><h3>${esc(title||team.name)}</h3><p class="hintline">${team.wins}–${team.losses} · ${team.score}/1000 · ${team.runDifferential>=0?'+':''}${team.runDifferential} runs</p><div class="table-viewport"><table class="stat-table"><thead><tr><th>Position</th><th>Pokémon</th><th>Base stats</th></tr></thead><tbody>${B.SLOTS.map(s=>`<tr><td>${s.id}</td><td>${esc(nameOf(roster[s.id]))}</td><td>${roster[s.id]?DATA.mons[roster[s.id]-1].hp+' HP · '+DATA.mons[roster[s.id]-1].atk+' ATK · '+DATA.mons[roster[s.id]-1].spe+' SPE':''}</td></tr>`).join('')}</tbody></table></div><h4>Batting order</h4><p class="weekly-order-line">${order.map((id,i)=>`${i+1}. ${esc(nameOf(id))}`).join(' · ')}</p>${p?`<p class="hintline">Pitching leader: ${esc(nameOf(p.id))}, ${p.so} K and ${p.era} ERA</p>`:''}</section>`;}
function weeklyComparisonSelectors(){if(!weekly.closed||weekly.entries.length<2)return '';
 const options=`<option value="">Choose an entry</option>${weekly.entries.map(e=>`<option value="${e.id}">${esc(e.name)} · #${e.rank}</option>`).join('')}`;
 return `<section class="panel weekly-compare-picker"><h2>Compare two archived teams</h2><p class="hintline">Select any two completed entries from this week. Compare their rosters, positions, batting orders, season statistics, and use of the bench.</p><div class="weekly-compare-pickers"><label>First team<select id="weekly-compare-left">${options.replace(`value="${weekly.compare?.left?.id}"`,`value="${weekly.compare?.left?.id}" selected`)}</select></label><label>Second team<select id="weekly-compare-right">${options.replace(`value="${weekly.compare?.right?.id}"`,`value="${weekly.compare?.right?.id}" selected`)}</select></label></div></section>`;}
function weeklyDetailPanel(){const left=weekly.compare?.left,right=weekly.compare?.right;
 if(left||right){const shared=left&&right?Object.values(left.roster).filter(id=>Object.values(right.roster).includes(id)):[];
 return `<section class="panel weekly-comparison"><div class="sectionhead"><h2>Side-by-side comparison</h2><button class="btn small secondary" data-week-close-detail="1">Clear</button></div><div class="weekly-compare-grid">${left?weeklyTeamSummary(left,left.name):''}${right?weeklyTeamSummary(right,right.name):''}</div>${left&&right?`<p class="hintline">Shared Pokémon: ${shared.length}/15. ${shared.length?esc(shared.map(nameOf).join(', ')):'No Pokémon in common.'} The same Pokémon can be used at different positions or batting spots.</p>`:''}</section>`;}
 const a=weekly.compared;if(!a)return '';const mine=weekly.entry;
 const shared=mine&&a?Object.values(mine.roster).filter(id=>Object.values(a.roster).includes(id)):[];
 return `<section class="panel weekly-comparison"><div class="sectionhead"><h2>${mine&&mine.id!==a.id?'Team comparison':'Team profile'}</h2><button class="btn small secondary" data-week-close-detail="1">Close</button></div><div class="weekly-compare-grid">${mine&&mine.id!==a.id?weeklyTeamSummary(mine,'Your team'):''}${weeklyTeamSummary(a,a.name)}</div>${mine&&mine.id!==a.id?`<p class="hintline">Shared Pokémon: ${shared.length}/15. ${shared.length?esc(shared.map(nameOf).join(', ')):'These teams have no Pokémon in common.'} Different position assignments and batting orders can affect results, even with identical rosters.</p>`:''}</section>`;}
function weeklyDraftPanel(){const ids=Object.values(weekly.roster),complete=ids.length===15;
 const options=weekly.pool.filter(id=>!ids.includes(id)&&nameOf(id).toLowerCase().includes(weeklySearch.toLowerCase())&&(weeklyFilter==='all'||(weeklyFilter==='favorite'&&favorites.has(id))||(weeklyFilter==='legend'&&DATA.leg.includes(id))||DATA.mons[id-1].types.includes(weeklyFilter)));
 return `<div class="weekly-draft-layout draft-layout"><div class="draft-main"><section class="panel"><div class="statusbar"><span class="label">YOUR BASEBALL DIAMOND</span><span class="baggie">${ids.length}/15 Pokémon</span>${complete?'<button data-scroll-batting="1" class="btn small secondary">Edit batting order</button>':''}</div>${scorecards(weekly.roster)}${fieldMarkup(weekly.roster,true)}<p class="info">Click a Pokémon in the pool, then choose an empty slot. Click two filled slots to swap, or drag a Pokémon sprite. Use Remove to return a Pokémon to the pool.</p>${rosterList(weekly.roster)}<div class="weekly-removers">${B.SLOTS.filter(s=>weekly.roster[s.id]).map(s=>`<button class="btn small quiet" data-week-remove="${s.id}">Remove ${s.id}: ${esc(nameOf(weekly.roster[s.id]))}</button>`).join('')}</div></section></div><aside class="draft-aside"><section class="panel compact"><h2>Weekly Pokémon pool</h2><p class="hintline">All 151 options are available at once. No rerolls or Legendary limit. The statistical mix is balanced across generations, types and base stats.</p><div class="weekly-pool-filter"><input id="weekly-search" placeholder="Search Pokémon…" aria-label="Search the weekly pool" value="${esc(weeklySearch)}"><select id="weekly-filter" aria-label="Filter Pokémon"><option value="all" ${weeklyFilter==='all'?'selected':''}>All types</option><option value="favorite" ${weeklyFilter==='favorite'?'selected':''}>Favorites</option><option value="legend" ${weeklyFilter==='legend'?'selected':''}>Legendary / Mythical</option>${B.TYPES.map(t=>`<option value="${esc(t)}" ${weeklyFilter===t?'selected':''}>${esc(t)}</option>`).join('')}</select></div><div class="pokemon-pool weekly-pool inline-stats-pool">${options.map(id=>`<div class="weekly-choice">${candidateCard(id,`data-week-pick="${id}" aria-label="Select ${esc(nameOf(id))}"`,weeklySelected)}<button class="weekly-favorite" data-week-fav="${id}" aria-label="Favorite ${esc(nameOf(id))}" title="Favorite">${favorites.has(id)?'★':'☆'}</button></div>`).join('')||'<p class="muted">No available matches.</p>'}</div><p class="hintline">${options.length} available matches. Click a Pokémon to select it, then choose its field or bench slot.</p></section>${complete?`<section class="panel compact weekly-lock-panel"><div class="lineup-help" role="note"><b>Lineup stage:</b> Rearrange starters and bench, choose your DH, and adjust the batting order before submitting. This is your one official entry for the week.</div>${battingOrderMarkup(weekly.roster,weekly.order,'weekly')}<label class="weekly-teamname">Team name<input id="weekly-name" maxlength="24" value="${esc(weekly.name)}" placeholder="Your weekly team"></label><button class="btn primary wide" data-week-submit="1">${weekly.closed?'Simulate unranked archive season':'Submit official 162-game season'}</button><p class="hintline">${weekly.closed?'Unranked practice results never affect archived leaderboard positions.':'You can edit freely before submission. Once submitted, your roster and season result are final.'}</p></section>`:''}</aside></div>`;}
function weeklyResultPanel(){const e=weekly.entry||weekly.practiceResult;if(!e)return '';
 return `<section class="panel weekly-result"><div class="sectionhead"><div><div class="panel-tag">${weekly.practiceResult?'UNRANKED PRACTICE · NOT ON LEADERBOARD':weekly.closed?'ARCHIVED RESULT':'OFFICIAL WEEKLY RESULT'}</div><h2>${esc(e.name)} · ${e.wins}–${e.losses}</h2></div><button class="btn small primary" data-week-image="1">Save Image</button></div><div class="weekly-result-numbers"><div><small>TEAM SCORE</small><strong>${e.score}/1000</strong></div><div><small>RUN DIFFERENTIAL</small><strong>${e.runDifferential>=0?'+':''}${e.runDifferential}</strong></div><div><small>GAMES</small><strong>162</strong></div><div><small>REST DAYS</small><strong>${e.restDays||0}</strong></div></div><p class="hintline">${e.wins>=110?'A standout season driven by your roster choices and lineup strategy.':e.wins>=81?'Your team held its own over a long season. Analyze the batting, pitching and bench contributions below.':'A difficult campaign. Study the batting order, starting positions, and endurance contributions for improvements.'}</p>${awardsMarkup(e.awards,{solo:e.name})}${statsDropdown(e.stats)}<details class="stats-dropdown"><summary>All 162 games and special events</summary><div class="table-viewport"><table class="stat-table"><thead><tr><th>Game</th><th>Opponent</th><th>Result</th><th>Score</th><th>Special moments</th></tr></thead><tbody>${(e.games||[]).map(g=>`<tr><td>${g.number}</td><td>${esc(g.opponent)}</td><td>${g.win?'W':'L'}</td><td>${g.us}–${g.them}</td><td>${(g.special||[]).map(s=>esc(EVENT_LABELS[s.type]||s.type)).join(' · ')||'—'}</td></tr>`).join('')}</tbody></table></div></details></section>`;}
function renderWeekly(){if(!weekly||view!=='weekly')return;const closed=weekly.closed,hasEntry=!!weekly.entry;
 const archiveSelect=`<select id="weekly-week-picker" aria-label="Browse weekly archives">${weekly.archives.map(id=>`<option value="${id}" ${id===weekly.week?'selected':''}>${id===weekly.current?'Current week':id} · ${id}</option>`).join('')}</select>`;
 $('weekly-content').innerHTML=`<div class="weekly-hero panel"><div><div class="panel-tag">${closed?'WEEKLY ARCHIVE · UNRANKED REPLAY':'OPEN COMPETITION · ENDS MONDAY 00:00 UTC'}</div><h2>Weekly Challenge · ${esc(weekly.week)}</h2><p>Draft any 15 from the same balanced pool of 151 Pokémon. Arrange 10 starters, 5 bench, and your nine-batter order. Compete over 162 games against a standardized schedule.</p><p class="hintline">Pool and ranked attempts reset every Monday at 00:00 UTC. Opponents and simulation seed are shared, while each roster affects events and fatigue. ${closed?'This archived pool can be replayed for practice; official results are closed.':'Your full roster remains private from other entrants until the week closes.'}</p></div><div class="weekly-hero-actions"><label>Browse week ${archiveSelect}</label><div class="weekly-hero-metrics"><span><b>151</b> pool</span><span><b>15</b> selections</span><span><b>162</b> games</span></div></div></div>
 ${weeklyResultPanel()}${weeklyLeaderboard()}${weeklyHonors()}${weeklyProfile()}${weeklyComparisonSelectors()}${weeklyDetailPanel()}${closed&&weekly.officialEntry?`<div class="weekly-archive-actions toolbar"><button class="btn secondary" data-week-toggle-practice="1">${hasEntry?'Practice this archived pool':'Restore original official result'}</button></div>`:''}${!hasEntry?weeklyDraftPanel():`<section class="panel"><div class="sectionhead"><h2>Submitted roster</h2><span class="baggie">Locked</span></div><div class="weekly-submitted-field">${fieldMarkup(weekly.entry.roster,false)}${rosterList(weekly.entry.roster)}</div><h3>Submitted batting order</h3><p class="weekly-order-line">${weekly.entry.battingOrder.map((id,i)=>`${i+1}. ${esc(nameOf(id))}`).join(' · ')}</p></section>`}
 ${closed?'<section class="panel"><p class="hintline">Archive mode: replays are unranked and do not change historical leaderboards. You can keep experimenting with the archived pool before submitting to the current week.</p></section>':''}`;
 if(!hasEntry)wireField('weekly');
}
async function handleWeeklyClick(el){if(el.id==='weekly-back'){home();return true;}
 if(view!=='weekly'||!weekly)return false;
 if(el.dataset.weekPick){selectVisibleCandidate('weekly',+el.dataset.weekPick);return true;}
 if(el.dataset.weekFav){const id=+el.dataset.weekFav;if(favorites.has(id))favorites.delete(id);else favorites.add(id);renderWeekly();return true;}
 if(el.dataset.weekRemove){const slot=el.dataset.weekRemove;if(weekly.entry)return true;delete weekly.roster[slot];weekly.order=B.normalizeBattingOrder(weekly.roster,weekly.order);swapFrom=null;weeklySelected=null;saveWeekly();renderWeekly();return true;}
 if(el.dataset.weekTogglePractice){if(weekly.entry){weekly.entry=null;weekly.roster={...weekly.officialEntry.roster};weekly.order=[...weekly.officialEntry.battingOrder];}else{weekly.entry=weekly.officialEntry;weekly.practiceResult=null;}weekly.compared=null;renderWeekly();return true;}
 if(el.dataset.weekSubmit){if(weekly.closed){const order=B.normalizeBattingOrder(weekly.roster,weekly.order);if(!B.validateBattingOrder(weekly.roster,order))return notify('Complete your 15-Pokémon roster first.');const result=B.singleSeason(DATA,weekly.roster,weekly.seed^0x517ab27,order);const runsFor=result.games.reduce((n,g)=>n+g.us,0),runsAgainst=result.games.reduce((n,g)=>n+g.them,0);weekly.practiceResult={name:'Archive Practice',wins:result.wins,losses:result.losses,score:result.rating.score,runDifferential:runsFor-runsAgainst,restDays:result.stats.batters.reduce((n,b)=>n+(b.rested||0),0),rating:result.rating,stats:result.stats,awards:result.awards,games:result.games,roster:{...weekly.roster},battingOrder:[...order]};renderWeekly();window.scrollTo({top:0,behavior:'smooth'});return true;}
  const roster=weekly.roster,order=B.normalizeBattingOrder(roster,weekly.order),name=$('weekly-name')?.value.trim()||weekly.name;
  if(!B.validateBattingOrder(roster,order))return notify('Complete all 15 positions and all nine batting spots.');
  if(!confirm('Submit your only official entry for this week? You cannot change it afterward.'))return true;
  try{const out=await weeklyApi('submit',{week:weekly.week,token:weeklyToken(),name,roster,battingOrder:order},'POST');weekly.entry=out.entry;weekly.entries=out.board;weekly.name=name;weekly.order=order;weekly.compared=null;saveWeekly();renderWeekly();recordSeason('weekly:'+weekly.week+':'+out.entry.id,'Weekly 151 '+weekly.week,out.entry.wins,out.entry.losses,out.entry.score,out.entry.stats,out.entry.games);window.scrollTo({top:0,behavior:'smooth'});notify('Official weekly result submitted.');}
  catch(e){notify(e.message);if(/one official/i.test(e.message))await openWeekly(weekly.week,false);}return true;}
 if(el.dataset.weekDetail){try{const r=await weeklyApi('detail',{week:weekly.week,id:el.dataset.weekDetail});weekly.compared=r.entry;renderWeekly();$('weekly-content')?.querySelector('.weekly-comparison')?.scrollIntoView({block:'center',behavior:'smooth'});}catch(e){notify(e.message);}return true;}
 if(el.dataset.weekCloseDetail){weekly.compared=null;weekly.compare={left:null,right:null};renderWeekly();return true;}
 if(el.dataset.weekImage){await saveWeeklyImage();return true;}
 return false;}
async function saveWeeklyImage(){// Use the same native Canvas team-card exporter as solo and fantasy.
 if(!weekly?.entry&&!weekly?.practiceResult)return notify('Finish your weekly season first.');await saveRosterImage();}

// Export a shareable roster card from the actual season data and existing PokéAPI sprites.
// No AI artwork or third-party image generation is involved.
async function saveRosterImage(){
 const leagueMode=view==='league'&&league?.status==='season'&&playback.seriesDone;
 const soloMode=view==='solo'&&solo?.result&&playback.index>=solo.result.games.length;
 const weeklyMode=view==='weekly'&&(weekly?.entry||weekly?.practiceResult);
 if(!leagueMode&&!soloMode&&!weeklyMode)return notify('Finish the season to save your team image.');
 const teamId=leagueMode?(teamView||me()?.id||league.seats[0].id):null;
 const roster=leagueMode?league.teams[teamId]:weeklyMode?(weekly.entry||weekly.practiceResult).roster:solo.roster;
 if(!roster||B.SLOTS.some(slot=>!roster[slot.id]))return notify('Complete the roster first.');
 const record=leagueMode?league.season.standings.find(x=>x.id===teamId):weeklyMode?(weekly.entry||weekly.practiceResult):solo.result;
 const teamName=leagueMode?(league.seats.find(x=>x.id===teamId)?.name||'My Team'):weeklyMode?(weekly.entry||weekly.practiceResult).name:'Solo Challenge';
 const isChampion=leagueMode&&league.season.champion===teamId;
 const can=document.createElement('canvas'),W=1200,H=leagueMode?1625+league.seats.length*65:1630;can.width=W;can.height=H;
 const g=can.getContext('2d');
 const C={bg:'#141416',panel:'#222226',gold:'#bd9a57',bright:'#f0cd75',ink:'#f8f8f8',muted:'#b4b1b3',red:'#8f303f',line:'#4e4844'};
 g.fillStyle=C.bg;g.fillRect(0,0,W,H);
 const rr=(x,y,w,h,r,fill,stroke)=>{g.beginPath();g.roundRect(x,y,w,h,r);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=2;g.stroke();}};
 const txt=(s,x,y,size=25,color=C.ink,weight=700,align='left',maxWidth)=>{g.fillStyle=color;g.font=`${weight} ${size}px system-ui,Arial,sans-serif`;g.textAlign=align;g.textBaseline='alphabetic';g.fillText(String(s),x,y,maxWidth);};
 // A restrained charcoal header, inspired by the user's sample layout but original to this game.
 txt('POKÉMON BASEBALL',55,65,30,C.muted,850);txt(leagueMode?'FANTASY DRAFT':weeklyMode?'WEEKLY 151':'SOLO CHALLENGE',55,112,44,C.bright,900);
 if(isChampion){rr(55,133,310,50,25,C.gold);txt('WORLD SERIES CHAMPION',75,167,24,C.bg,900);}
 txt(teamName,55,isChampion?250:200,58,C.ink,900,'left',1000);
 txt(`${record.wins??record.w}–${record.losses??record.l}`,55,isChampion?330:280,80,C.ink,900);
 txt('162-GAME RECORD',380,isChampion?320:270,27,C.muted,800);
 const score=B.scoreTeam(DATA,roster);
 txt(`TEAM SCORE  ${score.score} / 1000`,W-54,isChampion?330:280,31,C.bright,800,'right');
 if(leagueMode){const series=league.season.playoff,won=series.filter(x=>(x.hs>x.as?x.h:x.a)===teamId).length;
  txt(`World Series: ${won}–${series.length-won}  |  League ${league.code}`,55,365,22,C.muted,600);
 }else txt(weeklyMode?'WEEKLY 151 · '+weekly.week:solo.variant==='151'?'151 CHALLENGE':'162–0 CHALLENGE',55,365,22,C.muted,700);
 const fx=50,fy=398,fw=1100,fh=825;
 let turf=null;
 try{const svg=new Blob([fieldSVG().replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ')],{type:'image/svg+xml'});const url=URL.createObjectURL(svg);turf=await new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>resolve(null);im.src=url;});URL.revokeObjectURL(url);}catch{}
 if(turf)g.drawImage(turf,fx,fy,fw,fh);else{rr(fx,fy,fw,fh,14,'#214833',C.gold);}
 // Pokémon are rendered with transparent PNG sprites; the name/position strip is below each.
 const ids=B.SLOTS.map(s=>roster[s.id]);
 const art=new Map(await Promise.all(ids.map(async id=>[id,await new Promise(resolve=>{
  const im=new Image();im.crossOrigin='anonymous';let finished=false;
  const done=x=>{if(finished)return;finished=true;resolve(x);};
  im.onload=()=>done(im);im.onerror=()=>done(null);im.src=img(id);setTimeout(()=>done(null),6500);
 })])));
 function drawMon(id,x,y,width,height,pos){
  const im=art.get(id);if(im){try{g.imageSmoothingEnabled=false;g.drawImage(im,x-width/2,y-height,width,height);}catch{}}
  rr(x-width*.58,y+2,width*1.16,42,6,'#151518e6',C.gold);
  txt(nameOf(id).toUpperCase(),x,y+19,Math.max(12,Math.min(16,230/nameOf(id).length)),C.ink,850,'center',width*1.1);
  txt(pos,x,y+35,13,C.bright,900,'center');
 }
 for(const sl of B.FIELD_SLOTS){const x=fx+sl.x/100*fw,y=fy+sl.y/100*fh;
  drawMon(roster[sl.id],x,y,115,105,sl.id);
 }
 // All five bench slots, in one row, matching the on-page dugout arrangement.
 rr(50,1245,1100,180,16,C.panel,C.line);
 txt('DUGOUT  /  FIVE FLEXIBLE BENCH',70,1280,23,C.bright,800);
 for(let i=0;i<B.BENCH_SLOTS.length;i++){
  const sl=B.BENCH_SLOTS[i];const x=155+i*220;
  drawMon(roster[sl.id],x,1373,102,82,sl.id);
 }
 let y=1480;
 if(leagueMode){
  txt('FINAL STANDINGS',55,y,30,C.bright,850);y+=36;
  const standing=league.season.standings;
  standing.forEach((row,i)=>{
   const selected=row.id===teamId;
   rr(50,y,1100,54,4,selected?'#3a2d28':i%2?'#1b1b1d':'#29292c',selected?C.gold:null);
   txt(String(i+1),68,y+36,26,selected?C.bright:C.muted,850);
   txt(row.name,125,y+36,24,C.ink,selected?850:650,'left',650);
   txt(`${row.w}–${row.l}`,860,y+36,25,C.ink,800,'right');
   txt(row.score.score,1100,y+36,25,C.bright,850,'right');y+=60;
  });
 }else{
  txt('SEASON COMPLETE',55,y,35,C.bright,900);
  txt(`HITTING ${score.offense}  ·  FIELDING ${score.defense}  ·  PITCHING ${score.pitching}`,55,y+55,23,C.ink,650);
 }
 txt('POKÉMON BASEBALL',55,H-30,22,C.muted,850);
 txt('TEAM SHARE CARD',1145,H-30,18,C.muted,650,'right');
 try{
  const blob=await new Promise((resolve,reject)=>can.toBlob(b=>b?resolve(b):reject(Error('PNG export failed')),'image/png'));
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`pokemon-baseball-${teamName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-season.png`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  notify('Team image saved.');
 }catch(e){notify('Could not save PNG: '+e.message);}
}
function downloadJSON(obj,name){const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
// Candidate clicks are for draft selection only; stats already appear inline. No expanded cards.
function selectVisibleCandidate(context,id){
 if(context==='league'){selected=id;swapFrom=null;}else if(context==='weekly'){weeklySelected=id;swapFrom=null;}else {soloSelected=id;swapFrom=null;}
 const attribute=context==='league'?'data-mon':context==='weekly'?'data-week-pick':'data-solomon';
 for(const button of document.querySelectorAll('button['+attribute+']')){
  const active=Number(button.getAttribute(attribute))===Number(id);
  button.classList.toggle('active',active);
  const tile=button.closest('.pokemon-tile');if(tile)tile.classList.toggle('active',active);
  button.setAttribute('aria-pressed',String(active));
 }
 document.querySelectorAll('[data-slot].selected').forEach(el=>el.classList.remove('selected'));
 const hint=document.querySelector(context==='league'?'.compact-instruction':context==='weekly'?'.weekly-draft-layout .draft-main .info':'.solo-workspace .draft-main .info');
 if(hint)hint.textContent='Selected '+nameOf(id)+'. Click an empty field or bench slot to place it.';
}
// Draft scouting is deliberate: click/select a Pokémon for its base stats.
// There is no hover-based inspector and no position-fit disclosure.
document.addEventListener('toggle',ev=>{if(ev.target?.id==='draft-order-details'){orderExpanded=ev.target.open;sessionStorage.setItem('pb-order-expanded',orderExpanded?'yes':'no');}},true);
document.addEventListener('pointerdown',playerActivity,{passive:true});document.addEventListener('keydown',playerActivity);document.addEventListener('wheel',playerActivity,{passive:true});
// Site navigation
$('home-link').onclick=home;$('back-btn').onclick=home;$('solo-back').onclick=home;
$('solo-link').onclick=startSolo;$('weekly-link').onclick=()=>openWeekly();$('start-solo').onclick=startSolo;
$('audio-btn').textContent=sound?'Sound on':'Sound off';$('audio-btn').onclick=()=>{sound=!sound;localStorage.setItem('pb-sound',sound?'on':'off');$('audio-btn').textContent=sound?'Sound on':'Sound off';if(sound)soundTurn();};
for(const [key,label] of Object.entries(B.MODES)){const option=document.createElement('option');option.value=key;option.textContent=label.name;$('mode-select').append(option)}
$('mode-select').value='wild';
const poolSize=()=>{const f=$('create-form');$('pool-size').textContent=`${B.pool(DATA,f.elements.mode.value,f.elements.legends.checked).length} eligible Pokémon for ${f.elements.size.value} teams (15 each).`};
$('create-form').addEventListener('change',poolSize);poolSize();
$('create-form').onsubmit=async ev=>{ev.preventDefault();const f=ev.currentTarget;try{const out=await api('create',{name:f.elements.name.value,settings:{mode:f.elements.mode.value,size:+f.elements.size.value,timer:+f.elements.timer.value,order:f.elements.order.value,legends:f.elements.legends.checked,pub:f.elements.pub.checked}});saveSeat(out.league.code,out.seat,out.token);openLeague(out.league.code);}catch(e){notify(e.message)}};
$('spectate-form').onsubmit=async ev=>{ev.preventDefault();const code=ev.currentTarget.elements.code.value.trim().toUpperCase();if(!code)return;await openLeague(code,true,true);};
$('join-form').onsubmit=async ev=>{ev.preventDefault();const f=ev.currentTarget;const c=$('join-code').value.trim().toUpperCase();try{const out=await api('join',{code:c,name:f.elements.name.value});saveSeat(c,out.seat,out.token);openLeague(c);}catch(e){notify(e.message)}};
$('refresh-lobbies').onclick=refreshLobbies;
$('copy-spectator-link').onclick=async()=>{if(!league)return;const url=location.origin+'/draft?watch='+league.code;try{await navigator.clipboard.writeText(url);notify('Spectator link copied');}catch{prompt('Copy spectator link:',url)}};
$('copy-link').onclick=async()=>{if(!league)return;const url=location.origin+'/draft?c='+league.code;try{await navigator.clipboard.writeText(url);notify('Invite link copied')}catch{prompt('Copy this invite link:',url)}};
$('solo-restart').onclick=()=>{if(confirm('Start a fresh solo draft?')){stopPlayback();playback.key='';soloSelected=null;swapFrom=null;initSolo(true);renderSolo()}};
$('join-code').oninput=e=>{e.target.value=e.target.value.toUpperCase()};
window.addEventListener('popstate',()=>{const params=new URLSearchParams(location.search);if(params.has('solo'))startSolo();else if(params.has('weekly'))openWeekly(params.get('weekly')||undefined,false);else if(params.has('watch'))openLeague(params.get('watch'),false,true);else if(params.has('c'))openLeague(params.get('c'),false);else home()});
// Buttons/forms delegated: these are dynamically rebuilt on updates.
document.addEventListener('click',async ev=>{
  const el=ev.target.closest('button');if(!el||el.disabled)return;
  if((el.id==='save-image'||el.dataset.saveImage)&&view==='weekly'){await saveWeeklyImage();return;}
  if(el.id==='save-image'||el.dataset.saveImage){await saveRosterImage();return;}
  if(el.dataset.previewClose){closeTeamPreview();return;}
  if(el.dataset.previewTeam){openTeamPreview(el);return;}
  if(await handleWeeklyClick(el))return;
  if(['play-pause','play-next','play-speed','play-skip','play-replay'].includes(el.id)){
    const games=view==='solo'?solo?.result?.games:league?.season?.games;
    const max=games?.length;if(!max)return;
    stopPlayback();
    if(el.id==='play-replay'){
      playback.index=0;playback.paused=false;playback.seriesActive=false;playback.seriesDone=false;playback.seriesIndex=0;
    }else if(playback.seriesActive){
      if(el.id==='play-pause')playback.paused=!playback.paused;
      if(el.id==='play-next'){
        playback.seriesIndex=Math.min(league.season.playoff.length,playback.seriesIndex+1);
        playback.paused=true;
        if(playback.seriesIndex>=league.season.playoff.length){playback.seriesActive=false;playback.seriesDone=true;playback.completedKey=playback.key;}
      }
    }else{
      if(el.id==='play-pause')playback.paused=!playback.paused;
      if(el.id==='play-next'){playback.index=Math.min(max,playback.index+1);playback.paused=true;}
      if(el.id==='play-skip'){playback.index=max;playback.paused=false;
        if(view==='league'&&!playback.seriesDone)beginWorldSeries();else playback.paused=true;
      }
      if(playback.index>=max&&view==='solo')playback.completedKey=playback.key;
      if(el.id==='play-speed')playback.speed=playback.speed===1000?200:playback.speed===200?1700:1000;
    }
    if(view==='solo')renderSolo();else renderLeague();
    if(el.id==='play-replay')requestAnimationFrame(()=>document.getElementById(view==='solo'?'solo-season-results':'league-content')?.scrollIntoView({block:'start',behavior:'smooth'}));
    return;
  }
  if(el.dataset.scrollBatting){document.getElementById('batting-order-editor')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(el.dataset.batShuffle){
    const context=el.dataset.batShuffle;
    const roster=context==='solo'?solo?.roster:context==='weekly'?weekly?.roster:myTeam();
    if(!roster)return;
    const current=B.normalizeBattingOrder(roster,context==='solo'?solo?.battingOrder:context==='weekly'?weekly?.order:league?.battingOrders?.[me()?.id]);
    const order=[...current];for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    if(order.every((id,i)=>id===current[i])){[order[0],order[1]]=[order[1],order[0]];}
    await changeBattingOrder(context,order);return;
  }
  if(el.dataset.batmove){
    const i=Number(el.dataset.batindex),j=i+Number(el.dataset.batmove);
    if(i<0||i>=9||j<0||j>=9)return;
    const context=el.dataset.batcontext,roster=context==='solo'?solo?.roster:context==='weekly'?weekly?.roster:myTeam();
    if(!roster)return;
    const order=B.normalizeBattingOrder(roster,context==='solo'?solo?.battingOrder:context==='weekly'?weekly?.order:league?.battingOrders?.[me()?.id]);
    [order[i],order[j]]=[order[j],order[i]];
    await changeBattingOrder(context,order);return;
  }
  if(el.id==='lineup-ready'&&view==='league'){const ready=(league.readySeats||[]).includes(me()?.id);await act('ready',{ready:!ready});return;}
  if(el.dataset.rejoin){openLeague(el.dataset.rejoin);return;}
  if(el.dataset.favorite){const id=Number(el.dataset.favorite);if(favorites.has(id))favorites.delete(id);else favorites.add(id);updateFavorites();renderLeague();return;}
  if(el.dataset.joinpublic){$('join-code').value=el.dataset.joinpublic;window.scrollTo({top:440,behavior:'smooth'});notify('Enter a team name in the Join a league form.');return;}
  if(el.dataset.slot){if(['solo','league','weekly'].includes(view))fieldTap(el.dataset.slot);return;}
  if(view==='league'&&league){
    if(el.dataset.mon){selectVisibleCandidate('league',Number(el.dataset.mon));return;}
    if(el.id==='pool-prev'){page=Math.max(0,page-1);renderLeague();return;}
    if(el.id==='pool-next'){page++;renderLeague();return;}
    if(el.dataset.viewteam){teamView=el.dataset.viewteam;renderLeague();return;}
    if(el.dataset.seat){act('seats',{op:el.dataset.op,target:el.dataset.seat});return;}
    if(el.id==='add-cpu'){act('cpu');return;}
    if(el.id==='start-league'){act('start');return;}
    if(el.id==='simulate-league'){if(confirm('Lock all lineups and simulate the season?'))act('simulate');return;}
    if(el.dataset.change==='pub'){act('settings',{pub:!league.set.pub});return;}
    if(el.dataset.change==='order'){act('settings',{order:league.set.order==='set'?'random':'set'});return;}
    if(el.dataset.change==='timer'){act('settings',{timer:league.set.timer===60?120:league.set.timer===120?0:league.set.timer===0?30:60});return;}
    if(el.dataset.change==='mode'){const keys=Object.keys(B.MODES);const next=keys[(keys.indexOf(league.set.mode)+1)%keys.length];act('settings',{mode:next});return;}
    if(el.dataset.change==='legends'){act('settings',{legends:!league.set.legends});return;}
    if(el.dataset.change==='size'){const next=league.set.size===6?3:league.set.size+1;act('settings',{size:next});return;}
    if(el.id==='copy-results'){const text=league.season.standings.map((r,i)=>`${i+1}. ${r.name} ${r.w}-${r.l} (${r.score.score})`).join('\n');try{await navigator.clipboard.writeText(`Pokémon Baseball — League ${league.code}\n${text}`);notify('Standings copied')}catch{notify('Clipboard unavailable')}return;}
    if(el.id==='export-results'){downloadJSON(league,'baseball-league-'+league.code+'.json');return;}
  }
  if(view==='solo'&&solo){
    if(el.dataset.solomon){if(soloLegendBlocked(el.dataset.solomon))return notify('Three Legendary Pokémon maximum in the 162–0 challenge.');selectVisibleCandidate('solo',Number(el.dataset.solomon));return;}
    if(el.id==='solo-mode-17'||el.id==='solo-mode-151'){if(Object.keys(solo.roster).length&&!confirm('Changing challenge mode resets your draft. Continue?'))return;const variant=el.id==='solo-mode-151'?'151':'17-0';initSolo(true);solo.variant=variant;if(variant==='151')solo.mode='kanto';nextSoloRoll();saveSolo();soloSelected=null;renderSolo();return;}
    if(el.id==='reroll-mon'&&solo.monRerolls){const prior=solo.roll?.id;solo.monRerolls--;const taken=Object.values(solo.roster);const candidates=B.pool(DATA,'kanto',true).filter(id=>id!==prior&&!taken.includes(id));solo.roll={id:candidates[Math.floor(B.rand(solo.seed,++solo.rollIndex)*candidates.length)]};saveSolo();soloSelected=null;renderSolo();return;}
    if(el.id==='reroll-type'&&solo.typeRerolls){const r=B.rerollType(DATA,solo.roll,solo.seed,solo.rollIndex++,Object.values(solo.roster),solo.mode,solo.legends&&soloLegendCount()<3);if(r){solo.typeRerolls--;solo.roll=r;saveSolo();soloSelected=null;renderSolo()}else notify('No alternative types available');return;}
    if(el.id==='reroll-gen'&&solo.genRerolls){const r=B.rerollGen(DATA,solo.roll,solo.seed,solo.rollIndex++,Object.values(solo.roster),solo.mode,solo.legends&&soloLegendCount()<3);if(r){solo.genRerolls--;solo.roll=r;saveSolo();soloSelected=null;renderSolo()}else notify('No alternative regions available');return;}
    if(el.id==='simulate-solo'){solo.result=B.singleSeason(DATA,solo.roster,solo.seed+Date.now()%1000000,solo.battingOrder);solo.result.simId=Date.now();stopPlayback();playback.key='';playback.index=0;playback.paused=false;saveSolo();renderSolo();requestAnimationFrame(()=>document.getElementById('solo-season-results')?.scrollIntoView({block:'start',behavior:'smooth'}));return;}
  }
});
document.addEventListener('input',ev=>{if(ev.target?.id==='weekly-name'){if(weekly){weekly.name=ev.target.value;saveWeekly();}return;}if(ev.target?.id==='weekly-search'){weeklySearch=ev.target.value;const i=ev.target.selectionStart;renderWeekly();const input=$('weekly-search');if(input){input.focus();input.setSelectionRange(i,i);}return;}if(ev.target?.id==='solo-search'){soloSearch=ev.target.value;const i=ev.target.selectionStart;renderSolo();const e=$('solo-search');e.focus();e.setSelectionRange(i,i);return;}if(ev.target?.id==='pool-search'){const val=ev.target.value,idx=ev.target.selectionStart;search=val;page=0;renderLeague();const input=$('pool-search');if(input){input.focus();input.setSelectionRange(idx,idx);}}});
document.addEventListener('change',async ev=>{if(ev.target?.dataset?.batto){const el=ev.target,context=el.dataset.batcontext,roster=context==='solo'?solo?.roster:context==='weekly'?weekly?.roster:myTeam(),i=Number(el.dataset.batindex),j=Number(el.value)-1;if(!roster||i<0||i>=9||j<0||j>=9)return;const order=B.normalizeBattingOrder(roster,context==='solo'?solo?.battingOrder:context==='weekly'?weekly?.order:league?.battingOrders?.[me()?.id]);[order[i],order[j]]=[order[j],order[i]];await changeBattingOrder(context,order);return;}if(['weekly-compare-left','weekly-compare-right'].includes(ev.target?.id)){
  const slot=ev.target.id==='weekly-compare-left'?'left':'right',id=ev.target.value;if(!id){weekly.compare[slot]=null;renderWeekly();return;}
  try{const result=await weeklyApi('detail',{week:weekly.week,id});weekly.compare[slot]=result.entry;weekly.compared=null;renderWeekly();}catch(e){notify(e.message);}return;
 }if(ev.target?.id==='weekly-board-view'){weeklyShowCompare=ev.target.value;renderWeekly();if(weeklyShowCompare==='mine')document.querySelector('.weekly-my-entry')?.scrollIntoView({block:'center',behavior:'smooth'});return;}if(ev.target?.id==='weekly-board-sort'){weeklySort=ev.target.value;renderWeekly();return;}if(ev.target?.id==='weekly-filter'){weeklyFilter=ev.target.value;renderWeekly();return;}if(ev.target?.id==='weekly-week-picker'){openWeekly(ev.target.value);return;}if(ev.target?.id==='pool-sort'){sort=ev.target.value;page=0;renderLeague()}if(ev.target?.id==='solo-pool'){solo.mode=ev.target.value;nextSoloRoll();saveSolo();renderSolo()}if(ev.target?.id==='solo-legends'){solo.legends=ev.target.checked;nextSoloRoll();saveSolo();renderSolo()}});
document.addEventListener('submit',async ev=>{if(ev.target?.id!=='chat-form')return;ev.preventDefault();const input=ev.target.elements.message;const text=input.value.trim();if(text){input.value='';await act('chat',{text});}});
setInterval(updateClock,250);
setInterval(async()=>{updateClock();if(view!=='league'||!league||pollBusy)return;if(league.status==='season'&&Date.now()-lastSeasonPoll<20000)return;if(league.status==='season')lastSeasonPoll=Date.now();pollBusy=true;try{const out=await api('state',{code:league.code},'GET');if(league&&out.league.ver!==league.ver){const previousCount=league.picks.length;league=out.league;renderLeague();}else if(league)league.deadline=out.league.deadline;}catch{}finally{pollBusy=false;}},1700);
// Boot into direct invite link or saved solo. No forced login.

const params=new URLSearchParams(location.search);
if(params.get('c'))openLeague(params.get('c'),false);else if(params.has('solo'))startSolo();else if(params.has('weekly'))openWeekly(params.get('weekly')||undefined,false);else if(params.has('watch'))openLeague(params.get('watch'),false,true);else{route('home');refreshLobbies();}renderSavedLeagues();renderRecordBook();
})();
