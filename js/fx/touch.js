/**
 * Beast Brawl — touch / click feedback overlay.
 *
 * Visual language adopted from the MultiTouchKit `mtk-viewer` touch visualiser:
 *  - every press emits an expanding ring (radius 20→60 px, 4 px stroke, 0.35 s, alpha 1→0);
 *  - each held touch/pen contact shows a translucent filled dot with its contact number;
 *  - hue per contact = (id × 37) mod 360, so simultaneous fingers are easy to tell apart.
 * Mouse presses get the ring only. A fixed full-screen canvas that ignores pointer events
 * renders it; the loop runs only while something is visible.
 * Exposed as window.BeastBrawl.TouchFeedback.
 */
(function (root) {
  'use strict';

  const RIPPLE_MS = 350;

  function create() {
    const canvas = document.createElement('canvas');
    canvas.className = 'touch-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let dpr = 1;
    let running = false;
    let enabled = true;
    let reduced = false;
    const ripples = [];
    const contacts = new Map(); // pointerId -> { x, y, n }

    function resize() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(root.innerWidth * dpr);
      canvas.height = Math.round(root.innerHeight * dpr);
    }
    resize();
    root.addEventListener('resize', resize);

    const hue = (n) => (n * 37) % 360;

    function nextNumber() {
      const used = new Set([...contacts.values()].map((c) => c.n));
      let n = 1;
      while (used.has(n)) n++;
      return n;
    }

    function loop(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
          // rAF supplies the frame's timestamp, which can precede a pointer
          // event dispatched in that frame. Never draw a negative-radius ring.
          const p = Math.max(0, (now - r.start) / RIPPLE_MS);
        if (p >= 1) { ripples.splice(i, 1); continue; }
        const radius = (reduced ? 16 : 20) + p * (reduced ? 18 : 40);
        ctx.strokeStyle = `hsla(${r.hue}, 80%, 62%, ${1 - p})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      contacts.forEach((c) => {
        ctx.fillStyle = `hsla(${hue(c.n)}, 70%, 55%, .55)`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '700 15px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(c.n), c.x, c.y + 1);
      });
      if (ripples.length || contacts.size) requestAnimationFrame(loop);
      else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }

    function kick() {
      if (running) return;
      running = true;
      requestAnimationFrame(loop);
    }

    root.addEventListener('pointerdown', (e) => {
      if (!enabled) return;
      let n = 1;
      if (e.pointerType !== 'mouse') {
        n = nextNumber();
        contacts.set(e.pointerId, { x: e.clientX, y: e.clientY, n });
      }
      ripples.push({ x: e.clientX, y: e.clientY, start: performance.now(), hue: hue(n) });
      kick();
    }, { passive: true, capture: true });
    root.addEventListener('pointermove', (e) => {
      const c = contacts.get(e.pointerId);
      if (c) { c.x = e.clientX; c.y = e.clientY; }
    }, { passive: true, capture: true });
    const release = (e) => { contacts.delete(e.pointerId); };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => root.addEventListener(t, release, { passive: true, capture: true }));

    return {
      setEnabled(v) { enabled = !!v; if (!enabled) { ripples.length = 0; contacts.clear(); } },
      setReducedMotion(v) { reduced = !!v; },
    };
  }

  (root.BeastBrawl = root.BeastBrawl || {}).TouchFeedback = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
