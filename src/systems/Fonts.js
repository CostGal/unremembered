import ui from '../data/ui.json';
import { langDef } from './Lang.js';

// The UI font is a setting (ui.json fonts.list): Pixelify Sans by default,
// plus pixel fonts with Greek glyphs (for a Greek translation) and the
// phone's own font. Every text object reads ui.font when it is created, so
// applyFont() swaps the family for everything built from then on.

const cfg = ui.fonts;

export function fontIds() {
  return cfg.list.map((f) => f.id);
}

export function fontDef(settings) {
  return cfg.list.find((f) => f.id === settings?.font) || cfg.list.find((f) => f.id === cfg.default);
}

export function fontLabel(def) {
  return def.greek ? `${def.label}${cfg.greekTag}` : def.label;
}

// The font actually used: the chosen one, unless the language needs glyphs
// it doesn't have (Greek), then the language's own font (ui.json languages).
export function activeFontDef(settings) {
  const def = fontDef(settings);
  const lang = langDef(settings);
  if (lang.font && !def.greek) return cfg.list.find((f) => f.id === lang.font) || def;
  return def;
}

export function applyFont(settings) {
  const def = activeFontDef(settings);
  ui.font = def.family;
  return def;
}

// Waits (briefly) for the font file so the first text is drawn with it. A
// missing or slow file never blocks: text falls back to the CSS stack.
export async function loadFont(def, timeoutMs = cfg.loadTimeoutMs) {
  try {
    // A Greek-capable font comes in two files (latin + greek subsets): the
    // sample text makes both load before the first text is drawn.
    const sample = def.greek ? cfg.greekSample : 'Aa';
    await Promise.race([document.fonts.load(`16px ${def.family}`, sample), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch (err) {
    // no Font Loading API, or the file is missing: the CSS fallback applies
  }
}

// Redraws every text object of a scene in the current font (Settings preview).
export function restyleScene(scene) {
  const walk = (obj) => {
    if (obj.type === 'Text') obj.setFontFamily(ui.font);
    if (obj.list) obj.list.forEach(walk); // containers (buttons)
  };
  scene.children.list.forEach(walk);
}
