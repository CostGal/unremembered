import Phaser from 'phaser';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import { queueSheets, buildAnimations } from '../systems/SpriteAnims.js';
import { isAnimTest } from './AnimTestScene.js';
import { devBattleId } from './BattleScene.js';

// Portraits are exported on this flat colour; the loader makes it transparent.
const PORTRAIT_KEY_RGB = [0xff, 0x00, 0xff];

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  init() {
    this.manifest = this.registry.get('manifest');
    this.animationSets = this.registry.get('animationSets') || {};
  }

  preload() {
    const entries = this.allEntries();

    for (const [key, def] of Object.entries(entries)) {
      this.load.image(key, `assets/${def.file}`);
    }

    queueSheets(this.load, this.animationSets);
  }

  create() {
    const entries = this.allEntries();

    // A failed load never reaches the texture cache — whatever the failure mode
    // (network 404, or a dev-server SPA fallback masking it as 200 HTML), a
    // missing texture at this point means the file needs a placeholder.
    for (const [key, def] of Object.entries(entries)) {
      if (!this.textures.exists(key)) createPlaceholder(this, key, def.w, def.h);
    }

    for (const key of Object.keys(this.manifest.portraits || {})) {
      if (this.textures.get(key).getSourceImage() instanceof HTMLImageElement) keyOutColor(this, key, PORTRAIT_KEY_RGB);
    }

    buildAnimations(this, this.animationSets, { ...characters, ...enemies });

    const battleId = devBattleId();
    if (isAnimTest()) this.scene.start('AnimTest');
    else if (battleId) this.scene.start('Battle', { battleId });
    else this.scene.start('Title');
  }

  allEntries() {
    const { sprites = {}, portraits = {}, backgrounds = {}, ui = {} } = this.manifest;
    return { ...sprites, ...portraits, ...backgrounds, ...ui };
  }
}

// Pixel pass: every fully opaque pixel of exactly this colour becomes
// transparent. Only opaque ones: portraits that arrive already transparent keep
// a few alpha-1 magenta fringe pixels from their own keying, and those must
// stay as they are. With nothing to key, the texture is left as loaded.
function keyOutColor(scene, key, [r, g, b]) {
  const image = scene.textures.get(key).getSourceImage();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  let keyed = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 255 && d[i] === r && d[i + 1] === g && d[i + 2] === b) {
      d[i + 3] = 0;
      keyed += 1;
    }
  }
  if (keyed === 0) return;

  ctx.putImageData(pixels, 0, 0);
  scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
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
