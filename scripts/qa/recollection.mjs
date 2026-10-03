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
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { open, playBeats, root, sleep, withBrowser } from './lib.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ui = read('src/data/ui.json');
const rc = read('src/data/recollection.json');
const dialogue = read('src/data/dialogue.json');
const clerk = read('src/data/enemies.json').clerk;
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

// The real loop up to Rhea's Recollection: jump to the moment, let Quill's opening attack land
// (no input), Strike with Dov if his menu comes first, then cast.
async function reachCast(page) {
  await page.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.forceRecollectionReady)`, { timeout: 40000 });
  await page.ev(`window.__battle.forceRecollectionReady(); window.__battle.tutorialSlow = false;`);
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await hasDialogue(page)) await page.tap(180, 560);
    else if (await page.ev(menuWith('ultimate'))) {
      await page.ev(`window.__battle.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__battle.refreshHud();`);
      await sleep(400); // the menu ignores a tap in its first moments
      await page.tap(...slots.ultimate);
      if (await waitFlag(page, `!window.__battle.menu.pending`, 1500)) return true;
    } else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) {
      await sleep(400);
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
  const url = `${server.url}?battle=boss_clerk&level=4&echo=10`;
  const threshold = Math.floor((clerk.hp * clerk.stages[1].recollectionAtHpPct) / 100);

  // ============ A: cut-in tapped through, PERFECT x3 ============
  {
    const page = await open(chrome, url, { init: [HOOKS] });
    log(await reachCast(page), 'A: Recollection offered to Rhea and cast (real loop, forceRecollectionReady)');
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
    await playBeats(page, { results: ['PERFECT', 'PERFECT', 'PERFECT'] });
    await waitFlag(page, `window.__beats.length === 3`, 10000);
    const beats = await page.ev(`window.__beats.slice()`);
    log(beats.join() === 'PERFECT,PERFECT,PERFECT', 'A: HOLD (release at 70%), SWIPE (arrow way), TAPS (6 quick) each judged PERFECT', `${beats.join(' ')} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
});
console.log(failed ? `\n${failed} check(s) FAILED` : '\nrecollection lab: all passed');
process.exit(failed ? 1 : 0);
