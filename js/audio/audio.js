/**
 * Beast Brawl — procedural audio engine.
 *
 * Every sound effect and all music are synthesised at runtime with the Web Audio API:
 * no audio files, no downloads, no licensing exposure. The module degrades to a silent
 * no-op when Web Audio is unavailable, when `?mute=1` is in the URL, or before the first
 * user gesture (browser autoplay policy).
 *
 * Signal graph
 *   voices ─┬─> sfxBus ───┐
 *           └─> reverbSend ─> convolver ─> wet ─┤
 *   music ──> musicBus ────────────────────────┼─> master ─> compressor ─> destination
 *
 * Mixing note: small laptop/phone speakers reproduce little below ~300 Hz, so melodic and
 * bass parts are voiced with harmonics above that band; the kick is the only sub-heavy part.
 *
 * Exposed as window.BeastBrawl.Audio.
 */
(function (root) {
  'use strict';

  const AC = root.AudioContext || root.webkitAudioContext;
  const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ================================================================ engine core */

  /**
   * Builds the graph, instruments, sound effects and sequencer on a given context.
   * Works for both live AudioContext and OfflineAudioContext (used for loudness checks).
   */
  function createEngine(ctx) {
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    // Brick-wall-style limiter after the glue compressor keeps stacked hits from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    const musicBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx, 1.9, 2.6);
    const reverbSend = ctx.createGain();
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.28;
    reverbSend.connect(reverb);
    reverb.connect(reverbWet);
    reverbWet.connect(master);

    const noiseBuffer = (() => {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x3fffffff) - 1;
      }
      return buf;
    })();

    /* ------------------------------------------------------------ primitives */

    /** Attack/decay envelope on a fresh gain node. */
    function envelope(t, { attack = 0.005, hold = 0, decay = 0.2, peak = 0.2, curve = 'exp' }) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      if (hold) g.gain.setValueAtTime(peak, t + attack + hold);
      const end = t + attack + hold + decay;
      if (curve === 'lin') g.gain.linearRampToValueAtTime(0.0001, end);
      else g.gain.exponentialRampToValueAtTime(0.0001, end);
      return { node: g, end };
    }

    function route(node, { dest = sfxBus, send = 0 }) {
      node.connect(dest);
      if (send > 0) {
        const s = ctx.createGain();
        s.gain.value = send;
        node.connect(s);
        s.connect(reverbSend);
      }
    }

    /**
     * Oscillator voice.
     * @param {object} o type, freq, to (end freq), glide (s), attack, hold, decay, gain,
     *   filter {type, freq, to, q}, detune (cents), vibrato {rate, depth}, pan, dest, send, t
     */
    function tone(o) {
      const t = o.t !== undefined ? o.t : ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + (o.glide || o.decay || 0.2));
      if (o.detune) osc.detune.value = o.detune;
      if (o.vibrato) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = o.vibrato.rate;
        depth.gain.value = o.vibrato.depth;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + (o.attack || 0.005) + (o.hold || 0) + (o.decay || 0.2) + 0.05);
      }
      const env = envelope(t, { attack: o.attack, hold: o.hold, decay: o.decay, peak: o.gain || 0.2, curve: o.curve });
      let head = osc;
      if (o.filter) {
        const f = ctx.createBiquadFilter();
        f.type = o.filter.type || 'lowpass';
        f.frequency.setValueAtTime(o.filter.freq, t);
        if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, env.end);
        f.Q.value = o.filter.q || 0.7;
        head.connect(f);
        head = f;
      }
      head.connect(env.node);
      let out = env.node;
      if (o.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = o.pan;
        out.connect(p);
        out = p;
      }
      route(out, o);
      osc.start(t);
      osc.stop(env.end + 0.02);
    }

    /** Filtered white-noise voice; same options as tone() minus oscillator fields. */
    function noise(o) {
      const t = o.t !== undefined ? o.t : ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.setValueAtTime(o.freq || 1000, t);
      const env = envelope(t, { attack: o.attack, hold: o.hold, decay: o.decay, peak: o.gain || 0.2, curve: o.curve });
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.sweep ? t + o.sweep : env.end);
      f.Q.value = o.q || 0.8;
      src.connect(f);
      f.connect(env.node);
      let out = env.node;
      if (o.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = o.pan;
        out.connect(p);
        out = p;
      }
      route(out, o);
      src.start(t, Math.random() * 0.5);
      src.stop(env.end + 0.02);
    }

    /* ------------------------------------------------------------ SFX recipes */
    // Each recipe receives (t, opts) where opts.pan places the sound on the stage side.

    const SFX = {
      'ui-hover': (t) => tone({ t, type: 'sine', freq: 1500, to: 1750, decay: 0.05, gain: 0.035 }),
      'ui-click': (t) => {
        tone({ t, type: 'square', freq: 980, to: 620, decay: 0.06, gain: 0.05, filter: { freq: 3200 } });
        noise({ t, filter: 'highpass', freq: 5000, decay: 0.02, gain: 0.04 });
      },
      'ui-select': (t) => {
        tone({ t, type: 'triangle', freq: 880, decay: 0.08, gain: 0.12 });
        tone({ t: t + 0.06, type: 'triangle', freq: 1320, decay: 0.14, gain: 0.11, send: 0.2 });
      },
      'ui-confirm': (t) => {
        [660, 880, 1320, 1760].forEach((f, i) => tone({ t: t + i * 0.055, type: 'triangle', freq: f, decay: 0.16, gain: 0.11, send: 0.3 }));
        noise({ t: t + 0.18, filter: 'highpass', freq: 6000, decay: 0.25, gain: 0.05, send: 0.4 });
      },
      'ui-back': (t) => tone({ t, type: 'triangle', freq: 700, to: 420, decay: 0.12, gain: 0.1 }),
      'ui-error': (t) => {
        tone({ t, type: 'square', freq: 220, decay: 0.07, gain: 0.06, filter: { freq: 1600 } });
        tone({ t: t + 0.09, type: 'square', freq: 196, decay: 0.09, gain: 0.06, filter: { freq: 1600 } });
      },
      'ui-toggle': (t) => tone({ t, type: 'sine', freq: 1240, to: 1480, decay: 0.07, gain: 0.07 }),

      round: (t) => {
        // Gong-like bell: inharmonic partials with long decay.
        [[196, 0.16], [392 * 1.01, 0.09], [523 * 1.03, 0.06], [784 * 0.99, 0.05], [1175, 0.03]].forEach(([f, g]) =>
          tone({ t, type: 'sine', freq: f, attack: 0.004, decay: 1.6, gain: g, send: 0.5 }));
        noise({ t, filter: 'bandpass', freq: 400, to: 2400, decay: 0.5, gain: 0.07, q: 1.2 });
      },
      fight: (t) => {
        noise({ t, filter: 'lowpass', freq: 900, to: 6000, attack: 0.01, decay: 0.45, gain: 0.16 });
        [62, 65, 69, 74].forEach((m) => tone({ t: t + 0.02, type: 'sawtooth', freq: mtof(m), decay: 0.55, gain: 0.07, filter: { freq: 900, to: 4200, q: 2 }, send: 0.35 }));
        tone({ t: t + 0.02, type: 'square', freq: mtof(50), decay: 0.4, gain: 0.08, filter: { freq: 1200 } });
      },
      cutin: (t, o) => {
        noise({ t, filter: 'highpass', freq: 900, to: 7000, attack: 0.25, decay: 0.12, gain: 0.1, pan: o.pan });
        [74, 77, 81].forEach((m) => tone({ t: t + 0.3, type: 'sawtooth', freq: mtof(m), decay: 0.35, gain: 0.05, filter: { freq: 2400 }, send: 0.4, pan: o.pan }));
        tone({ t: t + 0.3, type: 'sine', freq: 1568, decay: 0.5, gain: 0.05, send: 0.5 });
      },
      whoosh: (t, o) => noise({ t, filter: 'bandpass', freq: 500, to: 2600, attack: 0.06, decay: 0.2, gain: 0.12, q: 1.4, pan: o.pan }),
      hit: (t, o) => {
        // Mid-heavy punch (1–4 kHz crack + 500 Hz body) so it reads on small speakers.
        noise({ t, filter: 'bandpass', freq: 2200, to: 700, decay: 0.14, gain: 0.85, q: 0.6, pan: o.pan });
        tone({ t, type: 'square', freq: 620, to: 200, decay: 0.09, gain: 0.26, filter: { freq: 2600 }, pan: o.pan });
        tone({ t, type: 'sine', freq: 200, to: 70, decay: 0.15, gain: 0.22, pan: o.pan });
      },
      heavy: (t, o) => {
        SFX.hit(t, o);
        tone({ t, type: 'sawtooth', freq: 160, to: 50, decay: 0.3, gain: 0.16, filter: { freq: 1800, to: 300 }, pan: o.pan });
        noise({ t: t + 0.02, filter: 'bandpass', freq: 900, to: 300, decay: 0.42, gain: 0.26, q: 0.7, send: 0.35, pan: o.pan });
      },
      crit: (t, o) => {
        SFX.heavy(t, o);
        tone({ t: t + 0.02, type: 'sine', freq: 2349, decay: 0.55, gain: 0.07, send: 0.5, pan: o.pan });
        tone({ t: t + 0.02, type: 'sine', freq: 3520, decay: 0.4, gain: 0.04, send: 0.5, pan: o.pan });
      },
      miss: (t, o) => noise({ t, filter: 'bandpass', freq: 2600, to: 5200, attack: 0.03, decay: 0.16, gain: 0.08, q: 2, pan: o.pan }),
      guard: (t, o) => {
        [523, 784, 1175, 1661].forEach((f, i) => tone({ t, type: i % 2 ? 'square' : 'triangle', freq: f, decay: 0.28 - i * 0.04, gain: 0.05, filter: { type: 'bandpass', freq: 1500, q: 1.5 }, send: 0.25, pan: o.pan }));
        noise({ t, filter: 'highpass', freq: 3500, decay: 0.05, gain: 0.12, pan: o.pan });
      },
      shield: (t, o) => {
        for (let i = 0; i < 6; i++) {
          const f = 660 * Math.pow(2, i / 4);
          tone({ t: t + i * 0.045, type: 'sine', freq: f, to: f * 1.5, glide: 0.4, attack: 0.03, decay: 0.55, gain: 0.045, vibrato: { rate: 9, depth: 12 }, send: 0.55, pan: o.pan });
        }
        noise({ t, filter: 'bandpass', freq: 1800, to: 5200, attack: 0.15, decay: 0.4, gain: 0.04, q: 3, send: 0.4 });
      },
      heal: (t, o) => {
        [72, 76, 79, 84, 88].forEach((m, i) => tone({ t: t + i * 0.07, type: 'triangle', freq: mtof(m), decay: 0.5, gain: 0.07, send: 0.55, pan: o.pan }));
        noise({ t: t + 0.1, filter: 'highpass', freq: 7000, attack: 0.1, decay: 0.5, gain: 0.04, send: 0.5 });
      },
      focus: (t, o) => {
        tone({ t, type: 'sine', freq: 330, to: 990, glide: 0.5, attack: 0.08, hold: 0.25, decay: 0.3, gain: 0.08, vibrato: { rate: 7, depth: 10 }, send: 0.4, pan: o.pan });
        tone({ t: t + 0.45, type: 'sine', freq: 1976, decay: 0.45, gain: 0.05, send: 0.5 });
      },
      stun: (t, o) => {
        [0, 0.14, 0.28].forEach((d, i) => tone({ t: t + d, type: 'triangle', freq: 1100 - i * 180, to: 500 - i * 60, decay: 0.16, gain: 0.07, vibrato: { rate: 14, depth: 40 }, pan: o.pan }));
      },
      ko: (t) => {
        noise({ t, filter: 'bandpass', freq: 2000, to: 250, decay: 1.1, gain: 0.4, q: 0.5, send: 0.6 });
        tone({ t, type: 'sine', freq: 150, to: 40, decay: 0.8, gain: 0.25 });
        tone({ t, type: 'sawtooth', freq: 420, to: 70, decay: 0.8, gain: 0.08, filter: { freq: 2000, to: 300 }, send: 0.5 });
        [69, 65, 62].forEach((m, i) => tone({ t: t + 0.25 + i * 0.16, type: 'square', freq: mtof(m), decay: 0.35, gain: 0.05, filter: { freq: 2200 }, send: 0.4 }));
      },
    };

    /** Skill "cast" flavours keyed by fx; played when an action starts. */
    const CAST = {
      ember: (t, o) => { SFX.whoosh(t, o); crackle(t + 0.05, 5, o); },
      fireball: (t, o) => {
        noise({ t, filter: 'lowpass', freq: 400, to: 3200, attack: 0.15, decay: 0.35, gain: 0.2, pan: o.pan });
        crackle(t + 0.1, 9, o);
      },
      meteor: (t, o) => {
        tone({ t, type: 'sine', freq: 2200, to: 380, glide: 0.75, attack: 0.05, hold: 0.4, decay: 0.35, gain: 0.07, send: 0.3 });
        noise({ t: t + 0.3, filter: 'lowpass', freq: 300, to: 1600, attack: 0.3, decay: 0.3, gain: 0.16 });
      },
      water: (t, o) => {
        for (let i = 0; i < 6; i++) {
          const f = 420 + ((i * 137) % 380);
          tone({ t: t + i * 0.045, type: 'sine', freq: f, to: f * 1.9, glide: 0.06, decay: 0.07, gain: 0.08, pan: o.pan });
        }
        noise({ t, filter: 'bandpass', freq: 900, to: 2600, decay: 0.3, gain: 0.08, q: 1.2, pan: o.pan });
      },
      wind: (t, o) => noise({ t, filter: 'bandpass', freq: 380, to: 1900, sweep: 0.45, attack: 0.2, hold: 0.15, decay: 0.35, gain: 0.16, q: 3, pan: o.pan }),
      shockwave: (t, o) => {
        tone({ t, type: 'sine', freq: 120, to: 50, decay: 0.3, gain: 0.18 });
        noise({ t, filter: 'bandpass', freq: 1200, to: 400, decay: 0.25, gain: 0.12 });
        noise({ t: t + 0.05, filter: 'lowpass', freq: 700, to: 250, attack: 0.05, decay: 0.6, gain: 0.2, pan: o.pan });
      },
      shadow: (t, o) => [0, 0.08, 0.16].forEach((d) => noise({ t: t + d, filter: 'highpass', freq: 2400, to: 6500, attack: 0.02, decay: 0.07, gain: 0.08, pan: o.pan })),
      leaf: (t, o) => [0, 0.06, 0.12, 0.18].forEach((d, i) => {
        noise({ t: t + d, filter: 'bandpass', freq: 3000 + i * 400, to: 5200, attack: 0.02, decay: 0.08, gain: 0.06, q: 2, pan: o.pan });
        tone({ t: t + d, type: 'triangle', freq: 1760 + i * 220, decay: 0.05, gain: 0.03 });
      }),
      hammer: (t, o) => noise({ t, filter: 'bandpass', freq: 300, to: 1400, attack: 0.15, decay: 0.12, gain: 0.14, q: 1.2, pan: o.pan }),
      airhammer: (t, o) => {
        tone({ t, type: 'sawtooth', freq: 180, attack: 0.05, hold: 0.25, decay: 0.15, gain: 0.05, vibrato: { rate: 38, depth: 30 }, filter: { freq: 1800 }, pan: o.pan });
        SFX.whoosh(t + 0.25, o);
      },
      hammerquake: (t, o) => {
        tone({ t, type: 'sine', freq: 1800, to: 300, glide: 0.5, attack: 0.03, hold: 0.2, decay: 0.3, gain: 0.06 });
        SFX.whoosh(t + 0.35, o);
      },
      note: (t, o) => [76, 83].forEach((m, i) => tone({ t: t + i * 0.09, type: 'triangle', freq: mtof(m), decay: 0.35, gain: 0.08, send: 0.4, pan: o.pan })),
      bass: (t, o) => [50, 53, 57, 62].forEach((m) => tone({ t, type: 'sawtooth', freq: mtof(m), attack: 0.02, hold: 0.25, decay: 0.35, gain: 0.05, filter: { freq: 500, to: 2600, q: 5 }, send: 0.35, pan: o.pan })),
      electric: (t, o) => zap(t, 7, o),
      bubble: (t, o) => SFX.shield(t, o),
      heal: (t, o) => SFX.heal(t, o),
      guard: (t, o) => SFX.guard(t, o),
      focus: (t, o) => SFX.focus(t, o),
    };

    /** Impact flavours layered on top of the generic hit. */
    const IMPACT = {
      ember: (t, o) => crackle(t, 4, o),
      fireball: (t, o) => crackle(t, 8, o),
      water: (t, o) => noise({ t, filter: 'bandpass', freq: 1400, to: 600, decay: 0.25, gain: 0.14, q: 0.9, pan: o.pan }),
      electric: (t, o) => zap(t, 4, o),
      hammer: (t, o) => clang(t, o),
      airhammer: (t, o) => clang(t, o),
      note: (t, o) => tone({ t, type: 'triangle', freq: mtof(88), decay: 0.3, gain: 0.05, send: 0.4, pan: o.pan }),
      bass: (t, o) => tone({ t, type: 'sawtooth', freq: mtof(38), decay: 0.4, gain: 0.08, filter: { freq: 900 } }),
      leaf: (t, o) => noise({ t, filter: 'highpass', freq: 4000, decay: 0.1, gain: 0.08, pan: o.pan }),
    };
    const HEAVY_FX = ['meteor', 'shockwave', 'hammerquake', 'hammer', 'airhammer', 'fireball'];

    function crackle(t, count, o) {
      for (let i = 0; i < count; i++) {
        noise({ t: t + i * 0.035 + (i % 3) * 0.01, filter: 'bandpass', freq: 1800 + (i * 431) % 2400, decay: 0.03, gain: 0.07, q: 4, pan: o.pan });
      }
    }
    function zap(t, count, o) {
      for (let i = 0; i < count; i++) {
        const f = 300 + (i * 397) % 900;
        tone({ t: t + i * 0.04, type: 'sawtooth', freq: f, to: f * 2.4, glide: 0.03, decay: 0.04, gain: 0.05, filter: { type: 'bandpass', freq: 2200, q: 2 }, pan: o.pan });
      }
      noise({ t, filter: 'highpass', freq: 5000, decay: count * 0.04, gain: 0.05, pan: o.pan });
    }
    function clang(t, o) {
      [880, 1324, 1987, 2650].forEach((f, i) => tone({ t, type: 'sine', freq: f, decay: 0.5 - i * 0.08, gain: 0.05, send: 0.35, pan: o.pan }));
    }

    /* ------------------------------------------------------------ music */

    const instruments = {
      lead(m, t, dur, gain = 0.055) {
        tone({ t, type: 'square', freq: mtof(m), attack: 0.01, hold: Math.max(0, dur - 0.08), decay: 0.12, gain, filter: { freq: 2600, q: 1 }, vibrato: { rate: 5.5, depth: 4 }, dest: musicBus, send: 0.18 });
        tone({ t, type: 'sawtooth', freq: mtof(m), detune: 7, attack: 0.01, hold: Math.max(0, dur - 0.08), decay: 0.12, gain: gain * 0.35, filter: { freq: 2000 }, dest: musicBus });
      },
      bell(m, t, dur, gain = 0.05) {
        tone({ t, type: 'sine', freq: mtof(m), attack: 0.004, decay: Math.max(0.4, dur * 1.4), gain, dest: musicBus, send: 0.35 });
        tone({ t, type: 'sine', freq: mtof(m + 12) * 1.003, attack: 0.004, decay: 0.35, gain: gain * 0.3, dest: musicBus, send: 0.35 });
      },
      pluck(m, t, gain = 0.035) {
        tone({ t, type: 'triangle', freq: mtof(m), attack: 0.003, decay: 0.22, gain, dest: musicBus, send: 0.2 });
      },
      pad(notes, t, dur, gain = 0.018) {
        notes.forEach((m) => [-6, 6].forEach((d) => tone({ t, type: 'sawtooth', freq: mtof(m), detune: d, attack: 0.25, hold: Math.max(0, dur - 0.6), decay: 0.35, gain, curve: 'lin', filter: { freq: 1500, q: 0.5 }, dest: musicBus, send: 0.25 })));
      },
      bass(m, t, dur, gain = 0.06) {
        // Saw bass an octave above the usual register; its harmonics carry on small speakers.
        tone({ t, type: 'sawtooth', freq: mtof(m), attack: 0.005, hold: Math.max(0, dur * 0.6), decay: dur * 0.4 + 0.05, gain, filter: { freq: 1300, to: 500, q: 2 }, dest: musicBus });
      },
      kick(t, gain = 0.32) {
        tone({ t, type: 'sine', freq: 165, to: 48, glide: 0.11, decay: 0.22, gain, dest: musicBus });
        noise({ t, filter: 'bandpass', freq: 2600, decay: 0.012, gain: gain * 0.25, dest: musicBus });
      },
      snare(t, gain = 0.12) {
        noise({ t, filter: 'bandpass', freq: 1900, decay: 0.16, gain, q: 0.8, dest: musicBus, send: 0.15 });
        tone({ t, type: 'triangle', freq: 210, to: 160, decay: 0.07, gain: gain * 0.7, dest: musicBus });
      },
      hat(t, open = false, gain = 0.035) {
        noise({ t, filter: 'highpass', freq: 7200, decay: open ? 0.16 : 0.035, gain, dest: musicBus });
      },
    };

    const CHORD = { m: [0, 3, 7], M: [0, 4, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
    const chordNotes = ([root, q], octaveShift = 0) => CHORD[q].map((i) => root + i + octaveShift);

    /**
     * Tracks: original compositions. `steps` are 16th notes; melodies are 8th-note grids
     * (null = rest, notes sustain until the next onset, up to `maxHold` eighths).
     */
    const TRACKS = {
      select: {
        bpm: 92,
        loop: true,
        chords: [[53, 'M7'], [55, 'M'], [52, 'm7'], [57, 'm'], [53, 'M7'], [55, 'M'], [52, 'm7'], [57, 'm']],
        melody: [
          [76, null, null, null, 72, null, null, null],
          [74, null, null, null, 71, null, 67, null],
          [71, null, null, null, 76, null, 74, null],
          [72, null, null, null, null, null, null, null],
          [81, null, 79, null, 76, null, null, null],
          [74, null, null, null, 79, null, null, null],
          [83, null, 81, null, 79, null, 76, null],
          [81, null, null, null, null, null, null, null],
        ],
        play(step, bar, chord, t, s16) {
          const notes = chordNotes(chord, 12);
          const pos = step % 16;
          if (pos === 0) instruments.pad(chordNotes(chord), t, s16 * 16, 0.022);
          if (pos % 8 === 0) instruments.bass(chord[0], t, s16 * 7, 0.07);
          if (pos % 2 === 0) {
            const arp = [0, 1, 2, 1, 0, 1, 2, 1];
            instruments.pluck(notes[arp[pos / 2] % notes.length] + (pos === 6 ? 12 : 0), t, 0.05);
          }
          if (pos % 4 === 2) instruments.hat(t, false, 0.03);
          if (pos === 4 || pos === 12) instruments.snare(t, 0.035);
          this.melodyAt(step, bar, t, s16, (m, d) => instruments.bell(m, t, d, 0.085));
        },
      },
      battle: {
        bpm: 148,
        loop: true,
        chords: [[62, 'm'], [58, 'M'], [60, 'M'], [57, 'M'], [62, 'm'], [58, 'M'], [60, 'M'], [57, 'M']],
        melody: [
          [69, null, 74, null, 76, 77, 76, 74],
          [77, null, null, 74, null, 70, 72, 74],
          [76, null, 79, null, 77, 76, 74, 72],
          [73, null, 76, null, 81, null, null, null],
          [74, 77, 81, null, 79, 77, 76, 77],
          [74, null, 77, null, 82, 81, 79, 77],
          [79, null, 76, null, 72, 74, 76, 79],
          [81, null, 79, null, 76, null, 73, null],
        ],
        play(step, bar, chord, t, s16) {
          const pos = step % 16;
          const root = chord[0] - 12;
          if (pos === 0) instruments.pad(chordNotes(chord), t, s16 * 16, 0.012);
          if (pos % 2 === 0) {
            const shape = [0, 0, 12, 0, 7, 0, 12, 10];
            instruments.bass(root + shape[pos / 2], t, s16 * 1.6, 0.05);
          }
          if (pos === 0 || pos === 8 || (bar % 2 === 1 && pos === 10)) instruments.kick(t, 0.3);
          if (pos === 4 || pos === 12) instruments.snare(t, 0.11);
          if (pos % 2 === 0) instruments.hat(t, pos === 14, 0.03);
          else if (bar % 4 === 3) instruments.hat(t, false, 0.018);
          if (pos % 1 === 0 && bar >= 4) {
            const notes = chordNotes(chord, 12);
            instruments.pluck(notes[(step >> 0) % notes.length] + 12, t, 0.012);
          }
          this.melodyAt(step, bar, t, s16, (m, d) => instruments.lead(m, t, d, 0.04));
        },
      },
      victory: {
        bpm: 150,
        loop: false,
        bars: 2,
        chords: [[60, 'M'], [60, 'M']],
        melody: [
          [72, 76, 79, 84, null, 79, 84, null],
          [88, null, null, null, null, null, null, null],
        ],
        play(step, bar, chord, t, s16) {
          const pos = step % 16;
          if (bar === 1 && pos === 0) {
            instruments.pad([60, 64, 67, 72], t, s16 * 12, 0.02);
            instruments.kick(t, 0.25);
            instruments.hat(t, true, 0.04);
          }
          if (bar === 0 && pos % 4 === 0) instruments.snare(t, 0.05);
          this.melodyAt(step, bar, t, s16, (m, d) => { instruments.lead(m, t, d, 0.05); instruments.bell(m, t, d, 0.03); });
        },
      },
    };

    // Shared melody helper: plays the 8th-note grid with sustained notes.
    Object.values(TRACKS).forEach((track) => {
      track.bars = track.bars || track.chords.length;
      track.melodyAt = function (step, bar, t, s16, play) {
        if (step % 2) return;
        const row = this.melody[bar % this.melody.length];
        const i = (step % 16) / 2;
        const m = row[i];
        if (m == null) return;
        let len = 1;
        while (i + len < 8 && row[i + len] == null && len < 4) len++;
        play(m, len * 2 * s16 * 0.92);
      };
    });

    /** Lookahead sequencer ("A Tale of Two Clocks"): schedules notes slightly ahead of time. */
    const seq = { track: null, name: null, step: 0, nextTime: 0, startedAt: 0 };

    function scheduleUntil(horizon) {
      const tr = seq.track;
      if (!tr) return;
      const s16 = 60 / tr.bpm / 4;
      const totalSteps = tr.bars * 16;
      while (seq.nextTime < horizon) {
        if (seq.step >= totalSteps) {
          if (!tr.loop) { seq.track = null; seq.name = null; return; }
          seq.step = 0;
        }
        const bar = Math.floor(seq.step / 16);
        try { tr.play(seq.step, bar, tr.chords[bar % tr.chords.length], seq.nextTime, s16); } catch (e) { /* never break the loop */ }
        seq.step++;
        seq.nextTime += s16;
      }
    }

    function startTrack(name, when) {
      seq.track = TRACKS[name] || null;
      seq.name = seq.track ? name : null;
      seq.step = 0;
      seq.nextTime = when;
      seq.startedAt = when;
    }

    function playSfx(name, opts = {}) {
      const fn = SFX[name];
      if (fn) fn(opts.t !== undefined ? opts.t : ctx.currentTime, opts);
    }

    /** Cast/impact sounds for a roster skill. phase: 'cast' | 'impact' | 'miss'. */
    function playSkill(skill, phase, opts = {}) {
      const t = opts.t !== undefined ? opts.t : ctx.currentTime;
      const fx = skill.fx || '';
      if (phase === 'cast') { (CAST[fx] || SFX.whoosh)(t, opts); return; }
      if (phase === 'miss') { SFX.miss(t, opts); return; }
      if (opts.crit) SFX.crit(t, opts);
      else if (HEAVY_FX.includes(fx) || skill.type === 'stun') SFX.heavy(t, opts);
      else SFX.hit(t, opts);
      if (IMPACT[fx]) IMPACT[fx](t + 0.01, opts);
    }

    return { ctx, master, sfxBus, musicBus, playSfx, playSkill, startTrack, scheduleUntil, seq, TRACKS, SFX_NAMES: Object.keys(SFX), CAST_NAMES: Object.keys(CAST) };
  }

  function impulseResponse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /* ================================================================ public facade */

  // Bus trims chosen from offline loudness checks (RMS above 300 Hz; see docs/AUDIO.md).
  const MUSIC_TRIM = 1.4;
  const SFX_TRIM = 2.6;
  const params = new URLSearchParams((root.location && root.location.search) || '');
  const forcedMute = params.get('mute') === '1';

  let engine = null;
  let wanted = null;        // music track requested before unlock
  let timer = null;
  let settings = null;

  function applyVolumes() {
    if (!engine || !settings) return;
    const t = engine.ctx.currentTime;
    const on = settings.get('muted') ? 0 : 1;
    engine.master.gain.setTargetAtTime(on * settings.get('masterVolume'), t, 0.03);
    engine.musicBus.gain.setTargetAtTime(MUSIC_TRIM * settings.get('musicVolume'), t, 0.05);
    engine.sfxBus.gain.setTargetAtTime(SFX_TRIM * settings.get('sfxVolume'), t, 0.03);
  }

  function pump() {
    if (!engine || engine.ctx.state !== 'running') return;
    engine.scheduleUntil(engine.ctx.currentTime + 0.15);
  }

  const Audio = {
    /** Whether a live context exists and is running. */
    get ready() { return !!engine && engine.ctx.state === 'running'; },

    /** Wires the settings store; call once at boot. */
    init(store) {
      settings = store;
      settings.subscribe((key) => {
        if (['muted', 'masterVolume', 'musicVolume', 'sfxVolume'].includes(key)) applyVolumes();
      });
      if (root.document) {
        root.document.addEventListener('visibilitychange', () => {
          if (!engine) return;
          if (root.document.hidden) engine.ctx.suspend().catch(() => {});
          else engine.ctx.resume().catch(() => {});
        });
      }
    },

    /** Must be called from a user-gesture handler (autoplay policy). Safe to call often. */
    unlock() {
      if (forcedMute || !AC) return;
      try {
        if (!engine) {
          engine = createEngine(new AC({ latencyHint: 'interactive' }));
          applyVolumes();
          timer = setInterval(pump, 30);
        }
        if (engine.ctx.state !== 'running') {
          engine.ctx.resume().then(() => {
            if (wanted && engine.seq.name !== wanted) Audio.music(wanted);
          }).catch(() => {});
        } else if (wanted && engine.seq.name !== wanted) {
          Audio.music(wanted);
        }
      } catch (e) {
        engine = null; // audio is optional; never break the game
      }
    },

    /** Switches music ('select' | 'battle' | 'victory' | null). Deferred until unlocked. */
    music(name) {
      wanted = name === 'victory' ? null : name;
      if (!Audio.ready) return;
      if (engine.seq.name === name && name !== 'victory') return;
      const t = engine.ctx.currentTime;
      const g = engine.musicBus.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.06);
      engine.startTrack(name, t + 0.25);
      g.setTargetAtTime(MUSIC_TRIM * (settings ? settings.get('musicVolume') : 0.6), t + 0.25, 0.04);
    },

    sfx(name, opts) {
      if (!Audio.ready || (settings && settings.get('muted'))) return;
      try { engine.playSfx(name, opts); } catch (e) { /* ignore */ }
    },

    skill(skill, phase, opts) {
      if (!Audio.ready || (settings && settings.get('muted'))) return;
      try { engine.playSkill(skill, phase, opts); } catch (e) { /* ignore */ }
    },

    /**
     * Renders audio offline (for loudness checks and previews). `script(engine)` schedules
     * sounds using absolute times. Resolves to an AudioBuffer.
     */
    renderOffline(seconds, script, sampleRate = 44100) {
      if (!OAC) return Promise.reject(new Error('OfflineAudioContext unavailable'));
      const ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
      const eng = createEngine(ctx);
      eng.musicBus.gain.value = MUSIC_TRIM * 0.6;
      eng.sfxBus.gain.value = SFX_TRIM * 0.85;
      eng.master.gain.value = 0.8;
      script(eng, { MUSIC_TRIM, SFX_TRIM });
      return ctx.startRendering();
    },
  };

  (root.BeastBrawl = root.BeastBrawl || {}).Audio = Audio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
