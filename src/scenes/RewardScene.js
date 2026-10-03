import Phaser from 'phaser';
import fragments from '../data/fragments.json';
import ui from '../data/ui.json';
import audioData from '../data/audio.json';
import { playMusic, playOneShot, playSfx } from '../systems/Audio.js';
import { drawChoices } from '../systems/Fragments.js';
import { whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';

const cfg = fragments.screen;
const placement = audioData.music.placement;

// "A memory returns…": the step's pool (fragments.json `pools[step id]`), tap
// one to keep it for the rest of the run (registry 'fragments').
// Chapter step: {"type": "reward", "id": "reward_rest"}.
export default class RewardScene extends Phaser.Scene {
  constructor() {
    super('Reward');
  }

  init(data) {
    this.stepId = data?.id || null;
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
    const choices = drawChoices(owned, this.stepId);
    if (!choices.length) {
      this.next();
      return;
    }

    keyArtBackdrop(this);
    const t = cfg.title;
    const depth = ui.keyArt.uiDepth;
    this.add.text(180, t.y, t.text, { fontFamily: ui.font, fontSize: `${t.fontSize}px`, color: t.color }).setOrigin(0.5).setDepth(depth);
    const h = cfg.hint;
    this.add.text(180, h.y, h.text, { fontFamily: ui.font, fontSize: `${h.fontSize}px`, color: h.color }).setOrigin(0.5).setDepth(depth);

    this.cards = choices.map((id, i) => this.buildCard(id, cfg.card.firstY + i * cfg.card.spacing));
  }

  buildCard(id, y) {
    const c = cfg.card;
    const def = fragments.pool[id];
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

  next() {
    const runner = this.registry.get('runner');
    if (runner) runner.next(this);
    else this.scene.start('Title');
  }
}
