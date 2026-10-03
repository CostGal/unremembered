import Phaser from 'phaser';
import credits from '../data/credits.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText } from '../systems/Button.js';
import { whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';

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
    whenReady(this, () => this.build());
  }

  // Over the Menu's key-art backdrop, the credits on a glass panel.
  build() {
    keyArtBackdrop(this);
    const depth = ui.keyArt.uiDepth;
    const p = cfg.panel;
    glassPanel(this, 180, p.y, p.w, p.h, p).setDepth(depth);
    addText(this, 180, cfg.title.y, this.creditsOnly ? credits.creditsTitle : credits.endTitle, cfg.title).setDepth(depth);

    if (credits.revealed) {
      let y = cfg.firstY;
      for (const line of credits.lines) {
        addText(this, 180, y, line.role, { fontSize: cfg.roleFontSize, color: cfg.roleColor }).setDepth(depth);
        addText(this, 180, y + cfg.lineH * 0.7, line.name, { fontSize: cfg.nameFontSize, color: cfg.nameColor }).setDepth(depth);
        y += cfg.lineH * 1.8;
      }
    } else {
      addText(this, 180, cfg.hidden.y, credits.hiddenText, cfg.hidden).setDepth(depth);
    }
    // The music licences stay on show: credits.json musicLine (Kostas's one line), else one line per entry.
    const m = cfg.music;
    if (credits.musicLine) {
      addText(this, 180, m.y, credits.musicLine, m).setDepth(depth);
    } else {
      credits.music.forEach((track, i) => {
        const line = m.format.replace('{title}', track.title).replace('{author}', track.author).replace('{license}', track.license);
        addText(this, 180, m.y + i * m.lineH, line, m).setDepth(depth);
      });
    }

    this.time.delayedCall(cfg.hint.delayMs, () => {
      const hint = addText(this, 180, cfg.hint.y, cfg.hint.text, cfg.hint).setDepth(depth);
      this.tweens.add({ targets: hint, alpha: cfg.hint.pulseAlpha, duration: cfg.hint.pulseMs, yoyo: true, repeat: -1 });
      this.input.once('pointerdown', () => this.scene.start('Menu'));
    });
  }
}
