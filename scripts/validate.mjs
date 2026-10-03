// npm run validate — cross-checks every JSON in src/data and the sprite
// animation sets (see src/systems/Validate.js). Exits 1 on errors; warnings
// are printed but don't fail.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/systems/Validate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src/data');
const spritesDir = join(root, 'public/assets/sprites');

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`✗ ${path}: ${err.message}`);
    process.exit(1);
  }
};

const data = { cutscenes: {}, animationSets: {} };
for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
  const name = file.slice(0, -5);
  if (name.startsWith('cutscene_')) data.cutscenes[name.slice('cutscene_'.length)] = readJson(join(dataDir, file));
  else data[name] = readJson(join(dataDir, file));
}
data.assets = data.assets || {};
for (const file of readdirSync(spritesDir).filter((f) => f.endsWith('_animations.json'))) {
  data.animationSets[file.slice(0, -'_animations.json'.length)] = readJson(join(spritesDir, file));
}

// Language overlays (src/data/lang/<id>.json): checked against the English data, never against the font list.
data.lang = {};
const langDir = join(dataDir, 'lang');
if (existsSync(langDir)) for (const file of readdirSync(langDir).filter((f) => f.endsWith('.json'))) data.lang[file.slice(0, -5)] = readJson(join(langDir, file));

const sfxDir = join(root, 'public/assets/audio/sfx');
data.sfxFileKeys = existsSync(sfxDir) ? readdirSync(sfxDir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)) : [];

const musicDir = join(root, 'public/assets/audio/music');
data.musicFileKeys = existsSync(musicDir) ? readdirSync(musicDir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)) : [];

const { errors, warnings } = validateData(data, { sheetExists: (sheet) => existsSync(join(spritesDir, sheet)) });
for (const w of warnings) console.warn(`! ${w}`);
for (const e of errors) console.error(`✗ ${e}`);
console.log(`\nvalidate: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
