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
    const [, animationSets] = await Promise.all([
      this.loadFont(),
      fetchAnimationSets([...Object.keys(characters), ...Object.keys(enemies), ...Object.keys(allies)]),
    ]);

    this.registry.set('manifest', manifest);
    this.registry.set('animationSets', animationSets);
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
