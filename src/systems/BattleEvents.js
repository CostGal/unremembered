// Generic, data-driven battle events (battles.json `events`). Pure (no Phaser):
// BattleScene, the balance sim (scripts/sim.mjs) and Validate.js share it.
//
// battles.<id>.events = [{id, when, dialogue?, banner?, then?, pause?}]   (optional list)
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
//             {"parries": n}               successful parries by the player >= n: a PERFECT or
//                                           GOOD answered with a TAP on an enemy ring (not a
//                                           swipe dodge, not a reparry ring on Rhea's own Strike)
//             {"noHollowDamageRounds": n}   n finished rounds in a row in which a hero acted against a Hollow
//                                           and nothing landed on one (every Strike IMMUNE). Checked at the start
//                                           of the next round (BattleScene roundStart), so it is "after round n".
//                                           There the round number is the round that just ended, so a glow
//                                           after round 1 is {"all": [{"round": 1}, {"noHollowDamageRounds": 1}]}.
//             {"firstOf": [when, when, ...]}  any member condition holds (nests)
//             {"all": [when, when, ...]}      every member condition holds (nests)
//   dialogue  optional dialogue.json id, played as an overlay when the event fires
//   banner    optional ui.json tutorial.hints id, shown (TutorialHints) once the dialogue is over
//   pause     optional tutorial.json pauses id, run (TutorialPause) after the dialogue, the banner and the
//             `then` actions (so a pause can explain what nalaGlow just did)
//   then      an action or a list of actions: "continue" (default, no-op) | {"setFlag": "<name>"} |
//             "nalaJumpIn" | "endBattle". Order of an event: the PRE actions (PRE_THEN: nalaJumpIn)
//             first, then the dialogue, then the banner, then the other actions in list order.
//             nalaGlow: Nala glows and lends the party her Echo (allies.json nala.glow*): every living hero gets
//             the echo_strike status (Strikes wound Hollows for their next turn) and the Glow goes on
//             its cooldown. The battle must have Nala. Unlocks the tap-on-Nala re-trigger.
//             nalaJumpIn: Nala leaps in from the left edge (created on the spot when the battle
//             has no Nala) and lands between the heroes and the enemies.
//             endBattle: the battle ends "interrupted": no Victory/Result card, but the
//             Recall card and the chapter goes on.
// Each event fires once per battle, in list order, only between turns.

export const WHEN_KEYWORDS = ['battleStart', 'firstImmune'];
export const WHEN_NUMBER_KEYS = ['round', 'playerHits', 'parries', 'enemyHpBelowPct', 'noHollowDamageRounds'];
export const WHEN_LIST_KEYS = ['firstOf', 'all'];
export const THEN_WORDS = ['continue', 'endBattle', 'nalaJumpIn', 'nalaGlow'];
export const PRE_THEN = ['nalaJumpIn'];

// ctx = {round, playerHits, parries, immuneSeen, noHollowDamageRounds, enemies: [{hp, maxHp}]}
export function whenHolds(when, ctx) {
  if (when === 'battleStart') return true;
  if (when === 'firstImmune') return !!ctx.immuneSeen;
  if (!when || typeof when !== 'object') return false;
  if ('round' in when) return ctx.round >= when.round;
  if ('playerHits' in when) return ctx.playerHits >= when.playerHits;
  if ('parries' in when) return (ctx.parries || 0) >= when.parries;
  if ('noHollowDamageRounds' in when) return (ctx.noHollowDamageRounds || 0) >= when.noHollowDamageRounds;
  if ('enemyHpBelowPct' in when) return ctx.enemies.some((e) => (e.hp / e.maxHp) * 100 <= when.enemyHpBelowPct);
  if ('firstOf' in when) return when.firstOf.some((w) => whenHolds(w, ctx));
  if ('all' in when) return when.all.every((w) => whenHolds(w, ctx));
  return false;
}

// -> list of error strings for one `when` (empty when it matches the grammar).
export function whenErrors(when) {
  if (typeof when === 'string') return WHEN_KEYWORDS.includes(when) ? [] : [`unknown when "${when}" (use ${WHEN_KEYWORDS.join(' | ')} or an object)`];
  if (!when || typeof when !== 'object' || Array.isArray(when)) return ['when must be a keyword or an object'];
  const keys = Object.keys(when);
  if (keys.length !== 1) return [`when needs exactly one key (${[...WHEN_NUMBER_KEYS, ...WHEN_LIST_KEYS].join(', ')})`];
  const [key] = keys;
  if (WHEN_NUMBER_KEYS.includes(key)) {
    const v = when[key];
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) return [`when.${key} must be a number >= 0`];
    if ((key === 'round' || key === 'playerHits' || key === 'parries' || key === 'noHollowDamageRounds') && !Number.isInteger(v)) return [`when.${key} must be a whole number`];
    return [];
  }
  if (WHEN_LIST_KEYS.includes(key)) {
    if (!Array.isArray(when[key]) || !when[key].length) return [`when.${key} must be a non-empty list`];
    return when[key].flatMap((w, i) => whenErrors(w).map((m) => `${key}[${i}]: ${m}`));
  }
  return [`unknown when key "${key}"`];
}

// One then action is valid: a THEN_WORDS word or {setFlag: "<name>"}.
function thenActionValid(a) {
  if (typeof a === 'string') return THEN_WORDS.includes(a);
  return !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length === 1 && typeof a.setFlag === 'string' && a.setFlag.length > 0;
}

// -> true for undefined (= continue), one action or a non-empty list of actions.
export function thenValid(then) {
  if (then === undefined) return true;
  if (Array.isArray(then)) return then.length > 0 && then.every(thenActionValid);
  return thenActionValid(then);
}

// `then` as a list, split into the actions that run before the dialogue and the rest.
export function thenSplit(then) {
  const list = then === undefined ? [] : Array.isArray(then) ? then : [then];
  const isPre = (a) => typeof a === 'string' && PRE_THEN.includes(a);
  return { pre: list.filter(isPre), post: list.filter((a) => !isPre(a)) };
}

// The events that are due now: not fired yet and whose `when` holds, in list order.
export function dueEvents(events, fired, ctx) {
  return (events || []).filter((e) => !fired.has(e.id) && whenHolds(e.when, ctx));
}
