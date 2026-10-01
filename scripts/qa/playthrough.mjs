// QA part B: full playthroughs Title -> End of Demo -> Menu in several
// environments. node scripts/qa/playthrough.mjs [variant ...] [--out file.json]
// Variants: normal, story, fake, fake-story, blocked, locked, blocked-story
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bot } from '../lib/bot.mjs';
import { INIT, open, root, summarise, withBrowser, sleep } from './lib.mjs';

const chapter = JSON.parse(readFileSync(join(root, 'src/data/chapter1.json'), 'utf8'));
const expected = chapter.filter((s) => s.type !== 'end').map((s) => `${s.type}:${s.id}`);
const VARIANTS = {
  normal: { query: '', settings: null },
  story: { query: '', settings: { storyMode: true, difficultyChosen: true } },
  fake: { query: '?fakesheets=1', settings: null },
  'fake-story': { query: '?fakesheets=1', settings: { storyMode: true, difficultyChosen: true } },
  blocked: { query: '', settings: null, init: [INIT.blockedStorage] },
  'blocked-story': { query: '', settings: null, init: [INIT.blockedStorage] },
  locked: { query: '', settings: null, init: [INIT.audioLocked] },
};
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const names = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);

function adapt(page) {
  let lx = 0;
  let ly = 0;
  return {
    errors: page.errors,
    evaluate: (fn, arg) => page.eval(`(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`),
    mouse: {
      click: (x, y) => page.click(x, y),
      move: async (x, y, { steps = 1 } = {}) => {
        const [x0, y0] = [lx, ly];
        for (let i = 1; i <= steps; i++) await page.move(x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
        lx = x;
        ly = y;
      },
      down: () => page.down(lx, ly),
      up: () => page.up(lx, ly),
    },
  };
}

async function run(chrome, server, name) {
  const v = VARIANTS[name];
  const page = await open(chrome, server.url + v.query, { settings: v.settings, init: v.init || [] });
  const bot = new Bot(adapt(page), { profile: { PERFECT: 0.4, GOOD: 0.4, MISS: 0.2 } });
  const seen = [];
  const t0 = Date.now();
  let sawEnd = false;
  const note = (s) => seen[seen.length - 1] !== s && seen.push(s);
  const heap0 = (await page.cdp.send('Runtime.getHeapUsage')).usedSize;
  const res = { name, ok: false };
  try {
    await bot.run({
      stallMs: 25000,
      timeoutMs: 20 * 60 * 1000,
      stopWhen: (st) => {
        const a = st.active;
        if (a.includes('Cutscene')) note('cutscene:origin');
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
    const missingSteps = expected.filter((s) => !seen.includes(s));
    if (missingSteps.length) throw new Error(`steps never reached: ${missingSteps.join(', ')}`);
    res.ok = true;
  } catch (e) {
    res.error = e.message;
    await page.shot(join(root, `dist/qa-playthrough-${name}-fail.png`)).catch(() => {});
  }
  res.seconds = Math.round((Date.now() - t0) / 1000);
  res.qte = bot.results;
  res.retries = bot.events.filter((e) => e === 'retry').length;
  res.heapMB = [heap0, (await page.cdp.send('Runtime.getHeapUsage')).usedSize].map((b) => +(b / 1048576).toFixed(1));
  res.audioState = await page.eval(`(() => { try { return String(window.__audio?.ctx?.state ?? 'n/a'); } catch (e) { return 'err'; } })()`).catch(() => '?');
  Object.assign(res, summarise(page));
  await sleep(100);
  return res;
}

const results = [];
await withBrowser(async ({ chrome, server }) => {
  for (const name of names) {
    console.log(`▶ ${name}`);
    const r = await run(chrome, server, name);
    results.push(r);
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.seconds}s heap ${r.heapMB.join('→')}MB QTE ${JSON.stringify(r.qte)} retries ${r.retries} errors ${r.errors.length} 404s ${r.missing.length}${r.error ? ' ' + r.error : ''}`);
    for (const e of r.errors.slice(0, 3)) console.log('    error:', e.slice(0, 200));
    for (const m of r.missing.slice(0, 4)) console.log('    missing:', m.slice(0, 160));
    if (out) writeFileSync(out, JSON.stringify(results, null, 2));
  }
});
process.exit(results.every((r) => r.ok && r.errors.length === 0) ? 0 : 1);
