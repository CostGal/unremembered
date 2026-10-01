// npm run playtest — a headless bot plays the whole demo like a player:
// Title -> Menu -> New Game -> cutscene -> dialogues -> b1 -> boss (Keepsake,
// Recollection) -> ending -> End of Demo -> Menu, with real taps.
// Fails on any console/page error (missing art files are expected and only
// counted), on a soft-lock (> 20 s with no scene/state change) or a missing
// chapter step. Runs twice: real sheets, then ?fakesheets=1.
//
//   npm run playtest [-- --only real|fake] [-- --profile good] [-- --story]
// Needs Playwright (used from wherever it is installed; see lib/harness.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright, openPage, root, startServer } from './lib/harness.mjs';
import { Bot } from './lib/bot.mjs';

const chapter = JSON.parse(readFileSync(join(root, 'src/data/chapter1.json'), 'utf8'));
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const PROFILES = { average: { PERFECT: 0.3, GOOD: 0.45, MISS: 0.25 }, good: { PERFECT: 0.55, GOOD: 0.35, MISS: 0.1 } };
const profile = PROFILES[args.includes('--profile') ? args[args.indexOf('--profile') + 1] : 'good'];
const STALL_MS = 20000;
// --story: Story Mode on (and the difficulty question already answered).
const settings = args.includes('--story') ? { storyMode: true, difficultyChosen: true } : null;

// The chapter steps we expect to see, in order (scene key + id).
const expected = chapter.filter((s) => s.type !== 'end').map((s) => `${s.type}:${s.id}`);

async function playthrough(browser, url, label) {
  const page = await openPage(browser, url, { settings });
  const bot = new Bot(page, { profile });
  const seen = [];
  const t0 = Date.now();
  let sawEnd = false;
  let retries = 0;
  const note = (step) => {
    if (seen[seen.length - 1] !== step) {
      seen.push(step);
      console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${step}`);
    }
  };
  const result = { label, ok: false };
  try {
    await bot.run({
      stallMs: STALL_MS,
      timeoutMs: 20 * 60 * 1000,
      stopWhen: (st) => {
        const a = st.active;
        if (a.includes('Cutscene')) note('cutscene:origin');
        // (The Keepsake dialogue plays over the paused boss battle.)
        if (st.dialogue) note(`dialogue:${st.dialogue.id}`);
        if (st.reward) note(`reward:${st.reward.id}`);
        if (st.battle && a.includes('Battle')) note(`battle:${st.battle.id}`);
        if (a.includes('End')) {
          note('end');
          sawEnd = true;
        }
        return sawEnd && a.includes('Menu');
      },
    });
    retries = bot.events.filter((e) => e === 'retry').length;
    const missingSteps = expected.filter((s) => !seen.includes(s));
    if (missingSteps.length) throw new Error(`chapter steps never reached: ${missingSteps.join(', ')}`);
    result.ok = true;
  } catch (err) {
    result.error = err.message;
    await page.screenshot({ path: join(root, `dist/playtest-${label}-fail.png`) }).catch(() => {});
  }
  result.seconds = (Date.now() - t0) / 1000;
  result.errors = page.errors;
  result.missingFiles = new Set(page.missing.map((m) => m.replace(/.*"image" /, ''))).size;
  result.qte = bot.results;
  result.retries = retries;
  result.anims = Object.keys((await page.evaluate(() => window.__animTrace || {}).catch(() => ({})))).length;
  await page.close();
  return result;
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('Playwright is not installed here: skipping. Manual equivalent: docs/BATCH_REPORT_2.md > T6.');
  process.exit(0);
}
const server = await startServer();
const browser = await pw.chromium.launch();
const results = [];
try {
  for (const [label, query] of [
    ['real', ''],
    ['fake', '?fakesheets=1'],
  ]) {
    if (only && only !== label) continue;
    console.log(`\n▶ playthrough (${label} sheets)`);
    results.push(await playthrough(browser, `${server.url}${query}`, label));
  }
} finally {
  await browser.close();
  await server.close();
}

console.log('\nresult:');
let failed = false;
for (const r of results) {
  const ok = r.ok && r.errors.length === 0;
  failed ||= !ok;
  console.log(
    `  ${ok ? '✓' : '✗'} ${r.label.padEnd(5)} ${r.seconds.toFixed(0)}s  retries ${r.retries}  QTE P/G/M ${r.qte.PERFECT}/${r.qte.GOOD}/${r.qte.MISS}  Nala ${r.qte.nala}  anim events ${r.anims}  missing art files ${r.missingFiles}`
  );
  if (r.error) console.log(`      ${r.error}`);
  for (const e of r.errors.slice(0, 5)) console.log(`      console error: ${e}`);
}
process.exit(failed ? 1 : 0);
