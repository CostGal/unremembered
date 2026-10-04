// Per-difficulty tuning of an enemy (enemies.json `difficulty.<id>`), resolved once when the
// battle builds the enemy, so the rest of the code reads one plain `def`. Shared by BattleScene
// and the sim (scripts/sim.mjs).
//
//   "difficulty": {
//     "unforgettable": {
//       "hpMult": 1.2,               hp x (on top of qte.json difficulties.enemyHpMult)
//       "telegraphMult": 0.8,        every attack / hit telegraphMs x (not the riposte: defend.reparry)
//       "dmgMult": 1.1,              every attack / hit dmg x (on top of difficulties.damageMult)
//       "attacks": {"archive": {"telegraphMs": 320}},   fields merged onto that attack, in every stage / phase
//                                                        (after the multipliers, so an explicit value wins)
//       "stages": {"enraged": {"hpMult": 1.5}},          fields merged onto the stage with that id
//       "defend": {"reparry": {"counterDmg": [38, 45]}}, deep-merged onto defend
//       "ai": {"focusLowHpChance": 0.85}                 deep-merged onto ai
//     }
//   }
//
// Anything not listed stays as the base def. A difficulty with no entry returns the base def.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// The attack lists of a def: top-level `attacks`, or one list per stage / phase.
function attackLists(def) {
  const groups = def.stages || def.phases;
  return groups ? groups.map((g) => g.attacks || []) : [def.attacks || []];
}

export function tuneEnemyDef(def, difficultyId) {
  const t = def?.difficulty?.[difficultyId];
  if (!t) return def;
  const out = clone(def);
  if (t.hpMult !== undefined) out.hp = Math.round(out.hp * t.hpMult);
  const scaleHit = (hit) => {
    if (t.telegraphMult !== undefined && typeof hit.telegraphMs === 'number') hit.telegraphMs = Math.round(hit.telegraphMs * t.telegraphMult);
    if (t.dmgMult !== undefined && typeof hit.dmg === 'number') hit.dmg = Math.round(hit.dmg * t.dmgMult);
  };
  for (const list of attackLists(out)) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      scaleHit(a);
      for (const h of a.hits || []) scaleHit(h);
      if (t.attacks?.[a.id]) list[i] = deepMerge(a, t.attacks[a.id]);
    }
  }
  if (t.stages && out.stages) {
    out.stages = out.stages.map((s) => {
      const over = t.stages[s.id];
      if (!over) return s;
      const { attacks, ...rest } = over; // attacks are tuned by id above, never replaced wholesale
      return deepMerge(s, rest);
    });
  }
  if (t.defend) out.defend = deepMerge(out.defend || {}, t.defend);
  if (t.ai) out.ai = deepMerge(out.ai || {}, t.ai);
  return out;
}

// The Arena's per-fight scaling (arena.json scaling, systems/ArenaRunner.js), applied after the
// difficulty tuning: {hpMult, dmgMult, telegraphMult}, each default 1. Returns a scaled copy.
export function scaleEnemyDef(def, scale) {
  if (!def || !scale) return def;
  const { hpMult = 1, dmgMult = 1, telegraphMult = 1 } = scale;
  if (hpMult === 1 && dmgMult === 1 && telegraphMult === 1) return def;
  const out = clone(def);
  out.hp = Math.round(out.hp * hpMult);
  const scaleHit = (hit) => {
    if (typeof hit.telegraphMs === 'number') hit.telegraphMs = Math.round(hit.telegraphMs * telegraphMult);
    if (typeof hit.dmg === 'number') hit.dmg = Math.round(hit.dmg * dmgMult);
  };
  for (const list of attackLists(out)) {
    for (const a of list) {
      scaleHit(a);
      for (const h of a.hits || []) scaleHit(h);
    }
  }
  if (out.defend?.reparry) scaleHit(out.defend.reparry);
  return out;
}

// The stage (or phase) the enemy is in, or null for a flat enemy.
export function currentStage(def, phase) {
  return (def.stages || def.phases)?.[phase || 0] ?? null;
}

// Where a stage's Recollection unlock stands (enemies.json stages `recollectionAt`, or the older
// `recollectionAtHpPct`): {pct, hp, bothHeroesBelowPct, oneDownOtherBelowPct} or null.
export function recollectionAtOf(stage) {
  if (!stage) return null;
  if (stage.recollectionAt) return stage.recollectionAt;
  if (stage.recollectionAtHpPct !== undefined) return { pct: stage.recollectionAtHpPct };
  return null;
}

// True when the Recollection should unlock now: the enemy at or under `hp` HP or `pct` % of its max,
// or the party in a last-resort state: every living hero under bothHeroesBelowPct % (at least two
// alive), or one hero down and another under oneDownOtherBelowPct %.
// heroes = [{hp, maxHp}], enemy = {hp, maxHp}.
export function recollectionDue(at, enemy, heroes) {
  if (!at || enemy.hp <= 0) return false;
  if (at.pct !== undefined && (enemy.hp / enemy.maxHp) * 100 <= at.pct) return true;
  if (at.hp !== undefined && enemy.hp <= at.hp) return true;
  const alive = heroes.filter((h) => h.hp > 0);
  const down = heroes.length - alive.length;
  const pct = (h) => (h.hp / h.maxHp) * 100;
  if (at.bothHeroesBelowPct !== undefined && alive.length >= 2 && alive.every((h) => pct(h) < at.bothHeroesBelowPct)) return true;
  if (at.oneDownOtherBelowPct !== undefined && down >= 1 && alive.length >= 1 && alive.some((h) => pct(h) < at.oneDownOtherBelowPct)) return true;
  return false;
}

// ---------- Enemy AI (enemies.json `ai`) ----------
//
//   "ai": {
//     "focusLowHpChance": 0.5,     chance to go for the living hero with the lowest HP share (else a random one)
//     "rules": [                   checked in order against the chosen target; the first rule whose `when` holds
//                                  and whose `chance` roll passes picks that attack, if the stage has it and it
//                                  may be thrown now; a phase `opening` still comes first
//       {"when": {"targetEchoAtLeast": 4}, "pick": "redact", "chance": 0.6},
//       {"when": {"heroesDown": 1}, "pick": "archive", "chance": 0.5},
//       {"when": {"targetHpBelowPct": 35}, "pick": "stamp", "chance": 0.6},
//       {"when": {"selfHpBelowPct": 30}, "pick": "archive", "chance": 0.5}
//     ]
//   }
// `when` conditions all have to hold. A hero in a counter stance is always the target (not the AI's call).

export const AI_CONDITIONS = ['targetEchoAtLeast', 'targetHpBelowPct', 'heroesDown', 'selfHpBelowPct'];

// The hero the AI goes for; rnd() in [0, 1).
export function aiPickTarget(ai, livingHeroes, rnd) {
  if (!livingHeroes.length) return null;
  if (ai?.focusLowHpChance && rnd() < ai.focusLowHpChance) {
    return livingHeroes.reduce((low, h) => (h.hp / h.maxHp < low.hp / low.maxHp ? h : low), livingHeroes[0]);
  }
  return livingHeroes[Math.floor(rnd() * livingHeroes.length)];
}

export function aiRuleHolds(when, { target, heroes, enemy }) {
  if (!when) return false;
  if (when.targetEchoAtLeast !== undefined && !(target && target.echo >= when.targetEchoAtLeast)) return false;
  if (when.targetHpBelowPct !== undefined && !(target && (target.hp / target.maxHp) * 100 < when.targetHpBelowPct)) return false;
  if (when.heroesDown !== undefined && !(heroes.filter((h) => h.hp <= 0).length >= when.heroesDown)) return false;
  if (when.selfHpBelowPct !== undefined && !((enemy.hp / enemy.maxHp) * 100 < when.selfHpBelowPct)) return false;
  return true;
}

// The attack a rule picks from `pickable` (the moves the enemy may throw now), or null for the weighted roll.
export function aiPickAttack(ai, pickable, ctx, rnd) {
  for (const rule of ai?.rules || []) {
    if (!aiRuleHolds(rule.when, ctx)) continue;
    if (rule.chance !== undefined && !(rnd() < rule.chance)) continue;
    const attack = pickable.find((a) => a.id === rule.pick);
    if (attack) return attack;
  }
  return null;
}
