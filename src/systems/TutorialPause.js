import Phaser from 'phaser';
import tutorial from '../data/tutorial.json';
import ui from '../data/ui.json';
import { devParam } from './DevParams.js';
import { rect as viewRect } from './View.js';

// Tutorial pauses (src/data/tutorial.json): the scene freezes, everything is
// dimmed except the spotlight targets, a short text box explains them and a
// tap continues. A pause may have several `steps`; a tap advances through them.
//
//   await TutorialPause.show(scene, 'parry', { hero, enemy })
//
// Call it only at safe points (no QTE ring live, no turn animation that must
// keep running): tweens, animations and timers of the scene are frozen while it
// is up. The continue tap is swallowed (it never reaches the game) and is
// ignored for the first minDismissMs.
//
// Targets are names; the scene resolves them through scene.tutorialTargets
// (name -> {x, y, w, h, pad?} or a function returning one; Hud, CommandMenu,
// BattleScene and RecallCard register theirs). The third argument adds or
// overrides entries for this call. The fourth is a flags object: a step with
// `textIfShort` shows that text instead when flags.short is set.
//
// mode "guided" (one step): the dim + spotlight on the target, and a tap OUTSIDE
// the spotlight is swallowed while a tap INSIDE it passes through to the real
// button underneath; that tap ends the pause (no "tap to continue" line). hud.hp / hud.echo take an optional hero
// suffix (hud.hp.dov); without it, Rhea's (else the first) row.

const cfg = tutorial.style;
const REGISTRY_KEY = 'tutorialSeen';

// ?pauses=0 turns every pause off (dev); ?pauses=all shows them every time (QA).
export function pausesMode() {
  const p = devParam('pauses');
  return p === '0' ? 'off' : p === 'all' ? 'all' : 'normal';
}

// A new run shows every pause again (ChapterRunner.start).
export function resetPauses(registry) {
  registry.set(REGISTRY_KEY, []);
}

// Counts a pause as seen without showing it (a more specific pause stood in for it).
export function markSeen(registry, id) {
  if (!hasSeen(registry, id)) registry.set(REGISTRY_KEY, [...(registry.get(REGISTRY_KEY) || []), id]);
}

export function hasSeen(registry, id) {
  return (registry.get(REGISTRY_KEY) || []).includes(id);
}

// The pause with this id would show now: it exists, pauses are on, this battle
// shows tutorials (or the pause is `always`) and it wasn't shown this run.
// `inline` is a pause definition that is not in tutorial.json (the Recall card builds
// learn_<tech> pauses from techniques.json help); it counts as seen under its id like any other.
export function wouldShow(scene, id, inline = null) {
  const def = inline || tutorial.pauses[id];
  if (!def || pausesMode() === 'off') return false;
  // The Arena (battleDef.noStory) is fighting only: no tutorial pause at all.
  if (scene.battleDef?.noStory) return false;
  if (scene.battleDef && !scene.battleDef.tutorial && !def.always) return false;
  return pausesMode() === 'all' || !hasSeen(scene.registry, id);
}

export function stepsOf(def) {
  return def.steps || [{ text: def.text, targets: def.targets, indicator: def.indicator }];
}

// Resolves true when the player has been through the pause, false at once when it doesn't apply.
export function show(scene, id, targets = {}, flags = {}, inline = null) {
  if (!wouldShow(scene, id, inline)) return Promise.resolve(false);
  const def = inline || tutorial.pauses[id];
  scene.registry.set(REGISTRY_KEY, [...(scene.registry.get(REGISTRY_KEY) || []), id]);
  for (const hint of def.skipHints || []) scene.hints?.skip(hint);
  return new Promise((resolve) => new Pause(scene, id, def, targets, resolve, flags).start());
}

class Pause {
  constructor(scene, id, def, targets, resolve, flags = {}) {
    this.scene = scene;
    this.id = id;
    this.guided = def.mode === 'guided';
    this.flags = flags;
    this.cuts = [];
    this.steps = stepsOf(def);
    this.extra = targets;
    this.resolve = resolve;
    this.index = 0;
    this.objects = [];
    this.stepObjects = [];
    this.shownAt = 0;
    this.pressed = false;
    this.done = false;
    this.anim = []; // per-frame callbacks (real time: tweens are frozen while the pause is up)
  }

  start() {
    const scene = this.scene;
    // Freeze the battle: tweens, animations and timers.
    this.saved = { tweens: scene.tweens.timeScale, anims: scene.anims.globalTimeScale, time: scene.time.timeScale };
    scene.tweens.timeScale = 0;
    scene.anims.globalTimeScale = 0;
    scene.time.timeScale = 0;
    scene.tutorialPause = { id: this.id, step: 0, steps: this.steps.length, guided: this.guided, hole: null };

    const v = viewRect();
    // The dim covers everything; its hit area swallows every tap (the spotlight is not clickable).
    this.dim = scene.add.rectangle(v.x, 0, v.w, v.h, Number(cfg.dimColor), 1).setOrigin(0).setDepth(cfg.depth).setAlpha(0);
    if (this.guided) {
      // Guided: the dim is hit everywhere except inside the spotlight (once the step has been up for
      // minDismissMs), so a tap on the spotlit button reaches that button.
      this.dim.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, v.w, v.h),
        hitAreaCallback: (area, x, y) => Phaser.Geom.Rectangle.Contains(area, x, y) && !this.inHole(x + v.x, y),
      });
      this.onPointer = (pointer) => {
        if (!this.done && this.inHole(pointer.worldX, pointer.worldY)) this.finish();
      };
      scene.input.on('pointerdown', this.onPointer);
    } else this.dim.setInteractive();
    this.dim.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation();
      this.pressed = !this.guided && performance.now() - this.shownAt >= cfg.minDismissMs;
    });
    this.dim.on('pointerup', (pointer, x, y, event) => {
      event?.stopPropagation();
      if (!this.pressed) return; // a guided pause never continues on a swallowed tap
      this.pressed = false;
      this.next();
    });
    this.holes = scene.make.graphics({ add: false });
    this.mask = this.holes.createGeometryMask();
    this.mask.setInvertAlpha(true);
    this.dim.setMask(this.mask);
    this.objects.push(this.dim);

    this.onUpdate = () => {
      const now = performance.now();
      for (const fn of this.anim) fn(now);
    };
    scene.events.on('update', this.onUpdate);
    this.onShutdown = () => this.finish(false); // the scene is going away: clean up, nobody is left to resume
    scene.events.once('shutdown', this.onShutdown);

    // Fade-in (re-run for every step). Real time: the scene's tweens are frozen.
    this.fade = { from: performance.now() };
    this.anim.push((now) => {
      const t = Math.min(1, (now - this.fade.from) / cfg.fadeMs);
      this.dim.setAlpha(this.index === 0 ? cfg.dimAlpha * t : cfg.dimAlpha);
      this.stepObjects.forEach((o) => o.setAlpha(t * o.baseAlpha));
    });
    this.build();
  }

  // ---------- Steps ----------

  next() {
    if (this.done) return;
    this.index += 1;
    if (this.index >= this.steps.length) return this.finish();
    this.scene.tutorialPause.step = this.index;
    this.clearStep();
    this.build();
  }

  // A point inside a spotlight of a guided pause that is ready for the tap.
  inHole(x, y) {
    if (performance.now() - this.shownAt < cfg.minDismissMs) return false;
    return this.cuts.some((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  }

  clearStep() {
    for (const o of this.stepObjects) o.destroy();
    this.stepObjects = [];
    this.anim = this.anim.slice(0, 1); // keep the fade of the dim
  }

  add(obj, baseAlpha = 1) {
    obj.setDepth(cfg.depth + 1);
    obj.baseAlpha = baseAlpha;
    this.stepObjects.push(obj);
    return obj;
  }

  build() {
    const scene = this.scene;
    const step = this.steps[this.index];
    this.shownAt = performance.now();
    this.scene.tutorialPause.shownAt = this.shownAt;
    this.pressed = false;
    this.fade = { from: this.shownAt };

    const cuts = this.resolveTargets(step.targets || []);
    this.cuts = cuts;
    // A guided pause whose button is not on screen could never be answered: skip it rather than soft-lock.
    if (this.guided && !cuts.length) {
      this.finish();
      return;
    }
    // Dev/bot read: where a guided pause lets a tap through.
    if (this.guided && cuts[0]) scene.tutorialPause.hole = { x: Math.round(cuts[0].x + cuts[0].w / 2), y: Math.round(cuts[0].y + cuts[0].h / 2) };

    // Cut-outs: holes in the dim and a pulsing outline around each.
    this.holes.clear();
    this.holes.fillStyle(0xffffff, 1);
    const outline = scene.add.graphics();
    this.add(outline);
    for (const c of cuts) this.holes.fillRoundedRect(c.x, c.y, c.w, c.h, cfg.radius);
    const o = cfg.outline;
    this.anim.push((now) => {
      const a = o.alphaMin + (o.alphaMax - o.alphaMin) * (0.5 + 0.5 * Math.sin((now / o.pulseMs) * Math.PI * 2));
      outline.clear();
      outline.lineStyle(o.width, Number(o.color), a);
      for (const c of cuts) outline.strokeRoundedRect(c.x, c.y, c.w, c.h, cfg.radius);
    });

    this.buildBox(step, cuts);
    if (step.indicator && cuts.length) this.buildIndicator(step.indicator, cuts[cuts.length - 1]);
    this.stepObjects.forEach((obj) => obj.setAlpha(0));
  }

  // The padded cut-out rects of the step's targets (unknown / absent ones are skipped).
  resolveTargets(names) {
    const out = [];
    for (const name of names) {
      let r = this.lookup(name);
      if (typeof r === 'function') r = r();
      if (!r) {
        console.warn(`TutorialPause ${this.id}: target "${name}" is not on screen`);
        continue;
      }
      const pad = r.pad ?? cfg.pad;
      out.push({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });
    }
    return out;
  }

  lookup(name) {
    const map = { ...(this.scene.tutorialTargets || {}), ...this.extra };
    return map[name];
  }

  buildBox(step, cuts) {
    const scene = this.scene;
    const b = cfg.box;
    const body = this.flags.short && step.textIfShort ? step.textIfShort : step.text;
    const text = this.add(
      scene.add
        .text(b.x, 0, body, { fontFamily: ui.font, fontSize: `${b.fontSize}px`, color: b.color, align: 'center', wordWrap: { width: b.wrap }, lineSpacing: b.lineSpacing })
        .setOrigin(0.5, 0)
    );
    // A guided step ends with the tap on the spotlight, not with "Tap to continue".
    const hint = this.add(scene.add.text(b.x, 0, this.guided ? '' : b.hint.text, { fontFamily: ui.font, fontSize: `${b.hint.fontSize}px`, color: b.hint.color }).setOrigin(0.5, 0));
    const h = b.padY + text.height + (this.guided ? 0 : b.hint.gap + hint.height) + b.padY;

    // Box position: tutorial.json boxY (a centre y) or "auto": just above the spotlight, else just below it.
    let top;
    if (typeof step.boxY === 'number') top = step.boxY - h / 2;
    else {
      const unionTop = Math.min(...cuts.map((c) => c.y), ui.view.designH);
      const unionBottom = Math.max(...cuts.map((c) => c.y + c.h), 0);
      top = unionTop - b.gap - h >= b.edgeMin ? unionTop - b.gap - h : unionBottom + b.gap;
    }
    top = Math.max(b.edgeMin, Math.min(b.edgeMax - h, top));

    const bg = this.add(scene.add.graphics());
    bg.fillStyle(Number(b.fill), b.alpha);
    bg.fillRoundedRect(b.x - b.w / 2, top, b.w, h, b.radius);
    bg.lineStyle(2, Number(b.stroke), 1);
    bg.strokeRoundedRect(b.x - b.w / 2, top, b.w, h, b.radius);
    bg.setDepth(cfg.depth + 1);
    text.setY(top + b.padY).setDepth(cfg.depth + 2);
    hint.setY(top + b.padY + text.height + b.hint.gap).setDepth(cfg.depth + 2);
    if (this.steps.length > 1) {
      const s = b.steps;
      // On the hint row, bottom right: a full first line of text never runs into it.
      const n = this.add(scene.add.text(b.x + b.w / 2 - 10, top + h - b.padY - hint.height, `${this.index + 1}/${this.steps.length}`, { fontFamily: ui.font, fontSize: `${s.fontSize}px`, color: s.color }).setOrigin(1, 0));
      n.setDepth(cfg.depth + 2);
    }
    this.anim.push((now) => {
      hint.baseAlpha = b.hint.alphaMin + (1 - b.hint.alphaMin) * (0.5 + 0.5 * Math.sin((now / b.hint.pulseMs) * Math.PI * 2));
    });
    this.box = { top, h };
  }

  // A pulsing ring ("tap") or a finger dot with a trail sliding right ("swipe") at the centre of the cut-out.
  buildIndicator(kind, cut) {
    const g = this.add(this.scene.add.graphics());
    g.setDepth(cfg.depth + 3);
    const cx = cut.x + cut.w / 2;
    const cy = cut.y + cut.h / 2;
    if (kind === 'tap') {
      const t = cfg.tapIndicator;
      this.anim.push((now) => {
        const p = (now % t.ms) / t.ms;
        g.clear();
        g.lineStyle(t.width, Number(t.color), 1 - p);
        g.strokeCircle(cx, cy, t.r0 + (t.r1 - t.r0) * p);
        g.fillStyle(Number(t.color), 0.9);
        g.fillCircle(cx, cy, 6);
      });
      return;
    }
    const s = cfg.swipeIndicator;
    const loop = s.ms + s.pauseMs;
    const x0 = cx - s.travel / 2;
    // The dot eases from left to right in s.ms, then rests (fading out) for s.pauseMs.
    const xAt = (t) => x0 + s.travel * (1 - Math.pow(1 - Math.min(1, (t % loop) / s.ms), 2));
    this.anim.push((now) => {
      g.clear();
      const cycle = now % loop;
      const fadeOut = cycle > s.ms ? Math.max(0, 1 - (cycle - s.ms) / s.pauseMs) : 1;
      for (let i = s.trail; i >= 0; i--) {
        const t = now - i * s.trailMs;
        if (t < 0 || Math.floor(t / loop) !== Math.floor(now / loop)) continue; // the trail stays within one swipe
        const k = 1 - i / (s.trail + 1);
        g.fillStyle(Number(s.color), (i === 0 ? 0.95 : 0.4 * k) * fadeOut);
        g.fillCircle(xAt(t), cy, s.dotR * (i === 0 ? 1 : 0.4 + 0.5 * k));
      }
    });
  }

  // ---------- End ----------

  finish(resume = true) {
    if (this.done) return;
    this.done = true;
    const scene = this.scene;
    scene.events.off('update', this.onUpdate);
    scene.events.off('shutdown', this.onShutdown);
    if (this.onPointer) scene.input.off('pointerdown', this.onPointer);
    scene.tweens.timeScale = this.saved.tweens;
    scene.anims.globalTimeScale = this.saved.anims;
    scene.time.timeScale = this.saved.time;
    scene.tutorialPause = null;
    if (this.dim.scene) this.dim.clearMask();
    for (const o of this.stepObjects) o.destroy?.();
    this.dim.destroy();
    this.mask.destroy();
    this.holes.destroy();
    if (resume) this.resolve(true);
  }
}
