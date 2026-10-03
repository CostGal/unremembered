import ui from '../data/ui.json';
import { playSfx } from './Audio.js';
import * as Fx from './Fx.js';
import { rect as viewRect } from './View.js';

const MAX_STEP_MS = 250;

// The Recollection cut-in (ui.json cutIn): the scene darkens under a soft
// vignette, a band sweeps in from the right with Rhea's portrait cropped to it
// and one line per beat (dialogue.json lines: speaker, text, portrait). Tap
// (or holdMs) = next beat; after the last one the band slides out.
// play(lines) resolves once everything is gone. scene.cutInState = {beat,
// portrait, text} while it runs (QA reads it).
//
// Portraits: the cut-in art is 2x (720x240) and fills the band at 360x120. A
// portrait standing in for it (the assets.json fallback, a full-figure
// portrait) is cropped to the head: portrait.fallback {scale, srcX, srcY, x}
// puts source pixel (srcX, srcY) at band x, band top.
export default class CutIn {
  constructor(scene, cfg = ui.cutIn) {
    this.scene = scene;
    this.cfg = cfg;
  }

  async play(lines) {
    const scene = this.scene;
    const c = this.cfg;
    const b = c.band;
    const v = viewRect();
    this.objects = [];
    const keep = (o) => {
      this.objects.push(o);
      return o;
    };

    const dim = keep(scene.add.rectangle(v.x, v.y, v.w, v.h, Number(c.dim.color), 1).setOrigin(0).setDepth(c.depth).setAlpha(0));
    const vig = keep(Fx.vignette(scene, { ...c.vignette, depth: c.depth }, { x: v.x, y: v.y, w: v.w, h: v.h }).setAlpha(0));
    scene.tweens.add({ targets: dim, alpha: c.dim.alpha, duration: c.dim.fadeMs });
    scene.tweens.add({ targets: vig, alpha: c.vignette.alpha, duration: c.dim.fadeMs });

    // The band and everything in it slide together (a container at x offset 0 = in place).
    const band = keep(scene.add.container(v.w, 0).setDepth(c.depth + 1));
    band.add(scene.add.rectangle(v.x, b.y, v.w, b.h, Number(b.fill), b.alpha).setOrigin(0));
    this.portraitLayer = scene.add.container(0, 0);
    band.add(this.portraitLayer);
    band.add(scene.add.rectangle(v.x, b.y, v.w, b.edgeW, Number(b.edgeTop)).setOrigin(0));
    band.add(scene.add.rectangle(v.x, b.y + b.h - b.edgeW, v.w, b.edgeW, Number(b.edgeBottom)).setOrigin(0));
    const t = c.text;
    const name = scene.add.text(c.name.x, c.name.y, '', { fontFamily: ui.font, fontSize: `${c.name.fontSize}px`, color: c.name.color }).setOrigin(1, 0);
    const text = scene.add
      .text(t.x, t.y, '', { fontFamily: ui.font, fontSize: `${t.fontSize}px`, color: t.color, stroke: t.stroke, strokeThickness: t.strokeThickness, align: 'right', wordWrap: { width: t.wrap } })
      .setOrigin(1, 1);
    band.add([name, text]);

    playSfx(b.sfx);
    await this.tween(band, { x: 0 }, b.slideMs, 'Cubic.easeOut');

    const startedAt = performance.now();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      name.setText(line.speaker || '');
      this.showPortrait(line.portrait);
      scene.cutInState = { beat: i, portrait: line.portrait || null, text: line.text };
      await this.typeLine(text, line.text, startedAt);
    }

    scene.cutInState = null;
    scene.tweens.add({ targets: [dim, vig], alpha: 0, duration: b.outMs });
    await this.tween(band, { x: -v.w }, b.outMs, 'Cubic.easeIn');
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }

  // Types the line at charsPerSec; a tap completes it, a tap after that (or holdMs
  // from the line's start) moves on. Taps in the first inputDelayMs of the cut-in
  // are ignored (the tap that cast the Recollection). The clock is real time from
  // frame to frame (a slow frame doesn't slow the text; a pause, e.g. an app
  // switch, adds at most MAX_STEP_MS).
  typeLine(label, full, startedAt) {
    const scene = this.scene;
    const c = this.cfg;
    return new Promise((resolve) => {
      let elapsed = 0;
      let last = performance.now();
      let shown = 0;
      let done = false;
      label.setText('');
      const finish = () => {
        if (done) return;
        done = true;
        scene.events.off('update', tick);
        scene.input.off('pointerdown', onTap);
        scene.events.off('shutdown', finish);
        if (label.active) label.setText(full);
        resolve();
      };
      const tick = () => {
        const now = performance.now();
        elapsed += Math.min(MAX_STEP_MS, now - last);
        last = now;
        const n = Math.min(full.length, Math.floor((elapsed * c.text.charsPerSec) / 1000));
        if (n > shown) {
          shown = n;
          label.setText(full.slice(0, shown));
        }
        if (elapsed >= c.holdMs) finish();
      };
      const onTap = () => {
        if (performance.now() - startedAt < c.inputDelayMs) return;
        if (shown < full.length) {
          shown = full.length;
          elapsed = Math.max(elapsed, (full.length * 1000) / c.text.charsPerSec);
          label.setText(full);
          return;
        }
        finish();
      };
      scene.events.on('update', tick);
      scene.input.on('pointerdown', onTap);
      scene.events.once('shutdown', finish);
    });
  }

  // The line's portrait replaces the previous one with a short crossfade.
  showPortrait(key) {
    const scene = this.scene;
    const c = this.cfg;
    const p = c.portrait;
    const old = this.portraitLayer.list.slice();
    old.forEach((o) => scene.tweens.add({ targets: o, alpha: 0, duration: p.swapMs, onComplete: () => o.destroy() }));
    if (!key || !scene.textures.exists(key)) return;
    const top = c.band.y;
    const texture = scene.textures.get(key);
    const src = texture.getSourceImage();
    const img = scene.add.image(0, 0, key).setOrigin(0).setAlpha(0);
    if (texture.customData.aliasOf) {
      // A stand-in full-figure portrait: scaled up, cropped to a band-high window around the head.
      const f = p.fallback;
      const cropW = Math.min(src.width, p.w / 2 / f.scale);
      const cropX = Math.max(0, f.srcX - cropW / 2);
      img.setScale(f.scale).setPosition(f.x - f.srcX * f.scale, top - f.srcY * f.scale);
      img.setCrop(cropX, f.srcY, cropW, c.band.h / f.scale);
    } else {
      img.setDisplaySize(p.w, p.h).setPosition(p.x, top);
    }
    this.portraitLayer.add(img);
    scene.tweens.add({ targets: img, alpha: 1, duration: p.swapMs });
  }

  tween(target, props, duration, ease) {
    return new Promise((resolve) => this.scene.tweens.add({ targets: target, ...props, duration, ease, onComplete: resolve }));
  }
}
