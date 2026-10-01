import Phaser from 'phaser';
import fragments from '../data/fragments.json';
import ui from '../data/ui.json';
import { playSfx } from '../systems/Audio.js';
import { drawChoices } from '../systems/Fragments.js';

const cfg = fragments.screen;

// "A memory returns…": three random fragments, tap one to keep it for the
// rest of the run (registry 'fragments'). Chapter step: {"type": "reward"}.
export default class RewardScene extends Phaser.Scene {
  constructor() {
    super('Reward');
  }

  create() {
    this.picked = false;
    const owned = this.registry.get('fragments') || [];
    const choices = drawChoices(owned);
    if (!choices.length) {
      this.next();
      return;
    }

    const t = cfg.title;
    this.add.text(180, t.y, t.text, { fontFamily: ui.font, fontSize: `${t.fontSize}px`, color: t.color }).setOrigin(0.5);
    const h = cfg.hint;
    this.add.text(180, h.y, h.text, { fontFamily: ui.font, fontSize: `${h.fontSize}px`, color: h.color }).setOrigin(0.5);

    this.cards = choices.map((id, i) => this.buildCard(id, cfg.card.firstY + i * cfg.card.spacing));
  }

  buildCard(id, y) {
    const c = cfg.card;
    const def = fragments.pool[id];
    const container = this.add.container(180, y);
    const rect = this.add.rectangle(0, 0, c.w, c.h, Number(c.fill)).setStrokeStyle(2, Number(c.stroke));
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
    container.add([rect, icon, letter, name, text]);

    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerdown', () => this.pick(id, container, rect));
    return { id, container, rect };
  }

  pick(id, container, rect) {
    if (this.picked) return;
    this.picked = true;
    playSfx('menu');
    const owned = this.registry.get('fragments') || [];
    this.registry.set('fragments', [...owned, id]);

    rect.setStrokeStyle(2, Number(cfg.card.pickStroke));
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
