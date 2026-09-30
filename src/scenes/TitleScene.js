import Phaser from 'phaser';
import ui from '../data/ui.json';
import { unlockAudio } from '../systems/Audio.js';
import { addText } from '../systems/Button.js';

const cfg = ui.title;

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    // Until the logo art lands, the title is set in type instead of a grey box.
    const logo = this.textures.exists('logo') && !this.textures.get('logo').customData.placeholder;
    if (logo) this.add.image(cfg.logo.x, cfg.logo.y, 'logo');
    else addText(this, cfg.logo.x, cfg.logo.y, cfg.fallbackText, { fontSize: cfg.fallbackFontSize, color: cfg.fallbackColor });
    addText(this, 180, cfg.subtitle.y, cfg.subtitle.text, cfg.subtitle);

    const tap = addText(this, 180, cfg.tap.y, cfg.tap.text, cfg.tap);
    this.tweens.add({ targets: tap, alpha: cfg.tap.pulseAlpha, duration: cfg.tap.pulseMs, yoyo: true, repeat: -1 });

    addText(this, 180, cfg.silent.y, cfg.silent.text, cfg.silent);

    this.input.once('pointerdown', () => {
      unlockAudio();
      this.scene.start('Menu');
    });
  }
}
