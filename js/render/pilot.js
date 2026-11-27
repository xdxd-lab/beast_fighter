/**
 * Optional pre-rendered art. Owns playback and layers, never battle rules.
 * One instance per battle; aborting it makes all async completions inert.
 */
(function (root) {
  'use strict';
  const Art = root.BeastBrawl.ReleaseArt;
  const Arenas = root.BeastBrawl.Arenas;
  const Intros = root.BeastBrawl.Intros;
  const IDS = new Set(Art.fighterIds);
  const POSE_FILE = { idle: 'idle', ready: 'idle', charge: 'cast', release: 'cast',
    strike: 'cast', recover: 'idle', hit: 'hit', guard: 'defend', ko: 'ko', victory: 'idle' };
  const BARRIERS = ['shield', 'fortress', 'guard'];
  const PIVOTS = { shield: [52.42,97.75], fortress: [50,88.38], guard: [50.20,84.51] };
  function pivot(el, key) {
    const [x,y] = PIVOTS[key];
    el.style.setProperty('--pilot-pivot-x', x + '%');
    el.style.setProperty('--pilot-pivot-y', y + '%');
  }
  const FILES = {
    cast: ['polo-fireball-cast', 0.72], hit: ['polo-fireball-hit', 0.72],
    partial: ['polo-fireball-partial-block', 0.77], block: ['polo-fireball-full-block', 0.78],
    shield: ['lili-shield-deploy', 0.72], fortress: ['lili-fortress-deploy', 0.71],
    guard: ['shared-guard', 0.62],
  };
  const prefix = 'assets/pilot/';
  const ASSET_WAIT = 6500, INTRO_START_WAIT = 2400, INTRO_PLAY_WAIT = 3200;
  const fighterPath = (fighter, pose) =>
    'fighters/' + fighter.character.id + '-' + (fighter.paletteIndex ? 'b' : 'a') + '-' + pose;
  const skillBarrier = (skill) => skill.type === 'guard' ? 'guard' :
    skill.fx === 'bubble' ? (skill.id === 's2' ? 'fortress' : 'shield') : null;
  const enabled = (fighters) => fighters.length === 2 && fighters.every(f => IDS.has(f.character.id));
  function img(className) {
    const node = document.createElement('img');
    node.className = className;
    node.alt = '';
    node.draggable = false;
    node.decoding = 'async';
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function activate(stage, fighterNodes, fighters, options) {
    const arena = Arenas.get(options.arena?.id);
    const images = new Map();
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const shields = ['shield', 'shield'];
    const active = [null, null];
    const pose = ['idle', 'idle'];
    const layers = fighterNodes.map((element) => {
      const back = img('pilot-overlay pilot-overlay-back');
      const front = img('pilot-overlay pilot-overlay-front');
      const actor = img('pilot-fighter');
      [back, front, actor].forEach(x => { x.hidden = true; element.append(x); });
      return { back, front, actor };
    });
    const background = img('pilot-stage-image');
    const projectile = img('pilot-projectile');
    const preparation = document.createElement('div');
    preparation.className = 'pilot-preparation';
    preparation.setAttribute('role', 'status');
    preparation.textContent = '準備擂台與角色…';
    background.hidden = projectile.hidden = true;
    stage.dataset.pilot = 'loading';
    stage.prepend(background);
    stage.append(projectile, preparation);
    let ready = false;

    function makeDisplayable(node, url) {
      if (typeof node.decode === 'function') {
        node.src = url;
        return node.decode().then(() => node.naturalWidth > 0, () => false);
      }
      return new Promise((resolve) => {
        const finish = (ok) => {
          node.onload = node.onerror = null;
          signal.removeEventListener('abort', abort);
          resolve(ok);
        };
        const abort = () => finish(false);
        node.onload = () => finish(node.naturalWidth > 0);
        node.onerror = abort;
        signal.addEventListener('abort', abort, { once: true });
        node.src = url;
      });
    }

    // Critical assets are decoded on the actual stage nodes. The cover stays
    // up until the complete scene (or an intentional fallback) can be shown.
    function prime(key, node = new Image()) {
      if (images.has(key)) return images.get(key).promise;
      node.decoding = 'async';
      const entry = { ok: false, url: '', promise: Promise.resolve(false) };
      images.set(key, entry);
      const source = key === 'stage' ? Promise.resolve(arena.still) : Art.asset(key);
      entry.promise = source.then(async (url) => {
        if (!url || signal.aborted) return false;
        entry.url = url;
        entry.ok = await makeDisplayable(node, url) && !signal.aborted;
        return entry.ok;
      }).catch(() => false);
      return entry.promise;
    }
    const has = (key) => ready && images.get(key)?.ok;
    const texture = key => images.get(key)?.url || '';
    function deadline(ms, operation, value) {
      return new Promise((resolve) => {
        let timer;
        const finish = (v) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(v); };
        const cancel = () => finish(value);
        if (signal.aborted) return cancel();
        signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(cancel, ms);
        Promise.resolve(operation).then(finish, cancel);
      });
    }
    function setPose(side, name) {
      pose[side] = name;
      if (!ready) return;
      const f = fighters[side];
      const key = fighterPath(f, POSE_FILE[name] || 'idle');
      const url = texture(has(key) ? key : fighterPath(f, 'idle'));
      if (layers[side].actor.getAttribute('src') !== url) layers[side].actor.src = url;
    }
    function updateBarrier(side, fighter, ended = false) {
      const element = fighterNodes[side];
      const kind = !ended && fighter.shield > 0 ? shields[side] :
        !ended && fighter.guard ? 'guard' : null;
      const { back, front } = layers[side];
      const visible = !!kind && has('fx/' + kind + '-front') && has('fx/' + kind + '-back');
      element.classList.toggle('pilot-has-barrier', visible);
      if (visible && active[side] !== kind) {
        back.src = texture('fx/' + kind + '-back');
        front.src = texture('fx/' + kind + '-front');
        pivot(back, kind); pivot(front, kind);
        element.dataset.pilotBarrier = kind;
      } else if (!visible) delete element.dataset.pilotBarrier;
      front.hidden = back.hidden = !visible;
      active[side] = visible ? kind : null;
    }
    function skillLayer(side, skill, t, hit, from, to) {
      if (!ready) return false;
      const barrier = skillBarrier(skill);
      if (barrier) {
        if (t >= 0.48 && has('fx/' + barrier + '-front') && has('fx/' + barrier + '-back')) {
          if (barrier !== 'guard') shields[side] = barrier;
          updateBarrier(side, fighters[side]); // engine has already resolved this action
          return true;
        }
        return false;
      }
      if (!Art.definition[skill.fx] || !has('fx/' + skill.fx)) return false;
      const sample = Art.frame(skill.fx, t, hit, side, from, to);
      if (!sample) { projectile.hidden = true; return true; }
      const [x,y,scale,px,py,dir,opacity] = sample;
      if (projectile.dataset.pilotFx !== skill.fx) {
        projectile.src = texture('fx/' + skill.fx);
        projectile.dataset.pilotFx = skill.fx;
        projectile.style.setProperty('--pilot-pivot-x', px + '%');
        projectile.style.setProperty('--pilot-pivot-y', py + '%');
        projectile.style.setProperty('--pilot-scale', String(scale));
      }
      projectile.style.left = x / 10 + '%';
      projectile.style.top = y / 5.2 + '%';
      projectile.style.opacity = String(opacity);
      projectile.style.setProperty('--pilot-dir', String(dir));
      projectile.hidden = false;
      return true;
    }
    function clearSkill() {
      projectile.hidden = true;
      delete projectile.dataset.pilotFx;
    }
    function sound(skill, phase, opts, outcome) {
      if (!ready) return false;
      let kind = null;
      if (skill.fx === 'fireball') kind = phase === 'cast' ? 'cast' :
        outcome?.absorbed ? (outcome.damage > 0 ? 'partial' : 'block') :
          outcome?.guarded ? 'partial' : 'hit';
      else if (phase === 'deploy') kind = skillBarrier(skill);
      else if (phase === 'cast' && skillBarrier(skill)) return true; // sound is tied to barrier appearing
      const entry = FILES[kind];
      return entry ? options.audio.playSample(prefix + 'sfx/' + entry[0] + '.mp3',
        { ...opts, gain: entry[1] }) : false;
    }
    function playIntro() {
      return new Promise((resolve) => {
        if (signal.aborted || options.skipIntro() || document.hidden) return resolve();
        const video = document.createElement('video');
        // Keep the original angle for QA/share links only when explicitly chosen.
        const requested = new URLSearchParams(root.location.search).get('introStyle');
        const intro = Intros.choose(arena, requested);
        stage.dataset.introStyle = intro.id;
        const formats = [['video/webm; codecs="vp9"', intro.webm], ['video/mp4', intro.mp4]];
        for (const [type, path] of formats) {
          const source = document.createElement('source');
          source.type = type; source.src = path; video.append(source);
        }
        video.className = 'pilot-intro';
        video.muted = true; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        const skip = document.createElement('button');
        skip.type = 'button'; skip.className = 'pilot-skip'; skip.textContent = '跳過開場';
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          done();
        };
        const onVisibility = () => { if (document.hidden) done(); };
        let completed = false;
        let timeout;
        const done = () => {
          if (completed) return;
          completed = true;
          signal.removeEventListener('abort', done);
          document.removeEventListener('keydown', onKey, true);
          document.removeEventListener('visibilitychange', onVisibility);
          clearTimeout(timeout);
          video.pause(); video.replaceChildren(); video.load(); video.remove(); skip.remove();
          stage.classList.remove('pilot-video-playing');
          resolve();
        };
        const onPlaying = () => {
          if (completed) return;
          // Keep the neutral cover above the video until it can show a frame.
          stage.classList.add('pilot-video-playing');
          clearTimeout(timeout);
          timeout = setTimeout(done, INTRO_PLAY_WAIT);
        };
        timeout = setTimeout(done, INTRO_START_WAIT);
        video.addEventListener('playing', onPlaying, { once: true });
        video.addEventListener('ended', done, { once: true });
        video.addEventListener('error', done, { once: true });
        video.lastElementChild?.addEventListener('error', done, { once: true });
        skip.onclick = done;
        signal.addEventListener('abort', done, { once: true });
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('visibilitychange', onVisibility);
        stage.append(video, skip);
        try { void Promise.resolve(video.play()).catch(done); }
        catch { done(); }
      });
    }
    async function prepare() {
      const keys = fighters.map(f => fighterPath(f, 'idle'));
      const critical = Promise.all([prime('stage', background), ...keys.map((k, side) => prime(k, layers[side].actor))])
        .then(r => r.every(Boolean));
      if (!(await deadline(ASSET_WAIT, critical, false)) || signal.aborted) return false;

      // The cast packs are already present. Decode poses while the movie can
      // play, but let the movie use the network before optional FX/audio.
      const poseWarm = fighters.flatMap(f => ['cast', 'hit', 'defend', 'ko'].map(p => fighterPath(f,p)));
      poseWarm.forEach(k => void prime(k));
      ready = true;
      background.hidden = false;
      fighterNodes.forEach((el, side) => {
        setPose(side, pose[side]); layers[side].actor.hidden = false; el.classList.add('pilot-model');
      });
      await playIntro();
      if (signal.aborted) return false;
      preparation.remove();
      stage.dataset.pilot = 'ready';
      stage.dataset.arena = arena.id;
      root.document.documentElement.dataset.art = '3d';

      // Shield overlays are useful even for bear mirrors (guard), but do not
      // download the unused jelly-specific shields or sound bundle.
      const jelly = fighters.some(f => f.character.id === 'jelly');
      const bear = fighters.some(f => f.character.id === 'bear');
      const barrierWarm = (jelly ? BARRIERS : ['guard']).flatMap(k => ['back', 'front'].map(v => 'fx/' + k + '-' + v));
      const audioKinds = ['guard', ...(bear ? ['cast','hit','partial','block'] : []), ...(jelly ? ['shield','fortress'] : [])];
      [...barrierWarm, ...Art.keysFor(fighters).map(k => 'fx/' + k)].forEach(k => void prime(k));
      audioKinds.forEach(k => options.audio.preloadSample(prefix + 'sfx/' + FILES[k][0] + '.mp3'));
      return true;
    }
    function dispose() {
      if (signal.aborted) return;
      lifetime.abort();
      ready = false;
      background.remove(); projectile.remove(); preparation.remove();
      layers.forEach(part => Object.values(part).forEach(node => node.remove()));
      fighterNodes.forEach(el => { el.classList.remove('pilot-model','pilot-has-barrier'); delete el.dataset.pilotBarrier; });
      delete stage.dataset.pilot;
      delete stage.dataset.arena;
      delete stage.dataset.introStyle;
      stage.classList.remove('pilot-video-playing');
      root.document.documentElement.dataset.art = 'classic';
      images.clear();
    }

    return { prepare, dispose, setPose, updateBarrier, skillLayer, clearSkill, sound };
  }
  (root.BeastBrawl = root.BeastBrawl || {}).PilotArt = Object.freeze({ enabled, activate, skillBarrier });
})(window);
