import Phaser from 'phaser';
import ui from '../data/ui.json';
import { setVolumes } from '../systems/Audio.js';
import { addText, makeButton } from '../systems/Button.js';
import { saveSettings } from '../systems/Settings.js';

const cfg = ui.settings;

// Each row is one button: volumes cycle through volumeSteps, Story Mode
// toggles. Saved to localStorage on every change.
export default class SettingsScene extends Phaser.Scene {
  constructor() {
    super('Settings');
  }

  create() {
    this.settings = { ...this.registry.get('settings') };
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title);

    const rows = ['musicVolume', 'sfxVolume', 'storyMode'];
    this.buttons = rows.map((key, i) =>
      makeButton(this, 180, cfg.firstY + i * cfg.spacing, cfg.button, '', () => this.change(key))
    );
    rows.forEach((key, i) => (this.buttons[i].key = key));
    this.refresh();

    addText(this, 180, cfg.hint.y, cfg.hint.text, cfg.hint);
    makeButton(this, 180, cfg.backY, cfg.button, cfg.labels.back, () => this.scene.start('Menu'));
  }

  change(key) {
    const s = this.settings;
    if (key === 'storyMode') s.storyMode = !s.storyMode;
    else {
      const steps = cfg.volumeSteps;
      const i = steps.findIndex((v) => Math.abs(v - s[key]) < 0.01);
      s[key] = steps[(i + 1) % steps.length];
    }
    this.registry.set('settings', { ...s });
    saveSettings(s);
    setVolumes(s);
    this.refresh();
  }

  refresh() {
    const l = cfg.labels;
    for (const b of this.buttons) {
      const v = this.settings[b.key];
      const shown = b.key === 'storyMode' ? (v ? l.on : l.off) : `${Math.round(v * 100)}%`;
      b.text.setText(l[b.key].replace('{v}', shown));
    }
  }
}
