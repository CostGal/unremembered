import arena from '../data/arena.json';
import audioData from '../data/audio.json';
import enemies from '../data/enemies.json';
import levels from '../data/levels.json';
import { keepMusic, prefetchMusic, stopAllSfx } from './Audio.js';
import { effectTotal, fragmentDef } from './Fragments.js';
import { battleXp, levelFor } from './Recall.js';
import { arenaBattleDef, arenaLevelCfg, bundleKey, drawBuffs, healedLoss, pickBundle } from './Arena.js';
import { difficultyId } from './Difficulty.js';
import { resetPauses } from './TutorialPause.js';
import { devInt } from './DevParams.js';

// The Arena (arena.json): an endless gauntlet, fighting only. It plugs into the
// same `runner.next(scene)` hook the chapter uses (registry 'runner'), so the
// Battle and Reward scenes hand control back here when they are done:
//
//   Team select -> ArenaRunner.start -> Fight 1 -> (win) level card -> pick a buff
//   -> [every campfire.every wins: the campfire heals everyone, pick an upgrade]
//   -> Fight 2 -> ...      a team wipe -> endRun -> ArenaEnd (the run summary)
//
// HP carries over: the runner remembers how much each hero has lost (and who is
// down) and the next fight starts them there. Levels, buffs and upgrades last for
// the run only (registry 'fragments' holds the buff ids, one entry per copy).

const plan = audioData.music.placement;

// The Arena's level table, in the shape Recall.js and RecallCard read.
export const arenaLevels = arenaLevelCfg(levels, arena);

// The best run of this page session (nothing is saved).
let bestWon = 0;

export default class ArenaRunner {
  // team = {heroes: [id, id], support: id | null}
  static start(scene, team) {
    const runner = new ArenaRunner(team);
    const reg = scene.registry;
    runner.difficultyId = difficultyId(reg.get('settings'));
    reg.set('runner', runner);
    reg.set('fragments', []);
    resetPauses(reg);
    reg.set('parryAssistMs', 0);
    reg.set('parryMissStreak', 0);
    // Dev/QA: ?arenaFight=N starts at fight N with the XP and campfires the fights before it would bring.
    const from = devInt('arenaFight');
    if (from && from > 1) runner.skipTo(from);
    runner.next(scene);
    return runner;
  }

  constructor(team) {
    this.team = team;
    this.won = 0;
    this.xp = 0;
    // Per hero: HP lost so far and whether they are down (carried from fight to fight).
    this.wounds = Object.fromEntries(team.heroes.map((id) => [id, { lost: 0, down: false }]));
    this.queue = [];
    this.lastBundle = null;
    this.startedAt = Date.now();
    this.fightStats = { perfects: 0 };
  }

  // Dev: pretend fights 1..n-1 were won (their XP, no buffs, a fresh party).
  skipTo(n) {
    for (let f = 1; f < n; f++) this.xp += this.fightXp(pickBundle(f, arena).enemies);
    this.won = n - 1;
  }

  get level() {
    return levelFor(this.xp, arenaLevels);
  }

  get fight() {
    return this.won + 1;
  }

  // Fights until the next campfire (1 = the fight now ends with one).
  get campfireIn() {
    const every = arena.campfire.every;
    return every - (this.won % every);
  }

  // The battles.json-shaped def for the next fight (BattleScene init `battleDef`).
  battleDefFor(n, bundle) {
    return arenaBattleDef(arena, { n, bundle, team: this.team, level: this.level, wounds: this.wounds, campfireIn: this.campfireIn, difficultyId: this.difficultyId });
  }

  // XP for beating these enemies: enemies.json xp x arena xpMult, + the run's xpPct buffs.
  fightXp(enemyKeys, owned = []) {
    return Math.round(battleXp(enemyKeys, enemies) * arena.levels.xpMult * (1 + effectTotal(owned, 'xpPct') / 100));
  }

  // The chapter-runner hook: whatever is queued (buff pick, campfire), else the next fight.
  next(scene) {
    stopAllSfx(audioData.sfxFadeMs);
    const step = this.queue.shift();
    if (step) {
      scene.scene.start('Reward', { arena: step });
      return;
    }
    this.startFight(scene);
  }

  startFight(scene) {
    const n = this.fight;
    const bundle = pickBundle(n, arena, this.lastBundle);
    this.lastBundle = bundleKey(bundle);
    const def = this.battleDefFor(n, bundle);
    // Music: this fight's track (and the Recollection's once it can be cast); free the rest.
    const keys = [def.music, def.recollection ? plan.overlay.recollection?.track : null].filter(Boolean);
    keepMusic(keys);
    prefetchMusic(keys).catch(() => {});
    scene.scene.start('Battle', { battleId: 'arena', battleDef: def });
  }

  // A won fight (BattleScene, before the level card): HP carried, after-fight heals, XP.
  // Returns {fromXp, toXp} for the level card; queues the buff pick and maybe the campfire.
  recordWin(scene) {
    const owned = scene.registry.get('fragments') || [];
    const healPct = effectTotal(owned, 'healAfterFightPct');
    for (const hero of scene.heroes) {
      const w = this.wounds[hero.type];
      if (!w) continue;
      w.down = hero.hp <= 0;
      w.lost = w.down ? hero.maxHp : Math.max(0, hero.maxHp - hero.hp);
      if (!w.down) w.lost = healedLoss(w.lost, hero.maxHp, healPct, arena);
    }
    this.fightStats.perfects += scene.stats?.perfects || 0;
    const fromXp = this.xp;
    this.xp += this.fightXp(scene.battleDef.enemies, owned);
    this.won += 1;
    this.queue.push({ pool: 'buffs' });
    if (this.won % arena.campfire.every === 0) this.queue.push({ pool: 'campfire' });
    return { fromXp, toXp: this.xp };
  }

  // The campfire: everyone back to full, the fallen get up.
  rest() {
    for (const w of Object.values(this.wounds)) {
      w.lost = 0;
      w.down = false;
    }
  }

  // The choices for a buff (pool 'buffs') or campfire (pool 'campfire') pick.
  choices(pool, owned) {
    if (pool === 'campfire') return drawBuffs(arena.campfire.upgrades, owned, this.team, arena.campfire.upgradeCount);
    return drawBuffs(arena.buffs, owned, this.team, arena.buffCount);
  }

  // The team wiped (or quit from the lose card): the run summary.
  endRun(scene) {
    const isBest = this.won > bestWon;
    bestWon = Math.max(bestWon, this.won);
    const owned = scene.registry.get('fragments') || [];
    scene.registry.remove('runner');
    scene.scene.start('ArenaEnd', {
      won: this.won,
      best: bestWon,
      isBest: isBest && this.won > 0,
      level: this.level,
      ms: Date.now() - this.startedAt,
      buffs: owned.filter((id) => fragmentDef(id)),
      team: this.team,
    });
  }
}
