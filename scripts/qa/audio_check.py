"""Offline-renders the procedural music and SFX in headless Chrome, reports loudness above
300 Hz (what small laptop/phone speakers actually reproduce) and writes WAV previews.

    python3 scripts/qa/audio_check.py [OUT_DIR]      # default: .qa/audio

Columns: peak dBFS, RMS of the full band, RMS after a 300 Hz high-pass, and the loudest
400 ms window after the high-pass (short-term).
"""
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Chrome  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.qa', 'audio'))

JS = r'''
(async () => {
  const A = BeastBrawl.Audio;
  function hp300(x, sr) {
    const w = 2 * Math.PI * 300 / sr, q = Math.SQRT1_2, al = Math.sin(w) / (2 * q), c = Math.cos(w);
    const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  function stats(buf) {
    const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.getChannelData(1);
    const mono = new Float32Array(L.length); let peak = 0;
    for (let i = 0; i < L.length; i++) { mono[i] = (L[i] + R[i]) / 2; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    const db = (v) => +(20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const h = hp300(mono, sr), win = Math.floor(sr * 0.4); let st = 0;
    for (let i = 0; i + win <= h.length; i += win >> 1) st = Math.max(st, rms(h.subarray(i, i + win)));
    return { peak: db(peak), rms: db(rms(mono)), rmsHp300: db(rms(h)), shortTermHp300: db(st) };
  }
  function wav(buf) {
    const n = buf.length, sr = buf.sampleRate, v = new DataView(new ArrayBuffer(44 + n * 4));
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, n * 4, true);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    let out = ''; const u = new Uint8Array(v.buffer);
    for (let i = 0; i < u.length; i += 32768) out += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(out);
  }
  const TAIL = 2.5;
  // Track lengths come from the engine's own tempo/bar data (probe render, no hard-coded copies).
  const LEN = {};
  await A.renderOffline(0.01, (e) => { for (const [n, t] of Object.entries(e.TRACKS)) LEN[n] = t.bars * 16 * (60 / t.bpm / 4); });
  const loopSeconds = (name) => LEN[name];
  const jobs = {
    // Music previews render exactly one full loop (every bar of the piece) plus a reverb tail,
    // so the WAV ends where the piece ends instead of cutting off mid-phrase.
    'music-select': [loopSeconds('select') + TAIL, (e) => { e.startTrack('select', 0.05); e.scheduleUntil(0.05 + loopSeconds('select') - 1e-3); }],
    'music-battle': [loopSeconds('battle') + TAIL, (e) => { e.startTrack('battle', 0.05); e.scheduleUntil(0.05 + loopSeconds('battle') - 1e-3); }],
    'music-victory': [loopSeconds('victory') + TAIL, (e) => { e.startTrack('victory', 0.05); e.scheduleUntil(0.05 + loopSeconds('victory') - 1e-3); }],
    'sfx-ui': [3.2, (e) => ['ui-hover', 'ui-click', 'ui-select', 'ui-confirm', 'ui-back', 'ui-error', 'ui-toggle'].forEach((n, i) => e.playSfx(n, { t: 0.05 + i * 0.42 }))],
    'sfx-combat': [9, (e) => ['round', 'fight', 'hit', 'heavy', 'crit', 'miss', 'guard', 'shield', 'heal', 'focus', 'stun', 'cutin', 'ko'].forEach((n, i) => e.playSfx(n, { t: 0.05 + i * 0.65 }))],
    'sfx-skills': [16, (e) => { let t = 0.05; BeastBrawl.Roster.CHARACTERS.forEach((c) => c.skills.forEach((s) => { e.playSkill(s, 'cast', { t }); e.playSkill(s, 'impact', { t: t + 0.55 }); t += 0.85; })); }],
    'mix-battle-with-hits': [10, (e) => { e.startTrack('battle', 0.05); e.scheduleUntil(10); for (let i = 0; i < 6; i++) e.playSfx(i % 2 ? 'heavy' : 'hit', { t: 1 + i * 1.4 }); }],
  };
  const out = {};
  for (const [name, [sec, fn]] of Object.entries(jobs)) { const b = await A.renderOffline(sec, fn); out[name] = { stats: stats(b), wav: wav(b) }; }
  return out;
})()
'''

os.makedirs(OUT, exist_ok=True)
with Chrome(800, 600) as c:
    c.goto('file://' + os.path.join(ROOT, 'index.html') + '?mute=1')
    result = c.eval(JS, timeout=300)
    errors = c.errors()
print(f'{"render":22s} {"peak":>6s} {"rms":>6s} {"rms>300":>8s} {"st>300":>7s}')
for name, v in result.items():
    path = os.path.join(OUT, name + '.wav')
    with open(path, 'wb') as f:
        f.write(base64.b64decode(v['wav']))
    s = v['stats']
    print(f'{name:22s} {s["peak"]:6.1f} {s["rms"]:6.1f} {s["rmsHp300"]:8.1f} {s["shortTermHp300"]:7.1f}')
print('WAV previews:', OUT)
if errors:
    print('page errors:', errors)
    sys.exit(1)
