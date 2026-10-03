import { mergeConfig } from 'vite';
import base from './vite.config.js';

// The separate "jam" build: npm run build:jam (scripts/build-jam.mjs) -> dist-jam/,
// zipped for the game-jam site, where the game runs inside a full-screen iframe.
// The normal config / GitHub Pages deploy are untouched.
//
// What differs (all data-driven, nothing in the normal build changes):
//  - __JAM__ is true (src/systems/Jam.js): no fullscreen line / tips / requests.
//  - ui.json "jam" block is deep-merged over ui.json (top-right-safe layout).
//  - credits.json "lines" is emptied (anonymous build); music licences stay.
//  - index.html: touch-action:manipulation on html/body, no manifest.
// ui.json / credits.json are rewritten at load time, before any module reads
// them, so the language snapshot in systems/Lang.js sees the final values too.

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === '_note') continue;
    if (isObject(value) && isObject(target[key])) deepMerge(target[key], value);
    else target[key] = value;
  }
  return target;
}

// Anonymous build: documentation keys (names starting with "_") and free-text "note" fields in the data
// JSON mention the author; they are not read by the game, so they are dropped from every src/data JSON.
const NAME_RE = /kostas|costgal|github/i;
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    if (key === 'note' && typeof v === 'string' && NAME_RE.test(v)) continue;
    out[key] = scrub(v);
  }
  return out;
}

function jamData() {
  return {
    name: 'unremembered-jam-data',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/');
      if (file.endsWith('/src/data/ui.json')) {
        const ui = JSON.parse(code);
        if (ui.jam) deepMerge(ui, ui.jam);
        delete ui.jam;
        return { code: JSON.stringify(scrub(ui)), map: null };
      }
      if (file.endsWith('/src/data/credits.json')) {
        const credits = scrub(JSON.parse(code));
        credits.lines = [];
        return { code: JSON.stringify(credits), map: null };
      }
      if (file.includes('/src/data/') && file.endsWith('.json')) return { code: JSON.stringify(scrub(JSON.parse(code))), map: null };
      return null;
    },
  };
}

function jamHtml() {
  return {
    name: 'unremembered-jam-html',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="manifest"[^>]*>/, '')
        .replace(
          '</head>',
          '    <style>\n      /* Jam build: the host iframe may pan/zoom-guard itself; the canvas keeps touch-action:none. */\n      html,\n      body {\n        touch-action: manipulation;\n      }\n      canvas {\n        touch-action: none;\n      }\n    </style>\n  </head>'
        );
    },
  };
}

export default mergeConfig(base, {
  base: './',
  define: { __JAM__: true },
  plugins: [jamData(), jamHtml()],
  build: { outDir: 'dist-jam', emptyOutDir: true },
});
