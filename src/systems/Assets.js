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
// Entry fields that shape a missing file:
//   placeholder {tint, label, shape, labelY?}  an intentional, tinted placeholder
//                                              (see createPlaceholder) instead of the grey box
//   fallback "<key>"                           a missing file points at that texture instead
//   alias "<key>"                              no file at all: the key is another key's texture
export function finishSection(scene, section) {
  const entries = sectionEntries(section);
  const linear = cfg.linear.includes(section);
  for (const [key, def] of Object.entries(entries)) {
    if (def.alias) continue; // second pass: targets are final by then
    if (!scene.textures.exists(key)) {
      if (def.fallback) continue;
      if (!def.optional) createPlaceholder(scene, key, def.w, def.h, def.placeholder, linear);
      continue;
    }
    if (section === 'portraits' && scene.textures.get(key).getSourceImage() instanceof HTMLImageElement) keyOutColor(scene, key, PORTRAIT_KEY_RGB);
    if (linear) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
  for (const [key, def] of Object.entries(entries)) {
    const target = def.alias || (!scene.textures.exists(key) && def.fallback);
    if (!target || scene.textures.exists(key)) continue;
    if (scene.textures.exists(target)) shareTexture(scene, key, target, linear);
    else if (!def.optional) createPlaceholder(scene, key, def.w, def.h, def.placeholder, linear);
  }
}

// `key` becomes another texture's picture (an alias, or a fallback for a file
// that has not been uploaded yet). Same pixels, its own texture entry.
function shareTexture(scene, key, target, linear) {
  const source = scene.textures.get(target);
  const image = source.getSourceImage();
  const texture = image instanceof HTMLCanvasElement ? scene.textures.addCanvas(key, image) : scene.textures.addImage(key, image);
  if (!texture) return;
  texture.customData.placeholder = !!source.customData.placeholder;
  texture.customData.intentional = !!source.customData.intentional;
  texture.customData.aliasOf = target;
  if (linear) texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

// An entry's definition with an alias resolved: the target's fields (size,
// displayHeight, faces) under the alias entry's own.
export function manifestDef(section, key) {
  const def = sectionEntries(section)[key];
  if (!def?.alias) return def;
  const { alias, ...own } = def;
  return { ...sectionEntries(section)[alias], ...own, aliasOf: alias };
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

// A stand-in for a missing file. With a `placeholder` spec (assets.json) it is
// an intentional one: the tint as a panel, a soft dark vignette, a simple
// silhouette per shape and a small label (shape: figure = a standing figure,
// room = floor line + door, street = horizon + two teal lanterns, band|none =
// plain). Large pictures are drawn at reduced size (loading.placeholder.maxPixels);
// scenes size them from the texture, so that is invisible. Without a spec it
// is the plain grey box with the key. customData.placeholder is true for both;
// customData.intentional only for the first (cutscenes draw those, not the grey).
export function createPlaceholder(scene, key, w, h, spec = null, linear = false) {
  const p = cfg.placeholder || {};
  const k = spec ? Math.min(1, Math.sqrt((p.maxPixels || w * h) / (w * h))) : 1;
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const texture = scene.textures.createCanvas(key, cw, ch);
  const ctx = texture.getContext();

  if (spec) {
    drawIntentional(ctx, cw, ch, spec, p);
    texture.customData.intentional = true;
    if (linear) texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  } else {
    ctx.fillStyle = '#2a2d3a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#5a5f73';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cw - 2, ch - 2);

    ctx.fillStyle = '#f1efe8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.max(10, Math.floor(cw / 10));
    ctx.font = `${fontSize}px monospace`;
    const lineHeight = fontSize + 2;
    const lines = wrapLines(ctx, key, cw - 12);
    const startY = ch / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cw / 2, startY + i * lineHeight));
  }

  texture.customData.placeholder = true;
  texture.refresh();
}

function cssColor(value) {
  return `#${(Number(value) & 0xffffff).toString(16).padStart(6, '0')}`;
}

function drawIntentional(ctx, w, h, spec, p) {
  ctx.fillStyle = cssColor(spec.tint ?? 0x1a2238);
  ctx.fillRect(0, 0, w, h);

  // Vignette: clear in the middle, dark in the corners.
  const cx = w / 2;
  const cy = h * 0.45;
  const vignette = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, Math.hypot(w, h) * 0.55);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, `rgba(0,0,0,${p.vignetteAlpha ?? 0.55})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  const dark = p.silhouetteColor || 'rgba(5,7,14,0.6)';
  const line = p.lineColor || 'rgba(241,239,232,0.22)';
  if (spec.shape === 'figure') {
    // A dark standing figure, centred: head, shoulders, a tapering body, a ground shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.83, w * 0.17, h * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(cx, h * 0.52, w * 0.065, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.1, h * 0.585);
    ctx.quadraticCurveTo(cx, h * 0.555, cx + w * 0.1, h * 0.585);
    ctx.lineTo(cx + w * 0.15, h * 0.83);
    ctx.lineTo(cx - w * 0.15, h * 0.83);
    ctx.closePath();
    ctx.fill();
  } else if (spec.shape === 'room') {
    // A floor line and a door.
    const floor = h * 0.74;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, floor, w, h - floor);
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, w / 360);
    ctx.beginPath();
    ctx.moveTo(0, floor);
    ctx.lineTo(w, floor);
    ctx.stroke();
    const dw = w * 0.26;
    const dh = h * 0.34;
    ctx.fillStyle = dark;
    ctx.fillRect(cx - dw / 2, floor - dh, dw, dh);
    ctx.strokeRect(cx - dw / 2, floor - dh, dw, dh);
    ctx.fillStyle = line;
    ctx.fillRect(cx + dw * 0.28, floor - dh * 0.52, Math.max(2, w * 0.012), dh * 0.12);
  } else if (spec.shape === 'street') {
    // A horizon and two teal lanterns on posts.
    const horizon = h * 0.62;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, w / 360);
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();
    const lantern = p.lanternColor || '#3fd0c9';
    for (const x of [0.28, 0.72]) {
      const px = w * x;
      const top = h * 0.4;
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(2, w * 0.012);
      ctx.beginPath();
      ctx.moveTo(px, horizon + h * 0.04);
      ctx.lineTo(px, top);
      ctx.stroke();
      const glow = ctx.createRadialGradient(px, top, 0, px, top, w * 0.09);
      glow.addColorStop(0, 'rgba(63,208,201,0.45)');
      glow.addColorStop(1, 'rgba(63,208,201,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px - w * 0.09, top - w * 0.09, w * 0.18, w * 0.18);
      ctx.fillStyle = lantern;
      ctx.beginPath();
      ctx.arc(px, top, Math.max(3, w * 0.018), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The label: small, off-white (a shadow keeps it readable on any tint). It sits in the upper
  // third by default (loading.placeholder.labelY): the cutscene and dialogue overlays darken the bottom.
  if (spec.label) {
    const fontSize = Math.max(9, Math.round(w / 26));
    ctx.font = `${fontSize}px ${p.font || 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = Math.round(fontSize * 1.3);
    const lines = wrapLines(ctx, spec.label, w - w * 0.16);
    const lastY = h * (spec.labelY ?? p.labelY ?? 0.33) - lineHeight / 2;
    ctx.globalAlpha = p.labelAlpha ?? 0.85;
    lines.forEach((l, i) => {
      const y = lastY - (lines.length - 1 - i) * lineHeight;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(l, cx + 1, y + 1);
      ctx.fillStyle = p.labelColor || '#f1efe8';
      ctx.fillText(l, cx, y);
    });
    ctx.globalAlpha = 1;
  }
}

function wrapLines(ctx, text, maxWidth) {
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
  return lines;
}
