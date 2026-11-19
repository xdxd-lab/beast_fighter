// Game flow, battle presentation and input wiring (extracted verbatim from V9).
let mode='cpu',sel=[0,1],palette=[0,0],battle=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

function renderRoster(player){
 const box=$(`#p${player}Roster`); box.innerHTML='';
 chars.forEach((c,i)=>{const el=document.createElement('button');el.className='char-card'+(sel[player-1]===i?' selected':'');el.innerHTML=`<div class="portrait">${animalSVG(c,palette[player-1])}</div><h3>${c.name}・${c.animal}</h3><small>${c.job}</small>`;el.onclick=()=>{sel[player-1]=i;if(player===2 && sel[0]===sel[1] && palette[0]===palette[1]) palette[1]=1-palette[0];renderAllSelect();};box.appendChild(el);});
 renderDetail(player);
}
function renderDetail(player){
 const c=chars[sel[player-1]], pi=palette[player-1], box=$(`#p${player}Detail`);
 box.innerHTML=`<div class="big-portrait">${animalSVG(c,pi)}</div><div class="detail"><div class="job">${c.job}</div><h3>${c.name}・${c.animal}</h3><div class="passive">${c.passive}</div><div class="stats"><div class="stat"><b>${c.hp}</b><span>HP</span></div><div class="stat"><b>${c.mp}</b><span>MP</span></div><div class="stat"><b>${c.atk}</b><span>ATK</span></div><div class="stat"><b>${c.def}</b><span>DEF</span></div><div class="stat"><b>${c.spd}</b><span>SPD</span></div></div><div class="palette-row"><span style="font-size:11px;color:var(--muted)">異色造型</span><button class="palette ${pi===0?'active':''}" data-p="0">COLOR A</button><button class="palette ${pi===1?'active':''}" data-p="1">COLOR B</button></div></div>`;
 box.querySelectorAll('.palette').forEach(b=>b.onclick=()=>{palette[player-1]=+b.dataset.p;if(sel[0]===sel[1] && palette[0]===palette[1]) palette[player===1?1:0]=1-palette[player-1];renderAllSelect();});
}
function renderAllSelect(){renderRoster(1);renderRoster(2)}
$$('.mode').forEach(b=>b.onclick=()=>{$$('.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;$('#p2Badge').textContent=mode==='cpu'?'CPU / MAGENTA':'2P / MAGENTA';});

function makeFighter(c,pi,side){return {c,pi,side,hp:c.hp,mp:c.mp,maxHp:c.hp,maxMp:c.mp,shield:0,guard:false,poison:0,weaken:0,slow:0,stun:false,lastAction:null};}
const poseClasses=['pose-idle','pose-ready','pose-charge','pose-release','pose-strike','pose-recover','pose-hit','pose-guard','pose-ko','pose-victory','low-hp','attack','hit','guard','ko','skill','frame-1','frame-2','frame-3','frame-4','frame-5'];
function clearFighterVisualState(){[1,2].forEach(i=>{const el=$(`#fighter${i}`);el.classList.remove(...poseClasses);el.removeAttribute('data-char');});$$('#stage .sequence-layer,#stage .fx,#stage .stage-banner,#stage .afterimage,#stage .fx-flash,#stage .speed-sweep,#stage .impact-burst,#stage .combo-tag,#stage .cinematic-cutin').forEach(el=>el.remove());$('#stage')?.classList.remove('shake','zoom-left','zoom-right','ko-freeze');}
function setPose(side,pose='idle'){const el=$(`#fighter${side+1}`);if(!el)return;el.classList.remove('pose-idle','pose-ready','pose-charge','pose-release','pose-strike','pose-recover','pose-hit','pose-guard','pose-ko','pose-victory');el.classList.add(`pose-${pose}`);}
function setIdle(side){if(!battle||battle.ended)return;setPose(side,'idle');}
function shakeStage(){const st=$('#stage');st.classList.remove('shake');void st.offsetWidth;st.classList.add('shake');setTimeout(()=>st.classList.remove('shake'),240);}
function stageBanner(main,sub='',ko=false){const st=$('#stage'),el=document.createElement('div');el.className=`stage-banner${ko?' ko':''}`;el.innerHTML=`${main}${sub?`<small>${sub}</small>`:''}`;st.appendChild(el);setTimeout(()=>el.remove(),760);}
function sideBaseTransform(side,x=0,y=0){return side===0?`translate(${x}px,${y}px) scaleX(1)`:`translate(${x}px,${y}px) scaleX(-1)`;}
function fxColorForSkill(s){const kind=s.fx||s.type; if(['ember','fireball','meteor'].includes(kind)) return 'rgba(255,133,62,.48)'; if(['water','bubble'].includes(kind)) return 'rgba(109,219,255,.44)'; if(['electric'].includes(kind)) return 'rgba(164,242,255,.44)'; if(['shadow','leaf'].includes(kind)) return 'rgba(150,230,119,.38)'; if(['hammer','airhammer','hammerquake','shockwave'].includes(kind)) return 'rgba(255,215,110,.42)'; if(['note','bass'].includes(kind)) return 'rgba(195,124,255,.42)'; return 'rgba(255,255,255,.32)';}
function cinematicStage(side,duration=640,ko=false){const st=$('#stage'); if(!st) return; st.classList.remove('zoom-left','zoom-right','ko-freeze'); void st.offsetWidth; st.classList.add(ko?'ko-freeze':(side===0?'zoom-left':'zoom-right')); setTimeout(()=>st.classList.remove('zoom-left','zoom-right','ko-freeze'),duration);}
function spawnStageFlash(color='rgba(255,255,255,.28)', focus='50% 50%'){const st=$('#stage'),el=document.createElement('div');el.className='fx-flash';el.style.background=`radial-gradient(circle at ${focus}, ${color} 0, rgba(255,255,255,.06) 18%, transparent 62%)`;st.appendChild(el);setTimeout(()=>el.remove(),320);}
function spawnSpeedSweep(side,color='rgba(255,255,255,.18)'){const st=$('#stage'),el=document.createElement('div');el.className=`speed-sweep ${side===0?'left':'right'}`;el.style.background=side===0?`linear-gradient(90deg,transparent,rgba(255,255,255,.04),${color},transparent)`:`linear-gradient(270deg,transparent,rgba(255,255,255,.04),${color},transparent)`;st.appendChild(el);setTimeout(()=>el.remove(),420);}
function spawnImpactBurst(side,color='rgba(255,255,255,.45)',label=''){const st=$('#stage'),el=document.createElement('div');el.className='impact-burst';el.style.left=side===0?'19%':'66%';el.style.top='37%';el.style.background=`radial-gradient(circle, ${color} 0, rgba(255,255,255,.18) 36%, transparent 72%)`;st.appendChild(el);setTimeout(()=>el.remove(),460); if(label){const t=document.createElement('div');t.className='combo-tag';t.textContent=label;t.style.left=side===0?'15%':'62%';t.style.top='30%';st.appendChild(t);setTimeout(()=>t.remove(),620);} }
function spawnAfterimage(side,dx,dy=0){const st=$('#stage'),actor=$(`#fighter${side+1}`); if(!actor) return; const ghost=actor.cloneNode(true); ghost.id=''; ghost.classList.add('afterimage'); ghost.style.transform=sideBaseTransform(side,dx,dy); st.appendChild(ghost); setTimeout(()=>ghost.remove(),360);}
function animateActorMotion(side,s){const actor=$(`#fighter${side+1}`); if(!actor?.animate) return; const dir=side===0?1:-1, fx=s.fx||'', type=s.type||''; let kf; if(['guard','shield','heal','focus'].includes(type)){kf=[{transform:sideBaseTransform(side,0,0)},{offset:.28,transform:sideBaseTransform(side,-dir*8,6)},{offset:.62,transform:sideBaseTransform(side,dir*8,-12)},{transform:sideBaseTransform(side,0,0)}];}
 else if(['shadow','leaf','hammer','airhammer'].includes(fx)||['damage','pierce'].includes(type)){kf=[{transform:sideBaseTransform(side,0,0)},{offset:.18,transform:sideBaseTransform(side,-dir*18,6)},{offset:.52,transform:sideBaseTransform(side,dir*58,-8)},{offset:.74,transform:sideBaseTransform(side,dir*74,-12)},{transform:sideBaseTransform(side,0,0)}];}
 else if(['hammerquake','shockwave','meteor'].includes(fx)){kf=[{transform:sideBaseTransform(side,0,0)},{offset:.24,transform:sideBaseTransform(side,-dir*10,-14)},{offset:.6,transform:sideBaseTransform(side,dir*28,8)},{transform:sideBaseTransform(side,0,0)}];}
 else{kf=[{transform:sideBaseTransform(side,0,0)},{offset:.22,transform:sideBaseTransform(side,-dir*8,4)},{offset:.54,transform:sideBaseTransform(side,dir*24,-7)},{offset:.78,transform:sideBaseTransform(side,dir*14,-2)},{transform:sideBaseTransform(side,0,0)}];}
 actor.animate(kf,{duration:720,easing:'cubic-bezier(.2,.82,.22,1)'});}
function animateTargetMotion(targetSide,attackerSide){const actor=$(`#fighter${targetSide+1}`); if(!actor?.animate) return; const push=attackerSide===0?22:-22; actor.animate([{transform:sideBaseTransform(targetSide,0,0)},{offset:.28,transform:sideBaseTransform(targetSide,push,-5)},{offset:.58,transform:sideBaseTransform(targetSide,push*.45,1)},{transform:sideBaseTransform(targetSide,0,0)}],{duration:320,easing:'cubic-bezier(.2,.82,.22,1)'});}
function isSuperSkill(s){return (s.cost||0)>=16 || (s.power||0)>=28 || ['meteor','bass','bubble','hammerquake','airhammer','shockwave'].includes(s.fx||'');}
function cutinRoleLabel(s){if(['guard','shield','heal','focus'].includes(s.type))return 'SUPPORT'; if(['magic'].includes(s.type)||['ember','fireball','meteor','electric'].includes(s.fx||''))return 'ARCANE'; if(['note','bass'].includes(s.fx||''))return 'SPECIAL'; return 'FINISH';}
async function showCutin(side,s){const st=$('#stage'),fighter=battle?.f?.[side]; if(!st||!fighter)return; cinematicStage(side,640,false); spawnStageFlash(fxColorForSkill(s), side===0?'24% 48%':'76% 48%'); const el=document.createElement('div'); el.className=`cinematic-cutin ${side===1?'right':''}`; el.innerHTML=`<div class="cutin-card"><div class="cutin-art">${animalSVG(fighter.c,fighter.pi)}</div><div class="cutin-meta"><div class="cutin-ribbon">${cutinRoleLabel(s)}</div><div class="cutin-name">${s.name}</div><div class="cutin-sub">${fighter.c.name}・${fighter.c.job}</div><div class="cutin-desc">${s.desc}</div></div></div>`; st.appendChild(el); requestAnimationFrame(()=>el.classList.add('show')); await wait(560); el.classList.remove('show'); el.classList.add('hide'); setTimeout(()=>el.remove(),260); await wait(90);}
function startBattle(){
 const c1=chars[sel[0]],c2=chars[sel[1]]; if(c1.id===c2.id && palette[0]===palette[1])palette[1]=1-palette[0];
 clearFighterVisualState();
 battle={round:1,phase:1,locked:[null,null],busy:false,ended:false,f:[makeFighter(c1,palette[0],0),makeFighter(c2,palette[1],1)]};
 $('#selectScreen').classList.remove('active');$('#battleScreen').classList.add('active');$('#resultOverlay').classList.remove('show');$('#battleLog').innerHTML='<h3>BATTLE LOG</h3>';renderBattle();beginRound();
}
function renderBattle(){
 const [a,b]=battle.f;
 $('#fighter1').dataset.char=a.c.id;$('#fighter2').dataset.char=b.c.id;
 $('#fighter1').innerHTML=`${animalSVG(a.c,a.pi)}<div class="expression"><i></i><i></i><b></b></div><div class="pose-icon"></div><div class="nameplate">${a.c.name}・${a.c.job}</div>`;
 $('#fighter2').innerHTML=`${animalSVG(b.c,b.pi)}<div class="expression"><i></i><i></i><b></b></div><div class="pose-icon"></div><div class="nameplate">${b.c.name}・${b.c.job}</div>`;
 setPose(0,'idle');setPose(1,'idle');
 $('#p1HudName').textContent=`1P ${a.c.name} / ${a.c.job}`;$('#p2HudName').textContent=`${mode==='cpu'?'CPU':'2P'} ${b.c.name} / ${b.c.job}`;updateHUD();
 stageBanner('ROUND 1','FIGHT!');
}
function updateHUD(){battle.f.forEach((f,i)=>{const p=i+1,ratio=f.hp/f.maxHp; $(`#p${p}Hp`).style.width=`${Math.max(0,ratio*100)}%`; $(`#p${p}Mp`).style.width=`${Math.max(0,f.mp/f.maxMp*100)}%`; $(`#p${p}HpTxt`).textContent=`HP ${Math.max(0,f.hp)} / ${f.maxHp}${f.shield?` +${f.shield}盾`:''}`;$(`#p${p}MpTxt`).textContent=`MP ${f.mp} / ${f.maxMp}`;$(`#fighter${p}`).classList.toggle('low-hp',ratio>0&&ratio<.3);});$('#roundLabel').textContent=`ROUND ${battle.round}`;}
function beginRound(){
 if(battle.ended)return; battle.locked=[null,null]; battle.phase=1; battle.busy=false; battle.f.forEach(f=>{f.guard=false;if(f.poison>0){f.hp=Math.max(0,f.hp-5);f.poison--;log(`${f.c.name} 受到中毒傷害 5 點。`);fxDamage(f.side,5,'☠');}});updateHUD();
 if(checkEnd())return;setPose(0,'idle');setPose(1,'idle');
 if(battle.round>1)stageBanner(`ROUND ${battle.round}`,'FIGHT!');
 setPrompt(0);renderCommands(0);
}
function setPrompt(side){battle.phase=side+1;const who=side===0?'1P':(mode==='cpu'?'CPU':'2P');$('#commandTitle').textContent=`${who} 選擇行動`;$('#commandSub').textContent=mode==='local'&&side===1?'請 1P 先不要偷看 2P 的選擇':'技能會顯示 MP 消耗與效果';$('#waiting').classList.toggle('show',mode==='local'&&side===1);$('#phaseLabel').textContent='COMMAND';}
function renderCommands(side){
 const f=battle.f[side], skills=[...f.c.skills,...utility]; const box=$('#cmdGrid');box.innerHTML='';
 skills.forEach(s=>{const b=document.createElement('button');b.className='cmd';b.disabled=battle.busy||f.stun||f.mp<s.cost;b.innerHTML=`${s.cost?`<span class="cost">${s.cost} MP</span>`:''}<b>${s.name}</b><small>${s.desc}</small>`;b.onclick=()=>chooseAction(side,s);box.appendChild(b);});
 if(f.stun){box.innerHTML='<button class="cmd" id="stunSkip"><b>失衡中</b><small>本回合無法行動，點擊繼續。</small></button>';$('#stunSkip').onclick=()=>{f.stun=false;chooseAction(side,{id:'skip',name:'失衡',cost:0,type:'skip'});}}
}
function chooseAction(side,skill){
 if(battle.busy||battle.ended)return; battle.locked[side]=skill; log(`${side===0?'1P':mode==='cpu'?'CPU':'2P'} 已鎖定行動。`,true);
 if(side===0){
   if(mode==='cpu'){battle.locked[1]=cpuPick();resolveRound();}
   else{setPrompt(1);renderCommands(1);}
 } else resolveRound();
}
function cpuPick(){const f=battle.f[1],opp=battle.f[0],opts=[...f.c.skills,...utility].filter(s=>f.mp>=s.cost);const heal=opts.find(x=>x.type==='heal');const shield=opts.filter(x=>x.type==='shield').sort((a,b)=>(b.power||0)-(a.power||0))[0];if(heal&&f.hp/f.maxHp<.42&&Math.random()<.72)return heal;if(shield&&f.shield<12&&f.hp/f.maxHp<.68&&Math.random()<.58)return shield;if(f.hp/f.maxHp<.28&&Math.random()<.32)return utility[0];if(f.mp<18&&Math.random()<.45)return utility[1];if(opp.hp/opp.maxHp<.35){const dmg=opts.filter(x=>['damage','magic','pierce','poison','stun','weaken','slow'].includes(x.type)).sort((a,b)=>(b.power||0)-(a.power||0));if(dmg[0])return dmg[0];}const weighted=opts.filter(x=>x.type!=='heal'&& (x.id!=='guard'||Math.random()<.35));return weighted[Math.floor(Math.random()*weighted.length)]||utility[1];}
function speed(f){return f.c.spd-(f.slow?3:0)+Math.random()*3;}
async function playFiveFrameAction(side,s,hit=true){
 const stage=$('#stage'),actor=$(`#fighter${side+1}`),layer=document.createElement('div');
 layer.className='sequence-layer';stage.appendChild(layer);
 const poses=['ready','charge','release','strike','recover'];
 const totalSteps=32; let hitTriggered=false; const accent=fxColorForSkill(s);
 animateActorMotion(side,s);
 if((s.fx||'').match(/shadow|leaf|hammer|airhammer|note|bass/)) spawnSpeedSweep(side,accent);
 if((s.fx||'').match(/shadow|leaf|airhammer/)){const dir=side===0?1:-1; setTimeout(()=>spawnAfterimage(side,dir*16,-2),90); setTimeout(()=>spawnAfterimage(side,dir*42,-8),150); setTimeout(()=>spawnAfterimage(side,dir*58,-10),210);}
 for(let step=0;step<totalSteps;step++){
   const t=step/(totalSteps-1);
   const frameIndex=Math.min(4,Math.floor(t*5));
   actor.classList.remove('frame-1','frame-2','frame-3','frame-4','frame-5');
   actor.classList.add(`frame-${frameIndex+1}`);
   setPose(side,poses[frameIndex]);
   layer.innerHTML=`${effectFrameSVG(side,s,t,hit)}<div class="frame-callout">${s.name} · ${frameIndex+1}/5</div>`;
   if(step===6) spawnStageFlash(accent, side===0?'24% 58%':'76% 58%');
   if(!hitTriggered && hit && t>=.68 && !['guard','focus','heal','shield'].includes(s.type)){
     hitTriggered=true;
     setPose(1-side,'hit');
     animateTargetMotion(1-side,side);
     spawnImpactBurst(1-side,accent, s.type==='stun'?'BREAK':'');
     spawnStageFlash(accent, side===0?'76% 48%':'24% 48%');
     shakeStage();
     await wait(28);
     setTimeout(()=>{if(battle&&!battle.ended)setPose(1-side,'idle')},240);
   }
   if(frameIndex>=3 && s.type==='guard') setPose(side,'guard');
   await wait(step===totalSteps-1?44:28);
 }
 actor.classList.remove('frame-1','frame-2','frame-3','frame-4','frame-5');
 layer.remove();
 if(battle&&!battle.ended)setPose(side,s.type==='guard'?'guard':'idle');
}
async function resolveRound(){
 battle.busy=true;$('#waiting').classList.remove('show');$('#cmdGrid').innerHTML='<button class="cmd" disabled><b>結算中…</b><small>依速度與技能優先度處理</small></button>';$('#phaseLabel').textContent='RESOLVE';
 const order=[0,1].sort((x,y)=>{const ax=battle.locked[x]?.type==='guard'?20:0,ay=battle.locked[y]?.type==='guard'?20:0;return (speed(battle.f[y])+ay)-(speed(battle.f[x])+ax)});
 for(const side of order){if(checkEnd())break;await act(side,battle.locked[side]);await wait(180);updateHUD();}
 battle.f.forEach(f=>{if(f.weaken>0)f.weaken--;if(f.slow>0)f.slow--;});
 if(!checkEnd()){battle.round++;await wait(250);beginRound();}
}
async function act(side,s){
 const me=battle.f[side],op=battle.f[1-side];if(!s||s.type==='skip'){log(`${me.c.name} 因失衡錯過行動。`);return;} me.lastAction=s.id;
 if(s.cost)me.mp=Math.max(0,me.mp-s.cost);
 if(s.type==='focus'){
   if(isSuperSkill(s)) await showCutin(side,s);
   await playFiveFrameAction(side,s,true);me.mp=Math.min(me.maxMp,me.mp+14);let heal=0;if(me.c.id==='orca'){heal=Math.min(6,me.maxHp-me.hp);me.hp+=heal;}log(`${me.c.name} 凝神，回復 14 MP${heal?`，並因被動回復 ${heal} HP`:''}。`);fxDamage(side,-14,'✦');if(heal)fxText(side,`+${heal} HP`,'heal');return;
 }
 if(s.type==='guard'){if(isSuperSkill(s)) await showCutin(side,s); await playFiveFrameAction(side,s,true);me.guard=true;setPose(side,'guard');log(`${me.c.name} 進入防禦架勢。`);return;}
 if(s.type==='shield'){if(isSuperSkill(s)) await showCutin(side,s); await playFiveFrameAction(side,s,true);const shieldGain=Math.round(s.power*(me.c.id==='jelly'?1.25:1));me.shield+=shieldGain;log(`${me.c.name} 使用「${s.name}」，獲得 ${shieldGain} 點護盾${me.c.id==='jelly'?'（無骨重甲強化）':''}。`);fxDamage(side,-shieldGain,'🛡');return;}
 if(s.type==='heal'){if(isSuperSkill(s)) await showCutin(side,s); await playFiveFrameAction(side,s,true);const heal=Math.min(s.power,me.maxHp-me.hp);me.hp+=heal;log(`${me.c.name} 使用「${s.name}」，回復 ${heal} HP。`);fxText(side,`+${heal} HP`,'heal');return;}
 if(isSuperSkill(s)) await showCutin(side,s); const hit=Math.random()*100<=(s.acc||100);await playFiveFrameAction(side,s,hit);
 if(!hit){spawnStageFlash('rgba(255,255,255,.16)', side===0?'76% 48%':'24% 48%');log(`${me.c.name} 的「${s.name}」落空！`);fxText(1-side,'MISS','miss');return;}
 let power=s.power||0,atk=me.c.atk*(me.weaken?0.8:1),def=op.c.def,crit=Math.random()<(s.crit||.08);
 if(me.c.id==='bear'&&me.hp/me.maxHp<.5)power*=1.12;
 if(me.c.id==='elephant'&&s.id!=='basic')power*=1.08;
 if(me.c.id==='panda'&&speed(me)>speed(op))power*=1.12;
 if(me.c.id==='hummingbird'&&me.hp/me.maxHp<.35)power*=1.18;
 let raw=power+atk*.72+(Math.random()*5-2);if(s.type==='magic')def*=.32;if(s.type==='pierce')def*=.2;let dmg=Math.max(3,Math.round(raw-def*.63));if(crit)dmg=Math.round(dmg*1.5);if(op.guard)dmg=Math.round(dmg*.55);
 let absorbed=0;if(op.shield>0){absorbed=Math.min(op.shield,dmg);op.shield-=absorbed;dmg-=absorbed;}op.hp=Math.max(0,op.hp-dmg);
 log(`${me.c.name} 使用「${s.name}」造成 ${dmg}${absorbed?`（護盾吸收 ${absorbed}）`:''} 點傷害${crit?'，暴擊！':''}`); if(crit) spawnImpactBurst(1-side,'rgba(255,221,117,.56)','CRIT'); fxDamage(1-side,dmg,crit?'CRIT!':'HIT!');
 if(s.type==='poison'){op.poison=3;log(`${op.c.name} 中毒了，持續 3 回合。`);}if(s.type==='weaken'){op.weaken=2;log(`${op.c.name} 的攻擊暫時下降。`);}if(s.type==='slow'){op.slow=2;log(`${op.c.name} 的速度暫時下降。`);}if(s.type==='stun'&&Math.random()<(s.stun||0)){op.stun=true;log(`${op.c.name} 失衡！下回合無法行動。`);fxText(1-side,'STUN','crit');}
}
function fxDamage(side,num,tag){fxText(side,num<0?`+${Math.abs(num)} ${tag}`:`-${num} ${tag}`,num<0?'heal':tag==='CRIT!'?'crit':'damage');}
function fxText(side,text,cls='damage'){const st=$('#stage'),el=document.createElement('div');el.className=`fx fx-text ${cls}`;el.textContent=text;el.style.left=side===0?'23%':'68%';el.style.top='35%';st.appendChild(el);setTimeout(()=>el.remove(),900);}
function checkEnd(){if(battle.ended)return true;const [a,b]=battle.f;if(a.hp>0&&b.hp>0)return false;battle.ended=true;battle.busy=true;const win=a.hp<=0?1:0,lose=1-win;setPose(lose,'ko');setPose(win,'victory');$('#phaseLabel').textContent='K.O.';cinematicStage(win,720,true);spawnStageFlash('rgba(255,108,112,.42)','50% 48%');spawnImpactBurst(lose,'rgba(255,108,112,.5)','K.O.');stageBanner('K.O.','',true);shakeStage();setTimeout(()=>showResult(win),1220);return true;}
function showResult(win){const w=battle.f[win];$('#resultTitle').textContent=`${win===0?'1P':mode==='cpu'?'CPU':'2P'} WIN!`;$('#resultText').textContent=`${w.c.name}・${w.c.job} 取得勝利，共進行 ${battle.round} 回合。`;$('#resultOverlay').classList.add('show');}
function log(t,quiet=false){const e=document.createElement('div');e.className='log-entry';e.textContent=`R${battle?.round||1}｜${t}`;$('#battleLog').appendChild(e);$('#battleLog').scrollTop=$('#battleLog').scrollHeight;if(!quiet){} }
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function backSelect(){clearFighterVisualState();$('#battleScreen').classList.remove('active');$('#selectScreen').classList.add('active');$('#resultOverlay').classList.remove('show');battle=null;renderAllSelect();}
$('#startBtn').onclick=startBattle;$('#rematchBtn').onclick=startBattle;$('#backBtn').onclick=backSelect;$('#btnReset').onclick=backSelect;$('#btnRef').onclick=()=>$('#refOverlay').classList.add('show');$('#closeRef').onclick=()=>$('#refOverlay').classList.remove('show');$('#refOverlay').addEventListener('click',e=>{if(e.target.id==='refOverlay')$('#refOverlay').classList.remove('show')});
renderAllSelect();
