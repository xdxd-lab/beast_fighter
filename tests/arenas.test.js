'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Arenas = require('../js/render/arenas.js');

test('arena art resolves exactly four approved scene paths', () => {
  assert.deepEqual(Arenas.list.map(x => [x.id, x.label]), [
    ['snow', '雪山擂台'],
    ['tide-harbor', '潮汐玻璃港'],
    ['bamboo-theater', '月下竹影戲臺'],
    ['thunder-terrace', '雲階雷鼓台'],
  ]);
  for (const arena of Arenas.list) {
    const dir = arena.id === 'snow' ? 'assets/pilot' : 'assets/arenas/' + arena.id;
    assert.deepEqual([arena.still, arena.webm, arena.mp4],
      [dir + '/stage.webp', dir + '/intro.webm', dir + '/intro.mp4']);
    assert.strictEqual(Arenas.get(arena.id), arena);
    assert.ok(Object.isFrozen(arena));
  }
  assert.ok(Object.isFrozen(Arenas.list));
});

test('an absent or unknown query defaults to random without allowing an arbitrary path', () => {
  for (const bad of [null, undefined, '', 'unknown', '../../index.html', '__proto__', 'constructor', 'TIDE-HARBOR', 'random']) {
    assert.equal(Arenas.choiceId(bad), Arenas.randomId);
    assert.strictEqual(Arenas.resolve(bad, () => .76), Arenas.list[3]);
    assert.strictEqual(Arenas.get(bad), Arenas.list[0]); // renderer fallback
  }
  for (const arena of Arenas.list) {
    assert.equal(Arenas.choiceId(arena.id), arena.id);
    assert.strictEqual(Arenas.resolve(arena.id, () => assert.fail('fixed arena must not draw')), arena);
  }
});

test('a random match uses one draw over four equal intervals', () => {
  const samples = [0, .249999999, .25, .499999999, .5, .749999999, .75, .999999999];
  for (const [i, value] of samples.entries()) {
    let calls = 0;
    const result = Arenas.resolve(Arenas.randomId, () => { calls++; return value; });
    assert.strictEqual(result, Arenas.list[Math.floor(i / 2)]);
    assert.equal(calls, 1);
  }
});

test('visible release label matches the declared build version', () => {
  const html = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../index.html'), 'utf8');
  assert.ok(html.includes('Beast Brawl · v' + require('../package.json').version + '</span>'));
});
