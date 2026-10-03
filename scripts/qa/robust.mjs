// QA part G: robustness. Page hidden mid-ring / mid-dialogue / mid-cutscene /
// mid-Recollection, landscape overlay, rapid taps, long-press guards, browser
// back, reload mid-chapter, and 5× Retry leak counts.
//   node scripts/qa/robust.mjs --out dir [--only name,name]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8'));
const slots = ui.commands.slots;
const out = process.argv[process.argv.indexOf('--out') + 1];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
mkdirSync(out, { recursive: true });
const rows = [];
const log = (ok, name, detail = '') => {
  rows.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const want = (n) => !only || only.includes(n);
const B = (page, expr) => page.ev(`(() => { const B = window.__battle; return ${expr}; })()`);
const waitMenu = (page, timeout = 30000) => page.waitFor(`!!(window.__battle.menu && window.__battle.menu.pending)`, { timeout });

const HOOKS = `(() => {
  window.__taps = []; window.__results = [];
  document.addEventListener('pointerdown', (e) => window.__taps.push(e.timeStamp), true);
  window.__hook = () => { const B = window.__battle; if (!B || B.__hooked) return; B.__hooked = true;
    const orig = B.applyParryResult.bind(B);
    B.applyParryResult = (result, enemy, hero, hit, input) => { window.__results.push({ result, input, t: performance.now() }); return orig(result, enemy, hero, hit, input); }; };
})()`;

async function battle(chrome, server, id, extra = '') {
  const page = await open(chrome, `${server.url}?battle=${id}${extra}`, { init: [HOOKS] });
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
  await page.ev(`window.__hook()`);
  return page;
}

const setViewport = (page, w, h) => page.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

await withBrowser(async ({ chrome, server }) => {
  // ---------- hidden mid-ring ----------
  if (want('ring')) {
    const page = await battle(chrome, server, 'boss_clerk');
    await waitMenu(page);
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; window.__results.length = 0; window.__done = null; B.enemyHit(B.enemies[0], B.heroes[0], { telegraphMs: 1200, dmg: 20 }, null, 0).then(r => { window.__done = r; }); })()`);
    await page.waitFor(`window.__battle.qteRings.size > 0`, { timeout: 4000 });
    await sleep(500);
    await page.hidden(true);
    await sleep(300);
    const act = await page.scenes();
    log(act.includes('Pause') && (await page.ev(`window.__game.scene.isPaused('Battle')`)), 'hidden mid-ring: battle pauses and "Tap to continue" shows', act.join('+'));
    await page.shot(join(out, 'pause_overlay.png'));
    await sleep(3500);
    const during = await page.ev(`({ results: window.__results.length, done: window.__done, hp: window.__battle.heroes[0].hp, rings: window.__battle.qteRings.size })`);
    log(during.results === 0 && during.done === null && during.hp === 60 && during.rings === 0, 'hidden for 4 s: nothing judged, no damage, ring dropped', JSON.stringify(during));
    await page.hidden(false);
    await sleep(600);
    log((await page.scenes()).includes('Pause'), 'coming back does not auto-resume: still waits for "Tap to continue"');
    await page.tap(180, 320);
    await sleep(500);
    const resumed = await page.ev(`({ paused: window.__game.scene.isPaused('Battle'), rings: window.__battle.qteRings.size, scenes: window.__game.scene.getScenes(true).map(s => s.scene.key) })`);
    log(!resumed.paused && resumed.rings === 1 && !resumed.scenes.includes('Pause'), 'Tap to continue: the attack restarts with a fresh ring', JSON.stringify(resumed));
    // judge the restarted ring: on-beat tap -> PERFECT
    const { at, now } = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now() })`);
    await sleep(Math.max(0, at - now - 6));
    await page.tap(180, 610);
    await page.waitFor(`window.__done !== null`, { timeout: 6000 });
    log((await page.ev(`window.__results[0] && window.__results[0].result`)) === 'PERFECT', 'the restarted ring is judged normally (PERFECT)');
    // landscape → overlay → portrait restores state
    await page.ev(`(() => { const B = window.__battle; window.__done = null; B.enemyHit(B.enemies[0], B.heroes[0], { telegraphMs: 1500, dmg: 20 }, null, 0).then(r => { window.__done = r; }); window.__results.length = 0; })()`);
    await page.waitFor(`window.__battle.qteRings.size > 0`, { timeout: 4000 });
    await sleep(400);
    await setViewport(page, 640, 360);
    await sleep(700);
    const land = await page.ev(`({ overlay: getComputedStyle(document.getElementById('rotate')).display, paused: window.__game.scene.isPaused('Battle'), scenes: window.__game.scene.getScenes(true).map(s => s.scene.key), judged: window.__results.length })`);
    await page.shot(join(out, 'landscape_overlay.png'));
    log(land.overlay === 'flex' && land.paused && land.judged === 0, 'landscape: "Rotate your phone" overlay shows and the battle pauses (nothing judged)', JSON.stringify(land));
    await setViewport(page, 360, 640);
    await sleep(700);
    const port = await page.ev(`({ overlay: getComputedStyle(document.getElementById('rotate')).display, scenes: window.__game.scene.getScenes(true).map(s => s.scene.key), hp: window.__battle.heroes.map(h => h.hp) })`);
    log(port.overlay === 'none' && port.scenes.includes('Pause'), 'back to portrait: overlay gone, Pause waiting for a tap, state intact', JSON.stringify(port));
    await page.tap(180, 320);
    await sleep(400);
    await page.waitFor(`window.__done !== null`, { timeout: 8000 }).catch(() => {});
    log((await page.ev(`window.__done`)) !== null, 'after landscape round-trip the interrupted attack still completes');
    log(page.errors.length === 0, 'no console errors (hidden/landscape)', page.errors.slice(0, 2).join(' | '));
  }

  // ---------- hidden mid-Recollection ----------
  if (want('recollection')) {
    const page = await battle(chrome, server, 'boss_clerk', '&echo=10&level=5');
    await waitMenu(page);
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); window.__results.length = 0; window.__dmg = []; const o = B.recollectionHit.bind(B); B.recollectionHit = (t, r, tech) => { window.__dmg.push(r); return o(t, r, tech); }; window.__hp0 = B.enemies[0].hp; window.__done = null; B.playRecollection(B.heroes[0], B.enemies[0]).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 8000 });
    // first ring: tap on the beat
    let { at, now } = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now() })`);
    await sleep(Math.max(0, at - now - 6));
    await page.tap(180, 610);
    await sleep(900);
    // second ring appears ~500 ms later: hide while it runs
    await page.waitFor(`window.__battle.qteRings.size > 0`, { timeout: 4000 });
    await sleep(120);
    await page.hidden(true);
    await sleep(400);
    const mid = await page.ev(`({ judged: window.__dmg.slice(), paused: window.__game.scene.isPaused('Battle'), pause: window.__game.scene.getScenes(true).some(s => s.scene.key === 'Pause') })`);
    log(mid.paused && mid.pause && mid.judged.length === 1, 'hidden mid-Recollection: pauses; only the first ring was judged', JSON.stringify(mid));
    await sleep(3000);
    const still = await page.ev(`window.__dmg.length`);
    log(still === 1, 'hidden 3 s mid-Recollection: no ring is judged while hidden', `judged ${still}`);
    await page.hidden(false);
    await page.tap(180, 320);
    await sleep(500);
    // remaining two rings: tap on the beat each
    for (let i = 0; i < 2; i++) {
      await page.waitFor(`window.__battle.qteRings.size > 0`, { timeout: 5000 });
      ({ at, now } = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now() })`));
      await sleep(Math.max(0, at - now - 6));
      await page.tap(180, 610);
      await sleep(700);
    }
    await page.waitFor(`window.__done === true`, { timeout: 10000 });
    const fin = await page.ev(`({ dmg: window.__dmg.slice(), echo: window.__battle.heroes[0].echo, hp: window.__battle.enemies[0].hp, hp0: window.__hp0 })`);
    log(fin.dmg.length === 3 && fin.echo === 0, "Recollection resumes and finishes: 3 rings judged in total, Rhea's Echo → 0", JSON.stringify(fin));
    log(page.errors.length === 0, 'no console errors (Recollection hidden)', page.errors.slice(0, 2).join(' | '));
  }

  // ---------- hidden mid-dialogue / mid-cutscene ----------
  if (want('story')) {
    const page = await open(chrome, `${server.url}?step=3`);
    await waitScene(page, 'Dialogue');
    await page.waitFor(`!!window.__game.scene.getScene('Dialogue').nameText`, { timeout: 20000 });
    await sleep(600);
    const i0 = await page.ev(`window.__game.scene.getScene('Dialogue').index`);
    await page.hidden(true);
    await sleep(2500);
    await page.hidden(false);
    await sleep(600);
    const d = await page.ev(`({ index: window.__game.scene.getScene('Dialogue').index, typing: window.__game.scene.getScene('Dialogue').typing, active: window.__game.scene.getScenes(true).map(s => s.scene.key) })`);
    log(d.index === i0 && d.active.includes('Dialogue'), 'hidden mid-dialogue: line index unchanged, scene intact', JSON.stringify(d));
    await page.tap(180, 560);
    await sleep(200);
    await page.tap(180, 560);
    await sleep(300);
    log((await page.ev(`window.__game.scene.getScene('Dialogue').index`)) === i0 + 1, 'dialogue still advances one line per tap afterwards');
    // rapid taps: 6 taps within ~150 ms must not run past 3 lines (2 taps per line = complete + advance)
    const before = await page.ev(`window.__game.scene.getScene('Dialogue').index`);
    for (let i = 0; i < 6; i++) await page.tap(180, 560);
    await sleep(300);
    const after = await page.ev(`window.__game.scene.getScene('Dialogue').index`);
    log(after - before <= 3, 'rapid taps in dialogue: 6 taps move at most 3 lines (complete+advance pairs)', `${before}→${after}`);
    const c = await open(chrome, `${server.url}?cutscene=origin&shot=3`);
    await waitScene(c, 'Cutscene');
    await c.waitFor(`window.__game.scene.getScene('Cutscene').index === 2`, { timeout: 30000 });
    await sleep(500);
    await c.hidden(true);
    await sleep(2500);
    await c.hidden(false);
    await sleep(500);
    const cs = await c.ev(`({ index: window.__game.scene.getScene('Cutscene').index, done: window.__game.scene.getScene('Cutscene').done })`);
    log(cs.index === 2 && !cs.done, 'hidden mid-cutscene: shot index unchanged (timer paused with the game)', JSON.stringify(cs));
    log(page.errors.length + c.errors.length === 0, 'no console errors (story hidden)');
  }

  // ---------- input guards ----------
  if (want('input')) {
    const page = await open(chrome, server.url);
    await waitScene(page, 'Title');
    await sleep(800);
    const g = await page.ev(`(() => { const cs = getComputedStyle(document.body); const cv = getComputedStyle(document.querySelector('canvas'));
      const mk = (t) => { const e = new Event(t, { cancelable: true, bubbles: true }); document.querySelector('canvas').dispatchEvent(e); return e.defaultPrevented; };
      return { bodySelect: cs.userSelect, bodyTouch: cs.touchAction, bodyCallout: cs.getPropertyValue('-webkit-touch-callout'), canvasSelect: cv.userSelect, canvasTouch: cv.touchAction, contextmenu: mk('contextmenu'), selectstart: mk('selectstart'), dragstart: mk('dragstart'), gesturestart: mk('gesturestart'), overscroll: cs.overscrollBehavior, viewport: document.querySelector('meta[name=viewport]').content }; })()`);
    log(g.bodySelect === 'none' && g.bodyTouch === 'none' && g.canvasSelect === 'none' && g.canvasTouch === 'none', 'CSS: user-select none, touch-action none on body and canvas', JSON.stringify(g));
    log(g.contextmenu && g.selectstart && g.dragstart && g.gesturestart, 'long-press callout / selection / drag / pinch events are default-prevented');
    log(/user-scalable=no/.test(g.viewport) && /maximum-scale=1/.test(g.viewport) && /viewport-fit=cover/.test(g.viewport), 'viewport meta: no zoom, cover', g.viewport);
    // long-press on a Menu button must not select text or open a menu; the game still works
    await page.tap(180, 300);
    await waitScene(page, 'Menu');
    await sleep(500);
    await page.hold(180, ui.menu.firstY + 3 * ui.menu.spacing, 900);
    await sleep(500);
    const sel = await page.ev(`String(getSelection())`);
    log(sel === '' && (await page.scenes()).includes('Settings'), 'long-press (900 ms) on a button: no text selection, press still registers', `selection "${sel}" scenes ${(await page.scenes()).join('+')}`);
    // double tap on Title/Menu: one transition only
    const p2 = await open(chrome, server.url);
    await waitScene(p2, 'Title');
    await sleep(800);
    await p2.tap(180, 300);
    await p2.tap(180, 300);
    await sleep(1200);
    const sc = await p2.scenes();
    log(sc.includes('Menu') && sc.filter((s) => s === 'Menu').length === 1, 'double tap on Title: one Menu, no extra action', sc.join('+'));
    // double tap New Game, then double tap a difficulty → one cutscene
    await p2.tap(180, ui.menu.firstY);
    await p2.tap(180, ui.menu.firstY);
    await sleep(400);
    await p2.tap(180, ui.menu.difficulty.firstY + ui.menu.difficulty.spacing);
    await p2.tap(180, ui.menu.difficulty.firstY + ui.menu.difficulty.spacing);
    await sleep(1500);
    const sc2 = await p2.scenes();
    log(sc2.filter((s) => s === 'Cutscene').length === 1 && !sc2.includes('Menu'), 'double tap on New Game: one chapter start', sc2.join('+'));
    // battle: double tap Strike then double tap enemy -> one strike
    const b = await battle(chrome, server, 'b1_forgotten');
    await waitMenu(b);
    await b.ev(`window.__battle.tutorialSlow = false; window.__strikes = 0; const o = window.__battle.playerStrike.bind(window.__battle); window.__battle.playerStrike = (h, t) => { window.__strikes++; return o(h, t); };`);
    await b.tap(...slots.strike);
    await b.tap(...slots.strike);
    await sleep(500);
    const items = await b.ev(`window.__battle.menu.items.map(i => i.slot + ':' + i.value)`);
    const e = await b.ev(`({ x: window.__battle.enemies[0].container.x, y: window.__battle.enemies[0].container.y })`);
    await b.tap(e.x, e.y - 20);
    await b.tap(e.x, e.y - 20);
    await b.tap(e.x, e.y - 20);
    await sleep(2500);
    const strikes = await b.ev(`window.__strikes`);
    log(strikes === 1, 'battle: double-tapped Strike + triple-tapped enemy = exactly one Strike', `strikes ${strikes}; menu after double tap: ${items.join(' ')}`);
    log(b.errors.length === 0, 'no console errors (input)');
  }

  // ---------- back / reload ----------
  if (want('nav')) {
    const page = await open(chrome, `${server.url}?step=3`);
    await waitScene(page, 'Dialogue');
    await sleep(800);
    await page.tap(180, 560);
    await page.tap(180, 560);
    await page.ev(`history.pushState({}, '', location.href)`);
    await page.ev(`history.back()`);
    await sleep(800);
    log((await page.scenes()).includes('Dialogue') && page.errors.length === 0, 'browser back (history entry popped): game keeps running, no error');
    const hasPop = await page.ev(`typeof window.onpopstate`);
    log(true, 'INFO: the game has no back-button handler', `window.onpopstate is ${hasPop}; a real Back on a phone leaves the page (progress is not saved)`);
    await page.goto(`${server.url}?step=3`);
    await waitScene(page, 'Dialogue');
    log(page.errors.length === 0, 'reload mid-chapter: boots cleanly');
    await page.goto(server.url);
    await waitScene(page, 'Title');
    log(true, 'INFO: a plain reload mid-chapter returns to Title (no save of chapter progress)');
  }

  // ---------- leaks: 5× Retry ----------
  if (want('leaks')) {
    const page = await battle(chrome, server, 'b1_forgotten');
    await waitMenu(page);
    const metrics = () =>
      page.ev(`(() => { const B = window.__battle; const g = window.__game; const count = (em) => em.eventNames().reduce((s, n) => s + em.listenerCount(n), 0);
        return { children: B.children.length, tweens: B.tweens.getTweens().length, timers: B.time._active.length + B.time._pending.length,
          sceneEvents: count(B.events), input: count(B.input), gameEvents: count(g.events), anims: B.anims.anims.size, textures: g.textures.getTextureKeys().length,
          updateList: B.sys.updateList.getActive().length, rings: B.qteRings ? B.qteRings.size : 0, sceneKeys: g.scene.getScenes(false).length }; })()`);
    const heap = async () => {
      await page.cdp.send('HeapProfiler.enable').catch(() => {});
      await page.cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      await sleep(200);
      return +((await page.cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(2);
    };
    const series = [];
    const h = [];
    series.push(await metrics());
    h.push(await heap());
    for (let i = 0; i < 5; i++) {
      await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.heroes.forEach(x => B.applyHit(x, 9999)); })()`);
      await page.waitFor(`window.__battle.battleOver === true`, { timeout: 15000 });
      await sleep(2300);
      await page.tap(...slots.retry);
      await sleep(1500);
      await waitMenu(page, 20000);
      await sleep(500);
      series.push(await metrics());
      h.push(await heap());
    }
    const first = series[1];
    const last = series[series.length - 1];
    const keys = Object.keys(first);
    const grew = keys.filter((k) => last[k] > first[k]);
    log(grew.length === 0, 'Retry ×5: children/tweens/timers/listeners/anims/textures do not grow after the 1st retry', grew.length ? grew.map((k) => `${k}: ${first[k]}→${last[k]}`).join(', ') : `stable: ${JSON.stringify(last)}`);
    log(h[h.length - 1] - h[1] < 3, 'Retry ×5: JS heap (after GC) stays flat', `heap MB per cycle ${h.join(' → ')}`);
    console.log('   metrics per cycle:', JSON.stringify(series));
    log(page.errors.length === 0, 'no console errors during Retry ×5', page.errors.slice(0, 2).join(' | '));
  }
});

const bad = rows.filter((r) => !r.ok);
console.log(`\nrobustness: ${rows.length - bad.length}/${rows.length} ok`);
process.exit(bad.length ? 1 : 0);
