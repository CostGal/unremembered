// Generic, data-driven battle events (battles.json `events`). Pure (no Phaser):
// BattleScene, the balance sim (scripts/sim.mjs) and Validate.js share it.
//
// battles.<id>.events = [{id, when, dialogue?, then?}]   (optional list)
//   id        string, unique within the battle
//   when      "battleStart"                 true from the start (checked once, after the intro)
//             {"round": n}                  the current round number (1-based) >= n
//             {"playerHits": n}             landed player ACTIONS >= n. One per hero action
//                                           (Strike, or an attack technique such as Blast/Tremor)
//                                           that dealt damage to at least one enemy. Counters
//                                           (PERFECT counter, Return to Sender) and Recollection
//                                           do not count.
//             {"enemyHpBelowPct": n}        any enemy (a just-killed one too) is at hp/maxHp*100 <= n
//             "firstImmune"                 a Strike has passed through an immune enemy (IMMUNE pop)
//             {"firstOf": [when, when, ...]}  any member condition holds (nests)
//   dialogue  optional dialogue.json id, played as an overlay when the event fires
//   then      "continue" (default) | {"setFlag": "<name>"} | "endBattle"
//             endBattle: the battle ends "interrupted": no Victory/Result card, but the
//             Recall card and the chapter goes on.
// Each event fires once per battle, in list order, only between turns.

export const WHEN_KEYWORDS = ['battleStart', 'firstImmune'];
export const WHEN_NUMBER_KEYS = ['round', 'playerHits', 'enemyHpBelowPct'];

// ctx = {round, playerHits, immuneSeen, enemies: [{hp, maxHp}]}
export function whenHolds(when, ctx) {
  if (when === 'battleStart') return true;
  if (when === 'firstImmune') return !!ctx.immuneSeen;
  if (!when || typeof when !== 'object') return false;
  if ('round' in when) return ctx.round >= when.round;
  if ('playerHits' in when) return ctx.playerHits >= when.playerHits;
  if ('enemyHpBelowPct' in when) return ctx.enemies.some((e) => (e.hp / e.maxHp) * 100 <= when.enemyHpBelowPct);
  if ('firstOf' in when) return when.firstOf.some((w) => whenHolds(w, ctx));
  return false;
}

// -> list of error strings for one `when` (empty when it matches the grammar).
export function whenErrors(when) {
  if (typeof when === 'string') return WHEN_KEYWORDS.includes(when) ? [] : [`unknown when "${when}" (use ${WHEN_KEYWORDS.join(' | ')} or an object)`];
  if (!when || typeof when !== 'object' || Array.isArray(when)) return ['when must be a keyword or an object'];
  const keys = Object.keys(when);
  if (keys.length !== 1) return [`when needs exactly one key (${[...WHEN_NUMBER_KEYS, 'firstOf'].join(', ')})`];
  const [key] = keys;
  if (WHEN_NUMBER_KEYS.includes(key)) {
    const v = when[key];
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) return [`when.${key} must be a number >= 0`];
    if ((key === 'round' || key === 'playerHits') && !Number.isInteger(v)) return [`when.${key} must be a whole number`];
    return [];
  }
  if (key === 'firstOf') {
    if (!Array.isArray(when.firstOf) || !when.firstOf.length) return ['when.firstOf must be a non-empty list'];
    return when.firstOf.flatMap((w, i) => whenErrors(w).map((m) => `firstOf[${i}]: ${m}`));
  }
  return [`unknown when key "${key}"`];
}

// -> true for "continue" | "endBattle" | {setFlag: "<name>"} (undefined = continue).
export function thenValid(then) {
  if (then === undefined || then === 'continue' || then === 'endBattle') return true;
  return !!then && typeof then === 'object' && !Array.isArray(then) && Object.keys(then).length === 1 && typeof then.setFlag === 'string' && then.setFlag.length > 0;
}

// The events that are due now: not fired yet and whose `when` holds, in list order.
export function dueEvents(events, fired, ctx) {
  return (events || []).filter((e) => !fired.has(e.id) && whenHolds(e.when, ctx));
}
