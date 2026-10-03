import ui from '../data/ui.json';
import { makeGlassButton } from './Button.js';
import { describeTarget, layoutTargets, makeTargetCard } from './TargetMenu.js';

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

    // Spotlight targets for the tutorial pauses: every slot, whether or not a button is in it now.
    if (scene.tutorialTargets) {
      for (const [slot, [x, y]] of Object.entries(cfg.slots)) {
        const w = cfg.slotWidths?.[slot] ?? cfg.button.w;
        scene.tutorialTargets[`cmd.${slot}`] = { x: x - w / 2, y: y - cfg.button.h / 2, w, h: cfg.button.h };
      }
    }

    const { prompt } = cfg;
    this.promptText = scene.add
      .text(prompt.x, prompt.y, prompt.text, {
        fontFamily: font,
        fontSize: `${prompt.fontSize}px`,
        color: cfg.button.textColor,
      })
      .setOrigin(0.5)
      .setDepth(cfg.button.depth || 0)
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

  // Target select (ui.json target): a card per candidate (name, HP bar, status tags) plus Back.
  // Resolves with the tapped candidate, or null (Back). opts: {kind: 'enemy'|'hero', prompt, techId, techName, onFocus}.
  // Candidates sharing a name get a number chip (opts.badges[i]). The dev/bot hook reads `items`:
  // each card is {slot: 'target', value: entity, x, y, kind}.
  showTargets(candidates, opts = {}) {
    this.hide();
    const cfg = ui.target;
    this.promptText.setText(opts.prompt ?? cfg.prompt).setY(cfg.promptY).setFontSize(cfg.promptFontSize).setVisible(true);

    return new Promise((resolve) => {
      this.pending = resolve;
      const lay = layoutTargets(candidates.length);
      this.items = candidates.map((c, i) => ({ slot: 'target', value: c, label: c.name, x: lay.cards[i].x, y: lay.cards[i].y, kind: opts.kind }));
      this.items.push({ slot: 'back', value: null, label: cfg.backText });
      this.buttons = candidates.map((c, i) => {
        const card = makeTargetCard(this.scene, lay.cards[i], describeTarget(this.scene, c, opts), opts.badges?.[i], () => this.choose(c));
        card.container.setDepth(this.cfg.button.depth || 0);
        card.rect.on('pointerover', () => opts.onFocus?.(c));
        card.rect.on('pointerout', () => opts.onFocus?.(null));
        return card;
      });
      const back = this.makeButton({ slot: 'back', label: cfg.backText, value: null, pos: lay.back }, () => this.choose(null));
      this.buttons.push(back);
    });
  }

  // Resolves the open menu from outside (e.g. an enemy sprite was tapped).
  choose(value) {
    const resolve = this.pending;
    this.hide();
    if (resolve) resolve(value);
  }

  hide() {
    this.hideHelp();
    this.pending = null;
    this.items = [];
    for (const b of this.buttons) {
      if (b.pulse) b.pulse.stop();
      b.container.destroy();
    }
    this.buttons = [];
    this.promptText.setVisible(false);
    // showTargets moves the prompt: put it back where the command menu keeps it.
    this.promptText.setY(this.cfg.prompt.y).setFontSize(this.cfg.prompt.fontSize);
  }

  // The long-press help card (ui.commands.help.card) over the command area: name, cost, the short text and,
  // for Blast, its current level line. info = MoveHelp.helpCard(). Closed by the release (the button calls
  // hideHelp), by any new touch, or when the menu changes.
  showHelp(info) {
    this.hideHelp();
    const c = this.cfg.help.card;
    const scene = this.scene;
    const text = (x, y, str, f, extra = {}) =>
      scene.add.text(x, y, str, { fontFamily: this.font, fontSize: `${f.fontSize}px`, color: f.color, ...extra });
    const left = c.x - c.w / 2 + c.padX;
    const name = text(left, 0, info.name, c.name);
    const cost = info.cost ? text(c.x + c.w / 2 - c.padX, 0, info.cost, c.cost).setOrigin(1, 0) : null;
    const short = text(left, 0, info.short, c.short, { wordWrap: { width: c.wrap }, lineSpacing: c.short.lineSpacing });
    const level = info.level ? text(left, 0, info.level, c.level, { wordWrap: { width: c.wrap } }) : null;
    const gap = 8;
    const h = c.padY * 2 + name.height + gap + short.height + (level ? gap + level.height : 0);
    const top = c.y - h / 2;
    const bg = scene.add.graphics();
    bg.fillStyle(Number(c.fill), c.alpha);
    bg.fillRoundedRect(c.x - c.w / 2, top, c.w, h, c.radius);
    bg.lineStyle(2, Number(c.stroke), 1);
    bg.strokeRoundedRect(c.x - c.w / 2, top, c.w, h, c.radius);
    name.setY(top + c.padY);
    cost?.setY(top + c.padY + (name.height - cost.height) / 2);
    short.setY(top + c.padY + name.height + gap);
    level?.setY(short.y + short.height + gap);
    const parts = [bg, name, short, ...(cost ? [cost] : []), ...(level ? [level] : [])];
    parts.forEach((o) => o.setDepth(o === bg ? c.depth : c.depth + 0.1).setAlpha(0)); // the panel under its texts
    scene.tweens.add({ targets: parts, alpha: 1, duration: c.fadeMs });
    this.helpCard = parts;
    // Any new touch closes it too (a release swallowed by an overlay must not leave it up).
    this.helpClose = () => this.hideHelp();
    scene.input.once('pointerdown', this.helpClose);
  }

  hideHelp() {
    if (!this.helpCard) return;
    this.scene.input.off('pointerdown', this.helpClose);
    this.helpCard.forEach((o) => o.destroy());
    this.helpCard = null;
  }

  // A glass button (ui.glass). variant: item.variant, else normal / disabled.
  // item.progress = {value, max}: a bar fills the button from the left (the
  // Recollection teaser).
  makeButton(item, onTap) {
    const b = this.cfg.button;
    const [x, y] = item.pos ? [item.pos.x, item.pos.y] : this.cfg.slots[item.slot];
    const w = item.pos?.w ?? this.cfg.slotWidths?.[item.slot] ?? b.w;
    const enabled = item.enabled !== false;
    const variant = item.variant || (enabled ? 'normal' : 'disabled');
    // item.help (MoveHelp.helpCard): a long press shows the card instead of acting (Button.js attachHold).
    const hc = this.cfg.help;
    const hold = item.help ? { ms: hc.holdMs, moveTol: hc.moveTol, enabled, onHold: () => this.showHelp(item.help), onRelease: () => this.hideHelp() } : null;
    const button = makeGlassButton(this.scene, x, y, { w, h: b.h, fontSize: b.fontSize }, ui.glass, variant, item.label, onTap, hold ? { hold } : {});
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

    if (!enabled && !item.help) rect.disableInteractive();

    let pulse = null;
    if (item.pulse && enabled) {
      pulse = this.scene.tweens.add({ targets: container, scale: b.pulseScale, duration: b.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    return { container, rect, pulse };
  }
}
