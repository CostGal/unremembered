import Phaser from 'phaser';
import ui from '../data/ui.json';
import { setVolumes } from '../systems/Audio.js';
import { addText, makeGlassButton } from '../systems/Button.js';
import { whenReady } from '../systems/Assets.js';
import { keyArtBackdrop } from '../systems/Backdrop.js';
import { saveSettings } from '../systems/Settings.js';
import { difficultyDef, difficultyIds, normalizeDifficulty } from '../systems/Difficulty.js';
import { activeFontDef, applyFont, fontIds, fontLabel, loadFont, restyleScene } from '../systems/Fonts.js';
import { LANGUAGES, applyLanguage, langDef } from '../systems/Lang.js';

const cfg = ui.settings;

// Each row is one button: volumes cycle through volumeSteps, Difficulty
// cycles through qte.json difficulties, Font through ui.json fonts.
// Saved to localStorage on every change.
export default class SettingsScene extends Phaser.Scene {
  constructor() {
    super('Settings');
  }

  // fromPause: opened over the pause menu (PauseScene); Back returns there.
  init(data) {
    this.fromPause = !!data?.fromPause;
  }

  create() {
    whenReady(this, () => this.build());
  }

  back() {
    if (!this.fromPause) {
      this.scene.start('Menu');
      return;
    }
    this.scene.stop();
    this.scene.wake('Pause');
  }

  // Over the same key-art backdrop as the Menu, in its glass buttons.
  build() {
    this.settings = normalizeDifficulty(this.registry.get('settings'));
    keyArtBackdrop(this);
    const depth = ui.keyArt.uiDepth;
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title).setDepth(depth);

    const rows = ['musicVolume', 'sfxVolume', 'difficulty', 'font', 'language'];
    this.buttons = rows.map((key, i) =>
      makeGlassButton(this, 180, cfg.firstY + i * cfg.spacing, cfg.button, ui.glass, 'normal', '', () => this.change(key), { instant: true })
    );
    rows.forEach((key, i) => {
      this.buttons[i].key = key;
      this.buttons[i].container.setDepth(depth);
    });
    this.hint = addText(this, 180, cfg.hint.y, '', cfg.hint).setDepth(depth);
    this.refresh();

    makeGlassButton(this, 180, cfg.backY, cfg.button, ui.glass, 'secondary', cfg.labels.back, () => this.back()).container.setDepth(depth);
  }

  change(key) {
    const s = this.settings;
    if (key === 'difficulty') {
      const ids = difficultyIds();
      s.difficulty = ids[(ids.indexOf(s.difficulty) + 1) % ids.length];
      s.storyMode = s.difficulty === 'story';
    } else if (key === 'language') {
      const ids = LANGUAGES.map((l) => l.id);
      s.lang = ids[(ids.indexOf(langDef(s).id) + 1) % ids.length];
      // Every string and the font change: rebuild this screen in the new language.
      applyLanguage(s);
      this.registry.set('settings', normalizeDifficulty(s));
      saveSettings(s);
      loadFont(applyFont(s)).then(() => this.scene.isActive() && this.scene.restart({ fromPause: this.fromPause }));
      return;
    } else if (key === 'font') {
      // In a language with its own font (Greek), only the fonts that have its glyphs.
      const greekOnly = !!langDef(s).font;
      const ids = fontIds().filter((id) => !greekOnly || ui.fonts.list.find((f) => f.id === id).greek);
      s.font = ids[(ids.indexOf(activeFontDef(s).id) + 1) % ids.length];
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
      const shown =
        b.key === 'difficulty'
          ? difficultyDef(this.settings).label
          : b.key === 'font'
            ? fontLabel(activeFontDef(this.settings))
            : b.key === 'language'
              ? langDef(this.settings).label
              : `${Math.round(v * 100)}%`;
      b.text.setText(l[b.key].replace('{v}', shown));
    }
    this.hint.setText(cfg.hint.text.replace('{hint}', difficultyDef(this.settings).hint));
  }
}
