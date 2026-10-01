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

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const D = {
  battles: read('src/data/battles.json'),
  characters: read('src/data/characters.json'),
  enemies: read('src/data/enemies.json'),
  techniques: read('src/data/techniques.json'),
  qte: read('src/data/qte.json'),
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
    r -= item.weight || 1;
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
  const storyMult = story ? qte.storyMode.windowMult : 1;
  const dmgTakenMult = story ? qte.storyMode.damageMult : 1;
  const think = D.sim.thinkMs[profileName];

  const heroes = ['rhea', 'dov'].map((id) => ({ id, def: D.characters[id], hp: D.characters[id].hp, max: D.characters[id].hp }));
  const enemies = battle.enemies.map((id, i) => ({ id: `${id}_${i}`, type: id, def: D.enemies[id], hp: D.enemies[id].hp, max: D.enemies[id].hp, phase: 0, charge: null }));

  // A tutorial battle also costs the time to read its hint banners.
  const st = { echo: 0, ms: T.introMs + (battle.tutorial ? T.tutorialHintsMs : 0), rounds: 0, recollections: 0, archives: 0, archiveInterrupts: 0, keepsake: false, echoCurve: [], tutorialSlow: !!battle.tutorial, nalaUsed: !battle.nala, stance: null, brace: null, pending: [], chain: 0, maxChain: 0, qtes: { PERFECT: 0, GOOD: 0, MISS: 0 } };
  const gain = (n) => (st.echo = Math.max(0, Math.min(echoMax, st.echo + n)));
  const living = (list) => list.filter((e) => e.hp > 0);

  // Perfect chain (qte.json chain): +stepPct% per step on every player hit; the
  // fraction rounds by chance, as in BattleScene.chainDamage.
  const chainDmg = (dmg) => {
    const mult = 1 + (Math.min(st.chain, qte.chain.maxSteps) * qte.chain.stepPct) / 100;
    return mult === 1 ? dmg : Math.floor(dmg * mult + rnd());
  };
  const hitEnemy = (enemy, rawDmg) => {
    const dmg = chainDmg(rawDmg);
    enemy.hp = Math.max(0, enemy.hp - dmg);
    if (enemy.charge) {
      enemy.charge.dealt += dmg;
      if (enemy.charge.dealt >= enemy.charge.attack.interruptDmg || enemy.hp <= 0) {
        if (enemy.hp > 0) st.archiveInterrupts += 1;
        enemy.charge = null;
      }
    }
    const phases = enemy.def.phases;
    if (phases && enemy.hp > 0) {
      const pct = (enemy.hp / enemy.max) * 100;
      while (enemy.phase < phases.length - 1 && pct <= phases[enemy.phase].untilHpPct) {
        enemy.phase += 1;
        if (phases[enemy.phase].onEnter) st.pending.push(phases[enemy.phase].onEnter);
      }
    }
  };
  const windowMult = () => storyMult * (st.tutorialSlow ? 1 / qte.tutorial.timeScale : 1);

  const afterTurn = () => {
    while (st.pending.length) {
      const ev = st.pending.shift();
      if (ev === 'keepsake_burn' && living(enemies).length) {
        st.keepsake = true;
        st.ms += T.keepsakeMs;
        gain(echoMax);
      }
    }
  };

  const playerTurn = (hero) => {
    st.ms += think + (living(enemies).length > 1 ? D.sim.timing.targetMs : 0);
    if (st.stance?.hero === hero) st.stance = null;
    const targets = living(enemies).sort((a, b) => a.hp - b.hp);
    const target = targets[0];
    const down = heroes.find((h) => h.hp <= 0);
    const hurt = heroes.filter((h) => h.hp > 0 && h.hp < h.max * D.sim.policy.anchorBelow);

    // Recollection when full.
    if (hero.def.canUltimate && st.echo >= tech.recollection.cost) {
      st.echo -= tech.recollection.cost;
      st.recollections += 1;
      const r = tech.recollection;
      for (let i = 0; i < r.taps && target.hp > 0; i++) {
        const res = roll(qteOdds(profile, storyMult), rnd);
        hitEnemy(target, r.dmg[res.toLowerCase()]);
      }
      st.ms += T.recollectionFadeMs * 2 + r.taps * (qte.recollection.ringMs + r.intervalMs);
      return;
    }
    // Full Echo is kept for Rhea's Recollection (its button pulses).
    const saving = hero.id !== 'rhea' && st.echo >= tech.recollection.cost && heroes[0].hp > 0;
    const can = (id) => !saving && hero.def.techniques?.includes(id) && st.echo >= tech[id].cost;

    if (hero.id === 'dov') {
      if ((down || hurt.length) && can('anchor')) {
        st.echo -= tech.anchor.cost;
        const t = down || hurt.sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
        t.hp = Math.min(t.max, (t.hp > 0 ? t.hp : 0) + tech.anchor.amount);
        st.ms += T.castMs;
        return;
      }
      const charging = enemies.some((e) => e.charge);
      if (D.sim.policy.braceOnArchive && charging && can('brace') && st.echo - tech.brace.cost >= 0) {
        st.echo -= tech.brace.cost;
        st.brace = tech.brace;
        st.ms += T.castMs;
        return;
      }
    }
    if (hero.id === 'rhea') {
      if (can('blast') && st.echo >= D.sim.policy.blastAtEcho) {
        st.echo -= tech.blast.cost;
        const b = tech.blast;
        let total = between(rnd, b.hits);
        let bolts = 0;
        for (let i = 0; i < total && target.hp > 0; i++) {
          const crit = rnd() < b.critChance && total < b.maxHits;
          if (crit) total += 1;
          hitEnemy(target, between(rnd, b.dmg));
          if (i === 0) gain(b.echoOnHit || 0);
          bolts += 1;
        }
        st.ms += sheetMs('rhea', 'blast', 900) + bolts * (b.boltFlightMs + b.boltIntervalMs);
        return;
      }
      if (can('return_to_sender') && st.echo < (tech.blast?.cost ?? Infinity) && rnd() < D.sim.policy.returnToSenderChance) {
        st.echo -= tech.return_to_sender.cost;
        st.stance = { hero, tech: tech.return_to_sender };
        st.ms += T.castMs;
        return;
      }
    }
    // Strike.
    hitEnemy(target, between(rnd, hero.def.strike));
    gain(tech.strike.echoOnHit);
    st.ms += T.dashMs * 2 + sheetMs(hero.id, 'attack', T.attackMs);
  };

  const enemyTurn = (enemy) => {
    const targets = living(heroes);
    if (!targets.length) return;
    const stanceHero = st.stance && st.stance.hero.hp > 0 ? st.stance.hero : null;
    const target = stanceHero || targets[Math.floor(rnd() * targets.length)];
    let attack;
    if (enemy.charge) {
      enemy.charge.turnsLeft -= 1;
      if (enemy.charge.turnsLeft > 0) {
        st.ms += T.chargeMs;
        return;
      }
      attack = enemy.charge.attack;
      enemy.charge = null;
    } else {
      const list = enemy.def.phases ? enemy.def.phases[enemy.phase].attacks : enemy.def.attacks;
      attack = pickWeighted(list, rnd);
      if (attack.chargeTurns) {
        st.archives += 1;
        enemy.charge = { attack, turnsLeft: attack.chargeTurns, dealt: 0 };
        st.ms += T.chargeMs;
        return;
      }
    }
    for (const hit of attack.hits || [attack]) {
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
      if (res === 'PERFECT') st.chain += 1;
      else if (res === 'MISS') st.chain = 0;
      st.maxChain = Math.max(st.maxChain, st.chain);
      gain(qte.results[res].echo);
      if (res === 'MISS' && hit.onMiss?.echo) gain(hit.onMiss.echo);
      const dmg = Math.round(hit.dmg * qte.results[res].damageMult * dmgTakenMult * (st.brace ? st.brace.damageMult : 1));
      target.hp = Math.max(0, target.hp - dmg);
      if (st.tutorialSlow && res !== 'MISS') st.tutorialSlow = false;
      if (st.stance?.hero === target) {
        const s = st.stance;
        st.stance = null;
        if (res !== 'MISS' && target.hp > 0) {
          hitEnemy(enemy, Math.round(between(rnd, s.tech.counterDmg) * (res === 'PERFECT' ? s.tech.perfectMult : 1)));
          st.ms += T.counterMs;
        }
      } else if (res === 'PERFECT' && enemy.hp > 0) {
        hitEnemy(enemy, qte.results.PERFECT.counterDmg);
      }
    }
    st.brace = null;
  };

  while (true) {
    st.rounds += 1;
    if (st.rounds > 200) return { ...st, win: false, stuck: true };
    for (const hero of heroes) {
      if (hero.hp <= 0) continue;
      playerTurn(hero);
      st.echoCurve.push(st.echo);
      afterTurn();
      if (!living(enemies).length) return { ...st, win: true, ms: st.ms + T.victoryMs };
    }
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      enemyTurn(enemy);
      afterTurn();
      if (!living(heroes).length) return { ...st, win: false, ms: st.ms + T.loseMs };
      if (!living(enemies).length) return { ...st, win: true, ms: st.ms + T.victoryMs };
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
  console.log(`runs per cell: ${RUNS}   QTE model: ${Object.entries(D.sim.profilesSolved).map(([k, v]) => `${k} bias=${v.bias}ms sigma=${v.sigma}ms lapse=${(v.lapse * 100).toFixed(0)}% -> normal ${odds(v, 1)} / story ${odds(v, D.qte.storyMode.windowMult)}`).join(', ')}\n`);
  console.log('mode    battle        profile    win    rounds  min (p10–p90)       avgEcho  recoll  archive  interrupt  P/G/M seen');
  for (const r of rows) {
    console.log(
      `${r.mode.padEnd(7)} ${r.battle.padEnd(13)} ${r.profile.padEnd(10)} ${pct(r.win)}  ${f1(r.rounds)}  ${f1(r.minutes)} (${r.p10.toFixed(1)}–${r.p90.toFixed(1)})   ${f1(r.avgEcho)}   ${r.recollections.toFixed(2)}    ${r.archives.toFixed(2)}    ${r.archives ? pct(r.interruptRate) : '   –  '}    ${pct(r.qte.PERFECT)}/${pct(r.qte.GOOD)}/${pct(r.qte.MISS)}`
    );
  }
  const battleMin = (profile) => rows.filter((r) => r.mode === 'normal' && r.profile === profile).reduce((s, r) => s + r.minutes / Math.max(0.01, r.win), 0);
  console.log(`\nchapter: cutscene ${(story.cutsceneMs / 60000).toFixed(1)} min + dialogue ${(story.dialogueMs / 60000).toFixed(1)} min (40 cps + ${D.sim.timing.readAfterLineMs}ms per line)`);
  for (const p of Object.keys(D.sim.profiles)) {
    const total = (story.cutsceneMs + story.dialogueMs) / 60000 + battleMin(p);
    console.log(`  ${p.padEnd(10)} battles incl. expected retries ${battleMin(p).toFixed(1)} min -> chapter ≈ ${total.toFixed(1)} min`);
  }
}
