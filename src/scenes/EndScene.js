import Phaser from 'phaser';
import credits from '../data/credits.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText } from '../systems/Button.js';

const cfg = ui.end;

// "End of Demo" + credits after the chapter; just the credits from the menu.
export default class EndScene extends Phaser.Scene {
  constructor() {
    super('End');
  }

  init(data) {
    this.creditsOnly = !!data?.credits;
  }

  create() {
    playSceneMusic('End');
    this.cameras.main.fadeIn(cfg.hint.delayMs / 2);
    addText(this, 180, cfg.title.y, this.creditsOnly ? credits.creditsTitle : credits.endTitle, cfg.title);

    let y = cfg.firstY;
    for (const line of credits.lines) {
      addText(this, 180, y, line.role, { fontSize: cfg.roleFontSize, color: cfg.roleColor });
      addText(this, 180, y + cfg.lineH * 0.7, line.name, { fontSize: cfg.nameFontSize, color: cfg.nameColor });
      y += cfg.lineH * 1.8;
    }

    this.time.delayedCall(cfg.hint.delayMs, () => {
      const hint = addText(this, 180, cfg.hint.y, cfg.hint.text, cfg.hint);
      this.tweens.add({ targets: hint, alpha: cfg.hint.pulseAlpha, duration: cfg.hint.pulseMs, yoyo: true, repeat: -1 });
      this.input.once('pointerdown', () => this.scene.start('Menu'));
    });
  }
}
