import Phaser from 'phaser';
import ui from '../data/ui.json';
import { setVolumes } from '../systems/Audio.js';
import { addText, makeButton } from '../systems/Button.js';
import { saveSettings } from '../systems/Settings.js';
import { difficultyDef, difficultyIds, normalizeDifficulty } from '../systems/Difficulty.js';
import { applyFont, fontDef, fontIds, fontLabel, loadFont, restyleScene } from '../systems/Fonts.js';

const cfg = ui.settings;

// Each row is one button: volumes cycle through volumeSteps, Difficulty
// cycles through qte.json difficulties, Font through ui.json fonts.
// Saved to localStorage on every change.
export default class SettingsScene extends Phaser.Scene {
  constructor() {
    super('Settings');
  }

  create() {
    this.settings = normalizeDifficulty(this.registry.get('settings'));
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title);

    const rows = ['musicVolume', 'sfxVolume', 'difficulty', 'font'];
    this.buttons = rows.map((key, i) =>
      makeButton(this, 180, cfg.firstY + i * cfg.spacing, cfg.button, '', () => this.change(key))
    );
    rows.forEach((key, i) => (this.buttons[i].key = key));
    this.hint = addText(this, 180, cfg.hint.y, '', cfg.hint);
    this.refresh();

    makeButton(this, 180, cfg.backY, cfg.button, cfg.labels.back, () => this.scene.start('Menu'));
  }

  change(key) {
    const s = this.settings;
    if (key === 'difficulty') {
      const ids = difficultyIds();
      s.difficulty = ids[(ids.indexOf(s.difficulty) + 1) % ids.length];
      s.storyMode = s.difficulty === 'story';
    } else if (key === 'font') {
      const ids = fontIds();
      s.font = ids[(ids.indexOf(fontDef(s).id) + 1) % ids.length];
      // Preview at once: this screen is redrawn in the new font (after its file is in).
      loadFont(applyFont(s)).then(() => this.scene.isActive() && restyleScene(this));
    } else {
      const steps = cfg.volumeSteps;
      const i = steps.findIndex((v) => Math.abs(v - s[key]) < 0.01);
      s[key] = steps[(i + 1) % steps.length];
    }
    this.registry.set('settings', normalizeDifficulty(s));
    saveSettings(s);
    setVolumes(s);
    this.refresh();
  }

  refresh() {
    const l = cfg.labels;
    for (const b of this.buttons) {
      const v = this.settings[b.key];
      const shown = b.key === 'difficulty' ? difficultyDef(this.settings).label : b.key === 'font' ? fontLabel(fontDef(this.settings)) : `${Math.round(v * 100)}%`;
      b.text.setText(l[b.key].replace('{v}', shown));
    }
    this.hint.setText(cfg.hint.text.replace('{hint}', difficultyDef(this.settings).hint));
  }
}
