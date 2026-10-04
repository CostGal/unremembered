import fragments from '../data/fragments.json';
import ui from '../data/ui.json';
import { playSfx } from './Audio.js';
import { onAction } from './Input.js';
import { tx } from './Prompts.js';

const color = (hex) => Number(hex);
const cfg = fragments.dropCard;

// "A memory, left behind": the card after the result card when an enemy
// dropped one (fragments.json `drops`, `dropCard`). One card per memory; a tap
// after a short delay closes it and show() resolves.
export default class DropCard {
  constructor(scene, id) {
    this.scene = scene;
    this.id = id;
    this.def = fragments.pool[id];
    this.items = [];
  }

  show() {
    return new Promise((resolve) => {
      this.build();
      playSfx(cfg.sfx);
      let ready = false;
      let offConfirm = null;
      const onTap = () => {
        if (!ready) return;
        this.scene.input.off('pointerdown', onTap);
        offConfirm();
        this.hide().then(resolve);
      };
      this.scene.time.delayedCall(cfg.inputDelayMs, () => {
        ready = true;
      });
      this.scene.input.on('pointerdown', onTap);
      offConfirm = onAction(this.scene, 'confirm', onTap);
      this.scene.events.once('shutdown', () => this.scene.input.off('pointerdown', onTap));
    });
  }

  text(spec, str, extra = {}) {
    const t = this.scene.add
      .text(spec.x, spec.y, str, { fontFamily: ui.font, fontSize: `${spec.fontSize}px`, color: spec.color, align: 'center', ...extra })
      .setOrigin(0.5)
      .setDepth(cfg.depth + 1)
      .setAlpha(0);
    this.items.push(t);
    return t;
  }

  build() {
    const scene = this.scene;
    const def = this.def;
    const panel = scene.add
      .rectangle(cfg.x, cfg.y, cfg.w, cfg.h, color(cfg.fill), cfg.alpha)
      .setOrigin(0)
      .setStrokeStyle(1, color(cfg.stroke))
      .setDepth(cfg.depth)
      .setAlpha(0);
    const ic = cfg.icon;
    const box = scene.add.rectangle(ic.x, ic.y, ic.size, ic.size, color(ic.fill)).setStrokeStyle(2, color(def.color.replace('#', '0x'))).setDepth(cfg.depth + 1).setAlpha(0);
    const letter = scene.add
      .text(ic.x, ic.y, def.short, { fontFamily: ui.font, fontSize: `${ic.fontSize}px`, color: def.color })
      .setOrigin(0.5)
      .setDepth(cfg.depth + 2)
      .setAlpha(0);
    this.items.push(panel, box, letter);
    const wrap = (spec) => ({ wordWrap: { width: spec.wrap } });
    this.text(cfg.title, cfg.title.text);
    this.text(cfg.name, def.name);
    this.text(cfg.flavor, def.flavor, wrap(cfg.flavor));
    this.text(cfg.effect, def.text, wrap(cfg.effect));
    this.text(cfg.hint, tx(cfg.hint));
    scene.tweens.add({ targets: this.items, alpha: 1, duration: cfg.fadeMs });
    scene.tweens.add({ targets: [box, letter], scale: { from: 1.4, to: 1 }, duration: cfg.fadeMs * 1.5, ease: 'Back.easeOut' });
  }

  hide() {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.items,
        alpha: 0,
        duration: cfg.fadeMs,
        onComplete: () => {
          this.items.forEach((o) => o.destroy());
          resolve();
        },
      });
    });
  }
}
