import Phaser from 'phaser';
import chapter1 from '../data/chapter1.json';
import qte from '../data/qte.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { addText, makeGlassButton } from '../systems/Button.js';
import { saveSettings } from '../systems/Settings.js';
import { difficultyDef, difficultyIds, normalizeDifficulty } from '../systems/Difficulty.js';
import ChapterRunner from '../systems/ChapterRunner.js';
import { startRun } from '../systems/JamReport.js';
import { isRealTexture, whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';
import * as Fx from '../systems/Fx.js';
import { rect as viewRect } from '../systems/View.js';
import { popFocusLayer, pushFocusLayer } from '../systems/Focus.js';
import { addVersionLabel } from '../systems/Version.js';

const cfg = ui.menu;

// New Game | Chapter 2 (locked) | Arena | Settings | Credits
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    // Scene instances are reused (End -> Menu), so reset state here.
    this.panel = null;
    playSceneMusic('Menu');
    whenReady(this, () => this.build());
  }

  // The Title's key art carries on behind the Menu (systems/Backdrop.js),
  // the logo on top and a stack of glass buttons that slide
  // in one by one; New Game is the teal one and breathes. Without the art:
  // the flat background and the title set in type.
  build() {
    keyArtBackdrop(this);
    if (isRealTexture(this, 'logo')) {
      const l = cfg.logo;
      const logo = this.add.image(180, 640 * l.topPct, 'logo').setOrigin(0.5, 0).setDepth(l.depth);
      logo.setScale((360 * l.widthPct) / logo.width);
    } else {
      addText(this, 180, cfg.title.y, cfg.title.text, cfg.title).setDepth(cfg.logo.depth);
    }

    cfg.items.forEach((item, i) => {
      const y = cfg.firstY + i * cfg.spacing;
      const variant = item.id === 'new' ? 'primary' : item.locked ? 'locked' : 'normal';
      // Locked items answer on the tap itself (the toast), the rest after the press.
      const button = makeGlassButton(this, 180, y, cfg.button, ui.glass, variant, item.label, () => this.choose(item, y), { instant: !!item.locked });
      button.container.setDepth(cfg.buttonDepth);
      if (item.id === 'credits' && item.inert) this.addBadge(button);
      const delay = cfg.enter.delayMs + i * cfg.enter.staggerMs;
      this.enter(button.body, delay);
      if (item.id === 'new') this.pulse(y, delay + cfg.enter.ms);
    });
    addVersionLabel(this);
  }

  // The drawn part slides in from the right and fades up; the hit area is
  // already in place, so a quick tap still works.
  enter(body, delay) {
    const e = cfg.enter;
    body.setAlpha(0).setX(e.offsetX);
    this.tweens.add({ targets: body, x: 0, alpha: 1, delay, duration: e.ms, ease: 'Cubic.easeOut' });
  }

  // A soft teal halo behind New Game, breathing.
  pulse(y, delay) {
    const p = cfg.pulse;
    const { w, h } = cfg.button;
    const halo = this.add.graphics().setDepth(cfg.buttonDepth - 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    halo.fillStyle(Number(p.color), 1);
    halo.fillRoundedRect(180 - w / 2 - p.pad, y - h / 2 - p.pad, w + p.pad * 2, h + p.pad * 2, ui.glass.radius + p.pad);
    this.tweens.add({
      targets: halo,
      alpha: { from: p.alpha[0], to: p.alpha[1] },
      delay,
      duration: p.ms,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // "POST GAME JAM" on the right of the Credits item: the art badge when the
  // texture is really there, otherwise a pill drawn in code. It sits in the
  // button's body, so it slides in with it.
  addBadge(button) {
    const c = cfg.credits;
    const x = cfg.button.w / 2 - c.badgeRightInset;
    if (isRealTexture(this, c.badgeTexture)) {
      const img = this.add.image(x, 0, c.badgeTexture).setOrigin(1, 0.5);
      img.setScale(c.badgeW / img.width);
      button.body.add(img);
      return;
    }
    const label = this.add
      .text(0, 0, c.badgeText, { fontFamily: ui.font, fontSize: `${c.badgeFontSize}px`, color: c.badgeTextColor })
      .setOrigin(0.5);
    const w = label.width + c.badgePadX * 2;
    const pill = this.add.graphics();
    pill.fillStyle(Number(c.badgeFill), 1);
    pill.fillRoundedRect(x - w, -c.badgeH / 2, w, c.badgeH, c.badgeRadius);
    label.setPosition(x - w / 2, 0);
    button.body.add([pill, label]);
  }

  choose(item, y) {
    // Credits stay on show but closed until after the jam (the tick is the button's own).
    if (item.inert) return;
    if (item.locked) {
      Fx.popText(this, 180, y + cfg.button.h / 2, cfg.lockedText, cfg.lockedColor, qte.text);
      return;
    }
    if (item.id === 'new') this.newGame();
    else if (item.id === 'arena') this.scene.start('ArenaTeam');
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
    // Keyboard / controller: only the panel's buttons take the focus; back closes it.
    pushFocusLayer(this, { back: () => this.closeDifficulty() });
    // A tap on the dim, outside the panel, closes it.
    blocker.on('pointerdown', (pointer) => {
      const inside = Math.abs(pointer.worldX - 180) <= d.box.w / 2 && Math.abs(pointer.worldY - d.box.y) <= d.box.h / 2;
      if (!inside) this.closeDifficulty();
    });
    const box = glassPanel(this, 180, d.box.y, d.box.w, d.box.h, d.box);
    const title = addText(this, 180, d.title.y, d.title.text, d.title);
    const pick = (difficulty) => {
      const next = normalizeDifficulty({ ...settings, difficulty, difficultyChosen: true });
      this.registry.set('settings', next);
      saveSettings(next);
      startRun(this.registry, next);
      ChapterRunner.start(this, chapter1);
    };
    const buttons = difficultyIds().map((id, i) => {
      // The current choice is marked.
      const variant = id === settings.difficulty ? 'current' : 'normal';
      const button = makeGlassButton(this, 180, d.firstY + i * d.spacing, d.button, ui.glass, variant, difficultyDef({ difficulty: id }).pick, () => pick(id), { focusDefault: id === settings.difficulty });
      return button.container;
    });
    const hint = addText(this, 180, d.hint.y, d.hint.text, d.hint);
    const back = makeGlassButton(this, 180, d.back.y, d.back, ui.glass, 'secondary', d.back.text, () => this.closeDifficulty());
    this.panel = [blocker, box, title, ...buttons, hint, back.container];
    for (const [i, o] of this.panel.entries()) o.setDepth(d.depth + i);
  }

  closeDifficulty() {
    if (!this.panel) return;
    for (const o of this.panel) o.destroy();
    this.panel = null;
    popFocusLayer(this);
  }
}
