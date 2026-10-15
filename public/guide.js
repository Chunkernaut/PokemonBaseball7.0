'use strict';
const B=window.Baseball;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function weightGuide(){
 const skillName={atk:'Attack',def:'Defense',spa:'Sp. Attack',spd:'Sp. Defense',spe:'Speed',m:'Height',kg:'Weight'};
 const positionName=Object.fromEntries(B.FIELD_SLOTS.map(slot=>[slot.id,slot.name]));
 const importance=weight=>weight>=.16?'Very high':weight>=.095?'High':weight>=.083?'Important':'Supporting';
 const groups=B.FIELD_SLOTS.map(slot=>{
  const role=B.ROLES[slot.id];const sorted=Object.entries(role.stats).sort((a,b)=>b[1]-a[1]);
  const leading=sorted.slice(0,2).map(([stat])=>skillName[stat]).join(' & ');
  const helps=sorted.slice(2,5).map(([stat])=>skillName[stat]).join(', ');
  const types=Object.entries(role.types).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([t])=>t[0].toUpperCase()+t.slice(1)).join(', ');
  return `<tr><th scope="row"><b>${esc(slot.id)}</b><small>${esc(positionName[slot.id])}</small></th><td><strong>${esc(leading)}</strong></td><td>${esc(helps)}</td><td>${esc(importance(B.WEIGHTS[slot.id]))}</td><td>${esc(types)}</td></tr>`;
 }).join('');
 return `<div class="guide-introduction"><p>Draft by reading each Pokémon's original stats. <b>Every starting position matters</b>, but the pitcher has a particularly big influence on results. Weak starters can bring down the whole team's rating. The bench helps when starters need rest; it does not directly increase the initial Team Score.</p></div>
 <div class="guide-topic-grid"><section class="guide-topic"><h3>What each Pokémon stat means</h3>
 <p><b>HP:</b> stamina only — high HP keeps a Pokémon playing longer. It does not raise position fit directly.</p>
 <p><b>Attack:</b> batting power and strong, long throws.</p>
 <p><b>Defense:</b> reliable fielding and catching.</p>
 <p><b>Sp. Attack:</b> pitch and throwing technique; especially valuable on the mound.</p>
 <p><b>Sp. Defense:</b> teamwork, coordination and positioning.</p>
 <p><b>Speed:</b> baserunning and chasing balls in play.</p>
 <p><b>Height & weight:</b> reach, balance and handling imperfect throws or catches. Their effect is limited so very large Pokémon do not automatically dominate.</p></section>
 <section class="guide-topic"><h3>Stamina, substitutions & the bench</h3>
 <p>Pokémon lose energy when they play. Pitchers tire the fastest; catchers have a demanding role too. Batting frequently adds a little extra fatigue. Higher HP slows energy loss.</p>
 <p>Once a starter becomes tired, they sit out <b>exactly their next game</b>. The available bench Pokémon with the strongest hidden fit for that position plays in their place. After resting, the starter returns. Bench Pokémon recover energy while they sit.</p>
 <p><b>Tip:</b> A flexible bench is important over 162 games. It helps to draft Pokémon that can cover different spots, not just your starting ten.</p></section>
 <section class="guide-topic"><h3>Batting order explained</h3>
 <p>After drafting, the lineup editor appears with your nine hitters placed in a <b>random order</b>. Use the <b>Bat #</b> menu or Up/Down buttons to reorder them before the season starts.</p>
 <p><b>Early in the order:</b> More chances to bat, so consistent baserunners can be valuable. <b>Middle:</b> Good opportunities to drive in runs; strong hitters often belong here. <b>Later:</b> Round out the lineup. There is no single required order.</p>
 <p>Your <b>DH</b> bats but doesn't field. The pitcher does not take a batting spot. If a hitter rests, their replacement keeps that hitter's place in the order. Batting order also affects a little stamina use.</p></section>
 <section class="guide-topic"><h3>How ratings work</h3>
 <p>Each position values different combinations of stats, height, weight, and a <b>small type advantage</b>. Dual types do not stack their bonuses. Individual position-fit ratings stay hidden: choose roles based on the Pokémon's original stats.</p>
 <p>The Team Score (out of 1000) measures the starting lineup. Pitching, fielding and hitting all contribute, with extra pressure on the weakest starting positions. Position importance below is <b>qualitative, not an exact formula</b>.</p></section></div>
 <h3 class="guide-positions-title">Position priorities · quick reference</h3><p class="hintline">“Key strengths” are especially useful. “Also helps” lists secondary contributors. Type hints are small tiebreakers, not guarantees.</p>
 <div class="guide-table-scroll"><table class="guide-priority-table"><thead><tr><th>Position</th><th>Key strengths</th><th>Also helps</th><th>Team role</th><th>Type hints</th></tr></thead><tbody>${groups}</tbody></table></div>
 <p class="hintline guide-note">This guide intentionally leaves out exact percentages, numerical type bonuses, and individual Pokémon fit scores. You can reopen it whenever you want while browsing any screen.</p>`;
}

document.getElementById('guide-content').innerHTML=weightGuide();
