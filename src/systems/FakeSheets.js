import { animKey } from './SpriteAnims.js';

// ?fakesheets=1 (dev/test): for every character and animation in
// src/data/animSpecs.json that has no real sheet, draws a stand-in sheet in
// memory: one coloured frame per frame (plain / windup / impact / hold) with
// the animation name and frame number over the faded static body, and the
// ART_BRIEF frame counts, sizes and flags. Code paths then treat them as real
// sheets, so every animation path can be exercised before the art exists.
// Nothing is written to disk. Real sheets (and their JSON) always win.
//
// sets: the animationSets registry (mutated). bodyDefs: id -> def with body
// (+ parts). readFacing: ids that face right in game (heroes, allies), whose
// labels are pre-mirrored so they read correctly once the sprite is flipped.
export function applyFakeSheets(scene, sets, specs, bodyDefs, manifest, readFacing) {
  const cfg = specs.fake;
  const made = [];
  for (const [id, spec] of Object.entries(specs.characters)) {
    const set = sets[id] || (sets[id] = { frame_size: spec.frame_size, facing: 'left', animations: {} });
    for (const [name, s] of Object.entries(spec.animations)) {
      const key = animKey(id, name);
      if (scene.textures.exists(key)) continue;
      // A JSON entry without its file keeps its own timing and flags.
      const def = set.animations[name] ? { ...set.animations[name] } : expand(s, cfg, `${id}_${name}.png`);
      delete def.placeholder;
      def.fake = true;
      set.animations[name] = def;
      drawSheet(scene, key, def.frame_size || set.frame_size, def, name, def.frame_size ? null : bodyDefs[id], manifest, cfg, readFacing.has(id));
      made.push(key);
    }
  }
  console.info(`fakesheets: ${made.length} stand-in sheets (${made.join(', ')})`);
  return made;
}

function expand(s, cfg, sheet) {
  const durations = [];
  for (let i = 0; i < s.frames; i++) {
    const held = i === s.windupFrame || i === s.holdFrame;
    durations.push(s.loop ? cfg.loopMs : held ? cfg.holdMs : cfg.ms);
  }
  const def = { ...s, sheet, durations_ms: durations, loop: !!s.loop };
  return def;
}

function drawSheet(scene, key, [w, h], def, name, bodyDef, manifest, cfg, mirrorText) {
  const texture = scene.textures.createCanvas(key, w * def.frames, h);
  const ctx = texture.getContext();
  const body = bodyDef && scene.textures.exists(bodyDef.body) ? scene.textures.get(bodyDef.body).getSourceImage() : null;
  // Sheets face left (ART_BRIEF); a body drawn facing right is mirrored in.
  const bodyFaces = manifest.sprites?.[bodyDef?.body]?.faces || 'left';
  const fontSize = Math.max(9, Math.round(h / 11));

  for (let i = 0; i < def.frames; i++) {
    const x = i * w;
    const kind = def.impactFrames?.includes(i) ? 'impact' : i === def.holdFrame ? 'hold' : i === def.windupFrame ? 'windup' : 'plain';
    ctx.globalAlpha = kind === 'plain' ? 0.35 : 0.6;
    ctx.fillStyle = cfg.colors[kind];
    ctx.fillRect(x + 2, 2, w - 4, h - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cfg.colors[kind];
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, 2, w - 4, h - 4);

    if (body) {
      ctx.save();
      ctx.globalAlpha = cfg.bodyAlpha;
      // A small per-frame nudge so the animation visibly plays.
      const dx = Math.round(Math.sin((i / def.frames) * Math.PI * 2) * 2);
      if (bodyFaces === 'right') {
        ctx.translate(x + w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(body, Math.floor((w - body.width) / 2) - dx, Math.floor((h - body.height) / 2));
      } else {
        ctx.drawImage(body, x + Math.floor((w - body.width) / 2) + dx, Math.floor((h - body.height) / 2));
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x + w / 2, 0);
    if (mirrorText) ctx.scale(-1, 1);
    ctx.fillStyle = cfg.colors.text;
    ctx.strokeStyle = '#0b0d14';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fontSize}px monospace`;
    const label = `${name}`;
    const index = `${i}${kind === 'plain' ? '' : ` ${kind[0].toUpperCase()}`}`;
    ctx.strokeText(label, 0, 4);
    ctx.fillText(label, 0, 4);
    ctx.strokeText(index, 0, 6 + fontSize);
    ctx.fillText(index, 0, 6 + fontSize);
    ctx.restore();

    texture.add(i, 0, x, 0, w, h);
  }
  texture.refresh();
}
