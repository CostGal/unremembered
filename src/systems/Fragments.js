import fragments from '../data/fragments.json';
import arena from '../data/arena.json';
import { devParam } from './DevParams.js';

// Memories (fragments.json; the code keeps the old "fragments" name): passives
// kept for the rest of the run in registry 'fragments' (a list of ids). Where
// they come from: `source` reward (the reward screen, `pools`), scene (a spot
// in a dialogue scene, `scenes`; not in the jam build), drop (an enemy, `drops`),
// story (the_page). Effect keys:
//   startEcho, nalaExtraUses, perfectWindowMs, dovMaxHp, perfectEchoBonus,
//   anchorBonus, counterBonus (summed)    blastCritChance (the best one wins)
// Arena buffs and campfire upgrades (arena.json buffs / campfire.upgrades) live in
// the same list for an Arena run and stack: each copy counts. Their own keys:
//   maxHpPct, strikeBonus, dmgTakenPct, healAfterFightPct, xpPct (summed)

// A memory's or an Arena buff's definition: {name, short, color, text, effects}.
export function fragmentDef(id) {
  return fragments.pool[id] || arena.buffs[id] || arena.campfire.upgrades[id] || null;
}

// The ids owned now (an Arena buff once per copy). ?fragments=half_loaf,worn_glove adds some for testing.
export function ownedFragments(registry) {
  const kept = registry.get('fragments') || [];
  const dev = (devParam('fragments') || '').split(',').filter((id) => fragmentDef(id) && !kept.includes(id));
  return [...kept, ...new Set(dev)];
}

// The reward step's choices: its pool (`pools[stepId]`) minus what is owned, else
// n random unowned memories with source "reward".
export function drawChoices(owned, stepId = null, n = fragments.count, rnd = Math.random) {
  const pooled = stepId && fragments.pools[stepId];
  if (pooled) return pooled.filter((id) => fragments.pool[id] && !owned.includes(id)).slice(0, n);
  const left = Object.keys(fragments.pool).filter((id) => fragments.pool[id].source === 'reward' && !owned.includes(id));
  for (let i = left.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [left[i], left[j]] = [left[j], left[i]];
  }
  return left.slice(0, n);
}

// The memories dropped by the enemy types killed in a won battle: once per run,
// never one already owned, each at its `chance`. Returns ids in drops order.
export function dropsFor(killedTypes, owned, rnd = Math.random) {
  const out = [];
  for (const type of new Set(killedTypes)) {
    const d = fragments.drops[type];
    if (!d || !fragments.pool[d.id]) continue;
    if (owned.includes(d.id) || out.includes(d.id)) continue;
    if (rnd() < (d.chance ?? 1)) out.push(d.id);
  }
  return out;
}

export function effectTotal(owned, key) {
  return owned.reduce((sum, id) => sum + (fragmentDef(id)?.effects[key] || 0), 0);
}

export function effectMax(owned, key) {
  return owned.reduce((best, id) => Math.max(best, fragmentDef(id)?.effects[key] || 0), 0);
}

// Adds a memory to the run's registry list (a no-op when owned). Returns true when it was added.
export function pickFragment(registry, id) {
  const kept = registry.get('fragments') || [];
  if (!fragments.pool[id] || kept.includes(id)) return false;
  registry.set('fragments', [...kept, id]);
  return true;
}
