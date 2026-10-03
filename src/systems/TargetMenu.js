import statuses from '../data/statuses.json';
import ui from '../data/ui.json';
import { makeGlassButton } from './Button.js';

// Target select (ui.json target): one card per candidate in the command area,
// Pokémon style: name, HP bar, status tags. The scene keeps the sprite side
// (tint, marker, glow); this file only draws the cards and builds their info.

const num = (c) => Number(c);

// What a card shows for one candidate (enemy or hero entity).
// opts: {kind, techId, techName, scene}. -> {name, hp, maxHp, showNumbers, tags: [{text, color}], note, noteColor, downed}
export function describeTarget(scene, entity, { kind, techId = null, techName = '' } = {}) {
  const cfg = ui.target;
  const tags = [];
  let note = '';
  let noteColor = cfg.noteColor;
  if (kind === 'hero') {
    for (const s of scene.statusList(entity)) {
      const def = statuses[s.id];
      tags.push({ text: `${def.short}${s.turns}`, color: def.color });
    }
    if (entity.hp <= 0) {
      note = cfg.text.downed;
      noteColor = cfg.downedColor;
    }
  } else {
    if (entity.exposed) {
      const def = statuses[entity.exposed.id];
      tags.push({ text: `${def.short}${entity.exposed.turns}`, color: def.color });
    }
    if (entity.broken) tags.push({ text: cfg.text.broken, color: cfg.tagColors.broken });
    if (entity.charge) tags.push({ text: cfg.text.charging, color: cfg.tagColors.charging });
    if (techId && entity.def.immune?.includes(techId)) {
      note = cfg.text.immune.replace('{tech}', techName);
      noteColor = cfg.immuneColor;
    }
  }
  return {
    name: entity.name,
    hp: Math.max(0, entity.hp),
    maxHp: entity.maxHp,
    showNumbers: kind === 'hero' || !!cfg.showNumbers,
    tags,
    note,
    noteColor,
    downed: entity.hp <= 0,
  };
}

// Card positions: a 2-column grid over the command area (the same cells as the
// 2x2 command buttons). Candidates fill left to right, top to bottom; Back takes
// the next free cell, or the whole bottom row when the candidates leave it empty.
// -> {cards: [{x, y, w}], back: {x, y, w}}
export function layoutTargets(count) {
  const g = ui.target.grid;
  const cards = [];
  for (let i = 0; i < count; i++) cards.push({ x: g.cols[i % 2], y: g.rows[Math.floor(i / 2)], w: g.cardW });
  const bi = count;
  const back = bi >= 4 || bi % 2 === 0
    ? { x: 180, y: g.rows[Math.min(1, Math.floor(bi / 2))], w: g.backFullW }
    : { x: g.cols[bi % 2], y: g.rows[Math.floor(bi / 2)], w: g.cardW };
  return { cards, back };
}

// One candidate's card. Returns the glass button ({container, rect, ...}).
export function makeTargetCard(scene, pos, info, badge, onTap) {
  const cfg = ui.target;
  const h = cfg.button.h;
  const { w } = pos;
  const btn = makeGlassButton(scene, pos.x, pos.y, { w, h, fontSize: cfg.button.fontSize }, ui.glass, 'normal', '', onTap);
  btn.text.setVisible(false);
  const pad = cfg.button.pad;
  const font = (px, color) => ({ fontFamily: ui.font, fontSize: `${px}px`, color });

  const name = scene.add.text(-w / 2 + pad, -h / 2 + cfg.button.nameY, info.name, font(cfg.button.fontSize, info.downed ? cfg.downedColor : cfg.button.textColor));
  let nameRight = -w / 2 + pad + name.width;
  const items = [name];

  // A number chip, only when several candidates share a name (it matches the one over the sprite).
  if (badge) {
    const b = cfg.badge;
    const cx = nameRight + b.gap + b.size / 2;
    const chip = scene.add.circle(cx, name.y + name.height / 2, b.size / 2, num(b.fill)).setStrokeStyle(1, num(b.stroke));
    const t = scene.add.text(cx, name.y + name.height / 2, badge, font(b.fontSize, b.color)).setOrigin(0.5);
    items.push(chip, t);
    nameRight = cx + b.size / 2;
  }

  // Status tags, right-aligned on the name row.
  const tg = cfg.tag;
  let right = w / 2 - pad;
  for (const tag of [...info.tags].reverse()) {
    const t = scene.add.text(0, 0, tag.text, font(tg.fontSize, tag.color)).setOrigin(1, 0.5);
    const tw = t.width + tg.padX * 2;
    const cy = name.y + name.height / 2;
    t.setPosition(right - tg.padX, cy);
    const box = scene.add.rectangle(right - tw / 2, cy, tw, tg.h, num(tg.fill)).setStrokeStyle(1, num(tag.color.replace('#', '0x')), tg.strokeAlpha);
    items.push(box, t);
    right -= tw + tg.gap;
  }

  // HP bar.
  const bar = cfg.hpBar;
  const bw = w - pad * 2;
  const pct = info.maxHp > 0 ? Math.max(0, Math.min(1, info.hp / info.maxHp)) : 0;
  const colorKey = pct <= bar.lowPct ? 'low' : pct <= bar.midPct ? 'mid' : 'full';
  const g = scene.add.graphics();
  g.fillStyle(num(bar.colors.bg), 1);
  g.fillRoundedRect(-w / 2 + pad, bar.y, bw, bar.h, 2);
  if (pct > 0) {
    g.fillStyle(num(bar.colors[colorKey]), 1);
    g.fillRoundedRect(-w / 2 + pad, bar.y, Math.max(2, bw * pct), bar.h, 2);
  }
  items.push(g);

  // Bottom line: a note on the left (DOWNED, IMMUNE to Strike), the numbers on the right.
  const bottom = bar.y + bar.h + cfg.button.noteGap;
  if (info.note) items.push(scene.add.text(-w / 2 + pad, bottom, info.note, font(cfg.button.noteFontSize, info.noteColor)));
  if (info.showNumbers) items.push(scene.add.text(w / 2 - pad, bottom, `${info.hp}/${info.maxHp}`, font(cfg.button.noteFontSize, cfg.button.numberColor)).setOrigin(1, 0));

  btn.body.add(items);
  return btn;
}
