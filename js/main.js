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
  const { fighterSVG, effectFrameArt } = BB.Sprites;
  const Audio = BB.Audio;
  const Settings = BB.Settings;

  /** Stereo position of each side for spatialised sound. */
  const pan = (side) => (side === 0 ? -0.45 : 0.45);

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
      this.tempo = 1;           // battle speed multiplier; all authored durations are divided by it
      this.pending = new Map(); // timer id -> reject fn (null for fire-and-forget callbacks)
      this.frames = new Set();  // rejecters of running rAF timelines
    }

    /** Resolves after `ms` (authored at 1x speed), or rejects with ABORTED if disposed first. */
    wait(ms) {
      return new Promise((resolve, reject) => {
        const id = setTimeout(() => { this.pending.delete(id); resolve(); }, ms / this.tempo);
        this.pending.set(id, reject);
      });
    }

    /** Runs `fn` after `ms` (authored at 1x speed) unless the session has been disposed. */
    later(fn, ms) {
      const id = setTimeout(() => { this.pending.delete(id); if (this.alive) fn(); }, ms / this.tempo);
      this.pending.set(id, null);
    }

    /**
     * Calls `onFrame(elapsed, control)` once per display frame until `duration` authored ms
     * have elapsed. `control.hold(ms)` freezes the clock (hit-stop). If the tab was hidden
     * (rAF paused), the timeline jumps straight to its end instead of replaying.
     */
    timeline(duration, onFrame) {
      return new Promise((resolve, reject) => {
        let elapsed = 0;
        let last = null;
        let holdUntil = 0;
        const control = { hold: (ms) => { holdUntil = Math.max(holdUntil, performance.now() + ms / this.tempo); } };
        const finish = () => { this.frames.delete(reject); resolve(); };
        const tick = (now) => {
          if (!this.alive) return;
          const dt = last === null ? 0 : now - last;
          last = now;
          if (dt > 250) elapsed = duration;
          else if (now >= holdUntil) elapsed = Math.min(duration, elapsed + dt * this.tempo);
          onFrame(elapsed, control);
          if (elapsed >= duration) finish();
          else requestAnimationFrame(tick);
        };
        this.frames.add(reject);
        requestAnimationFrame(tick);
      });
    }

    dispose() {
      this.alive = false;
      this.frames.forEach((reject) => reject(ABORTED));
      this.frames.clear();
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
    speedLabel: $('#speedLabel'),
    battleLog: $('#battleLog'),
    resultOverlay: $('#resultOverlay'),
    refOverlay: $('#refOverlay'),
    settingsOverlay: $('#settingsOverlay'),
    helpOverlay: $('#helpOverlay'),
    sequence: {
      layer: $('#sequenceLayer'),
      art: $('#sequenceArt'),
      callout: $('#frameCallout'),
    },
    hud: [1, 2].map((p) => ({
      name: $(`#p${p}HudName`),
      status: $(`#p${p}Status`),
      hpBar: $(`#p${p}HpBar`),
      mpBar: $(`#p${p}MpBar`),
      hp: $(`#p${p}Hp`),
      chip: $(`#p${p}HpChip`),
      shield: $(`#p${p}Shield`),
      mp: $(`#p${p}Mp`),
      hpText: $(`#p${p}HpTxt`),
      mpText: $(`#p${p}MpTxt`),
    })),
  };

  /* ------------------------------------------------------------------ app state */
  const params = new URLSearchParams(location.search);
  const MODES = ['cpu', 'local', 'demo'];
  const app = {
    mode: MODES.includes(params.get('mode')) ? params.get('mode') : 'cpu', // 'cpu' | 'local' | 'demo'
    selection: [0, 1],    // roster index per side
    palettes: [0, 0],     // palette index per side
    seed: params.has('seed') ? Number(params.get('seed')) >>> 0 : null, // reproducible battles (QA)
    speedOverride: [1, 1.5, 2, 4].includes(Number(params.get('speed'))) ? Number(params.get('speed')) : null,
  };

  /** Current battle session: engine state + UI-only flags. */
  let battle = null;

  /** Reflects the high-level game state on <html> for CSS hooks and automated tests. */
  function setGameState(name, extra = {}) {
    const ds = document.documentElement.dataset;
    ds.gameState = name;
    Object.entries(extra).forEach(([k, v]) => { ds[k] = String(v); });
  }

  const sideLabel = (side) => {
    if (app.mode === 'demo') return side === 0 ? 'CPU 1' : 'CPU 2';
    return side === 0 ? '1P' : app.mode === 'cpu' ? 'CPU' : '2P';
  };
  const isCpu = (side) => app.mode === 'demo' || (side === 1 && app.mode === 'cpu');
  const currentTempo = () => app.speedOverride || Settings.get('tempo');

  const TYPE_LABEL = {
    damage: '物理', magic: '魔法', pierce: '貫穿', stun: '失衡', slow: '減速', weaken: '削弱',
    heal: '治療', shield: '護盾', guard: '防禦', focus: '回復', poison: '中毒',
  };
  const STAT_MAX = ['hp', 'mp', 'atk', 'def', 'spd'].reduce((o, k) => ({ ...o, [k]: Math.max(...CHARACTERS.map((c) => c[k])) }), {});

  /* ================================================================== select */
  /** Builds the roster cards for one side (only needed when that side's palette changes). */
  function renderRoster(player) {
    const box = $(`#p${player}Roster`);
    const pi = app.palettes[player - 1];
    box.innerHTML = CHARACTERS.map((c, i) => `<button class="char-card" type="button" role="radio" data-index="${i}" aria-label="${c.name}・${c.animal}（${c.job}）"><div class="portrait">${fighterSVG(c, pi)}</div><h3>${c.name}・${c.animal}</h3><small>${c.job}</small></button>`).join('');
    syncRosterSelection(player);
  }

  function syncRosterSelection(player) {
    $$(`#p${player}Roster .char-card`).forEach((el, i) => {
      const on = app.selection[player - 1] === i;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on ? 0 : -1;
    });
  }

  function statBar(label, value, key) {
    const pct = Math.round((value / STAT_MAX[key]) * 100);
    return `<div class="stat"><div class="stat-head"><span>${label}</span><b>${value}</b></div><div class="stat-bar"><i style="--v:${pct}%"></i></div></div>`;
  }

  function renderDetail(player) {
    const c = CHARACTERS[app.selection[player - 1]];
    const pi = app.palettes[player - 1];
    const box = $(`#p${player}Detail`);
    const skills = c.skills.map((s) => `<li><span class="tag t-${s.type}">${TYPE_LABEL[s.type] || s.type}</span><b>${s.name}</b>${s.cost ? `<span class="cost-pill">${s.cost} MP</span>` : '<span class="cost-pill free">免費</span>'}<small>${s.desc}</small></li>`).join('');
    box.innerHTML = `<div class="big-portrait">${fighterSVG(c, pi)}</div><div class="detail"><div class="job">${c.job}</div><h3>${c.name}・${c.animal}</h3><div class="passive">${c.passive}</div><div class="stats">${statBar('HP', c.hp, 'hp')}${statBar('MP', c.mp, 'mp')}${statBar('ATK', c.atk, 'atk')}${statBar('DEF', c.def, 'def')}${statBar('SPD', c.spd, 'spd')}</div><ul class="skill-list">${skills}</ul><div class="palette-row"><span class="palette-label">異色造型</span><button class="palette ${pi === 0 ? 'active' : ''}" type="button" data-p="0" aria-pressed="${pi === 0}">COLOR A</button><button class="palette ${pi === 1 ? 'active' : ''}" type="button" data-p="1" aria-pressed="${pi === 1}">COLOR B</button></div></div>`;
  }

  /**
   * Mirror matches must not share a palette. `flipSide` is the side that gives way:
   * the side that just picked a character, or the other side after a palette click.
   * @returns {number[]} sides whose palette changed
   */
  function resolvePaletteClash(flipSide) {
    if (app.selection[0] !== app.selection[1] || app.palettes[0] !== app.palettes[1]) return [];
    app.palettes[flipSide] = 1 - app.palettes[1 - flipSide];
    return [flipSide];
  }

  function selectCharacter(player, index) {
    app.selection[player - 1] = index;
    if (resolvePaletteClash(player - 1).length) renderRoster(player);
    else syncRosterSelection(player);
    renderDetail(player);
  }

  function selectPalette(player, pi) {
    app.palettes[player - 1] = pi;
    const changed = resolvePaletteClash(player === 1 ? 1 : 0);
    [player - 1, ...changed].forEach((side) => { renderRoster(side + 1); renderDetail(side + 1); });
  }

  function renderAllSelect() {
    [1, 2].forEach((p) => { renderRoster(p); renderDetail(p); });
  }

  function setMode(mode) {
    app.mode = mode;
    $$('.mode').forEach((x) => {
      const on = x.dataset.mode === mode;
      x.classList.toggle('active', on);
      x.setAttribute('aria-pressed', String(on));
    });
    $('#p1Badge').textContent = mode === 'demo' ? 'CPU 1 / CYAN' : '1P / CYAN';
    $('#p2Badge').textContent = mode === 'cpu' ? 'CPU / MAGENTA' : mode === 'demo' ? 'CPU 2 / MAGENTA' : '2P / MAGENTA';
    $('#startBtn').textContent = mode === 'demo' ? 'WATCH! 開始觀戰' : 'FIGHT! 開始對戰';
  }

  function wireSelectScreen() {
    [1, 2].forEach((player) => {
      const roster = $(`#p${player}Roster`);
      roster.addEventListener('click', (e) => {
        const card = e.target.closest('.char-card');
        if (card) selectCharacter(player, Number(card.dataset.index));
      });
      // Arrow keys move through the radio group (roving tabindex).
      roster.addEventListener('keydown', (e) => {
        const delta = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }[e.key];
        if (delta === undefined) return;
        e.preventDefault();
        const next = (app.selection[player - 1] + delta + CHARACTERS.length) % CHARACTERS.length;
        selectCharacter(player, next);
        $(`#p${player}Roster .char-card[data-index="${next}"]`).focus();
      });
      $(`#p${player}Detail`).addEventListener('click', (e) => {
        const b = e.target.closest('.palette');
        if (b) selectPalette(player, Number(b.dataset.p));
      });
    });
    $$('[data-random]').forEach((b) => {
      b.onclick = () => {
        const player = Number(b.dataset.random);
        let next = Math.floor(Math.random() * CHARACTERS.length);
        if (next === app.selection[player - 1]) next = (next + 1) % CHARACTERS.length;
        selectCharacter(player, next);
      };
    });
    $$('.mode').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  }

  /* ================================================================== stage FX */
  const particles = BB.Particles.create(dom.stage, { anchor: (side) => fighterAnchor(side) });
  const touchFeedback = BB.TouchFeedback.create();

  const GUARD_BARRIER = '<div class="guard-barrier" aria-hidden="true"><svg viewBox="0 0 100 120"><path d="M50 4 L94 22 L90 70 Q80 100 50 116 Q20 100 10 70 L6 22Z" fill="rgba(150,225,255,.16)" stroke="rgba(205,240,255,.85)" stroke-width="4" stroke-linejoin="round"/><path d="M50 18 L80 30 L77 68 Q70 90 50 102 Q30 90 23 68 L20 30Z" fill="none" stroke="rgba(205,240,255,.35)" stroke-width="2"/></svg></div>';

  /** Applies quality / reduced-motion settings to CSS hooks and FX subsystems. */
  function applyVisualSettings() {
    const reduced = Settings.prefersReducedMotion();
    particles.setQuality(Settings.get('quality'));
    particles.setReducedMotion(reduced);
    touchFeedback.setReducedMotion(reduced);
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }
  Settings.subscribe((key) => { if (key === 'quality' || key === 'reducedMotion') applyVisualSettings(); });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.addEventListener) mq.addEventListener('change', applyVisualSettings);
  }
  const POSE_CLASSES = ['pose-idle', 'pose-ready', 'pose-charge', 'pose-release', 'pose-strike', 'pose-recover', 'pose-hit', 'pose-guard', 'pose-ko', 'pose-victory'];
  const FRAME_CLASSES = ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5'];
  const TRANSIENT_FX = '.fx,.stage-banner,.afterimage,.fx-flash,.speed-sweep,.impact-burst,.combo-tag,.cinematic-cutin';

  /** Last pose/frame class applied per side, so unchanged frames cost no style recalculation. */
  const currentPose = ['', ''];
  const currentFrame = [-1, -1];

  function clearFighterVisualState() {
    dom.fighters.forEach((el, side) => {
      el.classList.remove(...POSE_CLASSES, ...FRAME_CLASSES, 'low-hp', 'guarding', 'has-shield', 'shield-hit');
      el.removeAttribute('data-char');
      currentPose[side] = '';
      currentFrame[side] = -1;
    });
    $$(TRANSIENT_FX, dom.stage).forEach((el) => el.remove());
    dom.sequence.layer.hidden = true;
    dom.stage.classList.remove('shake', 'shake-heavy', 'zoom-left', 'zoom-right', 'ko-freeze', 'danger-left', 'danger-right');
  }

  function setPose(side, pose = 'idle') {
    if (currentPose[side] === pose) return;
    const el = dom.fighters[side];
    if (currentPose[side]) el.classList.remove(`pose-${currentPose[side]}`);
    el.classList.add(`pose-${pose}`);
    currentPose[side] = pose;
  }

  /** frameIndex 0..4 or -1 to clear. */
  function setFrame(side, frameIndex) {
    if (currentFrame[side] === frameIndex) return;
    const el = dom.fighters[side];
    if (currentFrame[side] >= 0) el.classList.remove(FRAME_CLASSES[currentFrame[side]]);
    if (frameIndex >= 0) el.classList.add(FRAME_CLASSES[frameIndex]);
    currentFrame[side] = frameIndex;
  }

  function restartClass(el, cls, duration) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), duration);
  }

  const reducedMotion = () => Settings.prefersReducedMotion();
  const highQuality = () => particles.quality === 'high';

  function shakeStage(heavy = false) {
    if (reducedMotion()) return;
    restartClass(dom.stage, heavy ? 'shake-heavy' : 'shake', heavy ? 340 : 240);
  }

  /** Fighter centre in stage units (1000×520), measured from the live layout. */
  function fighterAnchor(side) {
    const svg = dom.fighters[side].querySelector('svg');
    const s = dom.stage.getBoundingClientRect();
    if (!svg || !s.width) return { x: side === 0 ? 270 : 730, y: 300 };
    const r = svg.getBoundingClientRect();
    return { x: ((r.left + r.width / 2 - s.left) / s.width) * 1000, y: ((r.top + r.height * 0.55 - s.top) / s.height) * 520 };
  }

  function announceRound(n) {
    stageBanner(`ROUND ${n}`, 'FIGHT!');
    Audio.sfx('round');
    if (battle) battle.later(() => Audio.sfx('fight'), 320);
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
    if (reducedMotion()) return;
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
    if (!highQuality() || reducedMotion()) return;
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
    Audio.sfx('cutin', { pan: pan(side) });
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

  const ACTION_STEPS = 32;          // in-between frames per action
  const ACTION_STEP_MS = 28;        // authored duration of one step at 1x speed
  const ACTION_DURATION = (ACTION_STEPS - 1) * ACTION_STEP_MS + 44;
  const ACTION_POSES = ['ready', 'charge', 'release', 'strike', 'recover'];

  /**
   * Plays the five-pose, 32-step action sequence on a requestAnimationFrame timeline and
   * triggers the impact at t ≈ 0.68. The effect SVG and callout are persistent nodes that
   * are only updated when the step changes (V9 rebuilt the whole <svg> 32 times per action).
   */
  async function playFiveFrameAction(side, s, hit = true, outcome = null) {
    const session = battle;
    const { layer, art, callout } = dom.sequence;
    const accent = fxColorForSkill(s);
    const fx = s.fx || '';
    const support = Engine.isSupport(s);
    const projectile = /ember|fireball|water|note|bass|electric|wind/.test(fx);
    const from = fighterAnchor(side);
    const to = fighterAnchor(1 - side);
    const heavy = /meteor|shockwave|hammerquake|hammer|airhammer|fireball/.test(fx) || s.type === 'stun';
    let auraShown = false;
    let lastStep = -1;
    let flashed = false;
    let hitTriggered = false;

    animateActorMotion(side, s);
    Audio.skill(s, 'cast', { pan: pan(side) });
    if (/shadow|leaf|hammer|airhammer|note|bass/.test(fx)) spawnSpeedSweep(side, accent);
    if (/shadow|leaf|airhammer/.test(fx)) {
      const dir = side === 0 ? 1 : -1;
      session.later(() => spawnAfterimage(side, dir * 16, -2), 90);
      session.later(() => spawnAfterimage(side, dir * 42, -8), 150);
      session.later(() => spawnAfterimage(side, dir * 58, -10), 210);
    }
    layer.hidden = false;

    await session.timeline(ACTION_DURATION, (elapsed, control) => {
      const step = Math.min(ACTION_STEPS - 1, Math.floor(elapsed / ACTION_STEP_MS));
      if (step === lastStep) return;
      lastStep = step;
      const t = step / (ACTION_STEPS - 1);
      const frameIndex = Math.min(4, Math.floor(t * 5));
      if (currentFrame[side] !== frameIndex) {
        setFrame(side, frameIndex);
        callout.textContent = `${s.name} · ${frameIndex + 1}/5`;
        callout.animate(FRAME_FLASH, { duration: 160, easing: 'ease' });
      }
      setPose(side, s.type === 'guard' && frameIndex >= 3 ? 'guard' : ACTION_POSES[frameIndex]);
      art.innerHTML = effectFrameArt(side, s, t, hit);
      if (projectile && t > 0.1 && t < 0.7) particles.trail(fx, from.x + (to.x - from.x) * (t / 0.7), from.y - 10);
      if (support && !auraShown && t >= 0.5) {
        auraShown = true;
        particles.aura(fx, side);
      }
      if (!flashed && step >= 6) {
        flashed = true;
        spawnStageFlash(accent, side === 0 ? '24% 58%' : '76% 58%');
      }
      if (!hitTriggered && hit && t >= 0.68 && !support) {
        hitTriggered = true;
        setPose(1 - side, 'hit');
        animateTargetMotion(1 - side, side);
        spawnImpactBurst(1 - side, accent, s.type === 'stun' ? 'BREAK' : '');
        Audio.skill(s, 'impact', { pan: pan(1 - side), crit: !!(outcome && outcome.crit) });
        const crit = !!(outcome && outcome.crit);
        particles.impact(fx, 1 - side, { crit, heavy });
        spawnStageFlash(crit ? 'rgba(255,244,210,.62)' : accent, side === 0 ? '76% 48%' : '24% 48%');
        shakeStage(crit || heavy);
        control.hold(crit ? 110 : heavy ? 70 : 40); // hit-stop sells the impact
        session.later(() => { if (!session.state.ended) setPose(1 - side, 'idle'); }, 240);
      }
    });

    setFrame(side, -1);
    layer.hidden = true;
    art.textContent = '';
    if (!session.state.ended) setPose(side, s.type === 'guard' ? 'guard' : 'idle');
  }

  const FRAME_FLASH = [
    { opacity: 0.25, transform: 'translateX(-50%) scale(.92)' },
    { opacity: 1, transform: 'translateX(-50%) scale(1)' },
  ];

  /** Floating combat text; `row` stacks simultaneous popups so they never overlap. */
  function fxText(side, text, cls = 'damage', row = 0) {
    spawnTransient(`fx fx-text ${cls}`, (el) => {
      el.textContent = text;
      el.style.left = side === 0 ? '22%' : '67%';
      el.style.top = `${33 - row * 8}%`;
    }, 900);
  }

  function fxDamage(side, num, tag) {
    fxText(side, num < 0 ? `+${Math.abs(num)} ${tag}` : `-${num} ${tag}`, num < 0 ? 'heal' : tag === 'CRIT!' ? 'crit' : 'damage');
  }

  /* ================================================================== battle flow */
  function startBattle() {
    closeAllOverlays();
    const c1 = CHARACTERS[app.selection[0]];
    const c2 = CHARACTERS[app.selection[1]];
    if (c1.id === c2.id && app.palettes[0] === app.palettes[1]) app.palettes[1] = 1 - app.palettes[0];
    if (battle) battle.dispose();
    clearFighterVisualState();
    const rng = app.seed !== null ? Engine.createRng(app.seed) : Math.random;
    battle = new BattleSession(Engine.createBattle({ characters: [c1, c2], palettes: app.palettes.slice(), rng }));
    battle.tempo = currentTempo();
    syncSpeedBadge();
    Audio.music('battle');
    particles.clear();
    particles.setAmbient(true);
    dom.selectScreen.classList.remove('active');
    dom.battleScreen.classList.add('active');
    dom.battleLog.innerHTML = '<h3>BATTLE LOG</h3>';
    setGameState('battle', { mode: app.mode });
    renderBattle();
    beginRound();
  }

  function renderBattle() {
    const fighters = battle.state.fighters;
    fighters.forEach((f, i) => {
      const el = dom.fighters[i];
      el.dataset.char = f.character.id;
      el.innerHTML = `<div class="shield-bubble" aria-hidden="true"></div>${fighterSVG(f.character, f.paletteIndex)}${GUARD_BARRIER}<div class="expression"><i></i><i></i><b></b></div><div class="pose-icon"></div><div class="nameplate">${f.character.name}・${f.character.job}</div>`;
      setPose(i, 'idle');
      const h = dom.hud[i];
      h.name.textContent = `${sideLabel(i)} ${f.character.name} / ${f.character.job}`;
      h.hpBar.setAttribute('aria-label', `${sideLabel(i)} HP`);
      h.mpBar.setAttribute('aria-label', `${sideLabel(i)} MP`);
      h.hpBar.setAttribute('aria-valuemax', f.maxHp);
      h.mpBar.setAttribute('aria-valuemax', f.maxMp);
    });
    updateHUD();
    announceRound(1);
  }

  const STATUS_CHIPS = [
    { test: (f) => f.shield > 0, cls: 'st-shield', text: (f) => `🛡 ${f.shield}`, title: (f) => `護盾：先吸收 ${f.shield} 點傷害` },
    { test: (f) => f.guard, cls: 'st-guard', text: () => '防禦', title: () => '本回合承受傷害 -45%' },
    { test: (f) => f.weaken > 0, cls: 'st-debuff', text: (f) => `攻↓${f.weaken}`, title: (f) => `攻擊 -20%，剩 ${f.weaken} 回合` },
    { test: (f) => f.slow > 0, cls: 'st-debuff', text: (f) => `速↓${f.slow}`, title: (f) => `速度 -3，剩 ${f.slow} 回合` },
    { test: (f) => f.stun, cls: 'st-stun', text: () => '失衡', title: () => '下回合無法行動' },
    { test: (f) => f.poison > 0, cls: 'st-debuff', text: (f) => `毒${f.poison}`, title: (f) => `每回合 -5 HP，剩 ${f.poison} 回合` },
  ];

  function updateHUD() {
    const ended = battle.state.ended;
    battle.state.fighters.forEach((f, i) => {
      const h = dom.hud[i];
      const ratio = Math.max(0, f.hp / f.maxHp);
      h.hp.style.transform = `scaleX(${ratio})`;
      h.chip.style.transform = `scaleX(${ratio})`;
      h.shield.style.transform = `scaleX(${Math.min(1, f.shield / f.maxHp)})`;
      h.mp.style.transform = `scaleX(${Math.max(0, f.mp / f.maxMp)})`;
      h.hpBar.dataset.level = ratio > 0.5 ? 'high' : ratio > 0.25 ? 'mid' : 'low';
      h.hpBar.setAttribute('aria-valuenow', Math.max(0, f.hp));
      h.mpBar.setAttribute('aria-valuenow', f.mp);
      h.hpText.textContent = `HP ${Math.max(0, f.hp)} / ${f.maxHp}`;
      h.mpText.textContent = `MP ${f.mp} / ${f.maxMp}`;
      const chips = ended ? [] : STATUS_CHIPS.filter((c) => c.test(f));
      const html = chips.map((c) => `<span class="status ${c.cls}" title="${c.title(f)}">${c.text(f)}</span>`).join('');
      if (h.status.innerHTML !== html) h.status.innerHTML = html;
      const el = dom.fighters[i];
      el.classList.toggle('low-hp', ratio > 0 && ratio < 0.3);
      el.classList.toggle('has-shield', f.shield > 0 && !ended);
      el.style.setProperty('--shield', Math.min(1, f.shield / 50).toFixed(2));
      el.classList.toggle('guarding', f.guard && !ended);
      dom.stage.classList.toggle(i === 0 ? 'danger-left' : 'danger-right', ratio > 0 && ratio < 0.3);
    });
    dom.roundLabel.textContent = `ROUND ${battle.state.round}`;
  }

  function syncSpeedBadge() {
    const tempo = battle ? battle.tempo : currentTempo();
    dom.speedLabel.hidden = tempo === 1;
    dom.speedLabel.textContent = `${tempo}× SPEED`;
  }

  function beginRound() {
    const session = battle;
    const state = session.state;
    if (state.ended) return;
    session.locked = [null, null];
    session.busy = false;
    Engine.startRound(state).forEach((ev) => {
      log(`${state.fighters[ev.side].character.name} 受到中毒傷害 ${ev.poison} 點。`, 'dmg');
      fxDamage(ev.side, ev.poison, '☠');
    });
    updateHUD();
    if (checkEnd()) return;
    setPose(0, 'idle');
    setPose(1, 'idle');
    if (state.round > 1) announceRound(state.round);
    if (app.mode === 'demo') {
      showSpectatorPanel();
      session.later(() => chooseAction(0, Engine.cpuChooseAction(state, 0, UTILITY_SKILLS)), 650);
      return;
    }
    setPrompt(0);
    renderCommands(0);
  }

  function showSpectatorPanel() {
    dom.commandTitle.textContent = 'CPU 觀戰模式';
    dom.commandSub.textContent = '雙方由 CPU 操作；可在設定調整戰鬥速度';
    dom.waiting.classList.remove('show');
    dom.phaseLabel.textContent = 'COMMAND';
    dom.cmdGrid.innerHTML = '<div class="cmd-note">CPU 思考中…</div>';
  }

  function setPrompt(side) {
    dom.commandTitle.textContent = `${sideLabel(side)} 選擇行動`;
    dom.commandSub.textContent = app.mode === 'local' && side === 1 ? '請 1P 先不要偷看 2P 的選擇' : '點選或按數字鍵 1–5；技能會顯示 MP 消耗與效果';
    dom.waiting.classList.toggle('show', app.mode === 'local' && side === 1);
    dom.phaseLabel.textContent = 'COMMAND';
    dom.cmdGrid.dataset.side = String(side);
  }

  function commandMeta(s) {
    if (s.type === 'heal') return `回復 ${s.power} HP`;
    if (s.type === 'shield') return `護盾 ${s.power}`;
    if (s.power && !Engine.isSupport(s)) return `威力 ${s.power} · 命中 ${s.acc}%`;
    return '';
  }

  function renderCommands(side) {
    const f = battle.state.fighters[side];
    const box = dom.cmdGrid;
    if (f.stun) {
      box.innerHTML = '<button class="cmd stun-skip" id="stunSkip" type="button"><span class="key">Enter</span><b>失衡中</b><small>本回合無法行動，點擊或按 Enter 繼續。</small></button>';
      $('#stunSkip').onclick = () => chooseAction(side, Engine.takeStunnedTurn(battle.state, side));
      return;
    }
    box.innerHTML = '';
    Engine.commandsFor(f, UTILITY_SKILLS).forEach((s, i) => {
      const b = document.createElement('button');
      const short = f.mp < s.cost;
      const meta = commandMeta(s);
      b.type = 'button';
      b.className = `cmd t-${s.type}${Engine.isSuperSkill(s) ? ' super' : ''}`;
      b.disabled = battle.busy || short;
      b.dataset.key = String(i + 1);
      b.innerHTML = `<span class="key" aria-hidden="true">${i + 1}</span>${s.cost ? `<span class="cost">${s.cost} MP</span>` : ''}<span class="tag t-${s.type}">${TYPE_LABEL[s.type] || ''}</span><b>${s.name}</b><small>${s.desc}</small>${meta ? `<em class="meta">${meta}</em>` : ''}${short ? '<em class="short">MP 不足</em>' : ''}`;
      b.setAttribute('aria-label', `${i + 1}. ${s.name}${s.cost ? `，消耗 ${s.cost} MP` : ''}。${s.desc}${short ? '（MP 不足）' : ''}`);
      b.onclick = () => chooseAction(side, s);
      box.appendChild(b);
    });
  }

  function chooseAction(side, skill) {
    if (!battle || battle.busy || battle.state.ended) return;
    battle.locked[side] = skill;
    log(`${sideLabel(side)} 已鎖定行動。`, 'sys');
    if (side === 0) {
      if (isCpu(1)) {
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
    dom.cmdGrid.innerHTML = '<div class="cmd-note">結算中…依速度與技能優先度處理</div>';
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
    const session = battle;
    const state = session.state;
    const me = state.fighters[side];
    const op = state.fighters[1 - side];
    const outcome = Engine.resolveAction(state, side, skill);
    const s = skill;
    if (outcome.shieldDecay) {
      log(`${me.character.name} 的護盾流失 ${outcome.shieldDecay} 點。`, 'sys');
      updateHUD();
    }

    switch (outcome.kind) {
      case 'skip':
        log(`${me.character.name} 因失衡錯過行動。`, 'sys');
        fxText(side, 'STUN…', 'miss');
        return;
      case 'focus':
        await playFiveFrameAction(side, s, true);
        log(`${me.character.name} 凝神，回復 ${outcome.mpGain} MP${outcome.hpGain ? `，並因被動回復 ${outcome.hpGain} HP` : ''}。`, 'buff');
        fxText(side, `+${outcome.mpGain} MP`, 'mp');
        if (outcome.hpGain) session.later(() => fxText(side, `+${outcome.hpGain} HP`, 'heal', 1), 160);
        return;
      case 'guard':
        await playFiveFrameAction(side, s, true);
        setPose(side, 'guard');
        updateHUD();
        log(`${me.character.name} 進入防禦架勢。`, 'buff');
        return;
      case 'shield':
        if (Engine.isSuperSkill(s)) await showCutin(side, s);
        await playFiveFrameAction(side, s, true);
        updateHUD();
        log(`${me.character.name} 使用「${s.name}」，獲得 ${outcome.shieldGain} 點護盾${me.character.id === 'jelly' ? '（無骨重甲強化）' : ''}。`, 'buff');
        fxText(side, `+${outcome.shieldGain} 🛡`, 'shield');
        return;
      case 'heal':
        if (Engine.isSuperSkill(s)) await showCutin(side, s);
        await playFiveFrameAction(side, s, true);
        log(`${me.character.name} 使用「${s.name}」，回復 ${outcome.hpGain} HP。`, 'heal');
        fxText(side, `+${outcome.hpGain} HP`, 'heal');
        return;
      default:
        break;
    }

    if (Engine.isSuperSkill(s)) await showCutin(side, s);
    await playFiveFrameAction(side, s, outcome.hit, outcome);
    if (!outcome.hit) {
      Audio.skill(s, 'miss', { pan: pan(1 - side) });
      spawnStageFlash('rgba(255,255,255,.16)', side === 0 ? '76% 48%' : '24% 48%');
      log(`${me.character.name} 的「${s.name}」落空！`, 'sys');
      fxText(1 - side, 'MISS', 'miss');
      return;
    }
    if (outcome.chargeSpent) {
      log(`${me.character.name} 釋放蓄電護盾 ${outcome.chargeSpent} 點，追加 ${outcome.chargeBonus} 點傷害！`, 'buff');
      updateHUD();
    }
    log(`${me.character.name} 使用「${s.name}」造成 ${outcome.damage}${outcome.absorbed ? `（護盾吸收 ${outcome.absorbed}）` : ''} 點傷害${outcome.crit ? '，暴擊！' : ''}`, outcome.crit ? 'crit' : 'dmg');
    if (outcome.crit) spawnImpactBurst(1 - side, 'rgba(255,221,117,.56)', 'CRIT');
    if (outcome.absorbed) {
      const a = fighterAnchor(1 - side);
      particles.ring(a.x, a.y, '#bdf3ff', 60, 120, 0.4, 5);
      restartClass(dom.fighters[1 - side], 'shield-hit', 360);
    }
    if (outcome.damage > 0) fxText(1 - side, `-${outcome.damage}${outcome.crit ? ' CRIT!' : ''}`, outcome.crit ? 'crit' : 'damage');
    if (outcome.absorbed) fxText(1 - side, outcome.damage > 0 ? `🛡 -${outcome.absorbed}` : `🛡 BLOCK ${outcome.absorbed}`, 'shield', outcome.damage > 0 ? 1 : 0);
    if (outcome.statuses.includes('poison')) log(`${op.character.name} 中毒了，持續 3 回合。`, 'debuff');
    if (outcome.statuses.includes('weaken')) log(`${op.character.name} 的攻擊暫時下降。`, 'debuff');
    if (outcome.statuses.includes('slow')) log(`${op.character.name} 的速度暫時下降。`, 'debuff');
    if (outcome.statuses.includes('stun')) {
      log(`${op.character.name} 失衡！下回合無法行動。`, 'debuff');
      session.later(() => fxText(1 - side, 'STUN!', 'crit', 2), 120);
      Audio.sfx('stun', { pan: pan(1 - side) });
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
    dom.cmdGrid.innerHTML = '<div class="cmd-note">K.O.！</div>';
    cinematicStage(winner, 720, true);
    spawnStageFlash('rgba(255,108,112,.42)', '50% 48%');
    spawnImpactBurst(loser, 'rgba(255,108,112,.5)', 'K.O.');
    particles.ko(loser);
    updateHUD();
    battle.later(() => particles.confetti(winner), 900);
    stageBanner('K.O.', '', true);
    Audio.sfx('ko');
    battle.later(() => Audio.music('victory'), 900);
    shakeStage(true);
    battle.later(() => showResult(winner), 1220);
    return true;
  }

  const RESULT_ROWS = [
    ['總傷害', 'damageDealt'], ['最大一擊', 'biggestHit'], ['暴擊', 'crits'], ['落空', 'misses'], ['治療', 'healed'], ['護盾', 'shielded'],
  ];

  function showResult(winner) {
    const state = battle.state;
    const w = state.fighters[winner];
    const l = state.fighters[1 - winner];
    const [s0, s1] = state.stats;
    const title = $('#resultTitle');
    title.textContent = `${sideLabel(winner)} WIN!`;
    title.className = winner === 0 ? 'p1-win' : 'p2-win';
    $('#resultText').textContent = `${w.character.name}・${w.character.job} 擊敗 ${l.character.name}，共進行 ${state.round} 回合，剩餘 HP ${w.hp} / ${w.maxHp}。`;
    $('#resultPortrait').innerHTML = fighterSVG(w.character, w.paletteIndex);
    const head = `<tr><th scope="col"></th><th scope="col" class="p1c">${sideLabel(0)} ${state.fighters[0].character.name}</th><th scope="col" class="p2c">${sideLabel(1)} ${state.fighters[1].character.name}</th></tr>`;
    const body = RESULT_ROWS.map(([label, key]) => `<tr><th scope="row">${label}</th><td class="${key !== 'misses' && s0[key] > s1[key] ? 'lead' : ''}">${s0[key]}</td><td class="${key !== 'misses' && s1[key] > s0[key] ? 'lead' : ''}">${s1[key]}</td></tr>`).join('');
    $('#resultStats').innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    setGameState('result', { winner, rounds: state.round });
    openOverlay(dom.resultOverlay, $('#rematchBtn'));
  }

  const LOG_LIMIT = 80;

  /** @param {string} text @param {''|'sys'|'dmg'|'crit'|'heal'|'buff'|'debuff'} [kind] */
  function log(text, kind = '') {
    const e = document.createElement('div');
    e.className = `log-entry${kind ? ` log-${kind}` : ''}`;
    e.textContent = `R${battle ? battle.state.round : 1}｜${text}`;
    dom.battleLog.appendChild(e);
    const entries = dom.battleLog.getElementsByClassName('log-entry');
    if (entries.length > LOG_LIMIT) entries[0].remove();
    dom.battleLog.scrollTop = dom.battleLog.scrollHeight;
  }

  function backSelect() {
    if (battle) battle.dispose();
    closeAllOverlays();
    clearFighterVisualState();
    dom.battleScreen.classList.remove('active');
    dom.selectScreen.classList.add('active');
    battle = null;
    particles.setAmbient(false);
    particles.clear();
    Audio.music('select');
    setGameState('select');
    renderAllSelect();
  }

  /* ================================================================== overlays */
  const OVERLAYS = () => [dom.resultOverlay, dom.refOverlay, dom.settingsOverlay, dom.helpOverlay];
  const overlayStack = [];

  /** Opens a modal dialog, remembers the trigger and moves focus inside. */
  function openOverlay(el, focusEl) {
    if (!el.classList.contains('show')) {
      overlayStack.push({ el, returnTo: document.activeElement });
      el.classList.add('show');
    }
    const target = focusEl || el.querySelector('button, input, a[href]');
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 30);
  }

  function closeOverlay(el) {
    if (!el.classList.contains('show')) return;
    el.classList.remove('show');
    const i = overlayStack.findIndex((o) => o.el === el);
    const entry = i >= 0 ? overlayStack.splice(i, 1)[0] : null;
    if (entry && entry.returnTo && document.contains(entry.returnTo)) entry.returnTo.focus({ preventScroll: true });
  }

  function closeAllOverlays() {
    OVERLAYS().forEach((el) => el.classList.remove('show'));
    overlayStack.length = 0;
  }

  const topOverlay = () => (overlayStack.length ? overlayStack[overlayStack.length - 1].el : null);

  /** Keeps Tab focus inside the open dialog. */
  function trapFocus(e) {
    const el = topOverlay();
    if (!el || e.key !== 'Tab') return;
    const items = $$('button:not([disabled]), input:not([disabled]), a[href]', el).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------------ settings panel */
  function syncSettingsForm() {
    $$('[data-setting]', dom.settingsOverlay).forEach((input) => {
      const key = input.dataset.setting;
      const value = Settings.get(key);
      if (input.type === 'range') {
        input.value = Math.round(value * 100);
        input.nextElementSibling.textContent = `${input.value}%`;
      } else if (input.type === 'checkbox') {
        input.checked = !!value;
      } else if (input.type === 'radio') {
        input.checked = String(value) === input.value;
      }
    });
  }

  function wireSettings() {
    dom.settingsOverlay.addEventListener('input', (e) => {
      const input = e.target.closest('[data-setting]');
      if (!input) return;
      const key = input.dataset.setting;
      if (input.type === 'range') Settings.set(key, Number(input.value) / 100);
      else if (input.type === 'checkbox') Settings.set(key, input.checked);
      else if (input.type === 'radio' && input.checked) Settings.set(key, key === 'tempo' ? Number(input.value) : input.value);
    });
    $('#resetSettings').onclick = () => Settings.reset();
    $('#closeSettings').onclick = () => closeOverlay(dom.settingsOverlay);
    Settings.subscribe((key) => {
      syncSettingsForm();
      if (key === 'tempo' && battle && !app.speedOverride) {
        battle.tempo = Settings.get('tempo');
        syncSpeedBadge();
      }
    });
    syncSettingsForm();
  }

  /* ------------------------------------------------------------------ keyboard */
  function onKeyDown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    trapFocus(e);
    const typing = e.target.matches && e.target.matches('input[type="range"], input[type="text"]');
    const open = topOverlay();
    if (e.key === 'Escape') {
      if (open && open !== dom.resultOverlay) { e.preventDefault(); closeOverlay(open); }
      return;
    }
    if (typing) return;
    const key = e.key.toLowerCase();
    if (key === 'm') { Settings.set('muted', !Settings.get('muted')); return; }
    if (key === 's' && !open) { syncSettingsForm(); openOverlay(dom.settingsOverlay); return; }
    if ((e.key === '?' || key === 'h') && !open) { openOverlay(dom.helpOverlay); return; }
    if (open === dom.resultOverlay && e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); $('#rematchBtn').click(); return; }
    if (open) return;

    if (dom.selectScreen.classList.contains('active')) {
      if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); $('#startBtn').click(); }
      return;
    }
    if (!battle || battle.busy || battle.state.ended) return;
    const stun = $('#stunSkip');
    if (stun && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); stun.click(); return; }
    if (/^[1-5]$/.test(e.key)) {
      const btn = dom.cmdGrid.querySelector(`.cmd[data-key="${e.key}"]`);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      else if (btn) Audio.sfx('ui-error');
    }
  }

  /* ================================================================== wiring */
  wireSelectScreen();
  wireSettings();
  $('#startBtn').onclick = startBattle;
  $('#rematchBtn').onclick = startBattle;
  $('#backBtn').onclick = backSelect;
  $('#btnReset').onclick = backSelect;
  $('#btnRef').onclick = () => openOverlay(dom.refOverlay);
  $('#closeRef').onclick = () => closeOverlay(dom.refOverlay);
  $('#btnSettings').onclick = () => { syncSettingsForm(); openOverlay(dom.settingsOverlay); };
  $('#btnHelp').onclick = () => openOverlay(dom.helpOverlay);
  $('#closeHelp').onclick = () => closeOverlay(dom.helpOverlay);
  [dom.refOverlay, dom.settingsOverlay, dom.helpOverlay].forEach((el) => {
    el.addEventListener('click', (e) => { if (e.target === el) closeOverlay(el); });
  });
  document.addEventListener('keydown', onKeyDown);

  /* ------------------------------------------------------------------ audio wiring */
  Audio.init(Settings);
  Audio.music('select');
  ['pointerdown', 'keydown', 'touchend'].forEach((type) =>
    document.addEventListener(type, () => Audio.unlock(), { capture: true, passive: true }));

  /** Interface sounds, delegated so every current and future button gets them. */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.matches('.char-card, .palette, .mode, [data-random]')) Audio.sfx('ui-select');
    else if (btn.matches('#startBtn, #rematchBtn')) Audio.sfx('ui-confirm');
    else if (btn.matches('#backBtn, #btnReset, #closeRef, #closeHelp, #closeSettings')) Audio.sfx('ui-back');
    else if (btn.matches('#btnMute')) Audio.sfx('ui-toggle');
    else Audio.sfx('ui-click');
  }, true);
  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest('.char-card, .cmd:not(:disabled), .mode, .cta, .ghost, .palette, .mini');
    if (!el || el.contains(e.relatedTarget)) return;
    const now = performance.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    Audio.sfx('ui-hover');
  });

  const muteBtn = $('#btnMute');
  function syncMuteButton() {
    const muted = Settings.get('muted');
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? '開啟聲音' : '關閉聲音');
    muteBtn.textContent = muted ? '🔇' : '🔊';
  }
  muteBtn.onclick = () => Settings.set('muted', !Settings.get('muted'));
  Settings.subscribe((key) => { if (key === 'muted') syncMuteButton(); });
  syncMuteButton();
  applyVisualSettings();

  setMode(app.mode);
  renderAllSelect();
  setGameState('select');
  if (params.get('autostart') === '1') startBattle();

  /** Read-only hooks for QA tooling and automated smoke tests. */
  BB.Game = Object.freeze({
    get state() { return battle ? battle.state : null; },
    get mode() { return app.mode; },
  });
})();
