import input from '../data/input.json';
import ui from '../data/ui.json';
import { getBindings, getLastDevice, hasGamepad, isTouchDevice } from './Input.js';

// Button prompts: what the player is told to press, on the device they play with.
//
// promptDevice(): 'touch' | 'keyboard' | 'gamepad'. The last device used decides; a mouse
// counts as the keyboard, or as the controller when one is connected; before any input,
// a touch screen is 'touch'.
//
// Texts: a data object with `text` (the touch wording) may carry `textButtons`, the same
// line for keys and buttons, with {action} placeholders ("{parry} to parry"). tx(obj)
// picks the one for the device and fills the placeholders with the bound key or button
// (input.json labels), so a rebind changes every prompt. Any field works: tx(obj, 'hint')
// reads hint / hintButtons.
//
// badge(scene, x, y, action): a drawn button: the DualSense face buttons as their shapes
// in their colours, other buttons and keys as a keycap with the label (ui.json prompts.badge).

const L = input.labels;
const cfg = () => ui.prompts;

export function promptDevice() {
  const d = getLastDevice();
  if (d === 'keyboard' || d === 'gamepad') return d;
  if (d === 'mouse') return hasGamepad() ? 'gamepad' : 'keyboard';
  if (d === 'touch' || isTouchDevice()) return hasGamepad() ? 'gamepad' : 'touch';
  return hasGamepad() ? 'gamepad' : 'keyboard';
}

export const usesButtons = () => promptDevice() !== 'touch';

// The first key / button bound to `action` on `device`.
export function boundTo(action, device = promptDevice()) {
  const b = getBindings();
  return (device === 'gamepad' ? b.gamepad : b.keyboard)[action]?.[0];
}

export function keyLabel(code) {
  if (L.keys[code]) return L.keys[code];
  const m = /^(Key|Digit|Numpad)(.+)$/.exec(code || '');
  return m ? m[2] : code || '?';
}

export const buttonLabel = (index) => L.buttons[index] ?? `B${index}`;

// The label of the key / button bound to `action` ("Space", "✕", "R2").
export function label(action, device = promptDevice()) {
  const k = boundTo(action, device);
  if (k === undefined) return '?';
  return device === 'gamepad' ? buttonLabel(k) : keyLabel(k);
}

// "{parry} to parry" -> "✕ to parry".
export function fill(str, device = promptDevice()) {
  return String(str).replace(/\{(\w+)\}/g, (m, a) => (input.actions.includes(a) ? label(a, device) : m));
}

export function tx(obj, field = 'text') {
  if (!obj) return '';
  const alt = obj[`${field}Buttons`];
  const device = promptDevice();
  if (device !== 'touch' && alt) return fill(alt, device);
  return obj[field];
}

// A drawn button for `action` (or a raw {device, key}) at (x, y). Returns a container (size = ui.prompts.badge.size).
export function badge(scene, x, y, action, { device = promptDevice(), key, size } = {}) {
  const b = cfg().badge;
  const s = size ?? b.size;
  const k = key ?? boundTo(action, device);
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  c.add(g);
  const shape = device === 'gamepad' ? L.shapes[k] : null;
  if (shape) {
    const col = Number(L.shapeColors[k]);
    g.fillStyle(Number(b.fill), b.fillAlpha).fillCircle(0, 0, s / 2);
    g.lineStyle(b.stroke, Number(b.strokeColor), 1).strokeCircle(0, 0, s / 2);
    const r = s * b.shapeScale;
    g.lineStyle(b.shapeWidth, col, 1);
    if (shape === 'cross') {
      g.lineBetween(-r, -r, r, r);
      g.lineBetween(-r, r, r, -r);
    } else if (shape === 'circle') g.strokeCircle(0, 0, r);
    else if (shape === 'square') g.strokeRect(-r, -r, r * 2, r * 2);
    else g.strokeTriangle(0, -r * 1.1, r * 1.1, r * 0.8, -r * 1.1, r * 0.8);
    return c;
  }
  const text = scene.add
    .text(0, 0, device === 'gamepad' ? buttonLabel(k) : keyLabel(k), { fontFamily: ui.font, fontSize: `${b.fontSize}px`, color: b.textColor })
    .setOrigin(0.5);
  const w = Math.max(s, text.width + b.padX * 2);
  g.fillStyle(Number(b.fill), b.fillAlpha).fillRoundedRect(-w / 2, -s / 2, w, s, b.radius);
  g.lineStyle(b.stroke, Number(b.strokeColor), 1).strokeRoundedRect(-w / 2, -s / 2, w, s, b.radius);
  c.add(text);
  c.badgeWidth = w;
  return c;
}

// The parry / dodge buttons over the head of the hero a ring closes on (ui.json prompts.ring): parry
// left, dodge right of the hero's marker; both dim while the ring shrinks, lit once the press window
// opens; on a red ring only dodge. Keys and buttons only (touch keeps the text hint). top = the top of
// the hero's sprite. press(input) flashes the one used. -> {items, press, destroy} or null.
export function ringPrompt(scene, { x, top, unparryable, impactAt, openMs }) {
  if (!usesButtons()) return null;
  const r = cfg().ring;
  const actions = unparryable ? ['dodge'] : ['parry', 'dodge'];
  const items = actions.map((a) => {
    const o = badge(scene, x + (a === 'parry' ? -r.dx : r.dx), top - r.aboveTop, a).setDepth(r.depth).setAlpha(r.dimAlpha);
    o.action = a;
    return o;
  });
  let lit = false;
  const tick = () => {
    if (lit || performance.now() < impactAt - openMs) return;
    lit = true;
    for (const o of items) {
      o.setAlpha(r.litAlpha);
      scene.tweens.add({ targets: o, scale: { from: r.popScale, to: 1 }, duration: r.popMs, ease: 'Back.easeOut' });
    }
  };
  scene.events.on('update', tick);
  tick();
  let gone = false;
  const destroy = () => {
    if (gone) return;
    gone = true;
    scene.events.off('update', tick);
    scene.events.off('shutdown', destroy);
    for (const o of items) {
      scene.tweens.killTweensOf(o);
      o.destroy();
    }
  };
  scene.events.once('shutdown', destroy);
  return {
    items,
    press(gesture) {
      const o = items.find((it) => it.action === (gesture === 'swipe' ? 'dodge' : 'parry'));
      if (o) scene.tweens.add({ targets: o, scale: { from: r.pressScale, to: 1 }, duration: r.popMs });
    },
    destroy,
  };
}
