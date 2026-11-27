/** Immutable paths for the pre-rendered arenas. The fighter and FX packs are shared. */
(function (root) {
  'use strict';
  const list = Object.freeze([
    ['snow', '雪山擂台', 'assets/pilot'],
    ['tide-harbor', '潮汐玻璃港', 'assets/arenas/tide-harbor'],
    ['bamboo-theater', '月下竹影戲臺', 'assets/arenas/bamboo-theater'],
    ['thunder-terrace', '雲階雷鼓台', 'assets/arenas/thunder-terrace'],
  ].map(([id, label, dir]) => Object.freeze({
    id, label, still: dir + '/stage.webp', webm: dir + '/intro.webm', mp4: dir + '/intro.mp4',
  })));
  const randomId = 'random';
  const find = id => list.find(arena => arena.id === id);
  const get = id => find(id) || list[0];
  const choiceId = id => find(id)?.id || randomId;

  // Arena draws do not consume either the seeded or unseeded combat RNG.
  const random = () => root.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
  const resolve = (id, rng = random) => find(id) || list[Math.floor(rng() * list.length)];

  const api = Object.freeze({ list, get, randomId, choiceId, resolve });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BeastBrawl = root.BeastBrawl || {}).Arenas = api;
})(globalThis);
