import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import TitleScene from './scenes/TitleScene.js';
import BattleScene from './scenes/BattleScene.js';
import DialogueScene from './scenes/DialogueScene.js';
import AnimTestScene from './scenes/AnimTestScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 360,
  height: 640,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#0b0d14',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloadScene, TitleScene, DialogueScene, BattleScene, AnimTestScene],
};

new Phaser.Game(config);
