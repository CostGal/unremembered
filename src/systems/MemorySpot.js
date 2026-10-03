import fragments from '../data/fragments.json';
import ui from '../data/ui.json';
import { playSfx } from './Audio.js';
import * as Fx from './Fx.js';
import { ownedFragments, pickFragment } from './Fragments.js';

// A memory lying in a dialogue scene (fragments.json `scenes.<dialogue id>`: id, at, lines).
// While the line index is inside `lines` and the memory is not owned, a glowing spot with a "?"
// pulses on the picture; tapping it (the tap is swallowed: the line does not advance) picks the
// memory up with a banner. Leaving the range = it is gone for the run. Looks: `pickupSpot`,
// `pickupBanner` in fragments.json.
export default class MemorySpot {
  constructor(scene, dialogueId) {
    this.scene = scene;
    this.def = fragments.scenes?.[dialogueId] || null;
    this.cfg = fragments.pickupSpot;
    this.parts = null;
    this.zone = null;
    this.done = false;
    this.swallowNext = false;
  }

  // The picture-area position of the spot (at is 0-1 of the 360 x coverH picture).
  get x() {
    return 180 + (this.def.at[0] - 0.5) * 360;
  }

  get y() {
    return this.def.at[1] * ui.dialogue.bg.coverH;
  }

  get active() {
    return !!this.zone;
  }

  // Called with each shown line's index: show inside the range, hide outside it.
  onLine(index) {
    if (!this.def || this.done) return;
    const [first, last] = this.def.lines;
    const inside = index >= first && index <= last && !ownedFragments(this.scene.registry).includes(this.def.id);
    if (inside && !this.zone) this.show();
    else if (!inside && this.zone) this.hide();
    if (index > last) this.done = true;
  }

  // True when this pointerdown's top object is the spot (the dialogue then ignores it as a tap).
  // (collect() destroys the zone inside that same pointerdown, so it leaves a one-shot flag.)
  swallows(over) {
    if (this.swallowNext) {
      this.swallowNext = false;
      return true;
    }
    return !!this.zone && !!over && over.includes(this.zone);
  }

  show() {
    const s = this.scene;
    const c = this.cfg;
    const color = Number(c.color);
    const { x, y } = this;
    const outer = s.add.circle(x, y, c.pulse.radiusFrom, color, c.pulse.alphaFrom).setStrokeStyle(c.ringWidth, color, c.ringAlpha).setDepth(c.depth);
    const core = s.add.circle(x, y, c.coreRadius, color, c.coreAlpha).setDepth(c.depth + 1);
    const glyph = s.add.text(x, y, c.glyph.text, { fontFamily: ui.font, fontSize: `${c.glyph.fontSize}px`, color: c.glyph.color, stroke: c.glyph.stroke, strokeThickness: c.glyph.strokeThickness }).setOrigin(0.5).setDepth(c.depth + 2);
    const k = c.sparkle;
    const spark = s.add.rectangle(x + k.dx, y + k.dy, k.size, k.size, Number(k.color)).setAngle(45).setDepth(c.depth + 2);
    const zone = s.add.zone(x, y, c.tapSize, c.tapSize).setDepth(c.depth + 3).setInteractive();
    zone.on('pointerdown', () => this.collect());
    this.parts = [outer, core, glyph, spark];
    this.zone = zone;
    this.tweens = [
      s.tweens.add({ targets: outer, radius: c.pulse.radiusTo, fillAlpha: c.pulse.alphaTo, duration: c.pulse.ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
      s.tweens.add({ targets: spark, scale: 0.3, duration: k.ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
    ];
    // Fade in on the objects' own alpha (the pulse tweens fillAlpha, the sparkle its scale).
    for (const o of this.parts) {
      o.setAlpha(0);
      s.tweens.add({ targets: o, alpha: o === glyph ? c.glyph.alpha : 1, duration: c.fadeInMs });
    }
  }

  // Gone (the line moved on, or picked up): fade out and destroy.
  hide(burst = false) {
    if (!this.zone) return;
    const c = this.cfg;
    const s = this.scene;
    const parts = this.parts;
    this.zone.destroy();
    this.zone = null;
    this.parts = null;
    for (const t of this.tweens) t.remove();
    if (burst) Fx.sparks(s, this.x, this.y, c.burst.count, c.burst, c.depth + 4);
    s.tweens.add({ targets: parts, alpha: 0, duration: burst ? c.fadeOutMs / 2 : c.fadeOutMs, onComplete: () => parts.forEach((o) => o.destroy()) });
  }

  collect() {
    if (!this.zone) return;
    const c = this.cfg;
    pickFragment(this.scene.registry, this.def.id);
    this.done = true;
    this.swallowNext = true;
    playSfx(c.sfx);
    this.hide(true);
    this.banner(fragments.pool[this.def.id].name);
  }

  banner(name) {
    const s = this.scene;
    const b = fragments.pickupBanner;
    const text = s.add.text(b.x, b.y, b.text.replace('{name}', name), { fontFamily: ui.font, fontSize: `${b.fontSize}px`, color: b.color }).setOrigin(0.5);
    const back = s.add.rectangle(b.x, b.y, text.width + b.padX * 2, text.height + b.padY * 2, Number(b.fill), b.fillAlpha).setStrokeStyle(1, Number(b.stroke), b.strokeAlpha);
    const items = [back, text];
    items.forEach((o, i) => o.setDepth(b.depth + i).setAlpha(0));
    // In, hold, out: b.ms in all.
    s.tweens.add({
      targets: items,
      alpha: 1,
      duration: b.fadeMs,
      onComplete: () => s.tweens.add({ targets: items, alpha: 0, delay: b.ms - b.fadeMs * 2, duration: b.fadeMs, onComplete: () => items.forEach((o) => o.destroy()) }),
    });
  }
}
