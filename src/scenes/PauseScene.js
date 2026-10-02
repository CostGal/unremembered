import Phaser from 'phaser';
import { rect as viewRect } from '../systems/View.js';
import ui from '../data/ui.json';
import { setAudioPaused, unlockAudio } from '../systems/Audio.js';
import { addText, makeGlassButton } from '../systems/Button.js';
import { glassPanel } from '../systems/Backdrop.js';

const cfg = ui.pause;

// Over a paused scene. Two modes:
// - background (the app went away): one tap anywhere calls data.onContinue.
// - menu (the ⏸ button, systems/PauseButton.js): Resume | Settings | Quit to
//   Menu (asks first). Settings opens over it and comes back here.
export default class PauseScene extends Phaser.Scene {
  constructor() {
    super('Pause');
  }

  init(data) {
    this.onContinue = data.onContinue;
    this.menu = !!data.menu;
  }

  create() {
    const v = viewRect();
    this.add.rectangle(v.x, v.y, v.w, v.h, Number(cfg.dim.color), cfg.dim.alpha).setOrigin(0).setInteractive();
    if (this.menu) {
      this.buildMenu();
      return;
    }
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title);
    const tap = addText(this, 180, cfg.tap.y, cfg.tap.text, cfg.tap);
    this.tweens.add({ targets: tap, alpha: cfg.tap.pulseAlpha, duration: cfg.tap.pulseMs, yoyo: true, repeat: -1 });

    // The tap that brings the app back (if any) must not count as "continue".
    this.time.delayedCall(cfg.inputDelayMs, () => {
      this.input.once('pointerdown', () => {
        unlockAudio();
        this.continue();
      });
    });
  }

  continue() {
    this.scene.stop();
    if (this.onContinue) this.onContinue();
  }

  buildMenu() {
    const m = cfg.menu;
    const p = m.panel;
    this.page = [glassPanel(this, 180, p.y, p.w, p.h, p), addText(this, 180, m.titleY, cfg.title.text, cfg.title)];
    m.items.forEach((item, i) => {
      const b = makeGlassButton(this, 180, m.firstY + i * m.spacing, m.button, ui.glass, item.variant, item.label, () => this.choose(item.id));
      this.page.push(b.container);
    });
  }

  choose(id) {
    if (id === 'resume') this.continue();
    else if (id === 'settings') this.openSettings();
    else if (id === 'quit') this.confirmQuit();
  }

  // Settings over the pause menu; its Back wakes this scene again.
  openSettings() {
    this.scene.launch('Settings', { fromPause: true });
    this.scene.bringToTop('Settings');
    this.scene.sleep();
  }

  confirmQuit() {
    const c = cfg.menu.confirm;
    for (const o of this.page) o.setVisible(false);
    const p = cfg.menu.panel;
    const parts = [glassPanel(this, 180, p.y, p.w, p.h, p), addText(this, 180, cfg.menu.titleY, c.title, cfg.title), addText(this, 180, c.textY, c.text, c.textStyle)];
    const yes = makeGlassButton(this, 180, c.yes.y, cfg.menu.button, ui.glass, c.yes.variant, c.yes.label, () => this.quit());
    const no = makeGlassButton(this, 180, c.no.y, cfg.menu.button, ui.glass, c.no.variant, c.no.label, () => {
      for (const o of [...parts, yes.container, no.container]) o.destroy();
      for (const o of this.page) o.setVisible(true);
    });
  }

  // Everything of the run stops; the Menu starts fresh.
  quit() {
    setAudioPaused(false);
    for (const key of cfg.menu.quitScenes) {
      if (this.scene.isActive(key) || this.scene.isPaused(key) || this.scene.isSleeping(key)) this.scene.stop(key);
    }
    this.registry.remove('runner');
    this.scene.start('Menu');
  }
}
