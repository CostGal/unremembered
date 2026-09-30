import Phaser from 'phaser';
import cutsceneOrigin from '../data/cutscene_origin.json';
import environments from '../data/environments.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import * as Fx from '../systems/Fx.js';

const cfg = ui.cutscene;
const CUTSCENES = { origin: cutsceneOrigin };

// Shot-by-shot cutscene (CLAUDE.md > Cutscene system). Each shot: a picture
// area (bg, optional split with bg2, cutout layers, a slow pan/zoom, tint,
// fx) and a typewritten line below it. Tap = finish the line / next shot;
// hold anywhere = skip the whole cutscene. Missing art = black + text + fx,
// so it plays with zero art.
export default class CutsceneScene extends Phaser.Scene {
  constructor() {
    super('Cutscene');
  }

  init(data) {
    this.done = false;
    this.typing = false;
    this.typeEvent = null;
    this.shotTimer = null;
    this.fxObjects = [];
    this.cutsceneId = data.id || 'origin';
    this.shots = (CUTSCENES[this.cutsceneId] || { shots: [] }).shots;
  }

  create() {
    playSceneMusic('Cutscene');
    this.cameras.main.setBackgroundColor(cfg.background);
    const a = cfg.area;
    this.area = { x: 0, y: a.y, w: 360, h: a.h };
    this.shotLayer = this.add.container(0, 0).setDepth(cfg.depth.picture);
    // Letterbox bars hide whatever a pan/zoom pushes outside the picture area.
    this.add.rectangle(0, 0, 360, a.y, 0x000000).setOrigin(0).setDepth(cfg.depth.bars);
    this.add.rectangle(0, a.y + a.h, 360, 640 - a.y - a.h, 0x000000).setOrigin(0).setDepth(cfg.depth.bars);

    this.text = this.add
      .text(180, cfg.text.y, '', {
        fontFamily: ui.font,
        fontSize: `${cfg.text.fontSize}px`,
        color: cfg.text.color,
        align: 'center',
        lineSpacing: cfg.text.lineSpacing,
        wordWrap: { width: cfg.text.wrap },
      })
      .setOrigin(0.5, 0)
      .setDepth(cfg.depth.text);

    this.skipHint = this.add
      .text(360 - cfg.skipHint.pad, 640 - cfg.skipHint.pad, cfg.skipHint.text, {
        fontFamily: ui.font,
        fontSize: `${cfg.skipHint.fontSize}px`,
        color: cfg.skipHint.color,
      })
      .setOrigin(1, 1)
      .setDepth(cfg.depth.text);
    this.tweens.add({ targets: this.skipHint, alpha: 0, delay: cfg.skipHint.showMs, duration: cfg.skipHint.fadeMs });

    this.holdRing = this.add.graphics().setDepth(cfg.depth.hold);
    this.setupInput();

    this.index = -1;
    this.nextShot();
  }

  // ---------- Input: tap / hold-to-skip ----------

  setupInput() {
    this.holdStart = null;
    this.input.on('pointerdown', (pointer) => {
      this.holdStart = performance.now();
      this.holdPos = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', () => {
      if (this.holdStart === null) return;
      this.holdStart = null;
      this.holdRing.clear();
      this.onTap();
    });
    this.events.on('update', () => this.updateHold());
  }

  updateHold() {
    if (this.holdStart === null || this.done) return;
    const t = (performance.now() - this.holdStart) / cfg.hold.ms;
    const { x, y } = this.holdPos;
    const g = this.holdRing;
    g.clear();
    if (t < cfg.hold.showAfter) return;
    g.lineStyle(cfg.hold.width, Number(cfg.hold.bgColor), cfg.hold.bgAlpha);
    g.strokeCircle(x, y, cfg.hold.radius);
    g.lineStyle(cfg.hold.width, Number(cfg.hold.color), 1);
    g.beginPath();
    g.arc(x, y, cfg.hold.radius, -Math.PI / 2, -Math.PI / 2 + Math.min(1, t) * Math.PI * 2);
    g.strokePath();
    if (t >= 1) {
      this.holdStart = null;
      g.clear();
      this.finish();
    }
  }

  onTap() {
    if (this.done) return;
    if (this.typing) this.completeText();
    else this.nextShot();
  }

  // ---------- Shots ----------

  nextShot() {
    this.index += 1;
    const shot = this.shots[this.index];
    if (!shot) {
      this.finish();
      return;
    }
    this.playShot(shot);
  }

  playShot(shot) {
    if (this.shotTimer) this.shotTimer.remove();
    this.tweens.killTweensOf(this.shotLayer.list);
    this.shotLayer.removeAll(true);
    for (const e of this.fxObjects || []) e.destroy();
    this.fxObjects = [];

    const duration = shot.durationMs || cfg.defaultDurationMs;
    const stage = this.add.container(180, this.area.y + this.area.h / 2);
    this.shotLayer.add(stage);

    const split = shot.split || 'none';
    if (split === 'none') {
      this.addPicture(stage, shot.bg, 0, 0, this.area.w, this.area.h, shot.tint);
    } else {
      const vertical = split === 'vertical';
      const w = vertical ? this.area.w / 2 : this.area.w;
      const h = vertical ? this.area.h : this.area.h / 2;
      const dx = vertical ? w / 2 : 0;
      const dy = vertical ? 0 : h / 2;
      this.addPicture(stage, shot.bg, -dx, -dy, w, h, shot.tint);
      this.addPicture(stage, shot.bg2, dx, dy, w, h, shot.tint);
      const line = this.add.rectangle(0, 0, vertical ? cfg.splitLine : this.area.w, vertical ? this.area.h : cfg.splitLine, Number(cfg.splitColor));
      stage.add(line);
    }

    const layers = (shot.layers || []).map((l) => this.addLayer(stage, l, shot.tint)).filter(Boolean);

    this.applyMove(stage, shot.move, duration);
    for (const fx of shot.fx || []) this.applyFx(fx, stage, layers, duration, shot);

    this.typeText(shot.text || '');
    this.shotTimer = this.time.delayedCall(duration, () => {
      if (this.typing) this.completeText();
      this.nextShot();
    });
  }

  hasArt(key) {
    return !!key && this.textures.exists(key) && !this.textures.get(key).customData.placeholder;
  }

  // Fills a w×h cell centred at (x, y) with the image (cover), clipped to
  // the cell. Missing art leaves the cell black.
  addPicture(stage, key, x, y, w, h, tint) {
    if (!this.hasArt(key)) return null;
    const img = this.add.image(x, y, key);
    img.setScale(Math.max(w / img.width, h / img.height));
    if (tint) img.setTint(Number(tint));
    if (w < this.area.w || h < this.area.h) {
      const shape = this.make.graphics({}, false).fillRect(180 + x - w / 2, this.area.y + this.area.h / 2 + y - h / 2, w, h);
      img.setMask(shape.createGeometryMask());
    }
    stage.add(img);
    return img;
  }

  // layer = {img, x, y (0–1 within the picture area), scale}
  addLayer(stage, layer, tint) {
    if (!this.hasArt(layer.img)) return null;
    const x = (layer.x - 0.5) * this.area.w;
    const y = (layer.y - 0.5) * this.area.h;
    const img = this.add.image(x, y, layer.img).setScale(layer.scale || 1);
    if (layer.flip) img.setFlipX(true);
    if (tint) img.setTint(Number(tint));
    stage.add(img);
    return img;
  }

  applyMove(stage, move, duration) {
    const m = cfg.move;
    if (move === 'pan_left' || move === 'pan_right') {
      const dir = move === 'pan_left' ? -1 : 1;
      stage.setScale(m.panScale);
      stage.x = 180 - dir * m.panPx;
      this.tweens.add({ targets: stage, x: 180 + dir * m.panPx, duration, ease: 'Sine.easeInOut' });
    } else if (move === 'zoom_in') {
      this.tweens.add({ targets: stage, scale: m.zoomScale, duration, ease: 'Sine.easeInOut' });
    } else if (move === 'zoom_out') {
      stage.setScale(m.zoomScale);
      this.tweens.add({ targets: stage, scale: 1, duration, ease: 'Sine.easeInOut' });
    }
  }

  applyFx(fx, stage, layers, duration, shot) {
    const f = cfg.fx;
    const area = this.area;
    const keep = (obj) => {
      this.fxObjects.push(obj);
      return obj;
    };

    if (fx === 'flash') {
      Fx.screenFlash(this, f.flash, cfg.depth.fx);
    } else if (fx === 'rain') {
      for (const e of Fx.rain(this, environments.street_rain.rain, area)) keep(e.setDepth(cfg.depth.fx));
    } else if (fx === 'crystal_particles' || fx === 'embers') {
      const p = f[fx];
      const emitter = this.add.particles(0, 0, sparkTexture(this, p.size), {
        x: { min: 0, max: area.w },
        y: { min: area.y + area.h * p.spawnTop, max: area.y + area.h },
        speedY: { min: -p.speed[1], max: -p.speed[0] },
        speedX: { min: -p.drift, max: p.drift },
        lifespan: p.lifeMs,
        alpha: { start: p.alpha, end: 0 },
        tint: p.colors.map(Number),
        frequency: p.frequency,
        maxAliveParticles: p.max,
      });
      keep(emitter.setDepth(cfg.depth.fx));
    } else if (fx === 'lights_out') {
      const dark = keep(this.add.rectangle(180, area.y + area.h / 2, area.w, area.h, 0x000000, 0).setDepth(cfg.depth.fx));
      this.tweens.add({ targets: dark, fillAlpha: 1, delay: duration * f.lights_out.startPct, duration: f.lights_out.ms, ease: 'Stepped', easeParams: [f.lights_out.steps] });
    } else if (fx === 'dissolve_layer') {
      this.tweens.add({ targets: layers, alpha: 0, delay: duration * f.dissolve_layer.startPct, duration: f.dissolve_layer.ms, ease: 'Stepped', easeParams: [f.dissolve_layer.steps] });
    } else if (fx === 'eyes_glow') {
      for (const [ex, ey] of shot.eyes || f.eyes_glow.at) {
        const glow = keep(
          this.add
            .image((ex - 0.5) * area.w + 180, area.y + ey * area.h, Fx.glowTexture(this, f.eyes_glow.radius))
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(Number(f.eyes_glow.color))
            .setAlpha(0)
            .setDepth(cfg.depth.fx)
        );
        this.tweens.add({ targets: glow, alpha: f.eyes_glow.alpha, delay: f.eyes_glow.delayMs, duration: f.eyes_glow.ms, yoyo: true, hold: duration, ease: 'Sine.easeIn' });
      }
    }
  }

  // ---------- Text ----------

  typeText(text) {
    this.fullText = text;
    this.shown = 0;
    this.text.setText('');
    this.typing = text.length > 0;
    if (this.typeEvent) this.typeEvent.remove();
    if (!this.typing) return;
    this.typeEvent = this.time.addEvent({
      delay: 1000 / ui.dialogue.charsPerSec,
      loop: true,
      callback: () => {
        this.shown += 1;
        this.text.setText(this.fullText.slice(0, this.shown));
        if (this.shown >= this.fullText.length) this.completeText();
      },
    });
  }

  completeText() {
    if (this.typeEvent) this.typeEvent.remove();
    this.typeEvent = null;
    this.text.setText(this.fullText);
    this.typing = false;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.cameras.main.fadeOut(cfg.fadeOutMs, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const runner = this.registry.get('runner');
      if (runner) runner.next(this);
      else this.scene.start('Title');
    });
  }
}

function sparkTexture(scene, size) {
  const key = `fx_spark_${size}`;
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, size, size);
    const ctx = texture.getContext();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    texture.refresh();
  }
  return key;
}
