/**
 * Beast Brawl — combat engine.
 *
 * Pure, DOM-free rules: fighter creation, turn order, action resolution, status effects,
 * win detection and the CPU opponent. The presentation layer (js/main.js) asks the engine
 * for an outcome first and then animates it, so rules stay deterministic and unit-testable.
 *
 * Randomness always goes through `state.rng` (defaults to Math.random). Pass a seeded RNG
 * from `createRng(seed)` for reproducible battles in tests and replays.
 *
 * Exposed as window.BeastBrawl.Engine in the browser and via module.exports in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BeastBrawl = root.BeastBrawl || {}).Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Tunable rule constants. Changing any of these changes game balance. */
  const RULES = Object.freeze({
    guardPriority: 20,          // speed bonus that makes "防禦" resolve first
    guardDamageMultiplier: 0.55,
    focusMpGain: 14,
    orcaFocusHeal: 6,
    baseCritChance: 0.08,
    critMultiplier: 1.5,
    minDamage: 3,
    attackScale: 0.72,
    defenseScale: 0.63,
    magicDefenseFactor: 0.32,
    pierceDefenseFactor: 0.2,
    weakenAttackFactor: 0.8,
    slowSpeedPenalty: 3,
    speedJitter: 3,             // + rng() * 3 on every speed roll
    damageJitterRange: 5,       // + rng() * 5 - 2 on every hit
    damageJitterOffset: -2,
    poisonDamage: 5,
    poisonTurns: 3,
    weakenTurns: 2,
    slowTurns: 2,
    jellyShieldMultiplier: 1.2,
    jellyShieldDecay: 0.1,      // jelly's leftover shield loses 10% (rounded up) each time it acts again
    jellyChargeSpend: 0.5,      // on a landed jelly attack, this share of its shield is spent...
    jellyChargeDamage: 0.5,     // ...and this share of the spent shield becomes flat bonus damage
  });

  /** Command types that never target the opponent. */
  const SUPPORT_TYPES = Object.freeze(['guard', 'shield', 'heal', 'focus']);
  /** Command types the CPU treats as finishers when the opponent is low. */
  const OFFENSIVE_TYPES = Object.freeze(['damage', 'magic', 'pierce', 'poison', 'stun', 'weaken', 'slow']);
  /** Effects that always get the cinematic cut-in. */
  const SUPER_FX = Object.freeze(['meteor', 'bass', 'bubble', 'hammerquake', 'airhammer', 'shockwave']);

  /** The pseudo-command used when a fighter is staggered. */
  const SKIP_ACTION = Object.freeze({ id: 'skip', name: '失衡', cost: 0, type: 'skip' });

  /**
   * Mulberry32 — tiny, fast, seedable PRNG returning floats in [0, 1).
   * @param {number} seed
   * @returns {() => number}
   */
  function createRng(seed) {
    let a = seed >>> 0;
    return function rng() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Damage multipliers from character passives. Order matters for float rounding parity. */
  const PASSIVE_POWER = [
    { id: 'bear', applies: (ctx) => ctx.me.hp / ctx.me.maxHp < 0.5, multiplier: 1.12 },
    { id: 'elephant', applies: (ctx) => ctx.skill.id !== 'basic', multiplier: 1.08 },
    { id: 'panda', applies: (ctx) => ctx.wentFirst, multiplier: 1.12 },
    { id: 'hummingbird', applies: (ctx) => ctx.me.hp / ctx.me.maxHp < 0.35, multiplier: 1.18 },
  ];

  function createFighter(character, paletteIndex, side) {
    return {
      character,
      paletteIndex,
      side,
      hp: character.hp,
      mp: character.mp,
      maxHp: character.hp,
      maxMp: character.mp,
      shield: 0,
      guard: false,
      poison: 0,
      weaken: 0,
      slow: 0,
      stun: false,
      lastAction: null,
    };
  }

  function createStats() {
    return { damageDealt: 0, damageTaken: 0, healed: 0, shielded: 0, biggestHit: 0, crits: 0, misses: 0, actions: 0 };
  }

  /**
   * @param {{characters: object[], palettes: number[], rng?: () => number}} options
   */
  function createBattle(options) {
    const { characters, palettes, rng = Math.random } = options;
    return {
      round: 1,
      ended: false,
      winner: null,
      rng,
      order: [0, 1],
      fighters: [createFighter(characters[0], palettes[0], 0), createFighter(characters[1], palettes[1], 1)],
      stats: [createStats(), createStats()],
    };
  }

  function rollSpeed(state, fighter) {
    return fighter.character.spd - (fighter.slow ? RULES.slowSpeedPenalty : 0) + state.rng() * RULES.speedJitter;
  }

  /**
   * Decides who acts first this round. "防禦" gets +20 priority.
   * RNG order: P1 speed, then P2 speed. Ties go to P1.
   * @returns {number[]} sides in acting order
   */
  function resolveTurnOrder(state, actions) {
    const bonus = (side) => (actions[side] && actions[side].type === 'guard' ? RULES.guardPriority : 0);
    const s0 = rollSpeed(state, state.fighters[0]) + bonus(0);
    const s1 = rollSpeed(state, state.fighters[1]) + bonus(1);
    state.order = s1 > s0 ? [1, 0] : [0, 1];
    return state.order;
  }

  /**
   * Start-of-round upkeep: clears guard stances and ticks poison.
   * @returns {{side:number, poison:number}[]} damage-over-time events for the presenter
   */
  function startRound(state) {
    const events = [];
    state.fighters.forEach((f) => {
      f.guard = false;
      if (f.poison > 0) {
        f.hp = Math.max(0, f.hp - RULES.poisonDamage);
        f.poison--;
        events.push({ side: f.side, poison: RULES.poisonDamage });
      }
    });
    return events;
  }

  /** End-of-round upkeep: decays timed debuffs and advances the round counter. */
  function endRound(state) {
    state.fighters.forEach((f) => {
      if (f.weaken > 0) f.weaken--;
      if (f.slow > 0) f.slow--;
    });
    if (checkWinner(state) === null) state.round++;
  }

  /**
   * Resolves one fighter's command and mutates the battle state.
   * Returns a plain outcome object describing what happened so the presenter can animate it.
   */
  function resolveAction(state, side, skill) {
    const me = state.fighters[side];
    const op = state.fighters[1 - side];
    const stats = state.stats[side];
    const outcome = { side, skill, kind: 'attack', hit: true, damage: 0, absorbed: 0, crit: false, mpGain: 0, hpGain: 0, shieldGain: 0, shieldDecay: 0, chargeSpent: 0, chargeBonus: 0, statuses: [] };

    if (!skill || skill.type === 'skip') {
      outcome.kind = 'skip';
      outcome.hit = false;
      return outcome;
    }
    if (me.character.id === 'jelly' && me.shield > 0) {
      outcome.shieldDecay = Math.min(me.shield, Math.ceil(me.shield * RULES.jellyShieldDecay));
      me.shield -= outcome.shieldDecay;
    }
    me.lastAction = skill.id;
    stats.actions++;
    if (skill.cost) me.mp = Math.max(0, me.mp - skill.cost);

    if (skill.type === 'focus') {
      outcome.kind = 'focus';
      const before = me.mp;
      me.mp = Math.min(me.maxMp, me.mp + RULES.focusMpGain);
      outcome.mpGain = me.mp - before;
      if (me.character.id === 'orca') {
        outcome.hpGain = Math.min(RULES.orcaFocusHeal, me.maxHp - me.hp);
        me.hp += outcome.hpGain;
        stats.healed += outcome.hpGain;
      }
      return outcome;
    }
    if (skill.type === 'guard') {
      outcome.kind = 'guard';
      me.guard = true;
      return outcome;
    }
    if (skill.type === 'shield') {
      outcome.kind = 'shield';
      outcome.shieldGain = Math.round(skill.power * (me.character.id === 'jelly' ? RULES.jellyShieldMultiplier : 1));
      me.shield += outcome.shieldGain;
      stats.shielded += outcome.shieldGain;
      return outcome;
    }
    if (skill.type === 'heal') {
      outcome.kind = 'heal';
      outcome.hpGain = Math.min(skill.power, me.maxHp - me.hp);
      me.hp += outcome.hpGain;
      stats.healed += outcome.hpGain;
      return outcome;
    }

    // Offensive command.
    outcome.hit = state.rng() * 100 <= (skill.acc || 100);
    if (!outcome.hit) {
      stats.misses++;
      return outcome;
    }
    outcome.crit = state.rng() < (skill.crit || RULES.baseCritChance);

    let power = skill.power || 0;
    const ctx = { me, op, skill, wentFirst: state.order[0] === side };
    for (const passive of PASSIVE_POWER) {
      if (me.character.id === passive.id && passive.applies(ctx)) power *= passive.multiplier;
    }
    const atk = me.character.atk * (me.weaken ? RULES.weakenAttackFactor : 1);
    let def = op.character.def;
    const raw = power + atk * RULES.attackScale + (state.rng() * RULES.damageJitterRange + RULES.damageJitterOffset);
    if (skill.type === 'magic') def *= RULES.magicDefenseFactor;
    if (skill.type === 'pierce') def *= RULES.pierceDefenseFactor;
    let dmg = Math.max(RULES.minDamage, Math.round(raw - def * RULES.defenseScale));
    if (outcome.crit) dmg = Math.round(dmg * RULES.critMultiplier);
    if (op.guard) dmg = Math.round(dmg * RULES.guardDamageMultiplier);
    if (me.character.id === 'jelly' && me.shield > 0) {
      outcome.chargeSpent = Math.floor(me.shield * RULES.jellyChargeSpend);
      outcome.chargeBonus = Math.floor(outcome.chargeSpent * RULES.jellyChargeDamage);
      me.shield -= outcome.chargeSpent;
      dmg += outcome.chargeBonus;
    }

    if (op.shield > 0) {
      outcome.absorbed = Math.min(op.shield, dmg);
      op.shield -= outcome.absorbed;
      dmg -= outcome.absorbed;
    }
    op.hp = Math.max(0, op.hp - dmg);
    outcome.damage = dmg;

    stats.damageDealt += dmg;
    stats.biggestHit = Math.max(stats.biggestHit, dmg);
    if (outcome.crit) stats.crits++;
    state.stats[1 - side].damageTaken += dmg;

    if (skill.type === 'poison') { op.poison = RULES.poisonTurns; outcome.statuses.push('poison'); }
    if (skill.type === 'weaken') { op.weaken = RULES.weakenTurns; outcome.statuses.push('weaken'); }
    if (skill.type === 'slow') { op.slow = RULES.slowTurns; outcome.statuses.push('slow'); }
    if (skill.type === 'stun' && state.rng() < (skill.stun || 0)) { op.stun = true; outcome.statuses.push('stun'); }
    return outcome;
  }

  /**
   * Marks the battle as ended when a fighter reaches 0 HP.
   * @returns {number|null} winning side, or null while both fighters stand
   */
  function checkWinner(state) {
    if (state.ended) return state.winner;
    const [a, b] = state.fighters;
    if (a.hp > 0 && b.hp > 0) return null;
    state.ended = true;
    state.winner = a.hp <= 0 ? 1 : 0;
    return state.winner;
  }

  /** Commands a fighter may pick this round (signature skills + shared utilities). */
  function commandsFor(fighter, utilitySkills) {
    return [...fighter.character.skills, ...utilitySkills];
  }

  /**
   * A staggered fighter loses this turn: clears the stun and returns the skip command.
   * Used for both human players (after they acknowledge it) and the CPU.
   */
  function takeStunnedTurn(state, side) {
    state.fighters[side].stun = false;
    return SKIP_ACTION;
  }

  /**
   * Heuristic CPU opponent: heals/shields when hurt, focuses when dry, finishes when the
   * opponent is low, otherwise picks a random affordable command. A stunned CPU skips.
   */
  function cpuChooseAction(state, side, utilitySkills) {
    const me = state.fighters[side];
    if (me.stun) return takeStunnedTurn(state, side);
    const opp = state.fighters[1 - side];
    const rng = state.rng;
    const guard = utilitySkills.find((s) => s.id === 'guard');
    const focus = utilitySkills.find((s) => s.id === 'focus');
    const options = commandsFor(me, utilitySkills).filter((s) => me.mp >= s.cost);
    const hpRatio = me.hp / me.maxHp;
    const heal = options.find((s) => s.type === 'heal');
    const shield = options.filter((s) => s.type === 'shield').sort((a, b) => (b.power || 0) - (a.power || 0))[0];

    if (heal && hpRatio < 0.42 && rng() < 0.72) return heal;
    if (shield && me.shield < 12 && hpRatio < 0.68 && rng() < 0.58) return shield;
    if (hpRatio < 0.28 && rng() < 0.32) return guard;
    if (me.mp < 18 && rng() < 0.45) return focus;
    if (opp.hp / opp.maxHp < 0.35) {
      const finisher = options.filter((s) => OFFENSIVE_TYPES.includes(s.type)).sort((a, b) => (b.power || 0) - (a.power || 0))[0];
      if (finisher) return finisher;
    }
    const pool = options.filter((s) =>
      s.type !== 'heal' &&
      (s.id !== 'guard' || rng() < 0.35));
    return pool[Math.floor(rng() * pool.length)] || focus;
  }

  /** Whether a command earns the full-screen cut-in. */
  function isSuperSkill(skill) {
    return (skill.cost || 0) >= 16 || (skill.power || 0) >= 28 || SUPER_FX.includes(skill.fx || '');
  }

  function isSupport(skill) {
    return SUPPORT_TYPES.includes(skill.type);
  }

  return Object.freeze({
    RULES,
    SKIP_ACTION,
    SUPPORT_TYPES,
    OFFENSIVE_TYPES,
    createRng,
    createBattle,
    createFighter,
    resolveTurnOrder,
    startRound,
    endRound,
    resolveAction,
    checkWinner,
    commandsFor,
    cpuChooseAction,
    takeStunnedTurn,
    isSuperSkill,
    isSupport,
  });
});
