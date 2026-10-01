import Phaser from 'phaser';
import { isAnimTest } from './AnimTestScene.js';
import { devBattleId } from './BattleScene.js';
import chapter1 from '../data/chapter1.json';
import ChapterRunner from '../systems/ChapterRunner.js';
import { devParam } from '../systems/DevParams.js';

// Starts the background Loader (it loads Title's art first, then everything
// else while the player is on Title/Menu) and routes to the first screen.
// Each scene waits for its own assets (systems/Assets.js whenReady).
export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  create() {
    this.scene.launch('Loader');

    const battleId = devBattleId();
    if (isAnimTest()) this.scene.start('AnimTest');
    else if (battleId) this.scene.start('Battle', { battleId });
    else if (devParam('cutscene')) this.scene.start('Cutscene', { id: devParam('cutscene') });
    else if (devParam('step') !== null) ChapterRunner.start(this, chapter1);
    else this.scene.start('Title');
  }
}
