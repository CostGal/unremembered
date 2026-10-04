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

// What a hero has gained over level 1: {hp, strike}. A fractional rate (the Arena's 0.5 Strike)
// adds up and rounds down: +1 every other level.
export function growth(heroId, level, cfg) {
  const g = cfg.growth[heroId] || {};
  const n = Math.max(0, level - 1);
  return { hp: Math.floor((g.hp || 0) * n), strike: Math.floor((g.strike || 0) * n) };
}

// The techniques (from the hero's full list, in order) known at this level.
export function learned(heroId, level, techniqueIds, cfg) {
  const learn = cfg.learn[heroId] || {};
  return (techniqueIds || []).filter((id) => (learn[id] ?? 1) <= level);
}

// A hero's Echo capacity at a Recall level (levels.json echoMax[hero][level-1];
// a level past the table uses its last entry). null = the hero has no table,
// so the caller falls back to characters.json / ui.hud.echo.max.
export function echoMaxFor(heroId, level, cfg) {
  const table = cfg.echoMax?.[heroId];
  if (!table?.length) return null;
  return table[Math.max(0, Math.min(table.length, level) - 1)];
}

// The techniques.json `levels` key a hero's techniques are at for a level: the level itself, or
// cfg.techLevel[level-1] when the table maps more levels onto the same 5 (the Arena's 20 levels).
export function techLevelOf(level, cfg) {
  const t = cfg?.techLevel;
  if (!t?.length) return level;
  return t[Math.max(0, Math.min(t.length, level) - 1)];
}

// A technique's definition at a Recall level: the base def with the highest
// `levels[k]` (k <= level) shallow-merged on top. Without `levels`, the def itself.
export function techniqueAt(techId, level, techniques) {
  const base = techniques[techId];
  if (!base?.levels) return base;
  const ks = Object.keys(base.levels)
    .map(Number)
    .filter((k) => k <= level)
    .sort((a, b) => a - b);
  const { levels: _levels, ...rest } = base;
  return ks.length ? { ...rest, ...base.levels[String(ks[ks.length - 1])] } : rest;
}

// Memories a battle gives: the sum of its enemies' xp (enemies.json).
export function battleXp(enemyKeys, enemies) {
  return enemyKeys.reduce((sum, key) => sum + (enemies[key]?.xp || 0), 0);
}

// The levels gained going from one Memories total to another, each with what
// every hero remembers there, and (given techniques.json) which of their known
// techniques grow there: [{level, learned: {heroId: [techIds]}, upgraded: {heroId: [techIds]}}].
export function levelUps(fromXp, toXp, cfg, techniques = {}) {
  const out = [];
  for (let level = levelFor(fromXp, cfg) + 1; level <= levelFor(toXp, cfg); level++) {
    const learnedHere = {};
    for (const [hero, list] of Object.entries(cfg.learn)) {
      const ids = Object.keys(list).filter((id) => list[id] === level);
      if (ids.length) learnedHere[hero] = ids;
    }
    const upgradedHere = {};
    for (const [hero, list] of Object.entries(cfg.learn)) {
      const ids = Object.keys(list).filter((id) => {
        if (list[id] >= level) return false; // not known yet, or just learned now
        const was = techniqueAt(id, techLevelOf(level - 1, cfg), techniques);
        const now = techniqueAt(id, techLevelOf(level, cfg), techniques);
        return was && JSON.stringify(was) !== JSON.stringify(now);
      });
      if (ids.length) upgradedHere[hero] = ids;
    }
    out.push({ level, learned: learnedHere, upgraded: upgradedHere });
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
