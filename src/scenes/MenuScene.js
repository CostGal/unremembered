import Phaser from 'phaser';
import chapter1 from '../data/chapter1.json';
import qte from '../data/qte.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText, makeButton } from '../systems/Button.js';
import ChapterRunner from '../systems/ChapterRunner.js';
import * as Fx from '../systems/Fx.js';

const cfg = ui.menu;

// New Game | Chapter 2 (locked) | Arena (locked) | Settings | Credits
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    playSceneMusic('Menu');
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title);

    cfg.items.forEach((item, i) => {
      const y = cfg.firstY + i * cfg.spacing;
      makeButton(this, 180, y, cfg.button, item.label, () => this.choose(item, y));
    });
  }

  choose(item, y) {
    if (item.locked) {
      Fx.popText(this, 180, y + cfg.button.h / 2, cfg.lockedText, cfg.lockedColor, qte.text);
      return;
    }
    if (item.id === 'new') ChapterRunner.start(this, chapter1);
    else if (item.id === 'settings') this.scene.start('Settings');
    else if (item.id === 'credits') this.scene.start('End', { credits: true });
  }
}
