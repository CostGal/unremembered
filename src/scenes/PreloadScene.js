import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  init() {
    this.manifest = this.registry.get('manifest');
  }

  preload() {
    const entries = this.allEntries();

    for (const [key, def] of Object.entries(entries)) {
      this.load.image(key, `assets/${def.file}`);
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
