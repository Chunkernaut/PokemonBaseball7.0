'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-weekly-v7-'));
process.env.PB_WEEKLY_DB=path.join(dir,'weekly.json');
const W=require('./weekly'),B=require('./engine'),D=require('./public/pokemon-data.json');
(async()=>{
 try{
 const week=W.weekId(Date.now());assert.equal(new Date(week+'T00:00:00Z').getUTCDay(),1);
 const ids=W.poolFor(week);assert.equal(ids.length,151);assert.equal(new Set(ids).size,151);
 assert.deepEqual(W.poolFor(week),ids,'Same week uses same public pool');
 assert.deepEqual(W.tiers.map(t=>t.filter(id=>ids.includes(id)).length),[30,30,31,30,30]);
 assert.deepEqual(Array.from({length:9},(_,i)=>ids.filter(id=>B.gen(id)===(i+1).toString()).length),[17,17,17,17,17,17,17,16,16]);
 assert.equal(ids.filter(id=>D.leg.includes(id)).length,7);
 for(const type of B.TYPES)assert.ok(ids.some(id=>D.mons[id-1].types.includes(type)),type);
 const roster=Object.fromEntries(B.SLOTS.map((s,i)=>[s.id,ids[i]]));B.preferStrongestDH(D,roster);
 const order=B.seededOrder(roster,3427);assert.equal(order.length,9);
 const ta='a'.repeat(48),tb='b'.repeat(48);
 assert.equal(W.overview(week,ta).pool.length,151);
 assert.throws(()=>W.submit({week,token:ta,name:'Short Team',roster,battingOrder:order.slice(1)}),/nine batters/i);
 const start=Date.now();const a=W.submit({week,token:ta,name:'Team Alpha',roster,battingOrder:order}).entry;
 assert.equal(a.games.length,162);assert.equal(a.wins+a.losses,162);assert.equal(a.runDifferential,a.runsFor-a.runsAgainst);
 assert.ok(a.stats.batters.length===15);assert.ok(a.awards.length>=1);
 assert.throws(()=>W.submit({week,token:ta,name:'Again',roster,battingOrder:order}),/one official/i);
 const rosterB=Object.fromEntries(B.SLOTS.map((s,i)=>[s.id,ids[i+16]]));B.preferStrongestDH(D,rosterB);
 const b=W.submit({week,token:tb,name:'Team Beta',roster:rosterB,battingOrder:B.seededOrder(rosterB,111)}).entry;
 assert.equal(W.overview(week,'').entries.length,2);
 const publicRow=W.overview(week,'').entries.find(e=>e.id===a.id);
 assert.equal(publicRow.roster,undefined,'Public leaderboard never leaks roster');
 assert.equal(publicRow.rosterVisible,false,'Active entries hidden');
 assert.throws(()=>W.detail(week,a.id,tb),/unlock/i);
 assert.deepEqual(W.detail(week,a.id,ta).roster,roster);
 const ranks=W.ranking(week);assert.equal(ranks.length,2);assert.ok(ranks[0].wins>=ranks[1].wins);
 const freshWeek=W.weekId(Date.now()-7*86400000);assert.notDeepEqual(ids,W.poolFor(freshWeek));
 const priorNow=Date.now;try{
  Date.now=()=>Date.parse(freshWeek+'T12:00:00.000Z');
  const oldPool=W.poolFor(freshWeek),oldRoster=Object.fromEntries(B.SLOTS.map((s,i)=>[s.id,oldPool[i]]));B.preferStrongestDH(D,oldRoster);
  W.submit({week:freshWeek,token:'c'.repeat(48),name:'Archive Team',roster:oldRoster,battingOrder:B.seededOrder(oldRoster,19)});
 }finally{Date.now=priorNow;}
 const archive=W.overview(freshWeek,'');assert.equal(archive.closed,true);
 assert.equal(archive.entries.length,1);assert.equal(archive.entries[0].rosterVisible,true);
 assert.ok(archive.honors.some(x=>x.title==='Weekly Champion'));
 assert.equal(W.detail(freshWeek,archive.entries[0].id,'').roster!=null,true,'Archived complete rosters are public');
 const index=fs.readFileSync('./public/index.html','utf8');const app=fs.readFileSync('./public/app.js','utf8');
 assert.match(index,/id="weekly-link"/);assert.match(index,/id="weekly-view"/);assert.match(index,/id="spectate-form"/);
 assert.match(index,/href="\/guide\.html" target="_blank"/);
 assert.doesNotMatch(index,/global-scout-guide/);
 for(const flag of ['weeklyApi','openWeekly','renderWeekly','weeklyLeaderboard','weeklyTeamSummary','weeklyComparisonSelectors','weeklyHonors','weeklyResultPanel','weeklyFieldTap','saveWeeklyImage'])assert.ok(app.includes(flag),flag);
 assert.match(fs.readFileSync('./public/style.css','utf8'),/classic flat game-menu treatment/);
 assert.ok(fs.existsSync('./public/guide.html'));
 console.log('PASS v7.0: 151 deterministic balanced Pokémon, 162 server-authoritative games, one official submission, privacy, leaderboard, archives, comparison UI and standalone guide ('+(Date.now()-start)+'ms sim).');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
