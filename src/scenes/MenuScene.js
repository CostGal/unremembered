import Phaser from 'phaser';
import chapter1 from '../data/chapter1.json';
import qte from '../data/qte.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText, makeButton } from '../systems/Button.js';
import { saveSettings } from '../systems/Settings.js';
import { difficultyDef, difficultyIds, normalizeDifficulty } from '../systems/Difficulty.js';
import ChapterRunner from '../systems/ChapterRunner.js';
import * as Fx from '../systems/Fx.js';
import { rect as viewRect } from '../systems/View.js';

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

  // Every New Game asks how hard the fights should be (qte.json difficulties;
  // the pick is remembered in Settings, where it can be changed mid-run).
  newGame() {
    if (this.panel) return;
    const settings = normalizeDifficulty(this.registry.get('settings'));
    const d = cfg.difficulty;
    const v = viewRect();
    const blocker = this.add.rectangle(v.x, v.y, v.w, v.h, Number(d.dim.color), d.dim.alpha).setOrigin(0).setInteractive();
    const box = this.add.rectangle(180, d.box.y, d.box.w, d.box.h, Number(d.box.fill)).setStrokeStyle(2, Number(d.box.stroke));
    const title = addText(this, 180, d.title.y, d.title.text, d.title);
    const pick = (difficulty) => {
      const next = normalizeDifficulty({ ...settings, difficulty, difficultyChosen: true });
      this.registry.set('settings', next);
      saveSettings(next);
      ChapterRunner.start(this, chapter1);
    };
    const buttons = difficultyIds().map((id, i) => {
      const button = makeButton(this, 180, d.firstY + i * d.spacing, d.button, difficultyDef({ difficulty: id }).pick, () => pick(id));
      // The current choice is marked.
      if (id === settings.difficulty) button.rect.setStrokeStyle(2, Number(d.currentStroke));
      return button.container;
    });
    const hint = addText(this, 180, d.hint.y, d.hint.text, d.hint);
    this.panel = [blocker, box, title, ...buttons, hint];
    for (const [i, o] of this.panel.entries()) o.setDepth(d.depth + i);
  }
}
