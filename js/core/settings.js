/**
 * Beast Brawl — persisted player settings.
 *
 * A tiny observable store backed by localStorage. Storage can be unavailable (private mode,
 * blocked site data, file:// in some browsers), so every access is guarded and the game
 * always falls back to defaults. Exposed as window.BeastBrawl.Settings.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'beast-brawl.settings.v1';

  const DEFAULTS = Object.freeze({
    muted: false,
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.85,
    tempo: 1,               // battle speed: 1 | 1.5 | 2
    quality: 'auto',        // 'auto' | 'high' | 'low'
    reducedMotion: 'auto',  // 'auto' | 'on' | 'off'
  });

  const VALIDATORS = {
    muted: (v) => typeof v === 'boolean',
    masterVolume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
    musicVolume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
    sfxVolume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
    tempo: (v) => [1, 1.5, 2].includes(v),
    quality: (v) => ['auto', 'high', 'low'].includes(v),
    reducedMotion: (v) => ['auto', 'on', 'off'].includes(v),
  };

  function load() {
    const out = { ...DEFAULTS };
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return out;
      const saved = JSON.parse(raw);
      Object.keys(DEFAULTS).forEach((k) => {
        if (k in saved && VALIDATORS[k](saved[k])) out[k] = saved[k];
      });
    } catch (e) { /* storage unavailable or corrupt: use defaults */ }
    return out;
  }

  const values = load();
  const listeners = new Set();

  function persist() {
    try { root.localStorage && root.localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (e) { /* ignore */ }
  }

  const Settings = {
    DEFAULTS,
    get(key) { return values[key]; },
    all() { return { ...values }; },
    /** Updates one key (ignored when invalid) and notifies subscribers. */
    set(key, value) {
      if (!(key in VALIDATORS) || !VALIDATORS[key](value) || values[key] === value) return;
      values[key] = value;
      persist();
      listeners.forEach((fn) => { try { fn(key, value, Settings); } catch (e) { console.error(e); } });
    },
    reset() { Object.keys(DEFAULTS).forEach((k) => Settings.set(k, DEFAULTS[k])); },
    /** @returns {() => void} unsubscribe */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Effective reduced-motion preference (setting overrides the OS media query). */
    prefersReducedMotion() {
      if (values.reducedMotion !== 'auto') return values.reducedMotion === 'on';
      return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    },
  };

  (root.BeastBrawl = root.BeastBrawl || {}).Settings = Settings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
