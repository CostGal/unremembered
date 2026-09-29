import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  init() {
    this.manifest = this.registry.get('manifest');
    this.animations = this.registry.get('animations') || {};
  }

  preload() {
    const entries = this.allEntries();

    for (const [key, def] of Object.entries(entries)) {
      this.load.image(key, `assets/${def.file}`);
    }

    for (const [key, def] of Object.entries(this.animations)) {
      const [frameWidth, frameHeight] = def.frame_size;
      this.load.spritesheet(key, `assets/${def.sheet}`, {
        frameWidth,
        frameHeight,
        endFrame: def.frames - 1,
      });
    }
  }

  create() {
    const entries = this.allEntries();

    // A failed load never reaches the texture cache — whatever the failure mode
    // (network 404, or a dev-server SPA fallback masking it as 200 HTML), a
    // missing texture at this point means the file needs a placeholder.
    for (const [key, def] of Object.entries(entries)) {
      if (!this.textures.exists(key)) createPlaceholder(this, key, def.w, def.h);
    }

    for (const [key, def] of Object.entries(this.animations)) {
      if (!this.textures.exists(key)) createPlaceholderSheet(this, key, def);
      createAnimation(this, key, def);
    }

    this.scene.start('Title');
  }

  allEntries() {
    const { sprites = {}, backgrounds = {}, ui = {} } = this.manifest;
    return { ...sprites, ...backgrounds, ...ui };
  }
}

function createPlaceholder(scene, key, w, h) {
  const texture = scene.textures.createCanvas(key, w, h);
  const ctx = texture.getContext();

  ctx.fillStyle = '#2a2d3a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#5a5f73';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  ctx.fillStyle = '#f1efe8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = Math.max(10, Math.floor(w / 10));
  ctx.font = `${fontSize}px monospace`;
  drawWrappedText(ctx, key, w / 2, h / 2, w - 12, fontSize + 2);

  texture.refresh();
}

// Same look as createPlaceholder, one labeled cell per frame, so a missing
// sheet still plays with the right frame count and timing.
function createPlaceholderSheet(scene, key, def) {
  const [w, h] = def.frame_size;
  const texture = scene.textures.createCanvas(key, w * def.frames, h);
  const ctx = texture.getContext();
  const fontSize = Math.max(10, Math.floor(w / 10));

  for (let i = 0; i < def.frames; i++) {
    const x = i * w;
    ctx.fillStyle = '#2a2d3a';
    ctx.fillRect(x, 0, w, h);
    ctx.strokeStyle = i === def.impactFrame ? '#3fd0c9' : i === def.windupFrame ? '#e0a040' : '#5a5f73';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, 1, w - 2, h - 2);

    ctx.fillStyle = '#f1efe8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${fontSize}px monospace`;
    drawWrappedText(ctx, `${key} ${i + 1}/${def.frames}`, x + w / 2, h / 2, w - 12, fontSize + 2);

    texture.add(i, 0, x, 0, w, h);
  }

  texture.refresh();
}

// durations_ms[i] is exactly how long frame i stays on screen (Phaser uses a
// frame's own duration in place of msPerFrame when it is set).
function createAnimation(scene, key, def) {
  const durations = def.durations_ms || [];
  if (durations.length !== def.frames) {
    console.warn(`animations.json: ${key} has ${def.frames} frames but ${durations.length} durations`);
  }

  const frames = [];
  for (let i = 0; i < def.frames; i++) {
    frames.push({ key, frame: i, duration: durations[Math.min(i, durations.length - 1)] });
  }

  scene.anims.create({ key, frames, repeat: def.loop ? -1 : 0 });
}

function drawWrappedText(ctx, text, cx, cy, maxWidth, lineHeight) {
  const words = text.split(/[_\s]+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}
