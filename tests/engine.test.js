'use strict';
/**
 * Unit tests for the pure combat engine and roster data.
 * Run with: node --test tests/*.test.js   (Node 18+; no dependencies)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../js/core/engine.js');
const { CHARACTERS, UTILITY_SKILLS } = require('../js/data/roster.js');

const byId = (id) => CHARACTERS.find((c) => c.id === id);
const skillOf = (charId, skillId) => byId(charId).skills.find((s) => s.id === skillId);
const GUARD = UTILITY_SKILLS.find((s) => s.id === 'guard');
const FOCUS = UTILITY_SKILLS.find((s) => s.id === 'focus');

/** RNG that replays a fixed sequence, then keeps returning the last value. */
function scripted(...values) {
  let i = 0;
  const rng = () => values[Math.min(i++, values.length - 1)];
  rng.calls = () => i;
  return rng;
}

function battle(a, b, rng = scripted(0.5)) {
  const ca = typeof a === 'string' ? byId(a) : a;
  const cb = typeof b === 'string' ? byId(b) : b;
  return Engine.createBattle({ characters: [ca, cb], palettes: [0, 1], rng });
}

// rng order for a non-panda hit: [hit roll, crit roll, damage jitter, (stun roll)]
const HIT_NO_CRIT_FLAT = [0, 0.99, 0.4]; // 0.4 * 5 - 2 = 0 jitter

/* ----------------------------------------------------------------- roster */

test('roster: six fighters with unique ids, three skills and two palettes', () => {
  assert.equal(CHARACTERS.length, 6);
  assert.equal(new Set(CHARACTERS.map((c) => c.id)).size, 6);
  for (const c of CHARACTERS) {
    assert.deepEqual(c.skills.map((s) => s.id), ['basic', 's1', 's2'], c.id);
    assert.equal(c.colors.length, 2, c.id);
    c.colors.forEach((p) => assert.equal(p.length, 3, c.id));
    for (const k of ['hp', 'mp', 'atk', 'def', 'spd']) assert.ok(c[k] > 0, `${c.id}.${k}`);
    for (const s of c.skills) {
      assert.ok(s.cost <= c.mp, `${c.id}.${s.id} affordable at full MP`);
      assert.ok(s.acc > 0 && s.acc <= 100, `${c.id}.${s.id} accuracy`);
      assert.ok(typeof s.fx === 'string' && s.fx.length, `${c.id}.${s.id} fx`);
    }
  }
  assert.deepEqual(UTILITY_SKILLS.map((s) => s.id), ['guard', 'focus']);
});

test('roster: basic attacks are free', () => {
  for (const c of CHARACTERS) assert.equal(c.skills[0].cost, 0, c.id);
});

/* ----------------------------------------------------------------- rng */

test('createRng: deterministic and within [0, 1)', () => {
  const a = Engine.createRng(42);
  const b = Engine.createRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(Engine.createRng(1)(), Engine.createRng(2)());
});

/* ----------------------------------------------------------------- setup */

test('createBattle: fighters start at full resources on round 1', () => {
  const st = battle('bear', 'orca');
  assert.equal(st.round, 1);
  assert.equal(st.ended, false);
  assert.equal(st.winner, null);
  st.fighters.forEach((f, side) => {
    assert.equal(f.side, side);
    assert.equal(f.hp, f.maxHp);
    assert.equal(f.mp, f.maxMp);
    assert.equal(f.shield, 0);
    assert.equal(f.stun, false);
  });
});

/* ----------------------------------------------------------------- turn order */

test('turn order: the faster fighter acts first', () => {
  const st = battle('elephant', 'panda', scripted(0));
  assert.deepEqual(Engine.resolveTurnOrder(st, [skillOf('elephant', 'basic'), skillOf('panda', 'basic')]), [1, 0]);
});

test('turn order: guard gets +20 priority', () => {
  const st = battle('elephant', 'panda', scripted(0));
  assert.deepEqual(Engine.resolveTurnOrder(st, [GUARD, skillOf('panda', 'basic')]), [0, 1]);
});

test('turn order: exact ties go to 1P and slow costs 3 speed', () => {
  const st = battle('bear', 'bear', scripted(0));
  assert.deepEqual(Engine.resolveTurnOrder(st, [FOCUS, FOCUS]), [0, 1]);
  st.fighters[0].slow = 2;
  assert.deepEqual(Engine.resolveTurnOrder(st, [FOCUS, FOCUS]), [1, 0]);
});

/* ----------------------------------------------------------------- damage */

test('damage: physical formula = power + atk*0.72 + jitter - def*0.63', () => {
  // hummingbird basic (18) atk 19 vs bear def 7: 18 + 13.68 - 4.41 = 27.27 -> 27
  const st = battle('hummingbird', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  const out = Engine.resolveAction(st, 0, skillOf('hummingbird', 'basic'));
  assert.equal(out.kind, 'attack');
  assert.equal(out.hit, true);
  assert.equal(out.damage, 27);
  assert.equal(st.fighters[1].hp, 104 - 27);
  assert.equal(st.stats[0].damageDealt, 27);
});

test('damage: magic ignores 68% of defence', () => {
  // bear basic (14) atk 12 vs elephant def 12: 14 + 8.64 - 12*.32*.63 = 20.22 -> 20
  const st = battle('bear', 'elephant', scripted(...HIT_NO_CRIT_FLAT));
  assert.equal(Engine.resolveAction(st, 0, skillOf('bear', 'basic')).damage, 20);
});

test('damage: critical hits deal 1.5x', () => {
  const st = battle('hummingbird', 'bear', scripted(0, 0, 0.4));
  const out = Engine.resolveAction(st, 0, skillOf('hummingbird', 'basic'));
  assert.equal(out.crit, true);
  assert.equal(out.damage, Math.round(27 * 1.5));
  assert.equal(st.stats[0].crits, 1);
});

test('damage: guard takes 55% and shields absorb first', () => {
  const st = battle('hummingbird', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  st.fighters[1].guard = true;
  st.fighters[1].shield = 10;
  const out = Engine.resolveAction(st, 0, skillOf('hummingbird', 'basic'));
  // round(27 * .55) = 15, shield absorbs 10 -> 5 to HP
  assert.equal(out.absorbed, 10);
  assert.equal(out.damage, 5);
  assert.equal(st.fighters[1].shield, 0);
  assert.equal(st.fighters[1].hp, 104 - 5);
});

test('damage: never below the 3-point floor', () => {
  const weak = { ...byId('jelly'), id: 'dummy', atk: 0, skills: [{ id: 'basic', name: 'x', cost: 0, type: 'damage', power: 0, acc: 100, fx: 'slash' }] };
  const wall = { ...byId('jelly'), id: 'wall', def: 99 };
  const st = battle(weak, wall, scripted(0, 0.99, 0));
  assert.equal(Engine.resolveAction(st, 0, weak.skills[0]).damage, 3);
});

test('damage: misses change nothing but the miss counter', () => {
  const st = battle('hummingbird', 'bear', scripted(0.999));
  const out = Engine.resolveAction(st, 0, skillOf('hummingbird', 'basic'));
  assert.equal(out.hit, false);
  assert.equal(st.fighters[1].hp, st.fighters[1].maxHp);
  assert.equal(st.stats[0].misses, 1);
});

test('damage: MP cost is paid even on a miss', () => {
  const st = battle('hummingbird', 'bear', scripted(0.999));
  Engine.resolveAction(st, 0, skillOf('hummingbird', 's1'));
  assert.equal(st.fighters[0].mp, 72 - 15);
});

/* ----------------------------------------------------------------- passives */

test('passive: bear below 50% HP deals +12%', () => {
  const st = battle('bear', 'elephant', scripted(...HIT_NO_CRIT_FLAT));
  st.fighters[0].hp = 50;
  // 14*1.12 + 8.64 - 2.4192 = 21.9 -> 22
  assert.equal(Engine.resolveAction(st, 0, skillOf('bear', 'basic')).damage, 22);
});

test('passive: elephant signature skills deal +8%, basic does not', () => {
  const basic = battle('elephant', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  // magic 15 + 13*.72 - 7*.32*.63 = 15 + 9.36 - 1.4112 = 22.95 -> 23
  assert.equal(Engine.resolveAction(basic, 0, skillOf('elephant', 'basic')).damage, 23);
  const s1 = battle('elephant', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  // slow 22*1.08 + 9.36 - 4.41 = 28.71 -> 29
  assert.equal(Engine.resolveAction(s1, 0, skillOf('elephant', 's1')).damage, 29);
});

test('passive: hummingbird below 35% HP deals +18%', () => {
  const st = battle('hummingbird', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  st.fighters[0].hp = 30;
  // 18*1.18 + 13.68 - 4.41 = 30.51 -> 31
  assert.equal(Engine.resolveAction(st, 0, skillOf('hummingbird', 'basic')).damage, 31);
});

test('passive: orca focus also heals up to 6 HP', () => {
  const st = battle('orca', 'bear');
  st.fighters[0].hp = 100;
  st.fighters[0].mp = 100;
  const out = Engine.resolveAction(st, 0, FOCUS);
  assert.equal(out.kind, 'focus');
  assert.equal(out.hpGain, 6);
  assert.equal(st.fighters[0].hp, 106);
  assert.equal(st.fighters[0].mp, 108); // capped at max
});

test('passive: jelly shields are 20% stronger', () => {
  const st = battle('jelly', 'bear');
  assert.equal(Engine.resolveAction(st, 0, skillOf('jelly', 's1')).shieldGain, 29);
  // acting again first sheds ceil(29 * 20%) = 6 of the leftover shield
  const second = Engine.resolveAction(st, 0, skillOf('jelly', 's2'));
  assert.equal(second.shieldDecay, 6);
  assert.equal(second.shieldGain, 48);
  assert.equal(st.fighters[0].shield, 71);
});

test('passive: jelly sheds 20% of leftover shield on each later action, not when skipped', () => {
  const guard = UTILITY_SKILLS.find((s) => s.id === 'guard');
  const st = battle('jelly', 'bear');
  st.fighters[0].shield = 50;
  assert.equal(Engine.resolveAction(st, 0, Engine.SKIP_ACTION).shieldDecay, 0);
  assert.equal(st.fighters[0].shield, 50);
  assert.equal(Engine.resolveAction(st, 0, guard).shieldDecay, 10);
  assert.equal(st.fighters[0].shield, 40);
  st.fighters[0].shield = 1;
  Engine.resolveAction(st, 0, guard);
  assert.equal(st.fighters[0].shield, 0);
  const other = battle('bear', 'jelly');
  other.fighters[0].shield = 50;
  assert.equal(Engine.resolveAction(other, 0, guard).shieldDecay, 0);
  assert.equal(other.fighters[0].shield, 50);
});

/* ----------------------------------------------------------------- support */

test('support: heal never exceeds max HP', () => {
  const st = battle('orca', 'bear');
  st.fighters[0].hp = 110;
  const out = Engine.resolveAction(st, 0, skillOf('orca', 's2'));
  assert.equal(out.hpGain, 12);
  assert.equal(st.fighters[0].hp, 122);
});

test('support: guard sets the stance and startRound clears it', () => {
  const st = battle('bear', 'orca');
  Engine.resolveAction(st, 0, GUARD);
  assert.equal(st.fighters[0].guard, true);
  Engine.startRound(st);
  assert.equal(st.fighters[0].guard, false);
});

/* ----------------------------------------------------------------- statuses */

test('status: weaken and slow last two rounds', () => {
  const st = battle('orca', 'elephant', scripted(...HIT_NO_CRIT_FLAT));
  Engine.resolveAction(st, 0, skillOf('orca', 's1'));
  assert.equal(st.fighters[1].weaken, 2);
  Engine.endRound(st);
  Engine.endRound(st);
  assert.equal(st.fighters[1].weaken, 0);

  const st2 = battle('elephant', 'orca', scripted(...HIT_NO_CRIT_FLAT));
  Engine.resolveAction(st2, 0, skillOf('elephant', 's1'));
  assert.equal(st2.fighters[1].slow, 2);
});

test('status: stun lands when the stun roll is under the skill chance', () => {
  const st = battle('bear', 'orca', scripted(0, 0.99, 0.4, 0.1));
  const out = Engine.resolveAction(st, 0, skillOf('bear', 's2'));
  assert.ok(out.statuses.includes('stun'));
  assert.equal(st.fighters[1].stun, true);
  const st2 = battle('bear', 'orca', scripted(0, 0.99, 0.4, 0.5));
  Engine.resolveAction(st2, 0, skillOf('bear', 's2'));
  assert.equal(st2.fighters[1].stun, false);
});

test('status: skip actions do nothing', () => {
  const st = battle('bear', 'orca');
  const out = Engine.resolveAction(st, 0, Engine.SKIP_ACTION);
  assert.equal(out.kind, 'skip');
  assert.equal(st.fighters[0].mp, 118);
});

/* ----------------------------------------------------------------- end */

test('checkWinner: K.O. ends the battle and freezes the round counter', () => {
  const st = battle('bear', 'orca');
  assert.equal(Engine.checkWinner(st), null);
  st.fighters[1].hp = 0;
  assert.equal(Engine.checkWinner(st), 0);
  assert.equal(st.ended, true);
  Engine.endRound(st);
  assert.equal(st.round, 1);
});

/* ----------------------------------------------------------------- CPU */

test('cpu: only ever picks affordable commands', () => {
  const rng = Engine.createRng(7);
  for (const c of CHARACTERS) {
    for (let i = 0; i < 300; i++) {
      const st = battle('bear', c.id, rng);
      const me = st.fighters[1];
      me.mp = Math.floor(rng() * (me.maxMp + 1));
      me.hp = 1 + Math.floor(rng() * me.maxHp);
      st.fighters[0].hp = 1 + Math.floor(rng() * st.fighters[0].maxHp);
      const pick = Engine.cpuChooseAction(st, 1, UTILITY_SKILLS);
      assert.ok(pick, 'returns a command');
      assert.ok(pick.cost <= me.mp, `${pick.name} costs ${pick.cost} with ${me.mp} MP`);
    }
  }
});

test('cpu: heals when badly hurt', () => {
  const st = battle('bear', 'orca', scripted(0));
  st.fighters[1].hp = 30;
  assert.equal(Engine.cpuChooseAction(st, 1, UTILITY_SKILLS).type, 'heal');
});

test('cpu: goes for the strongest finisher when the opponent is low', () => {
  const st = battle('bear', 'elephant', scripted(0.99));
  st.fighters[0].hp = 20;
  assert.equal(Engine.cpuChooseAction(st, 1, UTILITY_SKILLS).id, 's2');
});

/* ----------------------------------------------------------------- misc */

test('isSuperSkill: signature specials get a cut-in, basics do not', () => {
  for (const c of CHARACTERS) {
    assert.equal(Engine.isSuperSkill(c.skills[0]), false, `${c.id} basic`);
    assert.equal(Engine.isSuperSkill(c.skills[2]), true, `${c.id} s2`);
  }
  assert.equal(Engine.isSuperSkill(GUARD), false);
  assert.equal(Engine.isSuperSkill(FOCUS), false);
});

test('determinism: the same seed replays the same battle', () => {
  const run = (seed) => {
    const st = battle('panda', 'hummingbird', Engine.createRng(seed));
    const log = [];
    while (!st.ended && st.round < 200) {
      Engine.startRound(st);
      const acts = [0, 1].map((s) => Engine.cpuChooseAction(st, s, UTILITY_SKILLS));
      for (const side of Engine.resolveTurnOrder(st, acts)) {
        if (Engine.checkWinner(st) !== null) break;
        const o = Engine.resolveAction(st, side, acts[side]);
        log.push(`${st.round}:${side}:${o.skill.id}:${o.damage}`);
      }
      Engine.endRound(st);
    }
    return log.join('|');
  };
  assert.equal(run(99), run(99));
  assert.notEqual(run(99), run(100));
});

/* ----------------------------------------------------------------- V10 fixes */

test('fix: panda passive uses the real turn order (no extra speed re-roll)', () => {
  // panda basic (16) atk 16 vs bear def 7
  const first = battle('panda', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  first.order = [0, 1];
  assert.equal(Engine.resolveAction(first, 0, skillOf('panda', 'basic')).damage, 25); // 16*1.12+11.52-4.41
  const second = battle('panda', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  second.order = [1, 0];
  const rng = second.rng;
  assert.equal(Engine.resolveAction(second, 0, skillOf('panda', 'basic')).damage, 23); // 16+11.52-4.41
  assert.equal(rng.calls(), 3, 'hit, crit and jitter only');
});

test('fix: a stunned CPU loses its turn and recovers', () => {
  const st = battle('bear', 'orca', scripted(0.5));
  st.fighters[1].stun = true;
  const pick = Engine.cpuChooseAction(st, 1, UTILITY_SKILLS);
  assert.equal(pick.type, 'skip');
  assert.equal(st.fighters[1].stun, false);
  assert.notEqual(Engine.cpuChooseAction(st, 1, UTILITY_SKILLS).type, 'skip');
});

test('passive: a landed jelly attack spends half its shield, 80% of that as bonus damage', () => {
  const st = battle('jelly', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  const plain = battle('jelly', 'bear', scripted(...HIT_NO_CRIT_FLAT));
  st.fighters[0].shield = 100; // decays to 80 when jelly acts, then spends 40 -> +32
  const hit = Engine.resolveAction(st, 0, skillOf('jelly', 'basic'));
  const base = Engine.resolveAction(plain, 0, skillOf('jelly', 'basic')).damage;
  assert.equal(hit.chargeSpent, 40);
  assert.equal(hit.chargeBonus, 32);
  assert.equal(hit.damage, base + 32);
  assert.equal(st.fighters[0].shield, 40);
  const miss = battle('jelly', 'bear', scripted(0.999));
  miss.fighters[0].shield = 100;
  const missed = Engine.resolveAction(miss, 0, { ...skillOf('jelly', 'basic'), acc: 50 });
  assert.equal(missed.hit, false);
  assert.equal(missed.chargeSpent, 0);
  assert.equal(miss.fighters[0].shield, 80);
});

test('CPU random pool may pick shields with shield up and focus at full MP (V9 behaviour)', () => {
  const rng = Engine.createRng(3);
  let shields = 0;
  let focuses = 0;
  for (let i = 0; i < 800; i++) {
    const st = battle('bear', 'jelly', rng);
    st.fighters[1].shield = 60;
    const pick = Engine.cpuChooseAction(st, 1, UTILITY_SKILLS);
    if (pick.type === 'shield') shields++;
    if (pick.id === 'focus') focuses++;
  }
  assert.ok(shields > 0 && focuses > 0);
});

test('every matchup finishes (CPU vs CPU, 36 matchups x 10 seeds)', () => {
  const longest = { rounds: 0 };
  for (let i = 0; i < CHARACTERS.length; i++) {
    for (let j = 0; j < CHARACTERS.length; j++) {
      for (let k = 0; k < 10; k++) {
        const st = battle(CHARACTERS[i].id, CHARACTERS[j].id, Engine.createRng(1000 + i * 97 + j * 13 + k));
        while (!st.ended && st.round < 400) {
          Engine.startRound(st);
          if (Engine.checkWinner(st) !== null) break;
          const acts = [0, 1].map((s) => Engine.cpuChooseAction(st, s, UTILITY_SKILLS));
          for (const side of Engine.resolveTurnOrder(st, acts)) {
            if (Engine.checkWinner(st) !== null) break;
            Engine.resolveAction(st, side, acts[side]);
          }
          Engine.endRound(st);
        }
        assert.ok(st.ended, `${CHARACTERS[i].id} vs ${CHARACTERS[j].id} seed ${k} did not finish`);
        longest.rounds = Math.max(longest.rounds, st.round);
      }
    }
  }
  assert.ok(longest.rounds < 400);
});
