import Phaser from 'phaser';

export function flash(scene, images, durationMs = 60) {
  for (const img of images) img.setTintFill(0xffffff);
  scene.time.delayedCall(durationMs, () => {
    for (const img of images) restoreTint(img);
  });
}

export function shake(scene, amount = 2, durationMs = 80) {
  scene.cameras.main.shake(durationMs, amount / 1000);
}

export function damageNumber(scene, x, y, value, color = '#f1efe8') {
  const text = scene.add
    .text(x, y, `${value}`, {
      fontFamily: '"Pixelify Sans", monospace',
      fontSize: '16px',
      color,
    })
    .setOrigin(0.5)
    .setDepth(1000);

  scene.tweens.add({
    targets: text,
    y: y - 24,
    alpha: 0,
    duration: 600,
    ease: 'Cubic.easeOut',
    onComplete: () => text.destroy(),
  });
}

// ---------- Lighting ----------

// A tint that survives flashes and highlights: restoreTint() returns to it.
export function setBaseTint(images, color) {
  for (const img of images) {
    img.baseTint = color;
    img.setTint(color);
  }
}

export function restoreTint(img) {
  if (img.baseTint !== undefined) img.setTint(img.baseTint);
  else img.clearTint();
}

// Soft additive glows (lanterns, light pools on the ground) that flicker a little.
// cfg = {depth, color, flicker, flickerMs: [min, max], spots: [{x, y, radius, alpha, squash?}]}
export function lights(scene, cfg) {
  return cfg.spots.map((spot) => {
    const glow = scene.add
      .image(spot.x, spot.y, glowTexture(scene, spot.radius))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(Number(cfg.color))
      .setAlpha(spot.alpha)
      .setScale(1, spot.squash || 1)
      .setDepth(cfg.depth);

    scene.tweens.add({
      targets: glow,
      alpha: spot.alpha * (1 - cfg.flicker),
      duration: Phaser.Math.Between(cfg.flickerMs[0], cfg.flickerMs[1]),
      delay: Phaser.Math.Between(0, cfg.flickerMs[1]),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return glow;
  });
}

// Banded dark edges over an area. cfg = {color, alpha, inner (0-1 of the radius left clear), bands, depth}
export function vignette(scene, cfg, area) {
  const key = `fx_vignette_${area.w}x${area.h}_${cfg.inner}_${cfg.bands}_${cfg.color}`;
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, area.w, area.h);
    const ctx = texture.getContext();
    const img = ctx.createImageData(area.w, area.h);
    const cx = area.w / 2;
    const cy = area.h / 2;
    const r = Math.hypot(cx, cy);
    // The colour is baked in: tint-fill would blend the texture's white into semi-transparent pixels.
    const { r: red, g: green, b: blue } = Phaser.Display.Color.IntegerToRGB(Number(cfg.color));
    for (let y = 0; y < area.h; y++) {
      for (let x = 0; x < area.w; x++) {
        // Hard steps between bands keep the pixel-art look.
        const t = (Math.hypot(x - cx, y - cy) / r - cfg.inner) / (1 - cfg.inner);
        const band = Phaser.Math.Clamp(Math.ceil(t * cfg.bands), 0, cfg.bands);
        const i = (y * area.w + x) * 4;
        img.data[i] = red;
        img.data[i + 1] = green;
        img.data[i + 2] = blue;
        img.data[i + 3] = Math.round((255 * band) / cfg.bands);
      }
    }
    ctx.putImageData(img, 0, 0);
    texture.refresh();
  }

  return scene.add
    .image(area.x, area.y, key)
    .setOrigin(0)
    .setAlpha(cfg.alpha)
    .setDepth(cfg.depth);
}

function glowTexture(scene, radius) {
  const key = `fx_glow_${radius}`;
  if (scene.textures.exists(key)) return key;

  const size = radius * 2;
  const texture = scene.textures.createCanvas(key, size, size);
  const ctx = texture.getContext();
  const bands = 4;
  // Concentric discs, outermost first: each band adds brightness toward the centre.
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = `rgba(255,255,255,${1 / bands})`;
    ctx.beginPath();
    ctx.arc(radius, radius, radius * (1 - i / bands), 0, Math.PI * 2);
    ctx.fill();
  }
  texture.refresh();
  return key;
}

// ---------- Rain ----------

// Rain falling through an area {x, y, w, h}, in up to two layers plus splashes.
// cfg.far / cfg.near = {count, speed, wind, landY: [min, max], alpha: [min, max],
// length, color, depth, splash?}; cfg.splash = {count, lifeMs, alpha, color}.
// count is the max alive particles per emitter; keep the total <= 150.
export function rain(scene, cfg, area) {
  const emitters = [];

  let splash = null;
  if (cfg.splash) {
    splash = scene.add.particles(0, 0, splashTexture(scene), {
      emitting: false,
      lifespan: cfg.splash.lifeMs,
      alpha: { start: cfg.splash.alpha, end: 0 },
      scaleX: { start: 0.6, end: 1.4 },
      tint: Number(cfg.splash.color),
      maxAliveParticles: cfg.splash.count,
    });
    emitters.push(splash);
  }

  for (const layerKey of ['far', 'near']) {
    const layer = cfg[layerKey];
    if (!layer) continue;

    const spawnY = area.y - layer.length;
    const lifeMin = ((layer.landY[0] - spawnY) / layer.speed) * 1000;
    const lifeMax = ((layer.landY[1] - spawnY) / layer.speed) * 1000;
    // Spawn upwind so the slant still covers the whole width.
    const drift = (layer.wind * lifeMax) / 1000;
    const xMin = area.x + Math.min(0, -drift);
    const xMax = area.x + area.w + Math.max(0, -drift);

    const emitter = scene.add.particles(0, 0, dropTexture(scene, layer.length), {
      x: { min: xMin, max: xMax },
      y: spawnY,
      speedX: layer.wind,
      speedY: layer.speed,
      lifespan: { min: lifeMin, max: lifeMax },
      alpha: { min: layer.alpha[0], max: layer.alpha[1] },
      tint: Number(layer.color),
      frequency: (lifeMin + lifeMax) / 2 / layer.count,
      maxAliveParticles: layer.count,
      advance: lifeMax,
      deathZone: {
        type: 'onLeave',
        source: new Phaser.Geom.Rectangle(area.x - area.w, area.y - 2 * layer.length, area.w * 3, area.h + 2 * layer.length),
      },
      deathCallback:
        layer.splash && splash
          ? (p) => {
              if (p.y <= area.y + area.h) splash.emitParticleAt(p.x, p.y);
            }
          : null,
    });
    emitter.setDepth(layer.depth);
    emitters.push(emitter);
  }

  if (splash) splash.setDepth(cfg.near ? cfg.near.depth : 0);
  return emitters;
}

// A 1px streak, faint at the top and bright at the tip.
function dropTexture(scene, length) {
  const key = `fx_drop_${length}`;
  if (scene.textures.exists(key)) return key;

  const texture = scene.textures.createCanvas(key, 1, length);
  const ctx = texture.getContext();
  for (let y = 0; y < length; y++) {
    ctx.fillStyle = `rgba(255,255,255,${(y + 1) / length})`;
    ctx.fillRect(0, y, 1, 1);
  }
  texture.refresh();
  return key;
}

// A tiny crown: two droplets kicked up either side of a flat ripple.
function splashTexture(scene) {
  const key = 'fx_splash';
  if (scene.textures.exists(key)) return key;

  const texture = scene.textures.createCanvas(key, 5, 2);
  const ctx = texture.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(4, 0, 1, 1);
  ctx.fillRect(1, 1, 3, 1);
  texture.refresh();
  return key;
}
