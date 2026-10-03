import audioData from '../data/audio.json';
import battles from '../data/battles.json';
import enemies from '../data/enemies.json';
import { keepMusic, prefetchMusic } from './Audio.js';

// Where the music plays (audio.json music.placement) as lookups, and the next-step
// prefetch (music.prefetchPolicy): before a chapter step starts, only the tracks that
// step and the one after it can play are downloaded, and the decoded audio of every
// other track is freed (Audio.keepMusic), so a phone holds a few tracks, not all 16.

const plan = audioData.music.placement;

// The cutscene's placement: {ranges: [{from, to, track}]} over shot indexes (plan.cutscene_<id>).
function cutscenePlan(id) {
  return plan[`cutscene_${id}`] || null;
}

// The track for shot `index` of a cutscene: a key, null (silence) or undefined (not placed: leave the music alone).
export function cutsceneTrack(id, index) {
  const range = cutscenePlan(id)?.ranges.find((r) => index >= r.from && index <= r.to);
  return range ? range.track : undefined;
}

// Tracks the shot's range and the range after it need.
function cutsceneKeys(id, index) {
  const ranges = cutscenePlan(id)?.ranges || [];
  const at = ranges.findIndex((r) => index >= r.from && index <= r.to);
  if (at < 0) return [];
  return [ranges[at].track, ranges[at + 1]?.track].filter(Boolean);
}

// The track a dialogue step plays: a key, null (none) or undefined (not placed).
export function dialogueTrack(id) {
  return plan.dialogue[id];
}

// Every music key a chapter step can play (files are downloaded, procedural ones need nothing).
export function musicKeysForStep(step, shot = 0) {
  if (!step) return [];
  const keys = [];
  if (step.type === 'cutscene') keys.push(...cutsceneKeys(step.id, shot));
  else if (step.type === 'dialogue') keys.push(plan.dialogue[step.id], plan.dialogueSwitch?.[step.id]?.key);
  else if (step.type === 'reward') keys.push(plan.step?.[step.id]?.over?.track, plan.step?.[step.id]?.oneShot);
  else if (step.type === 'end') keys.push(plan.events.end?.track);
  else if (step.type === 'battle') {
    const def = battles[step.id];
    keys.push(def?.music);
    for (const id of def?.enemies || []) for (const stage of enemies[id]?.stages || []) keys.push(stage.music);
    if (def?.recollection) keys.push(plan.overlay.keepsake_burn?.track, plan.overlay.recollection?.track);
  }
  return keys.filter(Boolean);
}

// ChapterRunner: a step is about to start (nextStep follows it).
export function prefetchMusicFor(step, nextStep) {
  const keys = [...musicKeysForStep(step), ...musicKeysForStep(nextStep)];
  keepMusic(keys);
  prefetchMusic(keys).catch(() => {});
}

// CutsceneScene: the shot changed to another range (nextStep = the step after the cutscene).
export function prefetchMusicForShot(id, index, nextStep) {
  const keys = [...cutsceneKeys(id, index), ...musicKeysForStep(nextStep)];
  keepMusic(keys);
  prefetchMusic(keys).catch(() => {});
}
