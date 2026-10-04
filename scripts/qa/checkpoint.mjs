// Boss checkpoint (enemies.json stages[i].checkpoint): Quill rises into stage 2, the party loses,
// the lose card offers Retry + Retry from here; Retry from here restarts in stage 2 (full stage HP,
// party at full HP, no story beats again), Retry restarts from stage 1. --out = shots (optional).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../lib/cdp.mjs';
import { startServer } from '../lib/harness.mjs';
const oi = process.argv.indexOf('--out');
const out = oi > 0 ? process.argv[oi + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => { if (out) writeFileSync(join(out, `${name}.png`), await page.screenshot({ format: 'png' })); };
const server = await startServer();
const chrome = await launchChrome();
const checks = [];
const check = (label, ok, info = '') => { checks.push([label, !!ok]); console.log(ok ? 'PASS' : 'FAIL', label, info); };
try {
  const page = await chrome.newPage();
  await page.goto(`${server.url}?battle=boss_clerk`);
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 60000 });
  await sleep(1500);
  const first = await page.eval(`(() => { const b = window.__battle; return { snap: !!b.stageSnapshot, items: (b.menu.items || []).map((i) => i.slot) }; })()`);
  check('no checkpoint in stage 1', first && !first.snap);

  // Stage 1 ends: Quill drops to 0 and rises (the quill_rise dialogue is skipped for the lab).
  // The turn loop raises him after the current turn (afterTurn); a player turn waiting on the menu gets a Strike.
  await page.eval(`(() => { const b = window.__battle; b.playDialogueOverlay = async () => {}; b.heroes[0].hp = Math.max(1, b.heroes[0].hp - 7); b.killEnemy(b.enemies[0]); })()`);
  const risenExpr = `window.__battle.enemies[0].phase === 1 && !window.__battle.enemies[0].rising && !!window.__battle.stageSnapshot`;
  for (let t = 0; t < 60000 && !(await page.eval(risenExpr)); t += 500) {
    await page.eval(`(() => { const m = window.__battle.menu; const s = (m.items || []).find((i) => i.slot === 'strike' || i.value === 'strike'); if (s) m.choose(s.value); })()`);
    await sleep(500);
  }
  const risen = await page.eval(`(() => { const b = window.__battle; const e = b.enemies[0]; const s = b.stageSnapshot; return { phase: e.phase, hp: e.hp, maxHp: e.maxHp, snap: !!s, snapPhase: s && s.enemies[0].phase, snapHp: s && s.enemies[0].hp, rheaHp: b.heroes[0].hp, rheaMax: b.heroes[0].maxHp }; })()`);
  check('rising into stage 2 records the checkpoint', risen.phase === 1 && risen.snap && risen.snapPhase === 1 && risen.snapHp === risen.maxHp, JSON.stringify(risen));

  // The party falls: the lose card shows two buttons.
  await page.eval(`(() => { const b = window.__battle; b.heroes.forEach((h) => { h.hp = 0; b.markDown(h); }); b.onBattleEnd('LOSE'); })()`);
  await page.waitFor(`(window.__battle.menu.items || []).length > 0`, { timeout: 10000 });
  await sleep(500);
  await shot(page, 'lose_card');
  const card = await page.eval(`window.__battle.menu.items.map((i) => i.slot + ':' + i.label + ':' + i.value)`);
  check('lose card: Retry + Retry from here', card.length === 2 && card.some((c) => c.endsWith(':checkpoint')) && card.some((c) => c.endsWith(':retry')), card.join(' | '));

  // Retry from here: a fresh battle in stage 2.
  // Scene.restart reuses the scene object: wait for the fresh battle (battleOver reset, checkpoint in initData).
  await page.eval(`window.__battle.menu.choose('checkpoint')`);
  await page.waitFor(`!window.__battle.battleOver && !!(window.__battle.initData && window.__battle.initData.checkpoint) && window.__battle.enemies[0].phase === 1`, { timeout: 30000 });
  await sleep(1500);
  await shot(page, 'after_checkpoint');
  const cp = await page.eval(`(() => { const b = window.__battle; const e = b.enemies[0]; return { phase: e.phase, hp: e.hp, maxHp: e.maxHp, heroes: b.heroes.map((h) => [h.hp, h.maxHp]), snap: !!b.stageSnapshot, rec: !!b.recollectionSnapshot, fired: [...b.firedEvents] }; })()`);
  check('Retry from here: Quill in stage 2 at full stage HP', cp.phase === 1 && cp.hp === cp.maxHp, JSON.stringify(cp));
  check('Retry from here: party at full HP', cp.heroes.every(([hp, max]) => hp === max));
  check('Retry from here: checkpoint kept, no Recollection rewind', cp.snap && !cp.rec);

  // Lose again, then plain Retry: back to stage 1 and the checkpoint is gone.
  await page.eval(`(() => { const b = window.__battle; b.heroes.forEach((h) => { h.hp = 0; b.markDown(h); }); b.onBattleEnd('LOSE'); })()`);
  await page.waitFor(`(window.__battle.menu.items || []).length === 2`, { timeout: 10000 });
  await page.eval(`window.__battle.menu.choose('retry')`);
  await page.waitFor(`!window.__battle.battleOver && !(window.__battle.initData && window.__battle.initData.checkpoint)`, { timeout: 30000 });
  await sleep(1500);
  const re = await page.eval(`(() => { const b = window.__battle; return { phase: b.enemies[0].phase || 0, snap: !!b.stageSnapshot }; })()`);
  check('Retry: back to stage 1, checkpoint cleared', re.phase === 0 && !re.snap, JSON.stringify(re));
} finally {
  await chrome.close();
  await server.close?.();
}
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`checkpoint: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
