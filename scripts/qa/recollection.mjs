// QA: the Recollection cut-in + "Burn the memory" minigame + the failed-memory rewind, in the dev build.
//   node scripts/qa/recollection.mjs --out dir
// Every page opens ?battle=boss_clerk&level=4&echo=10 and jumps Quill to the Recollection moment
// (window.__battle.forceRecollectionReady(): stage 2 at the unlock HP, Rhea at full Echo), then plays
// the real turn loop with synthetic pointer input (hold / swipe / 6 taps).
//   A: cut-in (both beats, tapped through) -> PERFECT x3 -> FLAWLESS finisher -> Victory, grade on the card
//   B: cut-in (auto-advance) -> no input: MISS x3 -> "The memory slips" -> Unwriting (NO ESCAPE) -> LOSE
//      card (Try again / Quit, tap-target sizes) -> Try again: the cast again (Echo 10, Quill at the
//      threshold, stage 2) -> GOOD x3 -> CLEAN -> Victory
//   C: forced MISS x3 -> Unwriting -> Quit -> Menu
//   E: the threshold is crossed during Quill's own two-hit attack: the 2nd ring is cancelled, the cast follows
//   D: the real Keepsake: Quill crosses the threshold, Rhea is DOWN, the keepsake_burn dialogue ends ->
//      MEMORY READY, she gets up (autoCast.reviveHp) and the Recollection casts itself (no menu pick),
//      the recollection track from the dialogue start (no one-shot, no silence), 20-tap finale -> Victory
// The finale (taps): a big "n / 20" counter, 1 px shake + sparks per tap, Quill cracks (tint), pitch-rising
// tap_milestone sfx at 5 / 10 / 15 / 20, at most 6 extra objects.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { INIT, open, playBeats, root, sleep, withBrowser } from './lib.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ui = read('src/data/ui.json');
const rc = read('src/data/recollection.json');
const dialogue = read('src/data/dialogue.json');
const clerk = read('src/data/enemies.json').clerk;
const taps = rc.beats.taps;
const milestones = Object.keys(taps.fx.milestones).map(Number);
const slots = ui.commands.slots;
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
let failed = 0;
const log = (ok, name, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

// Records each beat's result, the snapshot echo at the rewind and the texts on screen.
const HOOKS = `(() => {
  window.__beats = []; window.__resume = [];
  const iv = setInterval(() => {
    const B = window.__battle; if (!B || B.__rHooked || !B.beatHit) return; B.__rHooked = true; clearInterval(iv);
    const bh = B.beatHit.bind(B); B.beatHit = (t, r) => { window.__beats.push(r); return bh(t, r); };
    const pu = B.playUnwriting.bind(B); B.playUnwriting = (e, a) => { window.__unwriting = (window.__unwriting || 0) + 1; return pu(e, a); };
    const rr = B.resumeRecollection.bind(B); B.resumeRecollection = () => { const h = B.heroes.find((x) => x.def.canUltimate); window.__resume.push({ echo: h.echo, hp: B.enemies[0].hp, max: B.enemies[0].maxHp, phase: B.enemies[0].phase, aura: !!B.enemies[0].aura }); return rr(); };
  }, 2);
})()`;

const B = (page, expr) => page.ev(`(() => { const B = window.__battle; return ${expr}; })()`);
const waitFlag = (page, expr, timeout = 20000) => page.waitFor(expr, { timeout, interval: 30 }).then(() => true, () => false);
const hasDialogue = async (page) => (await page.scenes()).includes('Dialogue');
const menuWith = (value) => `!!(window.__battle && window.__battle.menu && window.__battle.menu.pending && (window.__battle.menu.items || []).some((i) => i.value === ${JSON.stringify(value)}))`;

// Quill opens the fight: the first menu is up once his attack has landed (and, when it was a feint, the
// quill_feint dialogue has been tapped through).
async function menuPending(page, timeout = 40000) {
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout });
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await hasDialogue(page)) await page.tap(180, 560);
    else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) return;
    await sleep(150);
  }
  throw new Error('menuPending timed out');
}

// The real loop up to Rhea's Recollection: jump to the moment, let Quill's opening attack land
// (no input), Strike with Dov if his menu comes first. There is no Recollection slot in the menu any more:
// the dev jump (?recollection=1 / forceRecollectionReady) makes Rhea cast at her first menu.
async function reachCast(page) {
  await page.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.forceRecollectionReady)`, { timeout: 40000 });
  await page.ev(`(() => { const B = window.__battle; window.__cast = false; const f = B.playRecollection.bind(B); B.playRecollection = (...a) => { window.__cast = true; return f(...a); }; B.forceRecollectionReady(); B.tutorialSlow = false; })()`);
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await page.ev(`window.__cast === true`)) return true;
    if (await hasDialogue(page)) await page.tap(180, 560);
    else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) {
      await page.ev(`window.__battle.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__battle.refreshHud();`);
      const ultimateSlot = await page.ev(menuWith('ultimate'));
      if (ultimateSlot) return false; // the old slot is back: that is a regression
      await sleep(400); // the menu ignores a tap in its first moments
      await page.tap(...slots.strike);
    }
    await sleep(120);
  }
  return false;
}

async function shotBeat(page, name) {
  await sleep(450);
  await page.shot(join(out, name));
}

await withBrowser(async ({ chrome, server }) => {
  const url = `${server.url}?battle=boss_clerk&level=4&echo=10&pauses=0`;
  const threshold = Math.floor((clerk.hp * clerk.stages[1].recollectionAtHpPct) / 100);

  // ============ A: cut-in tapped through, PERFECT x3 ============
  {
    const page = await open(chrome, url, { init: [HOOKS, INIT.audioLog] });
    log(await reachCast(page), 'A: Rhea casts the Recollection (real loop, forceRecollectionReady: no menu slot for it)');
    const cut = rc.cutIn;
    log(await waitFlag(page, `!!(window.__battle.cutInState && window.__battle.cutInState.beat === 0)`, 8000), 'A: cut-in beat 1 shows');
    await sleep(1300); // typing done
    const c1 = await B(page, 'Object.assign({}, B.cutInState)');
    await page.shot(join(out, 'cutin_1_power.png'));
    log(c1.portrait === dialogue[cut][0].portrait && c1.text === dialogue[cut][0].text, `A: beat 1 = ${c1.portrait} "${c1.text}"`);
    await page.tap(180, 560);
    log(await waitFlag(page, `!!(window.__battle.cutInState && window.__battle.cutInState.beat === 1)`, 3000), 'A: a tap moves to beat 2');
    await sleep(700);
    const c2 = await B(page, 'Object.assign({}, B.cutInState)');
    await page.shot(join(out, 'cutin_2_tears.png'));
    log(c2.portrait === dialogue[cut][1].portrait && c2.text === dialogue[cut][1].text, `A: beat 2 = ${c2.portrait} "${c2.text}"`);
    const real = await B(page, `({ power: (window.__game.textures.get('rhea_cutin_power').customData || {}).aliasOf || 'real', tears: (window.__game.textures.get('rhea_cutin_tears').customData || {}).aliasOf || 'real' })`);
    await page.tap(180, 560);
    log(await waitFlag(page, `!window.__battle.cutInState`, 3000), 'A: a tap ends the cut-in (band slides out)', `portraits: power -> ${real.power}, tears -> ${real.tears}`);
    const t0 = Date.now();
    // The headless page renders only a few frames per second, so the finale is sampled per tap: the scene's tap FX
    // (scene.recollectionTapFx.tap, called once per tap right after the counter text is set) is wrapped.
    const startSampler = () => page.ev(`(() => {
      const B = window.__battle; window.__fin = [];
      const fx = B.recollectionTapFx; const tap = fx.tap;
      fx.tap = (a) => {
        tap(a);
        const c = B.children.list.find((o) => o.type === 'Text' && /^\\d+ \\/ \\d+$/.test(o.text));
        window.__fin.push({ n: a.count, text: c ? c.text : null, scale: c ? c.scale : 1, tw: c ? B.tweens.getTweensOf(c).length : 0, hi: B.children.list.filter((o) => o.active && o.depth >= ${rc.depth}).length, tint: B.enemies[0].body.baseTint });
      };
    })()`);
    await playBeats(page, { results: ['PERFECT', 'PERFECT', 'PERFECT'], onBeat: async (b) => { if (b.kind === 'taps') await startSampler(); } });
    await waitFlag(page, `window.__beats.length === 3`, 10000);
    const finale = await page.ev(`window.__fin`);
    const beats = await page.ev(`window.__beats.slice()`);
    log(beats.join() === 'PERFECT,PERFECT,PERFECT', `A: HOLD (release at 70%), SWIPE (arrow way), TAPS (${taps.taps} quick) each judged PERFECT`, `${beats.join(' ')} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const texts = new Set(finale.map((f) => f.text));
    log(taps.taps === 20 && taps.tapWindowMs === 5000 && taps.perfectSpareMs === 1000, 'A: finale data: taps 20, window 5000 ms, PERFECT with >= 1000 ms to spare');
    log(finale.length === taps.taps && finale.every((f, i) => f.text === `${i + 1} / ${taps.taps}`), `A: the big counter shows 1 / ${taps.taps} ... ${taps.taps} / ${taps.taps}, one step per tap`, `${finale.length} taps seen`);
    log(taps.counter.popScale >= 1.3 && finale.every((f) => f.tw > 0), 'A: the counter pops on every tap (a scale tween from popScale ' + taps.counter.popScale + ' to 1 starts with each tap)', `${finale.filter((f) => f.tw > 0).length} of ${finale.length} taps`);
    const green = (t) => (t >> 8) & 0xff;
    log(finale.every((f, i) => i === 0 || green(f.tint) <= green(finale[i - 1].tint)) && green(finale.at(-1).tint) <= green(finale[0].tint) * 0.4, 'A: Quill cracks: his tint goes from white toward red as the count rises', `green ${green(finale[0].tint)} -> ${green(finale.at(-1).tint)}`);
    const own = finale[0].hi - 2;
    log(own <= 6, 'A: the finale keeps at most 6 objects of its own alive (counter, meter x2, time bar, 1 pooled spark emitter)', `${own} persistent, peak with transients +${Math.max(...finale.map((f) => f.hi)) - finale[0].hi}`);
    const sfx = (await page.ev(`(window.__audio.log || []).filter((e) => e.ev === 'sfx' && e.name === ${JSON.stringify(taps.fx.milestoneSfx)}).map((e) => e.pitch)`));
    log(sfx.join() === milestones.map((m) => taps.fx.milestones[m].pitch).join() && sfx.every((p, i) => i === 0 || p > sfx[i - 1]), `A: ${taps.fx.milestoneSfx} plays at taps ${milestones.join(' / ')} with a rising pitch`, sfx.join(' '));
    log(await waitFlag(page, `window.__battle.children.list.some((c) => c.type === 'Text' && c.text === ${JSON.stringify(rc.grades.FLAWLESS.title)})`, 4000), 'A: FLAWLESS finisher title');
    await sleep(250);
    await page.shot(join(out, 'finisher_flawless.png'));
    const k = await B(page, '({ hp: B.enemies[0].hp, rising: B.enemies[0].rising, grade: B.stats.recollectionGrade })');
    log(k.hp === 0 && !k.rising && k.grade === 'FLAWLESS', 'A: Quill dies (0 HP, not rising), stats.recollectionGrade FLAWLESS', JSON.stringify(k));
    log(await waitFlag(page, `window.__battle.battleOver === true`, 15000), 'A: the normal WIN path (battleOver)');
    const cardLine = rc.card.text.replace('{grade}', rc.grades.FLAWLESS.title);
    log(await waitFlag(page, `window.__battle.children.list.some((c) => c.type === 'Text' && c.text === ${JSON.stringify(cardLine)})`, 8000), `A: the result card shows "${cardLine}"`);
    await sleep(1500);
    await page.shot(join(out, 'result_card_grade.png'));
    log(page.errors.length === 0, 'A: no console errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ B: all MISS -> Unwriting -> LOSE -> Try again -> GOOD x3 ============
  {
    const page = await open(chrome, url, { init: [HOOKS] });
    log(await reachCast(page), 'B: Recollection cast');
    log(await waitFlag(page, `!!(window.__battle.cutInState && window.__battle.cutInState.beat === 1)`, 6000), `B: the cut-in advances on its own (holdMs ${ui.cutIn.holdMs})`);
    await waitFlag(page, `!window.__battle.cutInState`, 6000);
    // no input: three MISS (screenshots of each beat while it waits)
    const shots = { hold: 'beat_hold.png', swipe: 'beat_swipe.png', taps: 'beat_taps.png' };
    await playBeats(page, { results: ['MISS', 'MISS', 'MISS'], onBeat: (b) => shotBeat(page, shots[b.kind]) });
    await waitFlag(page, `window.__beats.length === 3`, 10000);
    const beats = await page.ev(`window.__beats.slice()`);
    log(beats.join() === 'MISS,MISS,MISS', 'B: no input on any beat -> MISS x3', beats.join(' '));
    log(await waitFlag(page, `window.__battle.children.list.some((c) => c.type === 'Text' && c.text === ${JSON.stringify(rc.fail.text)})`, 5000), `B: "${rc.fail.text}"`);
    await sleep(300);
    await page.shot(join(out, 'memory_slips.png'));
    const s = await B(page, '({ hp: B.enemies[0].hp, force: B.enemies[0].forceNextAttack, echo: B.heroes.find((h) => h.def.canUltimate).echo, failed: B.memoryFailed })');
    log(s.hp === 1 && s.force === rc.fail.forceAttack && s.echo === 0 && s.failed, `B: Quill at 1 HP, next attack forced: ${rc.fail.forceAttack}, Rhea's Echo 0`, JSON.stringify(s));
    // Dov's turn (Strike: the floor keeps him at 1), then the Unwriting
    let sawRings = false;
    let noEscape = false;
    const end = Date.now() + 40000;
    while (Date.now() < end && !(await B(page, 'B.battleOver'))) {
      if (await B(page, '!!(B.menu && B.menu.pending && B.activeHero)')) {
        await sleep(400);
        await page.tap(...slots.strike);
      }
      const rings = await B(page, '(window.__unwriting && B.qteRings ? B.qteRings.size : 0)');
      if (rings && !sawRings) {
        sawRings = rings;
        await sleep(250);
        await page.tap(180, 560);
        await page.swipe(180, 560);
        await sleep(80);
        noEscape = await B(page, 'B.noEscapeShown');
        await page.shot(join(out, 'unwriting.png'));
      }
      await sleep(80);
    }
    const hp = await B(page, 'B.enemies[0].hp');
    log(sawRings >= 2 && noEscape >= 2, `B: Unwriting: a red ring on every living hero (${sawRings}), a tap and a swipe both show "${rc.noEscape.text}"`, `${noEscape} pops`);
    const lose = await B(page, '({ over: B.battleOver, heroes: B.heroes.map((h) => h.hp) })');
    log(lose.over && lose.heroes.every((x) => x === 0) && hp === 1, 'B: every hero down -> LOSE (Quill still at 1 HP)', JSON.stringify(lose));
    log(await waitFlag(page, menuWith('rewind'), 6000), 'B: the lose card offers Try again + Quit');
    const items = await B(page, 'B.menu.items.map((i) => i.label)');
    const buttons = await B(page, `(() => { const out = []; const walk = (l) => { for (const o of l) { if (o.list) walk(o.list); if (o.input && o.input.enabled && o.visible !== false && o.type === 'Rectangle') { const b = o.getBounds(); const s = (o.parentContainer && o.parentContainer.scaleX) || 1; out.push({ x: b.centerX - b.width / s / 2, w: b.width / s, h: b.height / s }); } } }; walk(B.children.list); return out; })()`);
    const bad = buttons.filter((t) => Math.round(t.h) < 56 || Math.round(t.x) < 16 || Math.round(t.x + t.w) > 344);
    log(items.join('|') === `${ui.battleEnd.retryRecollectionText}|${ui.battleEnd.quitText}` && buttons.length >= 2 && !bad.length, `B: "${items.join('" / "')}" buttons >= 56 px tall, >= 16 px from the edges`, JSON.stringify(buttons.map((t) => [Math.round(t.x), Math.round(t.w), Math.round(t.h)])));
    await page.shot(join(out, 'lose_card.png'));
    await sleep(400);
    await page.tap(...slots.retryRecollection);
    log(await waitFlag(page, `!!(window.__battle && window.__battle.cutInState && window.__battle.cutInState.beat === 0)`, 20000), 'B: Try again re-enters the cut-in directly');
    const r = await page.ev(`window.__resume.slice(-1)[0] || null`);
    log(!!r && r.echo === 10 && r.hp === threshold && r.max === clerk.hp && r.phase === 1 && r.aura, `B: rewound to the cast: Rhea Echo 10, Quill ${threshold}/${clerk.hp} in stage 2 (aura on)`, JSON.stringify(r));
    await page.shot(join(out, 'rewind_cutin.png'));
    await page.ev(`window.__beats.length = 0`);
    await playBeats(page, { results: ['GOOD', 'GOOD', 'GOOD'] });
    await waitFlag(page, `window.__beats.length === 3`, 10000);
    const again = await page.ev(`window.__beats.slice()`);
    log(again.join() === 'GOOD,GOOD,GOOD', 'B: second try: late release / late swipe / slow taps -> GOOD x3', again.join(' '));
    log(await waitFlag(page, `window.__battle.battleOver === true && window.__battle.stats.recollectionGrade === 'CLEAN' && window.__battle.enemies[0].hp === 0`, 15000), 'B: CLEAN -> Quill dies -> Victory');
    log(page.errors.length === 0, 'B: no console errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ C: forced MISS -> Unwriting -> Quit ============
  {
    const page = await open(chrome, url, { init: [HOOKS] });
    await page.waitFor(`!!(window.__battle && window.__battle.forceRecollectionReady)`, { timeout: 40000 });
    await page.ev(`window.__battle.recollectionForce = 'MISS'`);
    log(await reachCast(page), 'C: Recollection cast (beats forced to MISS)');
    const end = Date.now() + 60000;
    while (Date.now() < end && !(await page.ev(menuWith('quit')))) {
      if (await B(page, '!!(B.menu && B.menu.pending && B.activeHero)')) {
        await sleep(400);
        await page.tap(...slots.strike);
      } else if (!(await B(page, 'B.cutInState'))) await sleep(50);
      else await page.tap(180, 560);
      await sleep(150);
    }
    log(await page.ev(menuWith('quit')), 'C: memory slipped -> Unwriting -> lose card');
    await sleep(400);
    await page.tap(...slots.quit);
    log(await waitFlag(page, `window.__game.scene.isActive('Menu') && !window.__game.scene.isActive('Battle')`, 10000), 'C: Quit -> Menu (Battle stopped)');
    log(page.errors.length === 0, 'C: no console errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ D: the real Keepsake -> auto-cast (Rhea down) -> Victory ============
  {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4&pauses=0`, { init: [HOOKS, INIT.audioLog] });
    await menuPending(page);
    const ac = rc.autoCast;
    log(!!ac && ac.delayMs <= 600 + 1 && ac.reviveHp >= 1, 'D: recollection.json autoCast {delayMs, reviveHp} exists', JSON.stringify(ac));
    // Stage 2 just above the threshold, one hit crosses it; Rhea is down at that moment.
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; const e = B.enemies[0]; e.phase = 1; e.maxHp = ${clerk.hp}; e.hp = ${threshold + 3}; B.updateLabel(e); B.chain = 0; B.heroes.forEach((h) => { h.hp = h.maxHp; }); B.applyHit(e, 6); B.applyHit(B.heroes[0], 9999); window.__d = { cast: 0, menuSeen: false, rheaHpAtCut: null }; })()`);
    log(await B(page, 'B.pendingEvents.includes("keepsake_burn") && B.heroes[0].hp === 0'), 'D: the keepsake is queued and Rhea is down');
    await page.ev(`(() => { const B = window.__battle; window.__done = null; window.__ks = performance.now(); B.afterTurn().then(() => { window.__done = true; }); })()`);
    let n = 0;
    while (!(await hasDialogue(page)) && n++ < 100) await sleep(50);
    const musicAtStart = await page.ev(`(window.__audio.log || []).filter((e) => ['play', 'oneshot', 'silence', 'stop'].includes(e.ev)).map((e) => e.ev + ':' + (e.key || e.ms || ''))`);
    log(musicAtStart.at(-1) === 'play:recollection' && !musicAtStart.some((e) => e.startsWith('oneshot:keepsake')), 'D: the recollection track starts with the keepsake dialogue (no keepsake one-shot)', musicAtStart.join(' '));
    // Tap through the dialogue; watch the menu (it must never offer the cast) and time the cast.
    let ended = null;
    const watch = setInterval(async () => {
      try {
        if (await page.ev(menuWith('ultimate'))) await page.ev(`window.__d.menuSeen = true`);
      } catch (err) {
        // page gone
      }
    }, 100);
    for (let i = 0; i < 60 && (await hasDialogue(page)); i++) {
      await page.tap(180, 560);
      await sleep(260);
    }
    ended = Date.now();
    const readyAt = await waitFlag(page, `window.__battle.children.list.some((c) => c.type === 'Text' && c.text === ${JSON.stringify('MEMORY READY')})`, 1500);
    log(readyAt, 'D: the MEMORY READY flash shows right after the dialogue');
    const rheaUp = await B(page, '({ hp: B.heroes[0].hp, echo: B.heroes[0].echo, max: B.heroes[0].echoMax })');
    log(rheaUp.hp === ac.reviveHp && rheaUp.max === 10, `D: Rhea is back up at ${ac.reviveHp} HP, Echo cap 10`, JSON.stringify(rheaUp));
    const cutIn = await waitFlag(page, `!!(window.__battle.cutInState && window.__battle.cutInState.beat === 0)`, 6000);
    const cutDelay = Date.now() - ended;
    log(cutIn && cutDelay <= ac.delayMs + 3500, `D: the cut-in starts on its own ${cutDelay} ms after the dialogue (autoCast delayMs ${ac.delayMs}), nobody picked it`, `menu offered the cast: ${await B(page, 'window.__d.menuSeen')}`);
    const hpAtCut = await B(page, 'B.heroes[0].hp');
    log(hpAtCut === ac.reviveHp, `D: Rhea casts at ${hpAtCut} HP (the revive)`);
    // The cut-in line 2 is the new one and holds longer.
    await sleep(1300);
    await page.tap(180, 560);
    await waitFlag(page, `!!(window.__battle.cutInState && window.__battle.cutInState.beat === 1)`, 3000);
    const t2 = await B(page, 'B.cutInState && B.cutInState.text');
    log(t2 === 'Goodbye, Dov. Goodbye, Nala. Goodbye, Dad.', 'D: cut-in beat 2 reads "Goodbye, Dov. Goodbye, Nala. Goodbye, Dad."', t2);
    const hold = dialogue[rc.cutIn][1].holdMs;
    const t1 = Date.now();
    await waitFlag(page, `!window.__battle.cutInState`, 8000);
    const held = Date.now() - t1;
    log(hold === 3200 && held >= 3200 - 700 && held <= 3200 + 900, `D: beat 2 auto-advances after its own holdMs (${hold})`, `${held} ms left after the tear-line was up`);
    await playBeats(page, { results: ['PERFECT', 'GOOD', 'PERFECT'] });
    await waitFlag(page, `window.__beats.length === 3`, 10000);
    clearInterval(watch);
    log(await waitFlag(page, `window.__battle.enemies[0].hp === 0 && !window.__battle.enemies[0].rising`, 25000), 'D: the cast kills Quill (the turn loop is parked on the hidden menu here, so no Victory card)');
    log(await waitFlag(page, `window.__done === true`, 8000), 'D: afterTurn (the Keepsake event) resolved');
    const seq = await page.ev(`(window.__audio.log || []).filter((e) => ['play', 'oneshot', 'silence', 'stop'].includes(e.ev)).map((e) => e.ev + ':' + (e.key || e.ms || ''))`);
    log(!seq.some((e) => e.startsWith('silence')) && !seq.some((e) => e.startsWith('stop')) && !seq.some((e) => e.startsWith('oneshot:keepsake')) && seq.filter((e) => e === 'play:recollection').length >= 1 && seq.at(-1) === 'play:recollection', 'D: music: recollection from the dialogue to the kill, no silence, no stop, nothing after it', seq.join(' '));
    await page.shot(join(out, 'autocast_victory.png'));
    log(page.errors.length === 0, 'D: no console errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ E: the threshold is crossed DURING Quill's turn (a counter) ============
  {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4&pauses=0`, { init: [HOOKS] });
    await menuPending(page);
    await page.ev(`(() => {
      const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.recollectionForce = 'PERFECT';
      const e = B.enemies[0]; e.phase = 1; e.maxHp = ${clerk.hp}; e.hp = ${threshold + 3}; B.updateLabel(e); B.heroes.forEach((h) => { h.hp = h.maxHp; });
      B.pickAttack = () => ({ id: 'qa_two_hits', telegraphMs: 500, dmg: 5, hits: [{ telegraphMs: 500, dmg: 5 }, { telegraphMs: 500, dmg: 5 }] });
      window.__e = { hits: 0, turnDone: false, casts: 0 };
      const eh = B.enemyHit.bind(B);
      B.enemyHit = async (...a) => { window.__e.hits += 1; const r = await eh(...a); if (window.__e.hits === 1) { B.chain = 0; B.applyHit(B.enemies[0], 6); } return r; };
      const pr = B.playRecollection.bind(B); B.playRecollection = (...a) => { window.__e.casts += 1; return pr(...a); };
      B.enemyTurn(e).then(() => { window.__e.turnDone = true; });
    })()`);
    log(await waitFlag(page, `window.__e.turnDone === true`, 15000), 'E: Quill\'s two-hit attack ends after the hit that pushed him under the threshold');
    const st = await B(page, '({ hits: window.__e.hits, rings: B.qteRings ? B.qteRings.size : 0, hint: B.tapHint.visible, pending: B.pendingEvents.join(), hp: B.enemies[0].hp, casts: window.__e.casts })');
    log(st.hits === 1 && st.rings === 0 && !st.hint && st.pending === 'keepsake_burn' && st.casts === 0, 'E: the second ring never starts, no ring is left live, the tap hint is gone, the keepsake waits for the end of the turn', JSON.stringify(st));
    await page.ev(`(() => { const B = window.__battle; window.__done = null; B.afterTurn().then(() => { window.__done = true; }); })()`);
    for (let i = 0; i < 80 && !(await hasDialogue(page)) && i < 60; i++) await sleep(50);
    for (let i = 0; i < 60 && (await hasDialogue(page)); i++) {
      await page.tap(180, 560);
      await sleep(260);
    }
    log(await waitFlag(page, `!!(window.__battle.cutInState && window.__battle.cutInState.beat === 0)`, 6000), 'E: the Recollection casts itself right after the dialogue (mid-round, no menu)');
    log(await waitFlag(page, `window.__done === true`, 40000), 'E: the Keepsake event resolves (cut-in, forced beats, kill)');
    const fin = await B(page, '({ hp: B.enemies[0].hp, casts: window.__e.casts, hits: window.__e.hits, over: B.battleOver })');
    log(fin.hp === 0 && fin.casts === 1 && fin.hits === 1, 'E: Quill dead after exactly one cast, no further attack happened', JSON.stringify(fin));
    log(page.errors.length === 0, 'E: no console errors', page.errors.slice(0, 2).join(' | '));
  }
});
console.log(failed ? `\n${failed} check(s) FAILED` : '\nrecollection lab: all passed');
process.exit(failed ? 1 : 0);
