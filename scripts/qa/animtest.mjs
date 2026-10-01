// npm run qa:anim -- <char> — headless ?animtest=1&char=<char> check: every
// animation in the character's sheet set loads (no placeholder), plays, and
// reaches its holdFrame / impact frames; no console errors. Saves a contact
// sheet source (one screenshot per animation) to the temp dir given by --out.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../lib/cdp.mjs';
import { startServer, root } from '../lib/harness.mjs';

const char = process.argv[2];
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
if (!char) throw new Error('usage: animtest.mjs <char> [--out dir]');
if (out) mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer();
const chrome = await launchChrome();
let failed = false;
try {
  const page = await chrome.newPage({ width: 360, height: 640 });
  const missing = [];
  page.cdp.send('Network.enable');
  page.cdp.on('Network.responseReceived', (p) => p.response.status >= 400 && missing.push(`${p.response.status} ${p.response.url}`));
  await page.goto(`${server.url}?animtest=1&char=${char}`);
  await page.waitFor(`!!window.__game && !!window.__game.scene.getScene('AnimTest').sprite`, { timeout: 30000 });
  const entries = await page.eval(`(() => { const s = window.__game.scene.getScene('AnimTest'); return s.entries.map(e => ({name: e.name, def: e.def})); })()`);
  console.log(`${char}: ${entries.length} animations`);
  for (let i = 0; i < entries.length; i++) {
    const { name, def } = entries[i];
    await page.eval(`window.__animTrace = {}; window.__game.scene.getScene('AnimTest').select(${i})`);
    const total = (def.durations_ms || []).reduce((a, b) => a + b, 0);
    await sleep(Math.min(total * 0.45 + 150, 900));
    if (out) writeFileSync(join(out, `${String(i).padStart(2, '0')}_${name}.png`), await page.screenshot({ format: 'png' }));
    await sleep(Math.max(0, Math.min(total, 2200) - Math.min(total * 0.45 + 150, 900)) + 900);
    const info = await page.eval(`(() => { const s = window.__game.scene.getScene('AnimTest'); const d = s.entries[${i}].def; return { placeholder: !!d.placeholder, trace: Object.keys(window.__animTrace || {}), playing: s.sprite.anims.isPlaying, current: s.sprite.anims.currentAnim?.key, hold: s.banner.text }; })()`);
    const notes = [];
    if (info.placeholder) notes.push('PLACEHOLDER');
    const key = `${char}_${name}`;
    if (def.loop ? !(info.playing && info.current === key) : !info.trace.includes(`play:${key}`)) notes.push('never played');
    if (def.impactFrames && !def.loop && !info.trace.includes(`impact:${key}`)) notes.push('impact frame never reached');
    if (def.holdFrame !== undefined && !def.loop && !info.trace.includes(`hold:${key}`)) notes.push('holdFrame never reached');
    if (notes.length) failed = true;
    console.log(`  ${notes.length ? '✗' : '✓'} ${name.padEnd(20)} ${def.frames}f ${total}ms ${notes.join(', ')}`);
  }
  const errs = [...page.errors];
  const mis = missing.filter((m) => /sprites\//.test(m));
  console.log(`console errors: ${errs.length}  sprite 404s: ${mis.length}`);
  for (const e of errs.slice(0, 5)) console.log('   ', e);
  for (const m of mis.slice(0, 10)) console.log('   ', m);
  const ph = page.logs.filter((l) => /placeholder/.test(l));
  console.log(`placeholder logs: ${ph.length}`);
  if (errs.length || mis.length || ph.length) failed = true;
} finally {
  await chrome.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
