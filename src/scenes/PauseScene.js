import Phaser from 'phaser';
import ui from '../data/ui.json';
import { unlockAudio } from '../systems/Audio.js';
import { addText } from '../systems/Button.js';

const cfg = ui.pause;

// Shown over a scene that paused itself because the app went to the
// background. One tap anywhere calls data.onContinue and closes the overlay.
export default class PauseScene extends Phaser.Scene {
  constructor() {
    super('Pause');
  }

  init(data) {
    this.onContinue = data.onContinue;
  }

  create() {
    this.add.rectangle(0, 0, 360, 640, Number(cfg.dim.color), cfg.dim.alpha).setOrigin(0);
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title);
    const tap = addText(this, 180, cfg.tap.y, cfg.tap.text, cfg.tap);
    this.tweens.add({ targets: tap, alpha: cfg.tap.pulseAlpha, duration: cfg.tap.pulseMs, yoyo: true, repeat: -1 });

    // The tap that brings the app back (if any) must not count as "continue".
    this.time.delayedCall(cfg.inputDelayMs, () => {
      this.input.once('pointerdown', () => {
        unlockAudio();
        this.scene.stop();
        if (this.onContinue) this.onContinue();
      });
    });
  }
}
