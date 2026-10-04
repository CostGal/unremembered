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
import ArenaTeamScene from './scenes/ArenaTeamScene.js';
import ArenaEndScene from './scenes/ArenaEndScene.js';
import { installAudioUnlock, musicDiagnostics } from './systems/Audio.js';
import { devParam } from './systems/DevParams.js';
import { VIEW, install as installView } from './systems/View.js';
import { installJamClock } from './systems/JamReport.js';

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
  scene: [BootScene, PreloadScene, TitleScene, MenuScene, SettingsScene, CutsceneScene, BattleScene, DialogueScene, EndScene, AnimTestScene, PauseScene, LoaderScene, RewardScene, ArenaTeamScene, ArenaEndScene],
};

const game = new Phaser.Game(config);
installView(game);
// Game-jam site reporting: the active-time clock of a run (systems/JamReport.js).
installJamClock(game);
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

// Every tap (re)unlocks audio: the first one creates the context (dev params
// skip the Title tap), later ones resume it after an iOS interruption (a call,
// Siri, an app switch) that left it stopped, so the music comes back.
installAudioUnlock();
// Field diagnostics: type unrememberedMusic() in the browser console (the game's frame) to see the music state.
try {
  window.unrememberedMusic = () => {
    const d = musicDiagnostics();
    console.log(JSON.stringify(d, null, 1));
    return d;
  };
} catch (err) {
  // no window: skip
}

// Browser toolbars (iOS Safari, the Instagram in-app browser) grow and shrink
// the visible viewport: re-fit the canvas (the logical width stays as measured
// at boot, see systems/View.js).
let refitTimer = null;
const refit = () => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => game.scale.refresh(), 100);
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', refit);
if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);

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
