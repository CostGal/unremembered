// Cross-checks the game data (src/data/*.json + the sprites' *_animations.json).
// Plain JS with no Phaser, so it runs in Node (npm run validate) and in dev
// builds at boot (console warnings).
//
// data = {chapter1, cutscenes: {id: {shots}}, dialogue, battles, enemies,
//         characters, allies, techniques, assets, ui, battleEvents, animationSets}
// options.sheetExists(fileName) -> bool: checks sheet files on disk (Node only).
// Returns {errors: [...], warnings: [...]}.

import { compileTrack } from './MusicData.js';

const STEP_TYPES = ['cutscene', 'dialogue', 'battle', 'reward', 'end'];
const SHOT_FX = ['crystal_particles', 'rain', 'flash', 'lights_out', 'dissolve_layer', 'embers', 'eyes_glow'];
const SHOT_MOVES = ['none', 'pan_left', 'pan_right', 'zoom_in', 'zoom_out'];
const SPLITS = ['none', 'vertical', 'horizontal'];
const BATTLE_EVENTS = ['keepsake_burn'];
// Play (latin + greek subsets) covers ASCII, Latin-1, Greek, the dashes/quotes/
// ellipsis and a few symbols. Anything else on screen renders in a system font.
// Allowed on purpose: 🔒 🔈 (emoji, meant to), ▯ (a forgotten name, drawn as boxes).
const FONT_OK = /^[\x20-\x7E\u00A0-\u00FF\u0370-\u03FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u00D7\u00B7\u2032\u2033\u20AC\u{1F512}\u{1F508}\u25AF\n]*$/u;
// languages: each name is shown in its own language's font; greekSample is never drawn.
const FONT_SKIP_KEYS = new Set(['font', 'fontFamily', 'languages', 'greekSample']);

function* uiStrings(value, path = 'ui') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* uiStrings(v, `${path}[${i}]`);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!FONT_SKIP_KEYS.has(k)) yield* uiStrings(v, `${path}.${k}`);
  }
}

export function validateData(data, { sheetExists = null, maxLineChars = 90 } = {}) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  const { chapter1 = [], cutscenes = {}, dialogue = {}, battles = {}, enemies = {}, characters = {}, allies = {} } = data;
  const { techniques = {}, assets = {}, ui = {}, battleEvents = {}, animationSets = {} } = data;
  const backgrounds = assets.backgrounds || {};
  const beds = data.audio?.ambience?.beds;
  const anyAsset = { ...assets.sprites, ...assets.portraits, ...backgrounds, ...assets.cutscene, ...assets.ui };

  // Chapter steps
  chapter1.forEach((step, i) => {
    const at = `chapter1[${i}]`;
    if (!STEP_TYPES.includes(step.type)) err(`${at}: unknown step type "${step.type}"`);
    if (step.type === 'cutscene' && !cutscenes[step.id]) err(`${at}: no cutscene "${step.id}" (src/data/cutscene_${step.id}.json)`);
    if (step.type === 'dialogue') {
      if (!dialogue[step.id]) err(`${at}: no dialogue "${step.id}" in dialogue.json`);
      if (step.bg && step.bg !== 'black' && !backgrounds[step.bg]) err(`${at}: bg "${step.bg}" is not in assets.json backgrounds`);
    }
    if (step.type === 'battle' && !battles[step.id]) err(`${at}: no battle "${step.id}" in battles.json`);
  });
  if (chapter1.length && chapter1[chapter1.length - 1].type !== 'end') warn('chapter1: last step is not {"type": "end"}');

  // Battles
  for (const [id, battle] of Object.entries(battles)) {
    if (!backgrounds[battle.bg]) err(`battles.${id}: bg "${battle.bg}" is not in assets.json backgrounds`);
    for (const key of battle.enemies || []) {
      if (!enemies[key]) err(`battles.${id}: no enemy "${key}" in enemies.json`);
    }
    if (!battle.enemies?.length) err(`battles.${id}: no enemies`);
  }

  // Dialogue
  const speakers = new Set([
    ...Object.values(characters).map((c) => c.name),
    ...Object.values(enemies).map((e) => e.name),
    ...Object.values(allies).map((a) => a.name),
    ...Object.keys(ui.dialogue?.nameColors || {}),
  ]);
  const styles = ui.dialogue?.styles || {};
  for (const [id, lines] of Object.entries(dialogue)) {
    if (!Array.isArray(lines)) {
      err(`dialogue.${id}: not a list of lines`);
      continue;
    }
    lines.forEach((line, i) => {
      const at = `dialogue.${id}[${i}]`;
      if (typeof line.text !== 'string' || !line.text) err(`${at}: missing text`);
      else if (line.text.length > maxLineChars) warn(`${at}: ${line.text.length} chars (> ${maxLineChars}) may not fit the box`);
      if (line.speaker && !speakers.has(line.speaker)) err(`${at}: unknown speaker "${line.speaker}"`);
      if (line.portrait && !assets.portraits?.[line.portrait]) err(`${at}: portrait "${line.portrait}" is not in assets.json portraits`);
      if (line.style && !styles[line.style]) err(`${at}: unknown style "${line.style}"`);
    });
  }

  // On-screen text vs the shipped font (warnings only)
  const fontCheck = (at, text) => {
    if (typeof text === 'string' && !FONT_OK.test(text)) {
      const bad = [...new Set([...text].filter((ch) => !FONT_OK.test(ch)))].join(' ');
      warn(`${at}: "${bad}" is not in Play (renders in the system font)`);
    }
  };
  for (const [id, lines] of Object.entries(dialogue)) {
    if (Array.isArray(lines)) lines.forEach((line, i) => fontCheck(`dialogue.${id}[${i}]`, line.text));
  }
  for (const [id, cs] of Object.entries(cutscenes)) (cs.shots || []).forEach((shot, i) => fontCheck(`cutscene_${id}.shots[${i}]`, shot.text));
  for (const [path, text] of uiStrings(ui)) fontCheck(path, text);

  // Heroes, enemies, allies
  for (const [id, c] of Object.entries(characters)) {
    for (const t of c.techniques || []) if (!techniques[t]) err(`characters.${id}: technique "${t}" is not in techniques.json`);
    if (!assets.sprites?.[c.body]) err(`characters.${id}: body sprite "${c.body}" is not in assets.json sprites`);
    for (const part of c.parts || []) if (!assets.sprites?.[part.sprite]) err(`characters.${id}: part sprite "${part.sprite}" is not in assets.json`);
    if (!Array.isArray(c.strike) || c.strike.length !== 2) err(`characters.${id}: strike must be [min, max]`);
  }
  if (!techniques.strike) err('techniques.json: "strike" is required');
  if (!techniques.recollection) err('techniques.json: "recollection" is required');

  for (const [id, e] of Object.entries(enemies)) {
    if (!assets.sprites?.[e.body]) err(`enemies.${id}: body sprite "${e.body}" is not in assets.json sprites`);
    if (e.poise !== undefined && !(Number.isInteger(e.poise) && e.poise > 0)) err(`enemies.${id}: poise must be a positive integer`);
    const lists = e.phases ? e.phases.map((p, i) => [`phases[${i}]`, p.attacks]) : [['attacks', e.attacks]];
    for (const [where, attacks] of lists) {
      if (!attacks?.length) err(`enemies.${id}.${where}: no attacks`);
      for (const a of attacks || []) {
        for (const hit of a.hits || [a]) {
          if (!(hit.telegraphMs > 0)) err(`enemies.${id}.${where}.${a.id}: telegraphMs missing`);
          if (typeof hit.dmg !== 'number') err(`enemies.${id}.${where}.${a.id}: dmg missing`);
        }
      }
    }
    for (const a of lists.flatMap(([, attacks]) => attacks || [])) {
      for (const hit of a.hits || [a]) {
        if (hit.onMiss?.status && !data.statuses?.[hit.onMiss.status]) err(`enemies.${id}.${a.id}: onMiss status "${hit.onMiss.status}" is not in statuses.json`);
      }
    }
    for (const p of e.phases || []) {
      if (p.onEnter && !BATTLE_EVENTS.includes(p.onEnter)) err(`enemies.${id}: unknown phase event "${p.onEnter}"`);
    }
  }
  const FRAGMENT_EFFECTS = ['startEcho', 'nalaExtraUses', 'perfectWindowMs', 'dovMaxHp', 'perfectEchoBonus', 'blastCritChance'];
  for (const [id, f] of Object.entries(data.fragments?.pool || {})) {
    for (const key of Object.keys(f.effects || {})) {
      if (!FRAGMENT_EFFECTS.includes(key)) err(`fragments.${id}: unknown effect "${key}"`);
    }
    if (!f.name || !f.short || !f.text) err(`fragments.${id}: name, short and text are required`);
  }
  for (const [id, a] of Object.entries(allies)) {
    if (!assets.sprites?.[a.body]) err(`allies.${id}: body sprite "${a.body}" is not in assets.json sprites`);
  }
  const keepsake = battleEvents.keepsake_burn?.dialogue;
  if (keepsake && !dialogue[keepsake]) err(`battleEvents.keepsake_burn: no dialogue "${keepsake}"`);

  // Cutscenes
  for (const [id, cs] of Object.entries(cutscenes)) {
    (cs.shots || []).forEach((shot, i) => {
      const at = `cutscene_${id}.shots[${i}]`;
      if (!shot.text) warn(`${at}: no text`);
      for (const key of [shot.bg, shot.bg2]) if (key && !anyAsset[key]) err(`${at}: image "${key}" is not in assets.json`);
      for (const layer of shot.layers || []) if (!anyAsset[layer.img]) err(`${at}: layer "${layer.img}" is not in assets.json`);
      for (const fx of shot.fx || []) if (!SHOT_FX.includes(fx)) err(`${at}: unknown fx "${fx}"`);
      if (shot.move && !SHOT_MOVES.includes(shot.move)) err(`${at}: unknown move "${shot.move}"`);
      if (shot.split && !SPLITS.includes(shot.split)) err(`${at}: unknown split "${shot.split}"`);
      if (beds && shot.ambience && !beds[shot.ambience]) err(`${at}: ambience "${shot.ambience}" is not in audio.json ambience.beds`);
    });
  }
  for (const [bg, bed] of Object.entries(ui.cutscene?.ambienceByBg || {})) {
    if (beds && bed && !beds[bed]) err(`ui.cutscene.ambienceByBg.${bg}: "${bed}" is not in audio.json ambience.beds`);
  }

  // Animation sheets (ART_BRIEF output contract)
  const combatants = { ...characters, ...enemies, ...allies };
  for (const [id, set] of Object.entries(animationSets)) {
    if (!combatants[id]) warn(`${id}_animations.json: "${id}" is not a character, enemy or ally key`);
    if (!Array.isArray(set.frame_size)) err(`${id}_animations.json: frame_size missing`);
    for (const [name, def] of Object.entries(set.animations || {})) {
      const at = `${id}_animations.json ${name}`;
      if (!(def.frames > 0)) err(`${at}: frames missing`);
      if ((def.durations_ms || []).length !== def.frames) err(`${at}: ${def.frames} frames but ${(def.durations_ms || []).length} durations_ms`);
      for (const [field, value] of [['windupFrame', def.windupFrame], ['holdFrame', def.holdFrame], ...(def.impactFrames || []).map((f) => ['impactFrames', f])]) {
        if (value !== undefined && !(value >= 0 && value < def.frames)) err(`${at}: ${field} ${value} is outside 0..${def.frames - 1}`);
      }
      if (def.projectile && !set.animations[def.projectile]) err(`${at}: projectile "${def.projectile}" is not an animation in the set`);
      if (!def.sheet) err(`${at}: sheet missing`);
      else if (sheetExists && !sheetExists(def.sheet)) {
        if (def.optional) warn(`${at}: ${def.sheet} not delivered yet (optional, placeholder)`);
        else err(`${at}: ${def.sheet} is missing (add the file or mark the animation "optional": true)`);
      }
    }
  }

  // Procedural music (data/music.json): every track must compile (chords, tokens,
  // pattern / layer / section references) and be 32–64 bars long.
  const { music } = data;
  if (music) {
    for (const [key, def] of Object.entries(music.tracks || {})) {
      const at = `music.${key}`;
      try {
        for (const l of Object.values(def.layers)) if (!music.instruments[l.inst]) err(`${at}: layer instrument "${l.inst}" is not in music.instruments`);
        if (!music.scales[def.scale]) err(`${at}: unknown scale "${def.scale}"`);
        if (def.warmScale && !music.scales[def.warmScale]) err(`${at}: unknown warmScale "${def.warmScale}"`);
        const compiled = compileTrack(music, key);
        const bars = compiled.bars.length;
        if (bars < 32 || bars > 64) warn(`${at}: ${bars} bars (aim for 32–64)`);
      } catch (e) {
        err(`${at}: ${e.message}`);
      }
    }
    for (const [key, battle] of Object.entries(battles)) {
      if (battle.music && !music.tracks[battle.music]) warn(`battles.${key}: music "${battle.music}" has no procedural track (needs the .mp3 or silence)`);
    }
  }

  return { errors, warnings };
}
