// npm run music-check — renders every procedural track offline (one full loop,
// plus the warm / intensity variants) in headless Chrome and prints levels:
// peak, RMS, quietest/loudest 2 s window, clipped samples, and how long the
// render took. Run it after changing src/data/music.json.
//   node scripts/music-check.mjs [--tracks title,boss] [--seconds 40] [--harmony]
// --harmony: only the note-vs-chord report (fast, no audio rendering).
// Levels are what the music bus carries BEFORE the Settings volume (default
// 0.75) and the master limiter.
import { launchChrome } from './lib/cdp.mjs';
import { startServer } from './lib/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const only = opt('--tracks', null)?.split(',');
const capSeconds = Number(opt('--seconds', 0)) || null;
const harmonyOnly = args.includes('--harmony');

const server = await startServer();
const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  await page.goto(`${server.url}?music=title`);
  await page.waitFor('document.querySelector("select") !== null', { timeout: 30000 });
  const rows = await page.eval(`(async () => {
    const m = await import('/src/systems/Music.js');
    const only = ${JSON.stringify(only)};
    const cap = ${JSON.stringify(capSeconds)};
    const jobs = [];
    for (const key of ${harmonyOnly} ? [] : m.trackKeys()) {
      if (only && !only.includes(key)) continue;
      jobs.push([key, {}, key]);
      if (key === 'battle' || key === 'boss') jobs.push([key, { warm: true }, key + ' (warm)']);
      if (key === 'boss') jobs.push([key, { intensity: 1 }, key + ' (intensity 1)']);
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120).toFixed(1);
    const out = [];
    for (const [key, opts, label] of jobs) {
      const seconds = cap || m.trackSeconds(key);
      const t0 = performance.now();
      const buf = await m.renderTrack(key, seconds, opts);
      const ms = performance.now() - t0;
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      let peak = 0, sum = 0, clipped = 0;
      const win = Math.floor(buf.sampleRate * 2);
      const wins = [];
      let wsum = 0;
      for (let i = 0; i < L.length; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (a > peak) peak = a;
        if (a >= 1) clipped++;
        const sq = (L[i] * L[i] + R[i] * R[i]) / 2;
        sum += sq; wsum += sq;
        if ((i + 1) % win === 0) { wins.push(Math.sqrt(wsum / win)); wsum = 0; }
      }
      out.push({ label, seconds: Math.round(seconds), peak: db(peak), rms: db(Math.sqrt(sum / L.length)), quiet: db(Math.min(...wins)), loud: db(Math.max(...wins)), clipped, renderMs: Math.round(ms) });
    }
    // Harmony report from the notes actually fired: pitched layers against their chord.
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const harmony = {};
    for (const key of m.trackKeys()) {
      if (only && !only.includes(key)) continue;
      for (const warm of key === 'battle' || key === 'boss' ? [false, true] : [false]) {
        const trace = [];
        await m.renderTrack(key, Math.min(cap || 1e9, m.trackSeconds(key)), { intensity: 1, warm, trace, sampleRate: 8000 });
        const stat = { notes: 0, chordTone: 0, scaleOnly: 0, outside: 0, clashes: [], snapped: 0 };
        for (const n of trace) {
          if (n.type === 'kick' || n.type === 'snare' || n.type === 'hat' || n.type === 'swell') continue;
          const pc = n.midi % 12;
          stat.notes++;
          if (n.tones.slice(0, 3).includes(pc) || n.tones[3] === pc) stat.chordTone++;
          else if (n.scale.includes(pc)) stat.scaleOnly++;
          else stat.outside++;
          if (n.snapped) stat.snapped++;
          // Any melody note still a semitone ABOVE a chord tone (e.g. Bb over A) would be a clash.
          if (n.mode === 'scale' && !n.tones.includes(pc) && n.tones.slice(0, 3).some((c) => (pc - c + 12) % 12 === 1)) {
            stat.clashes.push('bar ' + (n.bar + 1) + ' ' + n.layer + ' ' + names[pc] + ' over ' + n.chord);
          }
        }
        harmony[key + (warm ? ' (warm)' : '')] = stat;
      }
    }
    out.push({ harmony });
    return out;
  })()`);
  const harmony = rows.find((r) => r.harmony)?.harmony;
  rows.splice(rows.findIndex((r) => r.harmony), 1);
  if (rows.length) console.log('track'.padEnd(22), 'sec', 'peak dBFS', 'RMS dBFS', 'quiet..loud (2 s RMS)', 'clipped', 'render');
  for (const r of rows) {
    console.log(r.label.padEnd(22), String(r.seconds).padStart(3), r.peak.padStart(9), r.rms.padStart(8), `${r.quiet}..${r.loud}`.padStart(21), String(r.clipped).padStart(7), `${r.renderMs} ms`);
  }
  if (harmony) {
    console.log('\nharmony (every pitched note vs its chord; intensity 1):');
    for (const [k, s] of Object.entries(harmony)) {
      const pct = (x) => `${Math.round((100 * x) / Math.max(1, s.notes))}%`;
      console.log(`  ${k.padEnd(16)} ${String(s.notes).padStart(5)} notes  chord tones ${pct(s.chordTone).padStart(4)}  other scale tones ${pct(s.scaleOnly).padStart(4)}  outside scale ${pct(s.outside).padStart(4)}  melody notes snapped ${String(s.snapped).padStart(3)}  clashes left ${s.clashes.length}`);
      for (const c of [...new Set(s.clashes)].slice(0, 30)) console.log(`      ! ${c}`);
    }
    const w = harmony['battle (warm)'], c = harmony.battle;
    if (w && c && w.chordTone === c.chordTone && w.scaleOnly === c.scaleOnly) {
      console.log('  FAIL: warm variant plays the same notes as the cool one');
      process.exitCode = 1;
    }
  }
  if (page.errors.length) {
    console.log('page errors:', page.errors);
    process.exitCode = 1;
  }
} finally {
  await chrome.close();
  await server.close();
}
