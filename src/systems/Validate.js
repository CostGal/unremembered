// Cross-checks the game data (src/data/*.json + the sprites' *_animations.json).
// Plain JS with no Phaser, so it runs in Node (npm run validate) and in dev
// builds at boot (console warnings).
//
// data = {chapter1, cutscenes: {id: {shots}}, dialogue, battles, enemies,
//         characters, allies, techniques, assets, ui, battleEvents, animationSets}
// options.sheetExists(fileName) -> bool: checks sheet files on disk (Node only).
// Returns {errors: [...], warnings: [...]}.

import { whenErrors, thenValid, thenSplit } from './BattleEvents.js';
import { compileTrack } from './MusicData.js';
import { echoMaxFor, learned, techniqueAt } from './Recall.js';

const STEP_TYPES = ['cutscene', 'dialogue', 'battle', 'reward', 'end'];
const SHOT_FX = ['crystal_particles', 'rain', 'flash', 'lights_out', 'dissolve_layer', 'embers', 'eyes_glow'];
const SHOT_MOVES = ['none', 'pan_left', 'pan_right', 'zoom_in', 'zoom_out'];
const SPLITS = ['none', 'vertical', 'horizontal'];
const PLACEHOLDER_SHAPES = ['figure', 'room', 'street', 'band', 'none'];
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
    // party (default ui.battleLayout.defaultParty): hero ids from characters.json
    if (battle.party !== undefined) {
      if (!Array.isArray(battle.party) || !battle.party.length) err(`battles.${id}.party: must be a non-empty list of hero ids`);
      for (const hero of Array.isArray(battle.party) ? battle.party : []) {
        if (!characters[hero]) err(`battles.${id}.party: no character "${hero}" in characters.json`);
      }
    }
    // formation: a key of ui.battleLayout.enemies with a slot per enemy.
    if (battle.formation !== undefined) {
      const slots = ui.battleLayout?.enemies?.[battle.formation];
      if (!slots) err(`battles.${id}.formation: "${battle.formation}" is not in ui.battleLayout.enemies`);
      else if (slots.length < (battle.enemies || []).length) err(`battles.${id}.formation: "${battle.formation}" has ${slots.length} slots for ${battle.enemies.length} enemies`);
    }
    // Generic events (grammar: see systems/BattleEvents.js).
    if (battle.events !== undefined && !Array.isArray(battle.events)) err(`battles.${id}.events: must be a list`);
    const eventIds = new Set();
    (Array.isArray(battle.events) ? battle.events : []).forEach((ev, i) => {
      const at = `battles.${id}.events[${i}]`;
      if (typeof ev.id !== 'string' || !ev.id) err(`${at}: id must be a non-empty string`);
      else if (eventIds.has(ev.id)) err(`${at}: duplicate event id "${ev.id}"`);
      else eventIds.add(ev.id);
      for (const m of whenErrors(ev.when)) err(`${at}: ${m}`);
      if (ev.dialogue !== undefined && !dialogue[ev.dialogue]) err(`${at}: no dialogue "${ev.dialogue}" in dialogue.json`);
      if (!thenValid(ev.then)) err(`${at}: then must be an action or a list of actions: "continue", "endBattle", "nalaJumpIn" or {"setFlag": "<name>"}`);
      if (ev.banner !== undefined && !ui.tutorial?.hints?.[ev.banner]) err(`${at}: banner "${ev.banner}" is not in ui.tutorial.hints`);
    });
    // lockedTechniques: {techniqueId: flag}; the flag must be set by one of the battle's events.
    const setFlags = new Set((battle.events || []).flatMap((ev) => thenSplit(ev.then).post.map((a) => a?.setFlag).filter(Boolean)));
    for (const [tech, flag] of Object.entries(battle.lockedTechniques || {})) {
      if (!techniques[tech]) err(`battles.${id}.lockedTechniques: "${tech}" is not in techniques.json`);
      if (!setFlags.has(flag)) err(`battles.${id}.lockedTechniques.${tech}: no event of the battle sets the flag "${flag}"`);
    }
  }

  // sfx on a dialogue line or a cutscene shot: a string naming an audio.json sfx recipe or a
  // file public/assets/audio/sfx/<name>.mp3 (data.sfxFileKeys, Node only), or null (silence).
  const sfxKeys = new Set([...Object.keys(data.audio?.sfx || {}), ...(data.sfxFileKeys || [])]);
  const checkSfx = (at, sfx) => {
    if (sfx === undefined || sfx === null) return;
    if (typeof sfx !== 'string') err(`${at}: sfx must be a string or null`);
    else if (data.audio && !sfxKeys.has(sfx)) err(`${at}: sfx "${sfx}" is not in audio.json sfx and has no file in public/assets/audio/sfx/`);
  };
  if (data.audio?.sfxFiles && !(typeof data.audio.sfxFiles.dir === 'string' && typeof data.audio.sfxFiles.ext === 'string')) err('audio.json sfxFiles: dir and ext are required');

  // Asset manifest entries: alias / fallback name another key of the same section;
  // placeholder is {tint, label, shape}; cover is a boolean.
  for (const [section, entries] of Object.entries(assets)) {
    if (section === 'loading') continue;
    for (const [key, def] of Object.entries(entries)) {
      const at = `assets.${section}.${key}`;
      if (def.alias !== undefined) {
        if (!entries[def.alias] || def.alias === key) err(`${at}: alias "${def.alias}" is not another key of ${section}`);
        else if (entries[def.alias].alias) err(`${at}: alias "${def.alias}" is itself an alias`);
        continue;
      }
      if (typeof def.file !== 'string') err(`${at}: file is required (or an alias)`);
      if (def.fallback !== undefined && (!entries[def.fallback] || def.fallback === key)) err(`${at}: fallback "${def.fallback}" is not another key of ${section}`);
      if (def.cover !== undefined && typeof def.cover !== 'boolean') err(`${at}: cover must be true or false`);
      const ph = def.placeholder;
      if (ph !== undefined) {
        if (!ph || typeof ph !== 'object') err(`${at}: placeholder must be {tint, label, shape}`);
        else {
          if (ph.tint !== undefined && !/^0x[0-9a-fA-F]{6}$/.test(ph.tint)) err(`${at}: placeholder.tint must be a hex string like "0x1a2238"`);
          if (ph.label !== undefined && typeof ph.label !== 'string') err(`${at}: placeholder.label must be a string`);
          if (ph.shape !== undefined && !PLACEHOLDER_SHAPES.includes(ph.shape)) err(`${at}: placeholder.shape must be one of ${PLACEHOLDER_SHAPES.join(', ')}`);
          if (ph.labelY !== undefined && !(ph.labelY > 0 && ph.labelY <= 1)) err(`${at}: placeholder.labelY must be in (0, 1]`);
        }
      }
    }
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
      checkSfx(at, line.sfx);
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
  // Recall (levels.json)
  const levels = data.levels;
  if (levels) {
    const xpAt = levels.xpAt || [];
    if (xpAt[0] !== 0 || xpAt.some((v, i) => i > 0 && !(v > xpAt[i - 1]))) err('levels.xpAt must start at 0 and rise');
    for (const [hero, list] of Object.entries(levels.learn || {})) {
      if (!characters[hero]) err(`levels.learn.${hero}: no such character`);
      for (const [t, lv] of Object.entries(list)) {
        if (!characters[hero]?.techniques?.includes(t)) err(`levels.learn.${hero}.${t}: not in characters.${hero}.techniques`);
        if (!(Number.isInteger(lv) && lv >= 1 && lv <= xpAt.length)) err(`levels.learn.${hero}.${t}: level must be 1..${xpAt.length}`);
      }
    }
    // Echo capacity per Recall level: whole numbers, one per level, and every
    // technique a hero knows at a level must be castable with that level's cap
    // (Recollection is gated by the Keepsake instead).
    const echoCap = data.ui?.hud?.echo?.max;
    for (const [hero, table] of Object.entries(levels.echoMax || {})) {
      if (!characters[hero]) err(`levels.echoMax.${hero}: no such character`);
      if (!Array.isArray(table) || table.length !== xpAt.length) err(`levels.echoMax.${hero}: needs one entry per Recall level (${xpAt.length})`);
      for (const [i, v] of (Array.isArray(table) ? table : []).entries()) {
        if (!(Number.isInteger(v) && v >= 1 && v <= (echoCap ?? Infinity))) err(`levels.echoMax.${hero}[${i}]: must be a whole number 1..${echoCap}`);
      }
    }
    for (const [hero, c] of Object.entries(characters)) {
      for (let level = 1; level <= xpAt.length; level++) {
        const cap = echoMaxFor(hero, level, levels) ?? c.echoMax ?? echoCap;
        for (const id of learned(hero, level, c.techniques, levels)) {
          const cost = techniqueAt(id, level, techniques)?.cost;
          if (cost > cap) err(`Recall ${level}: ${hero}'s ${id} costs ${cost} Echo but their Echo cap is ${cap}`);
        }
      }
    }
    for (const [id, t] of Object.entries(techniques)) {
      for (const k of Object.keys(t.levels || {})) {
        if (!(Number.isInteger(Number(k)) && Number(k) >= 1 && Number(k) <= xpAt.length)) err(`techniques.${id}.levels.${k}: level must be a whole number 1..${xpAt.length}`);
      }
    }
    for (const [id, e] of Object.entries(enemies)) if (!(Number.isInteger(e.xp) && e.xp >= 0)) err(`enemies.${id}: xp must be a whole number >= 0`);
  }
  for (const [id, e] of Object.entries(enemies)) for (const t of e.immune || []) if (!techniques[t]) err(`enemies.${id}: immune "${t}" is not in techniques.json`);

  // crit.json: Strike / enemy-hit crit chance and damage multiplier, plus the pop text.
  const critData = data.crit;
  if (!critData) err('crit.json: missing');
  else {
    for (const side of ['hero', 'enemy']) {
      const c = critData[side];
      if (!c) err(`crit.json: "${side}" is required`);
      else {
        if (!(typeof c.chance === 'number' && c.chance >= 0 && c.chance <= 1)) err(`crit.json: ${side}.chance must be a number in [0, 1]`);
        if (!(typeof c.mult === 'number' && c.mult > 0)) err(`crit.json: ${side}.mult must be a number > 0`);
      }
    }
    if (typeof critData.text !== 'string' || !critData.text) err('crit.json: "text" is required');
    if (typeof critData.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(critData.color)) err('crit.json: "color" must be a #rrggbb string');
  }

  // break.json: poise weights per damage source + the golden line's look.
  const brk = data.break;
  if (!brk) err('break.json: missing');
  else {
    if (brk.sources) err('break.json: "sources" was replaced by "weights"');
    if (brk.pips) err('break.json: "pips" was replaced by "line"');
    const weightKeys = ['strike', 'counter', 'ability', 'multiHit', 'ultimate', 'critWeight'];
    if (!brk.weights) err('break.json: "weights" is required');
    else for (const k of weightKeys) if (!(typeof brk.weights[k] === 'number' && brk.weights[k] >= 0)) err(`break.json: weights.${k} must be a number >= 0`);
    if (!brk.line) err('break.json: "line" is required');
    else {
      for (const k of ['w', 'h', 'offsetY', 'depth', 'tweenMs', 'brokenPulseMs', 'epsilon']) if (typeof brk.line[k] !== 'number') err(`break.json: line.${k} must be a number`);
      for (const k of ['bg', 'fill', 'brokenFill']) if (!Number.isFinite(Number(brk.line[k]))) err(`break.json: line.${k} must be a 0x colour`);
      const sh = brk.line.shards;
      if (!sh || !(sh.count >= 0) || !(sh.size > 0) || !(sh.lifeMs > 0) || typeof sh.gravity !== 'number' || !(Array.isArray(sh.speed) && sh.speed.length === 2)) err('break.json: line.shards needs count, size, speed [min, max], gravity, lifeMs');
    }
    for (const k of ['hitstopMs', 'shake', 'shakeMs', 'sparks', 'popScale', 'popMs']) if (typeof brk.fx?.[k] !== 'number') err(`break.json: fx.${k} must be a number`);
  }

  if (!techniques.strike) err('techniques.json: "strike" is required');
  if (!techniques.recollection) err('techniques.json: "recollection" is required');

  for (const [id, e] of Object.entries(enemies)) {
    if (!assets.sprites?.[e.body]) err(`enemies.${id}: body sprite "${e.body}" is not in assets.json sprites`);
    if (e.poise !== undefined && !(typeof e.poise === 'number' && e.poise > 0)) err(`enemies.${id}: poise must be a positive number (damage units)`);
    const lists = e.phases ? e.phases.map((p, i) => [`phases[${i}]`, p.attacks]) : [['attacks', e.attacks]];
    for (const [where, attacks] of lists) {
      if (!attacks?.length) err(`enemies.${id}.${where}: no attacks`);
      for (const a of attacks || []) {
        for (const hit of a.hits || [a]) {
          if (!(hit.telegraphMs > 0)) err(`enemies.${id}.${where}.${a.id}: telegraphMs missing`);
          if (typeof hit.dmg !== 'number') err(`enemies.${id}.${where}.${a.id}: dmg missing`);
          const f = hit.feint;
          if (f) {
            if (!(f.atPct > 0 && f.atPct < 1)) err(`enemies.${id}.${where}.${a.id}: feint.atPct must be in (0, 1)`);
            if (!(f.pauseMs >= 0)) err(`enemies.${id}.${where}.${a.id}: feint.pauseMs must be >= 0`);
            if (f.resumeSpeed !== undefined && !(f.resumeSpeed > 0)) err(`enemies.${id}.${where}.${a.id}: feint.resumeSpeed must be > 0`);
          }
          const fc = hit.feintChance ?? a.feintChance;
          if (fc !== undefined && !(fc >= 0 && fc <= 1)) err(`enemies.${id}.${where}.${a.id}: feintChance must be in [0, 1]`);
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
  // animSet: borrow another id's sheets (dov_rival -> dov). Warn only: without
  // the set, the entity falls back to its rig.
  const sheetOwners = { ...characters, ...enemies, ...allies };
  for (const [group, defs] of [['characters', characters], ['enemies', enemies]]) {
    for (const [id, def] of Object.entries(defs)) {
      if (def.animSet !== undefined) {
        if (typeof def.animSet !== 'string' || !sheetOwners[def.animSet]) err(`${group}.${id}: animSet "${def.animSet}" is not a character, enemy or ally key`);
        else if (!animationSets[def.animSet]) warn(`${group}.${id}: animSet "${def.animSet}" has no ${def.animSet}_animations.json (rig fallback)`);
      }
      if (def.refuseUntilFlag !== undefined && typeof def.refuseUntilFlag !== 'string') err(`${group}.${id}: refuseUntilFlag must be a string`);
      if (def.firstAttackTelegraphMult !== undefined && !(typeof def.firstAttackTelegraphMult === 'number' && def.firstAttackTelegraphMult >= 1)) err(`${group}.${id}: firstAttackTelegraphMult must be a number >= 1`);
    }
  }
  // displayScale: whole numbers only (a fractional scale breaks the pixel grid).
  // lifesteal: the share of damage dealt that an enemy heals. tint: 0xRRGGBB.
  for (const [group, defs] of [['characters', characters], ['enemies', enemies]]) {
    for (const [id, def] of Object.entries(defs)) {
      if (def.displayScale !== undefined && !(Number.isInteger(def.displayScale) && def.displayScale > 0)) err(`${group}.${id}: displayScale must be a positive INTEGER (never fractional: a fractional scale breaks the pixel grid, CLAUDE.md pixel rule)`);
      if (def.reach !== undefined && !(typeof def.reach === 'number' && def.reach > 0)) err(`${group}.${id}: reach must be a positive number (half the body art width, px)`);
      if (def.tint !== undefined && !(typeof def.tint === 'string' && /^0x[0-9a-fA-F]{6}$/.test(def.tint))) err(`${group}.${id}: tint must be a hex string like "0x9aa8b8"`);
    }
  }
  for (const [id, e] of Object.entries(enemies)) {
    const attacks = e.phases ? e.phases.flatMap((p) => p.attacks || []) : e.attacks || [];
    for (const a of attacks) {
      for (const hit of [a, ...(a.hits || [])]) {
        if (hit.melee !== undefined && typeof hit.melee !== 'boolean') err(`enemies.${id}.${a.id}: melee must be true or false`);
        if (hit.lifesteal !== undefined && !(typeof hit.lifesteal === 'number' && hit.lifesteal >= 0)) err(`enemies.${id}.${a.id}: lifesteal must be a number >= 0`);
      }
    }
  }
  // defend: an enemy's chance (qte.json enemyDefendChance) to parry a Strike or dodge a technique, by technique id.
  for (const [id, e] of Object.entries(enemies)) {
    const d = e.defend;
    if (!d) continue;
    for (const kind of ['parry', 'dodge']) {
      if (d[kind] !== undefined && !Array.isArray(d[kind])) err(`enemies.${id}.defend.${kind}: must be a list of technique ids`);
      for (const t of d[kind] || []) if (!techniques[t]) err(`enemies.${id}.defend.${kind}: "${t}" is not in techniques.json`);
    }
    if (d.parry?.length) {
      const r = d.reparry;
      if (!(r && r.telegraphMs > 0)) err(`enemies.${id}.defend.reparry.telegraphMs must be > 0 (a parried Strike is answered with a ring)`);
      if (!(r && typeof r.dmg === 'number' && r.dmg >= 0)) err(`enemies.${id}.defend.reparry.dmg must be a number >= 0`);
      if (r?.melee !== undefined && typeof r.melee !== 'boolean') err(`enemies.${id}.defend.reparry.melee must be true or false`);
    }
    const bd = battleEvents.defend;
    if (!(bd && typeof bd.parryText === 'string' && bd.parryText && typeof bd.dodgeText === 'string' && bd.dodgeText && bd.color && bd.sidestepPx >= 0 && bd.sidestepMs > 0)) {
      err('battleEvents.defend: parryText, dodgeText, color, sidestepPx and sidestepMs are required');
    }
  }
  for (const id of data.qte?.difficulties?.order || []) {
    const c = data.qte.difficulties[id]?.enemyDefendChance;
    if (!(typeof c === 'number' && c >= 0 && c <= 1)) err(`qte.difficulties.${id}.enemyDefendChance must be a number in [0, 1]`);
  }
  // Two gestures on every ring (qte.json dodge): a tap parries, a swipe dodges with the easier dodge.windows.
  if (data.qte) {
    const q = data.qte;
    const w = q.windows;
    const dw = q.dodge?.windows;
    if (!(dw && dw.perfectMs > 0 && dw.goodMs > 0)) err('qte.dodge.windows: perfectMs and goodMs are required (> 0)');
    else {
      if (dw.perfectMs > dw.goodMs) err('qte.dodge.windows: perfectMs must be <= goodMs');
      if (dw.goodMs > w.ignoreBeforeMs) err(`qte.dodge.windows.goodMs (${dw.goodMs}) must be <= windows.ignoreBeforeMs (${w.ignoreBeforeMs})`);
    }
    if (w.perfectMs > w.goodMs) err('qte.windows: perfectMs must be <= goodMs');
    if (w.goodMs > w.ignoreBeforeMs) err('qte.windows: goodMs must be <= ignoreBeforeMs');
    const sw = q.dodge?.swipe;
    if (!(sw && sw.minPx > 0 && sw.maxMs > 0)) err('qte.dodge.swipe: minPx and maxMs are required (> 0)');
    if (!(q.dodge?.sidestepPx >= 0 && q.dodge?.sidestepMs > 0)) err('qte.dodge: sidestepPx (>= 0) and sidestepMs (> 0) are required');
    if (typeof q.hint?.text !== 'string' || !q.hint.text) err('qte.hint.text is required');
  }
  // Battle environments: floor platform + background drift (environments.json)
  for (const [id, env] of Object.entries(data.environments || {})) {
    const at = `environments.${id}`;
    const p = env.platform;
    if (p !== undefined) {
      if (!backgrounds[p.key]) err(`${at}.platform.key: "${p.key}" is not in assets.json backgrounds`);
      if (!(typeof p.y === 'number' && p.y >= 0 && p.y <= 360)) err(`${at}.platform.y must be a number within 0..360`);
      for (const k of ['color', 'edgeColor']) if (!Number.isFinite(Number(p[k]))) err(`${at}.platform.${k} must be a 0x colour string`);
      for (const k of ['edgeAlpha', 'bottomAlpha']) if (!(typeof p[k] === 'number' && p[k] >= 0 && p[k] <= 1)) err(`${at}.platform.${k} must be a number in [0, 1]`);
      if (typeof p.depth !== 'number') err(`${at}.platform.depth must be a number`);
    }
    const d = env.drift;
    if (d !== undefined && !(typeof d.x === 'number' && d.x >= 0 && typeof d.ms === 'number' && d.ms > 0)) err(`${at}.drift: x must be a number >= 0 and ms > 0`);
  }
  const sh = ui.battleLayout?.shadow;
  if (sh !== undefined) {
    for (const k of ['widthPct', 'heightPct', 'texRadius']) if (!(typeof sh[k] === 'number' && sh[k] > 0)) err(`ui.battleLayout.shadow.${k} must be a number > 0`);
    if (!Number.isFinite(Number(sh.color)) || !(typeof sh.alpha === 'number' && sh.alpha >= 0 && sh.alpha <= 1) || typeof sh.offsetY !== 'number') err('ui.battleLayout.shadow: color, alpha (0-1) and offsetY are required');
  }
  const melee = ui.battleLayout?.melee;
  for (const k of ['gap', 'approachMs', 'returnMs', 'reachDefault']) if (typeof melee?.[k] !== 'number' || melee[k] < 0) err(`ui.battleLayout.melee.${k} must be a number >= 0`);
  const party = ui.battleLayout?.defaultParty;
  if (party !== undefined && (!Array.isArray(party) || !party.length || party.some((h) => !characters[h]))) err('ui.battleLayout.defaultParty: must list hero ids from characters.json');
  const steal = battleEvents.lifesteal;
  if (steal && !(typeof steal.text === 'string' && steal.text && steal.color)) err('battleEvents.lifesteal: text and color are required');
  const refuse = battleEvents.refuse;
  if (refuse && !(typeof refuse.text === 'string' && refuse.text && refuse.ms > 0 && refuse.color)) err('battleEvents.refuse: text, ms and color are required');

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
      if (!shot.text && shot.text !== '') warn(`${at}: no text`); // "" = a deliberate silent hold
      for (const key of [shot.bg, shot.bg2, shot.bgFallback, shot.bg2Fallback]) if (key && !anyAsset[key]) err(`${at}: image "${key}" is not in assets.json`);
      checkSfx(at, shot.sfx);
      if (shot.whenArt !== undefined) {
        if (!shot.whenArt || typeof shot.whenArt !== 'object' || Array.isArray(shot.whenArt)) err(`${at}: whenArt must be an object of shot fields`);
        else {
          if (!shot.bg) err(`${at}: whenArt needs a bg`);
          for (const key of [shot.whenArt.bg, shot.whenArt.bg2]) if (key && !anyAsset[key]) err(`${at}.whenArt: image "${key}" is not in assets.json`);
          for (const layer of shot.whenArt.layers || []) if (!anyAsset[layer.img]) err(`${at}.whenArt: layer "${layer.img}" is not in assets.json`);
          for (const fx of shot.whenArt.fx || []) if (!SHOT_FX.includes(fx)) err(`${at}.whenArt: unknown fx "${fx}"`);
          if (shot.whenArt.split && !SPLITS.includes(shot.whenArt.split)) err(`${at}.whenArt: unknown split "${shot.whenArt.split}"`);
        }
      }
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
