// npm run cutscene-check — screenshots every cutscene shot headless at 360x640
// (early in the shot and near its end, so pans/zooms/fx are seen at both ends)
// and builds contact sheets. Output: _art/work/cutscene_check/
//   node scripts/cutscene-check.mjs [--shots 8,15] [--out dir] [--cutscene origin]
// Uses system Chrome through scripts/lib/cdp.mjs (no Playwright needed).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './lib/cdp.mjs';
import { root, startServer } from './lib/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const cutscene = opt('--cutscene', 'origin');
const outDir = join(root, opt('--out', '_art/work/cutscene_check'));
const only = opt('--shots', null)?.split(',').map(Number);
const EARLY_MS = 900;
const LATE_BEFORE_END_MS = 350;

mkdirSync(outDir, { recursive: true });
const server = await startServer();
const chrome = await launchChrome();
try {
  const page = await chrome.newPage({ width: 360, height: 640 });
  await page.goto(`${server.url}?cutscene=${cutscene}&shot=1`);
  await page.waitFor('window.__game && window.__game.scene.keys.Cutscene && window.__game.scene.keys.Cutscene.index >= 0', { timeout: 30000 });

  const shots = await page.eval('window.__game.scene.keys.Cutscene.shots.map(s => s.durationMs || 4500)');
  const early = [];
  const late = [];
  for (let n = 1; n <= shots.length; n++) {
    if (only && !only.includes(n)) continue;
    // Jump to shot n (1-based) the same way a tap would.
    await page.eval(`(() => { const s = window.__game.scene.keys.Cutscene; s.index = ${n - 2}; s.nextShot(); })()`);
    await new Promise((r) => setTimeout(r, EARLY_MS));
    early.push({ n, data: await page.screenshot() });
    await new Promise((r) => setTimeout(r, shots[n - 1] - LATE_BEFORE_END_MS - EARLY_MS));
    const data = await page.screenshot();
    late.push({ n, data });
    writeFileSync(join(outDir, `shot_${String(n).padStart(2, '0')}.jpg`), data);
    console.log(`shot ${n}/${shots.length}`);
  }
  if (page.errors.length) console.log('page errors:', page.errors);

  // Contact sheets: 6 columns of 180x320 thumbnails, numbered.
  const sheet = await chrome.newPage({ width: 1080, height: 100 });
  for (const [name, list] of [['contact_late', late], ['contact_early', early]]) {
    const rows = Math.ceil(list.length / 6);
    const html = list
      .map(({ n, data }) => `<div style="position:relative;width:180px;height:320px"><img src="data:image/jpeg;base64,${data.toString('base64')}" width=180 height=320><b style="position:absolute;left:4px;top:2px;font:bold 14px monospace;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000">${n}</b></div>`)
      .join('');
    await sheet.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: rows * 320, deviceScaleFactor: 1, mobile: false });
    await sheet.goto('about:blank');
    await sheet.eval(`document.body.style.cssText='margin:0;background:#222;display:grid;grid-template-columns:repeat(6,180px)';document.body.innerHTML=${JSON.stringify(html)};new Promise(r=>setTimeout(r,500))`);
    writeFileSync(join(outDir, `${name}.jpg`), await sheet.screenshot({ quality: 88 }));
    console.log(`wrote ${name}.jpg`);
  }
} finally {
  await chrome.close();
  await server.close();
}
