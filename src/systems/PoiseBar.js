import brk from '../data/break.json';
import ui from '../data/ui.json';

const color = (hex) => Number(hex);

// An enemy's poise: small pips under its name label (break.json pips), plus a
// "STUNNED" word while it's broken. Display only: the battle owns the numbers.
export default class PoiseBar {
  // anchor = the enemy's overhead label (origin 0.5, 1).
  constructor(scene, anchor, max) {
    const p = brk.pips;
    this.scene = scene;
    this.max = max;
    this.value = max;
    const width = max * p.w + (max - 1) * p.gap;
    const y = anchor.y + p.offsetY;
    this.pips = [];
    for (let i = 0; i < max; i++) {
      const x = anchor.x - width / 2 + p.w / 2 + i * (p.w + p.gap);
      this.pips.push(scene.add.rectangle(x, y, p.w, p.h, color(p.fullColor)).setDepth(p.depth));
    }
    const t = brk.stunText;
    this.stun = scene.add
      .text(anchor.x, y + t.offsetY, t.text, { fontFamily: ui.font, fontSize: `${t.fontSize}px`, color: t.color, stroke: t.stroke, strokeThickness: t.strokeThickness })
      .setOrigin(0.5)
      .setDepth(p.depth)
      .setVisible(false);
    this.pulse = null;
  }

  get objects() {
    return [...this.pips, this.stun];
  }

  // value = pips still full. Pips that just emptied pop.
  set(value) {
    const p = brk.pips;
    const before = this.value;
    this.value = value;
    this.pips.forEach((pip, i) => {
      pip.setFillStyle(color(i < value ? p.fullColor : p.emptyColor));
      if (i >= value && i < before) {
        pip.setScale(p.popScale);
        this.scene.tweens.add({ targets: pip, scale: 1, duration: p.popMs, ease: 'Quad.easeOut' });
      }
    });
  }

  // Broken: every pip pulses red and STUNNED shows.
  setBroken(on) {
    const p = brk.pips;
    this.stun.setVisible(on);
    this.pulse?.stop();
    this.pulse = null;
    this.pips.forEach((pip) => pip.setAlpha(1));
    if (!on) return;
    this.pips.forEach((pip) => pip.setFillStyle(color(p.brokenColor)));
    this.pulse = this.scene.tweens.add({ targets: this.pips, alpha: 0.35, duration: p.brokenPulseMs, yoyo: true, repeat: -1 });
  }
}
