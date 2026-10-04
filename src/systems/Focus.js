import ui from '../data/ui.json';
import { getLastDevice, onAction, onDeviceChange } from './Input.js';

// Keyboard / controller focus over a scene's buttons (data/ui.json focus).
//
// Every button made by Button.js (makeButton, makeGlassButton) registers itself
// here; other tappable things register with registerFocusable. The directions
// move the focus to the nearest button that way (wrapping along the same axis),
// confirm presses the focused button exactly like a tap, back runs the top
// layer's back handler. Hidden, destroyed and disabled buttons are skipped.
//
// The focus ring (a teal outline) shows only while the last device is a keyboard
// or a controller; a tap or click hides it. When the buttons change, the default
// button (opts.focusDefault, else the first one) takes the focus.
//
// Modals push a layer (pushFocusLayer): only the top layer's buttons can take the
// focus until it is popped.

const cfg = ui.focus;
const PADS = new Set(['keyboard', 'gamepad']);
const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function state(scene) {
  if (scene.__focus) return scene.__focus;
  const st = { layers: [{ items: [], back: null }], current: null, ring: null, pulse: null, order: 0 };
  scene.__focus = st;
  onAction(scene, ['up', 'down', 'left', 'right'], (e) => move(scene, e.action));
  onAction(scene, 'confirm', () => activate(scene));
  onAction(scene, 'back', () => goBack(scene));
  const offDevice = onDeviceChange(() => draw(scene));
  const onUpdate = () => draw(scene);
  scene.events.on('update', onUpdate);
  scene.events.once('shutdown', () => {
    offDevice();
    scene.events.off('update', onUpdate);
    st.pulse?.stop();
    st.ring?.destroy();
    scene.__focus = null;
  });
  return st;
}

// entry: {container, rect, activate(), enabled?(), focusDefault?, onFocus?(), onBlur?()} -> the entry (fields may
// be set later, e.g. onFocus on a target card).
export function registerFocusable(scene, entry) {
  const st = state(scene);
  entry.order = st.order++;
  entry.enabled = entry.enabled || (() => true);
  st.layers[st.layers.length - 1].items.push(entry);
  entry.container.once('destroy', () => {
    for (const layer of st.layers) {
      const i = layer.items.indexOf(entry);
      if (i >= 0) layer.items.splice(i, 1);
    }
    if (st.current === entry) setCurrent(scene, null);
  });
  return entry;
}

// A modal opens: only buttons made from now on can take the focus. back(): what the back action does there.
export function pushFocusLayer(scene, { back = null } = {}) {
  const st = state(scene);
  st.layers.push({ items: [], back });
  setCurrent(scene, null);
}

export function popFocusLayer(scene) {
  const st = scene.__focus;
  if (!st || st.layers.length < 2) return;
  st.layers.pop();
  setCurrent(scene, null);
}

// The back action on the scene's current layer (e.g. Settings > Back).
export function setFocusBack(scene, back) {
  const st = state(scene);
  st.layers[st.layers.length - 1].back = back;
}

function shown(o) {
  for (let c = o; c; c = c.parentContainer) if (!c.active || !c.visible) return false;
  return true;
}

function usable(entry) {
  return !!entry && entry.container.active && shown(entry.rect) && entry.enabled();
}

function candidates(st) {
  return st.layers[st.layers.length - 1].items.filter(usable);
}

function centre(entry) {
  const b = entry.rect.getBounds();
  return { x: b.centerX, y: b.centerY };
}

function setCurrent(scene, entry) {
  const st = scene.__focus;
  if (!st || st.current === entry) return;
  st.current?.onBlur?.();
  st.current = entry;
  entry?.onFocus?.();
}

function pickDefault(st) {
  const list = candidates(st);
  return list.find((e) => e.focusDefault) || list.sort((a, b) => a.order - b.order)[0] || null;
}

// The focused button, or (keyboard / controller) the default one when the old one went away.
function ensure(scene) {
  const st = scene.__focus;
  if (!st) return null;
  if (!usable(st.current)) setCurrent(scene, PADS.has(getLastDevice()) ? pickDefault(st) : null);
  return st.current;
}

function move(scene, dir) {
  const st = scene.__focus;
  const list = candidates(st);
  if (!list.length) return false;
  const cur = usable(st.current) ? st.current : null;
  if (!cur) {
    setCurrent(scene, pickDefault(st));
    return true;
  }
  const [sx, sy] = STEP[dir];
  const from = centre(cur);
  let best = null;
  let bestScore = Infinity;
  for (const e of list) {
    if (e === cur) continue;
    const c = centre(e);
    const along = (c.x - from.x) * sx + (c.y - from.y) * sy;
    const across = Math.abs((c.x - from.x) * sy) + Math.abs((c.y - from.y) * sx);
    if (along <= 1) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  // Nothing that way: wrap to the far end of the same line.
  if (!best) {
    for (const e of list) {
      if (e === cur) continue;
      const c = centre(e);
      const along = (c.x - from.x) * sx + (c.y - from.y) * sy;
      const across = Math.abs((c.x - from.x) * sy) + Math.abs((c.y - from.y) * sx);
      if (along >= -1) continue;
      const score = along + across * 2; // the most negative along = the far end
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
  }
  if (best) setCurrent(scene, best);
  return true;
}

// Confirm: press the focused button. With no focus yet (the player came from the mouse), the first press only shows it.
function activate(scene) {
  const st = scene.__focus;
  if (!st) return false;
  if (!usable(st.current)) {
    const d = pickDefault(st);
    if (!d) return false;
    setCurrent(scene, d);
    return true;
  }
  st.current.activate();
  return true;
}

function goBack(scene) {
  const st = scene.__focus;
  const back = st?.layers[st.layers.length - 1].back;
  if (!back) return false;
  back();
  return true;
}

function draw(scene) {
  const st = scene.__focus;
  if (!st) return;
  const on = PADS.has(getLastDevice());
  const entry = on ? ensure(scene) : null;
  if (!entry) {
    st.ring?.setVisible(false);
    return;
  }
  if (!st.ring) {
    st.ring = scene.add.graphics();
    st.pulse = scene.tweens.add({ targets: st.ring, alpha: { from: cfg.alpha, to: cfg.pulseAlpha }, duration: cfg.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  const b = entry.rect.getBounds();
  const p = cfg.pad;
  st.ring.setVisible(true).setDepth((entry.container.depth || 0) + cfg.depthAbove);
  st.ring.clear();
  st.ring.lineStyle(cfg.width, Number(cfg.color), 1);
  st.ring.strokeRoundedRect(b.x - p, b.y - p, b.width + p * 2, b.height + p * 2, cfg.radius);
}
