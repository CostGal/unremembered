// A scripted player for headless runs: reads the game state from the dev
// build (window.__game), taps with the real mouse (so hit areas and input
// timing are exercised) and plays Title -> Menu -> chapter -> End.
//
// Parry rings are answered per `profile` ({PERFECT, GOOD, MISS} weights; GOOD
// touches land late inside the GOOD window, MISS doesn't touch). A white ring is
// swiped (a dodge, judged on the easier dodge windows) with sim.json
// policy.dodgeChance[profile name] (opts.dodgeChance overrides, default 0.2),
// else tapped; a red ring is always swiped (the normal windows). Menu choices follow
// a rotation that uses every technique the hero can afford.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, sleep, swipe, tap } from './harness.mjs';

const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8'));
const qte = JSON.parse(readFileSync(join(root, 'src/data/qte.json'), 'utf8'));
const simPolicy = JSON.parse(readFileSync(join(root, 'src/data/sim.json'), 'utf8')).policy;
const slots = ui.commands.slots;
const TAP_ZONE = [180, 590];

export const ROTATION = { rhea: ['blast', 'return_to_sender', 'strike'], dov: ['tremor', 'brace', 'anchor', 'strike'] };

// Everything the bot needs, in one evaluate() round trip.
export function probe(page) {
  return page.evaluate(() => {
    const g = window.__game;
    if (!g) return { booting: true };
    const active = g.scene.getScenes(true).map((s) => s.scene.key);
    const st = { active, now: performance.now(), trace: window.__animTrace || {} };
    const b = g.scene.getScene('Battle');
    if (b && (active.includes('Battle') || g.scene.isPaused('Battle')) && b.menu) {
      st.battle = {
        id: b.battleId,
        over: !!b.battleOver,
        pending: !!b.menu.pending,
        pause: b.tutorialPause ? `${b.tutorialPause.id}:${b.tutorialPause.step}` : null, // a tutorial pause is up: any tap continues
        items: (b.menu.items || []).map((i) => ({ slot: i.slot, value: i.value && typeof i.value === 'object' ? 'enemy' : i.value, enabled: i.enabled !== false })),
        rings: [...(b.qteRings || [])].map((r) => r.impactAt),
        redRings: [...(b.qteRings || [])].filter((r) => r.unparryable).map((r) => r.impactAt),
        nala: b.nala ? { watching: !!b.nala.ring, used: b.nala.used, x: b.nala.container.x, y: b.nala.container.y } : null,
        hero: b.activeHero?.type || null,
        heroes: (b.heroes || []).map((h) => ({ id: h.type, hp: h.hp, maxHp: h.maxHp, echo: h.echo })),
        enemies: (b.enemies || []).map((e) => ({ id: e.id, type: e.type, hp: e.hp, maxHp: e.maxHp, x: e.container.x, y: e.container.y, phase: e.phase || 0, charging: !!e.charge, strikeImmune: !!e.def?.immune?.includes('strike') })),
        echo: (b.heroes || []).map((h) => h.echo).join('|'),
      };
    }
    const d = g.scene.getScene('Dialogue');
    if (active.includes('Dialogue')) st.dialogue = { id: d.dialogueId, index: d.index };
    // The first New Game's difficulty panel (MenuScene).
    st.menuPanel = active.includes('Menu') && !!g.scene.getScene('Menu').panel;
    const c = g.scene.getScene('Cutscene');
    if (active.includes('Cutscene')) st.cutscene = { index: c.index };
    if (active.includes('Reward')) st.reward = { id: g.registry.get('runner')?.step?.id };
    return st;
  });
}

function pickWeighted(weights) {
  const entries = Object.entries(weights);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export class Bot {
  // opts: {profile, useNala, rotation, alwaysAnchor, log}
  constructor(page, opts = {}) {
    this.page = page;
    this.profile = opts.profile || { PERFECT: 0.4, GOOD: 0.3, MISS: 0.3 };
    this.dodgeChance = opts.dodgeChance ?? simPolicy.dodgeChance?.[opts.profileName] ?? 0.2;
    this.useNala = opts.useNala ?? true;
    this.rotation = opts.rotation || null;
    this.alwaysAnchor = !!opts.alwaysAnchor;
    this.log = opts.log || (() => {});
    this.handledRings = new Set();
    this.turns = {};
    this.want = null;
    this.lastTapAt = 0;
    this.results = { PERFECT: 0, GOOD: 0, MISS: 0, nala: 0 };
    this.events = [];
  }

  async tapOnce(x, y, minGapMs = 250) {
    if (Date.now() - this.lastTapAt < minGapMs) return;
    this.lastTapAt = Date.now();
    await tap(this.page, x, y);
  }

  // One decision. Returns the probed state.
  async step() {
    const st = await probe(this.page);
    if (st.booting) return st;
    const nodeNow = Date.now();
    const has = (k) => st.active.includes(k);

    if (has('Pause')) await this.tapOnce(180, 320, 400);
    else if (st.battle && has('Battle') && !has('Dialogue')) await this.battleStep(st, nodeNow);
    else if (has('Reward')) await this.tapOnce(180, 190, 1500); // the first card
    else if (has('Dialogue')) await this.tapOnce(180, 560, 200);
    else if (has('Cutscene')) await this.tapOnce(180, 480, 250);
    else if (has('Title')) await this.tapOnce(180, ui.title.tap.y, 500);
    // The difficulty panel asks on every New Game: pick the second entry (Normal).
    else if (has('Menu')) await this.tapOnce(180, st.menuPanel ? ui.menu.difficulty.firstY + ui.menu.difficulty.spacing : ui.menu.firstY, 800);
    else if (has('End')) await this.tapOnce(180, 600, 800);
    return st;
  }

  async battleStep(st, nodeNow) {
    const b = st.battle;

    // A tutorial pause (spotlight + text): any tap continues (it ignores the first 300 ms).
    if (b.pause) return this.tapOnce(180, 320, 450);

    // Rings: decide once per ring, tap on a timer so the loop keeps polling.
    for (const impactAt of b.rings) {
      const id = Math.round(impactAt);
      if (this.handledRings.has(id)) continue;
      this.handledRings.add(id);
      if (this.useNala && b.nala?.watching && !b.nala.used) {
        this.results.nala += 1;
        await tap(this.page, b.nala.x, b.nala.y);
        continue;
      }
      const result = pickWeighted(this.profile);
      this.results[result] += 1;
      if (result === 'MISS') continue;
      // A red ring can only be answered with a swipe (normal windows); a white one is swiped
      // (dodge windows) dodgeChance of the time, else tapped (parry windows).
      const red = b.redRings.includes(impactAt);
      const dodge = !red && Math.random() < this.dodgeChance;
      const w = dodge ? qte.dodge.windows : qte.windows;
      const offset = result === 'PERFECT' ? 0 : (w.perfectMs + w.goodMs) / 2;
      const delay = impactAt + offset - st.now - 6;
      const act = red || dodge ? swipe : tap;
      setTimeout(() => act(this.page, ...TAP_ZONE).catch(() => {}), Math.max(0, delay));
    }
    if (b.rings.length) return;

    if (!b.pending) {
      this.menuSig = null;
      if (b.over) await this.tapOnce(180, 560, 600); // "Tap to continue"
      return;
    }
    // Decide once per menu on screen, then keep trying that tap.
    const sig = `${b.hero}|${b.items.map((i) => `${i.value}:${i.enabled}`).join(',')}`;
    if (sig !== this.menuSig) {
      this.menuSig = sig;
      this.decision = this.decide(b);
      if (process.env.BOTLOG) console.log('menu', sig, '->', JSON.stringify(this.decision));
    }
    const d = this.decision;
    if (d.slot) await this.tapOnce(slots[d.slot][0], slots[d.slot][1], 250);
    else await this.tapOnce(d.x, d.y, 250);
  }

  // -> {slot} or {x, y} (an enemy to target).
  decide(b) {
    const items = b.items;
    const values = items.map((i) => i.value);
    if (values.includes('retry')) {
      this.events.push('retry');
      return { slot: 'retry' };
    }
    // Target prompt (only Back on screen): the weakest living enemy (for a
    // Strike, the weakest one it can hurt: Hollows are immune).
    if (items.length === 1 && values[0] === null) {
      const living = b.enemies
        .filter((e) => e.hp > 0)
        .sort((a, c) => (this.striking ? a.strikeImmune - c.strikeImmune : 0) || a.hp - c.hp);
      return living[0] ? { x: living[0].x, y: living[0].y } : { slot: 'back' };
    }
    if (values.includes('ultimate')) return { slot: 'ultimate' };

    if (values.includes('technique')) {
      if (this.forceStrike) {
        this.forceStrike = false;
        this.striking = true;
        return { slot: 'strike' };
      }
      const rot = (this.rotation || ROTATION)[b.hero] || ['strike'];
      const n = (this.turns[b.hero] = (this.turns[b.hero] || 0) + 1) - 1;
      this.want = rot[n % rot.length];
      // Anchor only when someone needs it.
      if (this.want === 'anchor' && !this.alwaysAnchor && !b.heroes.some((h) => h.hp < h.maxHp * 0.6)) this.want = 'strike';
      const tech = items.find((i) => i.value === 'technique');
      this.striking = this.want === 'strike' || !tech?.enabled;
      return this.striking ? { slot: 'strike' } : { slot: 'technique' };
    }
    // Technique submenu: the wanted one if affordable, else Back -> Strike.
    const wanted = items.find((i) => i.value === this.want && i.enabled);
    if (wanted) return { slot: wanted.slot };
    this.forceStrike = true;
    return { slot: 'back' };
  }

  // Steps until stopWhen(state) is true. Fails on page errors or when nothing
  // changes for stallMs.
  async run({ stopWhen, timeoutMs = 600000, stallMs = 20000, signature = defaultSignature }) {
    const start = Date.now();
    let lastSig = null;
    let lastChange = Date.now();
    while (true) {
      const st = await this.step();
      if (this.page.errors.length) throw new Error(`page error: ${this.page.errors[0]}`);
      if (!st.booting && stopWhen(st)) return st;
      const sig = signature(st);
      if (sig !== lastSig) {
        lastSig = sig;
        lastChange = Date.now();
      } else if (Date.now() - lastChange > stallMs) {
        throw new Error(`soft-lock: no change for ${stallMs}ms at ${sig}`);
      }
      if (Date.now() - start > timeoutMs) throw new Error(`timeout after ${timeoutMs}ms at ${sig}`);
      await sleep(40);
    }
  }
}

// What counts as progress: the active scenes, the dialogue line / cutscene
// shot, and in battle HP, Echo, rings and whose turn it is.
export function defaultSignature(st) {
  if (st.booting) return 'booting';
  const parts = [st.active.join('+')];
  if (st.dialogue) parts.push(`d:${st.dialogue.id}:${st.dialogue.index}`);
  if (st.cutscene) parts.push(`c:${st.cutscene.index}`);
  if (st.battle) {
    const b = st.battle;
    parts.push(`b:${b.hero}:${b.echo}:${b.rings.length}:${b.pending}:${b.over}:${b.pause}`);
    parts.push(b.heroes.map((h) => h.hp).join(','), b.enemies.map((e) => e.hp).join(','));
  }
  return parts.join('|');
}
