import Phaser from 'phaser';
import qte from '../data/qte.json';
import grade from '../data/grade.json';
import { rankFor } from './Grade.js';
import { devParam } from './DevParams.js';
import { difficultyId } from './Difficulty.js';

// Game-jam site reporting: when a run reaches "End of Demo", the page that hosts the game in an
// iframe gets one postMessage with the run's time, difficulty and battle results, then a "finish".
// Nothing on screen changes and nothing is sent when the game is opened on its own (no parent).
//
// Change JAM_VER after retuning the difficulty, so the site can tell old and new runs apart.
export const JAM_VER = 'hard1';

// A run touched by a dev URL param (systems/DevParams.js) or the dev HUD debug never reports.
const DEV_PARAMS = ['step', 'level', 'battle', 'echo', 'recollection', 'impact', 'difficulty', 'fakesheets', 'editor', 'music', 'reward', 'cutscene', 'shot', 'pauses', 'fragments', 'char', 'animtest', 'fps'];
// The longest frame the clock counts (ms), so one long frame after a resume adds nothing big.
const MAX_FRAME_MS = 250;
const KEY = 'jamRun';

let debugUsed = false;

export function markDebugUsed() {
  debugUsed = true;
}

export function isTainted() {
  return debugUsed || DEV_PARAMS.some((p) => devParam(p) !== null);
}

// New Game (MenuScene): a fresh run. A dev-param visit never arms one.
export function startRun(registry, settings) {
  registry.set(KEY, { armed: !isTainted(), clockOn: false, ms: 0, battles: {}, modes: [difficultyId(settings)], sent: false });
}

// The clock starts with the first step after the opening cutscene (ChapterRunner), the same for everyone.
export function startClock(registry) {
  const run = registry.get(KEY);
  if (run && !run.sent) run.clockOn = true;
}

// Active time only: Phaser's loop stops while the tab is hidden or the phone is sideways (no steps then),
// and the Pause scene (menu or "Tap to continue") stops the count too. Real time between two frames,
// not Phaser's smoothed delta (which under-counts when frames come slowly), capped per frame.
export function installJamClock(game) {
  let last = null;
  game.events.on(Phaser.Core.Events.STEP, () => {
    const now = performance.now();
    const gap = last === null ? 0 : now - last;
    last = now;
    const run = game.registry.get(KEY);
    if (!run || !run.clockOn || run.sent) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (game.scene.isActive('Pause')) return;
    run.ms += Math.min(Math.max(0, gap), MAX_FRAME_MS);
  });
}

// A won battle's Result card (the same computeGrade result): the newest win of a battle replaces the older one.
// The difficulty in force is noted too, since Settings can change it mid-run.
export function recordBattle(registry, battleId, result) {
  const run = registry.get(KEY);
  if (!run || run.sent || !result) return;
  run.battles[battleId] = { id: battleId, rank: result.rank, score: result.score };
  run.modes.push(difficultyId(registry.get('settings')));
}

// The easiest difficulty played during the run (qte.json difficulties.order, easiest first).
function runMode(run) {
  const order = qte.difficulties.order;
  return order.find((id) => run.modes.includes(id)) || run.modes[0];
}

// The message for a finished run (pure, also used by the QA script).
export function buildClear(run) {
  const battles = Object.values(run.battles);
  const avgScore = battles.length ? Math.round(battles.reduce((sum, b) => sum + b.score, 0) / battles.length) : 0;
  return {
    gj: 'clear',
    ver: JAM_VER,
    mode: String(runMode(run)).toLowerCase(),
    seconds: Math.round(run.ms / 1000),
    details: { avgScore, avgRank: rankFor(avgScore, grade).id, battles },
  };
}

// "End of Demo" (EndScene, not the menu's Credits): once per finished run, only inside a host page.
export function reportClear(registry) {
  const run = registry.get(KEY);
  if (!run || !run.armed || run.sent || isTainted()) return;
  run.sent = true;
  run.clockOn = false;
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage(buildClear(run), '*');
      window.parent.postMessage({ gj: 'finish' }, '*');
    }
  } catch (err) {
    // A host page that refuses messages must never break the game.
  }
}
