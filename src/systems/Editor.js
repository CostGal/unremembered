// Data operations of the dev-only dialogue editor (?editor, scenes/EditorScene.js).
// Pure functions, no DOM and no Phaser, so they also run in node (scripts/qa/editor.mjs).
//
// A model holds working copies of dialogue.json and cutscene_origin.json plus, per
// line / shot, the JSON text it had when loaded (`origs`, null for one added in the
// editor) so the editor can mark what changed and revert one entry. Nothing here
// writes to disk: the page only offers the serialised files for download.
//
// Greek (second language): every line / shot also carries a language record
// {el, hash, orig}: `el` = the Greek text (null = none), `hash` = hashText() of the English
// it was written against (null with no Greek), `orig` = {el, hash} as loaded (null = new
// entry). A Greek text is stale when its hash is not the hash of the current English: that is
// how "EN changed" is told, and src/data/lang/el.meta.json (what the editor writes on
// download) is where the hashes persist, so el.json itself stays clean. The Tutorial texts
// are Greek-only entries (the English tutorial.json is edited by hand): {kind: 'tut', index}.
//
// Selection: {kind: 'dialogue', id, index} | {kind: 'shot', index} | {kind: 'tut', index}.

const clone = (value) => JSON.parse(JSON.stringify(value));

// FNV-1a over UTF-16 units, 8 hex digits: enough to notice that an English line changed.
export function hashText(text) {
  let h = 0x811c9dc5;
  const t = String(text ?? '');
  for (let i = 0; i < t.length; i += 1) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Every translatable string of tutorial.json's pauses, in file order:
// {key, id, step (null | index), field ('text' | 'textIfShort'), en, label}.
export function tutorialItems(tutorial) {
  const out = [];
  for (const [id, pause] of Object.entries(tutorial?.pauses || {})) {
    for (const field of ['text', 'textIfShort']) {
      if (typeof pause[field] === 'string') out.push({ key: `${id}.${field}`, id, step: null, field, en: pause[field], label: `${id} · ${field}` });
    }
    (pause.steps || []).forEach((st, i) => {
      for (const field of ['text', 'textIfShort']) {
        if (typeof st[field] === 'string') out.push({ key: `${id}.steps.${i}.${field}`, id, step: i, field, en: st[field], label: `${id} · step ${i + 1}${field === 'text' ? '' : ' (short)'}` });
      }
    });
  }
  return out;
}

const elOfTutorial = (overlay, item) => {
  const pause = overlay?.tutorial?.pauses?.[item.id];
  const node = item.step === null ? pause : pause?.steps?.[item.step];
  return typeof node?.[item.field] === 'string' && node[item.field] ? node[item.field] : null;
};

const rec = (el, hash, orig) => ({ el: el || null, hash: el ? hash : null, orig });
const srcRec = (el, en, hash) => {
  const r = rec(el, hash ?? hashText(en));
  r.orig = { el: r.el, hash: r.hash };
  return r;
};

// lang = {overlay: el.json, meta: el.meta.json, tutorial: tutorial.json (English)}, all optional.
export function createModel(dialogue, cutscene, lang = {}) {
  const model = { dialogue: clone(dialogue), cutscene: clone(cutscene), origs: { dialogue: {}, shots: [] }, lang: { dialogue: {}, shots: [] }, tut: [] };
  const ov = lang.overlay || {};
  const meta = lang.meta || {};
  for (const [id, lines] of Object.entries(model.dialogue)) {
    model.origs.dialogue[id] = lines.map((l) => JSON.stringify(l));
    model.lang.dialogue[id] = lines.map((l, i) => srcRec(ov.dialogue?.[id]?.[i]?.text, l.text, meta.dialogue?.[id]?.[i]));
  }
  model.origs.shots = model.cutscene.shots.map((s) => JSON.stringify(s));
  model.lang.shots = model.cutscene.shots.map((sh, i) => srcRec(ov.cutscene_origin?.shots?.[i]?.text, sh.text, meta.cutscene_origin?.[i]));
  model.tut = tutorialItems(lang.tutorial).map((item) => ({ ...item, rec: srcRec(elOfTutorial(ov, item), item.en, meta.tutorial?.[item.key]) }));
  return model;
}

// A draft is the working copy (+ the Greek records); origs are rebuilt from the sources, so
// restoring it is only trusted when the ids still match.
export function toDraft(model) {
  const pick = (r) => ({ el: r.el, hash: r.hash });
  return {
    dialogue: model.dialogue,
    cutscene: model.cutscene,
    lang: {
      dialogue: Object.fromEntries(Object.entries(model.lang.dialogue).map(([id, rs]) => [id, rs.map(pick)])),
      shots: model.lang.shots.map(pick),
      tut: Object.fromEntries(model.tut.map((t) => [t.key, pick(t.rec)])),
    },
  };
}

export function fromDraft(source, draft) {
  if (!draft || typeof draft !== 'object' || typeof draft.dialogue !== 'object' || !draft.cutscene || !Array.isArray(draft.cutscene.shots)) return null;
  const model = createModel(source.dialogue, source.cutscene, source.lang);
  const base = { dialogue: model.lang.dialogue, shots: model.lang.shots };
  for (const [id, lines] of Object.entries(draft.dialogue)) {
    if (!Array.isArray(lines)) return null;
    // Parallel origs: the source's line at the same position while it still exists, else "new".
    const origs = model.origs.dialogue[id] || [];
    model.origs.dialogue[id] = lines.map((_, i) => origs[i] ?? null);
  }
  model.dialogue = clone(draft.dialogue);
  model.cutscene = clone(draft.cutscene);
  model.origs.shots = model.cutscene.shots.map((_, i) => model.origs.shots[i] ?? null);
  // Greek records: the draft's value over the source's orig (an old draft without `lang` keeps the source Greek).
  const fit = (list, srcRecs, saved) =>
    list.map((entry, i) => {
      const src = srcRecs?.[i];
      const orig = src ? clone(src.orig) : null;
      const d = saved?.[i];
      if (d && typeof d === 'object') return { el: d.el || null, hash: d.el ? d.hash ?? hashText(entry.text) : null, orig };
      return src ? clone(src) : rec(null, null, orig);
    });
  model.lang.dialogue = Object.fromEntries(Object.entries(model.dialogue).map(([id, lines]) => [id, fit(lines, base.dialogue[id], draft.lang?.dialogue?.[id])]));
  model.lang.shots = fit(model.cutscene.shots, base.shots, draft.lang?.shots);
  for (const t of model.tut) {
    const d = draft.lang?.tut?.[t.key];
    if (d && typeof d === 'object') t.rec = { el: d.el || null, hash: d.el ? d.hash ?? hashText(t.en) : null, orig: t.rec.orig };
  }
  return model;
}

export function entries(model, sel) {
  if (sel.kind === 'tut') return model.tut.map((t) => ({ text: t.en, label: t.label }));
  return sel.kind === 'shot' ? model.cutscene.shots : model.dialogue[sel.id];
}

export function origsOf(model, sel) {
  if (sel.kind === 'tut') return [];
  return sel.kind === 'shot' ? model.origs.shots : model.origs.dialogue[sel.id];
}

// The Greek records parallel to a selection's list (tutorial: one per item).
export function langList(model, sel) {
  if (sel.kind === 'tut') return model.tut.map((t) => t.rec);
  return sel.kind === 'shot' ? model.lang.shots : model.lang.dialogue[sel.id];
}

export function langOf(model, sel) {
  return langList(model, sel)?.[sel.index];
}

// 'na' (the English has no text) | 'missing' (no Greek) | 'stale' (English changed since the
// Greek was written) | 'ok'.
export function langState(model, sel) {
  const en = entryOf(model, sel)?.text;
  const r = langOf(model, sel);
  if (!en) return 'na';
  if (!r || !r.el) return 'missing';
  return r.hash === hashText(en) ? 'ok' : 'stale';
}

// Writing the Greek stamps it with the English it answers; an empty box = no Greek.
export function setLang(model, sel, text) {
  const r = langOf(model, sel);
  if (!r) return;
  r.el = text && text.trim() ? text : null;
  r.hash = r.el ? hashText(entryOf(model, sel).text) : null;
}

// "The Greek is still right": re-stamp it with the current English.
export function markFresh(model, sel) {
  const r = langOf(model, sel);
  if (r?.el) r.hash = hashText(entryOf(model, sel).text);
}

export function entryOf(model, sel) {
  return entries(model, sel)?.[sel.index];
}

// value undefined removes the key; a new key goes at the end (existing keys keep their order).
export function setField(model, sel, field, value) {
  const entry = entryOf(model, sel);
  if (!entry) return;
  if (value === undefined) delete entry[field];
  else entry[field] = value;
}

const langChanged = (r) => !!r && (r.orig === null || r.el !== r.orig.el || r.hash !== r.orig.hash);

// English changed / new, or the Greek changed (text or stamp).
export function isModified(model, sel) {
  if (sel.kind !== 'tut') {
    const orig = origsOf(model, sel)?.[sel.index];
    if (orig === null || orig === undefined || JSON.stringify(entryOf(model, sel)) !== orig) return true;
  }
  return langChanged(langOf(model, sel));
}

export function revert(model, sel) {
  const r = langOf(model, sel);
  if (sel.kind === 'tut') {
    if (!r?.orig) return false;
    Object.assign(r, clone(r.orig));
    return true;
  }
  const list = entries(model, sel);
  const orig = origsOf(model, sel)?.[sel.index];
  if (orig === null || orig === undefined) return false;
  list[sel.index] = JSON.parse(orig);
  if (r?.orig) Object.assign(r, clone(r.orig));
  return true;
}

// A copy of the entry goes in right after it (new = no orig).
export function insertAfter(model, sel) {
  const list = entries(model, sel);
  list.splice(sel.index + 1, 0, clone(list[sel.index]));
  origsOf(model, sel).splice(sel.index + 1, 0, null);
  const recs = langList(model, sel);
  const here = recs[sel.index];
  recs.splice(sel.index + 1, 0, { el: here?.el || null, hash: here?.el ? hashText(list[sel.index].text) : null, orig: null });
  return { ...sel, index: sel.index + 1 };
}

// Never empties a list (the scenes need at least one entry). Returns the new selection.
export function remove(model, sel) {
  const list = entries(model, sel);
  if (list.length <= 1) return sel;
  list.splice(sel.index, 1);
  origsOf(model, sel).splice(sel.index, 1);
  langList(model, sel).splice(sel.index, 1);
  return { ...sel, index: Math.min(sel.index, list.length - 1) };
}

// Every selectable entry, in file order (dialogue ids, then the shots, then the tutorial texts).
export function allSelections(model) {
  return [
    ...Object.keys(model.dialogue).flatMap((id) => model.dialogue[id].map((_, index) => ({ kind: 'dialogue', id, index }))),
    ...model.cutscene.shots.map((_, index) => ({ kind: 'shot', index })),
    ...model.tut.map((_, index) => ({ kind: 'tut', index })),
  ];
}

// Changed + added + removed entries (either language) over all the files.
export function editCount(model, source) {
  let n = allSelections(model).filter((sel) => isModified(model, sel)).length;
  n += Math.max(0, source.cutscene.shots.length - model.cutscene.shots.length);
  for (const id of Object.keys(model.dialogue)) n += Math.max(0, (source.dialogue[id]?.length ?? 0) - model.dialogue[id].length);
  return n;
}

// dialogue.json keeps one line object per row ({ "speaker": ..., ... }); this writes the file
// the same way, so an unedited file comes back byte for byte and a diff shows only real edits.
export function serializeDialogue(dialogue) {
  const ids = Object.keys(dialogue);
  const rows = ids.map((id) => {
    const lines = dialogue[id].map((line) => {
      const body = Object.entries(line).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ');
      return `    { ${body} }`;
    });
    return `  ${JSON.stringify(id)}: [\n${lines.join(',\n')}\n  ]`;
  });
  return `{\n${rows.join(',\n')}\n}\n`;
}

export function serializeCutscene(cutscene) {
  return `${JSON.stringify(cutscene, null, 2)}\n`;
}

const trimEmpty = (arr) => {
  while (arr.length && !Object.keys(arr[arr.length - 1]).length) arr.pop();
  return arr;
};

// Writes one Greek tutorial text into out.tutorial.pauses (an empty one deletes the leaf).
function putTutorial(out, item, value) {
  out.tutorial = out.tutorial || {};
  const pauses = (out.tutorial.pauses = out.tutorial.pauses || {});
  let node = pauses[item.id];
  if (!value) {
    const holder = item.step === null ? node : node?.steps?.[item.step];
    if (holder) delete holder[item.field];
    return;
  }
  node = pauses[item.id] = node || {};
  if (item.step === null) node[item.field] = value;
  else {
    node.steps = node.steps || [];
    for (let j = 0; j <= item.step; j += 1) node.steps[j] = node.steps[j] || {};
    node.steps[item.step][item.field] = value;
  }
}

// el.json: the existing file with the editor's Greek merged over dialogue / cutscene_origin /
// tutorial; every other key and the key order stay as they are (new ids go last).
export function serializeEl(model, base) {
  const out = clone(base);
  const ids = [...Object.keys(base.dialogue || {}), ...Object.keys(model.dialogue).filter((id) => !(id in (base.dialogue || {})))];
  const dialogue = {};
  for (const id of ids) {
    const recs = model.lang.dialogue[id];
    if (!recs) {
      dialogue[id] = base.dialogue[id];
      continue;
    }
    const lines = trimEmpty(recs.map((r) => (r.el ? { text: r.el } : {})));
    if (lines.length) dialogue[id] = lines;
  }
  if (Object.keys(dialogue).length || base.dialogue) out.dialogue = dialogue;
  const shots = trimEmpty(model.lang.shots.map((r) => (r.el ? { text: r.el } : {})));
  if (shots.length || base.cutscene_origin) out.cutscene_origin = { ...(base.cutscene_origin || {}), shots };
  for (const t of model.tut) putTutorial(out, t, t.rec.el);
  return `${JSON.stringify(out, null, 2)}\n`;
}

// el.meta.json: per Greek line the hash of the English it was written against (null = no Greek),
// one row per dialogue id like dialogue.json.
export function serializeMeta(model) {
  const row = (recs) => `[${recs.map((r) => JSON.stringify(r.el ? r.hash : null)).join(', ')}]`;
  const dialogue = Object.keys(model.dialogue).map((id) => `    ${JSON.stringify(id)}: ${row(model.lang.dialogue[id])}`);
  const tutorial = model.tut.filter((t) => t.rec.el).map((t) => `    ${JSON.stringify(t.key)}: ${JSON.stringify(t.rec.hash)}`);
  return `{\n  "dialogue": {\n${dialogue.join(',\n')}\n  },\n  "cutscene_origin": ${row(model.lang.shots)},\n  "tutorial": {\n${tutorial.join(',\n')}\n  }\n}\n`;
}

// "0x6070b0" (as the data writes tints) <-> "#6070b0" (an <input type=color>).
export const tintToCss = (tint) => (tint ? `#${String(tint).replace(/^0x/i, '').padStart(6, '0').toLowerCase()}` : '#000000');
export const cssToTint = (css) => `0x${css.replace('#', '').toLowerCase()}`;

// A shot's sfx field (string | list | undefined) <-> the comma separated box.
export const sfxToText = (sfx) => (Array.isArray(sfx) ? sfx.join(', ') : sfx || '');
export function textToSfx(text) {
  const names = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) return undefined;
  return names.length === 1 ? names[0] : names;
}

// Fields of a shot the editor shows read-only, with what they do.
export function otherShotFields(shot, editable) {
  return Object.keys(shot).filter((k) => !editable.includes(k));
}

// What the real art replaces: whenArt keys that shadow an edited field.
export function shadowedByArt(shot, editable) {
  return Object.keys(shot.whenArt || {}).filter((k) => editable.includes(k));
}
