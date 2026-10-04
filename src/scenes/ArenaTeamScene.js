import Phaser from 'phaser';
import arena from '../data/arena.json';
import allies from '../data/allies.json';
import characters from '../data/characters.json';
import ui from '../data/ui.json';
import { playSceneMusic, playSfx } from '../systems/Audio.js';
import { makeGlassButton } from '../systems/Button.js';
import { isRealTexture, whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';
import { difficultyDef } from '../systems/Difficulty.js';
import { animKey, playLoop } from '../systems/SpriteAnims.js';
import ArenaRunner from '../systems/ArenaRunner.js';

const L = arena.ui.team;
const T = arena.text.team;
const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// Arena team select: three slot frames on top (Hero · Hero · Support), the roster
// as cards below (arena.json roster). Tap a card to put that character in the next
// free slot of its kind (the slot shows them idling); tap it again, or tap the
// slot, to take them out. Begin starts the run once both hero slots and the
// support slot are filled. Locked cards are the roster still to come.
export default class ArenaTeamScene extends Phaser.Scene {
  constructor() {
    super('ArenaTeam');
  }

  init(data) {
    // "Fight again" from the run summary comes back with the last team picked.
    this.heroes = [...(data?.team?.heroes || [])];
    this.support = data?.team?.support ?? null;
  }

  create() {
    playSceneMusic('Menu');
    whenReady(this, () => this.build());
  }

  build() {
    this.animationSets = this.registry.get('animationSets') || {};
    const depth = ui.keyArt.uiDepth;
    keyArtBackdrop(this);
    this.layer = this.add.container(0, 0).setDepth(depth);
    const text = (x, y, str, size, color, origin = 0.5) =>
      this.add.text(x, y, str, { fontFamily: ui.font, fontSize: `${size}px`, color }).setOrigin(origin, 0.5);

    this.layer.add(text(180, L.title.y, T.title, L.title.fontSize, L.title.color));
    this.layer.add(text(180, L.hint.y, T.hint, L.hint.fontSize, L.hint.color));
    const diff = difficultyDef(this.registry.get('settings'));
    this.layer.add(text(180, L.difficulty.y, fill(T.difficulty, { name: diff.label }), L.difficulty.fontSize, L.difficulty.color));

    // Slots: two heroes, one support.
    const s = L.slots;
    const kinds = [...Array(arena.heroCount).fill('hero'), ...Array(arena.supportCount).fill('support')];
    const x0 = 180 - ((kinds.length - 1) * (s.w + s.gap)) / 2;
    this.slots = kinds.map((kind, i) => this.buildSlot(kind, x0 + i * (s.w + s.gap), s.y));

    // Roster.
    const sec = L.section;
    this.layer.add(text(sec.x, L.heroesY, T.heroes.toUpperCase(), sec.fontSize, sec.color, 0));
    this.layer.add(text(sec.x, L.supportsY, T.supports.toUpperCase(), sec.fontSize, sec.color, 0));
    this.cards = [];
    arena.roster.heroes.forEach((entry, i) => this.cards.push(this.buildCard('hero', entry, L.heroFirstY + i * L.card.spacing)));
    arena.roster.supports.forEach((entry, i) => this.cards.push(this.buildCard('support', entry, L.supportFirstY + i * L.card.spacing)));

    // Back | Begin.
    const b = L.buttons;
    const back = makeGlassButton(this, b.backX, b.y, { w: b.backW, h: b.h, fontSize: b.fontSize }, ui.glass, 'secondary', T.back, () => this.scene.start('Menu'));
    this.begin = makeGlassButton(this, b.beginX, b.y, { w: b.beginW, h: b.h, fontSize: b.fontSize }, ui.glass, 'disabled', T.begin, () => this.tryBegin());
    back.container.setDepth(depth);
    this.begin.container.setDepth(depth);
    this.refresh();
  }

  // The character a roster entry stands for: name, stats, sprite.
  infoOf(kind, entry) {
    if (kind === 'support') return { name: entry.name ?? allies[entry.id]?.name, body: allies[entry.id]?.body };
    return { ...characters[entry.id], name: characters[entry.id]?.name };
  }

  buildSlot(kind, x, y) {
    const s = L.slots;
    const box = this.add.container(x, y).setDepth(ui.keyArt.uiDepth);
    box.add(glassPanel(this, 0, 0, s.w, s.h, s));
    const label = this.add.text(0, s.labelDy, (kind === 'hero' ? T.heroSlot : T.supportSlot).toUpperCase(), { fontFamily: ui.font, fontSize: `${s.labelFontSize}px`, color: s.labelColor }).setOrigin(0.5);
    box.add(label);
    const plus = this.add.text(0, 0, '+', { fontFamily: ui.font, fontSize: `${s.plus.fontSize}px`, color: s.plus.color }).setOrigin(0.5);
    const name = this.add.text(0, s.nameDy, '', { fontFamily: ui.font, fontSize: `${s.nameFontSize}px` }).setOrigin(0.5);
    box.add([plus, name]);
    // The idle sprite is clipped to the frame.
    const mask = this.make.graphics({ x: 0, y: 0, add: false });
    mask.fillRect(x - s.w / 2, y - s.h / 2, s.w, s.h);
    const hit = this.add.rectangle(0, 0, s.w, s.h, 0x000000, 0).setInteractive({ useHandCursor: true });
    box.add(hit);
    const slot = { kind, x, y, box, label, plus, name, sprite: null, id: null, mask: mask.createGeometryMask() };
    hit.on('pointerdown', () => {
      if (!slot.id) return;
      playSfx('menu');
      this.remove(kind, slot.id);
    });
    return slot;
  }

  buildCard(kind, entry, y) {
    const c = L.card;
    const container = this.add.container(180, y).setDepth(ui.keyArt.uiDepth);
    const panel = this.add.graphics();
    container.add(panel);
    const card = { kind, entry, container, panel, y };
    if (entry.locked || !entry.id) {
      card.locked = true;
      this.paintCard(card, false);
      const t = this.add.text(0, 0, `? ? ?   ${T.locked}`, { fontFamily: ui.font, fontSize: `${c.nameFontSize}px`, color: c.lockedColor }).setOrigin(0.5);
      container.add(t);
      container.setAlpha(c.lockedAlpha);
      return card;
    }
    const info = this.infoOf(kind, entry);
    const left = -c.w / 2;
    const px = left + c.portraitX;
    if (isRealTexture(this, entry.portrait)) {
      const img = this.add.image(px, 0, entry.portrait);
      img.setScale(c.portrait / Math.max(img.width, img.height));
      container.add(img);
    } else {
      container.add(this.add.rectangle(px, 0, c.portrait, c.portrait, Number(entry.color.replace('#', '0x')), 0.35));
      container.add(this.add.text(px, 0, info.name[0], { fontFamily: ui.font, fontSize: `${Math.round(c.portrait / 2)}px`, color: entry.color }).setOrigin(0.5));
    }
    const nx = left + c.nameX;
    container.add(this.add.text(nx, c.nameDy, info.name, { fontFamily: ui.font, fontSize: `${c.nameFontSize}px`, color: entry.color }).setOrigin(0, 0.5));
    container.add(this.add.text(left + c.roleRight, c.roleDy, entry.role, { fontFamily: ui.font, fontSize: `${c.roleFontSize}px`, color: c.roleColor }).setOrigin(1, 0.5));
    const stats = kind === 'hero'
      ? fill(T.stats, { hp: info.hp, s0: info.strike[0], s1: info.strike[1], echo: info.echoMax ?? arena.levels.echoMax[entry.id]?.at(-1) ?? '' })
      : entry.text;
    const statsText = this.add.text(nx, c.statsDy, stats, { fontFamily: ui.font, fontSize: `${c.statsFontSize}px`, color: c.statsColor, wordWrap: { width: c.wrap } }).setOrigin(0, kind === 'hero' ? 0.5 : 0.15);
    container.add(statsText);
    if (entry.path) container.add(this.add.text(nx, c.pathDy, entry.path, { fontFamily: ui.font, fontSize: `${c.pathFontSize}px`, color: c.pathColor }).setOrigin(0, 0.5));
    card.check = this.add.text(left + c.check.x, c.check.dy, c.check.text, { fontFamily: ui.font, fontSize: `${c.check.fontSize}px`, color: entry.color }).setOrigin(0.5).setVisible(false);
    container.add(card.check);
    const hit = this.add.rectangle(0, 0, c.w, c.h, 0x000000, 0).setInteractive({ useHandCursor: true });
    container.add(hit);
    hit.on('pointerdown', () => this.toggle(kind, entry.id));
    this.paintCard(card, false);
    return card;
  }

  paintCard(card, picked) {
    const c = L.card;
    const g = card.panel;
    const stroke = picked ? Number(card.entry.color.replace('#', '0x')) : Number(c.stroke);
    g.clear();
    g.fillStyle(Number(c.fill), picked ? c.pickedFillAlpha : c.fillAlpha);
    g.fillRoundedRect(-c.w / 2, -c.h / 2, c.w, c.h, c.radius);
    g.lineStyle(ui.glass.strokeW, stroke, picked ? c.pickedStrokeAlpha : c.strokeAlpha);
    g.strokeRoundedRect(-c.w / 2, -c.h / 2, c.w, c.h, c.radius);
  }

  picked(kind) {
    return kind === 'hero' ? this.heroes : this.support ? [this.support] : [];
  }

  // A tap on a card: in the team → out; out → into the next free slot of its kind (a full
  // support slot is swapped, a full hero row says so).
  toggle(kind, id) {
    playSfx('menu');
    if (this.picked(kind).includes(id)) {
      this.remove(kind, id);
      return;
    }
    if (kind === 'hero') {
      if (this.heroes.length >= arena.heroCount) return;
      this.heroes.push(id);
    } else this.support = id;
    this.refresh(id);
  }

  remove(kind, id) {
    if (kind === 'hero') this.heroes = this.heroes.filter((h) => h !== id);
    else if (this.support === id) this.support = null;
    this.refresh();
  }

  ready() {
    return this.heroes.length === arena.heroCount && (!arena.supportCount || !!this.support);
  }

  // Slots, cards and Begin follow the picks. `added` pops that character's slot.
  refresh(added = null) {
    const heroSlots = this.slots.filter((s) => s.kind === 'hero');
    const supportSlots = this.slots.filter((s) => s.kind === 'support');
    heroSlots.forEach((slot, i) => this.fillSlot(slot, this.heroes[i] ?? null, added));
    supportSlots.forEach((slot) => this.fillSlot(slot, this.support, added));
    for (const card of this.cards) {
      if (card.locked) continue;
      const on = this.picked(card.kind).includes(card.entry.id);
      this.paintCard(card, on);
      card.check.setVisible(on);
    }
    const ok = this.ready();
    this.begin.setVariant(ok ? 'primary' : 'disabled');
    this.begin.text.setText(ok ? T.begin : this.heroes.length < arena.heroCount ? T.pickHero : T.pickSupport);
  }

  fillSlot(slot, id, added) {
    if (slot.id === id) return;
    slot.sprite?.destroy();
    slot.sprite = null;
    slot.id = id;
    // Empty: "HERO" and a plus; filled: the character standing there, their name under them.
    slot.plus.setVisible(!id);
    slot.label.setVisible(!id);
    if (!id) {
      slot.name.setText('');
      return;
    }
    const s = L.slots;
    const kind = slot.kind;
    const entry = (kind === 'hero' ? arena.roster.heroes : arena.roster.supports).find((e) => e.id === id);
    const info = this.infoOf(kind, entry);
    slot.name.setText(info.name).setColor(entry.color);
    const set = this.animationSets[id];
    const feetY = slot.y + s.feetDy;
    let sprite;
    if (set?.animations?.idle) {
      sprite = this.add.sprite(slot.x, 0, animKey(id, 'idle'));
      playLoop(sprite, id, 'idle');
      // Sheets face left; the team faces right, as in battle.
      sprite.setFlipX((set.facing || 'left') !== 'right');
      sprite.setY(feetY - set.frame_size[1] / 2);
    } else {
      sprite = this.add.image(slot.x, 0, info.body);
      sprite.setY(feetY - sprite.height / 2);
    }
    sprite.setDepth(ui.keyArt.uiDepth + 1).setMask(slot.mask);
    slot.sprite = sprite;
    if (added === id) {
      slot.box.setScale(s.popScale);
      this.tweens.add({ targets: slot.box, scale: 1, duration: s.popMs, ease: 'Back.easeOut' });
    }
  }

  tryBegin() {
    if (!this.ready()) return;
    ArenaRunner.start(this, { heroes: [...this.heroes], support: this.support });
  }
}
