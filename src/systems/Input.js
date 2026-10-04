import cfg from '../data/input.json';
import { loadSettings } from './Settings.js';

// Keyboard and controller input as named actions (data/input.json): parry,
// dodge, mash, nala, confirm, back, pause and the four directions.
//
// - Keyboard: window keydown/keyup (KeyboardEvent.code). Key repeat never
//   counts; keys typed into a text field (the editor) are left alone.
// - Controller: the Gamepad API, polled once per game step. The DualSense uses
//   the Standard Gamepad layout in Chrome, Edge, Firefox and Safari. The left
//   stick drives the four directions too.
//
// Every press and release carries a timestamp on the performance.now() clock
// (the key event's timeStamp, the pad's own timestamp), so a QTE judges the
// moment of the press, not the frame that noticed it.
//
// Scenes subscribe with onAction(scene, action, fn): the handler runs only
// while that scene is running (a paused or sleeping scene under the Pause menu
// or a dialogue hears nothing) and is removed when the scene shuts down.
// Handlers run top scene first, then higher priority, then the latest
// subscription first; a handler that returns true stops the press there.

const listeners = [];
const deviceListeners = new Set();
const held = new Map(); // action -> Set of sources holding it
let game = null;
let bindings = null;
let keyToActions = new Map();
let buttonToActions = new Map();
let lastDevice = null;
const padState = new Map(); // "pad:button" / "pad:stick:dir" -> pressed

export function installInput(g) {
  if (game || typeof window === 'undefined') return;
  game = g;
  setBindings(loadSettings().bindings);
  // After Phaser's own keyboard listeners (added at boot): Phaser skips events that are
  // already defaultPrevented, and the dev scenes (AnimTest) still read Space and the arrows.
  const listen = () => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  };
  if (game.isBooted) listen();
  else game.events.once('ready', listen);
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pointerdown', (e) => setDevice(e.pointerType === 'mouse' ? 'mouse' : 'touch'), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAll();
  });
  game.events.on('prestep', pollPads);
  lastDevice = isTouchDevice() ? 'touch' : 'mouse';
  // QA (scripts/qa/keyboard.mjs): the live subscriptions and held actions.
  if (import.meta.env?.DEV) window.__input = { listeners, held, getBindings };
}

// Defaults from input.json; saved bindings ({keyboard: {action: [codes]}, gamepad: {action: [indices]}})
// replace an action's list.
export function setBindings(saved = null) {
  bindings = {
    keyboard: { ...cfg.keyboard, ...(saved?.keyboard || {}) },
    gamepad: { ...cfg.gamepad, ...(saved?.gamepad || {}) },
  };
  keyToActions = invert(bindings.keyboard);
  buttonToActions = invert(bindings.gamepad);
  releaseAll();
}

export function getBindings() {
  return bindings || { keyboard: { ...cfg.keyboard }, gamepad: { ...cfg.gamepad } };
}

function invert(map) {
  const out = new Map();
  for (const [action, list] of Object.entries(map)) {
    for (const k of list || []) {
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(action);
    }
  }
  return out;
}

// onAction(scene, 'confirm' | ['confirm', 'pause'], fn, {release, priority}) -> off().
// fn({action, time, device}) runs on the press (or on the release with release: true).
export function onAction(scene, actions, fn, { release = false, priority = 0 } = {}) {
  const list = Array.isArray(actions) ? actions : [actions];
  const entry = { scene, actions: list, fn, kind: release ? 'release' : 'press', priority, order: listeners.length ? listeners[listeners.length - 1].order + 1 : 0, live: true };
  listeners.push(entry);
  const off = () => {
    if (!entry.live) return;
    entry.live = false;
    const i = listeners.indexOf(entry);
    if (i >= 0) listeners.splice(i, 1);
    scene.events?.off('shutdown', off);
    scene.events?.off('destroy', off);
  };
  scene.events?.once('shutdown', off);
  scene.events?.once('destroy', off);
  return off;
}

export function isHeld(action) {
  return (held.get(action)?.size || 0) > 0;
}

// 'touch' | 'mouse' | 'keyboard' | 'gamepad': what the player used last (button prompts follow it).
export function getLastDevice() {
  return lastDevice;
}

export function onDeviceChange(fn) {
  deviceListeners.add(fn);
  return () => deviceListeners.delete(fn);
}

// A phone or tablet: the touch rules apply (tap = parry, swipe = dodge, the rotate overlay).
export function isTouchDevice() {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (err) {
    return false;
  }
}

function setDevice(device) {
  if (device === lastDevice) return;
  lastDevice = device;
  for (const fn of deviceListeners) fn(device);
}

// ---------- Dispatch ----------

function press(action, source, time, device) {
  let set = held.get(action);
  if (!set) held.set(action, (set = new Set()));
  const first = set.size === 0;
  set.add(source);
  if (first) dispatch('press', action, time, device);
}

function release(action, source, time, device) {
  const set = held.get(action);
  if (!set || !set.delete(source)) return;
  if (set.size === 0) dispatch('release', action, time, device);
}

function releaseAll() {
  const now = performance.now();
  for (const [action, set] of held) {
    if (!set.size) continue;
    set.clear();
    dispatch('release', action, now, lastDevice);
  }
  padState.clear();
}

function sceneIndex(scene) {
  try {
    return game.scene.getIndex(scene);
  } catch (err) {
    return -1;
  }
}

function dispatch(kind, action, time, device) {
  const evt = { action, time, device };
  const ready = listeners
    .filter((l) => l.kind === kind && l.actions.includes(action) && l.scene.sys?.isActive())
    .sort((a, b) => sceneIndex(b.scene) - sceneIndex(a.scene) || b.priority - a.priority || b.order - a.order);
  for (const l of ready) {
    if (!l.live) continue;
    if (l.fn(evt) === true) return;
  }
}

// Key event timestamps share the performance.now() clock; one that is far off (an old
// browser on another clock) falls back to now.
function eventTime(t) {
  const now = performance.now();
  return typeof t === 'number' && t > 0 && Math.abs(now - t) <= cfg.maxTimestampSkewMs ? t : now;
}

// A pad's timestamp is when its state last changed: for a press seen in this poll that is
// after the previous poll (a slow frame must not make the press late). Anything else
// (another clock, a stale value) falls back to now.
const lastPoll = new Map();
function padTime(pad, now) {
  const t = pad.timestamp;
  const prev = lastPoll.get(pad.index) ?? now - cfg.maxTimestampSkewMs;
  lastPoll.set(pad.index, now);
  return typeof t === 'number' && t >= prev - cfg.padTimestampSlackMs && t <= now + cfg.padTimestampSlackMs ? Math.min(t, now) : now;
}

// ---------- Keyboard ----------

function typing(e) {
  const t = e.target;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

function onKeyDown(e) {
  if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const actions = keyToActions.get(e.code);
  if (!actions) return;
  e.preventDefault();
  if (e.repeat) return;
  setDevice('keyboard');
  const time = eventTime(e.timeStamp);
  for (const a of actions) press(a, `k:${e.code}`, time, 'keyboard');
}

function onKeyUp(e) {
  const actions = keyToActions.get(e.code);
  if (!actions) return;
  if (!typing(e)) e.preventDefault();
  const time = eventTime(e.timeStamp);
  for (const a of actions) release(a, `k:${e.code}`, time, 'keyboard');
}

// ---------- Controller ----------

function readPads() {
  try {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p) => p && p.connected !== false) : [];
  } catch (err) {
    return []; // blocked by a permissions policy (some in-app browsers)
  }
}

function edge(id, pressed, actions, time) {
  const was = padState.get(id) || false;
  if (pressed === was) return;
  padState.set(id, pressed);
  if (pressed) setDevice('gamepad');
  for (const a of actions) (pressed ? press : release)(a, `g:${id}`, time, 'gamepad');
}

function pollPads() {
  const pads = readPads();
  if (!pads.length) return;
  const now = performance.now();
  for (const pad of pads) {
    const time = padTime(pad, now);
    for (const [index, actions] of buttonToActions) {
      const b = pad.buttons[index];
      if (!b) continue;
      edge(`${pad.index}:${index}`, b.pressed || b.value > cfg.buttonPressAt, actions, time);
    }
    const s = cfg.stick;
    const x = pad.axes[s.axes[0]] || 0;
    const y = pad.axes[s.axes[1]] || 0;
    for (const [dir, value] of [['left', -x], ['right', x], ['up', -y], ['down', y]]) {
      const id = `${pad.index}:stick:${dir}`;
      const was = padState.get(id) || false;
      edge(id, was ? value > s.releaseAt : value > s.pressAt, [dir], time);
    }
  }
}
