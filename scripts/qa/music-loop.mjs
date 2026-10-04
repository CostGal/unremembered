// File music keeps looping (systems/Audio.js startFile): every looping track loops on gapless scheduled
// passes, stays audible past its length (music-bus level meter), and a stop stays stopped. Title = 11 s.
//   node scripts/qa/music-loop.mjs
import { loadPlaywright, startServer } from '../lib/harness.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (label, ok, info = '') => { checks.push(!!ok); console.log(ok ? 'PASS' : 'FAIL', label, info); };
const pw = await loadPlaywright();
const server = await startServer();
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await page.addInitScript(() => { window.__audio = { log: [] }; });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Title'), null, { timeout: 60000 });
  await page.mouse.click(180, 400);
  await sleep(1500);
  const status = () => page.evaluate(async () => (await import('/src/systems/Audio.js')).musicStatus());
  // Every looping file track starts with loop on.
  for (const key of ['title', 'battle', 'battle_duel', 'battle_hollow', 'battle_gate', 'boss', 'meet_dov', 'rest_sad', 'cs_forgotten', 'recollection']) {
    await page.evaluate(async (k) => (await import('/src/systems/Audio.js')).playMusic(k, { crossfadeMs: 0 }), key);
    let st = null;
    for (let i = 0; i < 120 && !(st && st.file && st.key === key); i++) { await sleep(250); st = await status(); }
    check(`${key}: loops`, st.key === key && st.file && st.file.loop && !st.file.ended, JSON.stringify(st.file));
  }
  // Title (11 s): past its length the music is still AUDIBLE (a level meter on the music bus), it runs on
  // scheduled passes (no source.loop), and passes never pile up.
  await page.evaluate(async () => (await import('/src/systems/Audio.js')).playMusic('title', { crossfadeMs: 0 }));
  await sleep(1500);
  const diag = () => page.evaluate(async () => (await import('/src/systems/Audio.js')).musicDiagnostics());
  let d = await diag();
  check('title audible at start', d.level > 0.005, `level ${d.level}`);
  const dur = d.status.file.duration;
  await sleep((dur * 2 + 1) * 1000);
  d = await diag();
  check('title still audible after two passes', d.level > 0.005 && d.status.key === 'title' && !d.status.file.ended, `level ${d.level}, elapsed ${d.status.file.elapsed.toFixed(1)} of ${dur.toFixed(1)}`);
  check('title loops on scheduled passes, no pile-up', d.status.file.passes >= 2 && d.status.file.scheduled <= 2, `passes ${d.status.file.passes}, scheduled ${d.status.file.scheduled}`);
  const passes = await page.evaluate(() => window.__audio.log.filter((e) => e.ev === 'loop-pass' && e.key === 'title').length);
  check('loop passes are logged', passes >= 2, `loop-pass events ${passes}`);
  // A one-shot still plays once and a stopped track does not come back.
  await page.evaluate(async () => (await import('/src/systems/Audio.js')).playMusic(null));
  await sleep(2500);
  const st = await status();
  check('stopping the music leaves it stopped', st.sources === 0 && st.key === null, JSON.stringify({ key: st.key, sources: st.sources }));
} finally {
  await browser.close();
  await server.close();
}
const failed = checks.filter((c) => !c).length;
console.log(`music-loop: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
