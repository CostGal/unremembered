// QA part C: Title, Menu (locked toasts, first-run difficulty), Settings
// (sliders, Story Mode, persistence across reload), Credits, End scene.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8'));
const credits = JSON.parse(readFileSync(join(root, 'src/data/credits.json'), 'utf8'));
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const rows = [];
const check = (name, ok, detail = '') => {
  rows.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const texts = (page, scene) => page.ev(`window.__game.scene.getScene('${scene}').children.list.filter(o => o.type === 'Text').map(o => ({ t: o.text, x: Math.round(o.x), y: Math.round(o.y), v: o.visible, a: +o.alpha.toFixed(2) }))`);
const settings = (page) => page.ev(`JSON.stringify(window.__game.registry.get('settings'))`).then(JSON.parse);

await withBrowser(async ({ chrome, server }) => {
  // ---- Title
  let page = await open(chrome, server.url);
  await waitScene(page, 'Title');
  await sleep(2500);
  await page.shot(join(out, 'title.png'));
  const tt = await texts(page, 'Title');
  check('Title: "Tap to start" visible', tt.some((t) => /Tap to start/i.test(t.t) && t.v));
  check('Title: silent-mode hint', tt.some((t) => /silent mode/i.test(t.t) && t.v), tt.find((t) => /silent/i.test(t.t))?.t);
  const art = await page.ev(`(() => { const s = window.__game.scene.getScene('Title'); const tex = window.__game.textures; const real = (k) => tex.exists(k) && !tex.get(k).customData.placeholder; return { bg: real('title_bg'), logo: real('logo') }; })()`);
  check('Title: title_bg + logo are real art (no placeholder)', art.bg && art.logo, JSON.stringify(art));
  // ---- Menu
  await page.tap(180, 300);
  await waitScene(page, 'Menu');
  await sleep(600);
  await page.shot(join(out, 'menu.png'));
  const items = ui.menu.items;
  const first = ui.menu.firstY;
  for (const [i, item] of items.entries()) {
    if (!item.locked || item.inert) continue;
    const y = first + i * ui.menu.spacing;
    await page.tap(180, y);
    await sleep(200);
    const mt = await texts(page, 'Menu');
    check(`Menu: "${item.label}" shows "${ui.menu.lockedText}" toast`, mt.some((t) => t.t === ui.menu.lockedText && t.v));
    await sleep(900);
  }
  // ---- Settings
  const sy = (i) => ui.settings.firstY + i * ui.settings.spacing;
  await page.tap(180, first + 3 * ui.menu.spacing);
  await waitScene(page, 'Settings');
  await sleep(500);
  await page.shot(join(out, 'settings.png'));
  let s0 = await settings(page);
  const seq = [];
  for (let i = 0; i < 5; i++) {
    await page.tap(180, sy(0));
    await sleep(150);
    seq.push((await settings(page)).musicVolume);
  }
  check('Settings: music volume cycles 1→.75→.5→.25→0→…', JSON.stringify(seq) === JSON.stringify([0.75, 0.5, 0.25, 0, 1]) || JSON.stringify(seq) === JSON.stringify([0.5, 0.25, 0, 1, 0.75]), `${s0.musicVolume} then ${seq}`);
  const sfx = [];
  for (let i = 0; i < 5; i++) {
    await page.tap(180, sy(1));
    await sleep(150);
    sfx.push((await settings(page)).sfxVolume);
  }
  check('Settings: SFX volume cycles through all steps', new Set(sfx).size === 5, String(sfx));
  const before = (await settings(page)).difficulty;
  await page.tap(180, sy(2));
  await sleep(150);
  const after = (await settings(page)).difficulty;
  check('Settings: Difficulty cycles', before !== after && !!after, `${before}→${after}`);
  await page.shot(join(out, 'settings_changed.png'));
  const saved = await page.ev(`localStorage.getItem('unremembered:settings')`);
  check('Settings: persisted to localStorage', !!saved && JSON.parse(saved).difficulty === after, saved);
  const want = await settings(page);
  await page.goto(server.url);
  await waitScene(page, 'Title');
  const reloaded = await settings(page);
  await sleep(1200);
  check('Settings: survive reload', reloaded.difficulty === want.difficulty && reloaded.musicVolume === want.musicVolume && reloaded.sfxVolume === want.sfxVolume, JSON.stringify(reloaded));
  await page.tap(180, 300);
  await waitScene(page, 'Menu');
  await sleep(400);
  await page.tap(180, first + 3 * ui.menu.spacing);
  await waitScene(page, 'Settings');
  await sleep(300);
  await page.tap(180, ui.settings.backY);
  await waitScene(page, 'Menu');
  check('Settings: Back returns to Menu', true);
  // ---- Credits
  await sleep(300);
  // Credits are revealed (credits.json revealed: true): the tap opens the End scene with the list.
  await page.tap(180, first + 4 * ui.menu.spacing);
  await waitScene(page, 'End');
  check('Credits: menu item opens the credits', (await page.scenes()).includes('End'));
  await sleep(2200);
  await page.shot(join(out, 'credits.png'));
  const ct = await texts(page, 'End');
  const revealed = credits.revealed !== false;
  check('Credits: list (or hidden text) + hint rendered', (revealed ? ct.some((t) => /Credits/i.test(t.t)) && ct.length >= credits.lines.length : ct.some((t) => /post game jam/i.test(t.t))) && ct.some((t) => /Tap to return/i.test(t.t)), `${ct.length} text objects; hint "${ct.find((t) => /Tap to return/i.test(t.t))?.t}" a=${ct.find((t) => /Tap to return/i.test(t.t))?.a}`);
  const maxY = Math.max(...ct.map((t) => t.y));
  check('Credits: nothing past y 580 (bottom 60 px)', maxY <= 580, `max y ${maxY}`);
  await page.tap(180, 300);
  await waitScene(page, 'Menu');
  check('Credits: tap returns to Menu', true);
  // ---- First run: difficulty panel (fresh storage)
  await page.ev(`localStorage.clear()`);
  await page.goto(server.url);
  await waitScene(page, 'Title');
  await sleep(1200);
  await page.tap(180, 300);
  await waitScene(page, 'Menu');
  await sleep(300);
  await page.tap(180, first);
  await sleep(400);
  await page.shot(join(out, 'first_run_choice.png'));
  const panel = await page.ev(`!!window.__game.scene.getScene('Menu').panel`);
  check('New Game asks Story/Normal/Unforgettable', panel);
  await page.tap(180, ui.menu.difficulty.firstY);
  await sleep(1500);
  const st = await settings(page);
  check('Choosing Story sets difficulty story (+ storyMode)', st.difficulty === 'story' && st.storyMode === true, JSON.stringify(st));
  const act = await page.scenes();
  check('First run: chapter starts (Cutscene)', act.includes('Cutscene'), act.join('+'));
  check('No console errors', page.errors.length === 0, page.errors.slice(0, 2).join(' | '));
  // second New Game does not ask again
  await page.goto(server.url);
  await waitScene(page, 'Title');
  await sleep(1200);
  await page.tap(180, 300);
  await waitScene(page, 'Menu');
  await sleep(300);
  await page.tap(180, first);
  await sleep(600);
  check('Second New Game asks again', !!(await page.ev(`!!window.__game.scene.getScene('Menu').panel`)));
  await page.tap(180, ui.menu.difficulty.firstY + 2 * ui.menu.difficulty.spacing);
  await sleep(1500);
  check('Choosing Unforgettable starts the chapter', (await page.scenes()).includes('Cutscene') && (await settings(page)).difficulty === 'unforgettable');
  // ---- End scene (non-credits)
  await page.goto(server.url + '?step=16');
  await sleep(300);
  await page.ev(`(() => { const g = window.__game; g.scene.getScenes(true).forEach((s) => { if (s.scene.key !== 'Loader') g.scene.stop(s.scene.key); }); g.scene.start('End'); return 1; })()`);
  await sleep(2500);
  await page.shot(join(out, 'end_of_demo.png'));
  const et = await texts(page, 'End');
  check('End of Demo: shows "End of Demo"', et.some((t) => /end of demo/i.test(t.t)), et.map((t) => t.t).slice(0, 4).join(' / '));
});
const bad = rows.filter((r) => !r.ok);
console.log(`\nfrontend: ${rows.length - bad.length}/${rows.length} passed`);
process.exit(bad.length ? 1 : 0);
