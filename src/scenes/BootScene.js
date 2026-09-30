import Phaser from 'phaser';
import manifest from '../data/assets.json';
import characters from '../data/characters.json';
import allies from '../data/allies.json';
import enemies from '../data/enemies.json';
import { setVolumes } from '../systems/Audio.js';
import { loadSettings } from '../systems/Settings.js';
import { fetchAnimationSets } from '../systems/SpriteAnims.js';

const FONT_TIMEOUT_MS = 1000;

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create() {
    // Only the font blocks the first screen; the animation sets are fetched
    // by the Loader with the sprite sheets.
    await this.loadFont();

    this.registry.set('manifest', manifest);
    if (import.meta.env.DEV) {
      fetchAnimationSets([...Object.keys(characters), ...Object.keys(enemies), ...Object.keys(allies)]).then(validateInDev);
    }
    const settings = loadSettings();
    this.registry.set('settings', settings);
    setVolumes(settings);

    this.scene.start('Preload');
  }

  async loadFont() {
    try {
      await Promise.race([
        document.fonts.load('16px "Pixelify Sans"'),
        new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS)),
      ]);
    } catch (err) {
      // missing font file never blocks the game — falls back to the CSS stack
    }
  }
}

// Dev builds only: the same checks as `npm run validate` (minus the files on
// disk), printed to the console at boot.
async function validateInDev(animationSets) {
  const { validateData } = await import('../systems/Validate.js');
  const modules = import.meta.glob('../data/*.json', { eager: true, import: 'default' });
  const data = { cutscenes: {}, animationSets };
  for (const [path, json] of Object.entries(modules)) {
    const name = path.split('/').pop().slice(0, -5);
    if (name.startsWith('cutscene_')) data.cutscenes[name.slice('cutscene_'.length)] = json;
    else data[name] = json;
  }
  const { errors, warnings } = validateData(data);
  for (const w of warnings) console.warn(`[validate] ${w}`);
  for (const e of errors) console.error(`[validate] ${e}`);
}
