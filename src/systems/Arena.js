// The Arena's rules as pure functions (data passed in, no Phaser, no JSON imports), shared by
// systems/ArenaRunner.js (the game) and scripts/sim.mjs (the balance simulation). `cfg` is
// src/data/arena.json.

// The Arena's level table in the shape Recall.js and RecallCard read: levels.json with
// arena.json `levels` on top (text and flavor merged key by key).
export function arenaLevelCfg(levels, cfg) {
  return {
    ...levels,
    ...cfg.levels,
    text: { ...levels.text, ...cfg.levels.text },
    flavor: { ...levels.flavor, ...cfg.levels.flavor },
  };
}

// Enemy scaling for fight n (1-based): arena.json scaling, with scaling.byDifficulty[difficultyId] on top.
export function fightScale(n, cfg, difficultyId = null) {
  const s = { ...cfg.scaling, ...(cfg.scaling.byDifficulty?.[difficultyId] || {}) };
  const k = Math.max(0, n - 1);
  return {
    hpMult: 1 + s.hpPerFight * k,
    dmgMult: 1 + s.dmgPerFight * k,
    telegraphMult: Math.max(s.telegraphMin, 1 - s.telegraphPerFight * k),
  };
}

// The tier fight n draws from: the last one whose fromFight it reached (the last repeats forever).
export function tierFor(n, cfg) {
  let tier = cfg.tiers[0];
  for (const t of cfg.tiers) if (n >= t.fromFight) tier = t;
  return tier;
}

export function bundleKey(bundle) {
  return bundle.enemies.join('+');
}

// A bundle for fight n, never the same one twice in a row (when the tier has more than one).
export function pickBundle(n, cfg, lastKey = null, rnd = Math.random) {
  const list = tierFor(n, cfg).bundles;
  const fresh = list.filter((b) => bundleKey(b) !== lastKey);
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rnd() * pool.length)];
}

// From this level a hero can cast the Recollection (arena.json levels.learn.<hero>.recollection).
export function ultimateLevel(heroId, cfg) {
  return cfg.levels.learn[heroId]?.recollection ?? Infinity;
}

// The choices for a buff or campfire pick: entries of `pool` under their `max` stacks that fit
// the team (needsHero / needsSupport), shuffled, the first n.
export function drawBuffs(pool, owned, team, n, rnd = Math.random) {
  const left = Object.keys(pool).filter((id) => {
    const def = pool[id];
    if (def.needsHero && !team.heroes.includes(def.needsHero)) return false;
    if (def.needsSupport && team.support !== def.needsSupport) return false;
    return owned.filter((o) => o === id).length < (def.max ?? Infinity);
  });
  for (let i = left.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [left[i], left[j]] = [left[j], left[i]];
  }
  return left.slice(0, n);
}

// After a win: what a standing hero has lost once the heals are in (arena.json healAfterFightPct + the
// buffs' healAfterFightPct, as a share of max HP).
export function healedLoss(lost, maxHp, buffPct, cfg) {
  const pct = (cfg.healAfterFightPct || 0) + buffPct;
  return Math.max(0, Math.round(lost - (maxHp * pct) / 100));
}

// A buff's or upgrade's definition (arena.json buffs / campfire.upgrades).
export function buffDef(id, cfg) {
  return cfg.buffs[id] || cfg.campfire.upgrades[id] || null;
}

// The battles.json-shaped def of fight n (BattleScene init `battleDef`): the tier's stage, the
// bundle, the team, and the `arena` block (fight, level, scaling, carried wounds).
export function arenaBattleDef(cfg, { n, bundle, team, level, wounds, campfireIn, difficultyId = null }) {
  const stage = cfg.stages[tierFor(n, cfg).stage] || {};
  return {
    bg: bundle.bg ?? stage.bg,
    platform: bundle.platform ?? stage.platform,
    env: bundle.env ?? stage.env,
    music: bundle.music ?? stage.music,
    enemies: bundle.enemies,
    formation: bundle.formation,
    party: team.heroes,
    nala: team.support === 'nala',
    nalaGlow: team.support === 'nala',
    recollection: team.heroes.some((id) => level >= ultimateLevel(id, cfg)),
    ultimateInMenu: true,
    noStory: true,
    arena: { fight: n, level, scale: fightScale(n, cfg, difficultyId), wounds: JSON.parse(JSON.stringify(wounds)), campfireIn },
  };
}
