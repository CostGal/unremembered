import fragments from '../data/fragments.json';
import { devParam } from './DevParams.js';

// Fragments (fragments.json): passives picked between battles, kept for the
// rest of the run in registry 'fragments' (a list of ids). Effect keys:
//   startEcho, nalaExtraUses, perfectWindowMs, dovMaxHp, perfectEchoBonus (summed)
//   blastCritChance (the best one wins)

// The ids owned now. ?fragments=old_ticket,worn_glove adds some for testing.
export function ownedFragments(registry) {
  const dev = (devParam('fragments') || '').split(',').filter((id) => fragments.pool[id]);
  return [...new Set([...(registry.get('fragments') || []), ...dev])];
}

// n random fragments the player doesn't own yet (fewer if the pool runs out).
export function drawChoices(owned, n = fragments.count, rnd = Math.random) {
  const left = Object.keys(fragments.pool).filter((id) => !owned.includes(id));
  for (let i = left.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [left[i], left[j]] = [left[j], left[i]];
  }
  return left.slice(0, n);
}

export function effectTotal(owned, key) {
  return owned.reduce((sum, id) => sum + (fragments.pool[id]?.effects[key] || 0), 0);
}

export function effectMax(owned, key) {
  return owned.reduce((best, id) => Math.max(best, fragments.pool[id]?.effects[key] || 0), 0);
}
