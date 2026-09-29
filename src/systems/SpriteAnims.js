// Sprite-sheet animations, per the output contract in docs/ART_BRIEF.md:
// public/assets/sprites/<id>_animations.json describes the sheets
// public/assets/sprites/<id>_<anim>.png (horizontal strips, facing left).
// A character without that JSON keeps using its cutout rig.

export function animKey(id, name) {
  return `${id}_${name}`;
}

// True when the character has a real (non-placeholder) sheet for this
// animation. Callers use it to decide between the sheet and their code fallback.
export function hasSheet(anims, name) {
  return !!anims?.[name] && !anims[name].placeholder;
}

// Fetched outside the Phaser loader: in dev a missing file comes back as the
// SPA's index.html, which Phaser's JSON loader re-throws on. Missing or broken
// JSON just means "no sheets for this character".
export async function fetchAnimationSets(ids) {
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`assets/sprites/${id}_animations.json`);
        if (!res.ok) return null;
        return [id, await res.json()];
      } catch (err) {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter(Boolean));
}

export function queueSheets(load, sets) {
  for (const [id, set] of Object.entries(sets)) {
    for (const [name, def] of Object.entries(set.animations)) {
      // FX sheets (e.g. blast_projectile) carry their own frame_size.
      const [frameWidth, frameHeight] = def.frame_size || set.frame_size;
      load.spritesheet(animKey(id, name), `assets/sprites/${def.sheet}`, {
        frameWidth,
        frameHeight,
        endFrame: def.frames - 1,
      });
    }
  }
}

// bodyDefs: id -> character/enemy def (body + parts), used to draw placeholders
// that still look like the character while its sheets are missing.
export function buildAnimations(scene, sets, bodyDefs) {
  for (const [id, set] of Object.entries(sets)) {
    for (const [name, def] of Object.entries(set.animations)) {
      const key = animKey(id, name);
      if (!scene.textures.exists(key)) {
        // An FX sheet is not the character, so its placeholder is a plain box.
        const bodyDef = def.frame_size ? null : bodyDefs[id];
        createPlaceholderSheet(scene, key, def.frame_size || set.frame_size, def.frames, bodyDef);
        def.placeholder = true;
        console.info(`${key}: sheet missing, using placeholder`);
      }
      createAnimation(scene, key, def);
    }
  }
}

// Plays a one-shot animation and resolves when it ends.
// - onImpact(i, count) fires on each of def.impactFrames; with no impactFrames
//   it fires once at the end, so damage always lands.
// - def.holdFrame pauses the animation there and calls onHold(resume). Without
//   an onHold handler the animation plays through, so nothing can soft-lock.
export function playOnce(sprite, id, name, def, { onImpact, onHold } = {}) {
  const key = animKey(id, name);
  const impacts = [...(def.impactFrames || [])].sort((a, b) => a - b);
  let nextImpact = 0;
  let held = false;

  return new Promise((resolve) => {
    const reached = (frameIndex) => {
      while (nextImpact < impacts.length && impacts[nextImpact] <= frameIndex) {
        if (onImpact) onImpact(nextImpact, impacts.length);
        nextImpact++;
      }
      if (!held && onHold && def.holdFrame !== undefined && frameIndex >= def.holdFrame) {
        held = true;
        sprite.anims.pause();
        onHold(() => sprite.anims.resume());
      }
    };

    const onFrame = (anim, frame) => {
      if (anim.key === key) reached(frame.index - 1);
    };

    const finish = (anim) => {
      if (anim.key !== key) return;
      sprite.off('animationstart', onFrame);
      sprite.off('animationupdate', onFrame);
      sprite.off('animationcomplete', finish);
      sprite.off('animationstop', finish);
      reached(def.frames - 1);
      if (impacts.length === 0 && onImpact) onImpact(0, 1);
      resolve();
    };

    sprite.on('animationstart', onFrame);
    sprite.on('animationupdate', onFrame);
    sprite.on('animationcomplete', finish);
    sprite.on('animationstop', finish);
    sprite.play(key);
  });
}

// durations_ms[i] is exactly how long frame i stays on screen (Phaser uses a
// frame's own duration in place of msPerFrame when it is set).
function createAnimation(scene, key, def) {
  const durations = def.durations_ms || [];
  if (durations.length !== def.frames) {
    console.warn(`${key}: ${def.frames} frames but ${durations.length} durations_ms`);
  }

  const frames = [];
  for (let i = 0; i < def.frames; i++) {
    frames.push({ key, frame: i, duration: durations[Math.min(i, durations.length - 1)] });
  }

  scene.anims.create({ key, frames, repeat: def.loop ? -1 : 0 });
}

// Every frame is the character's static body (+ parts at rest), so a missing
// sheet still shows the character with the right frame count and timing.
// With no bodyDef (FX sheets) each frame is a plain box.
function createPlaceholderSheet(scene, key, [w, h], frameCount, bodyDef) {
  const texture = scene.textures.createCanvas(key, w * frameCount, h);
  const ctx = texture.getContext();
  const layers = [bodyDef?.body, ...(bodyDef?.parts || []).map((p) => p.sprite)]
    .filter((k) => k && scene.textures.exists(k))
    .map((k) => scene.textures.get(k).getSourceImage());

  for (let i = 0; i < frameCount; i++) {
    const x = i * w;
    if (layers.length === 0) {
      ctx.fillStyle = '#2a2d3a';
      ctx.fillRect(x + 1, 1, w - 2, h - 2);
    }
    for (const img of layers) {
      ctx.drawImage(img, x + Math.floor((w - img.width) / 2), Math.floor((h - img.height) / 2));
    }
    texture.add(i, 0, x, 0, w, h);
  }

  texture.refresh();
}
