// The battle's picture, in two layers (ui.json `battleBackdrop`):
//   backdrop  the full 360x640 screen: a muted, slowly drifting illustration (the HUD and the
//             commands sit on it as dark glass), with a little ambient motion (fog bands, pulsing
//             window glows; assets.json `ambient`) under the rain.
//   platform  the vivid strip the fighters stand on (platform_street / platform_office, else a
//             code-drawn cobble / plank band).
// The picture is desaturated and darkened once per use by a canvas pixel pass into a derived
// texture `<key>__battle` (cached). Illustrations arrive as 720x1280 and the pass shrinks them by
// the entry's `displayScale` (0.5) while it draws them, which doubles as the slight blur; a
// missing file falls back to the old 360x360 pixel-art street (environments.json `fallbackBg`).
import Phaser from 'phaser';
import ui from '../data/ui.json';
import * as Fx from './Fx.js';
import { isRealTexture, manifestDef } from './Assets.js';
import { rect as viewRect } from './View.js';

const cfg = ui.battleBackdrop;
const layout = ui.battleLayout;

// Dev/QA read this: how the last backdrop was built.
export const lastBuild = { key: null, source: null, ms: 0, passMs: 0, drawMs: 0, objects: 0 };

// The texture to paint for a battle: its own key if a real file arrived, else the env's fallback.
export function pickKey(scene, key, env) {
  if (isRealTexture(scene, key)) return key;
  const fallback = env?.fallbackBg;
  return fallback && isRealTexture(scene, fallback) ? fallback : null;
}

// `<key>__battle`: the picture shrunk by displayScale, desaturated and darkened. Cached per texture manager.
export function derivedTexture(scene, key) {
  const out = `${key}__battle`;
  if (scene.textures.exists(out)) return out;
  const t0 = performance.now();
  const def = manifestDef('backgrounds', key) || {};
  const source = scene.textures.get(key).getSourceImage();
  const k = def.displayScale ?? 1;
  const w = Math.max(1, Math.round(source.width * k));
  const h = Math.max(1, Math.round(source.height * k));
  // Its own canvas with the read-back hint: the pixel pass below reads and rewrites every pixel.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  lastBuild.drawMs = performance.now() - t0;

  const sat = 1 - (def.desaturate ?? cfg.desaturate);
  const keep = 1 - cfg.darken;
  const pixels = ctx.getImageData(0, 0, w, h);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = (luma + (r - luma) * sat) * keep;
    d[i + 1] = (luma + (g - luma) * sat) * keep;
    d[i + 2] = (luma + (b - luma) * sat) * keep;
  }
  ctx.putImageData(pixels, 0, 0);
  scene.textures.addCanvas(out, canvas).setFilter(Phaser.Textures.FilterMode.LINEAR);
  lastBuild.passMs = performance.now() - t0;
  return out;
}

// Builds the whole backdrop for a battle def: picture (+ drift, + b1's `bgShift`), ambient motion, HUD glass.
// Returns {container, key, source}.
export function createBackdrop(scene, battleDef, env) {
  const t0 = performance.now();
  lastBuild.passMs = 0;
  const view = viewRect();
  const source = pickKey(scene, battleDef.bg, env);
  const container = scene.add.container(0, 0).setDepth(cfg.depth);
  let picture = null;
  let objects = 0;

  if (source) {
    const tex = derivedTexture(scene, source);
    const frame = scene.textures.get(tex).getSourceImage();
    const tall = frame.height >= cfg.tallMinH;
    // Tall illustration: cover the screen (360x640 -> scale 1). Square pixel-art fallback: its own scale,
    // top at fallback.y, the missing lower part filled by a mirrored copy (a wet street).
    // assets.json `fit` {scale, roadY}: the picture is shown at `scale` x its source size (derived texture
    // = source x displayScale) and moved so its row `roadY` (the end of the road / floor) sits on the
    // platform's top edge; whatever is left below the picture is filled with the glass colour.
    const def = manifestDef('backgrounds', source) || {};
    const fit = tall && source === battleDef.bg && env?.platform ? def.fit : null;
    const s = fit ? fit.scale / (def.displayScale ?? 1) : tall ? Math.max(360 / frame.width, 640 / frame.height) : cfg.fallback.scale;
    const dispW = frame.width * s;
    const dispH = frame.height * s;
    const top = fit ? env.platform.y - fit.roadY * dispH : tall ? (640 - dispH) / 2 : cfg.fallback.y;
    picture = { left: 180 - dispW / 2, top, w: dispW, h: dispH, tall };

    const parts = [];
    if (fit && top + dispH < 640) {
      const fill = ui.commands.glass;
      parts.push(scene.add.rectangle(180, top + dispH + (640 - top - dispH) / 2 + 1, view.w + dispW * 2, 640 - top - dispH + 2, Number(fill.color)));
    }
    parts.push(scene.add.image(180, top + dispH / 2, tex).setDisplaySize(dispW, dispH));
    if (!tall && top + dispH < 640) {
      const reflect = scene.add
        .image(180, top + dispH + dispH / 2, tex)
        .setDisplaySize(dispW, dispH)
        .setFlipY(true)
        .setTint(Number(cfg.fallback.reflectTint))
        .setAlpha(cfg.fallback.reflectAlpha);
      parts.push(reflect);
    }
    // Mirrored copies at both sides wherever the drift / shift would show the picture's edge.
    const shift = battleDef.bgShift || 0;
    const drift = env?.drift?.x || 0;
    const reach = view.w / 2 + drift + Math.abs(shift) - dispW / 2;
    if (reach > 0) {
      for (const p of [...parts].filter((q) => q.type === 'Image')) {
        for (const dir of [-1, 1]) {
          const copy = scene.add.image(p.x + dir * dispW, p.y, tex).setDisplaySize(dispW, p.displayHeight).setFlipX(true).setFlipY(p.flipY).setAlpha(p.alpha);
          if (p.isTinted) copy.setTint(p.tintTopLeft);
          parts.push(copy);
        }
      }
    }
    container.add(parts);
    container.x = shift;
    if (drift) {
      container.x = shift - drift;
      scene.tweens.add({ targets: container, x: shift + drift, duration: env.drift.ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    objects += createAmbient(scene, container, battleDef.bg, picture, source === battleDef.bg);
  }
  createGlass(scene);
  Object.assign(lastBuild, { key: battleDef.bg, source, ms: performance.now() - t0, objects });
  if (import.meta.env?.DEV) window.__bgBuild = lastBuild;
  return { container, key: battleDef.bg, source };
}

// ---------- Ambient motion (assets.json `ambient`, defaults in ui.json battleBackdrop.fog / .glow) ----------

function softTexture(scene, radius) {
  const key = `fx_soft_${radius}`;
  if (scene.textures.exists(key)) return key;
  const size = radius * 2;
  const texture = scene.textures.createCanvas(key, size, size);
  const ctx = texture.getContext();
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

// A white band, soft at its top, bottom and both ends (tinted per use).
function fogTexture(scene) {
  const f = cfg.fog;
  const key = `fx_fog_${f.texW}x${f.texH}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, f.texW, f.texH);
  const ctx = texture.getContext();
  const v = ctx.createLinearGradient(0, 0, 0, f.texH);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.5, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, f.texW, f.texH);
  ctx.globalCompositeOperation = 'destination-in';
  const h = ctx.createLinearGradient(0, 0, f.texW, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.15, 'rgba(0,0,0,1)');
  h.addColorStop(0.85, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, f.texW, f.texH);
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

// Fog bands (plain alpha, drifting sideways, the second one mirrored and opposite) and additive
// glow points (inside the drift container, so they stay on their windows). Returns the object count.
// The glow points belong to the real illustration only: a fallback picture gets the fog alone.
function createAmbient(scene, container, key, picture, own) {
  const ambient = manifestDef('backgrounds', key)?.ambient;
  if (!ambient) return 0;
  const view = viewRect();
  let count = 0;

  const fog = ambient.fog && { ...cfg.fog, ...ambient.fog };
  if (fog) {
    const tex = fogTexture(scene);
    const bands = (fog.bands || cfg.fog.bands).slice(0, cfg.fog.maxBands);
    bands.forEach((b, i) => {
      const dir = b.dir ?? (i % 2 ? -1 : 1);
      const w = view.w * cfg.fog.widthMult;
      const x0 = 180 - (dir * fog.speedPx) / 2;
      const image = scene.add
        .image(x0, b.y * 640, tex)
        .setDisplaySize(w, b.h)
        .setTint(Number(fog.color))
        .setAlpha(fog.alpha)
        .setDepth(cfg.fog.depth);
      scene.tweens.add({ targets: image, x: 180 + (dir * fog.speedPx) / 2, duration: fog.ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      count += 1;
    });
  }

  if (picture?.tall && own && ambient.glowPoints) {
    ambient.glowPoints.slice(0, cfg.glow.max).forEach((g, i) => {
      const [lo, hi] = g.alpha;
      const gx = picture.left + g.x * picture.w;
      const gy = picture.top + g.y * picture.h;
      const r = g.r * (picture.w / 360);
      if (gy + r < 0 || gy - r > 640) return; // zoomed out of view
      const image = scene.add
        .image(gx, gy, softTexture(scene, cfg.glow.texRadius))
        .setDisplaySize(r * 2, r * 2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(Number(g.color))
        .setAlpha(lo);
      container.add(image);
      scene.tweens.add({ targets: image, alpha: hi, duration: g.pulseMs, delay: (i * g.pulseMs) / 3, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      count += 1;
    });
  }
  return count;
}

// ---------- Platform ----------

// The strip under the fighters: art from `platform` (a key of assets.json backgrounds, drawn at its
// displayScale, bottom on the HUD edge) or the code-drawn band.
export function createPlatform(scene, key, env) {
  const p = env?.platform;
  if (!p) return null;
  const view = viewRect();
  const h = layout.sceneBottom - p.y;
  const depth = p.depth;
  if (key && isRealTexture(scene, key)) {
    const k = manifestDef('backgrounds', key)?.displayScale ?? 1;
    const image = scene.add.image(180, layout.sceneBottom, key).setOrigin(0.5, 1).setDepth(depth);
    image.setScale(k);
    // Wider screens: the strip continues, mirrored.
    if (view.w > image.displayWidth) {
      for (const dir of [-1, 1]) scene.add.image(180 + dir * image.displayWidth, layout.sceneBottom, key).setOrigin(0.5, 1).setScale(k).setFlipX(true).setDepth(depth);
    }
    return image;
  }
  return scene.add.image(view.x, p.y, Fx.floorTexture(scene, view.w, h, p)).setOrigin(0).setDepth(depth);
}

// ---------- HUD / command glass ----------

// Dark glass behind the status panel (y 360-440, drawn by Hud) is its own; this is the one under the
// command grid and the enemy-turn tap zone (ui.json commands.glass).
function createGlass(scene) {
  const g = ui.commands.glass;
  if (!g) return;
  const view = viewRect();
  const y = g.y;
  scene.add.rectangle(view.x, y, view.w, 640 - y, Number(g.color), g.alpha).setOrigin(0).setDepth(g.depth);
  scene.add.rectangle(view.x, y, view.w, 1, Number(g.strokeColor)).setOrigin(0).setDepth(g.depth);
}
