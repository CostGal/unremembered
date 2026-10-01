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
import RewardScene from './scenes/RewardScene.js';
import { unlockAudio } from './systems/Audio.js';
import { devParam } from './systems/DevParams.js';
import { VIEW, install as installView } from './systems/View.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  // 360×640 design, widened a little on viewports wider than 9:16 (systems/View.js).
  width: VIEW.w,
  height: VIEW.h,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#0b0d14',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloadScene, TitleScene, MenuScene, SettingsScene, CutsceneScene, BattleScene, DialogueScene, EndScene, AnimTestScene, PauseScene, LoaderScene, RewardScene],
};

const game = new Phaser.Game(config);
installView(game);
if (import.meta.env.DEV) window.__game = game;

// Held sideways (the "Rotate your phone" overlay in index.html shows on this
// query): treat it like leaving the app, so a battle pauses instead of running
// a ring nobody can see. The Pause scene's "Tap to continue" waits on return.
const sideways = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
const onSideways = () => {
  if (sideways.matches) game.events.emit(Phaser.Core.Events.HIDDEN);
};
if (sideways.addEventListener) sideways.addEventListener('change', onSideways);
else if (sideways.addListener) sideways.addListener(onSideways);

// Dev params skip the Title tap, so any first tap also unlocks audio.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true });

// ?music=<key>: one procedural track on its own with a tiny panel (loaded only then).
if (devParam('music')) import('./systems/MusicPanel.js').then((m) => m.openMusicPanel(devParam('music')));

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
