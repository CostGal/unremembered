import brk from '../data/break.json';
import ui from '../data/ui.json';

const color = (hex) => Number(hex);

// An enemy's poise: a thin golden line under its name label (break.json line),
// plus a "STUNNED" word while it's broken. Display only: the battle owns the
// numbers (poise is in damage units, so `value` is fractional).
export default class PoiseBar {
  // anchor = the enemy's overhead label (origin 0.5, 1).
  constructor(scene, anchor, max) {
    const l = brk.line;
    this.scene = scene;
    this.max = max;
    this.value = max;
    this.left = anchor.x - l.w / 2;
    this.y = anchor.y + l.offsetY;
    this.bg = scene.add.rectangle(this.left, this.y, l.w, l.h, color(l.bg)).setOrigin(0, 0.5).setDepth(l.depth);
    this.fill = scene.add.rectangle(this.left, this.y, l.w, l.h, color(l.fill)).setOrigin(0, 0.5).setDepth(l.depth);
    const t = brk.stunText;
    this.stun = scene.add
      .text(anchor.x, this.y + t.offsetY, t.text, { fontFamily: ui.font, fontSize: `${t.fontSize}px`, color: t.color, stroke: t.stroke, strokeThickness: t.strokeThickness })
      .setOrigin(0.5)
      .setDepth(l.depth)
      .setVisible(false);
    this.pulse = null;
    this.shards = [];
  }

  // The line's box (a tutorial pause spotlights it).
  rect() {
    const l = brk.line;
    return { x: this.left, y: this.y - l.h / 2, w: l.w, h: l.h, pad: 8 };
  }

  get objects() {
    return [this.bg, this.fill, this.stun];
  }

  // value = poise left (0..max). The gold line shrinks from the right.
  set(value) {
    const l = brk.line;
    this.value = value;
    this.scene.tweens.killTweensOf(this.fill);
    this.scene.tweens.add({ targets: this.fill, width: l.w * Math.max(0, Math.min(1, value / this.max)), duration: l.tweenMs, ease: 'Quad.easeOut' });
  }

  // Broken: the line turns red (full width) and pulses; STUNNED shows.
  setBroken(on) {
    const l = brk.line;
    this.stun.setVisible(on);
    this.pulse?.stop();
    this.pulse = null;
    this.fill.setAlpha(1).setFillStyle(color(on ? l.brokenFill : l.fill));
    if (!on) return;
    // The emptied line shows as a full red one while the enemy is stunned.
    this.scene.tweens.killTweensOf(this.fill);
    this.fill.width = l.w;
    this.pulse = this.scene.tweens.add({ targets: this.fill, alpha: 0.35, duration: l.brokenPulseMs, yoyo: true, repeat: -1 });
  }

  // The remaining gold breaks into small rects that fly out, fall and fade.
  shatter() {
    const { shards: s, fill } = brk.line;
    const from = this.left;
    const width = Math.max(this.fill.width, s.size);
    const y = this.y;
    for (let i = 0; i < s.count; i++) {
      const rect = this.scene.add.rectangle(from + Math.random() * width, y, s.size, s.size, color(fill)).setDepth(brk.line.depth + 1);
      const angle = Math.random() * Math.PI * 2;
      const speed = s.speed[0] + Math.random() * (s.speed[1] - s.speed[0]);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const x0 = rect.x;
      this.shards.push(rect);
      this.scene.tweens.add({
        targets: rect,
        alpha: 0,
        duration: s.lifeMs,
        ease: 'Quad.easeIn',
        onUpdate: (tween) => {
          const t = (tween.elapsed ?? 0) / 1000;
          rect.x = x0 + vx * t;
          rect.y = y + vy * t + 0.5 * s.gravity * t * t;
        },
        onComplete: () => {
          this.shards = this.shards.filter((r) => r !== rect);
          rect.destroy();
        },
      });
    }
  }
}
