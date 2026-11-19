/**
 * Beast Brawl — game controller.
 *
 * Owns the select screen, battle flow and presentation. Rules come from BeastBrawl.Engine;
 * this file only decides *how* an outcome is shown (poses, cut-ins, flashes, HUD, log).
 */
(function () {
  'use strict';

  const BB = window.BeastBrawl;
  const { CHARACTERS, UTILITY_SKILLS } = BB.Roster;
  const Engine = BB.Engine;
  const { fighterSVG, effectFrameSVG } = BB.Sprites;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /** Rejection reason used to unwind coroutines of a battle that was abandoned. */
  const ABORTED = Object.freeze({ aborted: true });
  const ignoreAbort = (err) => { if (err !== ABORTED) throw err; };

  /**
   * One battle's lifetime. Every delay and deferred callback of the battle goes through the
   * session, so leaving or restarting a battle cancels them all: stale coroutines can never
   * touch the next battle (V9 crashed or double-acted when 重新選角 was used mid-resolve).
   */
  class BattleSession {
    constructor(state) {
      this.state = state;
      this.locked = [null, null];
      this.busy = false;
      this.koShown = false;
      this.alive = true;
      this.pending = new Map(); // timer id -> reject fn (null for fire-and-forget callbacks)
    }

    /** Resolves after `ms`, or rejects with ABORTED if the session is disposed first. */
    wait(ms) {
      return new Promise((resolve, reject) => {
        const id = setTimeout(() => { this.pending.delete(id); resolve(); }, ms);
        this.pending.set(id, reject);
      });
    }

    /** Runs `fn` after `ms` unless the session has been disposed. */
    later(fn, ms) {
      const id = setTimeout(() => { this.pending.delete(id); if (this.alive) fn(); }, ms);
      this.pending.set(id, null);
    }

    dispose() {
      this.alive = false;
      this.pending.forEach((reject, id) => { clearTimeout(id); if (reject) reject(ABORTED); });
      this.pending.clear();
    }
  }

  /* ------------------------------------------------------------------ DOM refs */
  const dom = {
    stage: $('#stage'),
    fighters: [$('#fighter1'), $('#fighter2')],
    selectScreen: $('#selectScreen'),
    battleScreen: $('#battleScreen'),
    cmdGrid: $('#cmdGrid'),
    commandTitle: $('#commandTitle'),
    commandSub: $('#commandSub'),
    waiting: $('#waiting'),
    phaseLabel: $('#phaseLabel'),
    roundLabel: $('#roundLabel'),
    battleLog: $('#battleLog'),
    resultOverlay: $('#resultOverlay'),
    refOverlay: $('#refOverlay'),
    hud: [1, 2].map((p) => ({
      name: $(`#p${p}HudName`),
      hp: $(`#p${p}Hp`),
      mp: $(`#p${p}Mp`),
      hpText: $(`#p${p}HpTxt`),
      mpText: $(`#p${p}MpTxt`),
    })),
  };

  /* ------------------------------------------------------------------ app state */
  const app = {
    mode: 'cpu',          // 'cpu' | 'local'
    selection: [0, 1],    // roster index per side
    palettes: [0, 0],     // palette index per side
  };

  /** Current battle session: engine state + UI-only flags. */
  let battle = null;

  const sideLabel = (side) => (side === 0 ? '1P' : app.mode === 'cpu' ? 'CPU' : '2P');

  /* ================================================================== select */
  function renderRoster(player) {
    const box = $(`#p${player}Roster`);
    box.innerHTML = '';
    CHARACTERS.forEach((c, i) => {
      const el = document.createElement('button');
      el.className = 'char-card' + (app.selection[player - 1] === i ? ' selected' : '');
      el.innerHTML = `<div class="portrait">${fighterSVG(c, app.palettes[player - 1])}</div><h3>${c.name}・${c.animal}</h3><small>${c.job}</small>`;
      el.onclick = () => {
        app.selection[player - 1] = i;
        if (player === 2 && app.selection[0] === app.selection[1] && app.palettes[0] === app.palettes[1]) app.palettes[1] = 1 - app.palettes[0];
        renderAllSelect();
      };
      box.appendChild(el);
    });
    renderDetail(player);
  }

  function renderDetail(player) {
    const c = CHARACTERS[app.selection[player - 1]];
    const pi = app.palettes[player - 1];
    const box = $(`#p${player}Detail`);
    box.innerHTML = `<div class="big-portrait">${fighterSVG(c, pi)}</div><div class="detail"><div class="job">${c.job}</div><h3>${c.name}・${c.animal}</h3><div class="passive">${c.passive}</div><div class="stats"><div class="stat"><b>${c.hp}</b><span>HP</span></div><div class="stat"><b>${c.mp}</b><span>MP</span></div><div class="stat"><b>${c.atk}</b><span>ATK</span></div><div class="stat"><b>${c.def}</b><span>DEF</span></div><div class="stat"><b>${c.spd}</b><span>SPD</span></div></div><div class="palette-row"><span style="font-size:11px;color:var(--muted)">異色造型</span><button class="palette ${pi === 0 ? 'active' : ''}" data-p="0">COLOR A</button><button class="palette ${pi === 1 ? 'active' : ''}" data-p="1">COLOR B</button></div></div>`;
    box.querySelectorAll('.palette').forEach((b) => {
      b.onclick = () => {
        app.palettes[player - 1] = +b.dataset.p;
        if (app.selection[0] === app.selection[1] && app.palettes[0] === app.palettes[1]) app.palettes[player === 1 ? 1 : 0] = 1 - app.palettes[player - 1];
        renderAllSelect();
      };
    });
  }

  function renderAllSelect() {
    renderRoster(1);
    renderRoster(2);
  }

  function setMode(mode) {
    app.mode = mode;
    $$('.mode').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
    $('#p2Badge').textContent = mode === 'cpu' ? 'CPU / MAGENTA' : '2P / MAGENTA';
  }

  /* ================================================================== stage FX */
  const POSE_CLASSES = ['pose-idle', 'pose-ready', 'pose-charge', 'pose-release', 'pose-strike', 'pose-recover', 'pose-hit', 'pose-guard', 'pose-ko', 'pose-victory'];
  const FRAME_CLASSES = ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5'];
  const TRANSIENT_FX = '.sequence-layer,.fx,.stage-banner,.afterimage,.fx-flash,.speed-sweep,.impact-burst,.combo-tag,.cinematic-cutin';

  function clearFighterVisualState() {
    dom.fighters.forEach((el) => {
      el.classList.remove(...POSE_CLASSES, ...FRAME_CLASSES, 'low-hp', 'attack', 'hit', 'guard', 'ko', 'skill');
      el.removeAttribute('data-char');
    });
    $$(TRANSIENT_FX, dom.stage).forEach((el) => el.remove());
    dom.stage.classList.remove('shake', 'zoom-left', 'zoom-right', 'ko-freeze');
  }

  function setPose(side, pose = 'idle') {
    const el = dom.fighters[side];
    el.classList.remove(...POSE_CLASSES);
    el.classList.add(`pose-${pose}`);
  }

  function restartClass(el, cls, duration) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), duration);
  }

  function shakeStage() {
    restartClass(dom.stage, 'shake', 240);
  }

  function stageBanner(main, sub = '', ko = false) {
    const el = document.createElement('div');
    el.className = `stage-banner${ko ? ' ko' : ''}`;
    el.innerHTML = `${main}${sub ? `<small>${sub}</small>` : ''}`;
    dom.stage.appendChild(el);
    setTimeout(() => el.remove(), 760);
  }

  const sideBaseTransform = (side, x = 0, y = 0) => `translate(${x}px,${y}px) scaleX(${side === 0 ? 1 : -1})`;

  const FX_ACCENTS = [
    [['ember', 'fireball', 'meteor'], 'rgba(255,133,62,.48)'],
    [['water', 'bubble'], 'rgba(109,219,255,.44)'],
    [['electric'], 'rgba(164,242,255,.44)'],
    [['shadow', 'leaf'], 'rgba(150,230,119,.38)'],
    [['hammer', 'airhammer', 'hammerquake', 'shockwave'], 'rgba(255,215,110,.42)'],
    [['note', 'bass'], 'rgba(195,124,255,.42)'],
  ];
  function fxColorForSkill(s) {
    const kind = s.fx || s.type;
    const hit = FX_ACCENTS.find(([kinds]) => kinds.includes(kind));
    return hit ? hit[1] : 'rgba(255,255,255,.32)';
  }

  function cinematicStage(side, duration = 640, ko = false) {
    dom.stage.classList.remove('zoom-left', 'zoom-right', 'ko-freeze');
    void dom.stage.offsetWidth;
    dom.stage.classList.add(ko ? 'ko-freeze' : side === 0 ? 'zoom-left' : 'zoom-right');
    setTimeout(() => dom.stage.classList.remove('zoom-left', 'zoom-right', 'ko-freeze'), duration);
  }

  function spawnTransient(className, setup, lifetime) {
    const el = document.createElement('div');
    el.className = className;
    setup(el);
    dom.stage.appendChild(el);
    setTimeout(() => el.remove(), lifetime);
    return el;
  }

  function spawnStageFlash(color = 'rgba(255,255,255,.28)', focus = '50% 50%') {
    spawnTransient('fx-flash', (el) => {
      el.style.background = `radial-gradient(circle at ${focus}, ${color} 0, rgba(255,255,255,.06) 18%, transparent 62%)`;
    }, 320);
  }

  function spawnSpeedSweep(side, color = 'rgba(255,255,255,.18)') {
    spawnTransient(`speed-sweep ${side === 0 ? 'left' : 'right'}`, (el) => {
      el.style.background = `linear-gradient(${side === 0 ? 90 : 270}deg,transparent,rgba(255,255,255,.04),${color},transparent)`;
    }, 420);
  }

  function spawnImpactBurst(side, color = 'rgba(255,255,255,.45)', label = '') {
    spawnTransient('impact-burst', (el) => {
      el.style.left = side === 0 ? '19%' : '66%';
      el.style.top = '37%';
      el.style.background = `radial-gradient(circle, ${color} 0, rgba(255,255,255,.18) 36%, transparent 72%)`;
    }, 460);
    if (label) {
      spawnTransient('combo-tag', (el) => {
        el.textContent = label;
        el.style.left = side === 0 ? '15%' : '62%';
        el.style.top = '30%';
      }, 620);
    }
  }

  function spawnAfterimage(side, dx, dy = 0) {
    const ghost = dom.fighters[side].cloneNode(true);
    ghost.id = '';
    ghost.classList.add('afterimage');
    ghost.style.transform = sideBaseTransform(side, dx, dy);
    dom.stage.appendChild(ghost);
    setTimeout(() => ghost.remove(), 360);
  }

  function animateActorMotion(side, s) {
    const actor = dom.fighters[side];
    if (!actor.animate) return;
    const dir = side === 0 ? 1 : -1;
    const fx = s.fx || '';
    const type = s.type || '';
    const at = (x, y, offset) => (offset === undefined ? { transform: sideBaseTransform(side, x, y) } : { offset, transform: sideBaseTransform(side, x, y) });
    let kf;
    if (['guard', 'shield', 'heal', 'focus'].includes(type)) {
      kf = [at(0, 0), at(-dir * 8, 6, 0.28), at(dir * 8, -12, 0.62), at(0, 0)];
    } else if (['shadow', 'leaf', 'hammer', 'airhammer'].includes(fx) || ['damage', 'pierce'].includes(type)) {
      kf = [at(0, 0), at(-dir * 18, 6, 0.18), at(dir * 58, -8, 0.52), at(dir * 74, -12, 0.74), at(0, 0)];
    } else if (['hammerquake', 'shockwave', 'meteor'].includes(fx)) {
      kf = [at(0, 0), at(-dir * 10, -14, 0.24), at(dir * 28, 8, 0.6), at(0, 0)];
    } else {
      kf = [at(0, 0), at(-dir * 8, 4, 0.22), at(dir * 24, -7, 0.54), at(dir * 14, -2, 0.78), at(0, 0)];
    }
    actor.animate(kf, { duration: 720, easing: 'cubic-bezier(.2,.82,.22,1)' });
  }

  function animateTargetMotion(targetSide, attackerSide) {
    const actor = dom.fighters[targetSide];
    if (!actor.animate) return;
    const push = attackerSide === 0 ? 22 : -22;
    actor.animate([
      { transform: sideBaseTransform(targetSide, 0, 0) },
      { offset: 0.28, transform: sideBaseTransform(targetSide, push, -5) },
      { offset: 0.58, transform: sideBaseTransform(targetSide, push * 0.45, 1) },
      { transform: sideBaseTransform(targetSide, 0, 0) },
    ], { duration: 320, easing: 'cubic-bezier(.2,.82,.22,1)' });
  }

  function cutinRoleLabel(s) {
    if (['guard', 'shield', 'heal', 'focus'].includes(s.type)) return 'SUPPORT';
    if (s.type === 'magic' || ['ember', 'fireball', 'meteor', 'electric'].includes(s.fx || '')) return 'ARCANE';
    if (['note', 'bass'].includes(s.fx || '')) return 'SPECIAL';
    return 'FINISH';
  }

  async function showCutin(side, s) {
    const session = battle;
    const fighter = session.state.fighters[side];
    if (!fighter) return;
    cinematicStage(side, 640, false);
    spawnStageFlash(fxColorForSkill(s), side === 0 ? '24% 48%' : '76% 48%');
    const el = document.createElement('div');
    el.className = `cinematic-cutin ${side === 1 ? 'right' : ''}`;
    el.innerHTML = `<div class="cutin-card"><div class="cutin-art">${fighterSVG(fighter.character, fighter.paletteIndex)}</div><div class="cutin-meta"><div class="cutin-ribbon">${cutinRoleLabel(s)}</div><div class="cutin-name">${s.name}</div><div class="cutin-sub">${fighter.character.name}・${fighter.character.job}</div><div class="cutin-desc">${s.desc}</div></div></div>`;
    dom.stage.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    await session.wait(560);
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => el.remove(), 260);
    await session.wait(90);
  }

  /** Plays the 32-step, five-pose action sequence and triggers the impact at t ≈ 0.68. */
  async function playFiveFrameAction(side, s, hit = true) {
    const session = battle;
    const actor = dom.fighters[side];
    const layer = document.createElement('div');
    layer.className = 'sequence-layer';
    dom.stage.appendChild(layer);
    const poses = ['ready', 'charge', 'release', 'strike', 'recover'];
    const totalSteps = 32;
    const accent = fxColorForSkill(s);
    const fx = s.fx || '';
    let hitTriggered = false;
    animateActorMotion(side, s);
    if (/shadow|leaf|hammer|airhammer|note|bass/.test(fx)) spawnSpeedSweep(side, accent);
    if (/shadow|leaf|airhammer/.test(fx)) {
      const dir = side === 0 ? 1 : -1;
      session.later(() => spawnAfterimage(side, dir * 16, -2), 90);
      session.later(() => spawnAfterimage(side, dir * 42, -8), 150);
      session.later(() => spawnAfterimage(side, dir * 58, -10), 210);
    }
    for (let step = 0; step < totalSteps; step++) {
      const t = step / (totalSteps - 1);
      const frameIndex = Math.min(4, Math.floor(t * 5));
      actor.classList.remove(...FRAME_CLASSES);
      actor.classList.add(`frame-${frameIndex + 1}`);
      setPose(side, poses[frameIndex]);
      layer.innerHTML = `${effectFrameSVG(side, s, t, hit)}<div class="frame-callout">${s.name} · ${frameIndex + 1}/5</div>`;
      if (step === 6) spawnStageFlash(accent, side === 0 ? '24% 58%' : '76% 58%');
      if (!hitTriggered && hit && t >= 0.68 && !Engine.isSupport(s)) {
        hitTriggered = true;
        setPose(1 - side, 'hit');
        animateTargetMotion(1 - side, side);
        spawnImpactBurst(1 - side, accent, s.type === 'stun' ? 'BREAK' : '');
        spawnStageFlash(accent, side === 0 ? '76% 48%' : '24% 48%');
        shakeStage();
        await session.wait(28);
        session.later(() => { if (!session.state.ended) setPose(1 - side, 'idle'); }, 240);
      }
      if (frameIndex >= 3 && s.type === 'guard') setPose(side, 'guard');
      await session.wait(step === totalSteps - 1 ? 44 : 28);
    }
    actor.classList.remove(...FRAME_CLASSES);
    layer.remove();
    if (!session.state.ended) setPose(side, s.type === 'guard' ? 'guard' : 'idle');
  }

  function fxText(side, text, cls = 'damage') {
    spawnTransient(`fx fx-text ${cls}`, (el) => {
      el.textContent = text;
      el.style.left = side === 0 ? '23%' : '68%';
      el.style.top = '35%';
    }, 900);
  }

  function fxDamage(side, num, tag) {
    fxText(side, num < 0 ? `+${Math.abs(num)} ${tag}` : `-${num} ${tag}`, num < 0 ? 'heal' : tag === 'CRIT!' ? 'crit' : 'damage');
  }

  /* ================================================================== battle flow */
  function startBattle() {
    const c1 = CHARACTERS[app.selection[0]];
    const c2 = CHARACTERS[app.selection[1]];
    if (c1.id === c2.id && app.palettes[0] === app.palettes[1]) app.palettes[1] = 1 - app.palettes[0];
    if (battle) battle.dispose();
    clearFighterVisualState();
    battle = new BattleSession(Engine.createBattle({ characters: [c1, c2], palettes: app.palettes.slice() }));
    dom.selectScreen.classList.remove('active');
    dom.battleScreen.classList.add('active');
    dom.resultOverlay.classList.remove('show');
    dom.battleLog.innerHTML = '<h3>BATTLE LOG</h3>';
    renderBattle();
    beginRound();
  }

  function renderBattle() {
    const fighters = battle.state.fighters;
    fighters.forEach((f, i) => {
      const el = dom.fighters[i];
      el.dataset.char = f.character.id;
      el.innerHTML = `${fighterSVG(f.character, f.paletteIndex)}<div class="expression"><i></i><i></i><b></b></div><div class="pose-icon"></div><div class="nameplate">${f.character.name}・${f.character.job}</div>`;
      setPose(i, 'idle');
    });
    dom.hud[0].name.textContent = `1P ${fighters[0].character.name} / ${fighters[0].character.job}`;
    dom.hud[1].name.textContent = `${sideLabel(1)} ${fighters[1].character.name} / ${fighters[1].character.job}`;
    updateHUD();
    stageBanner('ROUND 1', 'FIGHT!');
  }

  function updateHUD() {
    battle.state.fighters.forEach((f, i) => {
      const h = dom.hud[i];
      const ratio = f.hp / f.maxHp;
      h.hp.style.width = `${Math.max(0, ratio * 100)}%`;
      h.mp.style.width = `${Math.max(0, (f.mp / f.maxMp) * 100)}%`;
      h.hpText.textContent = `HP ${Math.max(0, f.hp)} / ${f.maxHp}${f.shield ? ` +${f.shield}盾` : ''}`;
      h.mpText.textContent = `MP ${f.mp} / ${f.maxMp}`;
      dom.fighters[i].classList.toggle('low-hp', ratio > 0 && ratio < 0.3);
    });
    dom.roundLabel.textContent = `ROUND ${battle.state.round}`;
  }

  function beginRound() {
    const state = battle.state;
    if (state.ended) return;
    battle.locked = [null, null];
    battle.busy = false;
    Engine.startRound(state).forEach((ev) => {
      log(`${state.fighters[ev.side].character.name} 受到中毒傷害 ${ev.poison} 點。`);
      fxDamage(ev.side, ev.poison, '☠');
    });
    updateHUD();
    if (checkEnd()) return;
    setPose(0, 'idle');
    setPose(1, 'idle');
    if (state.round > 1) stageBanner(`ROUND ${state.round}`, 'FIGHT!');
    setPrompt(0);
    renderCommands(0);
  }

  function setPrompt(side) {
    dom.commandTitle.textContent = `${sideLabel(side)} 選擇行動`;
    dom.commandSub.textContent = app.mode === 'local' && side === 1 ? '請 1P 先不要偷看 2P 的選擇' : '技能會顯示 MP 消耗與效果';
    dom.waiting.classList.toggle('show', app.mode === 'local' && side === 1);
    dom.phaseLabel.textContent = 'COMMAND';
  }

  function renderCommands(side) {
    const f = battle.state.fighters[side];
    const box = dom.cmdGrid;
    box.innerHTML = '';
    if (f.stun) {
      box.innerHTML = '<button class="cmd" id="stunSkip"><b>失衡中</b><small>本回合無法行動，點擊繼續。</small></button>';
      $('#stunSkip').onclick = () => chooseAction(side, Engine.takeStunnedTurn(battle.state, side));
      return;
    }
    Engine.commandsFor(f, UTILITY_SKILLS).forEach((s) => {
      const b = document.createElement('button');
      b.className = 'cmd';
      b.disabled = battle.busy || f.mp < s.cost;
      b.innerHTML = `${s.cost ? `<span class="cost">${s.cost} MP</span>` : ''}<b>${s.name}</b><small>${s.desc}</small>`;
      b.onclick = () => chooseAction(side, s);
      box.appendChild(b);
    });
  }

  function chooseAction(side, skill) {
    if (!battle || battle.busy || battle.state.ended) return;
    battle.locked[side] = skill;
    log(`${sideLabel(side)} 已鎖定行動。`);
    if (side === 0) {
      if (app.mode === 'cpu') {
        battle.locked[1] = Engine.cpuChooseAction(battle.state, 1, UTILITY_SKILLS);
        resolveRound().catch(ignoreAbort);
      } else {
        setPrompt(1);
        renderCommands(1);
      }
    } else {
      resolveRound().catch(ignoreAbort);
    }
  }

  async function resolveRound() {
    const session = battle;
    const state = session.state;
    session.busy = true;
    dom.waiting.classList.remove('show');
    dom.cmdGrid.innerHTML = '<button class="cmd" disabled><b>結算中…</b><small>依速度與技能優先度處理</small></button>';
    dom.phaseLabel.textContent = 'RESOLVE';
    const order = Engine.resolveTurnOrder(state, session.locked);
    for (const side of order) {
      if (checkEnd()) break;
      await presentAction(side, session.locked[side]);
      await session.wait(180);
      updateHUD();
    }
    Engine.endRound(state);
    if (!checkEnd()) {
      await session.wait(250);
      beginRound();
    }
  }

  /** Resolves one command with the engine, then animates the outcome. */
  async function presentAction(side, skill) {
    const state = battle.state;
    const me = state.fighters[side];
    const op = state.fighters[1 - side];
    const outcome = Engine.resolveAction(state, side, skill);
    const s = skill;

    switch (outcome.kind) {
      case 'skip':
        log(`${me.character.name} 因失衡錯過行動。`);
        return;
      case 'focus':
        await playFiveFrameAction(side, s, true);
        log(`${me.character.name} 凝神，回復 ${outcome.mpGain} MP${outcome.hpGain ? `，並因被動回復 ${outcome.hpGain} HP` : ''}。`);
        fxDamage(side, -outcome.mpGain, '✦');
        if (outcome.hpGain) fxText(side, `+${outcome.hpGain} HP`, 'heal');
        return;
      case 'guard':
        await playFiveFrameAction(side, s, true);
        setPose(side, 'guard');
        log(`${me.character.name} 進入防禦架勢。`);
        return;
      case 'shield':
        if (Engine.isSuperSkill(s)) await showCutin(side, s);
        await playFiveFrameAction(side, s, true);
        log(`${me.character.name} 使用「${s.name}」，獲得 ${outcome.shieldGain} 點護盾${me.character.id === 'jelly' ? '（無骨重甲強化）' : ''}。`);
        fxDamage(side, -outcome.shieldGain, '🛡');
        return;
      case 'heal':
        if (Engine.isSuperSkill(s)) await showCutin(side, s);
        await playFiveFrameAction(side, s, true);
        log(`${me.character.name} 使用「${s.name}」，回復 ${outcome.hpGain} HP。`);
        fxText(side, `+${outcome.hpGain} HP`, 'heal');
        return;
      default:
        break;
    }

    if (Engine.isSuperSkill(s)) await showCutin(side, s);
    await playFiveFrameAction(side, s, outcome.hit);
    if (!outcome.hit) {
      spawnStageFlash('rgba(255,255,255,.16)', side === 0 ? '76% 48%' : '24% 48%');
      log(`${me.character.name} 的「${s.name}」落空！`);
      fxText(1 - side, 'MISS', 'miss');
      return;
    }
    log(`${me.character.name} 使用「${s.name}」造成 ${outcome.damage}${outcome.absorbed ? `（護盾吸收 ${outcome.absorbed}）` : ''} 點傷害${outcome.crit ? '，暴擊！' : ''}`);
    if (outcome.crit) spawnImpactBurst(1 - side, 'rgba(255,221,117,.56)', 'CRIT');
    fxDamage(1 - side, outcome.damage, outcome.crit ? 'CRIT!' : 'HIT!');
    if (outcome.statuses.includes('poison')) log(`${op.character.name} 中毒了，持續 3 回合。`);
    if (outcome.statuses.includes('weaken')) log(`${op.character.name} 的攻擊暫時下降。`);
    if (outcome.statuses.includes('slow')) log(`${op.character.name} 的速度暫時下降。`);
    if (outcome.statuses.includes('stun')) {
      log(`${op.character.name} 失衡！下回合無法行動。`);
      fxText(1 - side, 'STUN', 'crit');
    }
  }

  /** Detects K.O. once and plays the finishing presentation. */
  function checkEnd() {
    const state = battle.state;
    const winner = Engine.checkWinner(state);
    if (winner === null) return false;
    if (battle.koShown) return true;
    battle.koShown = true;
    battle.busy = true;
    const loser = 1 - winner;
    setPose(loser, 'ko');
    setPose(winner, 'victory');
    dom.phaseLabel.textContent = 'K.O.';
    cinematicStage(winner, 720, true);
    spawnStageFlash('rgba(255,108,112,.42)', '50% 48%');
    spawnImpactBurst(loser, 'rgba(255,108,112,.5)', 'K.O.');
    stageBanner('K.O.', '', true);
    shakeStage();
    battle.later(() => showResult(winner), 1220);
    return true;
  }

  function showResult(winner) {
    const w = battle.state.fighters[winner];
    $('#resultTitle').textContent = `${sideLabel(winner)} WIN!`;
    $('#resultText').textContent = `${w.character.name}・${w.character.job} 取得勝利，共進行 ${battle.state.round} 回合。`;
    dom.resultOverlay.classList.add('show');
  }

  function log(text) {
    const e = document.createElement('div');
    e.className = 'log-entry';
    e.textContent = `R${battle ? battle.state.round : 1}｜${text}`;
    dom.battleLog.appendChild(e);
    dom.battleLog.scrollTop = dom.battleLog.scrollHeight;
  }

  function backSelect() {
    if (battle) battle.dispose();
    clearFighterVisualState();
    dom.battleScreen.classList.remove('active');
    dom.selectScreen.classList.add('active');
    dom.resultOverlay.classList.remove('show');
    battle = null;
    renderAllSelect();
  }

  /* ================================================================== wiring */
  $$('.mode').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('#startBtn').onclick = startBattle;
  $('#rematchBtn').onclick = startBattle;
  $('#backBtn').onclick = backSelect;
  $('#btnReset').onclick = backSelect;
  $('#btnRef').onclick = () => dom.refOverlay.classList.add('show');
  $('#closeRef').onclick = () => dom.refOverlay.classList.remove('show');
  dom.refOverlay.addEventListener('click', (e) => { if (e.target === dom.refOverlay) dom.refOverlay.classList.remove('show'); });

  renderAllSelect();

  /** Read-only hooks for QA tooling and automated smoke tests. */
  BB.Game = Object.freeze({
    get state() { return battle ? battle.state : null; },
  });
})();
