import Phaser from 'phaser';
import chapter1 from '../data/chapter1.json';
import qte from '../data/qte.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText, makeButton } from '../systems/Button.js';
import { saveSettings } from '../systems/Settings.js';
import ChapterRunner from '../systems/ChapterRunner.js';
import * as Fx from '../systems/Fx.js';

const cfg = ui.menu;

// New Game | Chapter 2 (locked) | Arena (locked) | Settings | Credits
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    // Scene instances are reused (End -> Menu), so reset state here.
    this.panel = null;
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
    if (item.id === 'new') this.newGame();
    else if (item.id === 'settings') this.scene.start('Settings');
    else if (item.id === 'credits') this.scene.start('End', { credits: true });
  }

  // The very first New Game asks how hard the fights should be (sets Story
  // Mode, remembered; Settings can change it later).
  newGame() {
    const settings = this.registry.get('settings') || {};
    if (settings.difficultyChosen || this.panel) {
      if (!this.panel) ChapterRunner.start(this, chapter1);
      return;
    }
    const d = cfg.difficulty;
    const blocker = this.add.rectangle(0, 0, 360, 640, Number(d.dim.color), d.dim.alpha).setOrigin(0).setInteractive();
    const box = this.add.rectangle(180, d.box.y, d.box.w, d.box.h, Number(d.box.fill)).setStrokeStyle(2, Number(d.box.stroke));
    const title = addText(this, 180, d.title.y, d.title.text, d.title);
    const pick = (storyMode) => {
      const next = { ...settings, storyMode, difficultyChosen: true };
      this.registry.set('settings', next);
      saveSettings(next);
      ChapterRunner.start(this, chapter1);
    };
    const story = makeButton(this, 180, d.story.y, cfg.button, d.story.label, () => pick(true));
    const normal = makeButton(this, 180, d.normal.y, cfg.button, d.normal.label, () => pick(false));
    const hint = addText(this, 180, d.hint.y, d.hint.text, d.hint);
    this.panel = [blocker, box, title, story.container, normal.container, hint];
    for (const [i, o] of this.panel.entries()) o.setDepth(d.depth + i);
  }
}
