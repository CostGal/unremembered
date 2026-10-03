import ui from '../data/ui.json';
import { swipeDirection } from './Qte.js';

// "Burn the memory" (recollection.json): the Recollection minigame, three beats
// with three different gestures, one after the other:
//   hold  — a gauge fills while the finger is down; release in the gold
//           (judged on |held - holdMs*centrePct|: perfectMs / goodMs).
//   swipe — an arrow points one of 4 ways; swipe that way (qte.json dodge.swipe
//           decides what a swipe is): PERFECT within perfectMs, GOOD within swipeMs.
//   taps  — `taps` taps within tapWindowMs of the first one: PERFECT with
//           perfectSpareMs to spare, GOOD in time.
// Every window is multiplied by windowMult (the difficulty). Each beat resolves
// 'PERFECT' | 'GOOD' | 'MISS'; an app switch (scene pause) restarts the beat on
// resume. scene.recollectionBeat describes the live beat (the playtest bot and
// QA read it): {kind, index, startAt, ...}.
//
// runBeats(scene, {cfg, windowMult, swipe, onResult, force}) -> [result x3]
//   onResult(result, index): the scene's feedback (pop text, hit on the target).
//   force: dev/QA only — a result (or a list) every beat takes after forceMs.

const FORCE_MS = 300;

export function gradeOf(results) {
  if (results.every((r) => r === 'PERFECT')) return 'FLAWLESS';
  if (results.every((r) => r !== 'MISS')) return 'CLEAN';
  if (results.some((r) => r !== 'MISS')) return 'ROUGH';
  return null;
}

export async function runBeats(scene, { cfg, windowMult = 1, swipe, onResult = () => {}, force = null }) {
  const results = [];
  const prompt = scene.add
    .text(cfg.prompt.x, cfg.prompt.y, '', { fontFamily: ui.font, fontSize: `${cfg.prompt.fontSize}px`, color: cfg.prompt.color, stroke: cfg.prompt.stroke, strokeThickness: cfg.prompt.strokeThickness, align: 'center' })
    .setOrigin(0.5)
    .setDepth(cfg.depth + 1);
  const pulse = scene.tweens.add({ targets: prompt, alpha: cfg.prompt.pulseAlpha, duration: cfg.prompt.pulseMs, yoyo: true, repeat: -1 });
  const c = cfg.counter;
  const counter = scene.add
    .text(c.x, c.y, '', { fontFamily: ui.font, fontSize: `${c.fontSize}px`, color: c.color, stroke: c.stroke, strokeThickness: c.strokeThickness })
    .setOrigin(0.5)
    .setDepth(cfg.depth + 1);

  await wait(scene, cfg.startDelayMs);
  for (let i = 0; i < cfg.order.length; i++) {
    const kind = cfg.order[i];
    const def = cfg.beats[kind];
    counter.setText(c.text.replace('{i}', i + 1).replace('{n}', cfg.order.length));
    scene.tweens.add({ targets: counter, scale: { from: c.popScale, to: 1 }, duration: c.popMs, ease: 'Back.easeOut' });
    prompt.setText(def.prompt).setVisible(true);
    const forced = Array.isArray(force) ? force[i] : force;
    let result;
    do {
      result = await BEATS[kind](scene, cfg, def, windowMult, { index: i, swipe, forced });
      if (result === 'INTERRUPTED') await resumed(scene);
    } while (result === 'INTERRUPTED' && scene.sys.isActive());
    scene.recollectionBeat = null;
    prompt.setVisible(false);
    if (!scene.sys.isActive() || result === 'INTERRUPTED') break;
    results.push(result);
    onResult(result, i);
    if (i < cfg.order.length - 1) await wait(scene, cfg.gapMs);
  }
  pulse.stop();
  prompt.destroy();
  counter.destroy();
  while (results.length < cfg.order.length) results.push('MISS');
  return results;
}

const wait = (scene, ms) => new Promise((resolve) => scene.time.delayedCall(ms, resolve));
const resumed = (scene) => new Promise((resolve) => scene.events.once('resume', resolve));

// The event's own timestamp is closest to the real touch (same rule as Qte.js).
function stamp(t) {
  const now = performance.now();
  return Number.isFinite(t) && Math.abs(now - t) < 1000 ? t : now;
}

// Skeleton of a beat: objects and listeners that go away with it, finish(result)
// once, 'INTERRUPTED' if the scene pauses (app switch) or shuts down meanwhile.
function beat(scene, state, run) {
  return new Promise((resolve) => {
    const objects = [];
    const listeners = [];
    let done = false;
    const on = (emitter, event, fn) => {
      emitter.on(event, fn);
      listeners.push([emitter, event, fn]);
    };
    const finish = (result) => {
      if (done) return;
      done = true;
      listeners.forEach(([e, ev, fn]) => e.off(ev, fn));
      objects.forEach((o) => o.destroy());
      resolve(result);
    };
    on(scene.events, 'pause', () => finish('INTERRUPTED'));
    on(scene.events, 'shutdown', () => finish('INTERRUPTED'));
    const start = performance.now();
    scene.recollectionBeat = { ...state, startAt: start };
    const add = (o) => {
      objects.push(o);
      return o;
    };
    if (state.forced) {
      scene.time.delayedCall(FORCE_MS, () => finish(state.forced));
      run({ add, on: () => {}, finish: () => {}, start, live: scene.recollectionBeat });
      return;
    }
    run({ add, on, finish, start, live: scene.recollectionBeat });
  });
}

function judge(offMs, perfectMs, goodMs) {
  if (offMs <= perfectMs) return 'PERFECT';
  if (offMs <= goodMs) return 'GOOD';
  return 'MISS';
}

const color = (hex) => Number(hex);

const BEATS = {
  hold(scene, cfg, def, mult, { index, forced }) {
    const g = def.gauge;
    const centre = def.holdMs * def.centrePct;
    const perfect = def.perfectMs * mult;
    const good = def.goodMs * mult;
    return beat(scene, { kind: 'hold', index, forced, holdMs: def.holdMs, centreMs: centre, pressedAt: null }, ({ add, on, finish, start, live }) => {
      const gfx = add(scene.add.graphics().setDepth(cfg.depth));
      const col = cfg.colors;
      let pressed = null;
      const draw = (fill) => {
        const x = g.x - g.w / 2;
        const yAt = (pct) => g.y + g.h * (1 - pct);
        gfx.clear();
        gfx.fillStyle(color(col.ink), g.inkAlpha).fillRect(x - g.border, g.y - g.border, g.w + g.border * 2, g.h + g.border * 2);
        gfx.fillStyle(color(col.gold), g.zoneAlpha).fillRect(x, yAt(def.zonePct[1]), g.w, yAt(def.zonePct[0]) - yAt(def.zonePct[1]));
        const inZone = fill >= def.zonePct[0] && fill <= def.zonePct[1];
        gfx.fillStyle(color(inZone ? col.gold : col.white), 1).fillRect(x, yAt(fill), g.w, g.h * fill);
        gfx.lineStyle(g.tickW, color(col.gold), 1).lineBetween(x - g.tickOverhang, yAt(def.centrePct), x + g.w + g.tickOverhang, yAt(def.centrePct));
        gfx.lineStyle(g.border, color(col.dim), 1).strokeRect(x - g.border, g.y - g.border, g.w + g.border * 2, g.h + g.border * 2);
      };
      draw(0);
      on(scene.input, 'pointerdown', (pointer) => {
        if (pressed) return;
        pressed = { pointer, at: stamp(pointer.downTime) };
        live.pressedAt = pressed.at;
      });
      on(scene.input, 'pointerup', (pointer) => {
        if (!pressed || pointer !== pressed.pointer) return;
        const held = stamp(pointer.upTime) - pressed.at;
        live.releasedAfter = held;
        finish(judge(Math.abs(held - centre), perfect, good));
      });
      on(scene.events, 'update', () => {
        const now = performance.now();
        if (!pressed) {
          draw(0);
          if (now - start > def.waitMs) finish('MISS');
          return;
        }
        const held = now - pressed.at;
        draw(Math.min(1, held / def.holdMs));
        if (held > def.holdMs + def.graceMs) finish('MISS');
      });
    });
  },

  swipe(scene, cfg, def, mult, { index, swipe, forced }) {
    const dir = def.directions[Math.floor(Math.random() * def.directions.length)];
    const windowMs = def.swipeMs * mult;
    const perfect = def.perfectMs * mult;
    return beat(scene, { kind: 'swipe', index, forced, dir, windowMs }, ({ add, on, finish, start }) => {
      const a = def.arrow;
      const gfx = add(scene.add.graphics({ x: a.x, y: a.y }).setDepth(cfg.depth));
      const half = a.length / 2;
      gfx.fillStyle(color(cfg.colors.gold), 1);
      gfx.fillRect(-half, -a.shaft / 2, a.length - a.head / 2, a.shaft);
      const tip = [half - a.head, -a.head / 2, half - a.head, a.head / 2, half, 0];
      gfx.fillTriangle(...tip);
      gfx.lineStyle(a.stroke, color(cfg.colors.ink), 1).strokeTriangle(...tip);
      gfx.setRotation({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir]);
      scene.tweens.add({ targets: gfx, scale: { from: a.popScale, to: 1 }, duration: a.popMs, ease: 'Back.easeOut' });
      // Only fingers that touched down during this beat count.
      const fresh = new Set();
      on(scene.input, 'pointerdown', (pointer) => fresh.add(pointer));
      const check = (pointer) => {
        if (!fresh.has(pointer)) return;
        const got = swipeDirection(pointer, swipe);
        if (!got) return;
        const t = performance.now() - start;
        finish(got !== dir ? 'MISS' : judge(t, perfect, windowMs));
      };
      on(scene.input, 'pointermove', check);
      on(scene.input, 'pointerup', (pointer) => {
        check(pointer);
        fresh.delete(pointer);
      });
      on(scene.events, 'update', () => {
        if (performance.now() - start > windowMs) finish('MISS');
      });
    });
  },

  taps(scene, cfg, def, mult, { index, forced }) {
    const windowMs = def.tapWindowMs * mult;
    return beat(scene, { kind: 'taps', index, forced, taps: def.taps, windowMs, count: 0 }, ({ add, on, finish, start, live }) => {
      const m = def.meter;
      const col = cfg.colors;
      const width = def.taps * m.pip + (def.taps - 1) * m.gap;
      const pips = [];
      for (let i = 0; i < def.taps; i++) {
        const x = m.x - width / 2 + m.pip / 2 + i * (m.pip + m.gap);
        pips.push(add(scene.add.rectangle(x, m.y, m.pip, m.pip, color(col.ink), m.inkAlpha).setStrokeStyle(m.stroke, color(col.gold)).setDepth(cfg.depth)));
      }
      const bar = add(scene.add.rectangle(m.x - width / 2, m.timeBarY, width, m.timeBarH, color(col.gold)).setOrigin(0, 0.5).setDepth(cfg.depth));
      let firstAt = null;
      let count = 0;
      on(scene.input, 'pointerdown', (pointer) => {
        const t = stamp(pointer.downTime);
        if (firstAt === null) firstAt = t;
        const pip = pips[count];
        count += 1;
        live.count = count;
        if (pip) {
          pip.setFillStyle(color(col.gold), 1);
          scene.tweens.add({ targets: pip, scale: { from: m.popScale, to: 1 }, duration: m.popMs });
        }
        if (count < def.taps) return;
        const elapsed = t - firstAt;
        finish(elapsed > windowMs ? 'MISS' : windowMs - elapsed >= def.perfectSpareMs ? 'PERFECT' : 'GOOD');
      });
      on(scene.events, 'update', () => {
        const now = performance.now();
        if (firstAt === null) {
          if (now - start > def.waitMs) finish('MISS');
          return;
        }
        const left = 1 - (now - firstAt) / windowMs;
        bar.setScale(Math.max(0, left), 1);
        if (left < 0) finish('MISS');
      });
    });
  },
};
