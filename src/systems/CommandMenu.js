import ui from '../data/ui.json';
import { makeGlassButton } from './Button.js';

// The command buttons in the lower screen (2×2 grid, slots from ui.json).
// show(items) draws one button per item and resolves with the tapped item's
// value. items: [{slot, label, cost?, enabled?, covered?, pulse?, value}]
// A Back item is just an item whose value is null.

export default class CommandMenu {
  constructor(scene, cfg, font) {
    this.scene = scene;
    this.cfg = cfg;
    this.font = font;
    this.buttons = [];
    this.pending = null;

    const { prompt } = cfg;
    this.promptText = scene.add
      .text(prompt.x, prompt.y, prompt.text, {
        fontFamily: font,
        fontSize: `${prompt.fontSize}px`,
        color: cfg.button.textColor,
      })
      .setOrigin(0.5)
      .setVisible(false);
  }

  show(items, promptText = null) {
    this.hide();
    if (promptText) this.promptText.setText(promptText).setVisible(true);

    return new Promise((resolve) => {
      this.pending = resolve;
      // What's on screen (read by the headless playtest bot).
      this.items = items;
      this.buttons = items.map((item) => this.makeButton(item, () => this.choose(item.value)));
    });
  }

  // Resolves the open menu from outside (e.g. an enemy sprite was tapped).
  choose(value) {
    const resolve = this.pending;
    this.hide();
    if (resolve) resolve(value);
  }

  hide() {
    this.pending = null;
    this.items = [];
    for (const b of this.buttons) {
      if (b.pulse) b.pulse.stop();
      b.container.destroy();
    }
    this.buttons = [];
    this.promptText.setVisible(false);
  }

  // A glass button (ui.glass). variant: item.variant, else normal / disabled.
  // item.progress = {value, max}: a bar fills the button from the left (the
  // Recollection teaser).
  makeButton(item, onTap) {
    const b = this.cfg.button;
    const [x, y] = this.cfg.slots[item.slot];
    const w = this.cfg.slotWidths?.[item.slot] ?? b.w;
    const enabled = item.enabled !== false;
    const variant = item.variant || (enabled ? 'normal' : 'disabled');
    const button = makeGlassButton(this.scene, x, y, { w, h: b.h, fontSize: b.fontSize }, ui.glass, variant, item.label, onTap);
    const { container, rect, text, body } = button;
    container.setDepth(b.depth || 0);

    if (item.progress) {
      const p = this.cfg.progress;
      const inner = w - p.inset * 2;
      const pct = Math.max(0, Math.min(1, item.progress.value / item.progress.max));
      const bar = this.scene.add.graphics();
      bar.fillStyle(Number(p.color), p.alpha);
      if (pct > 0) bar.fillRoundedRect(-w / 2 + p.inset, -b.h / 2 + p.inset, inner * pct, b.h - p.inset * 2, p.radius);
      body.addAt(bar, 1);
    }

    // A locked technique (battles.json lockedTechniques): a blank slot, no name, no cost.
    if (item.locked) {
      const l = this.cfg.lockedSlot;
      text.setColor(l.color);
    }

    const hasCost = !item.locked && item.cost !== undefined && item.cost !== null;
    if (hasCost) {
      text.setY(b.labelOffsetY);
      const costLabel = typeof item.cost === 'string' ? item.cost : this.cfg.labels.cost.replace('{n}', item.cost);
      const cost = this.scene.add
        .text(0, b.costOffsetY, costLabel, {
          fontFamily: this.font,
          fontSize: `${b.costFontSize}px`,
          color: enabled || item.progress ? b.costColor : b.disabledTextColor,
        })
        .setOrigin(0.5);
      body.add(cost);
    }

    // Redacted: a black bar over the name and cost.
    if (item.covered) {
      const bar = this.scene.add.rectangle(0, 0, b.coverW, b.coverH, Number(b.coverFill)).setStrokeStyle(1, Number(b.coverStroke));
      body.add(bar);
    }

    if (!enabled) rect.disableInteractive();

    let pulse = null;
    if (item.pulse && enabled) {
      pulse = this.scene.tweens.add({ targets: container, scale: b.pulseScale, duration: b.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    return { container, rect, pulse };
  }
}
