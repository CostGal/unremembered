// QA: Quill v3 lab (two stages with a revive). Drives the boss battle in the dev build (window.__battle).
//   node scripts/qa/quill.mjs --out dir
// Page A calls the scene's own methods (applyHit, enemyTurn, afterTurn, playRecollection) to check every
// beat; page B plays the real turn loop (UI taps) through the kill, the rise and the Recollection to Victory.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, withBrowser } from './lib.mjs';

const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8'));
const enemiesDef = JSON.parse(readFileSync(join(root, 'src/data/enemies.json'), 'utf8'));
const events = JSON.parse(readFileSync(join(root, 'src/data/battleEvents.json'), 'utf8'));
const slots = ui.commands.slots;
const clerk = enemiesDef.clerk;
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
let failed = 0;
const log = (ok, name, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

// Records who acts when (initiative) and the order of the rise beats.
const HOOKS = `(() => {
  window.__order = []; window.__calls = [];
  const iv = setInterval(() => {
    const B = window.__battle; if (!B || B.__qHooked || !B.enemyTurn) return; B.__qHooked = true; clearInterval(iv);
    const et = B.enemyTurn.bind(B); B.enemyTurn = (e) => { window.__order.push('enemy'); return et(e); };
    const pt = B.playerTurn.bind(B); B.playerTurn = (h) => { window.__order.push('hero:' + h.type); return pt(h); };
    const es = B.enterStage.bind(B); B.enterStage = (e, s) => { es(e, s); window.__calls.push({ what: 'enterStage', texts: B.children.list.filter((c) => c.type === 'Text').map((c) => c.text), phase: e.phase }); };
    const lg = B.laugh.bind(B); B.laugh = (...a) => { window.__calls.push({ what: 'laugh' }); return lg(...a); };
  }, 2);
})()`;

const B = (page, expr) => page.ev(`(() => { const B = window.__battle; return ${expr}; })()`);
const dialogueId = (page) => page.ev(`(window.__game.scene.getScene('Dialogue') || {}).dialogueId || null`);
const hasDialogue = async (page) => (await page.scenes()).includes('Dialogue');
async function waitDialogue(page, id, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await hasDialogue(page)) && (await dialogueId(page)) === id) return true;
    await sleep(60);
  }
  return false;
}
async function tapThrough(page) {
  for (let i = 0; i < 80 && (await hasDialogue(page)); i++) {
    await page.tap(180, 560);
    await sleep(260);
  }
}
const waitFlag = (page, expr, timeout = 20000) => page.waitFor(expr, { timeout }).then(() => true, () => false);
const trace = (page) => page.ev(`Object.assign({}, window.__animTrace || {})`);
const waitMenu = (page, timeout = 40000) => page.waitFor(`!!(window.__battle.menu && window.__battle.menu.pending)`, { timeout });

await withBrowser(async ({ chrome, server }) => {
  // ============ Page A: every beat, called directly ============
  {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4`, { init: [HOOKS] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await waitMenu(page);
    const order = await page.ev(`window.__order.slice()`);
    log(order[0] === 'enemy' && order.indexOf('hero:rhea') > 0, 'initiative "enemy": Quill acts before Rhea in round 1', order.join(' > '));
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.heroes.forEach((h) => { h.hp = h.maxHp; }); })()`);

    const half = Math.round((clerk.hp * clerk.stages[0].hpPct) / 100);
    const s1 = await B(page, '({ hp: B.enemies[0].hp, max: B.enemies[0].maxHp, phase: B.enemies[0].phase || 0, label: B.enemies[0].label.text })');
    log(s1.hp === half && s1.max === half && s1.phase === 0 && s1.label.includes(`${half}/${half}`), `stage 1 opens at ${clerk.stages[0].hpPct}% of hp (${half}/${half}), label shows the stage bar`, JSON.stringify(s1));

    // archive_warn: the first charge of the fight (stage 1's opening: stamp, then archive)
    await page.ev(`(() => { const e = window.__battle.enemies[0]; e.turnsInPhase = 1; window.__done = null; window.__battle.enemyTurn(e).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__done === true`, { timeout: 15000 });
    log(await B(page, 'B.pendingEvents.includes("archive_warn") && !!B.enemies[0].charge && B.enemies[0].charge.turnsLeft === ' + clerk.stages[0].attacks[2].chargeTurns), `archive_warn queued at the first charge start (stage 1, Archive in ${clerk.stages[0].attacks[2].chargeTurns})`);
    await page.ev(`window.__done = null; window.__battle.afterTurn().then(() => { window.__done = true; }); null`);
    log(await waitDialogue(page, 'archive_warn'), 'archive_warn dialogue plays after that turn');
    await page.shot(join(out, 'quill_archive_warn.png'));
    await tapThrough(page);
    await page.waitFor(`window.__done === true`, { timeout: 8000 });
    // not again
    await page.ev(`(() => { const B = window.__battle; B.dropCharge(B.enemies[0]); const e = B.enemies[0]; e.turnsInPhase = 1; window.__done = null; B.enemyTurn(e).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__done === true`, { timeout: 15000 });
    log(await B(page, '!B.pendingEvents.includes("archive_warn") && !!B.enemies[0].charge'), 'archive_warn is once per battle (a second charge start queues nothing)');
    await page.ev(`window.__done = null; window.__battle.afterTurn().then(() => { window.__done = true; }); null`);
    await page.waitFor(`window.__done === true`, { timeout: 8000 });

    // Kill him while he charges: not a win, he is only down
    const cnt0 = await B(page, 'B.heroes.map(h => h.hp)');
    await page.ev(`(() => { const B = window.__battle; B.chain = 0; B.applyHit(B.enemies[0], 999); })()`);
    const down = await B(page, '({ hp: B.enemies[0].hp, rising: B.enemies[0].rising, charge: !!B.enemies[0].charge, allDown: B.enemies.every((e) => e.hp <= 0 && !e.rising), over: B.battleOver, label: B.enemies[0].label.alpha })');
    log(down.hp === 0 && down.rising === true && !down.charge && down.allDown === false && !down.over, 'stage 1 at 0 HP: down but not defeated (rising, charge dropped, win check ignores him)', JSON.stringify(down));
    await page.ev(`window.__done = null; window.__battle.afterTurn().then(() => { window.__done = true; }); null`);
    log(await waitDialogue(page, 'quill_rise'), 'quill_rise dialogue plays after the death animation');
    const atDialogue = await trace(page);
    const pose = await B(page, '({ frame: B.enemies[0].body.anims.currentFrame && B.enemies[0].body.anims.currentFrame.index, key: B.enemies[0].body.anims.currentAnim && B.enemies[0].body.anims.currentAnim.key })');
    log(atDialogue['play:clerk_death'] === 1 && !atDialogue['playReverse:clerk_death'] && pose.key === 'clerk_death', 'the death sheet ran first and holds its last frame under the dialogue', JSON.stringify({ pose, death: atDialogue['play:clerk_death'] }));
    await page.shot(join(out, 'quill_dead_pose.png'));
    await tapThrough(page);
    // reverse playing
    await waitFlag(page, `(window.__animTrace || {})['playReverse:clerk_death'] === 1`, 4000);
    await sleep(350);
    await page.shot(join(out, 'quill_rising.png'));
    const mid = await B(page, '({ frame: B.enemies[0].body.anims.currentFrame && B.enemies[0].body.anims.currentFrame.index, fwd: B.enemies[0].body.anims.forward, hp: B.enemies[0].hp, rising: B.enemies[0].rising })');
    log(mid.fwd === false && mid.rising === true && mid.hp === 0, 'then the death sheet plays in reverse (anims.forward false, still down)', JSON.stringify(mid));
    await page.waitFor(`window.__done === true`, { timeout: 15000 });
    await sleep(300);
    await page.shot(join(out, 'quill_enraged.png'));
    const st = await B(page, `({ hp: B.enemies[0].hp, max: B.enemies[0].maxHp, phase: B.enemies[0].phase, rising: B.enemies[0].rising, tint: B.enemies[0].body.tintTopLeft, base: B.enemies[0].body.baseTint, aura: !!B.enemies[0].aura, auraAlpha: B.enemies[0].aura && B.enemies[0].aura.glow.alpha, poise: B.enemies[0].poise === B.enemies[0].maxPoise, exposed: B.enemies[0].exposed, label: B.enemies[0].label.text, over: B.battleOver, anim: B.enemies[0].body.anims.currentAnim && B.enemies[0].body.anims.currentAnim.key })`);
    const tr = await trace(page);
    log(st.hp === clerk.hp && st.max === clerk.hp && st.phase === 1 && !st.rising && st.label.includes(`${clerk.hp}/${clerk.hp}`) && st.anim === 'clerk_idle', `he rises: HP ${clerk.hp}/${clerk.hp}, stage 2, back to idle`, JSON.stringify(st));
    log(tr['playReverse:clerk_death'] === 1 && st.poise && st.exposed === null, 'poise refilled, statuses cleared, reverse anim ran once');
    log(st.aura && st.base !== undefined && st.base !== 0xffffff, 'stage 2 look: body tint + additive aura circle', `tint ${st.base && st.base.toString(16)}, aura alpha ${st.auraAlpha}`);
    const calls = await page.ev(`window.__calls.slice()`);
    const en = calls.find((c) => c.what === 'enterStage');
    log(!!en && en.texts.includes(events.stage.enragedText) && (events.stage.laughText === '' || en.texts.includes(events.stage.laughText)), `"${events.stage.enragedText}" pop (and the laugh) at the rise`, JSON.stringify(en && en.texts));
    log(!st.over, 'the battle goes on (no Victory at the stage end)');
    log(page.errors.length === 0, 'no console errors so far', page.errors.slice(0, 2).join(' | '));

    // the laugh every 2-3 turns
    await page.ev(`window.__calls.length = 0; const e = window.__battle.enemies[0]; for (let i = 0; i < 3; i++) window.__battle.stageLaugh(e);`);
    const laughs = await page.ev(`window.__calls.filter((c) => c.what === 'laugh').length`);
    log(laughs === 1, 'a laugh within every 2-3 of his turns (3 turns -> exactly 1)', `${laughs}`);

    // archive_threat: the first charge of stage 2, Archive in 2
    const a2 = clerk.stages[1].attacks.find((a) => a.id === 'archive');
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__stub = (v) => { const o = Math.random; let i = 0; Math.random = () => { const x = v[i++]; if (i >= v.length) Math.random = o; return x === undefined ? o() : x; }; }; window.__stub([0, 0.9999]); window.__done = null; B.enemyTurn(B.enemies[0]).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__done === true`, { timeout: 15000 });
    const ch = await B(page, '({ turns: B.enemies[0].charge && B.enemies[0].charge.turnsLeft, text: B.enemies[0].charge && B.enemies[0].charge.counter.text, ev: B.pendingEvents.slice() })');
    log(ch.turns === a2.chargeTurns && /Archive in 2/.test(ch.text || '') && ch.ev.includes('archive_threat'), `stage 2 Archive charges for ${a2.chargeTurns} ("${ch.text}") and queues archive_threat`, JSON.stringify(ch));
    await page.ev(`window.__done = null; window.__battle.afterTurn().then(() => { window.__done = true; }); null`);
    log(await waitDialogue(page, 'archive_threat'), 'archive_threat dialogue plays on the first stage-2 charge');
    await tapThrough(page);
    await page.waitFor(`window.__done === true`, { timeout: 8000 });

    // keepsake: Recollection unlock at <= recollectionAtHpPct of stage 2
    const pct = clerk.stages[1].recollectionAtHpPct;
    const above = Math.floor((clerk.hp * pct) / 100) + 1;
    await page.ev(`(() => { const B = window.__battle; B.dropCharge(B.enemies[0]); const e = B.enemies[0]; e.hp = ${above} + 3; B.updateLabel(e); B.chain = 0; B.applyHit(e, 2); })()`);
    log(await B(page, '!B.pendingEvents.includes("keepsake_burn") && B.heroes[0].echoMax < 10'), `above ${pct}% of stage 2: no keepsake yet, Recollection still locked`);
    await page.ev(`(() => { const B = window.__battle; B.chain = 0; B.applyHit(B.enemies[0], 6); })()`);
    const hpNow = await B(page, 'B.enemies[0].hp');
    log(await B(page, 'B.pendingEvents.includes("keepsake_burn")'), `crossing ${pct}% of stage 2 (hp ${hpNow}/${clerk.hp}) queues the keepsake_burn event`);
    await page.ev(`window.__done = null; window.__battle.afterTurn().then(() => { window.__done = true; }); null`);
    log(await waitDialogue(page, 'keepsake_burn'), 'keepsake_burn dialogue plays');
    await tapThrough(page);
    await page.waitFor(`window.__done === true`, { timeout: 10000 });
    log(await B(page, 'B.heroes[0].echoMax === 10 && B.heroes[0].echo === 10 && B.canUltimate(B.heroes[0])'), 'Rhea: Echo cap 10 and full, Recollection available');
    await page.ev(`(() => { const B = window.__battle; B.chain = 0; B.applyHit(B.enemies[0], 1); })()`);
    log(await B(page, '!B.pendingEvents.includes("keepsake_burn")'), 'keepsake_burn fires once');

    // Recollection always kills (the three rings are left unanswered: MISS x3 = 60 damage, far under his HP)
    const rhea = await B(page, 'B.heroes.findIndex((h) => h.def.canUltimate)');
    await page.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; e.hp = e.maxHp; B.updateLabel(e); window.__done = null; B.playRecollection(B.heroes[${rhea}], e).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__done === true`, { timeout: 20000 });
    const k = await B(page, '({ hp: B.enemies[0].hp, rising: B.enemies[0].rising, allDown: B.enemies.every((e) => e.hp <= 0 && !e.rising), aura: !!B.enemies[0].aura })');
    const tr2 = await trace(page);
    log(k.hp === 0 && !k.rising && k.allDown && tr2['play:clerk_death'] === 2, 'Recollection kills him from full HP: the normal death, defeated (not rising)', JSON.stringify({ ...k, deaths: tr2['play:clerk_death'] }));
    await sleep(600);
    await page.shot(join(out, 'quill_recollection_kill.png'));
    log(page.errors.length === 0, 'page A: no console errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ Page B: the real loop (taps) ============
  {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4`, { settings: { difficulty: 'story', storyMode: true, difficultyChosen: true }, init: [HOOKS] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await waitMenu(page);
    await page.ev(`(() => { const B = window.__battle; B.tutorialSlow = false; B.enemies[0].hp = 1; B.updateLabel(B.enemies[0]); })()`);
    await page.tap(...slots.strike); // Rhea's Strike (one enemy: automatic target)
    log(await waitDialogue(page, 'quill_rise', 25000), 'real loop: Rhea\'s Strike takes stage 1 to 0 -> quill_rise');
    await tapThrough(page);
    log(await waitFlag(page, `window.__battle.enemies[0].phase === 1 && !window.__battle.enemies[0].rising`, 15000) && (await B(page, '!B.battleOver')), 'real loop: he rises into stage 2 and the fight continues');
    await waitMenu(page); // Dov's turn
    log(await B(page, 'B.activeHero && B.activeHero.type === "dov"'), 'real loop: the turn order goes on (Dov next)');
    // Dov's Strike pushes him through the Recollection threshold
    const pct = clerk.stages[1].recollectionAtHpPct;
    const just = Math.floor((clerk.hp * pct) / 100) + 4;
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => { h.hp = h.maxHp; }); B.enemies[0].hp = ${just}; B.updateLabel(B.enemies[0]); })()`);
    await page.tap(...slots.strike);
    log(await waitDialogue(page, 'keepsake_burn', 25000), 'real loop: a Strike below the threshold plays keepsake_burn');
    await tapThrough(page);
    // Quill acts first next round (tap nothing: MISS), possibly a charge start dialogue
    const end = Date.now() + 90000;
    let cast = false;
    while (Date.now() < end && !cast) {
      if (await hasDialogue(page)) await page.tap(180, 560);
      else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending) && window.__battle.canUltimate(window.__battle.activeHero || {})`)) {
        await page.shot(join(out, 'quill_recollection_menu.png'));
        await page.tap(...slots.ultimate);
        cast = true;
      } else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) {
        // Dov's turn in between: just Strike
        await page.ev(`window.__battle.heroes.forEach((h) => { if (h.hp > 0) h.hp = h.maxHp; })`);
        await page.tap(...slots.strike);
      }
      await sleep(250);
    }
    log(cast, 'real loop: Recollection offered to Rhea and cast');
    log(await waitFlag(page, `window.__battle.battleOver === true`, 40000), 'real loop: the Recollection kills him: Victory');
    const fin = await B(page, '({ hp: B.enemies[0].hp, rising: B.enemies[0].rising })');
    log(fin.hp === 0 && !fin.rising, 'real loop: final state (0 HP, not rising)', JSON.stringify(fin));
    const orderB = await page.ev(`window.__order.slice(0, 5).join(' > ')`);
    await page.shot(join(out, 'quill_victory.png'));
    log(page.errors.length === 0, 'page B: no console errors', `${orderB} ${page.errors.slice(0, 2).join(' | ')}`);
  }

  // ============ Page C: lose in stage 2 -> Retry starts again in stage 1 ============
  {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4`, { init: [HOOKS] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await waitMenu(page);
    // The real loop to stage 2 (Rhea's Strike kills stage 1), then both heroes fall during Dov's turn.
    await page.ev(`(() => { const B = window.__battle; B.tutorialSlow = false; B.enemies[0].hp = 1; B.updateLabel(B.enemies[0]); })()`);
    await page.tap(...slots.strike);
    await waitDialogue(page, 'quill_rise', 25000);
    await tapThrough(page);
    await waitFlag(page, `window.__battle.enemies[0].phase === 1 && !window.__battle.enemies[0].rising`, 15000);
    await waitMenu(page);
    log(await B(page, 'B.enemies[0].phase === 1 && !!B.enemies[0].aura'), 'retry test: stage 2 reached');
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => B.applyHit(h, 9999)); })()`);
    for (let i = 0; i < 20 && !(await B(page, 'B.battleOver')); i++) {
      if (await B(page, '!!(B.menu && B.menu.pending)')) await page.tap(...slots.strike);
      await sleep(1500);
    }
    await page.waitFor(`window.__battle.battleOver === true`, { timeout: 15000 });
    await sleep(2200);
    await page.tap(...slots.retry);
    await sleep(2500);
    await waitMenu(page, 40000);
    const snap = await B(page, '({ phase: B.enemies[0].phase || 0, hp: B.enemies[0].hp, max: B.enemies[0].maxHp, aura: !!B.enemies[0].aura, rising: !!B.enemies[0].rising, tint: B.enemies[0].body.baseTint, over: B.battleOver, label: B.enemies[0].label.text, heroes: B.heroes.map((h) => h.hp > 0) })');
    const half = Math.round((clerk.hp * clerk.stages[0].hpPct) / 100);
    log(snap.phase === 0 && snap.hp === half && snap.max === half && !snap.aura && !snap.rising && !snap.over && snap.heroes.every(Boolean), 'Retry after a LOSE in stage 2: back in stage 1 at its own bar, no aura, party up again (Quill has already acted once)', JSON.stringify(snap));
    log(page.errors.length === 0, 'page C: no console errors', page.errors.slice(0, 2).join(' | '));
  }
});
console.log(failed ? `\n${failed} check(s) FAILED` : '\nquill lab: all passed');
process.exit(failed ? 1 : 0);
