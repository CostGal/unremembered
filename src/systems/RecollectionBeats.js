import ui from '../data/ui.json';
import { playSfx } from './Audio.js';
import * as Fx from './Fx.js';
import { swipeDirection } from './Qte.js';
import { onAction } from './Input.js';
import { tx } from './Prompts.js';

// "Burn the memory" (recollection.json): the Recollection minigame, three beats
// with three different gestures, one after the other:
//   hold  — a gauge fills while the finger is down; release in the gold
//           (judged on |held - holdMs*centrePct|: perfectMs / goodMs).
//   swipe — an arrow points one of 4 ways; swipe that way (qte.json dodge.swipe
//           decides what a swipe is): PERFECT within perfectMs, GOOD within swipeMs.
//   taps  — `taps` (20) taps within tapWindowMs (5 s) of the first one: PERFECT with
//           perfectSpareMs to spare, GOOD in time. A big "n / 20" counter pops on every
//           tap, a gold meter fills, and the target takes the finale FX (makeTapFx: a
//           spark burst at the touch, a 1 px shake, a white flash + a growing red crack
//           tint, a bigger burst + pitch-rising sfx at the milestone taps).
// Every window is multiplied by windowMult (the difficulty). Each beat resolves
// 'PERFECT' | 'GOOD' | 'MISS'; an app switch (scene pause) restarts the beat on
// resume. scene.recollectionBeat describes the live beat (the playtest bot and
// QA read it): {kind, index, startAt, ...}.
// Keyboard / controller (systems/Input.js): hold = hold the parry action (X / Space),
// swipe = the direction actions (d-pad, left stick, arrows), taps = the mash
// action (Square / F); each judged on the press's own timestamp.
//
// runBeats(scene, {cfg, windowMult, difficulty, swipe, target, onResult, force}) -> [result x3]
//   difficulty: the difficulty id; beats.taps.taps may be a number or {story, normal, unforgettable} (tapsFor).
//   target: the enemy the taps FX land on (omit = no FX).
//   onResult(result, index): the scene's feedback (pop text, hit on the target).
//   force: dev/QA only — a result (or a list) every beat takes after forceMs.

const FORCE_MS = 300;

export function gradeOf(results) {
  if (results.every((r) => r === 'PERFECT')) return 'FLAWLESS';
  if (results.every((r) => r !== 'MISS')) return 'CLEAN';
  if (results.some((r) => r !== 'MISS')) return 'ROUGH';
  return null;
}

// The taps the finale asks for on this difficulty (recollection.json beats.taps.taps: a number, or one per id).
export function tapsFor(def, difficulty) {
  const t = def.taps;
  if (typeof t === 'number') return t;
  return t?.[difficulty] ?? t?.normal ?? Object.values(t || {})[0] ?? 20;
}

export async function runBeats(scene, { cfg, windowMult = 1, difficulty = 'normal', swipe, target = null, onResult = () => {}, force = null }) {
  const results = [];
  const tapFx = target && cfg.order.includes('taps') ? makeTapFx(scene, cfg, target) : null;
  scene.recollectionTapFx = tapFx; // QA reads / wraps it
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
    prompt.setText(tx(def, 'prompt')).setVisible(true);
    const forced = Array.isArray(force) ? force[i] : force;
    let result;
    do {
      result = await BEATS[kind](scene, cfg, def, windowMult, { index: i, swipe, forced, tapFx, difficulty });
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
  tapFx?.destroy();
  scene.recollectionTapFx = null;
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
    const offs = [];
    const on = (emitter, event, fn) => {
      emitter.on(event, fn);
      listeners.push([emitter, event, fn]);
    };
    // A keyboard / controller action for this beat only (Input.onAction).
    const act = (actions, fn, opts) => offs.push(onAction(scene, actions, fn, opts));
    const finish = (result) => {
      if (done) return;
      done = true;
      listeners.forEach(([e, ev, fn]) => e.off(ev, fn));
      offs.forEach((off) => off());
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
      run({ add, on: () => {}, act: () => {}, finish: () => {}, start, live: scene.recollectionBeat });
      return;
    }
    run({ add, on, act, finish, start, live: scene.recollectionBeat });
  });
}

// The finale's FX on the target (beats.taps.fx). Objects: one pooled spark emitter (created here,
// destroyed with the run); everything else is a tint, a camera shake or a short-lived flash.
//   tap({count, total, x, y})  spark burst at the touch + 1 px shake + white flash + crack tint
//   milestone(count)            bigger burst at the target + shake + flash + tap_milestone sfx (pitch by milestone)
//   reset() / end(result)       the crack tint goes back (a restarted or failed beat)
function makeTapFx(scene, cfg, target) {
  const fx = cfg.beats.taps.fx;
  const images = [target.body, ...Object.values(target.parts || {}).map((p) => p.img)];
  const originals = new Map(images.map((img) => [img, img.baseTint]));
  const emitter = Fx.sparkEmitter(scene, fx.tapSparks, cfg.depth);
  const crack = Number(fx.crack.color);
  const channel = (c, shift) => (c >> shift) & 0xff;
  const mix = (base, pct) => {
    const b = base ?? 0xffffff;
    const part = (shift) => Math.round((channel(b, shift) * (channel(0xffffff, shift) * (1 - pct) + channel(crack, shift) * pct)) / 255);
    return (part(16) << 16) | (part(8) << 8) | part(0);
  };
  const restore = () => {
    for (const [img, base] of originals) {
      if (!img.active) continue;
      if (base === undefined) {
        delete img.baseTint;
        img.clearTint();
      } else Fx.setBaseTint([img], base);
    }
  };
  return {
    tap({ count, total, x, y }) {
      if (!target.container.active) return;
      const pct = count / total;
      for (const img of images) if (img.active) Fx.setBaseTint([img], mix(originals.get(img), pct));
      Fx.flash(scene, images.filter((img) => img.active), fx.tapFlashMs);
      emitter.burst(fx.tapSparks.count, x, y);
      if (fx.tapShake) Fx.shake(scene, fx.tapShake, fx.tapShakeMs);
      if (fx.tapSfx) playSfx(fx.tapSfx, { pitch: 1 + 0.5 * pct });
    },
    // beats.taps.fx.milestones is keyed by the share of the taps done (25/50/75/100 %), so the
    // beats land at the same points whatever the difficulty's tap count.
    milestone(count, total) {
      const key = Object.keys(fx.milestones || {}).find((pct) => count === Math.ceil((total * Number(pct)) / 100));
      const m = key ? fx.milestones[key] : null;
      if (!m) return;
      Fx.screenFlash(scene, m.flash, cfg.depth - 1);
      emitter.burst(m.sparks, target.container.x, target.container.y);
      Fx.shake(scene, m.shake, m.shakeMs);
      playSfx(fx.milestoneSfx, { pitch: m.pitch });
    },
    reset: restore,
    end(result) {
      if (result === 'MISS' || result === 'INTERRUPTED') restore();
    },
    destroy() {
      emitter.destroy();
    },
  };
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
    return beat(scene, { kind: 'hold', index, forced, holdMs: def.holdMs, centreMs: centre, pressedAt: null }, ({ add, on, act, finish, start, live }) => {
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
      // Keyboard / controller: hold the parry action, release in the gold.
      const KEY = 'key';
      act('parry', (e) => {
        if (pressed) return;
        pressed = { pointer: KEY, at: stamp(e.time) };
        live.pressedAt = pressed.at;
      });
      act(
        'parry',
        (e) => {
          if (!pressed || pressed.pointer !== KEY) return;
          const held = stamp(e.time) - pressed.at;
          live.releasedAfter = held;
          finish(judge(Math.abs(held - centre), perfect, good));
        },
        { release: true },
      );
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
    return beat(scene, { kind: 'swipe', index, forced, dir, windowMs }, ({ add, on, act, finish, start }) => {
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
      // Keyboard / controller: press the arrow's direction (d-pad, left stick, arrow keys).
      act(['up', 'down', 'left', 'right'], (e) => {
        const t = stamp(e.time) - start;
        finish(e.action !== dir ? 'MISS' : judge(t, perfect, windowMs));
      });
      on(scene.events, 'update', () => {
        if (performance.now() - start > windowMs) finish('MISS');
      });
    });
  },

  // The difficulty asks for more taps (tapsFor), in the same time unless tapWindowScales is true
  // (then the window follows the difficulty's windowMult like every other beat).
  taps(scene, cfg, def, mult, { index, forced, tapFx, difficulty }) {
    const windowMs = def.tapWindowMs * (def.tapWindowScales ? mult : 1);
    const total = tapsFor(def, difficulty);
    return beat(scene, { kind: 'taps', index, forced, taps: total, windowMs, count: 0 }, ({ add, on, act, finish: end, start, live }) => {
      const m = def.meter;
      const c = def.counter;
      const col = cfg.colors;
      const label = (n) => c.text.replace('{i}', n).replace('{n}', total);
      tapFx?.reset();
      const finish = (result) => {
        tapFx?.end(result);
        end(result);
      };
      const big = add(
        scene.add
          .text(c.x, c.y, label(0), { fontFamily: ui.font, fontSize: `${c.fontSize}px`, color: c.color, stroke: c.stroke, strokeThickness: c.strokeThickness })
          .setOrigin(0.5)
          .setDepth(cfg.depth + 1),
      );
      add(scene.add.rectangle(m.x, m.y, m.w, m.h, color(col.ink), m.inkAlpha).setStrokeStyle(m.stroke, color(col.gold)).setDepth(cfg.depth));
      const inner = m.w - m.stroke * 2;
      const fill = add(scene.add.rectangle(m.x - inner / 2, m.y, inner, m.h - m.stroke * 2, color(col.gold)).setOrigin(0, 0.5).setDepth(cfg.depth + 0.1).setScale(0, 1));
      const bar = add(scene.add.rectangle(m.x - m.w / 2, m.timeBarY, m.w, m.timeBarH, color(col.gold)).setOrigin(0, 0.5).setDepth(cfg.depth));
      let firstAt = null;
      let count = 0;
      const tap = (time, x, y) => {
        const t = stamp(time);
        if (firstAt === null) firstAt = t;
        if (count >= total) return;
        count += 1;
        live.count = count;
        big.setText(label(count));
        scene.tweens.killTweensOf(big);
        scene.tweens.add({ targets: big, scale: { from: c.popScale, to: 1 }, duration: c.popMs, ease: 'Back.easeOut' });
        fill.setScale(count / total, 1);
        tapFx?.tap({ count, total: total, x, y });
        tapFx?.milestone(count, total);
        if (count < total) return;
        const elapsed = t - firstAt;
        finish(elapsed > windowMs ? 'MISS' : windowMs - elapsed >= def.perfectSpareMs ? 'PERFECT' : 'GOOD');
      };
      on(scene.input, 'pointerdown', (pointer) => tap(pointer.downTime, pointer.worldX, pointer.worldY));
      // Keyboard / controller: mash the mash action (Square / F); the sparks burst at the meter.
      act('mash', (e) => tap(e.time, m.x, m.y));
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
