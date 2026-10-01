// QA part E: every dialogue id, every line. Checks text fits the box, the
// portrait is the real art (no placeholder grey box), side / facing / dim,
// letter style, silhouette. Writes per-dialogue contact sheets' source shots.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const dialogue = JSON.parse(readFileSync(join(root, 'src/data/dialogue.json'), 'utf8'));
const chapter = JSON.parse(readFileSync(join(root, 'src/data/chapter1.json'), 'utf8'));
const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8')).dialogue;
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const bgOf = Object.fromEntries(chapter.filter((s) => s.type === 'dialogue').map((s) => [s.id, s.bg]));
const rows = [];
const overflow = [];

await withBrowser(async ({ chrome, server }) => {
  const page = await open(chrome, server.url + '?step=0');
  await page.gameReady();
  for (const id of Object.keys(dialogue)) {
    await page.ev(`(() => { const g = window.__game; g.scene.getScenes(true).forEach(s => { if (s.scene.key !== 'Loader') g.scene.stop(s.scene.key); }); g.registry.remove('runner'); g.scene.start('Dialogue', { id: ${JSON.stringify(id)}, bg: ${JSON.stringify(bgOf[id] ?? 'black')} }); })()`);
    await waitScene(page, 'Dialogue');
    await page.waitFor(`!!window.__game.scene.getScene('Dialogue').nameText`, { timeout: 15000 });
    await sleep(500);
    const lines = dialogue[id];
    for (let i = 0; i < lines.length; i++) {
      await page.ev(`(() => { const d = window.__game.scene.getScene('Dialogue'); if (d.typing) d.completeLine(); })()`);
      await sleep(250);
      const info = await page.ev(`(() => {
        const d = window.__game.scene.getScene('Dialogue'); const T = window.__game.textures;
        const slots = Object.fromEntries(Object.entries(d.portraits).map(([side, s]) => [side, { key: s.key, owner: s.owner, visible: s.image.visible, flipX: s.image.flipX, tint: s.image.tintTopLeft, tex: s.image.texture.key, placeholder: !!T.get(s.image.texture.key).customData.placeholder, w: Math.round(s.image.displayWidth), h: Math.round(s.image.displayHeight) }]));
        const bt = d.bodyText; const bb = bt.getBounds();
        return { index: d.index, speaker: d.nameText.text, name: d.nameText.text, textBottom: Math.round(bb.bottom), textRight: Math.round(bb.right), textLeft: Math.round(bb.left), boxBottom: d.box.y + d.box.height, boxRight: d.box.x + d.box.width, slots, sil: !!d.silhouette, fill: d.box.fillColor, bodyLines: bt.getWrappedText().length, shownFull: bt.text === d.fullText };
      })()`);
      const line = lines[i];
      const issues = [];
      if (info.index !== i) issues.push(`index ${info.index}≠${i}`);
      if (!info.shownFull) issues.push('text not fully shown');
      if (info.textBottom > info.boxBottom - 8) overflow.push({ id, i, bottom: info.textBottom, limit: info.boxBottom, lines: info.bodyLines, text: line.text });
      if (info.textRight > info.boxRight) issues.push('text past box right edge');
      const style = ui.styles[line.style || 'normal'];
      for (const [side, s] of Object.entries(info.slots)) {
        if (s.visible && s.placeholder) issues.push(`${side} portrait ${s.key} is a placeholder`);
        if (s.visible && s.key === null) issues.push(`${side} visible with no key`);
      }
      if (style.portraits && line.speaker && line.portrait) {
        const owner = line.portrait.split('_')[0];
        const side = ui.portraitSides[owner] || ui.portraitSides.default;
        const s = info.slots[side];
        if (!s.visible || s.key !== line.portrait) issues.push(`expected ${line.portrait} on ${side}, got ${s.key}`);
        const other = info.slots[side === 'left' ? 'right' : 'left'];
        if (s.tint !== 0xffffff) issues.push('speaker portrait not lit');
        if (other.visible && other.tint === 0xffffff) issues.push('other portrait not dimmed');
        const wantFlip = side === 'right';
        if (s.visible && !s.placeholder && s.flipX !== wantFlip) issues.push(`flipX ${s.flipX} on ${side}`);
      }
      if (!style.portraits && (info.slots.left.visible || info.slots.right.visible)) issues.push('portraits shown on a no-portrait style');
      if (line.silhouette && !info.sil) issues.push('silhouette line but no silhouette');
      const quick = (line.style || 'normal') === 'letter' || line.silhouette || issues.length || i === 0 || (line.portrait && lines[i - 1]?.portrait !== line.portrait);
      if (quick) await page.shot(join(out, `${id}_${String(i).padStart(2, '0')}.png`));
      rows.push({ id, i, style: line.style || 'normal', speaker: line.speaker, portrait: line.portrait, issues });
    }
    // Missing-line / finish behaviour: after the last line a tap finishes (runner absent -> Title)
  }
  rows.push({ id: '_console', i: -1, issues: [...page.errors, ...page.warnings.filter((w) => /portrait|dialogue/.test(w))] });
});
const bad = rows.filter((r) => r.issues.length);
for (const r of bad) console.log(`✗ ${r.id}[${r.i}] ${r.issues.join('; ')}`);
console.log(`\nlines checked: ${rows.length - 1}  with issues: ${bad.length}  overflow lines: ${overflow.length}`);
for (const o of overflow) console.log(`  overflow ${o.id}[${o.i}] text bottom ${o.bottom} > box ${o.limit} (${o.lines} wrapped lines): ${o.text.slice(0, 70)}…`);
writeFileSync(join(out, 'dialogue_report.json'), JSON.stringify({ rows, overflow }, null, 1));
process.exit(bad.length ? 1 : 0);
