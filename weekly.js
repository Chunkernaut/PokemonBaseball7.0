// Weekly 151 — deterministic fair pool and server-verified seasons.
// Submissions persist to a local JSON file. Free ephemeral hosts can erase this data.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const B=require('./engine'),DATA=require('./public/pokemon-data.json');
const DB=process.env.PB_WEEKLY_DB||path.join(__dirname,'data','weekly.json');
let entries={};try{entries=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
const WEEK_MS=7*86400000,MONDAY_OFFSET=4*86400000; // UTC epoch Thursday -> prior Monday
const weekStart=t=>Math.floor((t+3*86400000)/WEEK_MS)*WEEK_MS-3*86400000;
const weekId=t=>new Date(weekStart(t)).toISOString().slice(0,10);
const validWeek=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&new Date(s+'T00:00:00Z').getUTCDay()===1&&Number.isFinite(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const parseWeek=s=>Date.parse(s+'T00:00:00Z');
const seedOf=(s)=>crypto.createHash('sha256').update('pokebase-weekly-151-v7:'+s).digest().readUInt32LE(0);
const fail=(status,msg)=>{const e=new Error(msg);e.status=status;throw e;};
function save(){fs.mkdirSync(path.dirname(DB),{recursive:true});const tmp=DB+'.tmp';fs.writeFileSync(tmp,JSON.stringify(entries));fs.renameSync(tmp,DB);}
const tiers=(()=>{const arr=DATA.mons.map((mon,i)=>({id:i+1,bst:mon.hp+mon.atk+mon.def+mon.spa+mon.spd+mon.spe})).sort((a,b)=>a.bst-b.bst||a.id-b.id);const out=Array.from({length:5},()=>[]);arr.forEach((x,i)=>out[Math.min(4,Math.floor(i*5/arr.length))].push(x.id));return out;})();
const STATS=['hp','atk','def','spa','spd','spe'];
const thresholds=Object.fromEntries(STATS.map(stat=>{const vals=DATA.mons.map(m=>m[stat]).sort((a,b)=>a-b);return [stat,[.2,.4,.6,.8].map(q=>vals[Math.min(vals.length-1,Math.floor(q*vals.length))])];}));
function quantile(stat,val){return thresholds[stat].filter(t=>val>t).length;}
const poolCache=new Map();
function poolFor(week){if(poolCache.has(week))return poolCache.get(week);
 const seed=seedOf(week),legends=new Set(DATA.leg);let best=[],bestPenalty=Infinity;
 // Exact overall-tier quotas; each candidate favors underrepresented generations, types,
 // and all six independent stat quintiles while fixing the total legendary budget.
 for(let attempt=0;attempt<20;attempt++){
  const targets=[30,30,31,30,30],selected=[],ids=new Set(),genCount=Array(10).fill(0),typeCount={},statCount=Object.fromEntries(STATS.map(s=>[s,[0,0,0,0,0]]));let legCount=0,step=0;
  const typeNames=[...new Set(DATA.mons.flatMap(m=>m.types))];
  for(let tier=0;tier<5;tier++)for(let x=0;x<targets[tier];x++){
   const neededLegends=7-legCount,remaining=151-selected.length;
   let candidates=tiers[tier].filter(id=>!ids.has(id)&&(legends.has(id)?legCount<7:remaining>neededLegends));
   if(!candidates.length)candidates=tiers[tier].filter(id=>!ids.has(id));
   let winner=candidates[0],min=Infinity;
   for(let j=0;j<Math.min(80,candidates.length);j++){
    const id=candidates[Math.floor(B.rand(seed^Math.imul(attempt+1,0x9e3779b9),++step)*candidates.length)],m=DATA.mons[id-1],g=+B.gen(id);
    const genTarget=([17,17,17,17,17,17,17,16,16][g-1]);
    const genPenalty=genCount[g]>=genTarget?500:(genCount[g]/genTarget)*19;
    const typesPenalty=m.types.reduce((s,t)=>s+(typeCount[t]||0)*.8,0);
    const statsPenalty=STATS.reduce((s,k)=>s+(statCount[k][quantile(k,m[k])]||0)*.25,0);
    const legPenalty=legends.has(id)? (legCount>=7?999:0):0;
    const score=genPenalty+typesPenalty+statsPenalty+legPenalty+B.rand(seed+attempt,++step)*12;
    if(score<min){min=score;winner=id;}
   }
   const m=DATA.mons[winner-1];selected.push(winner);ids.add(winner);genCount[+B.gen(winner)]++;if(legends.has(winner))legCount++;
   for(const t of m.types)typeCount[t]=(typeCount[t]||0)+1;
   for(const k of STATS)statCount[k][quantile(k,m[k])]++;
  }
  const genPenalty=genCount.slice(1).reduce((s,n,i)=>s+Math.abs(n-([17,17,17,17,17,17,17,16,16][i]))*6,0);
  const statPenalty=STATS.reduce((s,k)=>s+statCount[k].reduce((z,n)=>z+Math.abs(n-30.2),0),0);
  const typePenalty=typeNames.reduce((s,t)=>s+Math.max(0,(typeCount[t]||0)-28)*3+(typeCount[t]?0:50),0);
  const p=genPenalty+statPenalty+typePenalty+Math.abs(legCount-7)*200;
  if(p<bestPenalty){bestPenalty=p;best=selected;}
 }
 // Reverse/random-sort with the same week seed so the UI never reveals the balancing tiers.
 best.sort((a,b)=>B.rand(seed,a)-B.rand(seed,b));poolCache.set(week,best);
 if(poolCache.size>48)poolCache.delete(poolCache.keys().next().value);
 return best;
}
const diff=entry=>entry.runDifferential;
function ranking(week){const list=Object.values(entries[week]||{}).sort((a,b)=>b.wins-a.wins||b.runDifferential-a.runDifferential||b.score-a.score||a.submittedAt.localeCompare(b.submittedAt));
 let prior=null,rank=0;return list.map((e,i)=>{const signature=[e.wins,e.runDifferential,e.score].join(':');if(signature!==prior){rank=i+1;prior=signature;}return {...e,rank};});}
function publicEntry(e,closed,own){return {id:e.id,name:e.name,rank:e.rank,wins:e.wins,losses:e.losses,score:e.score,runDifferential:e.runDifferential,runsFor:e.runsFor,runsAgainst:e.runsAgainst,submittedAt:e.submittedAt,rosterVisible:closed||own};}
function overview(week,token){const current=weekId(Date.now());if(!validWeek(week)||week>current||parseWeek(week)<parseWeek(current)-52*WEEK_MS)fail(400,'Weekly challenge unavailable');
 const closed=week<current,viewer=token?hashToken(token):null,board=ranking(week);
 const own=board.find(x=>x.identity===viewer)||null;
 return {week,current,opens:parseWeek(week),closes:parseWeek(week)+WEEK_MS,closed,seed:seedOf(week),pool:poolFor(week),entries:board.map(e=>publicEntry(e,closed,!!viewer&&e.identity===viewer)),own:own?ownDetail(own):null,honors:closed?honors(week):null,archives:Array.from({length:13},(_,i)=>weekId(parseWeek(current)-i*WEEK_MS))};}
function hashToken(t){if(typeof t!=='string'||!/^[a-f0-9]{32,96}$/.test(t))fail(400,'Your browser identity is invalid');return crypto.createHash('sha256').update('weekly-151:'+t).digest('hex');}
function ownDetail(e){const {identity,...safe}=e;return safe;}
function detail(week,id,token){const current=weekId(Date.now());if(!validWeek(week)||week>current)fail(404,'Week unavailable');const identity=token?hashToken(token):null,closed=week<current;
 const e=ranking(week).find(x=>x.id===id);if(!e)fail(404,'Entry not found');if(!closed&&e.identity!==identity)fail(403,'Rosters unlock when this week ends');return ownDetail(e);
}
function honors(week){const all=ranking(week);if(!all.length)return [];
 const top=(fn)=>[...all].sort((a,b)=>fn(b)-fn(a)||a.rank-b.rank)[0];
 const awards=[['Weekly Champion',all[0],'Most regular-season wins'],['Best Offense',top(x=>x.runsFor),'Most runs scored'],['Best Defense',top(x=>-x.runsAgainst),'Fewest runs allowed'],['Iron Roster',top(x=>-x.restDays),'Fewest Pokémon rest games']];
 const underdog=[...all].filter(x=>x.score<600).sort((a,b)=>a.rank-b.rank)[0];if(underdog)awards.push(['Underdog',underdog,'Highest finish with Team Score under 600']);
 return awards.map(([title,e,reason])=>({title,name:e.name,entryId:e.id,reason}));}
function submit(body){const week=String(body.week||''),current=weekId(Date.now());if(week!==current)fail(409,'The submission deadline has passed');
 const identity=hashToken(body.token),people=entries[week]||{};if(people[identity])fail(409,'One official submission per browser identity each week');
 const roster=body.roster,order=body.battingOrder,name=String(body.name||'').trim().replace(/\s+/g,' ');
 if(name.length<2||name.length>24||/[<>]/.test(name))fail(400,'Choose a team name 2–24 characters long');
 if(!roster||typeof roster!=='object'||Array.isArray(roster)||Object.keys(roster).length!==15||B.SLOTS.some(s=>!Number.isInteger(roster[s.id])))fail(400,'Fill all 15 roster positions');
 const ids=B.SLOTS.map(s=>roster[s.id]);if(new Set(ids).size!==15||ids.some(id=>!poolFor(week).includes(id)))fail(400,'Use 15 unique Pokémon from this week’s pool');
 if(!B.validateBattingOrder(roster,order))fail(400,'Set an order containing all nine batters');
 const result=B.singleSeason(DATA,roster,seedOf(week)^0x517ab27,order);
 const runsFor=result.games.reduce((n,g)=>n+g.us,0),runsAgainst=result.games.reduce((n,g)=>n+g.them,0);
 const restDays=result.stats.batters.reduce((n,b)=>n+(b.rested||0),0);
 const id=crypto.randomBytes(8).toString('hex');const entry={id,identity,week,name,submittedAt:new Date().toISOString(),roster:{...roster},battingOrder:[...order],wins:result.wins,losses:result.losses,score:result.rating.score,runDifferential:runsFor-runsAgainst,runsFor,runsAgainst,restDays,rating:result.rating,stats:result.stats,awards:result.awards,
  games:result.games.map(g=>({number:g.number,opponent:g.opponent,win:g.win,us:g.us,them:g.them,innings:g.innings,special:g.special,substitutions:g.substitutions,rested:g.rested}))};
 entries[week]=people;people[identity]=entry;save();return {entry:ownDetail(entry),board:ranking(week).map(x=>publicEntry(x,false,x.identity===identity))};}
function api(action,body={},query=new URLSearchParams()){
 const params=query||new URLSearchParams(),week=String(params.get('week')||body.week||weekId(Date.now()));const token=params.get('token')||body.token||'';
 if(action==='overview')return overview(week,token);
 if(action==='detail')return {entry:detail(week,String(params.get('id')||body.id||''),token)};
 if(action==='submit')return submit(body);
 fail(404,'Unknown weekly action');}
module.exports={api,weekId,poolFor,overview,detail,submit,ranking,honors,seedOf,tiers};
