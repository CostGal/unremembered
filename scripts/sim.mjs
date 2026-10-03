// npm run sim — headless balance simulation (numbers only, no rendering).
// Plays every battle many times with a scripted player and reports win rate,
// rounds, estimated real duration, Echo, Recollection and Archive stats per
// QTE profile. Mirrors the rules in src/scenes/BattleScene.js; tune the JSON,
// not this file.
//
//   npm run sim                  all battles, all profiles, Normal + Story
//   npm run sim -- --runs 5000   more runs
//   npm run sim -- --battle boss_clerk --json
//   npm run sim -- --set enemies.clerk.hp=400 --set characters.rhea.hp=70
//
// QTE model: a profile is "lapse" (no useful tap at all) + a biased Gaussian
// timing error (bias, sigma), solved so that the default windows (qte.json)
// give the profile's PERFECT/GOOD/MISS split. Wider windows (Story Mode, tutorial
// slow-mo) then shift the odds the way they would for a real player.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib/harness.mjs';
import { dueEvents } from '../src/systems/BattleEvents.js';
import { computeGrade } from '../src/systems/Grade.js';
import { chapterXpBefore, echoMaxFor, growth, learned, levelFor, techniqueAt } from '../src/systems/Recall.js';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const D = {
  battles: read('src/data/battles.json'),
  characters: read('src/data/characters.json'),
  enemies: read('src/data/enemies.json'),
  techniques: read('src/data/techniques.json'),
  qte: read('src/data/qte.json'),
  brk: read('src/data/break.json'),
  grade: read('src/data/grade.json'),
  levels: read('src/data/levels.json'),
  statuses: read('src/data/statuses.json'),
  battleEvents: read('src/data/battleEvents.json'),
  allies: read('src/data/allies.json'),
  chapter: read('src/data/chapter1.json'),
  dialogue: read('src/data/dialogue.json'),
  cutscene: read('src/data/cutscene_origin.json'),
  ui: read('src/data/ui.json'),
  sim: read('src/data/sim.json'),
};
const animSets = {};
for (const id of Object.keys({ ...D.characters, ...D.enemies })) {
  const p = join(root, `public/assets/sprites/${id}_animations.json`);
  if (existsSync(p)) animSets[id] = JSON.parse(readFileSync(p, 'utf8'));
}

// ---------- CLI ----------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
// --set enemies.clerk.hp=400 (repeatable): try a value without editing the JSON.
// Paths may index arrays: enemies.clerk.phases.0.attacks.0.dmg=18
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [path, raw] = args[i + 1].split('=');
  const keys = path.split('.');
  let obj = D;
  for (const k of keys.slice(0, -1)) obj = obj[k];
  obj[keys[keys.length - 1]] = JSON.parse(raw);
}
const RUNS = Number(opt('runs', D.sim.runs));
const ONLY = opt('battle', null);
const JSON_OUT = args.includes('--json');

// ---------- QTE profiles ----------
const erf = (x) => {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};

// P(|e| <= w) for a tap error e ~ Normal(bias, sigma).
const inWindow = (w, bias, sigma) => 0.5 * (erf((w - bias) / (sigma * Math.SQRT2)) - erf((-w - bias) / (sigma * Math.SQRT2)));

// Real players tap systematically early/late, so the error is a biased
// Gaussian (a centred one can't make PERFECT rarer than 90/200 of GOOD+PERFECT).
// Grid-search bias, sigma and a lapse rate (no useful tap) so the default
// windows reproduce the profile's PERFECT and PERFECT+GOOD shares.
function solveProfile({ PERFECT, GOOD }) {
  const w = D.qte.windows;
  let best = null;
  for (let lapse = 0; lapse <= 0.5001; lapse += 0.05) {
    for (let bias = 0; bias <= 400; bias += 4) {
      for (let sigma = 10; sigma <= 600; sigma += 4) {
        const p = (1 - lapse) * inWindow(w.perfectMs, bias, sigma);
        const pg = (1 - lapse) * inWindow(w.goodMs, bias, sigma);
        const err = (p - PERFECT) ** 2 + (pg - PERFECT - GOOD) ** 2 + lapse * 1e-4;
        if (!best || err < best.err) best = { err, lapse, bias, sigma };
      }
    }
  }
  return best;
}

function qteOdds(profile, windowMult) {
  const w = D.qte.windows;
  const p = (1 - profile.lapse) * inWindow(w.perfectMs * windowMult, profile.bias, profile.sigma);
  const pg = (1 - profile.lapse) * inWindow(w.goodMs * windowMult, profile.bias, profile.sigma);
  return { PERFECT: p, GOOD: pg - p, MISS: 1 - pg };
}

function roll(odds, rnd) {
  const r = rnd();
  if (r < odds.PERFECT) return 'PERFECT';
  if (r < odds.PERFECT + odds.GOOD) return 'GOOD';
  return 'MISS';
}

// ---------- timings (ms) from the real data ----------
const sheetMs = (id, anim, fallback) => {
  const def = animSets[id]?.animations?.[anim];
  return def ? def.durations_ms.reduce((a, b) => a + b, 0) : fallback;
};
const T = D.sim.timing;

// ---------- one battle ----------
const between = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));
function pickWeighted(list, rnd) {
  const total = list.reduce((s, i) => s + (i.weight || 1), 0);
  let r = rnd() * total;
  for (const item of list) {
    r -= item.weight ?? 1;
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}

function simulateBattle(battleId, profileName, story, rnd) {
  const battle = D.battles[battleId];
  const profile = D.sim.profilesSolved[profileName];
  const tech = D.techniques;
  const qte = D.qte;
  const echoMax = D.ui.hud.echo.max;
  const storyMult = story ? qte.difficulties.story.windowMult : 1;
  const dmgTakenMult = story ? qte.difficulties.story.damageMult : 1;
  const think = D.sim.thinkMs[profileName];

  // Recall: the level a playthrough reaches by this battle (levels.json).
  const stepIndex = D.chapter.findIndex((step) => step.type === 'battle' && step.id === battleId);
  const level = levelFor(chapterXpBefore(D.chapter, stepIndex < 0 ? 0 : stepIndex, D.battles, D.enemies), D.levels);
  const heroes = (battle.party ?? D.ui.battleLayout.defaultParty).map((id) => {
    const def = D.characters[id];
    const g = growth(id, level, D.levels);
    const hp = def.hp + g.hp;
    return { id, def, hp, max: hp, strike: [def.strike[0] + g.strike, def.strike[1] + g.strike], techniques: learned(id, level, def.techniques, D.levels), redacted: null, echo: 0, echoMax: echoMaxFor(id, level, D.levels) ?? def.echoMax ?? echoMax };
  });
  const enemies = battle.enemies.map((id, i) => ({ id: `${id}_${i}`, type: id, def: D.enemies[id], hp: D.enemies[id].hp, max: D.enemies[id].hp, phase: 0, charge: null, poise: D.enemies[id].poise || 0, broken: false }));

  // A tutorial battle also costs the time to read its hint banners.
  const st = { ms: T.introMs + (battle.tutorial ? T.tutorialHintsMs : 0), rounds: 0, recollections: 0, archives: 0, archiveInterrupts: 0, breaks: 0, redactions: 0, damageTaken: 0, keepsake: false, echoCurve: [], tutorialSlow: !!battle.tutorial, nalaUsed: !battle.nala, stance: null, brace: null, pending: [], flags: [], playerHits: 0, immuneSeen: false, playerAction: false, actionLanded: false, interrupted: false, chain: 0, maxChain: 0, qtes: { PERFECT: 0, GOOD: 0, MISS: 0 } };
  // Echo is per hero (each has their own reserve).
  const gain = (hero, n) => (hero.echo = Math.max(0, Math.min(hero.echoMax, hero.echo + n)));
  const rhea = heroes.find((h) => h.id === 'rhea'); // may be absent (battles.json party)
  const living = (list) => list.filter((e) => e.hp > 0);
  const immune = (enemy, techId) => !!enemy.def.immune?.includes(techId);

  // Perfect chain (qte.json chain): +stepPct% per step on every player hit; the
  // fraction rounds by chance, as in BattleScene.chainDamage.
  const chainDmg = (dmg) => {
    const mult = 1 + (Math.min(st.chain, qte.chain.maxSteps) * qte.chain.stepPct) / 100;
    return mult === 1 ? dmg : Math.floor(dmg * mult + rnd());
  };
  // poiseDmg: break.json sources (hit 1, counter 2, stanceCounter 3). A broken enemy takes more damage.
  const hitEnemy = (enemy, rawDmg, poiseDmg = 0) => {
    let dmg = chainDmg(rawDmg);
    if (enemy.broken) dmg = Math.round(dmg * D.brk.damageMult);
    // A charging enemy's guard absorbs part of the hit; Exposed (Recollection) adds.
    if (enemy.charge?.attack.guardMult) {
      const full = dmg;
      dmg = Math.round(dmg * enemy.charge.attack.guardMult);
      enemy.charge.mitigated += full - dmg;
    }
    if (enemy.exposed) dmg = Math.round(dmg * enemy.exposed.mult);
    // playerHits (battle events): a Strike / attack technique that dealt damage.
    if (st.playerAction && dmg > 0) st.actionLanded = true;
    enemy.hp = Math.max(0, enemy.hp - dmg);
    if (enemy.hp <= 0) enemy.charge = null;
    const phases = enemy.def.phases;
    if (phases && enemy.hp > 0) {
      const pct = (enemy.hp / enemy.max) * 100;
      while (enemy.phase < phases.length - 1 && pct <= phases[enemy.phase].untilHpPct) {
        enemy.phase += 1;
        enemy.turnsInPhase = 0;
        if (phases[enemy.phase].onEnter) st.pending.push(phases[enemy.phase].onEnter);
        if (enemy.def.poise && !enemy.broken) enemy.poise = enemy.def.poise;
      }
    }
    if (poiseDmg && enemy.def.poise && enemy.hp > 0 && !enemy.broken) {
      enemy.poise = Math.max(0, enemy.poise - poiseDmg);
      if (enemy.poise === 0) {
        enemy.broken = true;
        st.breaks += 1;
        // A BREAK is the one thing that cancels a charge.
        if (enemy.charge) {
          st.archiveInterrupts += 1;
          enemy.charge = null;
        }
      }
    }
  };
  // Battle grade (grade.json) from this run's stats.
  const gradeOf = () => {
    const stats = { perfects: st.qtes.PERFECT, maxChain: st.maxChain, damageTaken: st.damageTaken, partyHp: heroes.reduce((n, h) => n + h.max, 0), turns: st.rounds };
    return { ...computeGrade(stats, battleId, D.grade), stats };
  };
  const windowMult = () => storyMult * (st.tutorialSlow ? 1 / qte.tutorial.timeScale : 1);

  const afterTurn = () => {
    while (st.pending.length) {
      const ev = st.pending.shift();
      if (ev === 'keepsake_burn' && living(enemies).length) {
        st.keepsake = true;
        st.ms += T.keepsakeMs;
        // The Keepsake unlocks Rhea's last pips, then fills them.
        if (rhea) {
          rhea.echoMax = Math.max(rhea.echoMax, D.battleEvents.keepsake_burn.echoMax || rhea.echoMax);
          gain(rhea, rhea.echoMax);
        }
      } else if (D.battleEvents[ev]?.dialogue && living(enemies).length) {
        st.ms += T.insightMs;
      }
    }
  };

  // Generic battle events (battles.json `events`, systems/BattleEvents.js), same
  // rules as BattleScene.checkEvents: after the intro and after every turn, once
  // each, in list order; a dialogue costs T.eventMs; endBattle interrupts the fight.
  const firedEvents = new Set();
  const checkEvents = () => {
    if (!battle.events?.length || st.interrupted || !living(heroes).length) return;
    const ctx = { round: st.rounds, playerHits: st.playerHits, immuneSeen: st.immuneSeen, enemies: enemies.map((e) => ({ hp: e.hp, maxHp: e.max })) };
    for (const ev of dueEvents(battle.events, firedEvents, ctx)) {
      firedEvents.add(ev.id);
      if (ev.dialogue) {
        if (!D.dialogue[ev.dialogue]) continue;
        st.ms += T.eventMs;
      }
      if (ev.then === 'endBattle') {
        st.interrupted = true;
        return;
      }
      if (ev.then?.setFlag && !st.flags.includes(ev.then.setFlag)) st.flags.push(ev.then.setFlag);
    }
  };
  // An interrupted battle counts as a win (XP is given) without a grade.
  const interrupted = () => ({ ...st, win: true, interrupted: true, grade: null });

  const playerTurn = (hero) => {
    st.playerAction = true;
    st.actionLanded = false;
    playerTurnInner(hero);
    st.playerAction = false;
    if (st.actionLanded) st.playerHits += 1;
    // Statuses tick after the hero's own turn.
    if (hero.redacted && --hero.redacted.turns <= 0) hero.redacted = null;
  };
  const playerTurnInner = (hero) => {
    st.ms += think + (living(enemies).length > 1 ? D.sim.timing.targetMs : 0);
    if (st.stance?.hero === hero) st.stance = null;
    // The present makes new sparks: characters.json turnEcho at the start of the turn.
    gain(hero, hero.def.turnEcho || 0);
    const targets = living(enemies).sort((a, b) => a.hp - b.hp);
    // Techniques go to the weakest Strike-immune enemy (Hollow) first; Strike
    // goes to the weakest enemy it can hurt (or passes through if there is none).
    const target = targets.find((e) => immune(e, 'strike')) || targets[0];
    const strikeTarget = targets.find((e) => !immune(e, 'strike'));
    const down = heroes.find((h) => h.hp <= 0);
    const hurt = heroes.filter((h) => h.hp > 0 && h.hp < h.max * D.sim.policy.anchorBelow);

    // Recollection when full.
    if (battle.recollection && hero.def.canUltimate && hero.echo >= tech.recollection.cost) {
      st.playerAction = false; // the ultimate is not a counted hit
      hero.echo -= tech.recollection.cost;
      st.recollections += 1;
      const r = tech.recollection;
      for (let i = 0; i < r.taps && target.hp > 0; i++) {
        const res = roll(qteOdds(profile, storyMult), rnd);
        hitEnemy(target, r.dmg[res.toLowerCase()], D.brk.sources.hit);
      }
      if (r.applies && target.hp > 0) target.exposed = { mult: D.statuses[r.applies.status].damageTakenMult, turns: r.applies.turns };
      st.ms += T.recollectionFadeMs * 2 + r.taps * (qte.recollection.ringMs + r.intervalMs);
      return;
    }
    // Techniques as they are at this Recall level (techniques.json `levels`).
    const tk = (id) => techniqueAt(id, level, tech);
    const can = (id) => hero.techniques.includes(id) && hero.echo >= tk(id).cost && hero.redacted?.tech !== id;

    if (hero.id === 'dov') {
      if ((down || hurt.length) && can('anchor')) {
        hero.echo -= tk('anchor').cost;
        const t = down || hurt.sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
        t.hp = Math.min(t.max, (t.hp > 0 ? t.hp : 0) + tk('anchor').amount);
        t.redacted = null; // Anchor clears statuses
        st.ms += T.castMs;
        return;
      }
      // Brace on the turn the charge is about to release.
      const charging = enemies.some((e) => e.charge && e.charge.turnsLeft <= 1);
      if (D.sim.policy.braceOnArchive && charging && can('brace')) {
        hero.echo -= tk('brace').cost;
        st.brace = tk('brace');
        st.ms += T.castMs;
        return;
      }
      // Tremor (hits every enemy) when there's a crowd or a Strike-immune target.
      if (can('tremor') && (targets.length > 1 || !strikeTarget)) {
        hero.echo -= tk('tremor').cost;
        for (const e of targets) hitEnemy(e, between(rnd, tk('tremor').dmg), D.brk.sources.hit);
        gain(hero, tk('tremor').echoOnHit || 0);
        st.ms += sheetMs('dov', 'attack', T.attackMs);
        return;
      }
    }
    if (hero.id === 'rhea') {
      // Blast whenever it is affordable (its cost is per level: 1 Echo at Recall 1).
      if (can('blast')) {
        hero.echo -= tk('blast').cost;
        const b = tk('blast');
        let total = between(rnd, b.hits);
        let bolts = 0;
        for (let i = 0; i < total && target.hp > 0; i++) {
          const crit = rnd() < b.critChance && total < b.maxHits;
          if (crit) total += 1;
          hitEnemy(target, between(rnd, b.dmg), D.brk.sources.hit);
          if (i === 0) gain(hero, b.echoOnHit || 0);
          bolts += 1;
        }
        st.ms += sheetMs('rhea', 'blast', 900) + bolts * (b.boltFlightMs + b.boltIntervalMs);
        return;
      }
      if (can('return_to_sender') && hero.echo < (tk('blast')?.cost ?? Infinity) && rnd() < D.sim.policy.returnToSenderChance) {
        hero.echo -= tk('return_to_sender').cost;
        st.stance = { hero, tech: tk('return_to_sender') };
        st.ms += T.castMs;
        return;
      }
    }
    // Strike (an immune target takes nothing and gives no Echo).
    if (strikeTarget) {
      hitEnemy(strikeTarget, between(rnd, hero.strike), D.brk.sources.hit);
      gain(hero, tech.strike.echoOnHit);
    } else st.immuneSeen = true;
    st.ms += T.dashMs * 2 + sheetMs(hero.id, 'attack', T.attackMs);
  };

  const enemyTurn = (enemy) => {
    enemyAct(enemy);
    if (enemy.exposed && --enemy.exposed.turns <= 0) enemy.exposed = null;
  };
  const enemyAct = (enemy) => {
    if (enemy.broken) {
      enemy.broken = false;
      enemy.poise = enemy.def.poise;
      st.ms += D.brk.stunMs;
      return;
    }
    const targets = living(heroes);
    if (!targets.length) return;
    // refuseUntilFlag (enemies.json): the enemy won't attack until the event flag is set.
    if (enemy.def.refuseUntilFlag && !st.flags.includes(enemy.def.refuseUntilFlag)) {
      st.ms += T.refuseMs;
      return;
    }
    const stanceHero = st.stance && st.stance.hero.hp > 0 ? st.stance.hero : null;
    const target = stanceHero || targets[Math.floor(rnd() * targets.length)];
    let attack;
    let mitigated = 0;
    if (enemy.charge) {
      enemy.charge.turnsLeft -= 1;
      if (enemy.charge.turnsLeft > 0) {
        st.ms += T.chargeMs;
        return;
      }
      attack = enemy.charge.attack;
      mitigated = enemy.charge.mitigated;
      enemy.charge = null;
    } else {
      const phase = enemy.def.phases ? enemy.def.phases[enemy.phase] : null;
      const list = phase ? phase.attacks : enemy.def.attacks;
      // The parry tutorial teaches the tap first: no red ring until it's done.
      const open = st.tutorialSlow || battle.redRings === false ? list.filter((a) => !a.unparryable) : list;
      // A phase's "opening" fixes its first turns' attacks.
      const n = enemy.turnsInPhase || 0;
      enemy.turnsInPhase = n + 1;
      const fixedId = phase?.opening?.[n];
      attack = (fixedId && (open.length ? open : list).find((a) => a.id === fixedId)) || pickWeighted(open.length ? open : list, rnd);
      if (attack.chargeTurns) {
        st.archives += 1;
        enemy.charge = { attack, turnsLeft: attack.chargeTurns, mitigated: 0 };
        st.ms += T.chargeMs;
        return;
      }
    }
    for (const h of attack.hits || [attack]) {
      const hit = { ...h, unparryable: h.unparryable ?? attack.unparryable ?? false };
      if (target.hp <= 0 || enemy.hp <= 0) break;
      const slow = st.tutorialSlow ? qte.tutorial.timeScale : 1;
      st.ms += (hit.telegraphMs + (hit.feint?.pauseMs || 0)) / slow + T.hitResolveMs;
      // Nala cancels the first Hollow attack (the scripted player always taps her).
      if (!st.nalaUsed && enemy.def.hollow && rnd() < D.sim.policy.nalaTapChance[profileName]) {
        st.nalaUsed = true;
        break;
      }
      const res = roll(qteOdds(profile, windowMult()), rnd);
      st.qtes[res] += 1;
      // A red ring (unparryable) is answered with a swipe: same odds, but a dodge
      // has its own results (no counter, less Echo) and isn't a parry for Return to Sender.
      const dodged = !!hit.unparryable;
      const cfg = dodged ? { ...qte.results[res], ...qte.dodge.results[res] } : qte.results[res];
      if (cfg.chain !== 0) {
        if (res === 'PERFECT') st.chain += 1;
        else if (res === 'MISS') st.chain = 0;
      }
      st.maxChain = Math.max(st.maxChain, st.chain);
      gain(target, cfg.echo);
      if (res === 'MISS' && hit.onMiss?.echo) gain(target, hit.onMiss.echo);
      const dmg = Math.round(hit.dmg * cfg.damageMult * dmgTakenMult * (st.brace ? st.brace.damageMult : 1));
      const dealt = Math.min(dmg, target.hp);
      st.damageTaken += dealt;
      target.hp = Math.max(0, target.hp - dmg);
      // Siphon: the enemy keeps a share of the life it took.
      if (hit.lifesteal && dmg > 0 && enemy.hp > 0) enemy.hp = Math.min(enemy.max, enemy.hp + Math.round(dealt * hit.lifesteal));
      // A missed parry can leave a memory status (Fog has no effect on the numbers).
      const status = res === 'MISS' && battle.statuses !== false && hit.onMiss?.status;
      if (status === 'redacted' && rnd() < (hit.onMiss.chance ?? 1) && target.hp > 0 && target.techniques.length) {
        const pool = target.techniques;
        target.redacted = { tech: target.redacted?.tech ?? pool[Math.floor(rnd() * pool.length)], turns: D.statuses.redacted.turns };
        st.redactions += 1;
      }
      if (st.tutorialSlow && res !== 'MISS') st.tutorialSlow = false;
      if (st.stance?.hero === target) {
        const s = st.stance;
        st.stance = null;
        if (!dodged && res !== 'MISS' && target.hp > 0) {
          hitEnemy(enemy, Math.round(between(rnd, s.tech.counterDmg) * (res === 'PERFECT' ? s.tech.perfectMult : 1)), D.brk.sources.stanceCounter);
          st.ms += T.counterMs;
        }
      } else if (res === 'PERFECT' && !dodged && enemy.hp > 0) {
        hitEnemy(enemy, qte.results.PERFECT.counterDmg, D.brk.sources.counter);
      }
    }
    st.brace = null;
    // A released charge heals part of what its guard absorbed; the first
    // release queues Rhea's insight dialogue (time only).
    if (enemy.hp > 0 && attack.healMitigatedPct && mitigated > 0) enemy.hp = Math.min(enemy.max, enemy.hp + Math.round(mitigated * attack.healMitigatedPct));
    if (enemy.hp > 0 && attack.onRelease && !enemy.released) {
      enemy.released = true;
      st.pending.push(attack.onRelease);
    }
  };

  checkEvents(); // `when: "battleStart"`
  if (st.interrupted) return interrupted();
  while (true) {
    st.rounds += 1;
    if (st.rounds > 200) return { ...st, win: false, stuck: true };
    for (const hero of heroes) {
      if (hero.hp <= 0) continue;
      playerTurn(hero);
      if (rhea) st.echoCurve.push(rhea.echo);
      afterTurn();
      checkEvents();
      if (st.interrupted) return interrupted();
      if (!living(enemies).length) return { ...st, win: true, ms: st.ms + T.victoryMs, grade: gradeOf() };
    }
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      enemyTurn(enemy);
      afterTurn();
      checkEvents();
      if (st.interrupted) return interrupted();
      if (!living(heroes).length) return { ...st, win: false, ms: st.ms + T.loseMs };
      if (!living(enemies).length) return { ...st, win: true, ms: st.ms + T.victoryMs, grade: gradeOf() };
    }
  }
}

// ---------- chapter reading time ----------
function chapterStoryMs() {
  const cps = D.ui.dialogue.charsPerSec;
  let dialogueMs = 0;
  for (const step of D.chapter) {
    if (step.type !== 'dialogue') continue;
    for (const line of D.dialogue[step.id] || []) dialogueMs += (line.text.length / cps) * 1000 + D.sim.timing.readAfterLineMs;
  }
  // keepsake_burn plays inside the boss battle (counted there).
  const cutsceneMs = D.cutscene.shots.reduce((s, shot) => s + (shot.durationMs || D.ui.cutscene.defaultDurationMs), 0);
  return { dialogueMs, cutsceneMs };
}

// ---------- run ----------
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

D.sim.profilesSolved = Object.fromEntries(Object.entries(D.sim.profiles).map(([k, v]) => [k, solveProfile(v)]));
const battleIds = Object.keys(D.battles).filter((id) => (ONLY ? id === ONLY : D.chapter.some((s) => s.id === id)));
const rows = [];
for (const story of [false, true]) {
  for (const id of battleIds) {
    for (const profileName of Object.keys(D.sim.profiles)) {
      const rnd = mulberry32(D.sim.seed);
      const res = [];
      for (let i = 0; i < RUNS; i++) res.push(simulateBattle(id, profileName, story, rnd));
      const wins = res.filter((r) => r.win);
      const graded = wins.filter((r) => r.grade); // an interrupted battle has no grade
      const avg = (f, list = res) => list.reduce((s, r) => s + f(r), 0) / Math.max(1, list.length);
      const sorted = res.map((r) => r.ms).sort((a, b) => a - b);
      const q = (x) => sorted[Math.floor(x * (sorted.length - 1))];
      rows.push({
        battle: id,
        mode: story ? 'story' : 'normal',
        profile: profileName,
        win: wins.length / RUNS,
        rounds: avg((r) => r.rounds),
        minutes: avg((r) => r.ms) / 60000,
        p10: q(0.1) / 60000,
        p90: q(0.9) / 60000,
        winMinutes: avg((r) => r.ms, wins) / 60000,
        avgEcho: avg((r) => r.echoCurve.reduce((a, b) => a + b, 0) / Math.max(1, r.echoCurve.length)),
        recollections: avg((r) => r.recollections),
        archives: avg((r) => r.archives),
        breaks: avg((r) => r.breaks),
        ranks: Object.fromEntries(D.grade.ranks.map((k) => [k.id, graded.filter((r) => r.grade.rank === k.id).length / Math.max(1, graded.length)])),
        gradeStats: Object.fromEntries(['perfects', 'maxChain', 'damageTaken', 'turns'].map((k) => [k, avg((r) => r.grade.stats[k], graded)])),
        score: avg((r) => r.grade.score, graded),
        interruptRate: res.reduce((s, r) => s + r.archiveInterrupts, 0) / Math.max(1, res.reduce((s, r) => s + r.archives, 0)),
        qte: Object.fromEntries(['PERFECT', 'GOOD', 'MISS'].map((k) => [k, avg((r) => r.qtes[k]) / Math.max(1e-9, avg((r) => r.qtes.PERFECT + r.qtes.GOOD + r.qtes.MISS))])),
      });
    }
  }
}

const story = chapterStoryMs();
function odds(profile, mult) {
  const o = qteOdds(profile, mult);
  return ['PERFECT', 'GOOD', 'MISS'].map((k) => Math.round(o[k] * 100)).join('/');
}
if (JSON_OUT) {
  console.log(JSON.stringify({ runs: RUNS, profiles: D.sim.profilesSolved, rows, story }, null, 2));
} else {
  const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(6);
  const f1 = (x) => x.toFixed(1).padStart(5);
  console.log(`runs per cell: ${RUNS}   QTE model: ${Object.entries(D.sim.profilesSolved).map(([k, v]) => `${k} bias=${v.bias}ms sigma=${v.sigma}ms lapse=${(v.lapse * 100).toFixed(0)}% -> normal ${odds(v, 1)} / story ${odds(v, D.qte.difficulties.story.windowMult)}`).join(', ')}\n`);
  console.log('mode    battle        profile    win    rounds  min (p10–p90)       avgEcho  recoll  archive  interrupt  breaks  P/G/M seen            score  rank ' + D.grade.ranks.map((k) => k.id).join('/') + '   perf chain dmg turns');
  for (const r of rows) {
    console.log(
      `${r.mode.padEnd(7)} ${r.battle.padEnd(13)} ${r.profile.padEnd(10)} ${pct(r.win)}  ${f1(r.rounds)}  ${f1(r.minutes)} (${r.p10.toFixed(1)}–${r.p90.toFixed(1)})   ${f1(r.avgEcho)}   ${r.recollections.toFixed(2)}    ${r.archives.toFixed(2)}    ${r.archives ? pct(r.interruptRate) : '   –  '}    ${r.breaks.toFixed(2)}   ${pct(r.qte.PERFECT)}/${pct(r.qte.GOOD)}/${pct(r.qte.MISS)}   ${r.score.toFixed(0).padStart(4)}   ${D.grade.ranks.map((k) => Math.round(r.ranks[k.id] * 100).toString().padStart(3)).join('/')}   ${r.gradeStats.perfects.toFixed(1).padStart(4)} ${r.gradeStats.maxChain.toFixed(1).padStart(4)} ${r.gradeStats.damageTaken.toFixed(0).padStart(4)} ${r.gradeStats.turns.toFixed(1).padStart(4)}`
    );
  }
  // Chapter table (normal mode): per profile, each battle's average rounds and minutes per attempt,
  // then cutscene + dialogue + battles (minutes / win rate = expected time including retries).
  const profiles = Object.keys(D.sim.profiles);
  const normal = (profile, id) => rows.find((r) => r.mode === 'normal' && r.profile === profile && r.battle === id);
  const storyMin = (story.cutsceneMs + story.dialogueMs) / 60000;
  console.log(`\nchapter (normal): cutscene ${(story.cutsceneMs / 60000).toFixed(1)} min + dialogue ${(story.dialogueMs / 60000).toFixed(1)} min (40 cps + ${D.sim.timing.readAfterLineMs}ms per line)`);
  console.log(`  ${'battle'.padEnd(16)}${profiles.map((p) => p.padStart(38)).join('')}`);
  console.log(`  ${''.padEnd(16)}${profiles.map(() => 'rounds    min    win   incl. retries'.padStart(38)).join('')}`);
  const totals = Object.fromEntries(profiles.map((p) => [p, 0]));
  for (const id of battleIds) {
    const cells = profiles.map((p) => {
      const r = normal(p, id);
      const withRetries = r.minutes / Math.max(0.01, r.win);
      totals[p] += withRetries;
      return `${r.rounds.toFixed(1).padStart(6)} ${r.minutes.toFixed(1).padStart(6)} ${pct(r.win)} ${withRetries.toFixed(1).padStart(10)}`.padStart(38);
    });
    console.log(`  ${id.padEnd(16)}${cells.join('')}`);
  }
  console.log(`\n  total = cutscene + dialogue + battles (incl. expected retries); target: non-gamer <= 18 min, every battle >= 99.9% win`);
  for (const p of profiles) {
    const worst = Math.min(...battleIds.map((id) => normal(p, id).win));
    console.log(`  ${p.padEnd(10)} ${storyMin.toFixed(1)} + ${totals[p].toFixed(1)} battles = ${(storyMin + totals[p]).toFixed(1)} min   (lowest battle win ${pct(worst).trim()})`);
  }
}
