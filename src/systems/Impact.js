import Phaser from 'phaser';
import impactData from '../data/impact.json';
import ui from '../data/ui.json';
import { playSfx, vibrate } from './Audio.js';
import { normalizeDifficulty } from './Difficulty.js';
import * as Fx from './Fx.js';
import { clampX, rect as viewRect } from './View.js';

// The impact system: one call dresses a PERFECT parry, a crit or a BREAK with a camera punch (zoom +
// a drift toward the target), two layered flashes, two spark bursts, radial speed lines, a dust ring
// at the feet, a slammed word, a frozen beat, a short slow-mo, a haptic pattern and layered SFX.
// Everything is data (impact.json presets) and scaled by the difficulty's `intensity`.
//
// Cost: no per-frame allocation. The flashes, lines, dust ring and word are built once per scene and
// reused; sparks come from cached emitters (Fx.sparkEmitter); the camera punch runs on one 'update'
// listener driven by real time, so a hitstop does not freeze it. < 10 draw calls per impact.

const STATES = new WeakMap();
const D = impactData.depths;

// The difficulty's intensity multiplier (impact.json intensity).
export function intensityFor(settings) {
  const id = normalizeDifficulty(settings).difficulty;
  return impactData.intensity[id] ?? 1;
}

const envelope = (e, inMs, outMs) => {
  if (e < inMs) {
    const t = e / Math.max(1, inMs);
    return 1 - (1 - t) * (1 - t) * (1 - t); // ease out: the punch lands fast
  }
  if (e < inMs + outMs) {
    const t = (e - inMs) / Math.max(1, outMs);
    return 0.5 + 0.5 * Math.cos(Math.PI * t); // ease in-out back to rest
  }
  return 0;
};

function stateOf(scene) {
  let st = STATES.get(scene);
  if (st) return st;
  const v = viewRect();
  st = {
    seed: 1234567,
    flashes: [0, 1].map(() => scene.add.rectangle(v.x, v.y, v.w, v.h, 0xffffff, 1).setOrigin(0).setDepth(D.flash).setAlpha(0).setVisible(false)),
    lines: scene.add.graphics().setDepth(D.lines).setVisible(false),
    dust: null,
    text: null,
    textKey: '',
    emitters: new Map(),
    // The camera punch: set by punch(), advanced by tick().
    cam: { on: false, e: 0, t0: 0, baseX: 0, baseY: 0, to: 1, inMs: 1, outMs: 1, panPx: 0, panMs: 1, dir: 0, fx: 0, fy: 0, focus: 0 },
    slow: null,
    tick: null,
  };
  st.tick = () => tickCamera(scene, st);
  scene.events.on('update', st.tick);
  scene.events.once('shutdown', () => {
    scene.events.off('update', st.tick);
    if (st.slow) clearTimeout(st.slow.timer);
    STATES.delete(scene);
  });
  STATES.set(scene, st);
  return st;
}

// A tiny deterministic generator, so Math.random (which the QA labs stub) is never consumed here.
function rnd(st) {
  st.seed = (st.seed * 1664525 + 1013904223) >>> 0;
  return st.seed / 4294967296;
}

function tickCamera(scene, st) {
  const c = st.cam;
  if (!c.on) return;
  const cam = scene.cameras.main;
  // Real time (not the scene's tween clock): the punch holds through a hitstop and ignores slow-mo.
  c.e = performance.now() - c.t0;
  const end = Math.max(c.inMs + c.outMs, c.panMs);
  if (c.e >= end) {
    c.on = false;
    cam.setZoom(1);
    cam.setScroll(c.baseX, c.baseY);
    return;
  }
  const zt = envelope(c.e, c.inMs, c.outMs);
  const pt = envelope(c.e, c.panMs * 0.25, c.panMs * 0.75);
  const z = 1 + (c.to - 1) * zt;
  // How far the view may slide before it shows past the original frame.
  const maxX = (cam.width / 2) * (1 - 1 / z);
  const maxY = (cam.height / 2) * (1 - 1 / z);
  const ox = Phaser.Math.Clamp(c.fx * zt + c.dir * c.panPx * pt, -maxX, maxX);
  const oy = Phaser.Math.Clamp(c.fy * zt, -maxY, maxY);
  cam.setZoom(z);
  cam.setScroll(c.baseX + ox, c.baseY + oy);
}

function punch(scene, st, preset, k, x, y) {
  const cam = scene.cameras.main;
  const c = st.cam;
  // A punch already running keeps its rest position (the camera is mid-zoom right now).
  if (!c.on) {
    c.baseX = cam.scrollX;
    c.baseY = cam.scrollY;
  }
  const z = preset.zoom;
  const pan = preset.pan;
  c.on = !!(z || pan);
  c.e = 0;
  c.t0 = performance.now();
  c.to = z ? 1 + (z.to - 1) * k : 1;
  c.inMs = z ? z.inMs : 1;
  c.outMs = z ? z.outMs : 1;
  c.panPx = pan ? pan.px * k : 0;
  c.panMs = pan ? pan.ms : 1;
  c.dir = Phaser.Math.Clamp((x - (c.baseX + cam.width / 2)) / 90, -1, 1);
  const focus = impactData.camera.focus;
  c.fx = (x - (c.baseX + cam.width / 2)) * focus;
  c.fy = (y - (c.baseY + cam.height / 2)) * focus;
}

function flashes(scene, st, list, k) {
  list.forEach((f, i) => {
    const rect = st.flashes[i];
    if (!rect) return;
    scene.tweens.killTweensOf(rect);
    rect.setFillStyle(Number(f.color)).setAlpha(Math.min(1, f.alpha * k)).setVisible(true);
    scene.tweens.add({ targets: rect, alpha: 0, duration: f.ms, ease: 'Quad.easeOut', onComplete: () => rect.setVisible(false) });
  });
}

function emitterFor(scene, st, name, i, layer) {
  const key = `${name}:${i}`;
  let emitter = st.emitters.get(key);
  if (!emitter) {
    emitter = Fx.sparkEmitter(scene, layer, D.sparks);
    st.emitters.set(key, emitter);
  }
  return emitter;
}

function burst(scene, st, name, i, layer, k, x, y) {
  emitterFor(scene, st, name, i, layer).burst(Math.max(1, Math.round(layer.count * k)), x, y);
}

function dustOf(scene, st) {
  if (!st.dust) st.dust = scene.add.ellipse(0, 0, 200, 200 * impactData.dustSquash).setVisible(false);
  return st.dust;
}

function textOf(scene, st) {
  if (!st.text) st.text = scene.add.text(0, 0, '', { fontFamily: ui.font }).setOrigin(0.5).setDepth(D.text).setVisible(false);
  return st.text;
}

// Builds every object the presets need while nothing is happening (battle start), so the first PERFECT
// does not pay for creating them mid-fight (a visible hitch on a slow phone).
export function prewarmImpact(scene) {
  const st = stateOf(scene);
  for (const [name, p] of Object.entries(impactData.presets)) (p.sparks || []).forEach((layer, i) => emitterFor(scene, st, name, i, layer));
  dustOf(scene, st);
  textOf(scene, st);
}

// Radial streaks from the impact point: thin triangles, one Graphics redrawn per impact.
function speedLines(scene, st, cfg, k, x, y) {
  const g = st.lines;
  scene.tweens.killTweensOf(g);
  g.clear();
  g.fillStyle(Number(cfg.color), 1);
  const n = Math.max(1, Math.round(cfg.count * k));
  const start = rnd(st) * Math.PI * 2;
  const half = cfg.width / 2;
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2 + (rnd(st) - 0.5) * 0.25;
    const r0 = cfg.inner * (0.8 + rnd(st) * 0.4);
    const r1 = r0 + cfg.length[0] + rnd(st) * (cfg.length[1] - cfg.length[0]);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    g.fillTriangle(cos * r1, sin * r1, cos * r0 - sin * half, sin * r0 + cos * half, cos * r0 + sin * half, sin * r0 - cos * half);
  }
  g.setPosition(x, y).setAlpha(Math.min(1, cfg.alpha * (0.6 + 0.4 * k))).setScale(0.85).setVisible(true);
  scene.tweens.add({ targets: g, alpha: 0, scale: 1.3, duration: cfg.ms, ease: 'Quad.easeOut', onComplete: () => g.setVisible(false) });
}

// An ellipse that spreads across the ground at the target's feet.
function dustRing(scene, st, cfg, k, x, feetY, depth) {
  const e = dustOf(scene, st);
  scene.tweens.killTweensOf(e);
  const s = (cfg.radius * 2) / 200;
  e.setStrokeStyle(cfg.lineWidth, Number(cfg.color), 1)
    .setPosition(x, feetY)
    .setDepth(depth)
    .setScale(s * 0.3)
    .setAlpha(Math.min(1, cfg.alpha * k))
    .setVisible(true);
  scene.tweens.add({ targets: e, scale: s, alpha: 0, duration: cfg.ms, ease: 'Quad.easeOut', onComplete: () => e.setVisible(false) });
}

// The word, slammed in big and settling to size, then it holds and drifts up.
function slamText(scene, st, cfg, k, x, y, text, color) {
  const t = textOf(scene, st);
  scene.tweens.killTweensOf(t);
  // Restyled only when the word or its look changes: the same PERFECT over and over costs nothing but the tween.
  const key = `${cfg.size}|${cfg.stroke}|${cfg.letterSpacing}|${color || cfg.color}|${text}`;
  if (st.textKey !== key) {
    st.textKey = key;
    t.setText(text)
      .setFontSize(cfg.size)
      .setColor(color || cfg.color)
      .setStroke(cfg.strokeColor, cfg.stroke)
      .setLetterSpacing(cfg.letterSpacing);
    if (cfg.shadow) t.setShadow(cfg.shadow.x, cfg.shadow.y, cfg.shadow.color, 0, true, true);
    else t.setShadow(0, 0, '#000000', 0, false, false);
  }
  const baseY = y + cfg.offsetY;
  t.setPosition(clampX(x, t.width, 16), baseY).setAlpha(1).setScale(1 + (cfg.scale - 1) * (0.5 + 0.5 * k)).setVisible(true);
  scene.tweens.add({ targets: t, scale: 1, duration: cfg.slamMs, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: t,
    y: baseY - cfg.riseY,
    alpha: 0,
    delay: cfg.slamMs + cfg.holdMs,
    duration: cfg.fadeMs,
    ease: 'Quad.easeIn',
    onComplete: () => t.setVisible(false),
  });
}

function playLayers(layers, k) {
  for (const layer of layers) {
    const opts = layer.pitch ? { pitch: layer.pitch } : {};
    if (layer.delayMs) setTimeout(() => playSfx(layer.name, opts), layer.delayMs);
    else playSfx(layer.name, opts);
  }
}

// Runs the preset `name` (impact.json). opts: {x, y} the impact point; target (a battle entity: the
// dust ring goes at its feet); text (+ color) the slammed word; feetY; intensity.
// Returns {done, endSlow}: `done` resolves when the frozen beat is over (slow-mo then starts, if the
// preset has one and no ring is live); `endSlow()` ends the slow-mo at once (a caller whose next
// beat is a ring must call it, or simply await it: it also ends itself after slowMo.ms real ms).
export function impact(scene, name, opts = {}) {
  const preset = impactData.presets[name];
  const handle = { done: Promise.resolve(), endSlow: () => {}, cancelled: false };
  if (!preset || !scene.sys?.isActive()) return handle;
  const st = stateOf(scene);
  const k = opts.intensity ?? intensityFor(scene.registry?.get('settings'));
  const { x, y, target } = opts;
  const feetY = opts.feetY ?? (target ? (target.restY ?? target.container.y) + (target.height || 0) / 2 : y + 40);

  punch(scene, st, preset, k, x, y);
  if (preset.flash) flashes(scene, st, preset.flash, k);
  if (preset.shake) Fx.shake(scene, preset.shake.amount * k, preset.shake.ms);
  (preset.sparks || []).forEach((layer, i) => burst(scene, st, name, i, layer, k, x, y));
  if (preset.speedLines) speedLines(scene, st, preset.speedLines, k, x, y);
  if (preset.dustRing) dustRing(scene, st, preset.dustRing, k, x, feetY, (target?.container.depth ?? feetY) + impactData.dustDepthOffset);
  if (preset.text && opts.text) slamText(scene, st, preset.text, k, x, y, opts.text, opts.color);
  if (preset.sfx) playLayers(preset.sfx, k);
  if (preset.haptic) vibrate(preset.haptic.map((ms, i) => (i % 2 === 0 ? Math.max(1, Math.round(ms * k)) : ms)));

  const endSlow = () => {
    handle.cancelled = true;
    const s = st.slow;
    if (!s || s.handle !== handle) return;
    clearTimeout(s.timer);
    st.slow = null;
    // Only undo what this impact set: a ring that took the clock since (tutorial slow-mo) stays as it is.
    if (scene.timeScale === s.scale) scene.setTimeScale(1);
  };
  handle.endSlow = endSlow;

  const stopMs = Math.round((preset.hitstopMs || 0) * k);
  const frozen = stopMs > 0 ? Fx.hitstop(scene, stopMs) : Promise.resolve();
  handle.done = frozen.then(() => {
    const sm = preset.slowMo;
    // Never over a live ring, nor while something else already owns the clock.
    if (!sm || handle.cancelled || !scene.setTimeScale || scene.timeScale !== 1 || scene.qteRings?.size > 0) return;
    const scale = 1 - (1 - sm.scale) * k;
    if (st.slow) clearTimeout(st.slow.timer);
    st.slow = { handle, scale, timer: setTimeout(endSlow, sm.ms * k) };
    scene.setTimeScale(scale);
  });
  return handle;
}

// Dev lab (?impact=1): loops the presets every impact.json lab.labMs at the first enemy. A tick is
// skipped while a ring is live, so it never muddies a parry. Returns a stop function.
export function impactLab(scene, getPoint) {
  const lab = impactData.lab;
  let i = 0;
  const timer = setInterval(() => {
    if (!scene.sys?.isActive() || scene.qteRings?.size > 0) return;
    const p = getPoint();
    if (!p) return;
    const name = lab.presets[i++ % lab.presets.length];
    scene.__impactLab = (scene.__impactLab || 0) + 1;
    impact(scene, name, { ...p, text: name.toUpperCase() });
  }, lab.labMs);
  scene.events.once('shutdown', () => clearInterval(timer));
  return () => clearInterval(timer);
}
