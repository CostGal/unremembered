import Phaser from 'phaser';
import ui from '../data/ui.json';
import input from '../data/input.json';
import { addText, makeGlassButton } from '../systems/Button.js';
import { whenReady } from '../systems/Assets.js';
import { keyArtBackdrop } from '../systems/Backdrop.js';
import { saveSettings } from '../systems/Settings.js';
import { normalizeDifficulty } from '../systems/Difficulty.js';
import { focusOn, setFocusBack } from '../systems/Focus.js';
import { captureNext, getBindings, setBindings } from '../systems/Input.js';
import { badge, buttonLabel, keyLabel, promptDevice } from '../systems/Prompts.js';

const cfg = ui.controls;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

// Settings > Controls: rebind the keyboard and the controller (data/input.json rebind).
// The top button switches between the two; each row shows its actions and the key or button
// they are on. Pick a row (tap, click, or the focus + confirm), then press the new key or
// button: every action of the row moves to it, and an action of another row that had it
// gives it up (it keeps its other keys, or takes this row's old one). Esc / Options cancel.
// The direction keys and the d-pad stay as they are (they move the cursor). Saved in settings.bindings.
export default class ControlsScene extends Phaser.Scene {
  constructor() {
    super('Controls');
  }

  // fromPause: Settings was opened over the pause menu; Back returns to that Settings.
  init(data) {
    this.fromPause = !!data?.fromPause;
    this.device = promptDevice() === 'gamepad' ? 'gamepad' : 'keyboard';
    this.capturing = null;
  }

  create() {
    whenReady(this, () => this.build());
    this.events.once('shutdown', () => this.stopCapture());
  }

  build() {
    keyArtBackdrop(this);
    const depth = ui.keyArt.uiDepth;
    addText(this, 180, cfg.title.y, cfg.title.text, cfg.title).setDepth(depth);
    const d = cfg.device;
    this.deviceButton = makeGlassButton(this, 180, d.y, d, ui.glass, 'normal', '', () => this.switchDevice(), { instant: true });
    this.deviceButton.container.setDepth(depth);
    this.hint = addText(this, 180, cfg.hint.y, cfg.hints.idle, cfg.hint).setDepth(depth);
    const r = cfg.reset;
    this.resetButton = makeGlassButton(this, r.x, r.y, r, ui.glass, 'secondary', r.text, () => this.reset());
    this.resetButton.container.setDepth(depth);
    const b = cfg.back;
    const back = makeGlassButton(this, b.x, b.y, b, ui.glass, 'secondary', b.text, () => this.back());
    this.backButton = back;
    back.container.setDepth(depth);
    setFocusBack(this, () => (this.capturing ? this.stopCapture(true) : back.focus.activate()));
    // A tap anywhere else while waiting for a key cancels (touch screens may have no keyboard).
    this.input.on('pointerdown', () => {
      if (this.capturing && performance.now() - this.capturing.at > cfg.cancelTapDelayMs) this.stopCapture(true);
    });
    this.buildRows();
  }

  rowsFor(device) {
    return input.rebind.rows[device];
  }

  rowName(row) {
    return row.map((a) => input.labels.actions[a] || a).join(cfg.joiner);
  }

  keyName(key, device = this.device) {
    return device === 'gamepad' ? buttonLabel(key) : keyLabel(key);
  }

  buildRows() {
    for (const o of this.rowButtons || []) o.container.destroy();
    const g = cfg.grid;
    const depth = ui.keyArt.uiDepth;
    const names = cfg.device.names;
    this.deviceButton.text.setText(cfg.device.text.replace('{device}', names[this.device]));
    const bindings = getBindings()[this.device];
    this.rowButtons = this.rowsFor(this.device).map((row, i) => {
      const x = g.cols[i % 2];
      const y = g.firstY + Math.floor(i / 2) * g.spacing;
      const btn = makeGlassButton(this, x, y, g, ui.glass, 'normal', this.rowName(row), () => this.startCapture(row, btn));
      btn.container.setDepth(depth);
      btn.text.setOrigin(0, 0.5).setX(-g.w / 2 + g.labelPadX);
      const key = bindings[row[0]]?.[0];
      if (key !== undefined) {
        const b = badge(this, 0, 0, row[0], { device: this.device, key, size: g.badgeSize });
        b.setX(g.w / 2 - g.badgePadX - (b.badgeWidth ?? g.badgeSize) / 2);
        btn.body.add(b);
      }
      btn.row = row;
      return btn;
    });
  }

  switchDevice() {
    this.stopCapture(true);
    this.device = this.device === 'gamepad' ? 'keyboard' : 'gamepad';
    this.buildRows();
    this.hint.setText(cfg.hints.idle);
  }

  startCapture(row, btn) {
    if (this.capturing) return;
    btn.setVariant('current');
    this.hint.setText(cfg.hints.capture[this.device].replace('{action}', this.rowName(row)));
    const stop = captureNext(this.device, (value) => this.captured(row, value));
    const timer = this.time.delayedCall(input.rebind.timeoutMs, () => this.stopCapture(true));
    this.capturing = { row, btn, stop, timer, at: performance.now() };
  }

  stopCapture(cancelled = false) {
    const c = this.capturing;
    if (!c) return;
    this.capturing = null;
    c.stop();
    c.timer.remove();
    if (c.btn.container.active) c.btn.setVariant('normal');
    if (cancelled && this.hint?.active) this.hint.setText(cfg.hints.idle);
  }

  captured(row, value) {
    if (value === null || value === undefined) return this.stopCapture(true);
    const device = this.device;
    const all = { keyboard: { ...getBindings().keyboard }, gamepad: { ...getBindings().gamepad } };
    const map = all[device];
    // The cursor keys / d-pad stay put.
    if (DIRECTIONS.some((a) => (map[a] || []).includes(value))) {
      this.stopCapture();
      this.hint.setText(cfg.hints.taken);
      return;
    }
    const old = map[row[0]]?.[0];
    // Another row loses the key: it keeps its other keys, or takes this row's old one.
    for (const other of this.rowsFor(device)) {
      if (other === row) continue;
      for (const a of other) {
        const list = (map[a] || []).filter((k) => k !== value);
        if (list.length !== (map[a] || []).length) map[a] = list.length ? list : old !== undefined ? [old] : [];
      }
    }
    for (const a of row) map[a] = [value];
    this.save(all);
    this.stopCapture();
    const index = this.rowsFor(device).indexOf(row);
    this.buildRows();
    focusOn(this, this.rowButtons[index]?.focus);
    this.hint.setText(cfg.hints.saved.replace('{action}', this.rowName(row)).replace('{key}', this.keyName(value, device)));
  }

  save(bindings) {
    const s = normalizeDifficulty(this.registry.get('settings') || {});
    if (bindings) s.bindings = bindings;
    else delete s.bindings;
    this.registry.set('settings', s);
    saveSettings(s);
    setBindings(s.bindings);
  }

  reset() {
    this.stopCapture(true);
    this.save(null);
    this.buildRows();
    this.hint.setText(cfg.hints.reset);
  }

  back() {
    this.stopCapture(true);
    this.scene.start('Settings', { fromPause: this.fromPause });
  }
}
