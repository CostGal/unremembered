// QA part H: the same screens at 360x640, 375x667, 390x844, 412x915 and
// 390x754 (Instagram toolbars eating ~90 px). Per screen: canvas fully inside
// the viewport, tap targets >= 56 px tall and >= 16 px from the screen edges,
// text >= 12 px effective, and what sits in the bottom 60 CSS px.
//   node scripts/qa/viewports.mjs --out dir
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8'));
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const VIEWPORTS = [
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [390, 754],
];
const SCAN = `(() => {
  const g = window.__game; const canvas = document.querySelector('canvas'); const r = canvas.getBoundingClientRect(); const s = r.width / 360;
  const res = { s, canvas: { x: r.x, y: r.y, w: r.width, h: r.height }, vp: { w: innerWidth, h: innerHeight }, taps: [], texts: [] };
  const walk = (o, scene, parentAlpha) => {
    if (!o || o.visible === false) return;
    const alpha = (o.alpha === undefined ? 1 : o.alpha) * parentAlpha;
    if (o.input && o.input.enabled && alpha > 0.05) {
      const b = o.getBounds();
      const full = b.width >= 350 && b.height >= 600;
      const ha = o.input.hitArea;
      let w = b.width, h = b.height;
      if (ha && ha.width !== undefined && o.type !== 'Image' && o.type !== 'Sprite') { w = ha.width * Math.abs(o.scaleX); h = ha.height * Math.abs(o.scaleY); }
      if (!full) res.taps.push({ scene: scene.scene.key, type: o.type, name: o.name || (o.list && o.list.find(c => c.type === 'Text') ? o.list.find(c => c.type === 'Text').text : '') || o.type, cx: b.centerX, cy: b.centerY, w, h, left: b.left, right: b.right, top: b.top, bottom: b.bottom });
    }
    if (o.type === 'Text' && alpha > 0.1 && o.text && o.text.trim()) {
      const b = o.getBounds(); const px = parseFloat(o.style.fontSize) || 0;
      res.texts.push({ scene: scene.scene.key, text: o.text.slice(0, 30), px, left: b.left, right: b.right, top: b.top, bottom: b.bottom });
    }
    if (o.list) o.list.forEach((c) => walk(c, scene, alpha));
  };
  for (const scene of g.scene.getScenes(true)) { if (scene.scene.key === 'Loader') continue; scene.children.list.forEach((c) => walk(c, scene, 1)); }
  return res;
})()`;

function analyse(scan, screen) {
  const issues = [];
  const { s, canvas, vp } = scan;
  if (canvas.x < -0.5 || canvas.y < -0.5 || canvas.x + canvas.w > vp.w + 0.5 || canvas.y + canvas.h > vp.h + 0.5) issues.push(`canvas not fully inside viewport (${JSON.stringify(canvas)} in ${vp.w}x${vp.h})`);
  const css = (gx, gy) => [canvas.x + gx * s, canvas.y + gy * s];
  for (const t of scan.taps) {
    const h = t.h * s;
    const [l, top] = css(t.left, t.top);
    const [r, bottom] = css(t.right, t.bottom);
    // enemy sprites and the like are targets too, so only flag the small ones that are UI buttons
    if (h < 56 - 0.5 && !/Image|Sprite/.test(t.type)) issues.push(`tap target "${t.name}" ${Math.round(t.w * s)}x${Math.round(h)} css px (< 56 tall)`);
    if (l < 16 - 0.5 || vp.w - r < 16 - 0.5) issues.push(`tap target "${t.name}" ${Math.round(Math.min(l, vp.w - r))}px from the side edge (< 16)`);
    if (bottom > vp.h - 60 + 0.5 && !/Image|Sprite/.test(t.type)) issues.push(`tap target "${t.name}" reaches into the bottom 60 px (bottom at ${Math.round(vp.h - bottom)} px from the edge)`);
  }
  for (const t of scan.texts) {
    if (t.px * s < 12 - 0.01) issues.push(`text "${t.text}" ${t.px}px × ${s.toFixed(2)} = ${(t.px * s).toFixed(1)} css px (< 12)`);
    const [, bottom] = css(0, t.bottom);
    if (bottom > vp.h - 60 + 0.5 && !screen.allowBottom) issues.push(`text "${t.text}" in the bottom 60 px (${Math.round(vp.h - bottom)} px from the edge)`);
    const [l] = css(t.left, 0);
    const [r] = css(t.right, 0);
    if (l < 0 || r > vp.w) issues.push(`text "${t.text}" runs off the screen`);
  }
  return issues;
}

const wait = {
  title: (p) => waitScene(p, 'Title'),
};

const SCREENS = [
  { name: 'title', url: '', run: async (p) => { await waitScene(p, 'Title'); await sleep(2200); } },
  { name: 'menu', url: '', run: async (p) => { await waitScene(p, 'Title'); await sleep(900); await p.tap(180, 300); await waitScene(p, 'Menu'); await sleep(700); } },
  { name: 'settings', url: '', run: async (p) => { await waitScene(p, 'Title'); await sleep(900); await p.tap(180, 300); await waitScene(p, 'Menu'); await sleep(500); await p.tap(180, ui.menu.firstY + 3 * ui.menu.spacing); await waitScene(p, 'Settings'); await sleep(500); } },
  { name: 'credits', url: '', run: async (p) => { await waitScene(p, 'Title'); await sleep(900); await p.tap(180, 300); await waitScene(p, 'Menu'); await sleep(500); await p.tap(180, ui.menu.firstY + 4 * ui.menu.spacing); await waitScene(p, 'End'); await sleep(2400); }, allowBottom: true },
  { name: 'first_run_choice', url: '', run: async (p) => { await p.ev(`localStorage.clear()`); await waitScene(p, 'Title'); await sleep(900); await p.tap(180, 300); await waitScene(p, 'Menu'); await sleep(400); await p.tap(180, ui.menu.firstY); await sleep(500); } },
  { name: 'cutscene', url: '?cutscene=origin&shot=15', run: async (p) => { await waitScene(p, 'Cutscene'); await sleep(2500); await p.ev(`window.__game.scene.getScene('Cutscene').completeText()`); } },
  { name: 'letter', url: '?step=1', run: async (p) => { await waitScene(p, 'Dialogue'); await sleep(1200); await p.ev(`window.__game.scene.getScene('Dialogue').completeLine && window.__game.scene.getScene('Dialogue').completeLine()`); } },
  { name: 'dialogue_portraits', url: '?step=2', run: async (p) => { await waitScene(p, 'Dialogue'); await sleep(1200); for (let i = 0; i < 6; i++) { await p.ev(`window.__game.scene.getScene('Dialogue').completeLine()`); await p.tap(180, 520); await sleep(150); } await p.ev(`window.__game.scene.getScene('Dialogue').completeLine()`); await sleep(300); } },
  { name: 'battle_commands', url: '?battle=b1_forgotten', run: async (p) => { await p.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`, { timeout: 40000 }); await sleep(800); }, allowBottom: true },
  { name: 'battle_targeting', url: '?battle=b1_forgotten', run: async (p) => { await p.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`, { timeout: 40000 }); await sleep(500); await p.ev(`window.__battle.tutorialSlow = false`); await p.tap(...Object.values(ui.commands.slots.strike)); await sleep(500); }, allowBottom: true },
  { name: 'battle_ring', url: '?battle=boss_clerk', run: async (p) => { await p.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`, { timeout: 40000 }); await p.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.enemyHit(B.enemies[0], B.heroes[0], { telegraphMs: 5000, dmg: 10 }, null, 0); })()`); await sleep(1500); }, allowBottom: true },
  { name: 'reward', url: '?reward=1', run: async (p) => { await waitScene(p, 'Reward'); await sleep(2200); } },
];

const results = [];
await withBrowser(async ({ chrome, server }) => {
  for (const [w, h] of VIEWPORTS) {
    const dir = join(out, `${w}x${h}`);
    mkdirSync(dir, { recursive: true });
    for (const screen of SCREENS) {
      const page = await open(chrome, server.url + screen.url, { w, h, dpr: 2 });
      try {
        await screen.run(page);
        const scan = await page.ev(SCAN);
        const issues = analyse(scan, screen);
        await page.shot(join(dir, `${screen.name}.png`));
        const minTap = scan.taps.filter((t) => !/Image|Sprite/.test(t.type)).reduce((m, t) => Math.min(m, t.h * scan.s), Infinity);
        const minText = scan.texts.reduce((m, t) => Math.min(m, t.px * scan.s), Infinity);
        results.push({ vp: `${w}x${h}`, screen: screen.name, scale: +scan.s.toFixed(3), taps: scan.taps.length, minTapH: Number.isFinite(minTap) ? Math.round(minTap) : null, minTextPx: Number.isFinite(minText) ? +minText.toFixed(1) : null, issues, errors: page.errors.length });
        console.log(`${issues.length ? '✗' : '✓'} ${w}x${h} ${screen.name.padEnd(18)} scale ${scan.s.toFixed(2)}  min tap ${Number.isFinite(minTap) ? Math.round(minTap) : '-'}px  min text ${Number.isFinite(minText) ? minText.toFixed(1) : '-'}px${issues.length ? '\n     ' + [...new Set(issues)].slice(0, 6).join('\n     ') : ''}`);
      } catch (e) {
        results.push({ vp: `${w}x${h}`, screen: screen.name, issues: [`script error: ${e.message}`] });
        console.log(`✗ ${w}x${h} ${screen.name}: ${e.message}`);
      }
    }
  }
});
writeFileSync(join(out, 'viewports.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.issues.length);
console.log(`\nviewports: ${results.length - bad.length}/${results.length} screen×viewport combos clean`);
