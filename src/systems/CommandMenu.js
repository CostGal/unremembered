import { pressButton } from './Button.js';

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

  makeButton(item, onTap) {
    const b = this.cfg.button;
    const [x, y] = this.cfg.slots[item.slot];
    const enabled = item.enabled !== false;
    const container = this.scene.add.container(x, y).setDepth(b.depth || 0);

    const rect = this.scene.add
      .rectangle(0, 0, b.w, b.h, Number(enabled ? b.fill : b.disabledFill))
      .setStrokeStyle(2, Number(enabled ? b.stroke : b.disabledStroke));
    const hasCost = item.cost !== undefined && item.cost !== null;
    const text = this.scene.add
      .text(0, hasCost ? b.labelOffsetY : 0, item.label, {
        fontFamily: this.font,
        fontSize: `${b.fontSize}px`,
        color: enabled ? b.textColor : b.disabledTextColor,
      })
      .setOrigin(0.5);
    container.add([rect, text]);

    if (hasCost) {
      const costLabel = this.cfg.labels.cost.replace('{n}', item.cost);
      const cost = this.scene.add
        .text(0, b.costOffsetY, costLabel, {
          fontFamily: this.font,
          fontSize: `${b.costFontSize}px`,
          color: enabled ? b.costColor : b.disabledTextColor,
        })
        .setOrigin(0.5);
      container.add(cost);
    }

    // Redacted: a black bar over the name and cost.
    if (item.covered) {
      const bar = this.scene.add.rectangle(0, 0, b.coverW, b.coverH, Number(b.coverFill)).setStrokeStyle(1, Number(b.coverStroke));
      container.add(bar);
    }

    if (enabled) {
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => pressButton(this.scene, container, rect, b, onTap));
    }

    let pulse = null;
    if (item.pulse && enabled) {
      pulse = this.scene.tweens.add({ targets: container, scale: b.pulseScale, duration: b.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    return { container, rect, pulse };
  }
}
