// Sprite-sheet animations, per the output contract in docs/ART_BRIEF.md:
// public/assets/sprites/<id>_animations.json describes the sheets
// public/assets/sprites/<id>_<anim>.png (horizontal strips, facing left).
// A character without that JSON keeps using its cutout rig.

// animSet aliases (characters.json / enemies.json `animSet`): an entity whose
// def says "animSet": "<other id>" plays that id's sheets (dov_rival -> dov).
// aliasAnimationSets registers them once the sets are fetched; animKey then
// resolves through them, so every call site (playLoop, SheetDriver, ...) keeps
// using its own id and ends up on the shared texture / Phaser animation.
const aliases = {};

export function aliasAnimationSets(sets, defs) {
  for (const [id, def] of Object.entries(defs)) {
    if (!def.animSet || def.animSet === id) continue;
    if (sets[id]) continue; // its own sheets win
    if (!sets[def.animSet]) continue; // no set to share: the rig fallback
    sets[id] = sets[def.animSet];
    aliases[id] = def.animSet;
  }
}

export function animKey(id, name) {
  return `${aliases[id] || id}_${name}`;
}

// True when the character has a real (non-placeholder) sheet for this
// animation. Callers use it to decide between the sheet and their code fallback.
export function hasSheet(anims, name) {
  return !!anims?.[name] && !anims[name].placeholder;
}

// Dev builds: which animation paths ran ("play:rhea_attack", "hold:…",
// "impact:…", "fallback:…"), for the headless coverage checks.
export function trace(event) {
  if (!import.meta.env.DEV) return;
  const log = (window.__animTrace = window.__animTrace || {});
  log[event] = (log[event] || 0) + 1;
}

// Plays a looping (or any) animation and notes it in the dev trace.
export function playLoop(sprite, id, name) {
  trace(`play:${animKey(id, name)}`);
  return sprite.play(animKey(id, name));
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
    if (aliases[id]) continue;
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
    if (aliases[id]) continue;
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
  trace(`play:${key}`);
  const impacts = [...(def.impactFrames || [])].sort((a, b) => a - b);
  let nextImpact = 0;
  let held = false;

  return new Promise((resolve) => {
    const reached = (frameIndex) => {
      while (nextImpact < impacts.length && impacts[nextImpact] <= frameIndex) {
        trace(`impact:${key}`);
        if (onImpact) onImpact(nextImpact, impacts.length);
        nextImpact++;
      }
      if (!held && onHold && def.holdFrame !== undefined && frameIndex >= def.holdFrame) {
        held = true;
        trace(`hold:${key}`);
        sprite.anims.pause();
        onHold(() => sprite.anims.resume());
      }
    };

    const onFrame = (anim, frame) => {
      if (anim.key === key) reached(frame.index - 1);
      // A paused animation that gets replaced emits no stop event (Phaser
      // doesn't count it as playing), so another one starting = ours is over.
      else finish({ key });
    };

    let finished = false;
    const finish = (anim) => {
      if (anim.key !== key || finished) return;
      finished = true;
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

// Plays a sheet animation backwards (last frame to first, each frame for its own duration) and
// resolves when it ends. The Clerk's rise after his stage-1 death is the death sheet reversed.
// Works on placeholder sheets too: they are registered animations like any other.
export function playReverseOnce(sprite, id, name) {
  const key = animKey(id, name);
  trace(`playReverse:${key}`);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (anim) => {
      if (anim.key !== key || finished) return;
      finished = true;
      sprite.off('animationstart', onStart);
      sprite.off('animationcomplete', finish);
      sprite.off('animationstop', finish);
      resolve();
    };
    // Another animation taking over the sprite ends this one too.
    const onStart = (anim) => {
      if (anim.key !== key) finish({ key });
    };
    sprite.on('animationstart', onStart);
    sprite.on('animationcomplete', finish);
    sprite.on('animationstop', finish);
    sprite.anims.playReverse(key);
  });
}

// Drives one non-looping sheet frame by frame, for moves timed against the
// clock: runTo(frame) plays (or continues) until that frame and pauses there.
// Enemy attacks use it to hold the windup and land impact frame k on the
// ring's impact time. If something else replaces the animation (a hurt
// reaction, death), every pending runTo resolves and done settles, so a
// caller can never wait forever.
export class SheetDriver {
  constructor(sprite, id, name, def) {
    this.sprite = sprite;
    this.key = animKey(id, name);
    this.def = def;
    this.frame = -1;
    this.started = false;
    this.ended = false;
    this.pending = null; // {frame, resolve}
    this.done = new Promise((resolve) => (this.resolveDone = resolve));

    this.onFrame = (anim, frame) => {
      // Another animation took over (see playOnce): this one is over.
      if (anim.key !== this.key) {
        if (this.started) this.onEnd({ key: this.key });
        return;
      }
      this.frame = frame.index - 1;
      if (this.pending && this.frame >= this.pending.frame) {
        sprite.anims.pause();
        this.settle();
      }
    };
    this.onEnd = (anim) => {
      if (anim.key !== this.key || this.ended) return;
      this.ended = true;
      sprite.off('animationstart', this.onFrame);
      sprite.off('animationupdate', this.onFrame);
      sprite.off('animationcomplete', this.onEnd);
      sprite.off('animationstop', this.onEnd);
      this.settle();
      this.resolveDone();
    };
    sprite.on('animationstart', this.onFrame);
    sprite.on('animationupdate', this.onFrame);
    sprite.on('animationcomplete', this.onEnd);
    sprite.on('animationstop', this.onEnd);
  }

  settle() {
    const p = this.pending;
    this.pending = null;
    if (p) p.resolve();
  }

  // Plays until `frame` and pauses on it. Resolves on arrival (or at once if
  // already there / the animation is gone).
  runTo(frame) {
    return new Promise((resolve) => {
      if (this.ended || this.frame >= frame) {
        if (!this.ended) this.sprite.anims.pause();
        resolve();
        return;
      }
      this.pending = { frame, resolve };
      if (!this.started) {
        this.started = true;
        trace(`play:${this.key}`);
        this.sprite.play(this.key);
      } else {
        this.sprite.anims.resume();
      }
    });
  }

  // Plays through to the end; resolves when the animation is over.
  finish() {
    this.settle();
    if (!this.ended && this.started) this.sprite.anims.resume();
    else if (!this.started) this.resolveDone();
    return this.done;
  }

  stop() {
    this.settle();
    if (this.started && !this.ended) this.sprite.anims.stop();
    else this.resolveDone();
  }
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
