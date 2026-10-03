// Data operations of the dev-only dialogue editor (?editor, scenes/EditorScene.js).
// Pure functions, no DOM and no Phaser, so they also run in node (scripts/qa/editor.mjs).
//
// A model holds working copies of dialogue.json and cutscene_origin.json plus, per
// line / shot, the JSON text it had when loaded (`origs`, null for one added in the
// editor) so the editor can mark what changed and revert one entry. Nothing here
// writes to disk: the page only offers the serialised files for download.
//
// Selection: {kind: 'dialogue', id, index} | {kind: 'shot', index}.

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createModel(dialogue, cutscene) {
  const model = { dialogue: clone(dialogue), cutscene: clone(cutscene), origs: { dialogue: {}, shots: [] } };
  for (const [id, lines] of Object.entries(model.dialogue)) model.origs.dialogue[id] = lines.map((l) => JSON.stringify(l));
  model.origs.shots = model.cutscene.shots.map((s) => JSON.stringify(s));
  return model;
}

// A draft is the working copy + origs; restoring it is only trusted when the ids still match.
export function toDraft(model) {
  return { dialogue: model.dialogue, cutscene: model.cutscene };
}

export function fromDraft(source, draft) {
  if (!draft || typeof draft !== 'object' || typeof draft.dialogue !== 'object' || !draft.cutscene || !Array.isArray(draft.cutscene.shots)) return null;
  const model = createModel(source.dialogue, source.cutscene);
  for (const [id, lines] of Object.entries(draft.dialogue)) {
    if (!Array.isArray(lines)) return null;
    // Parallel origs: the source's line at the same position while it still exists, else "new".
    const base = model.origs.dialogue[id] || [];
    model.origs.dialogue[id] = lines.map((_, i) => base[i] ?? null);
  }
  model.dialogue = clone(draft.dialogue);
  model.cutscene = clone(draft.cutscene);
  model.origs.shots = model.cutscene.shots.map((_, i) => model.origs.shots[i] ?? null);
  return model;
}

export function entries(model, sel) {
  return sel.kind === 'shot' ? model.cutscene.shots : model.dialogue[sel.id];
}

export function origsOf(model, sel) {
  return sel.kind === 'shot' ? model.origs.shots : model.origs.dialogue[sel.id];
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

export function isModified(model, sel) {
  const entry = entryOf(model, sel);
  const orig = origsOf(model, sel)?.[sel.index];
  return orig === null || orig === undefined || JSON.stringify(entry) !== orig;
}

export function revert(model, sel) {
  const list = entries(model, sel);
  const orig = origsOf(model, sel)?.[sel.index];
  if (orig === null || orig === undefined) return false;
  list[sel.index] = JSON.parse(orig);
  return true;
}

// A copy of the entry goes in right after it (new = no orig).
export function insertAfter(model, sel) {
  const list = entries(model, sel);
  list.splice(sel.index + 1, 0, clone(list[sel.index]));
  origsOf(model, sel).splice(sel.index + 1, 0, null);
  return { ...sel, index: sel.index + 1 };
}

// Never empties a list (the scenes need at least one entry). Returns the new selection.
export function remove(model, sel) {
  const list = entries(model, sel);
  if (list.length <= 1) return sel;
  list.splice(sel.index, 1);
  origsOf(model, sel).splice(sel.index, 1);
  return { ...sel, index: Math.min(sel.index, list.length - 1) };
}

// Changed + added + removed entries over both files.
export function editCount(model, source) {
  let n = 0;
  const lists = [
    [model.cutscene.shots, model.origs.shots, source.cutscene.shots.length],
    ...Object.keys(model.dialogue).map((id) => [model.dialogue[id], model.origs.dialogue[id], source.dialogue[id]?.length ?? 0]),
  ];
  for (const [list, origs, srcLen] of lists) {
    list.forEach((entry, i) => {
      if (origs[i] === null || origs[i] === undefined || JSON.stringify(entry) !== origs[i]) n += 1;
    });
    if (list.length < srcLen) n += srcLen - list.length;
  }
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
