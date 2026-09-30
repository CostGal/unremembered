import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import TitleScene from './scenes/TitleScene.js';
import BattleScene from './scenes/BattleScene.js';
import CutsceneScene from './scenes/CutsceneScene.js';
import DialogueScene from './scenes/DialogueScene.js';
import EndScene from './scenes/EndScene.js';
import MenuScene from './scenes/MenuScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import AnimTestScene from './scenes/AnimTestScene.js';
import PauseScene from './scenes/PauseScene.js';
import LoaderScene from './scenes/LoaderScene.js';
import { unlockAudio } from './systems/Audio.js';
import { devParam } from './systems/DevParams.js';

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
  scene: [BootScene, PreloadScene, TitleScene, MenuScene, SettingsScene, CutsceneScene, BattleScene, DialogueScene, EndScene, AnimTestScene, PauseScene, LoaderScene],
};

const game = new Phaser.Game(config);
if (import.meta.env.DEV) window.__game = game;

// Dev params skip the Title tap, so any first tap also unlocks audio.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true });

// ?fps=1: a small FPS meter (current / lowest in the last 5 s) over the game.
if (devParam('fps') === '1') {
  const meter = document.createElement('div');
  meter.style.cssText = 'position:fixed;top:4px;left:4px;z-index:20;padding:2px 5px;font:12px monospace;color:#3fd0c9;background:rgba(0,0,0,.6);pointer-events:none';
  document.body.appendChild(meter);
  const samples = [];
  setInterval(() => {
    const fps = Math.round(game.loop.actualFps);
    samples.push(fps);
    if (samples.length > 10) samples.shift();
    meter.textContent = `${fps} fps (min ${Math.min(...samples)})`;
    window.__fps = samples;
  }, 500);
}
