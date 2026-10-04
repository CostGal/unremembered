import Phaser from 'phaser';
import ui from '../data/ui.json';
import { playSceneMusic, unlockAudio } from '../systems/Audio.js';
import { rect as viewRect } from '../systems/View.js';
import { saveSettings } from '../systems/Settings.js';
import { requestFullscreen, titleLine, wantsFullscreen } from '../systems/Fullscreen.js';
import { addText } from '../systems/Button.js';
import { isRealTexture, whenReady } from '../systems/Assets.js';
import { onAction } from '../systems/Input.js';
import * as Fx from '../systems/Fx.js';

const cfg = ui.title;

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  // Waits for this scene's assets (loaded in the background by the Loader).
  create() {
    whenReady(this, () => this.build());
  }

  // With the key art (ui/title_bg + ui/logo): the picture fills the screen
  // with a slow drift, rain and a few teal motes in front, the logo on top and
  // "Tap to start" over a dark gradient at the bottom. Without it: the title
  // set in type (ui.title), as before.
  build() {
    // The title track is wanted from here: it starts the moment audio unlocks
    // (the first tap, or right now where the browser already allows it) and
    // carries on into the Menu without a restart.
    playSceneMusic('Title');
    unlockAudio();
    const art = isRealTexture(this, 'title_bg');
    const hasLogo = isRealTexture(this, 'logo');
    const layout = art ? { ...cfg, ...cfg.art.layout } : cfg;

    if (art) this.buildArt();
    if (hasLogo) {
      const l = cfg.art.logo;
      const logo = this.add.image(180, 640 * l.topPct, 'logo').setOrigin(0.5, 0).setDepth(l.depth);
      logo.setScale((360 * l.widthPct) / logo.width);
      this.logo = logo;
    } else {
      this.logo = addText(this, 180, layout.logo.y, cfg.fallbackText, { fontSize: cfg.fallbackFontSize, color: cfg.fallbackColor }).setDepth(cfg.art.logo.depth);
    }
    if (!art) addText(this, 180, cfg.subtitle.y, cfg.subtitle.text, cfg.subtitle);

    const tap = addText(this, 180, layout.tap.y, cfg.tap.text, cfg.tap).setDepth(cfg.art.textDepth);
    this.tweens.add({ targets: tap, alpha: cfg.tap.pulseAlpha, duration: cfg.tap.pulseMs, yoyo: true, repeat: -1 });
    this.tapText = tap;

    addText(this, 180, layout.silent.y, cfg.silent.text, cfg.silent).setDepth(cfg.art.textDepth);
    this.buildFullscreenLine();

    const start = () => {
      if (this.started) return;
      this.started = true;
      unlockAudio();
      // Inside the tap, where the browser allows it and the player hasn't turned it off.
      if (wantsFullscreen(this.registry.get('settings'))) requestFullscreen();
      this.leave();
    };
    this.started = false;
    this.input.once('pointerdown', start);
    // Keyboard / controller: confirm starts too. (A controller button is not a user
    // gesture for audio in most browsers; the next key, click or tap unlocks it.)
    onAction(this, 'confirm', () => {
      start();
      return true;
    });
    // For the load-time check (scripts/perf.mjs): the title takes taps now.
    performance.mark('title-interactive');
  }

  // Browsers only allow sound after the first tap, so the title track starts
  // on it: the Title stays up for a beat (logo pulse, "Tap to start" fades)
  // so the music is heard here, then the Menu carries it on (same track).
  leave() {
    const l = cfg.leave;
    this.tweens.killTweensOf(this.tapText);
    this.tweens.add({ targets: this.tapText, alpha: 0, duration: l.fadeMs });
    const s = this.logo.scaleX;
    // A punch up, then it settles back with an overshoot.
    this.tweens.chain({
      targets: this.logo,
      tweens: [
        { scale: s * l.logoPulseScale, duration: l.logoPulseUpMs, ease: l.logoPulseUpEase },
        { scale: s, duration: l.logoPulseMs, ease: l.logoPulseEase },
      ],
    });
    this.time.delayedCall(l.delayMs, () => this.scene.start('Menu'));
  }

  // Bottom line: "Fullscreen: On/Off" (a toggle, remembered in settings) where
  // the Fullscreen API works; a tip where it can't (iOS, in-app browsers).
  buildFullscreenLine() {
    const f = cfg.fullscreen;
    const settings = this.registry.get('settings') || {};
    const line = titleLine(settings);
    if (!line) return;
    const text = addText(this, 180, f.y, line.text, f).setDepth(cfg.art.textDepth);
    if (!line.toggle) return;
    const on = () => settings.fullscreen !== false;
    const paint = () => text.setText(on() ? f.on : f.off).setColor(on() ? f.activeColor : f.color);
    paint();
    // A tap here flips the setting and must not count as "Tap to start".
    const hit = this.add.zone(180, f.y, f.hitW, f.hitH).setInteractive({ useHandCursor: true }).setDepth(cfg.art.textDepth + 1);
    hit.on('pointerdown', (pointer, x, y, event) => {
      event.stopPropagation();
      // Any gesture is a chance to start the sound.
      unlockAudio();
      settings.fullscreen = !on();
      this.registry.set('settings', { ...settings });
      saveSettings(settings);
      paint();
    });
  }

  buildArt() {
    const a = cfg.art;
    const view = viewRect();
    const bg = this.add.image(180, 320, 'title_bg');
    const cover = Math.max(view.w / bg.width, view.h / bg.height);
    bg.setScale(cover);
    this.tweens.add({
      targets: bg,
      scale: cover * a.drift.zoom,
      x: 180 + a.drift.x,
      y: 320 + a.drift.y,
      duration: a.drift.ms,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    Fx.rain(this, a.rain, view);
    Fx.motes(this, a.motes);

    const g = a.gradient;
    this.add.image(view.x, g.y, Fx.gradientTexture(this, view.w, 640 - g.y, g.color, g.alpha)).setOrigin(0).setDepth(g.depth);
  }
}
