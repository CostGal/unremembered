// QA part F: battle lab. Drives live battles in the dev build (window.__battle)
// with real mouse input where the input matters (QTE timing, menus) and calls
// the scene's own methods to set up states (HP, Echo, which attack comes next).
//   node scripts/qa/battle.mjs --out dir [--only name,name]
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const ui = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8'));
const qte = JSON.parse(readFileSync(join(root, 'src/data/qte.json'), 'utf8'));
const slots = ui.commands.slots;
const out = process.argv[process.argv.indexOf('--out') + 1];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
mkdirSync(out, { recursive: true });
const rows = [];
const log = (ok, name, detail = '') => {
  rows.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const want = (n) => !only || only.includes(n);

const HOOKS = `(() => {
  window.__taps = []; window.__results = []; window.__frames = [];
  document.addEventListener('pointerdown', (e) => window.__taps.push(e.timeStamp), true);
  window.__stub = (vals) => { const o = Math.random; let i = 0; Math.random = () => { const v = vals[i++]; if (i >= vals.length) Math.random = o; return v === undefined ? o() : v; }; };
  window.__hook = () => {
    const B = window.__battle; if (!B || B.__hooked) return; B.__hooked = true;
    const orig = B.applyParryResult.bind(B);
    B.applyParryResult = (result, enemy, hero, hit, input) => { window.__results.push({ result, input, t: performance.now(), hp: hero.hp, hero: hero.type }); return orig(result, enemy, hero, hit, input); };
    for (const e of B.enemies) e.body.on('animationupdate', (a, f) => window.__frames.push({ key: a.key, frame: f.index - 1, t: performance.now() }));
  };
})()`;

async function battle(chrome, server, id, { settings = null, extra = '' } = {}) {
  const page = await open(chrome, `${server.url}?battle=${id}${extra}`, { settings, init: [HOOKS] });
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
  await page.ev(`window.__hook()`);
  return page;
}
const waitMenu = (page, timeout = 30000) => page.waitFor(`!!(window.__battle.menu && window.__battle.menu.pending)`, { timeout });
// Battle events open a dialogue overlay (b2_first_hollow: battleStart); tap through it until the menu is up.
async function waitMenuThroughDialogue(page, timeout = 40000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) return;
    if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
    await sleep(250);
  }
  throw new Error('waitMenuThroughDialogue: timeout');
}
const B = (page, expr) => page.ev(`(() => { const B = window.__battle; return ${expr}; })()`);

// Runs one enemy hit and taps at `offsets` (ms relative to impact) with real clicks.
// Returns {result, input, dts: [actual tap time - impact], hpLost}.
async function qteHit(page, offsets, { hit = {}, swipe = false, heroIdx = 0 } = {}) {
  await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.setTimeScale(1); const h = B.heroes[${heroIdx}]; h.hp = h.maxHp; window.__results.length = 0; window.__taps.length = 0; window.__done = null;
    const hit = Object.assign({ telegraphMs: 700, dmg: 20, unparryable: false }, ${JSON.stringify(hit)});
    window.__hp0 = h.hp; B.enemyHit(B.enemies[0], h, hit, null, 0).then((r) => { window.__done = r; }); })()`);
  await page.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 5000 });
  const { now, at } = await page.ev(`({ now: performance.now(), at: [...window.__battle.qteRings][0].impactAt })`);
  const dts = [];
  for (const off of offsets) {
    const nowNow = await page.ev(`performance.now()`);
    const wait = at + off - nowNow - 4;
    if (wait > 0) await sleep(wait);
    if (swipe) await page.swipe(180, 610, -80);
    else await page.tap(180, 610);
    const stamps = await page.ev(`window.__taps.slice()`);
    dts.push(Math.round(stamps[stamps.length - 1] - at));
  }
  await page.waitFor(`window.__done !== null`, { timeout: 8000 }).catch(() => {});
  const r = await page.ev(`({ done: window.__done, res: window.__results[0] || null, hp: window.__battle.heroes[${heroIdx}].hp, hp0: window.__hp0 })`);
  return { result: r.res?.result ?? r.done, input: r.res?.input, dts, hpLost: r.hp0 - r.hp };
}

await withBrowser(async ({ chrome, server }) => {
  // ============ F-QTE: judgement matrix (normal) ============
  if (want('qte')) {
    // level=2: Rhea's Echo cap is 3 there (Recall 1 caps it at 1, which would clip the PERFECT's +2).
    const page = await battle(chrome, server, 'boss_clerk', { extra: '&level=2' });
    await waitMenu(page);
    const cases = [
      ['PERFECT on the beat', [0], 'PERFECT', 0],
      ['PERFECT +60 ms late', [60], 'PERFECT', 0],
      ['PERFECT −70 ms early', [-70], 'PERFECT', 0],
      ['GOOD +150 ms late', [150], 'GOOD', 10],
      ['GOOD −150 ms early', [-150], 'GOOD', 10],
      ['MISS +260 ms late', [260], 'MISS', 20],
      ['MISS −250 ms ([T−350,T−200) counts as MISS)', [-250], 'MISS', 20],
      ['MISS −320 ms (same window)', [-320], 'MISS', 20],
      ['no tap at all = MISS', [], 'MISS', 20],
      ['tap 420 ms early is ignored → no tap = MISS', [-420], 'MISS', 20],
      ['ignored early tap (−420) then tap on the beat = PERFECT', [-420, 0], 'PERFECT', 0],
    ];
    for (const [name, offs, wantRes, wantLoss] of cases) {
      const r = await qteHit(page, offs);
      const ok = r.result === wantRes && r.hpLost === wantLoss;
      log(ok, `QTE ${name}`, `got ${r.result}, hp −${r.hpLost} (want ${wantRes}, −${wantLoss}); real tap offsets ${JSON.stringify(r.dts)} ms`);
      await sleep(400);
    }
    // damage numbers: Echo gain per result
    await page.ev(`window.__battle.heroes[0].echo = 0; window.__battle.refreshHud()`);
    await qteHit(page, [0]);
    const e1 = await B(page, 'B.heroes[0].echo');
    log(e1 === qte.results.PERFECT.echo, `PERFECT gives +${qte.results.PERFECT.echo} Echo to the parrying hero`, `echo ${e1}`);
    await sleep(300);
    await page.ev(`window.__battle.heroes[0].echo = 0`);
    await qteHit(page, [150]);
    const e2 = await B(page, 'B.heroes[0].echo');
    log(e2 === qte.results.GOOD.echo, `GOOD gives +${qte.results.GOOD.echo} Echo`, `echo ${e2}`);
    await sleep(300);
    await page.ev(`window.__battle.heroes[0].echo = 0`);
    await qteHit(page, []);
    log((await B(page, 'B.heroes[0].echo')) === 0, 'MISS gives 0 Echo');
    // PERFECT counter: 4 damage to the enemy
    await sleep(500);
    const hp0 = await B(page, 'B.enemies[0].hp');
    await qteHit(page, [0]);
    await sleep(1500);
    const hp1 = await B(page, 'B.enemies[0].hp');
    log(hp0 - hp1 === qte.results.PERFECT.counterDmg || hp0 - hp1 === qte.results.PERFECT.counterDmg * 1, `PERFECT counters for ${qte.results.PERFECT.counterDmg} damage`, `enemy hp ${hp0}→${hp1} (chain/break multipliers can change this)`);
    log(page.errors.length === 0, 'no console errors during the QTE matrix', page.errors.slice(0, 2).join(' | '));
  }

  // ============ F-QTE story mode ============
  if (want('story')) {
    const page = await battle(chrome, server, 'boss_clerk', { settings: { difficulty: 'story', storyMode: true, difficultyChosen: true } });
    await waitMenu(page);
    const cases = [
      ['story PERFECT +120 ms (window 135)', [120], 'PERFECT', 0],
      ['story GOOD +250 ms (window 300)', [250], 'GOOD', 5],
      ['story GOOD −250 ms', [-250], 'GOOD', 5],
      ['story MISS +330 ms', [330], 'MISS', 10],
      ['story MISS −330 ms (still inside the 350 ignore cut-off)', [-330], 'MISS', 10],
      ['story: tap 420 ms early still ignored', [-420], 'MISS', 10],
    ];
    for (const [name, offs, wantRes, wantLoss] of cases) {
      const r = await qteHit(page, offs);
      log(r.result === wantRes && r.hpLost === wantLoss, `QTE ${name}`, `got ${r.result}, hp −${r.hpLost} (want ${wantRes}, −${wantLoss} = half damage); taps ${JSON.stringify(r.dts)}`);
      await sleep(400);
    }
  }

  // ============ F-dodge: red ring + swipe ============
  if (want('dodge')) {
    const page = await battle(chrome, server, 'boss_clerk');
    await waitMenu(page);
    let r = await qteHit(page, [0], { hit: { unparryable: true } });
    log(r.result === 'MISS' && r.hpLost === 20, 'red ring: a tap on the beat is a MISS (cannot parry)', `${r.result} −${r.hpLost}`);
    await sleep(500);
    r = await qteHit(page, [0], { hit: { unparryable: true }, swipe: true });
    log(r.result === 'PERFECT' && r.input === 'swipe' && r.hpLost === 0, 'red ring: a swipe on the beat dodges (0 damage)', `${r.result}/${r.input} −${r.hpLost}`);
    await sleep(500);
    r = await qteHit(page, [150], { hit: { unparryable: true }, swipe: true });
    log(r.result === 'GOOD' && r.input === 'swipe' && r.hpLost === 10, 'red ring: a late swipe = GOOD dodge (half damage)', `${r.result}/${r.input} −${r.hpLost}`);
    await sleep(500);
    // Every ring takes both gestures: a swipe on a white ring is a DODGE (dodge.windows), never a parry:
    // no Echo, no counter, the chain stays.
    await page.ev(`(() => { const B = window.__battle; B.heroes[0].echo = 0; B.refreshHud(); })()`);
    const ehp0 = await B(page, 'B.enemies[0].hp');
    r = await qteHit(page, [0], { swipe: true });
    await sleep(1500);
    const echo = await B(page, 'B.heroes[0].echo');
    const ehp1 = await B(page, 'B.enemies[0].hp');
    log(r.result === 'PERFECT' && r.input === 'swipe' && r.hpLost === 0, 'normal ring: a swipe on the beat is a PERFECT dodge (0 damage)', `${r.result}/${r.input} −${r.hpLost}`);
    log(echo === 0 && ehp0 === ehp1, 'a dodge gives no Echo and no counter', `echo ${echo}, enemy hp ${ehp0}→${ehp1}`);
    await sleep(500);
    r = await qteHit(page, [250], { swipe: true });
    log(r.result === 'GOOD' && r.input === 'swipe' && r.hpLost === 10, 'normal ring: a swipe at +250 ms is a GOOD dodge (half damage, dodge window 300)', `${r.result}/${r.input} −${r.hpLost}; touch ${JSON.stringify(r.dts)} ms`);
    await sleep(500);
    r = await qteHit(page, [250]);
    log(r.result === 'MISS' && r.input === 'tap' && r.hpLost === 20, 'normal ring: a tap at +250 ms is still a MISS (parry window 200)', `${r.result}/${r.input} −${r.hpLost}`);
  }

  // ============ F-boss moves: file_away multi-hit, redact feint, archive ============
  if (want('boss')) {
    const page = await battle(chrome, server, 'boss_clerk');
    await waitMenu(page);
    await page.ev(`window.__battle.hideCommandMenu(); window.__battle.tutorialSlow = false;`);
    const enemyTurnTapping = async (stub, tapOffsets, label) => {
      await page.ev(`(() => { const B = window.__battle; B.heroes.forEach(h => { h.hp = h.maxHp; }); window.__results.length = 0; window.__frames.length = 0; window.__animTrace = {}; window.__done = false; window.__stub(${JSON.stringify(stub)}); B.enemyTurn(B.enemies[0]).then(() => { window.__done = true; }); })()`);
      const rings = [];
      const end = Date.now() + 15000;
      let n = 0;
      while (Date.now() < end) {
        const st = await page.ev(`({ done: window.__done, rings: [...(window.__battle.qteRings || [])].map(r => r.impactAt), now: performance.now() })`);
        for (const at of st.rings) {
          if (rings.includes(Math.round(at))) continue;
          rings.push(Math.round(at));
          const off = tapOffsets[n++];
          if (off !== null && off !== undefined) setTimeout(() => page.tap(180, 610).catch(() => {}), Math.max(0, at + off - st.now - 6));
        }
        if (st.done) break;
        await sleep(30);
      }
      const r = await page.ev(`({ results: window.__results.map(x => x.result), frames: window.__frames.slice(), trace: Object.keys(window.__animTrace) })`);
      return { rings, ...r };
    };
    // File Away: 2 hits, 2 rings, 2 impact frames
    // The phase's opening (stamp, archive) would fix the first picks: skip past it so the stubs choose.
    await page.ev(`window.__battle.enemies[0].turnsInPhase = 99`);
    let t = await enemyTurnTapping([0, 0.9999], [0, 0], 'file_away');
    const impacts = t.frames.filter((f) => f.key === 'clerk_file_away' && [4, 8].includes(f.frame));
    log(t.rings.length === 2 && t.results.length === 2 && t.results.every((x) => x === 'PERFECT'), 'File Away: two separate rings, both parried', `rings ${t.rings.length}, results ${t.results}`);
    const lead = impacts.map((f, i) => Math.round(f.t - t.rings[i]));
    log(impacts.length === 2 && lead.every((d) => Math.abs(d) < 90), 'File Away: impact frames 4 and 8 land on each ring\'s impact time (±90 ms)', `frame-time − ring impact = ${lead} ms`);
    // Redact: feint (ring freezes at 60%, T moves +400)
    await sleep(800);
    await page.ev(`window.__battle.enemies[0].phase = 1`);
    t = await enemyTurnTapping([0, 0.5], [0], 'redact');
    const hold = t.frames.find((f) => f.key === 'clerk_redact' && f.frame === 8);
    const imp = t.frames.find((f) => f.key === 'clerk_redact' && f.frame === 9);
    log(t.rings.length === 1 && hold && imp && imp.t - hold.t >= 380, 'Redact: holds the feint frame (8) for ≥ 400 ms, then the impact frame (9)', `hold→impact ${hold && imp ? Math.round(imp.t - hold.t) : '?'} ms; result ${t.results}`);
    log(imp && Math.abs(imp.t - t.rings[0]) < 90, 'Redact: impact frame lands on the ring impact time', imp ? `${Math.round(imp.t - t.rings[0])} ms` : 'no impact frame');
    // Archive: a 4-turn guarded charge; only a BREAK cancels it; release = red ring + heal
    await sleep(800);
    await page.ev(`window.__battle.enemies[0].phase = 1; window.__stub([0, 0.9999]); window.__battle.enemyTurn(window.__battle.enemies[0]).then(() => { window.__done2 = true; })`);
    await sleep(1500);
    const charging = await B(page, '!!B.enemies[0].charge');
    log(charging, 'Archive: enemy starts charging (turn 1)');
    await page.shot(join(out, 'archive_charging.png'));
    const hpBefore = await B(page, 'B.enemies[0].hp');
    await page.ev(`(() => { const B = window.__battle; B.chain = 0; B.applyHit(B.enemies[0], 10); })()`);
    const guarded = hpBefore - (await B(page, 'B.enemies[0].hp'));
    log(guarded === 6, 'Archive: while charging the Clerk takes 60% of a hit (10 → 6)', `took ${guarded}`);
    log(await B(page, 'B.enemies[0].charge && B.enemies[0].charge.mitigated === 4'), 'Archive: the guard remembers what it absorbed (4)', `${await B(page, 'B.enemies[0].charge && B.enemies[0].charge.mitigated')}`);
    await page.ev(`(() => { const B = window.__battle; B.enemies[0].poise = 1; B.hitPoise(B.enemies[0], 1); })()`);
    await sleep(900);
    log(!(await B(page, '!!B.enemies[0].charge')) && (await B(page, 'B.enemies[0].broken')), 'Archive: a BREAK cancels the charge');
    const idleAfter = await page.ev(`window.__battle.enemies[0].body.anims.currentAnim && window.__battle.enemies[0].body.anims.currentAnim.key`);
    log(idleAfter === 'clerk_idle', 'Archive: cancelled → clerk returns to idle', idleAfter);
    await page.ev(`(() => { const B = window.__battle; B.refillPoise(B.enemies[0]); })()`);
    // charge → 4 turns → release, no dodge: full 35 dmg, then heals half of what the guard absorbed
    await sleep(500);
    t = await enemyTurnTapping([0, 0.9999], [], 'archive1');
    const c1 = await B(page, 'B.enemies[0].charge && B.enemies[0].charge.turnsLeft');
    await page.ev(`(() => { const B = window.__battle; B.enemies[0].hp = 100; B.updateLabel(B.enemies[0]); B.chain = 0; B.applyHit(B.enemies[0], 20); })()`);
    t = await enemyTurnTapping([0], [], 'archive2');
    t = await enemyTurnTapping([0], [], 'archive3');
    t = await enemyTurnTapping([0], [], 'archive4');
    const c4 = await B(page, 'B.enemies[0].charge && B.enemies[0].charge.turnsLeft');
    t = await enemyTurnTapping([0], [], 'archive5');
    const lost = await B(page, 'B.heroes[0].maxHp - B.heroes[0].hp + B.heroes[1].maxHp - B.heroes[1].hp');
    const hpAfter = await B(page, 'B.enemies[0].hp');
    log(c1 === 4 && c4 === 1 && t.results.length === 1 && t.results[0] === 'MISS' && lost === 35, 'Archive: 4 turns of charge, then fires as a red-ring hit; a missed dodge costs 35', `turnsLeft after turn 1: ${c1}, after turn 4: ${c4}; results ${t.results}; hp lost ${lost}; trace ${t.trace.filter((k) => /archive/.test(k)).join(' ')}`);
    log(hpAfter === 100 - 12 + 4, 'Archive: release heals half of what the guard absorbed (20 hit → 12 taken, +4 back)', `clerk hp ${hpAfter}`);
    log(page.errors.length === 0, 'no console errors during boss moves', page.errors.slice(0, 2).join(' | '));
  }

  // ============ F-keepsake + recollection ============
  if (want('keepsake')) {
    const page = await battle(chrome, server, 'boss_clerk');
    await waitMenu(page);
    await page.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; e.hp = Math.ceil(e.maxHp * 0.52); B.updateLabel(e); })()`);
    await page.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; B.applyHit(e, Math.ceil(e.maxHp * 0.06)); })()`);
    const phase = await B(page, 'B.enemies[0].phase');
    log(phase === 1, 'Keepsake: crossing 50% HP enters phase 2', `phase ${phase}`);
    // The expression must not evaluate to the promise: page.ev awaits one, and this one only settles after the taps below.
    await page.ev(`window.__battle.hideCommandMenu(); window.__ke = window.__battle.afterTurn().then(() => { window.__keDone = true; }); null`);
    await sleep(800);
    const act = await page.scenes();
    const did = await page.ev(`(window.__game.scene.getScene('Dialogue') || {}).dialogueId`);
    log(act.includes('Dialogue') && did === 'keepsake_burn', 'Keepsake: the battle pauses and plays dialogue "keepsake_burn"', `${act.join('+')} / ${did}`);
    log(await page.ev(`window.__game.scene.isPaused('Battle')`), 'Keepsake: the battle scene is paused under the dialogue');
    await page.shot(join(out, 'keepsake_dialogue.png'));
    // tap through every line
    let guard = 0;
    while ((await page.scenes()).includes('Dialogue') && guard++ < 40) {
      await page.tap(180, 560);
      await sleep(260);
    }
    await sleep(800);
    log(await B(page, 'B.heroes[0].echo === B.heroes[0].echoMax'), "Keepsake: afterwards Rhea's Echo is full", `echo ${await B(page, 'B.heroes[0].echo')}`);
    log(!(await page.ev(`window.__game.scene.isPaused('Battle')`)), 'Keepsake: the battle resumes');
    log(await B(page, 'B.canUltimate(B.heroes[0])'), 'Keepsake: Recollection becomes available to Rhea');
    await page.shot(join(out, 'keepsake_after.png'));
    log(page.errors.length === 0, 'no console errors during Keepsake', page.errors.slice(0, 2).join(' | '));
  }

  // ============ F-Nala ============
  if (want('nala')) {
    // b3_gate: the Warden (enemy 0) and a plain Hollow (enemy 1) are both Hollows.
    const page = await battle(chrome, server, 'b3_gate');
    await waitMenu(page);
    await page.ev(`window.__battle.hideCommandMenu(); window.__battle.tutorialSlow = false;`);
    // Hollow telegraph: Nala watching, tap her -> cancel
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach(h => { h.hp = h.maxHp; }); window.__results.length = 0; window.__done = null; window.__stub([0, 0.0]); B.enemyTurn(B.enemies[0]).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__battle.nala && window.__battle.nala.ring`, { timeout: 5000 });
    const nx = await page.ev(`({ x: window.__battle.nala.container.x, y: window.__battle.nala.container.y })`);
    await sleep(500);
    const watchInfo = await page.ev(`(() => { const n = window.__battle.nala; return { texture: n.image.texture.key, placeholder: !!n.anims?.idle?.placeholder, anim: n.image.anims.currentAnim?.key, flip: n.container.scaleX < 0, bob: window.__battle.tweens.getTweensOf(n.container).length, trace: Object.keys(window.__animTrace || {}).filter((k) => k.includes('nala')) }; })()`);
    log(!watchInfo.placeholder && watchInfo.anim === 'nala_alert' && watchInfo.trace.includes('play:nala_alert_in') && watchInfo.bob === 0, 'Nala: drawn from the sheet; watching plays alert_in -> alert loop, code bob off', JSON.stringify(watchInfo));
    log(watchInfo.flip, 'Nala: sheet faces left, container flipped so she looks at the enemies');
    await page.shot(join(out, 'nala_glow.png'));
    await page.tap(nx.x, nx.y);
    await page.waitFor(`window.__done === true`, { timeout: 6000 });
    const res = await page.ev(`({ results: window.__results.length, used: window.__battle.nala.used, hp: window.__battle.heroes.map(h => h.hp), max: window.__battle.heroes.map(h => h.maxHp) })`);
    log(res.used && res.results === 0 && res.hp.every((h, i) => h === res.max[i]), 'Nala: tapping her during a Hollow telegraph cancels the attack (no damage, no judgement)', JSON.stringify(res));
    await sleep(1000);
    const hissInfo = await page.ev(`({ anim: window.__battle.nala.image.anims.currentAnim?.key, trace: Object.keys(window.__animTrace || {}).filter((k) => k.includes('nala')) })`);
    log(['play:nala_hiss', 'hold:nala_hiss', 'impact:nala_hiss'].every((k) => hissInfo.trace.includes(k)) && hissInfo.anim === 'nala_idle', 'Nala: hiss plays once with its hold + impact frames, then back to idle', JSON.stringify(hissInfo));
    // second Hollow attack: Nala is spent -> no glow
    await sleep(500);
    await page.ev(`(() => { window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[1]).then(() => { window.__done = true; }); })()`);
    await sleep(500);
    log(!(await B(page, '!!B.nala.ring')), 'Nala: once per battle (no glow on the next Hollow)');
    await page.waitFor(`window.__done === true`, { timeout: 8000 });
    // Blank: never reacts
    // b2_first_hollow: enemy 0 is a Blank, enemy 1 a Hollow.
    const pb = await battle(chrome, server, 'b2_first_hollow');
    await waitMenuThroughDialogue(pb);
    await pb.ev(`window.__battle.hideCommandMenu(); window.__battle.tutorialSlow = false; window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[0]).then(() => { window.__done = true; })`);
    await sleep(600);
    const blankWatch = await pb.ev(`({ type: window.__battle.enemies[0].type, ring: !!window.__battle.nala.ring })`);
    log(blankWatch.type === 'blank' && !blankWatch.ring, 'Nala: never reacts to a Blank', JSON.stringify(blankWatch));
    await pb.waitFor(`window.__done === true`, { timeout: 8000 });
    const hollowWatch = await pb.ev(`(() => { window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[1]).then(() => { window.__done = true; }); return window.__battle.enemies[1].type; })()`);
    await sleep(600);
    log(hollowWatch === 'hollow' && (await B(pb, '!!B.nala.ring')), 'Nala: glows for the Hollow in the same battle', hollowWatch);
    await pb.waitFor(`window.__done === true`, { timeout: 8000 });
    await sleep(900);
    const outInfo = await pb.ev(`({ anim: window.__battle.nala.image.anims.currentAnim?.key, trace: Object.keys(window.__animTrace || {}).filter((k) => k.includes('nala')) })`);
    log(outInfo.trace.includes('play:nala_alert_out') && outInfo.anim === 'nala_idle', 'Nala: an unanswered telegraph ends with alert_out -> idle', JSON.stringify(outInfo));
    // Jump-in arc (dev hook for the duel ending)
    const j0 = await pb.ev(`({ x: window.__battle.nala.container.x, y: window.__battle.nala.container.y })`);
    await pb.ev(`window.__jump = null; window.__apex = 1e9; window.__battle.nalaJumpIn().then(() => { window.__jump = true; }); (function f() { window.__apex = Math.min(window.__apex, window.__battle.nala.container.y); if (!window.__jump) requestAnimationFrame(f); })();`);
    await sleep(260);
    await pb.shot(join(out, 'nala_jump_mid.png'));
    await pb.waitFor(`window.__jump === true`, { timeout: 3000 });
    await sleep(700);
    const j1 = await pb.ev(`({ x: window.__battle.nala.container.x, y: window.__battle.nala.container.y, sx: window.__battle.nala.container.scaleX, sy: window.__battle.nala.container.scaleY, apex: window.__apex, anim: window.__battle.nala.image.anims.currentAnim?.key, trace: Object.keys(window.__animTrace || {}).includes('nala:jumpIn') })`);
    log(Math.abs(j1.x - j0.x) < 0.5 && Math.abs(j1.y - j0.y) < 0.5 && j0.y - j1.apex > 60 && j1.sx < 0 && j1.sy === 1 && j1.anim === 'nala_idle' && j1.trace, 'Nala: jumpIn() arcs ~70px over the ground, lands where she stood (flip kept), back to idle', JSON.stringify({ j0, j1 }));
  }

  // ============ F-duel: refuse -> wake -> slow first ring -> parry -> events -> Blast -> Nala -> interrupted end ============
  if (want('duel')) {
    const page = await battle(chrome, server, 'b0_duel');
    await waitMenu(page);
    // The telegraph of every real Dov attack, as handed to the ring (enemyHit wrapper).
    await page.ev(`(() => { const B = window.__battle; window.__tele = []; const o = B.enemyHit.bind(B); B.enemyHit = (en, t, hit, sh, k) => { window.__tele.push(hit.telegraphMs); return o(en, t, hit, sh, k); }; })()`);
    const tapDialogue = async (label) => {
      let n = 0;
      for (let i = 0; i < 80 && (await page.scenes()).includes('Dialogue'); i++) {
        await page.tap(180, 560);
        n++;
        await sleep(450);
      }
      return n;
    };
    const start = await B(page, `({ echo: B.heroes[0].echo, max: B.heroes[0].echoMax, level: B.level, party: B.heroes.map((h) => h.type) })`);
    log(start.party.length === 1 && start.max === 2 && start.level === 1 && start.echo === 1, 'Duel: Rhea alone, Echo cap 2 at Recall 1, one turn Echo on her first turn', JSON.stringify(start));

    // Technique menu is visible and clickable, its Blast slot blank.
    await page.tap(...slots.technique);
    await sleep(300);
    const tm = await B(page, `B.menu.items.map((i) => ({ slot: i.slot, label: i.label, locked: !!i.locked, enabled: i.enabled !== false, cost: i.cost ?? null }))`);
    const blastSlot = tm.find((i) => i.slot === 'technique' || i.locked);
    log(!!blastSlot?.locked && !blastSlot.enabled && blastSlot.cost === null && blastSlot.label === ui.commands.lockedSlot.text, 'Duel: Technique menu opens; the Blast slot is blank and not selectable', JSON.stringify(tm));
    await page.shot(join(out, 'duel_blast_locked.png'));
    await page.tap(...slots.back);
    await sleep(300);

    // Strike until Dov wakes (duel_refuse after the first hit; he refuses until duel_wake). His first real
    // attack follows in the same round: slow ring (telegraph x2.5) on top of the tutorial slow-mo, then a real tap on impact.
    let ring = null;
    let refusedFirst = null;
    for (let i = 0; i < 10 && !ring; i++) {
      await waitMenuThroughDialogue(page, 60000);
      await page.tap(...slots.strike);
      await sleep(600); // the tapped button's menu is still "pending" for a moment
      for (let t = 0; t < 400 && !ring; t++) {
        if (await page.ev(`!!(window.__battle.qteRings && window.__battle.qteRings.size > 0)`)) ring = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now(), scale: window.__battle.timeScale, tele: window.__tele.slice() })`);
        else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) break;
        else if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
        await sleep(150);
      }
      if (i === 0) refusedFirst = !(await B(page, 'B.hasFlag("duelWake")'));
    }
    log(refusedFirst === true && !!ring, 'Duel: Dov refuses at first; duel_wake sets duelWake and his first attack comes');
    const baseMs = await B(page, `B.enemies[0].def.attacks.map((a) => a.telegraphMs)`);
    const first = ring.tele[0];
    log(ring.tele.length === 1 && baseMs.includes(first / 2.5) && ring.scale === 1, 'Duel: the first real attack telegraph is x2.5 at normal speed (it replaces the slow-mo for that ring)', `telegraphMs ${first} (bases ${baseMs}), timeScale ${ring.scale}, ring ${Math.round(ring.at - ring.now)} ms left`);
    await sleep(Math.max(0, ring.at - ring.now - 6));
    await page.tap(180, 610);
    await page.waitFor(`window.__results.length > 0`, { timeout: 5000 });
    const res = await page.ev(`window.__results[0]`);
    log(res.result !== 'MISS' && res.input === 'tap', 'Duel: a tap parry on impact is not a MISS', JSON.stringify(res));

    // duel_parry + duel_blast_unlock (+ banner) fire between turns.
    await page.waitFor(`window.__battle.firedEvents.has('duel_parry')`, { timeout: 20000 });
    const seen = new Set();
    for (let i = 0; i < 80 && !(await B(page, 'B.hasFlag("blastUnlocked")')); i++) {
      if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
      await sleep(400);
    }
    await sleep(300);
    const banner = await B(page, `B.hints.isShowing('blast_unlocked')`);
    log(await B(page, `B.firedEvents.has('duel_blast_unlock') && B.hasFlag('blastUnlocked')`), 'Duel: duel_parry then duel_blast_unlock fire after the first parry and set blastUnlocked');
    await tapDialogue();
    await sleep(300);
    log((await B(page, `B.hints.isShowing('blast_unlocked')`)) || banner, 'Duel: the "Blast unlocked" banner shows after the dialogue');
    await page.shot(join(out, 'duel_blast_unlocked.png'));

    // Rhea's next turn: Blast is selectable with Echo 2.
    await waitMenuThroughDialogue(page, 60000);
    await page.ev(`(() => { const h = window.__battle.heroes[0]; h.echo = h.echoMax; window.__battle.refreshHud(); })()`);
    await page.tap(...slots.technique);
    await sleep(300);
    const tm2 = await B(page, `B.menu.items.map((i) => ({ slot: i.slot, label: i.label, locked: !!i.locked, enabled: i.enabled !== false, cost: i.cost ?? null }))`);
    const blast = tm2.find((i) => i.label === 'Blast');
    log(!!blast && blast.enabled && blast.cost === 2, 'Duel: after the unlock Blast is selectable (L1 cost 2)', JSON.stringify(tm2));
    const hp0 = await B(page, 'B.enemies[0].hp');
    const hitsBefore = await B(page, 'B.counters.playerHits');
    await page.tap(...slots.strike); // the technique list puts its first technique (Blast) on the first slot
    await page.waitFor(`window.__battle.counters.playerHits > ${hitsBefore}`, { timeout: 15000 }).catch(() => {});
    const echoAfter = await B(page, 'B.heroes[0].echo');
    log((await B(page, 'B.enemies[0].hp')) < hp0 && echoAfter === 0, 'Duel: Blast deals damage, spends 2 Echo and gives none back (techniques never give Echo)', `enemy hp ${hp0} -> ${await B(page, 'B.enemies[0].hp')}, echo ${echoAfter}`);

    // Push Dov under 50 %: duel_nala = Nala jumps in (created on the spot), the dialogue, then the interrupted end.
    await page.ev(`window.__battle.enemies[0].hp = Math.floor(window.__battle.enemies[0].maxHp * 0.49)`);
    await page.waitFor(`window.__battle.firedEvents.has('duel_nala') || !!window.__battle.nala`, { timeout: 60000 });
    const nalaSeen = await page.ev(`(() => { const B = window.__battle; const n = B.nala; return n ? { x: Math.round(n.container.x), vis: n.container.visible, hero: Math.round(B.heroes[0].container.x), foe: Math.round(B.enemies[0].container.x) } : null; })()`);
    log(!!nalaSeen, 'Duel: Nala is created on demand for the jump-in', JSON.stringify(nalaSeen));
    await page.waitFor(`window.__battle.nala && !window.__battle.nala.busy`, { timeout: 5000 });
    await sleep(500);
    const landed = await B(page, `({ x: Math.round(B.nala.container.x), hero: Math.round(B.heroes[0].container.x), foe: Math.round(B.enemies[0].container.x), dialogue: !!B.scene.get('Dialogue') })`);
    log(landed.x > landed.hero && landed.x < landed.foe, 'Duel: Nala lands between Rhea and Dov', JSON.stringify(landed));
    await page.waitFor(`window.__game.scene.getScenes(true).some((s) => s.scene.key === 'Dialogue')`, { timeout: 8000 });
    const dl = await page.ev(`(() => { const d = window.__game.scene.getScene('Dialogue'); return { line: d.lines && d.lines[0] && { speaker: d.lines[0].speaker, portrait: d.lines[0].portrait, style: d.lines[0].style } }; })()`);
    log(dl.line?.speaker === 'Nala' && dl.line?.portrait === 'nala_hiss' && dl.line?.style === 'narration', 'Duel: duel_nala opens with the Nala narration line (nala_hiss portrait)', JSON.stringify(dl));
    await page.shot(join(out, 'duel_nala_jump.png'));
    await tapDialogue();
    await page.waitFor(`window.__battle.battleOver === true`, { timeout: 8000 });
    await sleep(1500);
    await page.shot(join(out, 'duel_recall_card.png'));
    const end = await B(page, `({ over: B.battleOver, xp: B.registry.get('recallXp'), level: B.level, texts: B.children.list.filter((o) => o.type === 'Text' && o.visible).map((o) => o.text) })`);
    const levelUp = end.texts.some((t) => /RECALL \d/.test(t));
    log(end.over && end.xp === 40 && !levelUp && end.texts.some((t) => /\+40/.test(t)) && end.texts.some((t) => /Recall 1/.test(t)), 'Duel: interrupted end gives +40 Memories (40/60), Recall 1, no level-up', JSON.stringify({ xp: end.xp, level: end.level, levelUp }));
  }

  // ============ F-down: Anchor revive, both down → lose → Retry snapshot ============
  if (want('down')) {
    const page = await battle(chrome, server, 'boss_clerk');
    await waitMenu(page);
    // Rhea downed through real damage, then Dov casts Anchor (via the menu with real taps)
    // Echo is per hero: Dov needs his own for Anchor.
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => (h.echo = h.echoMax)); B.applyHit(B.heroes[0], 999); })()`);
    await sleep(1200);
    const downed = await page.ev(`({ hp: window.__battle.heroes[0].hp, anim: window.__battle.heroes[0].body.anims.currentAnim && window.__battle.heroes[0].body.anims.currentAnim.key, frame: window.__battle.heroes[0].body.anims.currentFrame && window.__battle.heroes[0].body.anims.currentFrame.index - 1, playing: window.__battle.heroes[0].body.anims.isPlaying })`);
    log(downed.hp === 0 && downed.anim === 'rhea_death' && downed.frame === 9, 'Death: rhea_death plays and holds its last frame (holdLastFrame)', JSON.stringify(downed));
    await page.shot(join(out, 'rhea_down.png'));
    const turn = await B(page, 'B.activeHero && B.activeHero.type');
    log(turn === 'dov', 'Downed hero skips her turn (Dov acts)', String(turn));
    await waitMenu(page);
    await page.tap(...slots.technique);
    await sleep(500);
    const items = await page.ev(`window.__battle.menu.items.map(i => i.value + ':' + i.slot + ':' + (i.enabled !== false))`);
    const anchor = await page.ev(`(() => { const it = window.__battle.menu.items.find(i => i.value === 'anchor'); return it ? it.slot : null; })()`);
    log(!!anchor, 'Dov technique menu offers Anchor', items.join(' '));
    await page.tap(...slots[anchor]);
    await page.waitFor(`window.__battle.heroes[0].hp > 0`, { timeout: 8000 });
    const rv = await page.ev(`({ hp: window.__battle.heroes[0].hp, echo: window.__battle.heroes[0].echo, anim: window.__battle.heroes[0].body.anims.currentAnim.key })`);
    log(rv.hp === 25 && rv.anim === 'rhea_idle', 'Anchor revives the downed hero with 25 HP and she returns to idle', JSON.stringify(rv));
    await page.shot(join(out, 'anchor_revive.png'));
    // both down → lose → Retry
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.heroes.forEach(h => B.applyHit(h, 9999)); })()`);
    await page.ev(`window.__game.scene.getScene('Battle').heroes[0].echo = 7`);
    await page.waitFor(`window.__battle.battleOver === true`, { timeout: 15000 });
    await sleep(2200);
    const msg = await page.ev(`window.__battle.children.list.filter(o => o.type === 'Text').map(o => o.text).filter(t => /memory fades|Retry/i.test(t))`);
    await page.shot(join(out, 'memory_fades.png'));
    log(msg.some((t) => /memory fades/i.test(t)) && msg.some((t) => /retry/i.test(t)), 'Both heroes down → "The memory fades…" + Retry button', msg.join(' | '));
    await page.tap(...slots.retry);
    await sleep(2500);
    await waitMenu(page, 20000);
    const snap = await page.ev(`({ hp: window.__battle.heroes.map(h => h.hp), max: window.__battle.heroes.map(h => h.maxHp), echo: window.__battle.heroes.map(h => h.echo), ehp: window.__battle.enemies.map(e => e.hp), emax: window.__battle.enemies.map(e => e.maxHp), over: window.__battle.battleOver, active: window.__battle.activeHero && window.__battle.activeHero.type })`);
    log(snap.hp.every((h, i) => h === snap.max[i]) && snap.ehp.every((h, i) => h === snap.emax[i]) && snap.echo.every((e) => e === 0) && !snap.over, 'Retry restores the battle-start snapshot (full HP, Echo as at start, enemy full)', JSON.stringify(snap));
    log(page.errors.length === 0, 'no console errors in down/retry', page.errors.slice(0, 2).join(' | '));
  }

  // ============ F-commands: every command through the real menu ============
  if (want('commands')) {
    const page = await battle(chrome, server, 'b1_forgotten');
    await waitMenu(page);
    await page.ev(`window.__battle.tutorialSlow = false`);
    // targeting with two enemies: tap an enemy sprite; Back cancels
    await page.tap(...slots.strike);
    await sleep(400);
    const prompt = await page.ev(`window.__battle.menu.items.map(i => i.slot + ':' + i.value)`);
    log(prompt.length === 1 && /back/.test(prompt[0]), '2 enemies: Strike asks for a target (Back only)', prompt.join(' '));
    await page.shot(join(out, 'targeting_2_enemies.png'));
    await page.tap(...slots.back);
    await sleep(400);
    log(await B(page, 'B.menu.pending && B.menu.items.length >= 2'), 'Back cancels targeting and returns to the command menu');
    await page.tap(...slots.strike);
    await sleep(400);
    const e1 = await page.ev(`({ x: window.__battle.enemies[1].container.x, y: window.__battle.enemies[1].container.y, hp: window.__battle.enemies[1].hp, hp0: window.__battle.enemies[0].hp })`);
    await page.tap(e1.x, e1.y - 20);
    await sleep(2200);
    const d1 = await page.ev(`({ hp1: window.__battle.enemies[1].hp, hp0: window.__battle.enemies[0].hp, echo: window.__battle.heroes[0].echo })`);
    log(d1.hp1 < e1.hp && d1.hp0 === e1.hp0, 'Tapping the 2nd enemy hits that one only (Rhea Strike)', `enemy1 ${e1.hp}→${d1.hp1}, enemy0 ${e1.hp0}→${d1.hp0}; echo ${d1.echo}`);
    // Rhea's cap is 2 at Recall 1: her turn Echo (+1) and the landed Strike (+1) fill it.
    log(d1.echo === 2, 'Strike that lands gives +1 Echo to the striker (on top of the turn Echo; cap 2)', `echo ${d1.echo}`);
    // Dov's turn: Strike
    await waitMenu(page);
    const heroNow = await B(page, 'B.activeHero.type');
    await page.tap(...slots.strike);
    await sleep(400);
    await page.tap(e1.x, e1.y - 20);
    await sleep(2200);
    log(heroNow === 'dov', 'Dov Strike works', heroNow);
    log(page.errors.length === 0, 'no console errors in commands', page.errors.slice(0, 2).join(' | '));
  }
});

const bad = rows.filter((r) => !r.ok);
console.log(`\nbattle lab: ${rows.length - bad.length}/${rows.length} ok`);
process.exit(bad.length ? 1 : 0);
