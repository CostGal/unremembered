import Phaser from 'phaser';
import ui from '../data/ui.json';
import { unlockAudio } from '../systems/Audio.js';
import { addText } from '../systems/Button.js';
import { isRealTexture, whenReady } from '../systems/Assets.js';
import * as Fx from '../systems/Fx.js';

const cfg = ui.title;

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  // Waits for this scene's assets (loaded in the background by the Loader).
  create() {
    whenReady(this, () => this.build());
  }

  // With the key art (ui/title_bg + ui/logo): the picture fills the screen
  // with a slow drift, rain and a few teal motes in front, the logo on top and
  // "Tap to start" over a dark gradient at the bottom. Without it: the title
  // set in type (ui.title), as before.
  build() {
    const art = isRealTexture(this, 'title_bg');
    const hasLogo = isRealTexture(this, 'logo');
    const layout = art ? { ...cfg, ...cfg.art.layout } : cfg;

    if (art) this.buildArt();
    if (hasLogo) {
      const l = cfg.art.logo;
      const logo = this.add.image(180, 640 * l.topPct, 'logo').setOrigin(0.5, 0).setDepth(l.depth);
      logo.setScale((360 * l.widthPct) / logo.width);
    } else {
      addText(this, 180, layout.logo.y, cfg.fallbackText, { fontSize: cfg.fallbackFontSize, color: cfg.fallbackColor }).setDepth(cfg.art.logo.depth);
    }
    if (!art) addText(this, 180, cfg.subtitle.y, cfg.subtitle.text, cfg.subtitle);

    const tap = addText(this, 180, layout.tap.y, cfg.tap.text, cfg.tap).setDepth(cfg.art.textDepth);
    this.tweens.add({ targets: tap, alpha: cfg.tap.pulseAlpha, duration: cfg.tap.pulseMs, yoyo: true, repeat: -1 });

    addText(this, 180, layout.silent.y, cfg.silent.text, cfg.silent).setDepth(cfg.art.textDepth);

    this.input.once('pointerdown', () => {
      unlockAudio();
      this.scene.start('Menu');
    });
    // For the load-time check (scripts/perf.mjs): the title takes taps now.
    performance.mark('title-interactive');
  }

  buildArt() {
    const a = cfg.art;
    const bg = this.add.image(180, 320, 'title_bg');
    const cover = Math.max(360 / bg.width, 640 / bg.height);
    bg.setScale(cover);
    this.tweens.add({
      targets: bg,
      scale: cover * a.drift.zoom,
      x: 180 + a.drift.x,
      y: 320 + a.drift.y,
      duration: a.drift.ms,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    Fx.rain(this, a.rain, { x: 0, y: 0, w: 360, h: 640 });
    Fx.motes(this, a.motes);

    const g = a.gradient;
    this.add.image(0, g.y, Fx.gradientTexture(this, 360, 640 - g.y, g.color, g.alpha)).setOrigin(0).setDepth(g.depth);
  }
}
