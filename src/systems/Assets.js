import Phaser from 'phaser';
import manifest from '../data/assets.json';

// Asset loading by manifest section (assets.json: ui, cutscene, sprites,
// backgrounds, portraits, plus "sheets" = the sprite animation sets).
// The Loader scene (scenes/LoaderScene.js) loads sections one at a time in
// the background; each scene waits only for the sections it needs
// (assets.json loading.scenes) via whenReady().

const cfg = manifest.loading;

// Portraits are exported on this flat colour; the loader makes it transparent.
const PORTRAIT_KEY_RGB = [0xff, 0x00, 0xff];

export function sectionEntries(section) {
  return manifest[section] || {};
}

// Runs build() once the scene's sections are loaded: at once if they already
// are, otherwise after a short "Loading…" (shown only if the wait is
// noticeable). Nothing happens if the scene is stopped meanwhile.
export function whenReady(scene, build) {
  const sections = cfg.scenes[scene.scene.key] || [];
  const loader = scene.scene.get('Loader');
  if (!sections.length || !loader || loader.isReady(sections)) {
    build();
    return;
  }

  let cancelled = false;
  scene.events.once('shutdown', () => (cancelled = true));
  const ind = cfg.indicator;
  const text = scene.add
    .text(180, ind.y, ind.text, { fontFamily: ind.font, fontSize: `${ind.fontSize}px`, color: ind.color })
    .setOrigin(0.5)
    .setDepth(ind.depth)
    .setAlpha(0);
  scene.tweens.add({ targets: text, alpha: 1, delay: ind.delayMs, duration: ind.fadeMs });
  loader.request(sections).then(() => {
    if (cancelled) return;
    text.destroy();
    build();
  });
}

// After a section's files loaded: placeholders for missing files (unless the
// entry is optional), the magenta key for portraits, LINEAR filtering for
// illustrations (the game is pixelArt: true, so everything else stays NEAREST).
export function finishSection(scene, section) {
  const entries = sectionEntries(section);
  const linear = cfg.linear.includes(section);
  for (const [key, def] of Object.entries(entries)) {
    if (!scene.textures.exists(key)) {
      if (!def.optional) createPlaceholder(scene, key, def.w, def.h);
      continue;
    }
    if (section === 'portraits' && scene.textures.get(key).getSourceImage() instanceof HTMLImageElement) keyOutColor(scene, key, PORTRAIT_KEY_RGB);
    if (linear) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
}

export function isRealTexture(scene, key) {
  return scene.textures.exists(key) && !scene.textures.get(key).customData.placeholder;
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

export function createPlaceholder(scene, key, w, h) {
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

  texture.customData.placeholder = true;
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
