import Phaser from 'phaser';
import fragments from '../data/fragments.json';
import arena from '../data/arena.json';
import ui from '../data/ui.json';
import audioData from '../data/audio.json';
import { playMusic, playOneShot, playSfx } from '../systems/Audio.js';
import { drawChoices, fragmentDef } from '../systems/Fragments.js';
import { whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';
import { registerFocusable } from '../systems/Focus.js';

const cfg = fragments.screen;
const placement = audioData.music.placement;

// "A memory returns…": the step's pool (fragments.json `pools[step id]`), tap
// one to keep it for the rest of the run (registry 'fragments').
// Chapter step: {"type": "reward", "id": "reward_rest"}.
// The Arena (systems/ArenaRunner.js) opens it with {arena: {pool: 'buffs' | 'campfire'}}: the
// choices come from arena.json, they stack (a copy each), and the campfire first heals everyone.
export default class RewardScene extends Phaser.Scene {
  constructor() {
    super('Reward');
  }

  init(data) {
    this.stepId = data?.id || null;
    this.arenaStep = data?.arena || null;
    this.rested = false;
  }

  create() {
    whenReady(this, () => this.build());
  }

  // Over the Menu's key-art backdrop, the fragments as glass cards.
  build() {
    this.picked = false;
    // Music (placement.step.<id>): the rest track keeps playing, the memory jingle ducks it.
    const music = placement.step?.[this.stepId];
    if (music) {
      if (music.over) playMusic(music.over.track);
      if (music.oneShot) playOneShot(music.oneShot, { duck: music.over?.duck, resume: true });
    }
    const owned = this.registry.get('fragments') || [];
    const runner = this.registry.get('runner');
    const campfire = this.arenaStep?.pool === 'campfire';
    if (campfire && !this.rested) {
      runner?.rest?.();
      this.rested = true;
    }
    const choices = this.arenaStep ? runner?.choices?.(this.arenaStep.pool, owned) || [] : drawChoices(owned, this.stepId);
    if (!choices.length) {
      this.next();
      return;
    }

    keyArtBackdrop(this);
    const words = this.arenaStep ? arena.text[campfire ? 'campfire' : 'buffs'] : null;
    const t = cfg.title;
    const depth = ui.keyArt.uiDepth;
    this.add.text(180, t.y, words?.title ?? t.text, { fontFamily: ui.font, fontSize: `${t.fontSize}px`, color: t.color }).setOrigin(0.5).setDepth(depth);
    const h = cfg.hint;
    this.add.text(180, h.y, words?.hint ?? h.text, { fontFamily: ui.font, fontSize: `${h.fontSize}px`, color: h.color, align: 'center', wordWrap: { width: arena.ui.hintWrap } }).setOrigin(0.5).setDepth(depth);
    if (campfire) this.campfire(depth);

    this.cards = choices.map((id, i) => this.buildCard(id, cfg.card.firstY + i * cfg.card.spacing));
  }

  buildCard(id, y) {
    const c = cfg.card;
    const def = fragmentDef(id);
    const container = this.add.container(180, y).setDepth(ui.keyArt.uiDepth);
    const panel = glassPanel(this, 0, 0, c.w, c.h, c);
    // The tap area (invisible).
    const rect = this.add.rectangle(0, 0, c.w, c.h, 0x000000, 0);
    const iconX = c.iconX - 180;
    const icon = this.add.rectangle(iconX, 0, c.iconSize, c.iconSize, 0x0b0d14).setStrokeStyle(2, Number(def.color.replace('#', '0x')));
    const letter = this.add
      .text(iconX, 0, def.short, { fontFamily: ui.font, fontSize: `${c.iconFontSize}px`, color: def.color })
      .setOrigin(0.5);
    const nameX = c.nameX - 180;
    const name = this.add
      .text(nameX, -16, def.name, { fontFamily: ui.font, fontSize: `${c.nameFontSize}px`, color: c.nameColor })
      .setOrigin(0, 0.5);
    const text = this.add
      .text(nameX, 6, def.text, { fontFamily: ui.font, fontSize: `${c.textFontSize}px`, color: c.textColor, wordWrap: { width: c.textWrap } })
      .setOrigin(0, 0);
    container.add([panel, icon, letter, name, text, rect]);

    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => this.pick(id, container));
    // Keyboard / controller: the cards take the focus; confirm picks.
    registerFocusable(this, { container, rect, activate: () => this.pick(id, container), enabled: () => !this.picked });
    return { id, container, rect };
  }

  pick(id, container) {
    if (this.picked) return;
    this.picked = true;
    playSfx('menu');
    const owned = this.registry.get('fragments') || [];
    this.registry.set('fragments', [...owned, id]);

    const c = cfg.card;
    container.add(glassPanel(this, 0, 0, c.w, c.h, { ...c, fillAlpha: 0, stroke: c.pickStroke, strokeAlpha: 1 }));
    this.tweens.add({ targets: container, scale: cfg.popScale, duration: cfg.pressMs, yoyo: true });
    const others = this.cards.filter((card) => card.container !== container).map((card) => card.container);
    this.tweens.add({ targets: others, alpha: cfg.otherAlpha, duration: cfg.fadeMs });
    this.time.delayedCall(cfg.doneDelayMs, () => this.next());
  }

  // The campfire: embers rising from the bottom of the screen and "HP restored".
  campfire(depth) {
    const e = arena.ui.embers;
    const r = arena.text.campfire;
    const rs = arena.ui.rested;
    this.add.text(180, rs.y, r.rested, { fontFamily: ui.font, fontSize: `${rs.fontSize}px`, color: rs.color }).setOrigin(0.5).setDepth(depth);
    for (let i = 0; i < e.count; i++) {
      const ember = this.add.rectangle(Phaser.Math.Between(e.x[0], e.x[1]), e.y, e.size, e.size, Number(e.color)).setDepth(depth - 1).setAlpha(0);
      this.tweens.add({
        targets: ember,
        y: e.y - e.rise,
        x: ember.x + Phaser.Math.Between(-e.drift, e.drift),
        alpha: { from: 0.9, to: 0 },
        delay: Phaser.Math.Between(0, e.ms[1]),
        duration: Phaser.Math.Between(e.ms[0], e.ms[1]),
        repeat: -1,
      });
    }
  }

  next() {
    const runner = this.registry.get('runner');
    if (runner) runner.next(this);
    else this.scene.start('Title');
  }
}
