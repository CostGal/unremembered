// Forces each Clerk attack (File Away, Redact feint, Archive charge + release)
// in a live boss battle and reports which animation events ran. --out = shots.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../lib/cdp.mjs';
import { startServer } from '../lib/harness.mjs';
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer();
const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  await page.goto(`${server.url}?battle=boss_clerk`);
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 30000 });
  await sleep(1800);
  writeFileSync(join(out, 'boss_intro.png'), await page.screenshot({ format: 'png' }));
  const run = async (label, phase, rand, waitKey) => {
    await page.eval(`(() => { window.__animTrace = {}; const b = window.__battle; const e = b.enemies[0]; e.phase = ${phase}; const o = Math.random; let n = 0; Math.random = () => { if (++n >= 2) Math.random = o; return ${rand}; }; window.__p = b.enemyTurn(e).then(() => { window.__done = true; }); window.__done = false; })()`);
    let shot = false;
    for (let i = 0; i < 400; i++) {
      const st = await page.eval(`({ done: window.__done, t: Object.keys(window.__animTrace) })`);
      if (!shot && st.t.some((k) => k.startsWith(waitKey))) { await sleep(150); writeFileSync(join(out, `${label}.png`), await page.screenshot({ format: 'png' })); shot = true; }
      if (st.done) break;
      await sleep(50);
    }
    console.log(label.padEnd(18), (await page.eval(`Object.keys(window.__animTrace).join(' ')`)));
  };
  await run('file_away', 0, 0.9999, 'windup:');
  await run('redact', 1, 0.5, 'windup:');
  await run('archive_charge', 1, 0.9999, 'play:clerk_archive_charge');
  console.log('charging?', await page.eval(`!!window.__battle.enemies[0].charge`));
  await run('archive_wait', 1, 0.9999, 'zzz');
  console.log('charging?', await page.eval(`!!window.__battle.enemies[0].charge`));
  await run('archive_release', 1, 0.9999, 'windup:');
  console.log('errors:', page.errors.length, page.errors.slice(0, 3));
} finally { await chrome.close(); await server.close(); }
