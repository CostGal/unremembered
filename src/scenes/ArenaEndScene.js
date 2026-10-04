import Phaser from 'phaser';
import arena from '../data/arena.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import { makeGlassButton } from '../systems/Button.js';
import { whenReady } from '../systems/Assets.js';
import { glassPanel, keyArtBackdrop } from '../systems/Backdrop.js';
import { fragmentDef } from '../systems/Fragments.js';
import { setFocusBack } from '../systems/Focus.js';

const L = arena.ui.end;
const T = arena.text.end;
const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// The end of an Arena run (ArenaRunner.endRun): fights won, the best of this
// session, the team's level, the time, and every buff taken (one icon each, ×n
// for stacks). Fight again goes back to the team select with the same team.
export default class ArenaEndScene extends Phaser.Scene {
  constructor() {
    super('ArenaEnd');
  }

  init(data) {
    this.summary = data || {};
  }

  create() {
    playSceneMusic('Menu');
    whenReady(this, () => this.build());
  }

  build() {
    const r = this.summary;
    const depth = ui.keyArt.uiDepth;
    keyArtBackdrop(this);
    const text = (y, str, size, color) =>
      this.add.text(180, y, str, { fontFamily: ui.font, fontSize: `${size}px`, color, align: 'center' }).setOrigin(0.5).setDepth(depth);

    glassPanel(this, 180, L.panel.y, L.panel.w, L.panel.h, L.panel).setDepth(depth);
    text(L.titleY, T.title, L.title.fontSize, L.title.color);
    const secs = Math.round((r.ms || 0) / 1000);
    const lines = [
      [fill(T.fights, { n: r.won ?? 0 }), L.fights.fontSize, L.fights.color],
      [r.isBest ? T.newBest : fill(T.best, { n: r.best ?? 0 }), L.line.fontSize, r.isBest ? L.line.best : L.line.dim],
      [fill(T.level, { n: r.level ?? 1 }), L.line.fontSize, L.line.color],
      [fill(T.time, { t: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` }), L.line.fontSize, L.line.dim],
    ];
    lines.forEach(([str, size, color], i) => text(L.lineFirstY + i * L.lineGap, str, size, color));

    // The buffs taken, grouped: icon (letter in its colour) and ×n.
    const counts = new Map();
    for (const id of r.buffs || []) counts.set(id, (counts.get(id) || 0) + 1);
    if (counts.size) {
      text(L.buffsY, T.buffs, L.buffsLabel.fontSize, L.buffsLabel.color);
      const ids = [...counts.keys()];
      const perRow = Math.floor((360 - L.edge * 2) / (L.iconSize * 2 + L.iconGap));
      ids.forEach((id, i) => {
        const def = fragmentDef(id);
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const inRow = Math.min(perRow, ids.length - row * perRow);
        const w = L.iconSize * 2 + L.iconGap;
        const x = 180 - ((inRow - 1) * w) / 2 + col * w - L.iconSize / 2;
        const y = L.buffsY + L.buffsLabel.gap + row * (L.iconSize + L.iconGap);
        const c = Number(def.color.replace('#', '0x'));
        this.add.rectangle(x, y, L.iconSize, L.iconSize, 0x0b0d14).setStrokeStyle(1, c).setDepth(depth);
        this.add.text(x, y, def.short, { fontFamily: ui.font, fontSize: `${Math.round(L.iconSize * 0.6)}px`, color: def.color }).setOrigin(0.5).setDepth(depth);
        const n = counts.get(id);
        if (n > 1) this.add.text(x + L.iconSize / 2 + 2, y, `×${n}`, { fontFamily: ui.font, fontSize: `${L.count.fontSize}px`, color: L.count.color }).setOrigin(0, 0.5).setDepth(depth);
      });
    }

    const b = L.button;
    makeGlassButton(this, 180, L.againY, b, ui.glass, 'primary', T.again, () => this.scene.start('ArenaTeam', { team: r.team })).container.setDepth(depth);
    const menu = makeGlassButton(this, 180, L.menuY, b, ui.glass, 'secondary', T.menu, () => this.scene.start('Menu'));
    menu.container.setDepth(depth);
    // Keyboard / controller: back (Circle / Esc) is Menu.
    setFocusBack(this, () => menu.focus.activate());
  }
}
