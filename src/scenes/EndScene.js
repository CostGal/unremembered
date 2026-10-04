import Phaser from 'phaser';
import credits from '../data/credits.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText } from '../systems/Button.js';
import { whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';
import { onAction } from '../systems/Input.js';
import { reportClear } from '../systems/JamReport.js';
import { tx } from '../systems/Prompts.js';

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
    // Jam site reporting: a finished run tells the host page, once (not the menu's Credits).
    if (!this.creditsOnly) reportClear(this.registry);
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

    // The credit lines live in one container, clipped to the panel and scrollable (drag, plus a slow
    // auto-scroll when they don't fit), so the list can grow without overlapping (ui.json end.scroll).
    const sc = cfg.scroll || {};
    const innerTop = p.y - p.h / 2 + (sc.padTop ?? 28);
    const innerBottom = p.y + p.h / 2 - (sc.padBottom ?? 24);
    const list = this.add.container(0, 0).setDepth(depth);
    const put = (y, text, style) => {
      const t = addText(this, 180, y, text, style);
      list.add(t);
      return t;
    };
    let y = innerTop + (sc.firstGap ?? 10);
    if (credits.revealed) {
      for (const line of credits.lines) {
        put(y, line.role, { fontSize: cfg.roleFontSize, color: cfg.roleColor });
        put(y + cfg.lineH * 0.7, line.name, { fontSize: cfg.nameFontSize, color: cfg.nameColor });
        y += cfg.lineH * 1.8;
      }
    } else {
      put(y, credits.hiddenText, cfg.hidden);
      y += cfg.lineH * 2.2;
    }
    // The music licences stay on show: credits.json musicLine (Kostas's one line), else one line per entry.
    const m = cfg.music;
    y += sc.musicGap ?? 10;
    if (credits.musicLine) {
      const t = put(y, credits.musicLine, m);
      y += t.height + (sc.afterMusic ?? 16);
    } else {
      credits.music.forEach((track) => {
        const line = m.format.replace('{title}', track.title).replace('{author}', track.author).replace('{license}', track.license);
        put(y, line, m);
        y += m.lineH;
      });
      y += sc.afterMusic ?? 16;
    }
    const contentBottom = y;
    const maskShape = this.make.graphics({ add: false });
    maskShape.fillRect(0, innerTop, 720, innerBottom - innerTop);
    list.setMask(maskShape.createGeometryMask());
    const overflow = Math.max(0, contentBottom - innerBottom);
    let scrollY = 0;
    const setScroll = (v) => {
      scrollY = Phaser.Math.Clamp(v, -overflow, 0);
      list.y = scrollY;
    };
    if (overflow > 0) {
      // Slow auto-scroll to the end after a pause; a drag takes over and stops it.
      const auto = this.tweens.addCounter({ from: 0, to: -overflow, duration: Math.max(2000, overflow * (sc.autoMsPerPx ?? 40)), delay: sc.autoDelayMs ?? 2500, ease: 'Linear', onUpdate: (tw) => setScroll(tw.getValue()) });
      let dragFrom = null;
      let dragged = false;
      this.input.on('pointerdown', (ptr) => { dragFrom = { y: ptr.y, scroll: scrollY }; dragged = false; });
      this.input.on('pointermove', (ptr) => {
        if (!dragFrom || !ptr.isDown) return;
        const dy = ptr.y - dragFrom.y;
        if (Math.abs(dy) > (sc.dragDeadPx ?? 8)) { dragged = true; auto.stop(); setScroll(dragFrom.scroll + dy); }
      });
      this.input.on('pointerup', () => { dragFrom = null; });
      this.wasDrag = () => dragged;
    } else this.wasDrag = () => false;

    this.time.delayedCall(cfg.hint.delayMs, () => {
      const hint = addText(this, 180, cfg.hint.y, tx(cfg.hint), cfg.hint).setDepth(depth);
      this.tweens.add({ targets: hint, alpha: cfg.hint.pulseAlpha, duration: cfg.hint.pulseMs, yoyo: true, repeat: -1 });
      // A short tap returns; a drag on the list does not (end of the drag = pointerup).
      this.input.on('pointerup', () => { if (!this.wasDrag()) this.scene.start('Menu'); });
      onAction(this, 'confirm', () => this.scene.start('Menu'));
    });
  }
}
