// Game-jam site reporting (src/systems/JamReport.js). Three parts:
//  A. A full run by the playtest bot (Normal): the End of Demo screen sends exactly one {gj:"clear"} and one
//     {gj:"finish"}, with the bot's real Result-card battles. window.parent is swapped for a recorder
//     (it is a replaceable property), so the bot can drive the top-level page.
//  B. A real host page with the game in an iframe: messages arrive in the parent, once per run; paused time
//     is not counted; the menu's Credits and a dev-param visit (?fps=1) send nothing.
//  C. The game on its own (no parent): reaching the End screen throws nothing.
//   node scripts/qa/jam-report.mjs [--skip-run]
import { loadPlaywright, openPage, startServer } from '../lib/harness.mjs';
import { Bot } from '../lib/bot.mjs';

const skipRun = process.argv.includes('--skip-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (label, ok, info = '') => {
  checks.push([label, !!ok]);
  console.log(ok ? 'PASS' : 'FAIL', label, info);
};

const pw = await loadPlaywright();
if (!pw) {
  console.log('Playwright is not installed here: skipping.');
  process.exit(0);
}
const server = await startServer();
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || undefined });
const RANKS = [['S', 90], ['A', 60], ['B', 0]];
const rankOf = (s) => RANKS.find(([, min]) => s >= min)[0];

try {
  // ---------- A. full run ----------
  if (!skipRun) {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      window.__jamMsgs = [];
      window.parent = { postMessage: (m) => window.__jamMsgs.push(JSON.parse(JSON.stringify(m))) };
    });
    const page = await context.newPage();
    page.errors = [];
    page.missing = [];
    page.on('pageerror', (err) => page.errors.push(err.message));
    await page.goto(server.url);
    const bot = new Bot(page, { profile: { PERFECT: 0.55, GOOD: 0.35, MISS: 0.1 }, profileName: 'good' });
    const t0 = Date.now();
    let sawEnd = false;
    await bot.run({ stallMs: 20000, timeoutMs: 20 * 60 * 1000, stopWhen: (st) => (sawEnd = sawEnd || st.active.includes('End')) && st.active.includes('Menu') });
    const wall = (Date.now() - t0) / 1000;
    const msgs = await page.evaluate(() => window.__jamMsgs);
    const clear = msgs.filter((m) => m.gj === 'clear');
    const finish = msgs.filter((m) => m.gj === 'finish');
    const c = clear[0] || {};
    const d = c.details || {};
    console.log('clear message:', JSON.stringify(c));
    check('A: one clear + one finish', clear.length === 1 && finish.length === 1 && msgs.length === 2, `msgs ${msgs.length}`);
    check('A: ver hard1, mode normal', c.ver === 'hard1' && c.mode === 'normal');
    check('A: seconds > 0 and under wall-clock time', c.seconds > 0 && c.seconds < wall, `${c.seconds}s of ${wall.toFixed(0)}s`);
    const ids = (d.battles || []).map((b) => b.id).sort();
    check('A: battles b1, b2, b3, boss', JSON.stringify(ids) === JSON.stringify(['b1_forgotten', 'b2_first_hollow', 'b3_gate', 'boss_clerk']), ids.join(','));
    const mean = d.battles?.length ? Math.round(d.battles.reduce((s, b) => s + b.score, 0) / d.battles.length) : -1;
    check('A: avgScore is the mean, avgRank from the rank table', d.avgScore === mean && d.avgRank === rankOf(d.avgScore), `${d.avgScore} ${d.avgRank}`);
    check('A: every battle has a rank that matches its score', (d.battles || []).every((b) => b.rank === rankOf(b.score)));
    check('A: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await context.close();
  }

  // ---------- B. real iframe host ----------
  const host = async (query) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
    await page.setContent(`<script>window.__msgs=[];addEventListener('message',(e)=>window.__msgs.push(e.data));</script><iframe src="${server.url}${query}" width="360" height="640" allow="autoplay"></iframe>`);
    let frame = null;
    for (let i = 0; i < 300 && !frame; i++) {
      frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(server.url));
      if (!frame) await sleep(100);
    }
    await frame.waitForFunction(() => window.__game && (window.__game.scene.isActive('Title') || window.__game.scene.isActive('Menu')), null, { timeout: 60000 });
    return { page, frame };
  };
  const inGame = (frame, body) => frame.evaluate(`(async () => { const m = await import('/src/systems/JamReport.js'); const g = window.__game; const active = () => g.scene.getScenes(true)[0]; ${body} })()`);

  {
    const { page, frame } = await host('');
    await inGame(frame, `const s = { ...g.registry.get('settings'), difficulty: 'unforgettable' }; g.registry.set('settings', s); m.startRun(g.registry, s); m.startClock(g.registry);`);
    await sleep(3000);
    const before = await inGame(frame, `return g.registry.get('jamRun').ms;`);
    await inGame(frame, `const p = await import('/src/systems/PauseButton.js'); p.pauseScene(active());`);
    await sleep(4000);
    const during = await inGame(frame, `return g.registry.get('jamRun').ms;`);
    await inGame(frame, `const paused = g.scene.getScenes(false).find((s) => g.scene.isPaused(s.scene.key)); g.scene.stop('Pause'); if (paused) g.scene.resume(paused.scene.key);`);
    await sleep(1000);
    check('B: paused time is not counted', during - before < 500, `${Math.round(before)} -> ${Math.round(during)} ms over a 4 s pause`);
    await inGame(frame, `m.recordBattle(g.registry, 'b1_forgotten', { score: 95, rank: 'S' }); m.recordBattle(g.registry, 'b1_forgotten', { score: 70, rank: 'A' }); m.recordBattle(g.registry, 'b2_first_hollow', { score: 40, rank: 'B' }); active().scene.start('End');`);
    await sleep(1500);
    let msgs = await page.evaluate(() => window.__msgs);
    const c = msgs.find((x) => x.gj === 'clear') || {};
    console.log('iframe clear message:', JSON.stringify(c));
    check('B: parent page receives clear then finish', msgs.length === 2 && msgs[0].gj === 'clear' && msgs[1].gj === 'finish');
    check('B: newest result per battle, mean and rank', c.details?.battles?.length === 2 && c.details.battles.find((b) => b.id === 'b1_forgotten').score === 70 && c.details.avgScore === 55 && c.details.avgRank === 'B');
    check('B: mode unforgettable, seconds ~4', c.mode === 'unforgettable' && c.seconds >= 3 && c.seconds <= 6, `${c.seconds}s`);
    await inGame(frame, `active().scene.start('Menu');`);
    await sleep(800);
    await inGame(frame, `active().scene.start('End');`);
    await sleep(1200);
    msgs = await page.evaluate(() => window.__msgs);
    check('B: a second End screen in the same run sends nothing', msgs.length === 2);
    await inGame(frame, `active().scene.start('Menu');`);
    await sleep(800);
    await inGame(frame, `m.startRun(g.registry, { difficulty: 'normal' }); m.startClock(g.registry); active().scene.start('End', { credits: true });`);
    await sleep(1200);
    msgs = await page.evaluate(() => window.__msgs);
    check("B: the menu's Credits sends nothing", msgs.length === 2);
    await page.close();
  }
  {
    const { page, frame } = await host('?fps=1');
    await inGame(frame, `m.startRun(g.registry, { difficulty: 'normal' }); m.startClock(g.registry); m.recordBattle(g.registry, 'b1_forgotten', { score: 80, rank: 'A' }); active().scene.start('End');`);
    await sleep(1500);
    const msgs = await page.evaluate(() => window.__msgs);
    check('B: a dev-param visit (?fps=1) sends nothing', msgs.length === 0);
    await page.close();
  }

  // ---------- C. on its own ----------
  {
    const page = await openPage(browser, server.url);
    await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Title'), null, { timeout: 60000 });
    await page.evaluate(`(async () => { const m = await import('/src/systems/JamReport.js'); const g = window.__game; m.startRun(g.registry, { difficulty: 'normal' }); m.startClock(g.registry); g.scene.getScenes(true)[0].scene.start('End'); })()`);
    await sleep(1500);
    const sent = await page.evaluate(() => window.__game.registry.get('jamRun').sent);
    check('C: on its own the run completes with no error', sent === true && page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`jam-report: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
