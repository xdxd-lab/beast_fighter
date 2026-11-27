'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Arenas = require('../js/render/arenas.js');

test('arena selection has one stable default and three original scenery choices', () => {
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

test('an absent or untrusted query cannot generate a network path', () => {
  for (const bad of [null, undefined, '', 'unknown', '../../index.html', '__proto__', 'constructor', 'TIDE-HARBOR']) {
    assert.strictEqual(Arenas.get(bad), Arenas.list[0]);
  }
});

test('visible release label matches the declared build version', () => {
  const html = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../index.html'), 'utf8');
  assert.ok(html.includes('Beast Brawl · v' + require('../package.json').version + '</span>'));
});
