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
  const get = id => list.find(arena => arena.id === id) || list[0];
  const api = Object.freeze({ list, get });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BeastBrawl = root.BeastBrawl || {}).Arenas = api;
})(globalThis);
