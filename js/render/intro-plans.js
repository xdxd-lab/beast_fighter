/** Select exactly one prerecorded camera path per entrance; never touch battle RNG. */
(function (root) {
  'use strict';
  const styles = Object.freeze(['original', 'aerial', 'diagonal']);
  function drawCameraIndex() {
    if (!root.crypto?.getRandomValues) return Math.floor(Math.random() * styles.length);
    const max = 0x100000000, limit = max - max % styles.length;
    const roll = new Uint32Array(1);
    do { root.crypto.getRandomValues(roll); } while (roll[0] >= limit);
    return roll[0] % styles.length;
  }
  function choose(arena, override, draw = drawCameraIndex) {
    const id = styles.includes(override) ? override : styles[draw()] || styles[0];
    if (id === 'original') return { id, webm: arena.webm, mp4: arena.mp4 };
    const suffix = 'intro-' + id;
    return { id, webm: arena.webm.replace(/intro\.webm$/,suffix+'.webm'),
      mp4: arena.mp4.replace(/intro\.mp4$/,suffix+'.mp4') };
  }
  const api = Object.freeze({ styles, choose });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BeastBrawl = root.BeastBrawl || {}).Intros = api;
})(globalThis);
