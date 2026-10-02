import ui from '../data/ui.json';
import credits from '../data/credits.json';
import qte from '../data/qte.json';
import techniques from '../data/techniques.json';
import fragments from '../data/fragments.json';
import statuses from '../data/statuses.json';
import battleEvents from '../data/battleEvents.json';
import allies from '../data/allies.json';
import breakData from '../data/break.json';
import grade from '../data/grade.json';
import levels from '../data/levels.json';
import crit from '../data/crit.json';
import el from '../data/lang/el.json';

// Languages: English is the data as written; another language is an overlay
// file (src/data/lang/<id>.json) with the same shape, holding only the
// strings it translates: { "<module>": { ...partial copy... } }. Applying a
// language puts every module back to English, then writes the overlay into
// the same objects in place (so code holding `ui.menu` etc. sees it). A
// string the overlay doesn't have stays English. Text objects pick up the
// language when they are created, like the font (scenes restart on a switch).

const MODULES = { ui, credits, qte, techniques, fragments, statuses, battleEvents, allies, break: breakData, grade, levels, crit };
const OVERLAYS = { el };
export const LANGUAGES = ui.languages.list;

const english = JSON.parse(JSON.stringify(MODULES));

export function langDef(settings) {
  return LANGUAGES.find((l) => l.id === settings?.lang) || LANGUAGES.find((l) => l.id === ui.languages.default);
}

export function applyLanguage(settings) {
  const def = langDef(settings);
  for (const [name, target] of Object.entries(MODULES)) restore(target, english[name]);
  const overlay = OVERLAYS[def.id];
  if (overlay) for (const [name, part] of Object.entries(overlay)) if (MODULES[name]) merge(MODULES[name], part);
  try {
    document.documentElement.lang = def.id;
  } catch (err) {
    // no document (tests)
  }
  return def;
}

// Writes the English values back over target (same shape: only strings,
// numbers and booleans change, so a deep walk over the snapshot does it).
function restore(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') restore(target[key], value);
    else target[key] = value;
  }
}

// Overlay leaves replace target leaves; objects and arrays merge by key/index.
function merge(target, part) {
  for (const [key, value] of Object.entries(part)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else if (key in target) target[key] = value;
  }
}
