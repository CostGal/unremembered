// Recall (levels.json): the party's shared Memories (XP) and the level they
// add up to. Hollows are made of stolen lives, so a fallen enemy gives some
// back; at certain levels a hero remembers a technique.
// Pure (no Phaser, data passed in) so the balance simulation can use it too.

// Recall level for a Memories total (1-based, capped at the last xpAt entry).
export function levelFor(xp, cfg) {
  let level = 1;
  cfg.xpAt.forEach((need, i) => {
    if (xp >= need) level = i + 1;
  });
  return level;
}

// Memories needed to reach a level (level 1 = 0).
export function xpForLevel(level, cfg) {
  return cfg.xpAt[Math.max(0, Math.min(cfg.xpAt.length, level) - 1)];
}

export function maxLevel(cfg) {
  return cfg.xpAt.length;
}

// What a hero has gained over level 1: {hp, strike}.
export function growth(heroId, level, cfg) {
  const g = cfg.growth[heroId] || {};
  const n = Math.max(0, level - 1);
  return { hp: (g.hp || 0) * n, strike: (g.strike || 0) * n };
}

// The techniques (from the hero's full list, in order) known at this level.
export function learned(heroId, level, techniqueIds, cfg) {
  const learn = cfg.learn[heroId] || {};
  return (techniqueIds || []).filter((id) => (learn[id] ?? 1) <= level);
}

// Memories a battle gives: the sum of its enemies' xp (enemies.json).
export function battleXp(enemyKeys, enemies) {
  return enemyKeys.reduce((sum, key) => sum + (enemies[key]?.xp || 0), 0);
}

// The levels gained going from one Memories total to another, each with what
// every hero remembers there: [{level, learned: {heroId: [techIds]}}].
export function levelUps(fromXp, toXp, cfg) {
  const out = [];
  for (let level = levelFor(fromXp, cfg) + 1; level <= levelFor(toXp, cfg); level++) {
    const learnedHere = {};
    for (const [hero, list] of Object.entries(cfg.learn)) {
      const ids = Object.keys(list).filter((id) => list[id] === level);
      if (ids.length) learnedHere[hero] = ids;
    }
    out.push({ level, learned: learnedHere });
  }
  return out;
}

// Memories earned by the battle steps before step index `upTo` of a chapter
// (so ?step=N starts with the Recall a real playthrough would have).
export function chapterXpBefore(steps, upTo, battles, enemies) {
  return steps.slice(0, Math.max(0, upTo)).reduce((sum, step) => {
    if (step.type !== 'battle' || !battles[step.id]) return sum;
    return sum + battleXp(battles[step.id].enemies, enemies);
  }, 0);
}
