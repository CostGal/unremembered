import Phaser from 'phaser';
import cutsceneOrigin from '../data/cutscene_origin.json';
import environments from '../data/environments.json';
import { addPauseButton } from '../systems/PauseButton.js';
import ui from '../data/ui.json';
import { playAmbience, playSceneMusic, playSfx } from '../systems/Audio.js';
import * as Fx from '../systems/Fx.js';
import { whenReady } from '../systems/Assets.js';
import { devInt } from '../systems/DevParams.js';
import { VIEW, rect as viewRect } from '../systems/View.js';

const cfg = ui.cutscene;
const CUTSCENES = { origin: cutsceneOrigin };

// Shot-by-shot cutscene (CLAUDE.md > Cutscene system). Each shot: a picture
// area (bg, optional split with bg2, cutout layers, a slow pan/zoom, tint,
// fx) and a typewritten line below it. Tap = finish the line / next shot;
// hold anywhere = skip the whole cutscene. Missing art = black + text + fx,
// so it plays with zero art. The picture fills the screen (9:16 illustrations);
// the line sits on a dark gradient at the bottom. ?cutscene=origin&shot=N
// (1-based, as numbered in docs/STORY.md) starts at shot N (dev).
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
    this.firstShot = Math.max(1, Math.min(this.shots.length, data.shot ?? devInt('shot') ?? 1)) - 1;
  }

  // Waits for this scene's assets (loaded in the background by the Loader).
  create() {
    whenReady(this, () => this.build());
  }

  build() {
    playSceneMusic('Cutscene');
    this.cameras.main.setBackgroundColor(cfg.background);
    const a = cfg.area;
    const view = viewRect();
    // The picture area spans the whole visible width (wider than 360 on some phones).
    this.area = { x: view.x, y: a.y, w: view.w, h: a.h };
    this.shotLayer = this.add.container(0, 0).setDepth(cfg.depth.picture);
    // Letterbox bars hide whatever a pan/zoom pushes outside a smaller picture area.
    if (a.y > 0) this.add.rectangle(view.x, 0, view.w, a.y, 0x000000).setOrigin(0).setDepth(cfg.depth.bars);
    if (a.y + a.h < 640) this.add.rectangle(view.x, a.y + a.h, view.w, 640 - a.y - a.h, 0x000000).setOrigin(0).setDepth(cfg.depth.bars);
    // The line stays readable over any picture.
    const g = cfg.gradient;
    this.add.image(view.x, g.y, Fx.gradientTexture(this, view.w, 640 - g.y, g.color, g.alpha)).setOrigin(0).setDepth(g.depth);

    // A faint panel behind the line, sized to each shot's full text.
    const p = cfg.panel;
    this.textPanel = this.add
      .rectangle(180, cfg.text.y, p.minW, 0, Number(p.fill), p.alpha)
      .setOrigin(0.5, 0)
      .setStrokeStyle(1, Number(p.stroke), p.strokeAlpha)
      .setDepth(cfg.depth.text - 1)
      .setVisible(false);
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
      .text(360 - cfg.skipHint.pad, cfg.skipHint.y ?? 640 - cfg.skipHint.pad, cfg.skipHint.text, {
        fontFamily: ui.font,
        fontSize: `${cfg.skipHint.fontSize}px`,
        color: cfg.skipHint.color,
      })
      .setOrigin(1, 1)
      .setDepth(cfg.depth.text);
    this.tweens.add({ targets: this.skipHint, alpha: 0, delay: cfg.skipHint.showMs, duration: cfg.skipHint.fadeMs });

    this.holdRing = this.add.graphics().setDepth(cfg.depth.hold);
    this.setupInput();
    addPauseButton(this);

    this.index = this.firstShot - 1;
    this.nextShot();
  }

  // ---------- Input: tap / hold-to-skip ----------

  setupInput() {
    this.holdStart = null;
    this.input.on('pointerdown', (pointer) => {
      this.holdStart = performance.now();
      this.holdPos = { x: pointer.worldX, y: pointer.worldY };
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

  // Art that may not be delivered yet (data/cutscene_*.json):
  //   bgFallback / bg2Fallback  the key drawn when bg / bg2 is not real art (file missing,
  //                             or only a placeholder); null = no picture (black, layers + fx still play)
  //   whenArt                   fields merged over the shot when bg IS real art
  //                             (the delivered illustration replaces the split / cutouts / tint)
  // The shot's ambience follows the fallback key either way (ambienceBg).
  resolveShot(shot) {
    if (shot.bg === undefined || shot.bg === null) return shot;
    const real = (key) => !!key && this.textures.exists(key) && !this.textures.get(key).customData.placeholder;
    const ambienceBg = shot.ambienceBg ?? shot.bgFallback ?? shot.bg;
    if (real(shot.bg)) return { ...shot, ...shot.whenArt, ambienceBg };
    const out = { ...shot, ambienceBg };
    if (shot.bgFallback !== undefined) out.bg = shot.bgFallback;
    if (shot.bg2Fallback !== undefined && !real(shot.bg2)) out.bg2 = shot.bg2Fallback;
    return out;
  }

  playShot(rawShot) {
    const shot = this.resolveShot(rawShot);
    if (this.shotTimer) this.shotTimer.remove();
    this.tweens.killTweensOf(this.shotLayer.list);
    this.shotLayer.removeAll(true);
    for (const e of this.fxObjects || []) e.destroy();
    this.fxObjects = [];

    const duration = shot.durationMs || cfg.defaultDurationMs;
    const stage = this.add.container(180, this.area.y + this.area.h / 2);
    this.shotLayer.add(stage);

    const split = shot.split || 'none';
    this.picture = null;
    if (split === 'none') {
      this.picture = this.addPicture(stage, shot.bg, 0, 0, this.area.w, this.area.h, shot.tint, shot.bgView);
    } else {
      const vertical = split === 'vertical';
      const w = vertical ? this.area.w / 2 : this.area.w;
      const h = vertical ? this.area.h : this.area.h / 2;
      const dx = vertical ? w / 2 : 0;
      const dy = vertical ? 0 : h / 2;
      this.picture = this.addPicture(stage, shot.bg, -dx, -dy, w, h, shot.tint, shot.bgView);
      this.addPicture(stage, shot.bg2, dx, dy, w, h, shot.tint, shot.bg2View);
      const line = this.add.rectangle(0, 0, vertical ? cfg.splitLine : this.area.w, vertical ? this.area.h : cfg.splitLine, Number(cfg.splitColor));
      stage.add(line);
    }

    const layers = (shot.layers || []).map((l) => this.addLayer(stage, l, shot.tint)).filter(Boolean);

    this.applyMove(stage, shot.move, duration);
    for (const fx of shot.fx || []) this.applyFx(fx, stage, layers, duration, shot);
    // Sound: the shot's own sfx, else the first of its fx that has one (ui.json fxSfx).
    const sfx = shot.sfx !== undefined ? shot.sfx : (shot.fx || []).map((fx) => cfg.fxSfx[fx]).find(Boolean);
    if (sfx) playSfx(sfx);
    playAmbience(this.shotAmbience(shot));

    this.typeText(shot.text || '');
    this.shotTimer = this.time.delayedCall(duration, () => {
      if (this.typing) this.completeText();
      this.nextShot();
    });
  }

  // The shot's ambience bed (audio.json ambience.beds): its own "ambience"
  // (null = silence) if set; silence on the Hush (cfg.silentFx); rain on
  // rain shots; else the default for its background (cfg.ambienceByBg).
  shotAmbience(shot) {
    if (shot.ambience !== undefined) return shot.ambience;
    const fx = shot.fx || [];
    if (fx.some((f) => cfg.silentFx.includes(f))) return null;
    if (fx.includes('rain')) return cfg.rainAmbience;
    return cfg.ambienceByBg[shot.ambienceBg ?? shot.bg] ?? null;
  }

  // Real art, or an intentional placeholder (assets.json "placeholder": a tinted
  // panel with a label). The plain grey placeholder of an unregistered file is not art.
  hasArt(key) {
    if (!key || !this.textures.exists(key)) return false;
    const data = this.textures.get(key).customData;
    return !data.placeholder || !!data.intentional;
  }

  // Fills a w×h cell centred at (x, y) with the image (cover, never contain),
  // clipped to the cell. Missing art leaves the cell black. Pixel-art
  // backgrounds (small textures) scale by whole numbers so the pixels stay even.
  // view = {focus: [x, y], zoom}: the 0–1 image point shown at the cell
  // centre, and a multiplier on the cover scale (used to frame a cutout).
  // The image is scaled up as far as the focus needs so that it still covers
  // the cell, and its position is clamped so no cell edge is ever left black.
  addPicture(stage, key, x, y, w, h, tint, view) {
    if (!this.hasArt(key)) return null;
    const img = this.add.image(x, y, key);
    let cover = Math.max(w / img.width, h / img.height);
    const focus = view?.focus ? view.focus.map((f) => Phaser.Math.Clamp(f, cfg.focusMin, 1 - cfg.focusMin)) : null;
    if (focus) {
      // Centring the focus point needs (focus and 1 - focus) × the image to reach the cell edges.
      cover = Math.max(cover, w / 2 / (Math.min(focus[0], 1 - focus[0]) * img.width), h / 2 / (Math.min(focus[1], 1 - focus[1]) * img.height));
    }
    const pixelArt = img.width <= cfg.pixelArtMaxW && !this.textures.get(key).customData.intentional;
    const scale = (pixelArt ? Math.ceil(cover) : cover) * (view?.zoom || 1);
    img.setScale(scale);
    if (focus) img.setPosition(x + (0.5 - focus[0]) * img.displayWidth, y + (0.5 - focus[1]) * img.displayHeight);
    // Cover guard: whatever the focus asked for, the image never leaves a gap.
    const slackX = Math.max(0, (img.displayWidth - w) / 2);
    const slackY = Math.max(0, (img.displayHeight - h) / 2);
    img.setPosition(Phaser.Math.Clamp(img.x, x - slackX, x + slackX), Phaser.Math.Clamp(img.y, y - slackY, y + slackY));
    if (tint) img.setTint(Number(tint));
    if (w < this.area.w || h < this.area.h) {
      const shape = this.make.graphics({}, false).fillRect(180 + x - w / 2, this.area.y + this.area.h / 2 + y - h / 2, w, h);
      img.setMask(shape.createGeometryMask());
    }
    stage.add(img);
    img.cell = { x, y, w, h };
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
      for (const e of Fx.rain(this, environments.street_rain.rain, area, { fill: true })) keep(e.setDepth(cfg.depth.fx));
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
      this.eyesGlow(stage, shot, f.eyes_glow);
    }
  }

  // The eyes light up teal: per eye a soft halo plus a bright almond-shaped
  // iris (both additive), rising over `ms` after `delayMs`, then breathing
  // slowly. Eye points are 0–1 positions on the shot's main picture (shot.eyes
  // or the fx defaults), so they land on the art whatever the picture's scale,
  // and they sit in the stage so they follow its pan/zoom.
  eyesGlow(stage, shot, e) {
    const pic = this.picture;
    const toStage = ([ex, ey]) =>
      pic
        ? [pic.x - pic.displayWidth / 2 + ex * pic.displayWidth, pic.y - pic.displayHeight / 2 + ey * pic.displayHeight]
        : [(ex - 0.5) * this.area.w, (ey - 0.5) * this.area.h];
    // Sizes are in picture pixels at scale 1 for a 360-wide picture; scale with it.
    const unit = pic ? pic.displayWidth / VIEW.designW : 1;
    const halo = Fx.glowTexture(this, e.halo.radius);
    const iris = irisTexture(this, e.iris.w, e.iris.h);
    const parts = [];
    for (const point of shot.eyes || e.at) {
      const [x, y] = toStage(point);
      const h = this.add.image(x, y, halo).setBlendMode(Phaser.BlendModes.ADD).setTint(Number(e.halo.color)).setAlpha(0).setScale(unit);
      const i = this.add.image(x, y, iris).setBlendMode(Phaser.BlendModes.ADD).setTint(Number(e.iris.color)).setAlpha(0).setScale(unit);
      stage.add([h, i]);
      parts.push({ h, i });
    }
    this.fxObjects.push(...parts.flatMap((p) => [p.h, p.i]));
    const onLit = () => {
      // A short flare when the glow has risen, then a slow breath for the rest of the shot.
      Fx.screenFlash(this, e.flare, cfg.depth.fx);
      for (const p of parts) {
        this.tweens.add({ targets: p.h, alpha: e.halo.alpha * e.breathe.min, duration: e.breathe.ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: p.i, alpha: e.iris.alpha * e.breathe.min, duration: e.breathe.ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    };
    for (const [k, p] of parts.entries()) {
      this.tweens.add({ targets: p.i, alpha: e.iris.alpha, delay: e.delayMs, duration: e.ms, ease: 'Sine.easeIn', onComplete: k === 0 ? onLit : null });
      this.tweens.add({ targets: p.h, alpha: e.halo.alpha, delay: e.delayMs + e.halo.lagMs, duration: e.ms, ease: 'Sine.easeIn' });
    }
  }

  // ---------- Text ----------

  typeText(text) {
    this.fullText = text;
    this.shown = 0;
    // Measure the whole line once, so the panel doesn't grow while typing.
    this.text.setText(text);
    const p = cfg.panel;
    this.textPanel.setVisible(text.length > 0);
    this.textPanel.setSize(Math.max(p.minW, this.text.width + p.padX * 2), this.text.height + p.padY * 2);
    this.textPanel.setPosition(180, cfg.text.y - p.padY);
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
    playAmbience(null);
    this.cameras.main.fadeOut(cfg.fadeOutMs, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const runner = this.registry.get('runner');
      if (runner) runner.next(this);
      else this.scene.start('Title');
    });
  }
}

// A soft almond: bright in the middle, fading to the points (the lit iris).
function irisTexture(scene, w, h) {
  const key = `fx_iris_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h);
  const ctx = texture.getContext();
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    const t = 1 - i / bands;
    ctx.fillStyle = `rgba(255,255,255,${1 / bands})`;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, (w / 2) * t, (h / 2) * t, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
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
