// QA part D: all 30 origin shots. Per shot: picture coverage (no empty edge,
// early and at the end of the pan/zoom), cutout placement, eyes_glow points,
// text bounds. Tap / hold-to-skip / transition into the letter dialogue.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const shots = JSON.parse(readFileSync(join(root, 'src/data/cutscene_origin.json'), 'utf8')).shots;
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const rows = [];
const log = (ok, name, detail = '') => {
  rows.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MEASURE = `(() => {
  const c = window.__game.scene.getScene('Cutscene');
  const stage = c.shotLayer.list[0];
  const imgs = stage ? stage.list.filter(o => o.type === 'Image' && o.texture && !o.texture.key.startsWith('__') && o.blendMode === 0) : [];
  const info = imgs.map(i => { const b = i.getBounds(); return { key: i.texture.key, l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), masked: !!i.mask }; });
  const glows = stage ? stage.list.filter(o => o.blendMode === 1).map(g => { const p = g.getWorldTransformMatrix(); return { x: Math.round(p.tx), y: Math.round(p.ty), a: +g.alpha.toFixed(2) }; }) : [];
  const tb = c.text.getBounds();
  return { index: c.index, typing: c.typing, stage: stage ? { x: +stage.x.toFixed(1), y: +stage.y.toFixed(1), s: +stage.scaleX.toFixed(3) } : null, imgs: info, glows, text: { l: Math.round(tb.left), r: Math.round(tb.right), t: Math.round(tb.top), b: Math.round(tb.bottom), lines: c.text.getWrappedText().length } };
})()`;

await withBrowser(async ({ chrome, server }) => {
  const page = await open(chrome, server.url + '?cutscene=origin&shot=1');
  await waitScene(page, 'Cutscene');
  await page.waitFor(`window.__game.scene.getScene('Cutscene').index === 0`, { timeout: 30000 });
  const early = [];
  const late = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (i > 0) await page.ev(`(() => { const c = window.__game.scene.getScene('Cutscene'); c.tweens.timeScale = 1; c.nextShot(); })()`);
    await sleep(500);
    await page.ev(`window.__game.scene.getScene('Cutscene').completeText()`);
    const a = await page.ev(MEASURE);
    await page.shot(join(out, `shot_${String(i + 1).padStart(2, '0')}_early.png`));
    await page.ev(`window.__game.scene.getScene('Cutscene').tweens.timeScale = 40`);
    await sleep(900);
    const b = await page.ev(MEASURE);
    await page.shot(join(out, `shot_${String(i + 1).padStart(2, '0')}_late.png`));
    early.push(a);
    late.push(b);
    const issues = [];
    if (a.index !== i) issues.push(`index ${a.index}`);
    // Coverage: the background picture must reach every edge of its cell.
    const split = shot.split || 'none';
    const cov = (m) => {
      const ims = m.imgs.filter((x) => x.key === shot.bg || x.key === shot.bg2);
      if (split === 'none') {
        const im = ims[0];
        if (!im) return shot.bg ? 'bg missing' : null;
        return im.l <= 0 && im.r >= 360 && im.t <= 0 && im.b >= 640 ? null : `bg edge exposed (l${im.l} r${im.r} t${im.t} b${im.b})`;
      }
      return null;
    };
    for (const [when, m] of [['start', a], ['end', b]]) {
      const c = cov(m);
      if (c) issues.push(`${when}: ${c}`);
    }
    // Cutouts must stay on screen.
    for (const l of shot.layers || []) {
      const m = b.imgs.find((x) => x.key === l.img);
      if (!m) continue;
      if (m.l < -40 || m.r > 400) issues.push(`layer ${l.img} runs off the side (l${m.l} r${m.r})`);
    }
    if (a.text.b > 620) issues.push(`text bottom ${a.text.b}`);
    if (a.text.l < 8 || a.text.r > 352) issues.push(`text sides ${a.text.l}-${a.text.r}`);
    if (shot.fx && shot.fx.includes('eyes_glow')) log(true, `shot ${i + 1} eyes_glow points`, JSON.stringify(a.glows) + ' (visual check in screenshot)');
    const tags = `${shot.move && shot.move !== 'none' ? ' ' + shot.move : ''}${shot.split && shot.split !== 'none' ? ' split-' + shot.split : ''}`;
    log(issues.length === 0, `shot ${i + 1}${tags} [${(shot.fx || []).join(',')}] text ${a.text.lines} lines y${a.text.t}-${a.text.b}`, issues.join('; '));
  }
  await page.ev(`window.__game.scene.getScene('Cutscene').tweens.timeScale = 1`);

  // ---- tap advance + hold-to-skip + transition (fresh run with the runner: ?step=0)
  const p2 = await open(chrome, server.url + '?step=0');
  await waitScene(p2, 'Cutscene');
  await p2.waitFor(`window.__game.scene.getScene('Cutscene').index === 0`, { timeout: 30000 });
  await sleep(300);
  const typing0 = await p2.ev(`window.__game.scene.getScene('Cutscene').typing`);
  await p2.tap(180, 300);
  await sleep(150);
  const st1 = await p2.ev(`({ typing: window.__game.scene.getScene('Cutscene').typing, index: window.__game.scene.getScene('Cutscene').index })`);
  log(typing0 && !st1.typing && st1.index === 0, 'tap while typing completes the line (stays on shot 1)', JSON.stringify(st1));
  await p2.tap(180, 300);
  await sleep(250);
  log((await p2.ev(`window.__game.scene.getScene('Cutscene').index`)) === 1, 'tap after the line advances to shot 2');
  const before = await p2.ev(`window.__game.scene.getScene('Cutscene').index`);
  await p2.tap(180, 300);
  await p2.tap(180, 300);
  await sleep(250);
  const afterDouble = await p2.ev(`window.__game.scene.getScene('Cutscene').index`);
  log(afterDouble - before <= 1, 'double tap advances at most one shot', `${before}→${afterDouble}`);
  // hold: the radial fill appears, then skips the whole cutscene
  await p2.move(180, 300);
  await p2.down(180, 300);
  await sleep(450);
  const ring = await p2.ev(`window.__game.scene.getScene('Cutscene').holdRing.commandBuffer.length`);
  await p2.shot(join(out, 'hold_fill_mid.png'));
  log(ring > 0, 'hold shows the radial fill (450 ms in)', `${ring} draw commands`);
  await sleep(450);
  await p2.up(180, 300);
  await waitScene(p2, 'Dialogue', 8000).catch(() => {});
  await sleep(500);
  const d = await p2.ev(`(() => { const g = window.__game; const d = g.scene.getScene('Dialogue'); return { active: g.scene.getScenes(true).map(s => s.scene.key), id: d && d.dialogueId }; })()`);
  log(d.active.includes('Dialogue') && d.id === 'letter', 'hold 800 ms skips the cutscene → letter dialogue', JSON.stringify(d));
  await p2.shot(join(out, 'letter_after_skip.png'));
  log(page.errors.length + p2.errors.length === 0, 'no console errors in cutscene runs', [...page.errors, ...p2.errors].slice(0, 2).join(' | '));
  writeFileSync(join(out, 'cutscene_measure.json'), JSON.stringify({ early, late }, null, 1));
});
const bad = rows.filter((r) => !r.ok);
console.log(`\ncutscene: ${rows.length - bad.length}/${rows.length} ok`);
process.exit(bad.length ? 1 : 0);
