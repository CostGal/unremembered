// File music keeps looping (systems/Audio.js startFile): every looping track loops, and the safety net
// restarts a track whose source stops looping (a browser that drops the loop). Uses the 11 s title track.
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
  // Title: natural loop past its length.
  await page.evaluate(async () => (await import('/src/systems/Audio.js')).playMusic('title', { crossfadeMs: 0 }));
  await sleep(1000);
  const dur = (await status()).file.duration;
  await sleep((dur + 2) * 1000);
  let st = await status();
  check('title keeps sounding past its length', st.key === 'title' && st.sources === 1 && !st.file.ended, `elapsed ${st.file.elapsed.toFixed(1)} of ${dur.toFixed(1)}`);
  // Safety net: drop the loop on the live source; when it ends the track must start again.
  await page.evaluate(async () => { (await import('/src/systems/Audio.js')).musicSourceForQa().loop = false; });
  await sleep((dur + 2) * 1000);
  st = await status();
  const restarts = await page.evaluate(() => window.__audio.log.filter((e) => e.ev === 'loop-restart').length);
  check('safety net restarts a track that stopped looping', restarts >= 1 && st.key === 'title' && st.sources === 1 && !st.file.ended, `restarts ${restarts}`);
  // A one-shot still plays once and a stopped track does not come back.
  await page.evaluate(async () => (await import('/src/systems/Audio.js')).playMusic(null));
  await sleep(2500);
  st = await status();
  check('stopping the music leaves it stopped', st.sources === 0 && st.key === null, JSON.stringify({ key: st.key, sources: st.sources }));
} finally {
  await browser.close();
  await server.close();
}
const failed = checks.filter((c) => !c).length;
console.log(`music-loop: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
