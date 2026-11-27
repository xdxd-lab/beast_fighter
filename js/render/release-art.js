/**
 * 3D-derived 2D rendering contract. Shared by renderer and test fixtures.
 * Each effect retains its approved asset and resolves with the engine's clock.
 */
(function (root) {
  'use strict';
  const fighterIds = Object.freeze(['bear','elephant','panda','hummingbird','orca','jelly']);
  const definition = Object.freeze({
    ember:        ['bear','travel', 0.65, 20.82,72.45, -1],
    fireball:     ['bear','travel', 1.00, 24.11,62.95, -1],
    meteor:       ['bear','drop',   1.11, 37.44,69.76, -1],
    water:        ['elephant','travel', 1.00, 43.85,56.09, 0],
    wind:         ['elephant','travel', 1.18, 50.0,91.92, 0],
    shockwave:    ['elephant','ground', 1.32, 50.0,60.68, 0],
    shadow:       ['panda','palm', 1.00, 62.57,58.1, 1],
    leaf:         ['panda','travel', 0.86, 68.85,60.15, 1],
    hammer:       ['hummingbird','strike', 0.90, 48.59,82.4, 0],
    airhammer:    ['hummingbird','travel', 1.02, 69.29,53.32, 1],
    hammerquake:  ['hummingbird','strike', 1.28, 49.57,82.17, 0],
    note:         ['orca','travel', 0.77, 56.14,51.88, 0],
    bass:         ['orca','travel', 1.10, 50.2,57.05, 0],
    heal:         ['orca','support', 1.02, 47.49,53.36, 0],
    electric:     ['jelly','travel', 0.97, 49.76,53.9, 0],
    focus:        ['shared','aura', 1.18, 50.72,85.5, 0],
  });
  const groups = new Map();
  const texture = 'data:image/webp;base64,';
  function load(group) {
    if (groups.has(group)) return groups.get(group);
    const promise = fetch('assets/pilot/packs/' + group + '.json', { credentials: 'same-origin' })
      .then(async r => {
        if (!r.ok) throw new Error('Local art pack unavailable');
        const entries = await r.json();
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Bad art pack');
        return entries;
      })
      .catch(() => { groups.delete(group); return null; });
    groups.set(group, promise);
    return promise;
  }
  const readyPortraits = { entries: null };
  async function loadPortraits() { readyPortraits.entries = await load('portraits'); return !!readyPortraits.entries; }
  function portrait(character, palette) {
    const color = palette ? 'b' : 'a';
    const encoded = readyPortraits.entries?.[character.id + '-' + color];
    return safeImage(encoded);
  }
  function safeImage(value) {
    // Only an inline WebP is accepted; malformed data falls back to classic,
    // and no arbitrary URL or HTML hits the DOM.
    return typeof value === 'string' && /^[\w+/]+=*$/.test(value) ? texture + value : '';
  }
  async function asset(path) {
    if (path === 'stage') return 'assets/pilot/stage.webp';
    const [type,key] = path.split('/');
    if (!key || !['fighters','fx'].includes(type)) return '';
    const owner = type === 'fighters' ? key.split('-')[0] : definition[key]?.[0] ??
      (/^(shield|fortress)-/.test(key) ? 'jelly' : /^guard-/.test(key) ? 'shared' : null);
    if (!owner) return '';
    const group = (type === 'fighters' ? 'cast-' : 'fx-') + owner;
    return safeImage((await load(group))?.[key]);
  }
  function keysFor(fighters) {
    const have = new Set(fighters.map(f => f.character.id).concat('shared'));
    return Object.keys(definition).filter(key => have.has(definition[key][0]));
  }
  /** In-progress art only. Hit and miss are always supplied by the engine. */
  function frame(key,t,hit,side,from,to) {
    if (!definition[key]) return null;
    const [owner,kind,scale,px,py,natural] = definition[key];
    const dir = side === 0 ? 1 : -1;
    const bounded = (v) => Math.max(0, Math.min(1,v));
    const between = (a,b,p) => a + (b-a)*p;
    const neutral = [scale,px,py,natural ? dir * natural : 1];
    const flight = bounded((t-.12)/.57);
    const active = t>=.12 && t<.96;
    const overshoot = dir * (hit ? 0 : 30 + 120*bounded((t-.69)/.26));
    if (kind === 'travel' || kind === 'drop') {
      if (!active || (hit && t>=.69)) return null;
      const x = kind === 'drop' ? to.x + overshoot - dir*(1-flight)*90 :
        between(from.x + dir*43,to.x + overshoot,flight);
      const y = kind === 'drop' ? between(29,to.y,flight) :
        between(from.y,to.y,flight) - 13*Math.sin(Math.PI*flight);
      return [x,y,...neutral,1];
    }
    if (kind === 'support' || kind === 'aura') {
      if (t<.40 || t>.96) return null;
      const opacity = Math.min(1, (t-.4)*15,(.97-t)*11);
      return [from.x,kind==='aura' ? from.ground : from.y - 26,...neutral,opacity];
    }
    if (kind === 'strike') {
      if (!hit || t<.65 || t>.94) return null;
      return [to.x,to.ground,...neutral,Math.min(1, (.97-t)*9)];
    }
    if (kind === 'ground') {
      if (!active || t>.86 || (!hit && t>.67)) return null;
      return [between(from.x,to.x,flight),between(from.ground,to.ground,flight),...neutral,Math.min(1,(.89-t)*12)];
    }
    if (!active || t>.78 || (!hit && t>.66)) return null;
    return [between(from.x,to.x,flight*.94),between(from.y,to.y,flight),...neutral,Math.min(1,(.81-t)*10)];
  }
  const api=Object.freeze({fighterIds,definition,loadPortraits,portrait,asset,keysFor,frame});
  if (typeof module === 'object' && module.exports) module.exports=api;
  else (root.BeastBrawl=root.BeastBrawl||{}).ReleaseArt=api;
})(globalThis);
