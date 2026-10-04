// Battle grade (grade.json): a score from the battle's stats, then a rank.
// Pure (no Phaser) so the balance simulation can use it too.
//
// stats = {perfects, maxChain, damageTaken, partyHp, turns}
// score = base + perfects*perfect + maxChain*chain - damagePct*damage - max(0, turns - par)*turn,
// where damagePct = damageTaken as a % of the party's total max HP. Clamped to 0..100.
// cfg.battles[id] overrides single formula keys for that battle.
// rank = the first rank (best first) whose min the score reaches.
export function computeGrade(stats, battleId, cfg) {
  const f = { ...cfg.formula, ...(cfg.battles?.[battleId] || {}) };
  const par = cfg.par[battleId] ?? cfg.par.default;
  const damagePct = (stats.damageTaken / Math.max(1, stats.partyHp)) * 100;
  const raw =
    f.base +
    stats.perfects * f.perfect +
    stats.maxChain * f.chain -
    damagePct * f.damage -
    Math.max(0, stats.turns - par) * f.turn;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const rank = rankFor(score, cfg);
  return { score, rank: rank.id, par };
}

// The rank (best first) a score reaches: the first whose min it meets, else the last.
export function rankFor(score, cfg) {
  return cfg.ranks.find((r) => score >= r.min) || cfg.ranks[cfg.ranks.length - 1];
}

// Index of a rank id in cfg.ranks (0 = best).
export function rankIndex(id, cfg) {
  return cfg.ranks.findIndex((r) => r.id === id);
}
