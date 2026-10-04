import Phaser from 'phaser';
import { devParam } from '../systems/DevParams.js';
import { normalizeDifficulty } from '../systems/Difficulty.js';
import manifest from '../data/assets.json';
import characters from '../data/characters.json';
import allies from '../data/allies.json';
import enemies from '../data/enemies.json';
import { setVolumes } from '../systems/Audio.js';
import { loadSettings } from '../systems/Settings.js';
import { fetchAnimationSets } from '../systems/SpriteAnims.js';
import { applyFont, loadFont } from '../systems/Fonts.js';
import { applyLanguage } from '../systems/Lang.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create() {
    // Only the font blocks the first screen; the animation sets are fetched
    // by the Loader with the sprite sheets.
    let settings = loadSettings();
    // Dev/QA: ?difficulty=story|normal|unforgettable forces the difficulty for this visit (never saved).
    const forced = devParam('difficulty');
    if (forced) settings = normalizeDifficulty({ ...settings, difficulty: forced, difficultyChosen: true });
    applyLanguage(settings);
    await loadFont(applyFont(settings));

    this.registry.set('manifest', manifest);
    if (import.meta.env.DEV) {
      fetchAnimationSets([...Object.keys(characters), ...Object.keys(enemies), ...Object.keys(allies)]).then(validateInDev);
    }
    this.registry.set('settings', settings);
    setVolumes(settings);

    this.scene.start('Preload');
  }
}

// Dev builds only: the same checks as `npm run validate` (minus the files on
// disk), printed to the console at boot.
async function validateInDev(animationSets) {
  const { validateData } = await import('../systems/Validate.js');
  const modules = import.meta.glob('../data/*.json', { eager: true, import: 'default' });
  // The music / SFX files on disk (vite.config.js lists them at build time).
  const data = {
    cutscenes: {},
    animationSets,
    musicFileKeys: typeof __MUSIC_FILES__ !== 'undefined' ? __MUSIC_FILES__ : [],
    sfxFileKeys: typeof __SFX_FILES__ !== 'undefined' ? __SFX_FILES__ : [],
  };
  for (const [path, json] of Object.entries(modules)) {
    const name = path.split('/').pop().slice(0, -5);
    if (name.startsWith('cutscene_')) data.cutscenes[name.slice('cutscene_'.length)] = json;
    else data[name] = json;
  }
  const { errors, warnings } = validateData(data);
  for (const w of warnings) console.warn(`[validate] ${w}`);
  for (const e of errors) console.error(`[validate] ${e}`);
}
