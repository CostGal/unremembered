// Forces the plain Hollow (enemy 1) to Siphon in b3_gate and checks the siphon FX stream plays
// (and is destroyed) between the windup and the impact. Screenshots to --out.
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
  await page.goto(`${server.url}?battle=b3_gate`);
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 30000 });
  await sleep(1500);
  await page.eval(`(() => { const b = window.__battle; const e = b.enemies[1]; window.__orig = Math.random; let n = 0; Math.random = () => { if (++n >= 2) Math.random = window.__orig; return 0.9999; }; window.__p = b.enemyTurn(e); })()`);
  let n = 0, maxFx = 0, shot = false;
  for (let i = 0; i < 90; i++) {
    const c = await page.eval(`window.__battle.children.list.filter(o => o.texture && o.texture.key === 'hollow_siphon_fx').length`);
    maxFx = Math.max(maxFx, c);
    if (c && !shot) { writeFileSync(join(out, 'siphon_fx.png'), await page.screenshot({ format: 'png' })); shot = true; }
    await sleep(40);
  }
  const after = await page.eval(`window.__battle.children.list.filter(o => o.texture && o.texture.key === 'hollow_siphon_fx').length`);
  console.log('fx sprites seen at once:', maxFx, 'left over after attack:', after, 'errors:', page.errors.length, page.errors.slice(0, 3));
  console.log('trace:', await page.eval(`Object.keys(window.__animTrace).filter(k => /siphon/.test(k)).join(', ')`));
} finally { await chrome.close(); await server.close(); }
