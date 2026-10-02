// npm run music-perf — what does the procedural music cost? A rainy battle in
// headless Chrome under 4x CPU throttling, measured twice in the SAME page:
// first before the audio unlock (no AudioContext = no music, no SFX), then with
// the music playing. Reports average fps, main-thread script time and the whole
// browser's CPU use (all processes, includes the audio thread).
//   node scripts/music-perf.mjs [--seconds 10] [--rounds 3] [--cpu 4]
// Headless Chromium renders WebGL in software, so absolute fps is pessimistic:
// read the DIFFERENCE between "no music" and "music". Other programs using the
// CPU at the same time add noise (run it with the machine quiet).
import { launchChrome } from './lib/cdp.mjs';
import { startServer } from './lib/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
const SECONDS = opt('--seconds', 10);
const ROUNDS = opt('--rounds', 3);
const CPU = opt('--cpu', 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer();
const chrome = await launchChrome();

async function cpuSeconds() {
  const { processInfo } = await (await chrome.browser()).send('SystemInfo.getProcessInfo');
  return processInfo.reduce((s, p) => s + p.cpuTime, 0);
}

async function scriptSeconds(page) {
  const { metrics } = await page.cdp.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'ScriptDuration').value;
}

// One measuring window: average fps (frames / wall time), script time and total CPU per second.
async function measure(page, label) {
  const frames = () => page.eval('window.__game.loop.frame');
  const f0 = await frames();
  const c0 = await cpuSeconds();
  const s0 = await scriptSeconds(page);
  const t0 = Date.now();
  await sleep(SECONDS * 1000);
  const dt = (Date.now() - t0) / 1000;
  const f1 = await frames();
  const c1 = await cpuSeconds(page);
  const s1 = await scriptSeconds(page);
  return { label, fps: (f1 - f0) / dt, scriptPct: ((s1 - s0) / dt) * 100, cpuPct: ((c1 - c0) / dt) * 100 };
}

// Per round, in one page: before the audio unlock (no music) -> music -> music
// stopped (AudioContext alive) -> music again [-> intensity 1 + warm]. Comparing the
// "no music" windows with the "music" windows cancels slow drift in machine load.
async function scenario(battleId, extra) {
  const results = [];
  const audio = (code) => `(async () => { const a = await import('/src/systems/Audio.js'); ${code} })()`;
  for (let round = 1; round <= ROUNDS; round++) {
    const page = await chrome.newPage({ width: 360, height: 640, cpu: CPU });
    await page.cdp.send('Performance.enable');
    await page.goto(`${server.url}?battle=${battleId}`);
    await page.waitFor('window.__battle && window.__battle.heroes && window.__battle.heroes.length > 0', { timeout: 60000 });
    await sleep(4000); // intro, loading settles
    results.push({ round, ...(await measure(page, 'no music (before unlock)')) });
    await page.click(180, 12); // first tap = audio unlock -> the battle's track starts
    await sleep(2000);
    const key = await page.eval(audio('return a.musicStatus().key;'));
    await page.eval(audio('a.resetMusicStats();'));
    results.push({ round, ...(await measure(page, `music (${key})`)) });
    await page.eval(audio('a.playMusic(null);'));
    await sleep(1500);
    results.push({ round, ...(await measure(page, 'music stopped, audio on')) });
    await page.eval(audio(`a.playMusic(${JSON.stringify(key)});`));
    await sleep(2000);
    await page.eval(audio('a.resetMusicStats();'));
    results.push({ round, ...(await measure(page, `music (${key}) again`)) });
    if (extra) {
      await page.eval(audio('a.setMusicIntensity(1); a.setMusicWarm(true);'));
      await sleep(2000);
      results.push({ round, ...(await measure(page, 'music + intensity 1 + warm')) });
    }
    const end = await page.eval(audio('return a.musicStatus();'));
    results.push({ round, label: 'scheduler', stats: end.stats });
    if (page.errors.length) console.log('page errors:', page.errors);
    await page.cdp.send('Target.closeTarget', { targetId: undefined }).catch(() => {});
  }
  return results;
}

try {
  for (const [battleId, extra] of [['b3_gate', false], ['boss_clerk', true]]) {
    console.log(`\n${battleId}  (4x throttle = ${CPU}x, ${SECONDS}s windows, ${ROUNDS} rounds)`);
    const results = await scenario(battleId, extra);
    const by = {};
    for (const r of results) {
      if (r.label === 'scheduler') {
        const s = r.stats;
        console.log(`   scheduler: ${s.ticks} ticks, avg ${(s.tickMs / s.ticks).toFixed(3)} ms, max ${s.maxTickMs.toFixed(2)} ms, ${s.notes} notes, ${s.dropped} dropped (round ${r.round})`);
        continue;
      }
      (by[r.label] ||= []).push(r);
    }
    const avg = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    console.log('   ' + 'case'.padEnd(34), 'fps'.padStart(6), '(min..max)'.padStart(13), 'script %'.padStart(9), 'browser CPU %'.padStart(14));
    for (const [label, rows] of Object.entries(by)) {
      const fps = rows.map((r) => r.fps);
      console.log(
        '   ' + label.padEnd(34),
        avg(rows, 'fps').toFixed(1).padStart(6),
        `${Math.min(...fps).toFixed(0)}..${Math.max(...fps).toFixed(0)}`.padStart(13),
        avg(rows, 'scriptPct').toFixed(1).padStart(9),
        avg(rows, 'cpuPct').toFixed(0).padStart(14)
      );
    }
    const base = [...(by['no music (before unlock)'] || []), ...(by['music stopped, audio on'] || [])];
    const withMusic = Object.entries(by).filter(([k]) => /^music \(/.test(k)).flatMap(([, v]) => v);
    if (base.length && withMusic.length) console.log(`   => fps without music ${avg(base, 'fps').toFixed(1)}, with music ${avg(withMusic, 'fps').toFixed(1)}, difference ${(avg(withMusic, 'fps') - avg(base, 'fps')).toFixed(1)}`);
  }
} finally {
  await chrome.close();
  await server.close();
}
