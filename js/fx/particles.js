/**
 * Beast Brawl — canvas particle system for the battle stage.
 *
 * One <canvas> layered over the stage, drawn in the same 1000×520 coordinate space as the
 * effect SVGs. Glows use pre-rendered radial sprites drawn with additive blending
 * ('lighter') and per-particle alpha, so translucent light stacks naturally without any
 * per-frame gradient allocation. Particles live in a fixed-size pool; the render loop only
 * runs while something is alive (or ambient motes are enabled) and stops in hidden tabs.
 *
 * Quality: 'high' | 'low'. In 'auto' mode the system watches frame times and steps down
 * when the device cannot keep up. Exposed as window.BeastBrawl.Particles.
 */
(function (root) {
  'use strict';

  const W = 1000;
  const H = 520;
  const TAU = Math.PI * 2;
  const BUDGET = { high: 700, low: 180 };

  const PALETTES = {
    fire: ['#ffd27a', '#ff8a3d', '#ff5a2a'],
    water: ['#bff4ff', '#58ccff', '#2b8cff'],
    electric: ['#e9fdff', '#9ff0ff', '#5fd7ff'],
    nature: ['#d7ffb0', '#8fe36e', '#45b860'],
    gold: ['#fff4c2', '#ffd45c', '#ffb33d'],
    arcane: ['#f1dcff', '#c08bff', '#8f6bff'],
    heal: ['#e6ffe9', '#8ef0a8', '#4fd889'],
    ice: ['#ffffff', '#cdeeff', '#9fd8ff'],
    ko: ['#ffd1d1', '#ff6d70', '#ff3355'],
    white: ['#ffffff', '#e8f0ff', '#c8d6ff'],
  };

  /** Pre-rendered soft glow sprite per colour (canvas reused for every particle). */
  const spriteCache = new Map();
  function glowSprite(color) {
    let c = spriteCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, color);
    grad.addColorStop(0.5, color + '55');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    spriteCache.set(color, c);
    return c;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /**
   * @param {HTMLElement} stage
   * @param {{anchor?: (side:number) => {x:number, y:number}}} [options]
   *   anchor returns a fighter's centre in stage units (1000×520) so effects land on the
   *   sprite at any responsive layout.
   */
  function createParticles(stage, options = {}) {
    const anchor = options.anchor || ((side) => ({ x: side === 0 ? 270 : 730, y: 300 }));
    const canvas = document.createElement('canvas');
    canvas.className = 'particle-layer';
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let quality = 'high';
    let auto = true;
    let reduced = false;
    let ambient = false;
    let scaleX = 1;
    let scaleY = 1;
    let scaleU = 1; // uniform scale for sizes, so circles stay round on any aspect ratio
    let dpr = 1;
    let running = false;
    let last = 0;
    let ambientClock = 0;
    const frameTimes = [];

    /** Particle pool. kind: glow | spark | glyph | ring | confetti | mote */
    const pool = [];
    const alive = [];

    function resize() {
      const rect = stage.getBoundingClientRect();
      dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      scaleX = canvas.width / W;
      scaleY = canvas.height / H;
      scaleU = Math.min(scaleX, scaleY);
    }
    resize();
    if (root.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else root.addEventListener('resize', resize);

    function budget() {
      const b = BUDGET[quality];
      return reduced ? Math.round(b / 3) : b;
    }

    function spawn(p) {
      if (alive.length >= budget()) return null;
      const o = pool.pop() || {};
      o.kind = p.kind || 'glow';
      o.x = p.x; o.y = p.y;
      o.vx = p.vx || 0; o.vy = p.vy || 0;
      o.ax = p.ax || 0; o.ay = p.ay || 0;
      o.drag = p.drag === undefined ? 0.98 : p.drag;
      o.life = 0; o.maxLife = p.life || 0.6;
      o.size = p.size || 10; o.grow = p.grow || 0;
      o.alpha = p.alpha === undefined ? 1 : p.alpha;
      o.color = p.color || '#ffffff';
      o.text = p.text || '';
      o.rot = p.rot || 0; o.vr = p.vr || 0;
      o.width = p.width || 3;
      o.blend = p.blend || (o.kind === 'confetti' || o.kind === 'glyph' ? 'source-over' : 'lighter');
      o.fadeIn = p.fadeIn || 0;
      o.wobble = p.wobble || 0; o.phase = Math.random() * TAU;
      alive.push(o);
      start();
      return o;
    }

    function start() {
      if (running || document.hidden) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      trackPerformance(dt);
      if (ambient && !reduced) spawnAmbient(dt);
      step(dt);
      draw();
      if (alive.length || (ambient && !reduced)) requestAnimationFrame(frame);
      else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }

    function step(dt) {
      for (let i = alive.length - 1; i >= 0; i--) {
        const p = alive[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          alive[i] = alive[alive.length - 1];
          alive.pop();
          pool.push(p);
          continue;
        }
        const k = Math.pow(p.drag, dt * 60);
        p.vx = (p.vx + p.ax * dt) * k;
        p.vy = (p.vy + p.ay * dt) * k;
        p.x += p.vx * dt + (p.wobble ? Math.sin(p.phase + p.life * 3) * p.wobble * dt : 0);
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.size = Math.max(0, p.size + p.grow * dt);
      }
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let blend = '';
      for (let i = 0; i < alive.length; i++) {
        const p = alive[i];
        const t = p.life / p.maxLife;
        let a = p.alpha * (1 - t);
        if (p.fadeIn && p.life < p.fadeIn) a *= p.life / p.fadeIn;
        if (a <= 0.003) continue;
        if (blend !== p.blend) { ctx.globalCompositeOperation = p.blend; blend = p.blend; }
        ctx.globalAlpha = Math.min(1, a);
        const x = p.x * scaleX;
        const y = p.y * scaleY;
        const s = p.size * scaleU;
        switch (p.kind) {
          case 'glow':
          case 'mote':
            ctx.drawImage(glowSprite(p.color), x - s, y - s, s * 2, s * 2);
            break;
          case 'spark':
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * scaleU;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - p.vx * 0.035 * scaleX, y - p.vy * 0.035 * scaleY);
            ctx.stroke();
            break;
          case 'ring':
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.width * (1 - t * 0.6) * scaleU;
            ctx.beginPath();
            ctx.ellipse(x, y, s, s * 0.92, 0, 0, TAU);
            ctx.stroke();
            break;
          case 'glyph':
            ctx.setTransform(1, 0, 0, 1, x, y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.font = `900 ${Math.max(8, s)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.text, 0, 0);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            break;
          case 'confetti':
            ctx.setTransform(1, 0, 0, 1, x, y);
            ctx.rotate(p.rot);
            ctx.scale(1, Math.cos(p.phase + p.life * 9));
            ctx.fillStyle = p.color;
            ctx.fillRect(-s / 2, -s / 4, s, s / 2);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            break;
          default:
            break;
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /** Semi-transparent floating motes that make the stage feel alive. */
    function spawnAmbient(dt) {
      ambientClock += dt;
      const interval = quality === 'high' ? 0.12 : 0.4;
      while (ambientClock > interval) {
        ambientClock -= interval;
        spawn({
          kind: 'mote', x: rand(0, W), y: rand(H * 0.25, H * 0.95), vx: rand(-8, 8), vy: rand(-22, -8),
          life: rand(3.5, 6), size: rand(3, 8), alpha: rand(0.25, 0.55), fadeIn: 0.8, drag: 1, wobble: rand(6, 16),
          color: pick(['#9fe8ff', '#ffe7a3', '#c9a8ff', '#ffffff']),
        });
      }
    }

    /** Auto quality: step down if the average frame time stays above ~24 ms. */
    function trackPerformance(dt) {
      if (!auto || quality === 'low' || alive.length < 40) { frameTimes.length = 0; return; }
      frameTimes.push(dt);
      if (frameTimes.length < 90) return;
      const avg = frameTimes.reduce((s, v) => s + v, 0) / frameTimes.length;
      frameTimes.length = 0;
      if (avg > 0.024) {
        quality = 'low';
        document.documentElement.dataset.quality = 'low';
        root.dispatchEvent(new CustomEvent('beastbrawl:quality', { detail: { quality, reason: 'auto' } }));
      }
    }

    /* ------------------------------------------------------------ emitters */

    function burst(x, y, o) {
      const n = Math.round((o.count || 20) * (quality === 'high' ? 1 : 0.45) * (reduced ? 0.4 : 1));
      for (let i = 0; i < n; i++) {
        const ang = o.angle !== undefined ? o.angle + rand(-o.spread, o.spread) : rand(0, TAU);
        const spd = rand(o.speed[0], o.speed[1]);
        spawn({
          kind: o.kind || 'glow', x: x + rand(-(o.jitter || 0), o.jitter || 0), y: y + rand(-(o.jitter || 0), o.jitter || 0),
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, ay: o.gravity || 0, drag: o.drag,
          life: rand(o.life[0], o.life[1]), size: rand(o.size[0], o.size[1]), grow: o.grow || 0,
          color: pick(o.colors), alpha: o.alpha, width: o.width, text: o.glyphs ? pick(o.glyphs) : '',
          rot: rand(-0.5, 0.5), vr: o.spin ? rand(-o.spin, o.spin) : 0, wobble: o.wobble || 0,
        });
      }
    }

    function ring(x, y, color, size = 30, grow = 260, life = 0.45, width = 5) {
      spawn({ kind: 'ring', x, y, size, grow, life, color, width, drag: 1, alpha: 0.9 });
    }

    const FX_FAMILY = {
      ember: 'fire', fireball: 'fire', meteor: 'fire',
      water: 'water', bubble: 'water', wind: 'ice',
      electric: 'electric', shadow: 'nature', leaf: 'nature',
      hammer: 'gold', airhammer: 'gold', hammerquake: 'gold', shockwave: 'gold',
      note: 'arcane', bass: 'arcane', focus: 'arcane',
      heal: 'heal', guard: 'ice',
    };

    /** Effect played on the target when an attack connects. */
    function impact(fx, side, opts = {}) {
      const { x, y } = anchor(side);
      const family = FX_FAMILY[fx] || 'white';
      const colors = PALETTES[opts.crit ? 'gold' : family];
      const heavy = opts.heavy || opts.crit;
      burst(x, y, { kind: 'spark', count: heavy ? 26 : 16, speed: [260, heavy ? 760 : 520], life: [0.18, 0.42], size: [1, 1], width: heavy ? 4 : 3, colors, drag: 0.9 });
      burst(x, y, { count: heavy ? 18 : 10, speed: [40, 240], life: [0.25, 0.6], size: [10, heavy ? 34 : 22], colors, drag: 0.9, jitter: 12 });
      ring(x, y, colors[1], 24, heavy ? 420 : 300, 0.42, heavy ? 7 : 5);
      if (family === 'water') burst(x, y - 10, { count: 18, speed: [120, 380], angle: -Math.PI / 2, spread: 1.1, gravity: 900, life: [0.4, 0.8], size: [4, 9], colors, drag: 0.99 });
      if (family === 'fire') burst(x, y, { count: 16, speed: [30, 140], angle: -Math.PI / 2, spread: 0.9, gravity: -180, life: [0.6, 1.1], size: [5, 12], colors, drag: 0.97, wobble: 30 });
      if (family === 'nature' && fx === 'leaf') burst(x, y, { kind: 'glyph', glyphs: ['🍃'], count: 7, speed: [80, 260], life: [0.6, 1], size: [18, 26], colors: ['#fff'], drag: 0.95, spin: 6, gravity: 200 });
      if (family === 'arcane') burst(x, y - 20, { kind: 'glyph', glyphs: ['♪', '♫'], count: 6, speed: [60, 180], angle: -Math.PI / 2, spread: 1.2, life: [0.7, 1.1], size: [22, 32], colors: PALETTES.arcane, drag: 0.96, wobble: 20 });
      if (family === 'electric') burst(x, y, { kind: 'spark', count: 14, speed: [500, 900], life: [0.08, 0.18], size: [1, 1], width: 2, colors: ['#ffffff', '#9ff0ff'], drag: 0.8 });
      if (fx === 'shockwave' || fx === 'hammerquake' || fx === 'meteor') {
        burst(x, y + 110, { count: 22, speed: [80, 320], angle: -Math.PI / 2, spread: 1.4, gravity: 600, life: [0.4, 0.9], size: [8, 18], colors: ['#c9b48a', '#8f7c5c', '#ffe1a0'], drag: 0.96 });
        ring(x, y + 105, '#ffe1a0', 20, 520, 0.5, 6);
      }
      if (opts.crit) burst(x, y, { kind: 'glyph', glyphs: ['✦'], count: 6, speed: [160, 360], life: [0.4, 0.7], size: [18, 30], colors: PALETTES.gold, drag: 0.9 });
    }

    /** Effect played on the caster for support commands. */
    function aura(fx, side) {
      const { x, y } = anchor(side);
      const family = FX_FAMILY[fx] || 'white';
      const colors = PALETTES[family];
      if (fx === 'heal') {
        burst(x, y + 60, { count: 26, speed: [30, 120], angle: -Math.PI / 2, spread: 0.6, gravity: -120, life: [0.8, 1.4], size: [6, 16], colors, drag: 0.98, jitter: 50, wobble: 24 });
        burst(x, y, { kind: 'glyph', glyphs: ['✚'], count: 6, speed: [40, 110], angle: -Math.PI / 2, spread: 0.7, life: [0.8, 1.2], size: [16, 26], colors, drag: 0.97, jitter: 40 });
      } else if (fx === 'bubble') {
        burst(x, y + 50, { count: 22, speed: [20, 90], angle: -Math.PI / 2, spread: 0.8, gravity: -90, life: [1, 1.6], size: [6, 18], colors, drag: 0.99, jitter: 60, wobble: 30, alpha: 0.7 });
        ring(x, y, '#bdf3ff', 40, 180, 0.6, 4);
      } else if (fx === 'guard') {
        ring(x, y, '#cdeeff', 70, 40, 0.5, 6);
        burst(x, y, { kind: 'spark', count: 12, speed: [120, 260], life: [0.2, 0.35], size: [1, 1], width: 3, colors, drag: 0.85 });
      } else if (fx === 'focus') {
        for (let i = 0; i < (reduced ? 6 : 18); i++) {
          const a = rand(0, TAU);
          const r = rand(90, 150);
          spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.6, vy: -Math.sin(a) * r * 1.6, drag: 0.94, life: 0.6, size: rand(5, 11), color: pick(colors) });
        }
      }
    }

    /** Small trail emitted along the projectile path while an action plays. */
    function trail(fx, x, y) {
      const family = FX_FAMILY[fx];
      if (!family || quality === 'low' || reduced) return;
      const colors = PALETTES[family];
      spawn({ x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-30, 30), vy: rand(-50, 10), life: rand(0.25, 0.5), size: rand(6, 14), color: pick(colors), drag: 0.95 });
    }

    function ko(side) {
      const { x, y } = anchor(side);
      burst(x, y, { kind: 'spark', count: 40, speed: [300, 950], life: [0.3, 0.7], size: [1, 1], width: 5, colors: PALETTES.ko, drag: 0.9 });
      burst(x, y, { count: 30, speed: [60, 360], life: [0.5, 1.1], size: [16, 40], colors: PALETTES.ko, drag: 0.92 });
      ring(x, y, '#ff8a8c', 30, 420, 0.65, 8);
    }

    function confetti(side) {
      const { x } = anchor(side);
      const colors = ['#ffd45c', '#1cc8ff', '#ff4f8f', '#58e08f', '#c08bff', '#ffffff'];
      burst(x, 120, { kind: 'confetti', count: 70, speed: [120, 420], angle: -Math.PI / 2, spread: 1.3, gravity: 520, life: [1.6, 2.6], size: [8, 14], colors, drag: 0.985, spin: 8, alpha: 1 });
      burst(x, 260, { count: 24, speed: [40, 200], life: [0.8, 1.4], size: [8, 20], colors: PALETTES.gold, drag: 0.95 });
    }

    function clear() {
      while (alive.length) pool.push(alive.pop());
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) running = false;
      else if (alive.length || ambient) start();
    });

    return {
      impact, aura, trail, ko, confetti, clear, ring, burst,
      /** @param {'auto'|'high'|'low'} q */
      setQuality(q) {
        auto = q === 'auto';
        quality = q === 'low' ? 'low' : 'high';
        document.documentElement.dataset.quality = quality;
      },
      get quality() { return quality; },
      setReducedMotion(v) { reduced = !!v; },
      setAmbient(on) { ambient = !!on; if (ambient) start(); },
      get count() { return alive.length; },
    };
  }

  (root.BeastBrawl = root.BeastBrawl || {}).Particles = { create: createParticles };
})(typeof globalThis !== 'undefined' ? globalThis : this);
