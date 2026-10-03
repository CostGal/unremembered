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
const SHOT_FX = ['crystal_particles', 'rain', 'flash', 'lights_out', 'dissolve_layer', 'embers', 'eyes_glow', 'red_tint', 'shake', 'red_surge'];
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
  const { techniques = {}, assets = {}, ui = {}, battleEvents = {}, animationSets = {}, tutorial = null } = data;
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

  // Tutorial pauses (tutorial.json): targets from the known list, an indicator, steps with text.
  if (tutorial) {
    const known = new Set(tutorial.targets || []);
    const withHero = new Set(tutorial.targetsWithHero || []);
    const targetOk = (name) => {
      if (known.has(name)) return true;
      const [a, b, c] = name.split('.');
      if (a === 'cmd' && b && !c && techniques[b]) return true; // the slot a technique stands in (technique list open)
      if (a === 'enemy' && b === 'poise' && /^\d+$/.test(c || '')) return true; // enemy n's poise line
      return !!c && withHero.has(`${a}.${b}`) && !!characters[c];
    };
    for (const [pid, def] of Object.entries(tutorial.pauses || {})) {
      const steps = def.steps || [def];
      if (!steps.length) err(`tutorial.pauses.${pid}: no steps`);
      if (def.mode !== undefined && def.mode !== 'guided') err(`tutorial.pauses.${pid}.mode: must be "guided" (or absent)`);
      if (def.mode === 'guided' && steps.length !== 1) err(`tutorial.pauses.${pid}: a guided pause has exactly one step`);
      steps.forEach((st, i) => {
        const at = def.steps ? `tutorial.pauses.${pid}.steps[${i}]` : `tutorial.pauses.${pid}`;
        if (typeof st.text !== 'string' || !st.text) err(`${at}: text must be a non-empty string`);
        if (!Array.isArray(st.targets) || !st.targets.length) err(`${at}: targets must be a non-empty list`);
        for (const name of st.targets || []) if (!targetOk(name)) err(`${at}: unknown target "${name}" (known: ${[...known].join(', ')}; hud.hp.<hero>, hud.echo.<hero>)`);
        if (st.indicator && !['tap', 'swipe'].includes(st.indicator)) err(`${at}: indicator must be null, "tap" or "swipe"`);
        if (st.textIfShort !== undefined && (typeof st.textIfShort !== 'string' || !st.textIfShort)) err(`${at}: textIfShort must be a non-empty string`);
        if (st.boxY !== undefined && st.boxY !== 'auto' && typeof st.boxY !== 'number') err(`${at}: boxY must be a number or "auto"`);
      });
      for (const hint of def.skipHints || []) if (!ui.tutorial?.hints?.[hint]) err(`tutorial.pauses.${pid}.skipHints: "${hint}" is not in ui.tutorial.hints`);
    }
    if (tutorial.recallCard && !tutorial.pauses?.[tutorial.recallCard]) err(`tutorial.recallCard: no pause "${tutorial.recallCard}"`);
    const rl = tutorial.recallLearn;
    if (rl?.enabled && (typeof rl.idPrefix !== 'string' || typeof rl.lineTarget !== 'string')) err('tutorial.recallLearn: idPrefix and lineTarget must be strings');
    const hc = ui.commands?.help;
    if (ui.commands && !(hc && hc.holdMs > 0 && hc.moveTol >= 0 && hc.card?.w > 0 && hc.technique?.short)) err('ui.commands.help: needs holdMs, moveTol, card {w, ...} and technique {name, short}');
  }

  // Battles
  for (const [id, battle] of Object.entries(battles)) {
    if (!backgrounds[battle.bg]) err(`battles.${id}: bg "${battle.bg}" is not in assets.json backgrounds`);
    if (battle.platform !== undefined && !backgrounds[battle.platform]) err(`battles.${id}: platform "${battle.platform}" is not in assets.json backgrounds`);
    if (battle.env !== undefined && !data.environments?.[battle.env]) err(`battles.${id}: env "${battle.env}" is not in environments.json`);
    if (battle.bgShift !== undefined && typeof battle.bgShift !== 'number') err(`battles.${id}.bgShift must be a number (px)`);
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
    // disabledAttacks: {"<enemy id>": ["<attack id>"]} moves this fight never throws (the enemy keeps at least one).
    if (battle.disabledAttacks !== undefined) {
      const da = battle.disabledAttacks;
      if (typeof da !== 'object' || da === null || Array.isArray(da)) err(`battles.${id}.disabledAttacks: must be an object {"<enemy id>": ["<attack id>", ...]}`);
      else {
        for (const [eid, off] of Object.entries(da)) {
          const def = enemies[eid];
          if (!def) err(`battles.${id}.disabledAttacks: no enemy "${eid}" in enemies.json`);
          else if (!(battle.enemies || []).includes(eid)) err(`battles.${id}.disabledAttacks: "${eid}" is not in this battle`);
          else if (!Array.isArray(off)) err(`battles.${id}.disabledAttacks.${eid}: must be a list of attack ids`);
          else {
            const all = (def.stages || def.phases || [{ attacks: def.attacks }]).flatMap((p) => p.attacks.map((a) => a.id));
            for (const aid of off) if (!all.includes(aid)) err(`battles.${id}.disabledAttacks.${eid}: no attack "${aid}"`);
            for (const p of def.stages || def.phases || [{ attacks: def.attacks }]) if (p.attacks.every((a) => off.includes(a.id))) err(`battles.${id}.disabledAttacks.${eid}: every attack of a stage is disabled`);
          }
        }
      }
    }
    // initiative: who opens each round ("hero" = default, "enemy" = the enemies act first).
    if (battle.initiative !== undefined && !['hero', 'enemy'].includes(battle.initiative)) err(`battles.${id}.initiative: must be "hero" or "enemy"`);
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
      if (!thenValid(ev.then)) err(`${at}: then must be an action or a list of actions: "continue", "endBattle", "nalaJumpIn", "nalaGlow" or {"setFlag": "<name>"}`);
      if (thenSplit(ev.then).post.includes('nalaGlow') && !battle.nala) err(`${at}: then "nalaGlow" needs a battle with "nala": true`);
      if (ev.pause !== undefined && !tutorial?.pauses?.[ev.pause]) err(`${at}: pause "${ev.pause}" is not in tutorial.json pauses`);
      if (ev.banner !== undefined && !ui.tutorial?.hints?.[ev.banner]) err(`${at}: banner "${ev.banner}" is not in ui.tutorial.hints`);
    });
    // pauses: {battleStart: id, enemyAttack: {"1": id, ...}} -> tutorial.json pauses.
    const pauseIds = [];
    if (battle.pauses !== undefined) {
      const p = battle.pauses;
      if (typeof p !== 'object' || p === null || Array.isArray(p)) err(`battles.${id}.pauses: must be an object {battleStart, enemyAttack, menuAfterFlag, techniqueMenu}`);
      else {
        if (p.battleStart !== undefined) pauseIds.push(['battleStart', p.battleStart]);
        if (p.enemyAttack !== undefined) {
          for (const [n, pid] of Object.entries(p.enemyAttack || {})) {
            if (!/^[1-9]\d*$/.test(n)) err(`battles.${id}.pauses.enemyAttack: key "${n}" must be an attack number (1, 2, ...)`);
            pauseIds.push([`enemyAttack.${n}`, pid]);
          }
        }
        if (p.menuAfterFlag !== undefined) {
          const flags = new Set((battle.events || []).flatMap((ev) => thenSplit(ev.then).post.map((a) => a?.setFlag).filter(Boolean)));
          for (const [flag, pid] of Object.entries(p.menuAfterFlag || {})) {
            if (!flags.has(flag)) err(`battles.${id}.pauses.menuAfterFlag: flag "${flag}" is never set by one of the battle's events`);
            pauseIds.push([`menuAfterFlag.${flag}`, pid]);
          }
        }
        if (p.techniqueMenu !== undefined) pauseIds.push(['techniqueMenu', p.techniqueMenu]);
        if (p.nalaWatch !== undefined) {
          pauseIds.push(['nalaWatch', p.nalaWatch]);
          if (!battle.nala) err(`battles.${id}.pauses.nalaWatch: the battle has no Nala`);
          if (tutorial?.pauses?.[p.nalaWatch]?.mode !== 'guided') err(`battles.${id}.pauses.nalaWatch: "${p.nalaWatch}" must be a guided pause`);
        }
        // menuFirst {heroId: "learn_<tech>"}: the hero's first command menu explains a move they know at Recall 1
        // (techniques.json help.steps); it is not a tutorial.json pause.
        if (p.menuFirst !== undefined) {
          const prefix = tutorial?.recallLearn?.idPrefix || 'learn_';
          for (const [hero, pid] of Object.entries(p.menuFirst || {})) {
            const tech = typeof pid === 'string' && pid.startsWith(prefix) ? pid.slice(prefix.length) : null;
            const party = battle.party || data.ui?.battleLayout?.defaultParty || [];
            if (!characters[hero]) err(`battles.${id}.pauses.menuFirst: no character "${hero}"`);
            else if (!party.includes(hero)) err(`battles.${id}.pauses.menuFirst: "${hero}" is not in the party`);
            if (!tech || !characters[hero]?.techniques?.includes(tech)) err(`battles.${id}.pauses.menuFirst.${hero}: "${pid}" must be ${prefix}<one of the hero's techniques>`);
            else if (!Array.isArray(techniques[tech]?.help?.steps) || !techniques[tech].help.steps.length) err(`battles.${id}.pauses.menuFirst.${hero}: techniques.${tech}.help.steps is missing`);
          }
        }
        for (const key of Object.keys(p)) if (!['battleStart', 'enemyAttack', 'menuAfterFlag', 'techniqueMenu', 'nalaWatch', 'menuFirst'].includes(key)) err(`battles.${id}.pauses: unknown key "${key}"`);
      }
    }
    for (const [where, pid] of pauseIds) {
      if (!tutorial?.pauses?.[pid]) err(`battles.${id}.pauses.${where}: no pause "${pid}" in tutorial.json`);
    }
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
    // A name, or a list of names that all play at once.
    if (Array.isArray(sfx)) {
      sfx.forEach((one) => checkSfx(at, one));
      return;
    }
    if (typeof sfx !== 'string') err(`${at}: sfx must be a string, a list of strings or null`);
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
      if (line.bg !== undefined && !(assets.backgrounds?.[line.bg]?.cover)) err(`${at}: bg "${line.bg}" must be a cover background in assets.json backgrounds`);
      checkSfx(at, line.sfx);
      if (line.transition !== undefined && line.transition !== 'close') err(`${at}: unknown transition "${line.transition}" (only "close")`);
    });
  }
  // ui.dialogue.noPortraits / transition
  for (const id of ui.dialogue?.noPortraits || []) if (!dialogue[id]) err(`ui.dialogue.noPortraits: no dialogue "${id}" in dialogue.json`);
  const tr = ui.dialogue?.transition;
  if (!(tr?.close?.ms > 0 && Number.isFinite(Number(tr.close.color)) && tr.open?.ms >= 0 && Number.isFinite(tr.depth))) err('ui.dialogue.transition: depth, close {ms, color} and open {ms} are required');
  // dialogue.intro.<id>: an effect before the first line of dialogue <id>.
  for (const [id, intro] of Object.entries(ui.dialogue?.intro || {})) {
    const at = `ui.dialogue.intro.${id}`;
    if (!dialogue[id]) err(`${at}: no dialogue "${id}" in dialogue.json`);
    if (intro.type !== 'eyelids') err(`${at}: unknown type "${intro.type}"`);
    else for (const k of ['openMs', 'blinks', 'blinkMs', 'blinkGapMs', 'blinkDepth', 'blurAlpha', 'blurFadeMs', 'blurScale', 'zoomFrom', 'zoomMs', 'boxFadeMs', 'depth']) if (!Number.isFinite(intro[k])) err(`${at}.${k}: must be a number`);
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

  // Language overlays (data.lang = { <id>: overlay }): the Greek story text is checked against the EN source.
  // An overlay entry with no EN counterpart is an error (it would never show); an EN line without a
  // translation is a warning (it stays English). Overlay text is checked against the Play font too.
  for (const [lang, ov] of Object.entries(data.lang || {})) {
    const at = `lang.${lang}`;
    const textOf = (x) => (x && typeof x === 'object' ? x.text : undefined);
    const fontOv = (path, value) => { for (const [p, t] of uiStrings(value, path)) fontCheck(p, t); };
    fontOv(at, ov);
    // dialogue: { id: [ {text} ] } by line index
    for (const [id, lines] of Object.entries(ov.dialogue || {})) {
      const src = dialogue[id];
      if (!Array.isArray(src)) { err(`${at}.dialogue.${id}: no such dialogue in dialogue.json`); continue; }
      if (!Array.isArray(lines)) { err(`${at}.dialogue.${id}: must be a list of {text}`); continue; }
      if (lines.length > src.length) err(`${at}.dialogue.${id}: ${lines.length} lines but dialogue.json has ${src.length}`);
      lines.forEach((l, i) => { if (i < src.length && src[i].text && !textOf(l)) warn(`${at}.dialogue.${id}[${i}]: untranslated`); });
    }
    for (const [id, src] of Object.entries(dialogue)) {
      if (!Array.isArray(src)) continue;
      const lines = ov.dialogue?.[id];
      if (!lines) { warn(`${at}.dialogue.${id}: whole dialogue untranslated`); continue; }
      src.forEach((l, i) => { if (i >= lines.length && l.text) warn(`${at}.dialogue.${id}[${i}]: untranslated`); });
    }
    // cutscene_origin: { shots: [ {text} ] } by shot index
    const csOv = ov.cutscene_origin?.shots;
    const csSrc = cutscenes.origin?.shots || [];
    if (csOv) {
      if (csOv.length > csSrc.length) err(`${at}.cutscene_origin: ${csOv.length} shots but cutscene_origin.json has ${csSrc.length}`);
      csSrc.forEach((shot, i) => { if (shot.text && !textOf(csOv[i])) warn(`${at}.cutscene_origin.shots[${i}]: untranslated`); });
    } else warn(`${at}.cutscene_origin: untranslated`);
    // tutorial pauses: text / textIfShort / steps[i].text
    const tp = tutorial?.pauses || {};
    for (const [id, pov] of Object.entries(ov.tutorial?.pauses || {})) {
      const src = tp[id];
      if (!src) { err(`${at}.tutorial.pauses.${id}: no such pause in tutorial.json`); continue; }
      for (const k of ['text', 'textIfShort']) if (pov[k] !== undefined && src[k] === undefined) err(`${at}.tutorial.pauses.${id}.${k}: not in tutorial.json`);
      (pov.steps || []).forEach((st, i) => {
        if (!src.steps?.[i]) err(`${at}.tutorial.pauses.${id}.steps[${i}]: not in tutorial.json`);
        else if (st.textIfShort !== undefined && src.steps[i].textIfShort === undefined) err(`${at}.tutorial.pauses.${id}.steps[${i}].textIfShort: not in tutorial.json`);
      });
    }
    for (const [id, src] of Object.entries(tp)) {
      const pov = ov.tutorial?.pauses?.[id];
      if (!pov) { warn(`${at}.tutorial.pauses.${id}: untranslated`); continue; }
      if (src.text && !pov.text) warn(`${at}.tutorial.pauses.${id}.text: untranslated`);
      (src.steps || []).forEach((st, i) => {
        if (st.text && !pov.steps?.[i]?.text) warn(`${at}.tutorial.pauses.${id}.steps[${i}]: untranslated`);
        if (st.textIfShort && !pov.steps?.[i]?.textIfShort) warn(`${at}.tutorial.pauses.${id}.steps[${i}].textIfShort: untranslated`);
      });
    }
    // placeholders ({n}, {hero}...) must survive the translation
    const braces = (t) => (String(t).match(/\{\w+\}/g) || []).sort().join(',');
    const pairs = [];
    (ov.dialogue ? Object.entries(ov.dialogue) : []).forEach(([id, lines]) => lines.forEach((l, i) => pairs.push([`dialogue.${id}[${i}]`, dialogue[id]?.[i]?.text, l?.text])));
    csOv?.forEach((sh, i) => pairs.push([`cutscene_origin.shots[${i}]`, csSrc[i]?.text, sh?.text]));
    for (const [path, en, tr] of pairs) if (typeof en === 'string' && typeof tr === 'string' && braces(en) !== braces(tr)) err(`${at}.${path}: placeholders differ from the English line`);
  }

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
      if (t.type === 'quake') {
        // Tremor: a single enemy (the player picks it) or every enemy, per level.
        for (const [k, def] of [['base', t], ...Object.entries(t.levels || {})]) {
          const tg = def.target ?? t.target;
          if (tg !== 'enemy' && tg !== 'all') err(`techniques.${id}${k === 'base' ? '' : `.levels.${k}`}.target: must be "enemy" or "all"`);
        }
      }
      for (const k of Object.keys(t.levels || {})) {
        if (!(Number.isInteger(Number(k)) && Number(k) >= 1 && Number(k) <= xpAt.length)) err(`techniques.${id}.levels.${k}: level must be a whole number 1..${xpAt.length}`);
      }
    }
    // Move help (techniques.json <id>.help): the long-press card and the Recall card's learn pauses.
    const helpText = (at, str) => {
      if (typeof str !== 'string' || !str) return err(`${at} must be a non-empty string`);
      for (const [, tok] of str.matchAll(/\{(\w+)\}/g)) if (!['amount', 'cost', 'n'].includes(tok)) err(`${at}: unknown token {${tok}}`);
      if (str.length > 80) warn(`${at} is ${str.length} chars: over two lines on a phone`);
    };
    for (const id of ['strike', 'recollection']) if (techniques[id]) helpText(`techniques.${id}.help.short`, techniques[id].help?.short);
    for (const [hero, list] of Object.entries(levels.learn || {})) {
      for (const [id, lv] of Object.entries(list)) {
        const h = techniques[id]?.help;
        if (!techniques[id]) continue;
        helpText(`techniques.${id}.help.short`, h?.short);
        // Remembered at Recall 2+: the card shows "{hero} remembers ..." and the learn pause needs 1-2 steps.
        if (lv > 1 || h?.steps !== undefined) {
          if (!Array.isArray(h?.steps) || h.steps.length < 1 || h.steps.length > 2) err(`techniques.${id}.help.steps: 1-2 short steps (${hero} remembers it at Recall ${lv})`);
          else h.steps.forEach((t, i) => helpText(`techniques.${id}.help.steps[${i}]`, t));
        }
        for (const [k, steps] of Object.entries(h?.upgrades || {})) {
          if (!techniques[id].levels?.[k] || Number(k) <= lv) err(`techniques.${id}.help.upgrades.${k}: not a Recall level where it grows`);
          if (!Array.isArray(steps) || steps.length < 1 || steps.length > 2) err(`techniques.${id}.help.upgrades.${k}: 1-2 short steps`);
          else steps.forEach((t, i) => helpText(`techniques.${id}.help.upgrades.${k}[${i}]`, t));
        }
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
    for (const k of ['popScale', 'popMs']) if (typeof brk.fx?.[k] !== 'number') err(`break.json: fx.${k} must be a number`);
  }

  // impact.json: the impact presets (systems/Impact.js).
  const imp = data.impact;
  if (!imp) err('impact.json: missing');
  else {
    const num = (at, v, min = 0) => {
      if (!(typeof v === 'number' && v >= min)) err(`${at}: must be a number >= ${min}`);
    };
    const colour = (at, v) => {
      if (!Number.isFinite(Number(v))) err(`${at}: must be a 0x colour`);
    };
    for (const id of qteDifficultyIds(data)) num(`impact.json: intensity.${id}`, imp.intensity?.[id]);
    num('impact.json: camera.focus', imp.camera?.focus);
    for (const k of ['flash', 'lines', 'sparks', 'text']) num(`impact.json: depths.${k}`, imp.depths?.[k]);
    num('impact.json: dustSquash', imp.dustSquash);
    num('impact.json: lab.labMs', imp.lab?.labMs, 100);
    for (const name of imp.lab?.presets || []) if (!imp.presets?.[name]) err(`impact.json: lab.presets "${name}" is not a preset`);
    for (const need of ['perfect', 'crit', 'critEnemy', 'break']) if (!imp.presets?.[need]) err(`impact.json: presets.${need} is required`);
    for (const [name, p] of Object.entries(imp.presets || {})) {
      const at = `impact.json: presets.${name}`;
      num(`${at}.hitstopMs`, p.hitstopMs);
      if (p.slowMo) {
        num(`${at}.slowMo.scale`, p.slowMo.scale, 0.05);
        num(`${at}.slowMo.ms`, p.slowMo.ms);
      }
      if (p.zoom) for (const k of ['to', 'inMs', 'outMs']) num(`${at}.zoom.${k}`, p.zoom[k], k === 'to' ? 1 : 0);
      if (p.zoom && p.zoom.to > 1.06) err(`${at}.zoom.to: keep the camera punch <= 1.06 (the HUD zooms with the scene)`);
      if (p.pan) for (const k of ['px', 'ms']) num(`${at}.pan.${k}`, p.pan[k]);
      if (p.shake) for (const k of ['amount', 'ms']) num(`${at}.shake.${k}`, p.shake[k]);
      if ((p.flash || []).length > 2) err(`${at}.flash: at most two layered flashes`);
      for (const [i, f] of (p.flash || []).entries()) {
        colour(`${at}.flash[${i}].color`, f.color);
        num(`${at}.flash[${i}].alpha`, f.alpha);
        num(`${at}.flash[${i}].ms`, f.ms, 1);
      }
      for (const [i, sp] of (p.sparks || []).entries()) {
        colour(`${at}.sparks[${i}].color`, sp.color);
        for (const k of ['count', 'lifeMs', 'size']) num(`${at}.sparks[${i}].${k}`, sp[k], 1);
        if (!(Array.isArray(sp.speed) && sp.speed.length === 2)) err(`${at}.sparks[${i}].speed: [min, max]`);
      }
      if (p.speedLines) {
        colour(`${at}.speedLines.color`, p.speedLines.color);
        for (const k of ['count', 'inner', 'width', 'alpha', 'ms']) num(`${at}.speedLines.${k}`, p.speedLines[k]);
        if (!(Array.isArray(p.speedLines.length) && p.speedLines.length.length === 2)) err(`${at}.speedLines.length: [min, max]`);
      }
      if (p.dustRing) {
        colour(`${at}.dustRing.color`, p.dustRing.color);
        for (const k of ['radius', 'alpha', 'ms', 'lineWidth']) num(`${at}.dustRing.${k}`, p.dustRing[k]);
      }
      if (p.text) {
        for (const k of ['size', 'scale', 'stroke', 'slamMs', 'holdMs', 'fadeMs', 'riseY', 'letterSpacing']) num(`${at}.text.${k}`, p.text[k]);
        if (typeof p.text.offsetY !== 'number') err(`${at}.text.offsetY: must be a number`);
        for (const k of ['color', 'strokeColor']) if (!/^#[0-9a-fA-F]{6}$/.test(p.text[k] || '')) err(`${at}.text.${k}: must be a #rrggbb string`);
      }
      if (p.haptic && !(Array.isArray(p.haptic) && p.haptic.every((n) => typeof n === 'number' && n >= 0))) err(`${at}.haptic: a list of ms`);
      for (const [i, l] of (p.sfx || []).entries()) {
        if (typeof l.name !== 'string' || !(data.audio?.sfx?.[l.name] || (data.sfxFileKeys || []).includes(l.name))) err(`${at}.sfx[${i}]: "${l.name}" is not in audio.json sfx and has no file`);
      }
    }
  }

  if (!techniques.strike) err('techniques.json: "strike" is required');
  if (!techniques.recollection) err('techniques.json: "recollection" is required');

  for (const [id, e] of Object.entries(enemies)) {
    if (!assets.sprites?.[e.body]) err(`enemies.${id}: body sprite "${e.body}" is not in assets.json sprites`);
    if (e.poise !== undefined && !(typeof e.poise === 'number' && e.poise > 0)) err(`enemies.${id}: poise must be a positive number (damage units)`);
    const lists = e.stages ? e.stages.map((p, i) => [`stages[${i}]`, p.attacks]) : e.phases ? e.phases.map((p, i) => [`phases[${i}]`, p.attacks]) : [['attacks', e.attacks]];
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
    // Hooks {dialogue?, pause?}: a story beat and a tutorial.json pause the first time something happens in a
    // battle (onFirstFeint on an attack that feints, defend.onFirstDefend on an enemy that parries or dodges).
    const hookOk = (at, hook) => {
      if (typeof hook !== 'object' || hook === null || (!hook.dialogue && !hook.pause)) return err(`${at}: must be {dialogue, pause} with at least one of them`);
      if (hook.dialogue !== undefined && !dialogue[hook.dialogue]) err(`${at}.dialogue: no dialogue "${hook.dialogue}" in dialogue.json`);
      if (hook.pause !== undefined && !tutorial?.pauses?.[hook.pause]) err(`${at}.pause: "${hook.pause}" is not in tutorial.json pauses`);
    };
    for (const a of lists.flatMap(([, attacks]) => attacks || [])) {
      if (a.onFirstFeint !== undefined) {
        hookOk(`enemies.${id}.${a.id}.onFirstFeint`, a.onFirstFeint);
        if (!(a.hits || [a]).some((h) => h.feint)) err(`enemies.${id}.${a.id}.onFirstFeint: the attack has no feint`);
      }
    }
    if (e.defend?.onFirstDefend !== undefined) hookOk(`enemies.${id}.defend.onFirstDefend`, e.defend.onFirstDefend);
    for (const a of lists.flatMap(([, attacks]) => attacks || [])) {
      // firstUsePause: a tutorial.json pause shown before the first ring of this move (once per run).
      if (a.firstUsePause !== undefined && !tutorial?.pauses?.[a.firstUsePause]) err(`enemies.${id}.${a.id}: firstUsePause "${a.firstUsePause}" is not in tutorial.json pauses`);
      // anim: the sheet slot this move plays; the set must list it (a missing file is fine: placeholder strip).
      const set = animationSets[e.animSet || id];
      if (a.anim && set && !set.animations?.[a.anim]) err(`enemies.${id}.${a.id}: anim "${a.anim}" is not listed in ${e.animSet || id}_animations.json`);
      for (const hit of a.hits || [a]) {
        if (hit.onMiss?.status && !data.statuses?.[hit.onMiss.status]) err(`enemies.${id}.${a.id}: onMiss status "${hit.onMiss.status}" is not in statuses.json`);
      }
    }
    for (const p of e.phases || []) {
      if (p.onEnter && !BATTLE_EVENTS.includes(p.onEnter)) err(`enemies.${id}: unknown phase event "${p.onEnter}"`);
    }
    // stages: a chain of HP stages. The first opens at hpPct % of `hp`; a stage with onZero does not end the
    // enemy at 0 HP: it plays the dialogue, runs the death sheet backwards and rises into the next one at full HP.
    if (e.stages) {
      const st = e.stages;
      if (e.phases) err(`enemies.${id}: use stages or phases, not both`);
      if (!Array.isArray(st) || st.length < 2) err(`enemies.${id}.stages: needs at least two stages`);
      const ids = new Set();
      st.forEach((stage, i) => {
        const at = `enemies.${id}.stages[${i}]`;
        if (!stage.id || typeof stage.id !== 'string') err(`${at}: id is required`);
        else if (ids.has(stage.id)) err(`${at}: duplicate id "${stage.id}"`);
        ids.add(stage.id);
        if (i === 0 && !(stage.hpPct > 0 && stage.hpPct <= 100)) err(`${at}: hpPct (the share of hp the first stage opens with) must be in (0, 100]`);
        if (i > 0 && stage.hpPct !== undefined) err(`${at}: hpPct belongs to the first stage only (later stages refill via the previous onZero.refillTo)`);
        if (!stage.attacks?.length) err(`${at}: no attacks`);
        const last = i === st.length - 1;
        const z = stage.onZero;
        if (!last && !z) err(`${at}: a stage that is not the last needs onZero`);
        if (last && z) err(`${at}: the last stage cannot have onZero (0 HP there is the defeat)`);
        if (z) {
          if (!z.anim || typeof z.anim !== 'string') err(`${at}.onZero: anim is required`);
          if (z.reverseAnim !== undefined && typeof z.reverseAnim !== 'string') err(`${at}.onZero: reverseAnim must be an animation name`);
          if (z.dialogue !== undefined && !dialogue[z.dialogue]) err(`${at}.onZero: no dialogue "${z.dialogue}"`);
          if (z.refillTo !== undefined && !(z.refillTo > 0 && z.refillTo <= 1)) err(`${at}.onZero: refillTo must be in (0, 1]`);
          if (z.sfx !== undefined) checkSfx(`${at}.onZero`, z.sfx);
        }
        if (stage.recollectionAtHpPct !== undefined && !(stage.recollectionAtHpPct > 0 && stage.recollectionAtHpPct < 100)) err(`${at}: recollectionAtHpPct must be in (0, 100)`);
        if (stage.tint !== undefined && !/^0x[0-9a-fA-F]{6}$/.test(stage.tint)) err(`${at}: tint must be a hex string like "0xff6a5a"`);
        const a = stage.aura;
        if (a && !(/^0x[0-9a-fA-F]{6}$/.test(a.color || '') && a.radius > 0 && Array.isArray(a.alpha) && a.alpha.length === 2 && a.pulseMs > 0)) err(`${at}: aura needs color (0xRRGGBB), radius, alpha [min, max] and pulseMs`);
        if (stage.floorHp !== undefined) {
          if (!(Number.isInteger(stage.floorHp) && stage.floorHp >= 1)) err(`${at}: floorHp must be a whole number >= 1`);
          if (stage.recollectionAtHpPct === undefined) err(`${at}: floorHp needs recollectionAtHpPct (the floor holds once the Recollection is unlocked)`);
          if (last === false) err(`${at}: floorHp belongs to the last stage`);
        }
        if (stage.laughEvery !== undefined) {
          const l = stage.laughEvery;
          if (!(Array.isArray(l) && l.length === 2 && Number.isInteger(l[0]) && Number.isInteger(l[1]) && l[0] >= 1 && l[1] >= l[0])) err(`${at}: laughEvery must be [min, max] turns (whole numbers, 1 or more)`);
          else if (stage.laughSfx === undefined) err(`${at}: laughEvery needs laughSfx`);
        }
        if (stage.laughSfx !== undefined) checkSfx(at, stage.laughSfx);
        if (stage.musicIntensity !== undefined && !(stage.musicIntensity >= 0 && stage.musicIntensity <= 1)) err(`${at}: musicIntensity must be in [0, 1]`);
        for (const key of ['opening']) for (const aid of stage[key] || []) if (!(stage.attacks || []).some((x) => x.id === aid)) err(`${at}: ${key} "${aid}" is not one of the stage's attacks`);
      });
    }
    // onChargeStart / onRelease name a battleEvents.json entry (a dialogue played once after the turn).
    for (const a of (e.stages || e.phases || [{ attacks: e.attacks }]).flatMap((p) => p.attacks || [])) {
      for (const hook of ['onChargeStart', 'onRelease']) {
        if (a[hook] === undefined) continue;
        const ev = battleEvents[a[hook]];
        if (!ev?.dialogue) err(`enemies.${id}.${a.id}: ${hook} "${a[hook]}" is not a battleEvents.json entry with a dialogue`);
        else if (!dialogue[ev.dialogue]) err(`battleEvents.${a[hook]}: no dialogue "${ev.dialogue}"`);
      }
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
      if (def.firstAttackWindowMult !== undefined && !(typeof def.firstAttackWindowMult === 'number' && def.firstAttackWindowMult >= 1)) err(`${group}.${id}: firstAttackWindowMult must be a number >= 1`);
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
    const attacks = (e.stages || e.phases) ? (e.stages || e.phases).flatMap((p) => p.attacks || []) : e.attacks || [];
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
      if (p.key !== undefined && !backgrounds[p.key]) err(`${at}.platform.key: "${p.key}" is not in assets.json backgrounds`);
      if (!(typeof p.y === 'number' && p.y >= 0 && p.y <= 360)) err(`${at}.platform.y must be a number within 0..360`);
      for (const k of ['color', 'edgeColor']) if (!Number.isFinite(Number(p[k]))) err(`${at}.platform.${k} must be a 0x colour string`);
      for (const k of ['edgeAlpha', 'bottomAlpha']) if (!(typeof p[k] === 'number' && p[k] >= 0 && p[k] <= 1)) err(`${at}.platform.${k} must be a number in [0, 1]`);
      if (typeof p.depth !== 'number') err(`${at}.platform.depth must be a number`);
    }
    if (env.fallbackBg !== undefined && !backgrounds[env.fallbackBg]) err(`${at}.fallbackBg: "${env.fallbackBg}" is not in assets.json backgrounds`);
    const d = env.drift;
    if (d !== undefined && !(typeof d.x === 'number' && d.x >= 0 && typeof d.ms === 'number' && d.ms > 0)) err(`${at}.drift: x must be a number >= 0 and ms > 0`);
  }
  // Battle backdrop (ui.json battleBackdrop) and each background's ambient motion (assets.json ambient)
  const bb = ui.battleBackdrop;
  if (bb) {
    for (const k of ['desaturate', 'darken']) if (!(typeof bb[k] === 'number' && bb[k] >= 0 && bb[k] <= 1)) err(`ui.battleBackdrop.${k} must be a number in [0, 1]`);
    if (!(bb.fog?.ms > 0 && bb.fog.maxBands >= 0 && bb.fog.texW > 0 && bb.fog.texH > 0)) err('ui.battleBackdrop.fog: ms, maxBands, texW and texH are required');
    if (!(bb.glow?.max >= 0 && bb.glow.texRadius > 0)) err('ui.battleBackdrop.glow: max and texRadius are required');
  }
  for (const [key, def] of Object.entries(backgrounds)) {
    if (def.desaturate !== undefined && !(typeof def.desaturate === 'number' && def.desaturate >= 0 && def.desaturate <= 1)) err(`assets.backgrounds.${key}.desaturate must be a number in [0, 1]`);
    if (def.displayScale !== undefined && !(typeof def.displayScale === 'number' && def.displayScale > 0)) err(`assets.backgrounds.${key}.displayScale must be a number > 0`);
    const amb = def.ambient;
    if (!amb) continue;
    const at = `assets.backgrounds.${key}.ambient`;
    const fog = amb.fog;
    if (fog && !(typeof fog.speedPx === 'number' && fog.speedPx >= 0 && typeof fog.alpha === 'number' && fog.alpha >= 0 && fog.alpha <= 1 && Number.isFinite(Number(fog.color)))) err(`${at}.fog: speedPx (>= 0), alpha (0-1) and a 0x color are required`);
    const points = amb.glowPoints || [];
    if (bb && points.length > bb.glow.max) err(`${at}.glowPoints: at most ${bb.glow.max} (the ambient layer is capped at ${bb.fog.maxBands + bb.glow.max} objects)`);
    points.forEach((g, i) => {
      const gat = `${at}.glowPoints[${i}]`;
      for (const k of ['x', 'y']) if (!(typeof g[k] === 'number' && g[k] >= 0 && g[k] <= 1)) err(`${gat}.${k} must be a number in [0, 1]`);
      if (!(typeof g.r === 'number' && g.r > 0) || !(typeof g.pulseMs === 'number' && g.pulseMs > 0)) err(`${gat}: r and pulseMs must be numbers > 0`);
      if (!(Array.isArray(g.alpha) && g.alpha.length === 2 && g.alpha.every((a) => typeof a === 'number' && a >= 0 && a <= 1))) err(`${gat}.alpha must be [low, high] within 0..1`);
      if (!Number.isFinite(Number(g.color))) err(`${gat}.color must be a 0x colour string`);
    });
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

  const FRAGMENT_EFFECTS = ['startEcho', 'nalaExtraUses', 'perfectWindowMs', 'dovMaxHp', 'perfectEchoBonus', 'blastCritChance', 'anchorBonus', 'counterBonus'];
  for (const [id, f] of Object.entries(data.fragments?.pool || {})) {
    for (const key of Object.keys(f.effects || {})) {
      if (!FRAGMENT_EFFECTS.includes(key)) err(`fragments.${id}: unknown effect "${key}"`);
    }
    if (!f.name || !f.short || !f.text) err(`fragments.${id}: name, short and text are required`);
    if (!['reward', 'scene', 'drop', 'story'].includes(f.source)) err(`fragments.${id}: source must be reward, scene, drop or story`);
  }
  const memories = data.fragments || {};
  const known = (id) => !!memories.pool?.[id];
  for (const [step, ids] of Object.entries(memories.pools || {})) {
    if (!chapter1.some((s) => s.type === 'reward' && s.id === step)) warn(`fragments.pools.${step}: no reward step with that id in chapter1`);
    for (const id of ids) if (!known(id)) err(`fragments.pools.${step}: unknown memory "${id}"`);
  }
  for (const [scene, s] of Object.entries(memories.scenes || {})) {
    if (scene.startsWith('_')) continue;
    if (!dialogue[scene]) err(`fragments.scenes.${scene}: no dialogue "${scene}" in dialogue.json`);
    if (!known(s.id)) err(`fragments.scenes.${scene}: unknown memory "${s.id}"`);
    if (!(Array.isArray(s.at) && s.at.length === 2 && s.at.every((v) => v >= 0 && v <= 1))) err(`fragments.scenes.${scene}.at: [x, y] between 0 and 1`);
    if (!(Array.isArray(s.lines) && s.lines.length === 2 && s.lines[0] <= s.lines[1])) err(`fragments.scenes.${scene}.lines: [first, last]`);
    else if (dialogue[scene] && s.lines[1] >= dialogue[scene].length) err(`fragments.scenes.${scene}.lines: the last line ${s.lines[1]} is past the end of the dialogue`);
  }
  if (Object.keys(memories.scenes || {}).some((k) => !k.startsWith('_')) && !String(memories.pickupBanner?.text || '').includes('{name}')) err('fragments.pickupBanner.text: needs {name}');
  for (const [type, d] of Object.entries(memories.drops || {})) {
    if (!enemies[type]) err(`fragments.drops.${type}: no enemy "${type}" in enemies.json`);
    if (!known(d.id)) err(`fragments.drops.${type}: unknown memory "${d.id}"`);
    if (!(d.chance >= 0 && d.chance <= 1)) err(`fragments.drops.${type}.chance: 0 to 1`);
  }
  if (battleEvents.keepsake_burn?.memory && !known(battleEvents.keepsake_burn.memory)) err(`battleEvents.keepsake_burn.memory: unknown memory "${battleEvents.keepsake_burn.memory}"`);
  for (const [id, a] of Object.entries(allies)) {
    if (!assets.sprites?.[a.body]) err(`allies.${id}: body sprite "${a.body}" is not in assets.json sprites`);
    const h = a.hissCutIn;
    if (h) {
      if (!assets.portraits?.[h.portrait]) err(`allies.${id}.hissCutIn: portrait "${h.portrait}" is not in assets.json portraits`);
      if (typeof h.text !== 'string' || !(h.ms > 0)) err(`allies.${id}.hissCutIn: needs text and ms`);
      const f = ui.cutIn?.flash;
      if (!f || ![f.ms, f.inMs, f.outMs, f.scale, f.startScale, f.punch].every((v) => typeof v === 'number' && v > 0) || h.ms < f.inMs + f.outMs) err(`ui.cutIn.flash: ms/inMs/outMs/scale/startScale/punch are required (and hissCutIn.ms must cover inMs + outMs)`);
    }
  }
  // Nala's Glow (allies.nala): the status it grants, its strike text, the cooldown and the counter / cast looks.
  const nalaDef = allies.nala;
  if (nalaDef) {
    const at = 'allies.nala';
    const st = data.statuses?.[nalaDef.glowStatus];
    if (!st) err(`${at}.glowStatus: "${nalaDef.glowStatus}" is not in statuses.json`);
    else {
      if (st.effect !== 'echoStrike') err(`statuses.${nalaDef.glowStatus}: effect must be "echoStrike" (the Glow's status)`);
      if (!(Number.isInteger(st.turns) && st.turns >= 1)) err(`statuses.${nalaDef.glowStatus}.turns: must be a whole number >= 1`);
      for (const k of ['short', 'color', 'applyText']) if (typeof st[k] !== 'string' || !st[k]) err(`statuses.${nalaDef.glowStatus}.${k}: required (the HUD badge and the pop text)`);
    }
    if (typeof nalaDef.glowStrikeText !== 'string' || !nalaDef.glowStrikeText || typeof nalaDef.glowStrikeColor !== 'string') err(`${at}: glowStrikeText and glowStrikeColor are required`);
    if (!(Number.isInteger(nalaDef.glowCooldownRounds) && nalaDef.glowCooldownRounds >= 0)) err(`${at}.glowCooldownRounds: must be a whole number >= 0`);
    const gc = nalaDef.glowCast;
    if (!gc || ![gc.alertMs, gc.travelMs, gc.staggerMs, gc.radius].every((v) => typeof v === 'number' && v >= 0) || !(gc.radius > 0) || !gc.burst || ![gc.fromColor, gc.toColor].every((v) => Number.isFinite(Number(v)))) err(`${at}.glowCast: alertMs, travelMs, staggerMs, radius, fromColor, toColor and burst are required`);
    const gr = nalaDef.glowReady;
    if (!gr || ![gr.radius, gr.alphaMin, gr.alphaMax, gr.pulseMs].every((v) => typeof v === 'number') || !Number.isFinite(Number(gr.color))) err(`${at}.glowReady: color, radius, alphaMin, alphaMax and pulseMs are required`);
    const gk = nalaDef.counter;
    if (!gk || typeof gk.cooldownText !== 'string' || !gk.cooldownText.includes('{n}') || typeof gk.readyText !== 'string' || !(gk.fontSize > 0)) err(`${at}.counter: readyText, cooldownText (with {n}) and fontSize are required`);
    // Every battle that ends a round-quiet event needs Hollow-immune Strikes to be meaningful: warn when the key is used without one.
    for (const [bid, b] of Object.entries(battles)) {
      const usesQuiet = (b.events || []).some((ev) => JSON.stringify(ev.when).includes('noHollowDamageRounds'));
      if (usesQuiet && !(b.enemies || []).some((k) => enemies[k]?.hollow && enemies[k]?.immune?.includes('strike'))) warn(`battles.${bid}: a noHollowDamageRounds event but no Strike-immune Hollow in the battle`);
    }
  }
  if (Object.values(enemies).some((e) => e.stages)) {
    const sg = battleEvents.stage;
    if (Object.values(enemies).some((e) => (e.stages || []).some((x) => x.floorHp !== undefined)) && !(typeof sg?.floorText === 'string' && sg.floorText && sg.floorColor)) err('battleEvents.stage: floorText and floorColor are required when a stage has floorHp');
    if (!(sg && typeof sg.enragedText === 'string' && sg.enragedText && sg.enragedColor && typeof sg.laughText === 'string' && sg.laughColor && sg.deathHoldMs >= 0 && sg.riseMs > 0 && sg.fallbackDeathAlpha >= 0 && sg.fallbackDeathAlpha <= 1)) err('battleEvents.stage: enragedText, enragedColor, laughText ("" = none), laughColor, deathHoldMs, riseMs and fallbackDeathAlpha are required');
  }
  for (const [id, e] of Object.entries(enemies)) {
    for (const [i, stage] of (e.stages || []).entries()) {
      for (const name of [stage.onZero?.anim, stage.onZero?.reverseAnim]) {
        if (name && animationSets[id] && !animationSets[id].animations?.[name]) warn(`enemies.${id}.stages[${i}].onZero: no "${name}" animation in ${id}_animations.json (fallback: the body dims and fades back)`);
      }
    }
  }
  // Blast's aim ring (Recall 5, levels.5.aimMinigame): a gold ring, +critBonus crit chance on a timed tap.
  {
    const a = techniques.blast?.aim;
    const wants = Object.values(techniques.blast?.levels || {}).some((l) => l.aimMinigame);
    if (wants && !a) err('techniques.blast.levels: aimMinigame needs techniques.blast.aim');
    if (a) {
      if (!(a.ringMs > 0)) err('techniques.blast.aim.ringMs must be a number > 0');
      if (!(typeof a.critBonus === 'number' && a.critBonus > 0 && a.critBonus <= 1)) err('techniques.blast.aim.critBonus must be a number in (0, 1]');
      if (typeof a.text !== 'string' || !a.text) err('techniques.blast.aim.text must be a non-empty string');
      if (!/^#[0-9a-fA-F]{6}$/.test(a.color || '')) err('techniques.blast.aim.color must be a #rrggbb colour');
    }
  }
  // Brace (whole-round guard counter): the damage multiplier, and what every hit that lands gives back.
  {
    const b = techniques.brace;
    if (b) {
      if (!(typeof b.damageMult === 'number' && b.damageMult > 0 && b.damageMult < 1)) err('techniques.brace.damageMult must be a number in (0, 1)');
      if (b.holdsRound !== undefined && typeof b.holdsRound !== 'boolean') err('techniques.brace.holdsRound must be true or false');
      for (const k of ['echoPerHit', 'poisePerHit']) {
        if (b[k] !== undefined && !(Number.isInteger(b[k]) && b[k] >= 0)) err(`techniques.brace.${k} must be a whole number >= 0`);
      }
      for (const k of ['castText', 'blockText']) if (typeof b[k] !== 'string' || !b[k]) err(`techniques.brace.${k} must be a non-empty string`);
      if (b.echoPerHit > 0 && (typeof b.counterText !== 'string' || !b.counterText)) err('techniques.brace.counterText must be a non-empty string (echoPerHit > 0)');
    }
  }
  if (techniques.recollection?.kill !== undefined && typeof techniques.recollection.kill !== 'boolean') err('techniques.recollection.kill must be true or false');
  validateRecollection(data, dialogue, enemies, ui, err);
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
      for (const [field, v] of [['redTint', shot.redTint], ['redTint', shot.whenArt?.redTint]]) {
        if (v !== undefined && !(typeof v === 'number' && v >= 0 && v <= 1)) err(`${at}: ${field} must be an alpha 0-1`);
      }
      for (const v of [shot.surgeAt, shot.whenArt?.surgeAt]) {
        if (v !== undefined && !(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1))) err(`${at}: surgeAt must be [x, y], each 0-1 of the picture`);
      }
      if ((shot.redTint !== undefined || shot.whenArt?.redTint !== undefined) && ![...(shot.fx || []), ...(shot.whenArt?.fx || [])].includes('red_tint')) warn(`${at}: redTint is set but the shot has no red_tint fx`);
      for (const [field, v] of [['view', shot.view], ['bgView', shot.bgView], ['bg2View', shot.bg2View], ['crossfadeTo.view', shot.crossfadeTo?.view]]) {
        if (v === undefined) continue;
        const focus = v?.focus;
        if (!(Array.isArray(focus) && focus.length === 2 && focus.every((n) => typeof n === 'number' && n >= 0 && n <= 1))) err(`${at}: ${field}.focus must be [x, y], each 0-1 of the picture`);
        if (v.zoom !== undefined && !(typeof v.zoom === 'number' && v.zoom > 0)) err(`${at}: ${field}.zoom must be a positive number`);
      }
      if (shot.crossfadeTo !== undefined) {
        const c = shot.crossfadeTo;
        if (!c || !anyAsset[c.bg]) err(`${at}: crossfadeTo.bg "${c?.bg}" is not in assets.json`);
        else if (!(typeof c.atPct === 'number' && c.atPct >= 0 && c.atPct < 1) || !(typeof c.ms === 'number' && c.ms > 0)) err(`${at}: crossfadeTo needs atPct (0-1) and ms (> 0)`);
        if (shot.split && shot.split !== 'none') err(`${at}: crossfadeTo does not work with a split`);
      }
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
        if (def.oneShot) {
          if (bars > 16) warn(`${at}: a one-shot of ${bars} bars is long`);
        } else if (bars < 32 || bars > 64) warn(`${at}: ${bars} bars (aim for 32–64)`);
      } catch (e) {
        err(`${at}: ${e.message}`);
      }
    }
    for (const [key, battle] of Object.entries(battles)) {
      if (battle.music && !music.tracks[battle.music] && !(data.musicFileKeys || []).includes(battle.music) && !data.audio?.music?.aliases?.[battle.music]) warn(`battles.${key}: music "${battle.music}" has no procedural track (needs the .mp3 or silence)`);
    }
  }

  // Music wiring (audio.json music.aliases / loop / procedural / placement): every key a scene can
  // ask for resolves to a file or a procedural track, one-shots do not loop, the cutscene ranges
  // cover the shots, and the hooks point at lines and speakers that exist.
  const am = data.audio?.music;
  if (am && music) {
    const files = new Set(data.musicFileKeys || []);
    const known = (key) => files.has(key) || !!music.tracks?.[key];
    const resolves = (key) => known(am.aliases?.[key] || key);
    const need = (at, key, { oneShot = false } = {}) => {
      if (key === null || key === undefined) return;
      // A placement entry may be {track, crossfadeMs}: the fade for that one change.
      if (key && typeof key === 'object' && !Array.isArray(key)) {
        if (key.crossfadeMs !== undefined && !(Number.isFinite(key.crossfadeMs) && key.crossfadeMs >= 0)) err(`${at}.crossfadeMs: must be a number >= 0`);
        return need(at + '.track', key.track, { oneShot });
      }
      if (typeof key !== 'string') err(`${at}: a music key must be a string or null`);
      else if (!resolves(key)) err(`${at}: music "${key}" has no file in public/assets/audio/music/, no procedural track in music.json and no alias`);
      else if (oneShot && am.loop?.[key] !== false) err(`${at}: "${key}" plays as a one-shot, so audio.json music.loop.${key} must be false`);
    };
    for (const [alias, target] of Object.entries(am.aliases || {})) {
      if (!known(target)) err(`audio.json music.aliases.${alias}: target "${target}" has no file and no procedural track`);
      if (known(alias)) warn(`audio.json music.aliases.${alias}: a file or track of that name exists too (the alias wins)`);
    }
    for (const key of am.procedural || []) if (!music.tracks?.[key]) err(`audio.json music.procedural: "${key}" has no track in music.json`);
    for (const key of Object.keys(am.loop || {})) if (!resolves(key) && !(am.procedural || []).includes(key)) warn(`audio.json music.loop.${key}: not a known music key`);
    for (const key of files) if (!(key in (am.loop || {}))) warn(`audio.json music.loop: no loop flag for the file "${key}" (it loops)`);
    for (const [k, v] of Object.entries(music.tracks || {})) if (v.oneShot && am.loop?.[k] !== false) err(`music.json ${k} is a oneShot track, so audio.json music.loop.${k} must be false`);
    for (const key of am.bootPrefetch || []) need('audio.json music.bootPrefetch', key);
    for (const [key, pts] of Object.entries(am.loopPoints || {})) {
      if (!(Array.isArray(pts) && pts.length === 2 && pts[0] >= 0 && pts[1] > pts[0])) err(`audio.json music.loopPoints.${key}: must be [startSec, endSec]`);
      if (am.loop?.[key] === false) err(`audio.json music.loopPoints.${key}: the track does not loop`);
    }
    for (const name of data.audio.sfxLong || []) if (!sfxKeys.has(name)) err(`audio.json sfxLong: "${name}" is not an sfx`);
    for (const [scene, key] of Object.entries(am.scenes || {})) need(`audio.json music.scenes.${scene}`, key);
    if (am.prefetchPolicy !== undefined && !['next-step', 'all'].includes(am.prefetchPolicy)) err('audio.json music.prefetchPolicy must be "next-step" or "all"');
    const pl = am.placement;
    if (pl) {
      for (const [scene, key] of Object.entries(pl.scenes || {})) need(`placement.scenes.${scene}`, key);
      for (const [id, key] of Object.entries(pl.dialogue || {})) {
        if (!dialogue[id]) err(`placement.dialogue.${id}: no dialogue "${id}"`);
        need(`placement.dialogue.${id}`, key);
      }
      for (const [id, sw] of Object.entries(pl.dialogueSwitch || {})) {
        const at = `placement.dialogueSwitch.${id}`;
        need(at, sw.key, { oneShot: !!sw.oneShot });
        if (!dialogue[id]) err(`${at}: no dialogue "${id}"`);
        else if (!dialogue[id].some((line) => line.speaker === sw.speaker)) err(`${at}: no line of "${id}" is spoken by "${sw.speaker}"`);
      }
      for (const [id, st] of Object.entries(pl.step || {})) {
        if (!chapter1.some((step) => step.id === id)) err(`placement.step.${id}: no chapter step "${id}"`);
        need(`placement.step.${id}.oneShot`, st.oneShot, { oneShot: true });
        need(`placement.step.${id}.over`, st.over?.track);
      }
      for (const [id, def] of Object.entries(pl.overlay || {})) {
        need(`placement.overlay.${id}`, def.track, { oneShot: def.resume === false || def.resume === true });
      }
      for (const [id, ev] of Object.entries(pl.events || {})) {
        need(`placement.events.${id}`, ev.oneShot, { oneShot: true });
        need(`placement.events.${id}`, ev.track);
      }
      if (pl.keepsakeDialogue !== undefined) {
        const lines = dialogue[pl.keepsakeDialogue];
        if (!lines) err(`placement.keepsakeDialogue: no dialogue "${pl.keepsakeDialogue}"`);
        else if (!Number.isInteger(pl.keepsakeSilenceAfterLine) || pl.keepsakeSilenceAfterLine < 0 || pl.keepsakeSilenceAfterLine >= lines.length) err(`placement.keepsakeSilenceAfterLine: must be a line index of "${pl.keepsakeDialogue}" (0-${lines.length - 1})`);
        if (!(pl.keepsakeSilenceMs >= 0)) err('placement.keepsakeSilenceMs: must be a number of ms');
      }
      for (const [id, bp] of Object.entries(pl.battle || {})) {
        const battle = battles[id];
        if (!battle) {
          err(`placement.battle.${id}: no battle "${id}"`);
          continue;
        }
        const stages = typeof bp === 'string' ? [bp] : [bp.stage1, bp.stage2];
        need(`placement.battle.${id}`, stages[0]);
        if (battle.music !== stages[0]) err(`placement.battle.${id}: music "${stages[0]}" differs from battles.${id}.music "${battle.music}"`);
        if (typeof bp !== 'string') {
          need(`placement.battle.${id}.stageChange`, bp.stageChange?.oneShot, { oneShot: true });
          const boss = (battle.enemies || []).map((e) => enemies[e]).find((e) => e?.stages);
          const music2 = boss?.stages?.[1]?.music;
          if (bp.stage2 && music2 !== bp.stage2) err(`placement.battle.${id}: stage2 "${bp.stage2}" differs from the enemy's stages[1].music "${music2}"`);
        }
      }
      for (const [id, battle] of Object.entries(battles)) {
        need(`battles.${id}.music`, battle.music);
        if (battle.music && !(id in (pl.battle || {}))) warn(`placement.battle: no entry for battle "${id}"`);
      }
      for (const [id, enemy] of Object.entries(enemies)) (enemy.stages || []).forEach((stage, i) => need(`enemies.${id}.stages[${i}].music`, stage.music));
      for (const [name, note] of Object.entries(pl.sfxCues || {})) if (!sfxKeys.has(name)) err(`placement.sfxCues.${name}: not in audio.json sfx (${note})`);
      // Cutscene ranges: shot indexes, contiguous from 0 to the last shot.
      for (const [key, plan] of Object.entries(pl)) {
        const m = /^cutscene_(.+)$/.exec(key);
        if (!m) continue;
        const shots = cutscenes[m[1]]?.shots;
        if (!shots) {
          err(`placement.${key}: no cutscene "${m[1]}"`);
          continue;
        }
        let next = 0;
        (plan.ranges || []).forEach((r, i) => {
          const at = `placement.${key}.ranges[${i}]`;
          need(at, r.track);
          if (r.from !== next) err(`${at}: starts at shot ${r.from}, expected ${next} (ranges must be contiguous from 0)`);
          if (!(r.to >= r.from)) err(`${at}: to ${r.to} is before from ${r.from}`);
          next = r.to + 1;
        });
        if (next !== shots.length) err(`placement.${key}: ranges end at shot ${next - 1}, the cutscene has ${shots.length} shots (0-${shots.length - 1})`);
      }
    }
  }

  return { errors, warnings };
}

// recollection.json (the minigame "Burn the memory"), the forced no-input attack it falls back on
// (enemies.json `noInput`, e.g. Unwriting), the cut-in (ui.json cutIn) and the lose card's buttons.
function validateRecollection(data, dialogue, enemies, ui, err) {
  const rc = data.recollection;
  const pos = (v) => typeof v === 'number' && v > 0;
  const nonNeg = (v) => typeof v === 'number' && v >= 0;
  const str = (v) => typeof v === 'string' && v.length > 0;
  const allAttacks = Object.entries(enemies).flatMap(([id, e]) => (e.stages || e.phases || [{ attacks: e.attacks }]).flatMap((p) => (p.attacks || []).map((a) => [id, a])));
  for (const [id, a] of allAttacks) {
    const at = `enemies.${id}.${a.id}`;
    if (a.noInput !== undefined && typeof a.noInput !== 'boolean') err(`${at}: noInput must be true or false`);
    if (a.allHeroes !== undefined && typeof a.allHeroes !== 'boolean') err(`${at}: allHeroes must be true or false`);
    if (a.noInput) {
      if (a.weight !== 0) err(`${at}: a noInput attack must have weight 0 (it is only ever forced)`);
      if (a.hits || a.chargeTurns) err(`${at}: a noInput attack is a single hit (no hits, no chargeTurns)`);
      if (!pos(a.telegraphMs) || !pos(a.dmg)) err(`${at}: a noInput attack needs telegraphMs and dmg`);
    }
  }
  if (!rc) return;
  const at = 'recollection.json';
  if (!['beats', 'rings'].includes(rc.mode)) err(`${at}: mode must be "beats" or "rings"`);
  if (rc.mode === 'rings') return;
  if (!dialogue[rc.cutIn]) err(`${at}: cutIn "${rc.cutIn}" is not in dialogue.json`);
  if (!nonNeg(rc.startDelayMs) || !nonNeg(rc.gapMs) || !pos(rc.depth)) err(`${at}: startDelayMs, gapMs (>= 0) and depth are required`);
  const kinds = ['hold', 'swipe', 'taps'];
  if (!Array.isArray(rc.order) || !rc.order.length || rc.order.some((k) => !kinds.includes(k))) err(`${at}: order must list beats from ${kinds.join(', ')}`);
  const b = rc.beats || {};
  for (const k of rc.order || []) if (!b[k] || !str(b[k].prompt)) err(`${at}: beats.${k} needs a prompt`);
  const h = b.hold;
  if (h) {
    const z = h.zonePct;
    if (!pos(h.holdMs) || !(h.centrePct > 0 && h.centrePct < 1)) err(`${at}: beats.hold needs holdMs and centrePct in (0, 1)`);
    if (!(Array.isArray(z) && z.length === 2 && z[0] >= 0 && z[0] < z[1] && z[1] <= 1 && h.centrePct >= z[0] && h.centrePct <= z[1])) err(`${at}: beats.hold.zonePct must be [from, to] in 0-1 around centrePct`);
    if (!pos(h.perfectMs) || !(h.goodMs >= h.perfectMs) || !nonNeg(h.graceMs) || !pos(h.waitMs)) err(`${at}: beats.hold needs perfectMs <= goodMs, graceMs and waitMs`);
    if (!h.gauge || ![h.gauge.x, h.gauge.y, h.gauge.w, h.gauge.h].every(pos)) err(`${at}: beats.hold.gauge needs x, y, w, h`);
  }
  const sw = b.swipe;
  if (sw) {
    if (!pos(sw.swipeMs) || !(sw.perfectMs > 0 && sw.perfectMs <= sw.swipeMs)) err(`${at}: beats.swipe needs swipeMs and perfectMs in (0, swipeMs]`);
    if (!Array.isArray(sw.directions) || !sw.directions.length || sw.directions.some((d) => !['up', 'down', 'left', 'right'].includes(d))) err(`${at}: beats.swipe.directions must list up / down / left / right`);
    if (!sw.arrow || ![sw.arrow.length, sw.arrow.shaft, sw.arrow.head].every(pos)) err(`${at}: beats.swipe.arrow needs length, shaft, head`);
  }
  const t = b.taps;
  if (t) {
    if (!(Number.isInteger(t.taps) && t.taps >= 1) || !pos(t.tapWindowMs) || !(t.perfectSpareMs >= 0 && t.perfectSpareMs < t.tapWindowMs) || !pos(t.waitMs)) err(`${at}: beats.taps needs taps (>= 1), tapWindowMs, perfectSpareMs in [0, tapWindowMs) and waitMs`);
    if (!t.meter || ![t.meter.x, t.meter.y, t.meter.w, t.meter.h, t.meter.timeBarH].every(pos)) err(`${at}: beats.taps.meter needs x, y, w, h and timeBarH`);
    const tc = t.counter;
    if (!tc || !str(tc.text) || !tc.text.includes('{i}') || !tc.text.includes('{n}') || ![tc.x, tc.y, tc.fontSize, tc.popScale, tc.popMs].every(pos)) err(`${at}: beats.taps.counter needs text with {i} and {n}, x, y, fontSize, popScale, popMs`);
    const fx = t.fx;
    if (!fx || !pos(fx.tapSparks?.count) || !pos(fx.tapSparks?.size) || !nonNeg(fx.tapShake) || !nonNeg(fx.tapShakeMs) || !nonNeg(fx.tapFlashMs) || !str(fx.crack?.color)) err(`${at}: beats.taps.fx needs tapSparks {count, size, ...}, tapShake, tapShakeMs, tapFlashMs and crack.color`);
    else {
      const sfx = data.audio?.sfx;
      for (const name of [fx.tapSfx, fx.milestoneSfx]) if (name && sfx && !(name in sfx)) err(`${at}: beats.taps.fx sfx "${name}" is not in audio.json sfx`);
      for (const [n, m] of Object.entries(fx.milestones || {})) {
        if (!(Number(n) >= 1 && Number(n) <= t.taps)) err(`${at}: beats.taps.fx.milestones.${n}: must be a tap count in 1-${t.taps}`);
        if (!pos(m.pitch)) err(`${at}: beats.taps.fx.milestones.${n}.pitch must be a number > 0`);
      }
    }
  }
  const ac = rc.autoCast;
  if (ac !== undefined && (!nonNeg(ac.delayMs) || !(Number.isInteger(ac.reviveHp) && ac.reviveHp >= 1))) err(`${at}: autoCast needs delayMs (>= 0) and reviveHp (integer >= 1)`);
  for (const r of ['PERFECT', 'GOOD', 'MISS']) if (!rc.results?.[r] || !str(rc.results[r].text) || !str(rc.results[r].color) || !str(rc.results[r].sfx)) err(`${at}: results.${r} needs text, color and sfx`);
  for (const g of ['FLAWLESS', 'CLEAN', 'ROUGH']) if (!rc.grades?.[g] || !str(rc.grades[g].title) || typeof rc.grades[g].sub !== 'string' || !str(rc.grades[g].color)) err(`${at}: grades.${g} needs title, sub and color`);
  const f = rc.fail;
  if (!f || !str(f.text)) err(`${at}: fail.text is required`);
  else if (!allAttacks.some(([, a]) => a.id === f.forceAttack && a.noInput)) err(`${at}: fail.forceAttack "${f.forceAttack}" is not a noInput attack in enemies.json`);
  if (!str(rc.noEscape?.text)) err(`${at}: noEscape.text is required`);
  if (!str(rc.card?.text) || !rc.card.text.includes('{grade}')) err(`${at}: card.text must contain {grade}`);
  if (!str(rc.finisher?.sfx) || !pos(rc.finisher?.sparks?.count) || !nonNeg(rc.finisher?.hitstopMs)) err(`${at}: finisher needs sfx, sparks.count and hitstopMs`);
  const end = ui.battleEnd || {};
  if (!str(end.retryRecollectionText) || !str(end.quitText)) err('ui.battleEnd: retryRecollectionText and quitText are required (the lose card after a failed Recollection)');
  for (const slot of ['retryRecollection', 'quit']) if (!ui.commands?.slots?.[slot]) err(`ui.commands.slots.${slot} is required`);
  const c = ui.cutIn;
  if (!c || !c.band || !pos(c.band.h) || !pos(c.band.slideMs) || !pos(c.holdMs) || !c.portrait?.fallback || !pos(c.text?.charsPerSec)) err('ui.cutIn: band {y, h, slideMs, ...}, portrait {fallback}, text {charsPerSec} and holdMs are required');
  for (const line of dialogue[rc.cutIn] || []) if (line.portrait && !data.assets?.portraits?.[line.portrait]) err(`dialogue.${rc.cutIn}: portrait "${line.portrait}" is not in assets.json portraits`);
}

function qteDifficultyIds(data) {
  return data.qte?.difficulties?.order || [];
}
