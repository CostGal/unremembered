import Phaser from 'phaser';
import battles from '../data/battles.json';
import enemies from '../data/enemies.json';
import ui from '../data/ui.json';
import * as Fx from '../systems/Fx.js';
import { animKey, playOnce } from '../systems/SpriteAnims.js';
import { devParam } from '../systems/DevParams.js';

const cfg = ui.animtest;

// ?animtest=1[&char=<id>] — not linked from anywhere, works in the production
// build. char = any characters/enemies/allies key (default ui.animtest.character);
// add &fakesheets=1 to preview stand-ins for sheets that don't exist yet.
export function isAnimTest() {
  try {
    return new URLSearchParams(window.location.search).get('animtest') === '1';
  } catch (err) {
    return false;
  }
}

// Cycles every animation in the character's sheet set on the battle
// background. Tap = next. Non-looping animations replay after a short pause
// (resting on their last frame in between) and pause on holdFrame.
export default class AnimTestScene extends Phaser.Scene {
  constructor() {
    super('AnimTest');
  }

  create() {
    this.id = devParam('char') || cfg.character;
    this.set = (this.registry.get('animationSets') || {})[this.id];
    this.token = 0;
    this.index = -1;

    this.add.image(180, 180, battles[cfg.battle].bg).setDisplaySize(360, 360);
    this.add.rectangle(180, 180, 360, 360, 0x000000, 0.2);
    this.add.rectangle(180, cfg.panel.y + cfg.panel.h / 2, 360, cfg.panel.h, Number(cfg.panel.color));

    const text = (y, size, color = cfg.textColor) =>
      this.add.text(180, y, '', { fontFamily: ui.font, fontSize: `${size}px`, color }).setOrigin(0.5, 0);

    if (!this.set) {
      text(cfg.title.y, cfg.title.fontSize).setText(`${this.id}: ${cfg.missingText}`);
      return;
    }

    this.entries = Object.entries(this.set.animations).map(([name, def]) => ({ name, def }));

    // Feet just above the panel, whatever the frame size (Clerk 256, Nala 64).
    const frameH = this.set.frame_size?.[1] || 128;
    const spriteY = Math.min(cfg.spriteY, cfg.panel.y - frameH / 2 - cfg.feetGap);
    this.sprite = this.add.sprite(cfg.spriteX, spriteY, animKey(this.id, this.entries[0].name));
    this.banner = this.add
      .text(cfg.spriteX, cfg.banner.y, '', {
        fontFamily: ui.font,
        fontSize: `${cfg.banner.fontSize}px`,
        color: cfg.textColor,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.titleText = text(cfg.title.y, cfg.title.fontSize);
    this.frameText = text(cfg.frameLine.y, cfg.frameLine.fontSize);
    this.markerText = text(cfg.markerLine.y, cfg.markerLine.fontSize, cfg.dimColor);
    this.strip = this.add.container(0, cfg.strip.y);
    this.stripBoxes = [];
    this.buildLegend();
    text(cfg.hint.y, cfg.hint.fontSize, cfg.dimColor).setText(cfg.hint.text);

    this.input.on('pointerdown', () => this.select(this.index + 1));
    this.input.keyboard?.on('keydown-SPACE', () => this.select(this.index + 1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.select(this.index + 1));
    this.input.keyboard?.on('keydown-LEFT', () => this.select(this.index - 1));

    this.select(0);
  }

  buildLegend() {
    const { legend, colors } = cfg;
    const items = [
      [legend.windup, colors.windup],
      [legend.impact, colors.impact],
      [legend.hold, colors.hold],
    ];
    items.forEach(([label, color], i) => {
      this.add
        .text(60 + i * 120, legend.y, label, {
          fontFamily: ui.font,
          fontSize: `${legend.fontSize}px`,
          color: `#${Number(color).toString(16).padStart(6, '0')}`,
        })
        .setOrigin(0.5, 0);
    });
  }

  select(next) {
    const count = this.entries.length;
    this.index = ((next % count) + count) % count;
    const { name, def } = this.entries[this.index];

    // Bumping the token first mutes the callbacks of the animation being cut off.
    this.token += 1;
    const token = this.token;
    this.banner.setText('');
    // stop() (not just play()) so a paused hold releases its playOnce listeners.
    this.sprite.anims.stop();

    // Shown facing the way they do in battle: heroes/allies right, enemies
    // left. FX sheets (own frame_size) are not the character: shown unflipped.
    const isFx = !!def.frame_size;
    const wantFaces = enemies[this.id] ? 'left' : 'right';
    const flip = !isFx && (this.set.facing || 'left') !== wantFaces;
    this.sprite.setScale(flip ? -1 : 1, 1);

    this.buildStrip(def);
    this.titleText.setText(`${this.id} · ${name}  (${this.index + 1}/${count})`);
    this.markerText.setText(this.markerSummary(def));
    this.playEntry(name, def, token);
  }

  async playEntry(name, def, token) {
    if (def.loop) {
      this.sprite.play(animKey(this.id, name));
      return;
    }

    while (token === this.token) {
      await playOnce(this.sprite, this.id, name, def, {
        onImpact: () => {
          // playOnce also fires once at the end when a sheet has no impactFrames.
          if (token !== this.token || !def.impactFrames) return;
          this.showBanner(cfg.banner.impact, cfg.impactFlashMs);
          Fx.flash(this, [this.sprite], 60);
        },
        onHold: (resume) => {
          if (token !== this.token) return;
          this.banner.setText(cfg.banner.hold);
          this.time.delayedCall(cfg.holdMs, () => {
            if (token !== this.token) return;
            this.banner.setText('');
            resume();
          });
        },
      });
      if (token !== this.token) return;
      await new Promise((resolve) => this.time.delayedCall(cfg.replayMs, resolve));
    }
  }

  showBanner(label, ms) {
    this.banner.setText(label);
    this.time.delayedCall(ms, () => {
      if (this.banner.text === label) this.banner.setText('');
    });
  }

  markerSummary(def) {
    if (def.placeholder) return 'PLACEHOLDER: sheet missing';
    const parts = [`${def.frames}f`, def.loop ? 'loop' : 'once'];
    if (def.fake) parts.unshift('FAKE');
    if (def.windupFrame !== undefined) parts.push(`windup ${def.windupFrame}`);
    if (def.impactFrames) parts.push(`impact [${def.impactFrames.join(',')}]`);
    if (def.holdFrame !== undefined) parts.push(`hold ${def.holdFrame}`);
    if (def.holdLastFrame) parts.push('holds last');
    return parts.join(' · ');
  }

  // One box per frame: index on top, W/I/H marker letters below.
  buildStrip(def) {
    this.strip.removeAll(true);
    const { boxW, boxH, gap, idleStroke } = cfg.strip;
    const total = def.frames * boxW + (def.frames - 1) * gap;
    const startX = 180 - total / 2 + boxW / 2;
    const labelStyle = { fontFamily: ui.font, fontSize: '11px', color: cfg.textColor };
    this.stripBoxes = [];

    for (let i = 0; i < def.frames; i++) {
      const markers = [];
      if (def.windupFrame === i) markers.push(['W', cfg.colors.windup]);
      if (def.impactFrames?.includes(i)) markers.push(['I', cfg.colors.impact]);
      if (def.holdFrame === i) markers.push(['H', cfg.colors.hold]);

      const x = startX + i * (boxW + gap);
      const marked = markers.length > 0;
      const box = this.add
        .rectangle(x, boxH / 2, boxW, boxH, marked ? Number(markers[0][1]) : Number(cfg.panel.color), marked ? 0.45 : 1)
        .setStrokeStyle(1, Number(idleStroke));
      const index = this.add.text(x, 2, `${i}`, labelStyle).setOrigin(0.5, 0);
      const letters = this.add.text(x, boxH - 2, markers.map(([l]) => l).join(''), labelStyle).setOrigin(0.5, 1);
      this.strip.add([box, index, letters]);
      this.stripBoxes.push(box);
    }
  }

  update() {
    if (!this.sprite) return;
    const { def } = this.entries[this.index];
    const frame = this.sprite.anims.currentFrame;
    const current = frame ? frame.index - 1 : 0;

    this.stripBoxes.forEach((box, i) => {
      const on = i === current;
      box.setStrokeStyle(on ? 2 : 1, Number(on ? cfg.strip.currentStroke : cfg.strip.idleStroke));
    });
    const ms = frame?.duration ? `${frame.duration}ms` : '';
    this.frameText.setText(`frame ${current}/${def.frames - 1}  ${ms}`);
  }
}
