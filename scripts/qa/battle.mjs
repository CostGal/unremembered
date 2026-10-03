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
const clerkDef = JSON.parse(readFileSync(join(root, 'src/data/enemies.json'), 'utf8')).clerk;
// The Clerk's stage-2 Archive (the boss moves below run in stage 2: enemy.phase = 1).
const archiveDef = clerkDef.stages[1].attacks.find((a) => a.id === 'archive');
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

// Tutorial pauses are off (?pauses=0) unless `extra` sets ?pauses: the lab drives rings and menus directly.
// The pause flows pass extra: '&pauses=on' (normal behaviour: each pause once per run).
async function battle(chrome, server, id, { settings = null, extra = '' } = {}) {
  if (!/pauses=/.test(extra)) extra += '&pauses=0';
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
const pauseTexts2 = (page) => page.ev(`window.__battle.children.list.filter((o) => o.type === 'Text' && o.depth > 6000 && o.visible).map((o) => o.text)`);
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
  // ============ F-impact: the impact system (impact.json presets, systems/Impact.js) ============
  if (want('impact')) {
    const impactData = JSON.parse(readFileSync(join(root, 'src/data/impact.json'), 'utf8'));
    const page = await battle(chrome, server, 'b1_forgotten', { extra: '&level=2' });
    await waitMenu(page);
    // A recorder: one sample per frame of the camera zoom/scroll, the clocks, and which impact objects are showing.
    const REC = `(() => { window.__rec = []; window.__recOn = true; const B = window.__battle; (function f() { const c = B.cameras.main; const vis = B.children.list.filter((o) => (o.type === 'Text' && o.depth === 1005) && o.visible).map((o) => o.text);
      window.__rec.push({ t: performance.now(), z: c.zoom, sx: c.scrollX, sy: c.scrollY, ts: B.timeScale, tw: B.tweens.timeScale, an: B.anims.globalTimeScale, ct: B.time.timeScale, words: vis, flashes: B.children.list.filter((o) => o.type === 'Rectangle' && o.depth === 960 && o.visible).length, gfx: B.children.list.filter((o) => o.type === 'Graphics' && o.depth === 961 && o.visible).length });
      if (window.__recOn) requestAnimationFrame(f); })();
      // Exact samples at every zoom / clock change too: a loaded machine draws too few frames to catch a 60 ms peak.
      const snap = () => { const c = B.cameras.main; const last = window.__rec[window.__rec.length - 1] || {}; window.__rec.push({ ...last, t: performance.now(), z: c.zoom, sx: c.scrollX, sy: c.scrollY, ts: B.timeScale, tw: B.tweens.timeScale, an: B.anims.globalTimeScale, ct: B.time.timeScale }); };
      const cam = B.cameras.main; const sz = cam.setZoom.bind(cam); cam.setZoom = (z) => { const r = sz(z); snap(); return r; };
      const st = B.setTimeScale.bind(B); B.setTimeScale = (v) => { st(v); snap(); }; })()`;
    const NOW = `(() => { const B = window.__battle; const c = B.cameras.main; return { z: c.zoom, sx: c.scrollX, sy: c.scrollY, ts: B.timeScale, tw: B.tweens.timeScale, an: B.anims.globalTimeScale, ct: B.time.timeScale, words: B.children.list.filter((o) => o.type === 'Text' && o.depth === 1005 && o.visible).map((o) => o.text), flashes: B.children.list.filter((o) => o.type === 'Rectangle' && o.depth === 960 && o.visible).length, gfx: B.children.list.filter((o) => o.type === 'Graphics' && o.depth === 961 && o.visible).length }; })()`;

    // 1. Each preset by hand: zoom stays <= 1.06, the word slams in, everything returns. A loaded machine can
    // stall a whole 60 ms peak between two frames, so a preset is fired up to 3 times until a peak is caught.
    await page.ev(REC);
    await sleep(100);
    const rest = await B(page, '({ sx: B.cameras.main.scrollX, sy: B.cameras.main.scrollY })');
    const fire = async (name) => {
      const agg = { maxZ: 1, minTs: 1, words: new Set(), flashes: 0, gfx: 0, slowMs: 0, tries: 0 };
      for (let i = 0; i < 3 && agg.maxZ < 1 + (impactData.presets[name].zoom.to - 1) * 0.8; i++) {
        agg.tries += 1;
        await page.ev(`window.__rec.length = 0; window.__battle.impact('${name}'); 0`);
        await sleep(300);
        await page.waitFor(`!window.__battle.children.list.some((o) => o.type === 'Text' && o.depth === 1005 && o.visible) && window.__battle.cameras.main.zoom === 1 && window.__battle.timeScale === 1`, { timeout: 12000 }).catch(() => {});
        const rec = await page.ev(`window.__rec.slice()`);
        agg.maxZ = Math.max(agg.maxZ, ...rec.map((r) => r.z));
        agg.minTs = Math.min(agg.minTs, ...rec.map((r) => r.ts));
        for (const r of rec) for (const w of r.words || []) agg.words.add(w);
        agg.flashes = Math.max(agg.flashes, ...rec.map((r) => r.flashes || 0));
        agg.gfx = Math.max(agg.gfx, ...rec.map((r) => r.gfx || 0));
        // From the first slow sample to the first one back at normal speed.
        const i0 = rec.findIndex((r) => r.ts < 1);
        const i1 = i0 < 0 ? -1 : rec.findIndex((r, j) => j > i0 && r.ts === 1);
        if (i0 >= 0 && i1 > i0) agg.slowMs = Math.max(agg.slowMs, rec[i1].t - rec[i0].t);
      }
      agg.now = await page.ev(NOW);
      return agg;
    };
    const px = impactData.presets.perfect;
    const a1 = await fire('perfect');
    log(a1.maxZ > 1.02 && a1.maxZ <= 1.06 && Math.abs(a1.maxZ - px.zoom.to) < 0.012, `impact perfect: camera punch peaks at ${a1.maxZ.toFixed(3)} (preset ${px.zoom.to}, never above 1.06)`);
    log(a1.now.z === 1 && a1.now.sx === rest.sx && a1.now.sy === rest.sy, 'impact perfect: the zoom and the camera scroll return exactly to rest', JSON.stringify({ now: a1.now, rest }));
    log(a1.words.has('PERFECT') && a1.flashes >= 1 && a1.gfx >= 1, 'impact perfect: the PERFECT word, a flash and the speed lines show', JSON.stringify([...a1.words]));
    log(a1.now.words.length === 0 && a1.now.flashes === 0 && a1.now.gfx === 0, 'impact perfect: word, flashes and lines are gone again');
    // The slammed word is really drawn (a restyled Text with an empty canvas passes every visibility check).
    const painted = await page.ev(`(() => { const t = window.__battle.children.list.find((o) => o.type === 'Text' && o.depth === 1005); const c = t.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return { n, w: c.width, text: t.text }; })()`);
    log(painted.n > 500 && painted.w > 60 && painted.text === 'PERFECT', 'impact perfect: the PERFECT word canvas is painted (letters + stroke)', JSON.stringify(painted));
    log(a1.minTs < 1 && a1.minTs >= px.slowMo.scale - 0.001 && a1.now.ts === 1 && a1.now.tw === 1 && a1.now.an === 1 && a1.now.ct === 1, `impact perfect: slow-mo dips to x${a1.minTs.toFixed(2)} and the clocks (scene, tweens, anims, time) are back at 1`, JSON.stringify(a1.now));
    log(a1.slowMs >= px.slowMo.ms * 0.6 && a1.slowMs <= px.slowMo.ms * 2.2, `impact perfect: the slow-mo lasts about ${px.slowMo.ms} real ms (measured ${Math.round(a1.slowMs)})`);
    // The same for crit and critEnemy and break (no slow-mo in the last two).
    for (const name of ['crit', 'critEnemy', 'break']) {
      const a = await fire(name);
      const wz = impactData.presets[name].zoom.to;
      const slowOk = impactData.presets[name].slowMo ? a.minTs < 1 : a.minTs === 1;
      log(a.maxZ > 1.015 && a.maxZ <= 1.06 && Math.abs(a.maxZ - wz) < 0.012 && a.now.z === 1 && a.now.ts === 1 && a.now.sx === rest.sx && slowOk, `impact ${name}: zoom peak ${a.maxZ.toFixed(3)} (preset ${wz}), slow-mo ${impactData.presets[name].slowMo ? 'x' + a.minTs.toFixed(2) : 'none'}, back at rest, clocks at 1`);
    }
    // Screenshots mid-impact (taken after the measurements: a screenshot stalls the page's frames).
    for (const name of ['perfect', 'crit']) {
      await page.ev(`window.__battle.impact('${name}'); 0`);
      await sleep(95);
      await page.shot(join(out, `impact_${name}_mid.png`));
      await sleep(900);
    }

    // 2. Never over a live ring: an impact fired mid-telegraph leaves the clock alone.
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.setTimeScale(1); const h = B.heroes[0]; h.hp = h.maxHp; window.__done = null;
      B.enemyHit(B.enemies[0], h, { telegraphMs: 1500, dmg: 10, unparryable: false }, null, 0).then((r) => { window.__done = r; }); })()`);
    await page.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 5000 });
    await page.ev(`window.__rec.length = 0; window.__battle.impact('perfect')`);
    await sleep(500);
    const live = await page.ev(`window.__rec.slice()`);
    log(live.length > 0 && live.every((r) => r.ts === 1 && r.tw === 1), 'impact over a live ring: no slow-mo (clocks stay at 1)');
    await page.tap(180, 610);
    await page.waitFor(`window.__done !== null`, { timeout: 8000 }).catch(() => {});
    await sleep(1500);

    // 3. The real PERFECT path: a parry on the beat runs the impact; the next ring is not touched.
    await page.ev(`window.__rec.length = 0`);
    const r1 = await qteHit(page, [0]);
    // right away, a second hit (the multi-hit case): its ring must run at normal speed and its judgement stays true.
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); window.__ringTs = null; window.__done = null; const h = B.heroes[0]; h.hp = h.maxHp;
      window.__rec.length = 0;
      B.enemyHit(B.enemies[0], h, { telegraphMs: 700, dmg: 20, unparryable: false }, null, 1).then((r) => { window.__done = r; }); })()`);
    await page.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 5000 });
    const ringState = await page.ev(`({ ts: window.__battle.timeScale, tw: window.__battle.tweens.timeScale, left: [...window.__battle.qteRings][0].impactAt - performance.now() })`);
    const at2 = await page.ev(`[...window.__battle.qteRings][0].impactAt`);
    const wait2 = at2 - (await page.ev(`performance.now()`)) - 4;
    if (wait2 > 0) await sleep(wait2);
    await page.tap(180, 610);
    await page.waitFor(`window.__done !== null`, { timeout: 8000 }).catch(() => {});
    const r2res = await page.ev(`window.__results[window.__results.length - 1]`);
    await sleep(1000);
    const rec3 = await page.ev(`window.__rec.slice()`);
    const l3 = await page.ev(NOW);
    log(r1.result === 'PERFECT' && ringState.ts === 1 && ringState.tw === 1 && ringState.left > 400, 'PERFECT path: the first parry is PERFECT and the next ring starts at normal speed right after', JSON.stringify({ first: r1.result, ringState }));
    log(r2res?.result === 'PERFECT', 'PERFECT path: the follow-up ring is judged normally (tap on the beat = PERFECT)', JSON.stringify(r2res));
    log(l3.z === 1 && l3.ts === 1 && l3.tw === 1 && l3.an === 1 && l3.sx === rest.sx, 'PERFECT path: zoom 1, timeScale 1 and the camera at rest after the impact', JSON.stringify(l3));
    log(rec3.some((r) => r.z > 1.02), 'PERFECT path: the camera really punched in during the parry');

    // 4. Intensity: Story is a notch softer (0.8 of the zoom delta).
    await page.ev(`window.__battle.registry.set('settings', { ...window.__battle.registry.get('settings'), difficulty: 'story', storyMode: true }); 0`);
    const zs = (await fire('perfect')).maxZ;
    const want4 = 1 + (px.zoom.to - 1) * impactData.intensity.story;
    log(Math.abs(zs - want4) < 0.008, `Story intensity: zoom peaks at ${zs.toFixed(3)} (want ~${want4.toFixed(3)})`);
    await page.ev(`window.__recOn = false`);
    log(page.errors.length === 0, 'no console errors in the impact lab', page.errors.slice(0, 2).join(' | '));
  }

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
    // level=4: both heroes have more HP than the 62-damage Archive (Rhea at Recall 1 has 60).
    const page = await battle(chrome, server, 'boss_clerk', { extra: '&level=4' });
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
    // charge → chargeTurns (data) → release, no dodge: full damage, then heals half of what the guard absorbed
    await sleep(500);
    t = await enemyTurnTapping([0, 0.9999], [], 'archive1');
    const c1 = await B(page, 'B.enemies[0].charge && B.enemies[0].charge.turnsLeft');
    await page.ev(`(() => { const B = window.__battle; B.enemies[0].hp = 100; B.updateLabel(B.enemies[0]); B.chain = 0; B.applyHit(B.enemies[0], 20); })()`);
    // The charging turns in between (the last one leaves turnsLeft at 1), then the release turn.
    for (let i = 2; i < archiveDef.chargeTurns + 1; i++) t = await enemyTurnTapping([0], [], `archive${i}`);
    const c4 = await B(page, 'B.enemies[0].charge && B.enemies[0].charge.turnsLeft');
    t = await enemyTurnTapping([0], [], 'archiveRelease');
    const lost = await B(page, 'B.heroes[0].maxHp - B.heroes[0].hp + B.heroes[1].maxHp - B.heroes[1].hp');
    const hpAfter = await B(page, 'B.enemies[0].hp');
    log(c1 === archiveDef.chargeTurns && c4 === 1 && t.results.length === 1 && t.results[0] === 'MISS' && lost === archiveDef.dmg, `Archive: ${archiveDef.chargeTurns} turns of charge, then fires as a red-ring hit; a missed dodge costs ${archiveDef.dmg}`, `turnsLeft after turn 1: ${c1}, before the release: ${c4}; results ${t.results}; hp lost ${lost}; trace ${t.trace.filter((k) => /archive/.test(k)).join(' ')}`);
    log(hpAfter === 100 - 12 + 4, 'Archive: release heals half of what the guard absorbed (20 hit → 12 taken, +4 back)', `clerk hp ${hpAfter}`);
    log(page.errors.length === 0, 'no console errors during boss moves', page.errors.slice(0, 2).join(' | '));
  }

  // ============ F-keepsake + recollection ============
  if (want('keepsake')) {
    const page = await battle(chrome, server, 'boss_clerk');
    await waitMenu(page);
    // Story: the Recollection unlocks in stage 2 once HP is <= recollectionAtHpPct (quill.mjs checks the whole rise).
    await page.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; e.phase = 1; e.maxHp = ${clerkDef.hp}; e.hp = Math.floor(e.maxHp * ${clerkDef.stages[1].recollectionAtHpPct} / 100) + 3; B.updateLabel(e); })()`);
    await page.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; B.chain = 0; B.applyHit(e, 6); })()`);
    const queued = await B(page, 'B.pendingEvents.includes("keepsake_burn")');
    log(queued, `Keepsake: crossing ${clerkDef.stages[1].recollectionAtHpPct}% of stage 2 queues the event`, `pending ${await B(page, 'B.pendingEvents.join()')}`);
    // The expression must not evaluate to the promise: page.ev awaits one, and this one only settles after the taps below.
    await page.ev(`window.__battle.hideCommandMenu(); window.__battle.noAutoCast = true; window.__ke = window.__battle.afterTurn().then(() => { window.__keDone = true; }); null`);
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
    log(await B(page, 'B.canUltimate(B.heroes[0])'), 'Keepsake: Recollection becomes available to Rhea (QA sets noAutoCast: the cast itself is recollection.mjs D / E and quill.mjs page B)');
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
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach(h => { h.hp = h.maxHp; }); window.__results.length = 0; window.__done = null; window.__stub([0, 0.0]); { const o = B.enemyHit.bind(B); B.enemyHit = (en, t, hit, sh, k) => o(en, t, { ...hit, telegraphMs: hit.telegraphMs * 3 }, sh, k); } B.enemyTurn(B.enemies[0]).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`window.__battle.nala && window.__battle.nala.ring`, { timeout: 5000 });
    const nx = await page.ev(`(() => { const b = window.__battle.nala.image.getBounds(); return { x: b.centerX, y: b.centerY }; })()`);
    await sleep(500);
    const watchInfo = await page.ev(`(() => { const n = window.__battle.nala; return { texture: n.image.texture.key, placeholder: !!n.anims?.idle?.placeholder, anim: n.image.anims.currentAnim?.key, flip: n.container.scaleX < 0, bob: window.__battle.tweens.getTweensOf(n.container).length, trace: Object.keys(window.__animTrace || {}).filter((k) => k.includes('nala')) }; })()`);
    log(!watchInfo.placeholder && watchInfo.anim === 'nala_alert' && watchInfo.trace.includes('play:nala_alert_in') && watchInfo.bob === 0, 'Nala: drawn from the sheet; watching plays alert_in -> alert loop, code bob off', JSON.stringify(watchInfo));
    log(watchInfo.flip, 'Nala: sheet faces left, container flipped so she looks at the enemies');
    await page.shot(join(out, 'nala_glow.png'));
    await page.ev(`window.__hs = []; window.__hissAt = window.__battle.time.now; window.__hsOn = true; (function f() { const B = window.__battle; const img = B.children.list.find((o) => o.type === 'Image' && o.texture && o.texture.key === 'nala_hissing' && o.depth >= 1500 && o.active); const txt = B.children.list.find((o) => o.type === 'Text' && o.text === 'Nala hisses!' && o.depth >= 1500 && o.active); window.__hs.push({ t: Math.round(B.time.now - window.__hissAt), img: !!img, scale: img ? img.scale : 0, txt: !!txt }); if (window.__hsOn) requestAnimationFrame(f); })()`);
    await page.tap(nx.x, nx.y);
    await page.waitFor(`window.__battle.children.list.some((o) => o.type === 'Image' && o.texture && o.texture.key === 'nala_hissing' && o.depth >= 1500 && o.active && o.scale >= 0.55)`, { timeout: 4000 }).catch(() => {});
    await page.shot(join(out, 'nala_hiss_cutin.png'));
    await page.waitFor(`window.__done === true`, { timeout: 6000 });
    const res = await page.ev(`({ results: window.__results.length, used: window.__battle.nala.used, hp: window.__battle.heroes.map(h => h.hp), max: window.__battle.heroes.map(h => h.maxHp) })`);
    log(res.used && res.results === 0 && res.hp.every((h, i) => h === res.max[i]), 'Nala: tapping her during a Hollow telegraph cancels the attack (no damage, no judgement)', JSON.stringify(res));
    await sleep(1000);
    const hs = await page.ev(`(window.__hsOn = false, window.__hs)`);
    const seen = hs.filter((x) => x.img && x.txt);
    const last = hs.filter((x) => x.img || x.txt).at(-1);
    const upTo = Math.max(...seen.map((x) => x.scale));
    log(seen.length > 0 && upTo <= 0.6 * 1.18 + 0.01, 'Nala: the hiss cut-in shows the nala_hissing portrait (settles at 0.6 scale after a punch) and "Nala hisses!" over a dark overlay', `${seen.length} frames, max scale ${upTo.toFixed(2)}`);
    const gone = await page.waitFor(`!window.__battle.children.list.some((o) => o.type === 'Image' && o.texture && o.texture.key === 'nala_hissing' && o.depth >= 1500 && o.active)`, { timeout: 8000 }).then(() => true, () => false);
    log(gone, 'Nala: the hiss cut-in is gone again (700 ms of game time, nothing in it takes input)', `last seen at ${last ? last.t : "?"} ms (raw clock; the headless page runs slow)`);
    const hissInfo = await page.ev(`({ anim: window.__battle.nala.image.anims.currentAnim?.key, trace: Object.keys(window.__animTrace || {}).filter((k) => k.includes('nala')) })`);
    log(['play:nala_hiss', 'hold:nala_hiss', 'impact:nala_hiss'].every((k) => hissInfo.trace.includes(k)) && hissInfo.anim === 'nala_idle', 'Nala: hiss plays once with its hold + impact frames, then back to idle', JSON.stringify(hissInfo));
    // second Hollow attack: Nala is spent -> no glow
    await sleep(500);
    await page.ev(`(() => { window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[1]).then(() => { window.__done = true; }); })()`);
    await sleep(500);
    log(!(await B(page, '!!B.nala.ring')), 'Nala: her save is once per round (no glow on the next Hollow in the same round)');
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

    // ---- nala_save: the first Hollow of the run stops the game before its ring (guided: tap Nala) ----
    const ng = await battle(chrome, server, 'b2_first_hollow', { extra: '&level=2&pauses=on' });
    await waitMenuThroughDialogue(ng);
    await ng.ev(`window.__battle.hideCommandMenu(); window.__battle.tutorialSlow = false; window.__battle.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__results.length = 0; window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[0]).then(() => { window.__done = true; }); null`); // not the promise: the pause holds it
    await ng.waitFor(`window.__done === true`, { timeout: 15000 });
    const blankPaused = await B(ng, `B.registry.get('tutorialSeen') || []`);
    log(!blankPaused.includes('nala_save'), 'nala_save: a Forgotten attack does not trigger it', JSON.stringify(blankPaused));
    await ng.ev(`window.__battle.nala.used = false; window.__battle.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__results.length = 0; window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[1]).then(() => { window.__done = true; }); null`); // not the promise: the pause holds it
    await ng.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'nala_save'`, { timeout: 15000 });
    await sleep(500);
    const np = await B(ng, `({ id: B.tutorialPause.id, guided: B.tutorialPause.guided, hole: B.tutorialPause.hole, rings: B.qteRings?.size || 0, ring: !!B.nala.ring, nala: (() => { const b = B.nala.image.getBounds(); return { x: b.centerX, y: b.centerY }; })() })`);
    log(np.guided && np.rings === 0 && !np.ring, 'nala_save: guided pause up BEFORE the ring exists (no ring, Nala not watching yet)', JSON.stringify(np));
    log(Math.abs(np.hole.x - np.nala.x) < 40 && Math.abs(np.hole.y - np.nala.y) < 60, 'nala_save: the spotlight is on Nala', JSON.stringify({ hole: np.hole, nala: np.nala }));
    const npt = await pauseTexts2(ng);
    log(npt.some((t) => t === 'Nala senses a Hollow. Tap her to stop the attack!') && !npt.includes('Tap to continue'), 'nala_save: text, no "Tap to continue"', JSON.stringify(npt));
    await ng.shot(join(out, 'nala_save_pause.png'));
    await ng.tap(180, 590);
    await sleep(500);
    log(await B(ng, `B.tutorialPause?.id === 'nala_save' && !B.nala.used && (B.qteRings?.size || 0) === 0`), 'nala_save: a tap outside the spotlight is swallowed (still paused, nothing started)');
    await ng.tap(np.hole.x, np.hole.y);
    await ng.waitFor(`window.__done === true`, { timeout: 8000 });
    const ns = await B(ng, `({ pause: B.tutorialPause, used: B.nala.used, results: window.__results.length, hp: B.heroes.map((h) => h.hp), max: B.heroes.map((h) => h.maxHp), trace: Object.keys(window.__animTrace || {}).filter((k) => k.includes('nala_hiss')) })`);
    log(!ns.pause && ns.used && ns.results === 0 && ns.hp.every((h, i) => h === ns.max[i]) && ns.trace.includes('play:nala_hiss'), 'nala_save: the tap through the spotlight fires the save (hiss, attack cancelled, no damage, no judgement)', JSON.stringify(ns));
    await ng.ev(`window.__battle.nala.used = false; window.__battle.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__results.length = 0; window.__done = null; window.__stub([0, 0.0]); window.__battle.enemyTurn(window.__battle.enemies[1]).then(() => { window.__done = true; }); null`); // not the promise: the pause holds it
    await sleep(900);
    const again = await B(ng, `({ pause: B.tutorialPause?.id ?? null, watching: !!B.nala.ring, rings: B.qteRings?.size || 0 })`);
    log(again.pause === null && again.watching && again.rings > 0, 'nala_save: once per run (the next Hollow telegraph starts at once, Nala glows, text prompt only)', JSON.stringify(again));
    await ng.waitFor(`window.__done === true`, { timeout: 10000 });
    log(ng.errors.length === 0, 'nala_save: no page errors', ng.errors.slice(0, 2).join(' | '));
  }

  // ============ F-duel: refuse -> wake -> slow first ring -> parry -> events -> Blast -> Nala -> interrupted end ============
  if (want('duel')) {
    // The baseline flow runs with ?pauses=0 (the tutorial pauses have their own flow below).
    const page = await battle(chrome, server, 'b0_duel', { extra: '&pauses=0' });
    await waitMenu(page);
    // The telegraph of every real Dov attack, as handed to the ring (enemyHit wrapper).
    await page.ev(`(() => { const B = window.__battle; window.__tele = []; window.__firstSlow = []; const o = B.enemyHit.bind(B); B.enemyHit = (en, t, hit, sh, k) => { window.__tele.push(hit.telegraphMs); window.__firstSlow.push(hit.firstSlow); return o(en, t, hit, sh, k); }; })()`);
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
    // attack follows in the same round: slow ring (telegraph x2.5, windows x4) instead of the tutorial slow-mo, then a real tap on impact.
    let ring = null;
    let refusedFirst = null;
    for (let i = 0; i < 10 && !ring; i++) {
      await waitMenuThroughDialogue(page, 60000);
      await page.tap(...slots.strike);
      await sleep(600); // the tapped button's menu is still "pending" for a moment
      for (let t = 0; t < 400 && !ring; t++) {
        if (await page.ev(`!!(window.__battle.qteRings && window.__battle.qteRings.size > 0)`)) ring = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now(), scale: window.__battle.timeScale, tele: window.__tele.slice(), wide: window.__firstSlow.slice(), hits: window.__battle.counters.playerHits, round: window.__battle.stats.turns })`);
        else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) break;
        else if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
        await sleep(150);
      }
      if (i === 0) refusedFirst = !(await B(page, 'B.hasFlag("duelWake")'));
    }
    log(refusedFirst === true && !!ring && (ring.hits === 2 || ring.round >= 3), 'Duel: Dov refuses at first; duel_wake (after Rhea\'s 2nd hit, or round 3) sets duelWake and his first attack comes', `playerHits ${ring?.hits}, round ${ring?.round}`);
    const baseMs = await B(page, `B.enemies[0].def.attacks.map((a) => a.telegraphMs)`);
    const first = ring.tele[0];
    log(ring.tele.length === 1 && baseMs.includes(first / 2.5) && ring.scale === 1 && ring.wide[0] === 4, 'Duel: the first real attack telegraph is x2.5 with windows x4 (PERFECT 360 / GOOD 800 ms) at normal speed (it replaces the slow-mo for that ring)', `telegraphMs ${first} (bases ${baseMs}), window mult ${ring.wide}, timeScale ${ring.scale}, ring ${Math.round(ring.at - ring.now)} ms left`);
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

    // Push Dov under 50 %: duel_nala = Nala jumps in (created on the spot), then the dialogue, then the interrupted end.
    // A per-frame log across the jump proves the order: no Dialogue scene and no portrait object until she LANDS.
    await page.ev(`(() => {
      window.__nf = [];
      const PORTRAITS = ['nala_meow', 'nala_hissing', 'nala_hiss', 'nala_calm', 'nala_affectionate'];
      (function f() {
        const B = window.__battle; const G = window.__game;
        const d = G.scene.getScene('Dialogue');
        const dActive = G.scene.isActive('Dialogue') || G.scene.isPaused('Dialogue');
        const slotsOn = dActive && d && d.portraits ? Object.values(d.portraits).filter((s) => s.image && s.image.active && s.image.visible).map((s) => s.side + ':' + s.key) : [];
        const strays = B.children.list.filter((o) => o.visible && o.texture && PORTRAITS.includes(o.texture.key)).length;
        const n = B.nala;
        window.__nf.push({ t: Math.round(performance.now()), nala: n ? { x: Math.round(n.container.x), y: Math.round(n.container.y), vis: n.container.visible, busy: n.busy, anim: n.image.anims && n.image.anims.currentAnim ? n.image.anims.currentAnim.key : null, fw: n.image.frame.width } : null, dlg: dActive, dlgChildren: dActive && d ? d.children.list.length : 0, portraits: slotsOn, strays, line: dActive && d && d.lines && d.index >= 0 ? d.lines[d.index].text.slice(0, 24) : null });
        if (!window.__nfStop) requestAnimationFrame(f);
      })();
    })()`);
    await page.ev(`window.__battle.enemies[0].hp = Math.floor(window.__battle.enemies[0].maxHp * 0.49)`);
    await page.waitFor(`window.__battle.firedEvents.has('duel_nala') || !!window.__battle.nala`, { timeout: 60000 });
    const nalaSeen = await page.ev(`(() => { const B = window.__battle; const n = B.nala; return n ? { x: Math.round(n.container.x), vis: n.container.visible, hero: Math.round(B.heroes[0].container.x), foe: Math.round(B.enemies[0].container.x) } : null; })()`);
    log(!!nalaSeen, 'Duel: Nala is created on demand for the jump-in', JSON.stringify(nalaSeen));
    await sleep(250);
    await page.shot(join(out, 'duel_nala_air.png'));
    await page.waitFor(`window.__battle.nala && !window.__battle.nala.busy`, { timeout: 5000 });
    await page.waitFor(`window.__game.scene.getScenes(true).some((s) => s.scene.key === 'Dialogue')`, { timeout: 8000 });
    await sleep(900);
    const landed = await B(page, `({ x: Math.round(B.nala.container.x), hero: Math.round(B.heroes[0].container.x), foe: Math.round(B.enemies[0].container.x), dialogue: !!B.scene.get('Dialogue') })`);
    log(landed.x > landed.hero && landed.x < landed.foe, 'Duel: Nala lands between Rhea and Dov', JSON.stringify(landed));
    const dl = await page.ev(`(() => { const d = window.__game.scene.getScene('Dialogue'); return { line: d.lines && d.lines[0] && { speaker: d.lines[0].speaker, portrait: d.lines[0].portrait, style: d.lines[0].style, sfx: d.lines[0].sfx, text: d.lines[0].text }, slots: Object.values(d.portraits).filter((s) => s.image.visible).map((s) => s.side + ':' + s.key) }; })()`);
    log(dl.line?.speaker === 'Nala' && dl.line?.portrait === 'nala_meow' && dl.line?.style === 'narration' && dl.line?.sfx === 'sfx_meow' && /sharp meow/.test(dl.line?.text), 'Duel: duel_nala opens with the Nala narration line (nala_meow portrait, sfx_meow)', JSON.stringify(dl));
    log(dl.slots.length === 1 && dl.slots[0] === 'right:nala_meow', 'Duel: the first line shows only Nala\'s portrait, on the RIGHT', JSON.stringify(dl.slots));
    await page.shot(join(out, 'duel_nala_jump.png'));
    const nf = await page.ev(`(window.__nfStop = true, window.__nf)`);
    const jumpStart = nf.findIndex((f) => f.nala && f.nala.busy);
    const firstPortrait = nf.findIndex((f) => f.portraits.length > 0);
    const firstDialogue = nf.findIndex((f) => f.dlg);
    const landing = nf.findIndex((f, i) => i > jumpStart && f.nala && !f.nala.busy);
    const duringJump = nf.slice(jumpStart, landing);
    const noEarly = duringJump.length > 10 && duringJump.every((f) => !f.dlg && f.portraits.length === 0 && f.strays === 0 && !f.line && f.nala.fw < 100); // the 64px sheet frame, never the 264x310 portrait art
    log(jumpStart >= 0 && landing > jumpStart && noEarly, `Duel: during the jump (${duringJump.length} frames) there is no Dialogue scene, no portrait and no line`, JSON.stringify({ jumpStart, landing, firstDialogue, firstPortrait, early: duringJump.filter((f) => f.dlg || f.portraits.length || f.strays).slice(0, 2) }));
    log(firstPortrait > landing - 1 && firstDialogue >= landing && nf[firstPortrait].portraits.join() === 'right:nala_meow' && /Nala leaps/.test(nf[firstPortrait].line || ''), 'Duel: the portrait (right, nala_meow) first exists on/after the landing frame, together with the first line', JSON.stringify({ landing, firstDialogue, firstPortrait, frame: nf[firstPortrait] }));
    // 8 sample frames across the jump and the landing for the report.
    const pick = Array.from({ length: 8 }, (_, i) => Math.round(jumpStart + ((Math.max(firstPortrait, landing) + 2 - jumpStart) * i) / 7));
    console.log('  nala frames (idx t nala{x,y,busy,anim} dlg portraits strays line):');
    for (const i of pick) { const f = nf[i]; if (f) console.log(`   #${i} t=${f.t - nf[jumpStart].t}ms nala=${JSON.stringify(f.nala)} dlg=${f.dlg} portraits=[${f.portraits}] strays=${f.strays} line=${JSON.stringify(f.line)}`); }
    log(landed.x > 0 && ['nala_idle', 'nala_alert_out'].includes(await page.ev(`window.__battle.nala.image.anims.currentAnim?.key`)), 'Duel: on landing she plays alert_out -> idle (no hiss sheet)', await page.ev(`window.__battle.nala.image.anims.currentAnim?.key`));
    await tapDialogue();
    await page.waitFor(`window.__battle.battleOver === true`, { timeout: 8000 });
    await sleep(1500);
    await page.shot(join(out, 'duel_recall_card.png'));
    const end = await B(page, `({ over: B.battleOver, xp: B.registry.get('recallXp'), level: B.level, texts: B.children.list.filter((o) => o.type === 'Text' && o.visible).map((o) => o.text) })`);
    const levelUp = end.texts.some((t) => /RECALL \d/.test(t));
    log(end.over && end.xp === 40 && !levelUp && end.texts.some((t) => /\+40/.test(t)) && end.texts.some((t) => /Recall 1/.test(t)), 'Duel: interrupted end gives +40 Memories (40/60), Recall 1, no level-up', JSON.stringify({ xp: end.xp, level: end.level, levelUp }));
  }

  // ============ F-duel-pauses: tutorial pauses (spotlight + text, tap to continue) ============
  if (want('duel')) {
    const page = await battle(chrome, server, 'b0_duel', { extra: '&pauses=on' });
    await waitMenu(page);
    await page.ev(`(() => { const B = window.__battle; window.__tele = []; const o = B.enemyHit.bind(B); B.enemyHit = (en, t, hit, sh, k) => { window.__tele.push({ rings: B.qteRings?.size || 0, pause: B.tutorialPause?.id ?? null }); return o(en, t, hit, sh, k); }; })()`);
    const tp = () => B(page, `B.tutorialPause ? { id: B.tutorialPause.id, step: B.tutorialPause.step, steps: B.tutorialPause.steps } : null`);
    const waitPause = (id, timeout = 40000) => page.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.id === ${JSON.stringify(id)}`, { timeout });
    // The pause's own objects: texts above the dim's depth, the dim itself (the biggest rectangle at depth 6000).
    const pauseTexts = () => B(page, `B.children.list.filter((o) => o.type === 'Text' && o.depth > 6000 && o.visible).map((o) => ({ text: o.text, lines: o.getWrappedText ? o.getWrappedText(o.text).length : 1, size: o.style.fontSize }))`);
    const waitStep = (n) => page.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.step === ${n}`, { timeout: 5000 });
    const continueTap = async (x = 180, y = 320) => {
      await sleep(450); // the pause ignores taps for the first 300 ms
      await page.tap(x, y);
    };

    // (a) battle_start: 4 steps, each advanced by a tap; the dim sits above everything else.
    await waitPause('battle_start');
    log((await tp()).steps === 4, 'Pauses: battle_start has 4 steps', JSON.stringify(await tp()));
    const depths = await B(page, `({ dim: Math.max(...B.children.list.filter((o) => o.type === 'Rectangle' && o.depth === 6000).map((o) => o.depth)), others: Math.max(...B.children.list.filter((o) => o.depth < 6000 && o.visible !== false).map((o) => o.depth)), hud: B.hud.rows.length })`);
    log(depths.dim === 6000 && depths.others < 6000, 'Pauses: the dim is above the HUD and every other object', JSON.stringify(depths));
    // A tap within 300 ms of the step appearing is ignored (accidental skips).
    // (Only when the poll found the pause young enough: a slow poll would turn a legitimate tap into a failure.)
    const age = await page.ev(`performance.now() - window.__battle.tutorialPause.shownAt`);
    if (age < 200) {
      await page.tap(180, 320);
      const early = await page.ev(`({ step: window.__battle.tutorialPause.step })`);
      log(early.step === 0, 'Pauses: a tap within 300 ms of the step appearing does not skip it', JSON.stringify({ ageMs: Math.round(age), ...early }));
    } else log(true, 'Pauses: early-tap check skipped (the poll found the pause late)', `${Math.round(age)} ms old`);
    await sleep(500);
    const t1 = await pauseTexts();
    log(t1.some((t) => /This is your HP/.test(t.text)) && t1.every((t) => t.lines <= 2 || /\d\/\d|Tap to continue/.test(t.text)), 'Pauses: step 1 text (HP) is up, at most 2 lines', JSON.stringify(t1));
    await page.shot(join(out, 'pause_a1_hp.png'));
    await continueTap();
    await waitStep(1);
    await sleep(500);
    await page.shot(join(out, 'pause_a2_echo.png'));
    const t2 = await pauseTexts();
    log(t2.some((t) => /^Echo\./.test(t.text)), 'Pauses: tap advances to step 2 (Echo)', JSON.stringify(t2.map((t) => t.text)));
    await continueTap();
    await waitStep(2);
    await sleep(500);
    await page.shot(join(out, 'pause_a3_strike.png'));
    // Step 3 spotlights the Strike button: a tap ON it must advance the pause, not strike.
    await sleep(0);
    await page.tap(...slots.strike);
    await waitStep(3);
    const hits0 = await B(page, 'B.counters.playerHits');
    await sleep(500);
    await page.shot(join(out, 'pause_a4_technique.png'));
    await continueTap();
    await page.waitFor(`!window.__battle.tutorialPause`, { timeout: 5000 });
    await sleep(400);
    const after = await B(page, `({ pending: !!B.menu.pending, hits: B.counters.playerHits, hp: B.enemies[0].hp, max: B.enemies[0].maxHp, scales: [B.tweens.timeScale, B.anims.globalTimeScale, B.time.timeScale] })`);
    log(after.pending && after.hits === hits0 && after.hits === 0 && after.hp === after.max && after.scales.every((x) => x === 1), 'Pauses: the continue taps are swallowed (no Strike), the menu waits, time scales restored', JSON.stringify(after));

    // Strike until Dov's first real attack: pause "parry" comes BEFORE the ring exists.
    let sawParry = false;
    for (let i = 0; i < 10 && !sawParry; i++) {
      await waitMenuThroughDialogue(page, 60000);
      await page.tap(...slots.strike);
      await sleep(600);
      for (let t = 0; t < 400 && !sawParry; t++) {
        if (await page.ev(`!!(window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'parry')`)) sawParry = true;
        else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) break;
        else if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
        await sleep(120);
      }
    }
    log(sawParry, 'Pauses: the parry pause appears at Dov\'s first real attack');
    const pre = await B(page, `({ rings: B.qteRings?.size || 0, tele: window.__tele.length })`);
    await sleep(500);
    await page.shot(join(out, 'pause_b_parry.png'));
    const pt = await pauseTexts();
    log(pre.rings === 0 && pre.tele === 0 && pt.some((t) => /Dov attacks! Tap anywhere/.test(t.text)), 'Pauses: parry pause shows before the first ring is created (no ring, enemyHit not yet called)', JSON.stringify({ pre, texts: pt.map((t) => t.text) }));
    await page.ev(`window.__results.length = 0`);
    await continueTap(180, 590); // a tap in the tap zone: it must not count as a parry
    await page.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 8000 });
    const ring = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now(), results: window.__results.length, tele: window.__tele.slice() })`);
    log(ring.results === 0 && ring.tele.length === 1 && ring.tele[0].rings === 0 && ring.tele[0].pause === null, 'Pauses: the dismiss tap is not a parry (no judgement yet), the ring starts after the pause', JSON.stringify(ring));
    await sleep(Math.max(0, ring.at - ring.now - 6));
    await page.tap(180, 610);
    await page.waitFor(`window.__results.length > 0`, { timeout: 5000 });
    const res1 = await page.ev(`window.__results[0]`);
    log(res1.result !== 'MISS' && res1.input === 'tap', 'Pauses: the real tap at impact is judged normally after the pause', JSON.stringify(res1));

    // (e) Guided Technique -> Blast: Rhea's first menu after duel_blast_unlock. Only a tap on Technique gets through.
    let sawGuided = false;
    for (let i = 0; i < 200 && !sawGuided; i++) {
      if (await page.ev(`!!(window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'technique_guided')`)) sawGuided = true;
      else {
        if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
        await sleep(300);
      }
    }
    log(sawGuided, 'Pauses: after the first parry + its dialogues, Rhea\'s next menu opens the guided technique_guided pause');
    await sleep(500);
    await page.shot(join(out, 'pause_e1_guided.png'));
    const gt = await pauseTexts();
    const gInfo = await B(page, `({ pause: B.tutorialPause, hits: B.counters.playerHits, pending: !!B.menu.pending, flag: B.hasFlag('blastUnlocked'), echo: B.heroes[0].echo })`);
    log(gt.some((t) => t.text === 'Tap Technique.') && !gt.some((t) => /Tap to continue/.test(t.text)) && gInfo.flag && gInfo.pause.guided && Math.abs(gInfo.pause.hole.x - slots.technique[0]) < 4 && Math.abs(gInfo.pause.hole.y - slots.technique[1]) < 4, 'Pauses: guided text "Tap Technique." (no "Tap to continue"), spotlight on the Technique button', JSON.stringify({ texts: gt.map((t) => t.text), hole: gInfo.pause.hole }));
    // Taps outside the spotlight (the scene, the Strike button, the empty slot) are swallowed.
    await page.tap(180, 320);
    await sleep(150);
    await page.tap(...slots.strike);
    await sleep(900);
    const swallowed = await B(page, `({ id: B.tutorialPause?.id ?? null, hits: B.counters.playerHits, pending: !!B.menu.pending, items: B.menu.items.map((i) => i.slot + ':' + i.value) })`);
    log(swallowed.id === 'technique_guided' && swallowed.hits === gInfo.hits && swallowed.pending && swallowed.items.join().includes('strike:strike'), 'Pauses: guided: taps outside the spotlight (scene, Strike button) are swallowed; the pause stays up and nothing was struck', JSON.stringify(swallowed));
    // Rhea has 1 Echo now: the explain step must say she needs one more Strike.
    await page.ev(`(() => { const h = window.__battle.heroes[0]; h.echo = 1; window.__battle.refreshHud(); })()`);
    await page.tap(...slots.technique); // inside the spotlight: the pause ends and the tap opens the Technique list
    await waitPause('blast_explain', 8000);
    const listItems = await B(page, `B.menu.items.map((i) => i.slot + ':' + i.label)`);
    log(listItems.includes('strike:Blast'), 'Pauses: the tap inside the spotlight passed through: the technique list is open (Blast), blast_explain pause up', JSON.stringify(listItems));
    await sleep(500);
    await page.shot(join(out, 'pause_e2_blast.png'));
    const b1t = await pauseTexts();
    log((await tp())?.steps === 3 && b1t.some((t) => /^Blast: your first Technique\. 2 Echo, 2 bolts of pure memory\.$/.test(t.text)) && b1t.every((t) => t.lines <= 3 || /\d\/\d|Tap to continue/.test(t.text)), 'Pauses: blast_explain step 1 text', JSON.stringify(b1t.map((t) => [t.text, t.lines])));
    await continueTap();
    await waitStep(1);
    await sleep(500);
    await page.shot(join(out, 'pause_e3_echo.png'));
    const b2t = await pauseTexts();
    log(b2t.some((t) => /^Techniques spend the Echo your Strikes and PERFECT parries earn\. When Echo runs out, Strike\. \(Strike once more to afford it\.\)$/.test(t.text)), 'Pauses: blast_explain step 2 text (with the "Strike once more" line when Echo < 2)', JSON.stringify(b2t.map((t) => t.text)));
    await continueTap();
    await waitStep(2);
    await sleep(500);
    const b3t = await pauseTexts();
    log(b3t.some((t) => /^Hold any ability to read what it does\.$/.test(t.text)) && b3t.every((t) => t.lines <= 2 || /\d\/\d|Tap to continue/.test(t.text)), 'Pauses: blast_explain step 3 text ("Hold any ability ...", at most 2 lines)', JSON.stringify(b3t.map((t) => [t.text, t.lines])));
    await continueTap();
    await page.waitFor(`!window.__battle.tutorialPause`, { timeout: 5000 });
    await sleep(300);
    const afterExplain = await B(page, `({ pending: !!B.menu.pending, items: B.menu.items.map((i) => i.slot), hits: B.counters.playerHits })`);
    log(afterExplain.pending && afterExplain.items.includes('back') && afterExplain.hits === gInfo.hits, 'Pauses: after the explanation the technique list stays open (Blast or Back, picked normally)', JSON.stringify(afterExplain));
    await page.tap(...slots.back);
    await sleep(500);
    await page.tap(...slots.technique); // opening the list again: each pause shows once
    await sleep(700);
    log(!(await tp()), 'Pauses: reopening the technique list does not repeat blast_explain');
    await page.tap(...slots.back);
    await sleep(500);

    // Second real attack: the dodge pause, before its ring; the old dodge banner is not shown on top.
    let sawDodge = false;
    for (let i = 0; i < 12 && !sawDodge; i++) {
      for (let t = 0; t < 400 && !sawDodge; t++) {
        if (await page.ev(`!!(window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'dodge')`)) sawDodge = true;
        else if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) {
          const items = await B(page, `B.menu.items.map((i) => i.value)`);
          if (items.includes('strike') || items.includes('technique')) {
            await page.tap(...slots.strike);
            await sleep(600);
          } else await sleep(150);
        } else if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
        else if (await page.ev(`!!(window.__battle.qteRings && window.__battle.qteRings.size > 0)`)) {
          // an unexpected ring before the dodge pause would be a failure
          break;
        } else await sleep(120);
      }
    }
    const preDodge = await B(page, `({ rings: B.qteRings?.size || 0, tele: window.__tele.length, banner: B.hints.isShowing('dodge') })`);
    log(sawDodge && preDodge.rings === 0 && preDodge.tele === 1, 'Pauses: the dodge pause appears at Dov\'s second real attack, before its ring', JSON.stringify(preDodge));
    await sleep(500);
    await page.shot(join(out, 'pause_c_dodge.png'));
    const dt = await pauseTexts();
    log(dt.some((t) => /swipe to dodge/.test(t.text) && t.lines <= 2), 'Pauses: dodge text fits in 2 lines', JSON.stringify(dt.map((t) => [t.text, t.lines])));
    await page.ev(`window.__results.length = 0`);
    await continueTap(180, 590);
    await page.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 8000 });
    const ring2 = await page.ev(`({ at: [...window.__battle.qteRings][0].impactAt, now: performance.now(), results: window.__results.length, banner: window.__battle.hints.isShowing('dodge') })`);
    log(ring2.results === 0 && !ring2.banner, 'Pauses: no judgement from the dismiss tap, and the dodge banner is not shown a second time', JSON.stringify(ring2));
    await sleep(Math.max(0, ring2.at - ring2.now - 6));
    await page.swipe(180, 610, -80);
    await page.waitFor(`window.__results.length > 0`, { timeout: 5000 });
    log((await page.ev(`window.__results[0].input`)) === 'swipe', 'Pauses: a swipe after the dodge pause is judged as a dodge');

    // The duel ends (Dov under 50 %): the Recall card, then the leveling pause once the bar is drawn.
    await page.ev(`window.__battle.enemies[0].hp = Math.floor(window.__battle.enemies[0].maxHp * 0.49)`);
    for (let i = 0; i < 120 && !(await page.ev(`!!(window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'leveling')`)); i++) {
      if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
      else if (await page.ev(`!!(window.__battle.battleOver && !window.__battle.tutorialPause)`)) await page.tap(180, 560);
      await sleep(400);
    }
    const lv = await tp();
    log(lv?.id === 'leveling' && lv.steps === 2, 'Pauses: the leveling pause shows on the Recall card', JSON.stringify(lv));
    await sleep(500);
    await page.shot(join(out, 'pause_d_leveling.png'));
    const lt = await pauseTexts();
    log(lt.some((t) => /Memories return/.test(t.text) && t.lines <= 2), 'Pauses: leveling step 1 text', JSON.stringify(lt.map((t) => t.text)));
    await continueTap();
    await waitStep(1);
    await sleep(400);
    await page.shot(join(out, 'pause_d_leveling2.png'));
    const lt2 = await pauseTexts();
    log(lt2.some((t) => /Recall grows/.test(t.text) && t.lines <= 2), 'Pauses: leveling step 2 text fits in 2 lines', JSON.stringify(lt2.map((t) => [t.text, t.lines])));
    await continueTap();
    await page.waitFor(`!window.__battle.tutorialPause`, { timeout: 5000 });
    await sleep(500);
    const card = await B(page, `({ over: B.battleOver, scenes: window.__game.scene.getScenes(true).map((s) => s.scene.key), seen: B.registry.get('tutorialSeen') })`);
    log(card.scenes.includes('Battle') && card.seen.join() === 'battle_start,parry,technique_guided,blast_explain,dodge,leveling', 'Pauses: each pause fired exactly once, in order', JSON.stringify(card));
    await page.tap(180, 560); // the Recall card's own continue tap still works after the pause
    await waitScene(page, 'Title', 10000).catch(() => {});
    log((await page.scenes()).includes('Title') && !page.errors.length, 'Pauses: the Recall card continues after the pause (no page errors)', JSON.stringify({ errors: page.errors, scenes: await page.scenes() }));

    // ?pauses=0: none of them.
    const off = await battle(chrome, server, 'b0_duel', { extra: '&pauses=0' });
    await waitMenu(off);
    await sleep(800);
    const offState = await B(off, `({ pause: B.tutorialPause, seen: B.registry.get('tutorialSeen') || [], banner: B.hints.isShowing('strike') })`);
    await off.tap(...slots.strike);
    await sleep(900);
    const offHit = await B(off, `({ pending: !!B.menu.pending, hp: B.enemies[0].hp, max: B.enemies[0].maxHp })`);
    log(offState.pause === null && offState.seen.length === 0 && offState.banner && (!offHit.pending || offHit.hp < offHit.max), '?pauses=0: no pause, the Strike button works at once, the old banner is back', JSON.stringify({ offState, offHit }));
  }

  // ============ F-pauses2: break_intro (b1, Rhea's first menu) and red_ring (before the first red ring of the run) ============
  if (want('duel') || want('pauses')) {
    const page = await battle(chrome, server, 'b1_forgotten', { extra: '&pauses=on' });
    await waitMenu(page);
    const tp = () => B(page, `B.tutorialPause ? { id: B.tutorialPause.id, step: B.tutorialPause.step, steps: B.tutorialPause.steps } : null`);
    const pauseTexts = () => B(page, `B.children.list.filter((o) => o.type === 'Text' && o.depth > 6000 && o.visible).map((o) => o.text)`);
    await page.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'break_intro'`, { timeout: 8000 });
    log((await tp()).steps === 2, 'break_intro: pauses Rhea\'s first menu in b1_forgotten (not a tutorial battle: always), 2 steps', JSON.stringify(await tp()));
    await sleep(500);
    await page.shot(join(out, 'pause_f1_break.png'));
    const bt1 = await pauseTexts();
    const poiseRect = await B(page, `(() => { const r = B.tutorialTargets['enemy.poise'](); return r && { x: Math.round(r.x), y: Math.round(r.y), w: r.w, h: r.h }; })()`);
    log(bt1.includes('The golden line is its footing. Every hit chips it.') && !!poiseRect && poiseRect.y > 100 && poiseRect.y < 300, 'break_intro: step 1 text; the spotlight is the first enemy\'s golden poise line', JSON.stringify({ bt1, poiseRect }));
    await sleep(0);
    await page.tap(180, 320);
    await page.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.step === 1`, { timeout: 5000 });
    await sleep(500);
    await page.shot(join(out, 'pause_f2_break.png'));
    const bt2 = await pauseTexts();
    log(bt2.includes('Empty it and the enemy BREAKS: it loses its next turn and takes extra damage.'), 'break_intro: step 2 text (poise line + Strike button)', JSON.stringify(bt2));
    await page.tap(180, 320);
    await page.waitFor(`!window.__battle.tutorialPause`, { timeout: 5000 });
    await page.tap(...slots.strike);
    await page.waitFor(`window.__battle.menu.items.some((i) => i.slot === 'target')`, { timeout: 15000 });
    await B(page, `B.menu.choose(B.enemies[0])`); // two Forgotten: the target menu
    await page.waitFor(`window.__battle.counters.playerHits > 0`, { timeout: 15000 });
    await sleep(600);
    log(!(await B(page, `B.hints.isShowing('break')`)) && (await B(page, `B.registry.get('tutorialSeen')`)).includes('break_intro'), 'break_intro: the old "break" banner is suppressed once the pause has shown (skipHints)');
    await page.close?.();

    // red_ring: before the first unparryable ring of the run (b2: b1 never throws one).
    const p2 = await battle(chrome, server, 'b2_first_hollow', { extra: '&pauses=on' });
    await waitMenuThroughDialogue(p2, 60000);
    const noBreak = await B(p2, `({ pause: B.tutorialPause?.id ?? null, seen: B.registry.get('tutorialSeen') || [] })`);
    log(noBreak.pause === null && !noBreak.seen.includes('break_intro'), 'break_intro: not shown in b2 (only b1 sets it)', JSON.stringify(noBreak));
    await p2.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tapHint.setVisible(true); window.__results = []; const h = B.heroes[0]; h.hp = h.maxHp;
      const o = B.applyParryResult.bind(B); B.applyParryResult = (r, e, hero, hit, input) => { window.__results.push({ result: r, input }); return o(r, e, hero, hit, input); };
      const hit = { telegraphMs: 800, dmg: 8, unparryable: true };
      window.__done = null; B.enemyHit(B.enemies[0], h, hit, null, 0).then((r) => { window.__done = r; }); })()`);
    await p2.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.id === 'red_ring'`, { timeout: 8000 });
    const pre = await B(p2, `({ rings: B.qteRings?.size || 0, st: B.tutorialPause.steps })`);
    log(pre.rings === 0 && pre.st === 2, 'red_ring: the pause comes before the first red ring exists (no ring yet), 2 steps', JSON.stringify(pre));
    await sleep(500);
    await p2.shot(join(out, 'pause_g1_red.png'));
    const rt1 = await pauseTexts2(p2);
    log(rt1.includes("A RED ring can't be parried. Swipe anywhere to dodge it."), 'red_ring: step 1 text (swipe indicator over the attacker + tap zone)', JSON.stringify(rt1));
    await p2.tap(180, 320);
    await p2.waitFor(`window.__battle.tutorialPause && window.__battle.tutorialPause.step === 1`, { timeout: 5000 });
    await sleep(500);
    await p2.shot(join(out, 'pause_g2_red.png'));
    const rt2 = await pauseTexts2(p2);
    log(rt2.includes('A PERFECT dodge takes nothing. Late takes half. A tap takes it all.'), 'red_ring: step 2 text', JSON.stringify(rt2));
    await p2.tap(180, 320);
    await p2.waitFor(`!window.__battle.tutorialPause && window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 8000 });
    const after = await B(p2, `({ scale: B.timeScale, prompt: !!(B.tutorialPrompt && B.tutorialPrompt.visible), hint: B.tapHint.text, hintVisible: B.tapHint.visible, results: window.__results.length })`);
    log(after.scale === 0.35 && !after.prompt && after.hintVisible && /Swipe to dodge/.test(after.hint) && after.results === 0, 'red_ring: the ring starts after the pause (slow-mo lesson still runs), its own "Red ring: SWIPE" prompt is suppressed, "Swipe to dodge!" hint stays; the dismiss tap is not judged', JSON.stringify(after));
    const at = await p2.ev(`[...window.__battle.qteRings][0].impactAt`);
    await sleep(Math.max(0, at - (await p2.ev(`performance.now()`)) - 6));
    await p2.swipe(180, 610, -80);
    await p2.waitFor(`window.__done !== null`, { timeout: 8000 });
    log((await p2.ev(`window.__results[0].input`)) === 'swipe', 'red_ring: a swipe answers the red ring after the pause');
    // a second red ring: no pause.
    await p2.ev(`(() => { const B = window.__battle; window.__done = null; B.enemyHit(B.enemies[0], B.heroes[0], { telegraphMs: 800, dmg: 8, unparryable: true }, null, 0).then((r) => { window.__done = r; }); })()`);
    await p2.waitFor(`window.__battle.qteRings && window.__battle.qteRings.size > 0`, { timeout: 5000 });
    log(!(await B(p2, `B.tutorialPause`)), 'red_ring: shown once per run (a second red ring starts at once)');
    await p2.waitFor(`window.__done !== null`, { timeout: 8000 });
    log(!p2.errors.length && !page.errors.length, 'break_intro / red_ring: no page errors', JSON.stringify([...page.errors, ...p2.errors]));
  }

  // ============ F-b3: Nala's glow (Echo Strikes), cooldown, the save once per round ============
  if (want('b3')) {
    const page = await battle(chrome, server, 'b3_gate', { extra: '&level=3&pauses=all' });
    await waitMenu(page);
    // Durable heroes (the rings are not played), and a collector of every visible text (pops are short-lived).
    await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => { h.maxHp = h.hp = 999; }); B.refreshHud(); window.__seen = new Set(); (function f() { B.children.list.forEach((o) => { if (o.type === 'Text' && o.visible) window.__seen.add(o.text); }); requestAnimationFrame(f); })(); })()`);
    const nalaPos = () => page.ev(`(() => { const b = window.__battle.nala.image.getBounds(); return { x: b.centerX, y: b.centerY }; })()`);
    const strikeAt = async (idx) => {
      await page.waitFor(`window.__battle.playerInput && !!(window.__battle.menu && window.__battle.menu.pending) && window.__battle.menu.items.some((i) => i.slot === 'strike')`, { timeout: 60000 });
      await page.tap(...slots.strike);
      await page.waitFor(`window.__battle.menu.items.some((i) => i.slot === 'target')`, { timeout: 15000 });
      await B(page, `B.menu.choose(B.enemies[${idx}])`);
    };
    // Taps through dialogue / tutorial pauses until a hero's menu is up; logs which ones passed.
    const settle = async (log2 = {}) => {
      const end = Date.now() + 90000;
      while (Date.now() < end) {
        if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) return;
        const sc = await page.scenes();
        const pid = await B(page, `B.tutorialPause ? B.tutorialPause.id : null`);
        if (pid) {
          (log2.pauses ||= []).push(`${pid}:${await B(page, 'B.tutorialPause.step')}`);
          if (pid === 'nala_glow' && !log2.pauseTexts) {
            await sleep(500);
            log2.pauseTexts = await pauseTexts2(page);
            log2.pauseStatuses = await B(page, `B.heroes.map((h) => Object.keys(h.statuses))`);
          }
          await page.tap(180, 320);
        } else if (sc.includes('Dialogue')) {
          const did = await page.ev(`(window.__game.scene.getScene('Dialogue') || {}).dialogueId`);
          if (!(log2.dialogues ||= []).includes(did)) log2.dialogues.push(did);
          await page.tap(180, 560);
        }
        await sleep(250);
      }
      throw new Error('settle: timeout');
    };
    // The save: tap Nala while a Hollow's ring is up.
    const saveWithNala = async () => {
      await page.waitFor(`!!(window.__battle.nala && window.__battle.nala.ring) || window.__battle.battleOver`, { timeout: 90000 }).catch(async (e) => {
        await page.shot(join(out, 'b3_timeout.png'));
        throw new Error(e.message + ' | ' + JSON.stringify(await B(page, `({ turns: B.stats.turns, active: B.activeHero && B.activeHero.type, pause: B.tutorialPause && B.tutorialPause.id, menu: !!(B.menu && B.menu.pending), used: B.nala.used, left: B.nala.usesLeft, hp: B.heroes.map((h) => h.hp), ehp: B.enemies.map((x) => x.hp), rings: B.qteRings && B.qteRings.size, errors: ${JSON.stringify(page.errors.slice(0, 2))} })`)) + ' ' + JSON.stringify(await page.scenes()));
      });
      if (await B(page, 'B.battleOver')) throw new Error('battle over while waiting for a Hollow ring: ' + JSON.stringify(page.errors.slice(0, 3)));
      const np = await nalaPos();
      await page.tap(np.x, np.y);
      await page.waitFor(`!window.__battle.nala.ring`, { timeout: 5000 });
    };

    // Round 1: both heroes Strike a Hollow, both IMMUNE.
    const hp0 = await B(page, `B.enemies.map((e) => e.hp)`);
    await strikeAt(1);
    await waitMenu(page, 60000);
    const r1a = await B(page, `({ imm: B.counters.hollowImmuneThisRound, dmg: B.counters.hollowDamageThisRound, ready: B.nalaGlowReady() })`);
    await strikeAt(0);
    // The enemy phase: the first Hollow ring, Nala saves (#1).
    await saveWithNala();
    const save1 = await B(page, `({ used: B.nala.used, left: B.nala.usesLeft, round: B.stats.turns, imm: B.counters.hollowImmuneThisRound, dmg: B.counters.hollowDamageThisRound })`);
    log(r1a.imm === 1 && save1.imm === 2 && save1.dmg === 0 && JSON.stringify(await B(page, `B.enemies.map((e) => e.hp)`)) === JSON.stringify(hp0), 'b3: round 1, both Strikes pass through the Hollows (IMMUNE), nothing lands', JSON.stringify({ r1a, save1 }));
    log(save1.used && save1.left === 0 && save1.round === 1, 'b3: Nala saves in round 1 (tap on the Hollow ring)', JSON.stringify(save1));
    // Wait for the event: dialogue, glow, pause, then Rhea's menu.
    const ev1 = {};
    await settle(ev1);
    const post = await B(page, `({ round: B.stats.turns, fired: [...B.firedEvents], st: B.heroes.map((h) => Object.keys(h.statuses).map((k) => k + ':' + h.statuses[k].turns)), nala: { on: B.nala.glowOn, cd: B.nala.glowCd, left: B.nala.usesLeft, used: B.nala.used }, counter: B.nala.counter.text, counterVisible: B.nala.counter.visible, quiet: B.counters.noHollowDamageRounds, seen: [...window.__seen] })`);
    log(post.fired.includes('b3_nala_glow') && ev1.dialogues?.includes('b3_nala_glow') && ev1.pauses?.some((x) => x.startsWith('nala_glow')) && post.quiet === 1, 'b3: after round 1 with nothing landed the event fires: dialogue b3_nala_glow, then the nala_glow pause', JSON.stringify({ ev1, quiet: post.quiet, fired: post.fired }));
    log(ev1.pauses.filter((x) => x.startsWith('nala_glow')).length === 2 && ev1.pauseTexts?.includes('Nala lends her Echo: this round your Strikes can wound Hollows.') && (ev1.pauseStatuses || []).every((l) => l.includes('echo_strike')), 'b3: the pause runs after the glow (2 steps, step 1 text, both heroes already have echo_strike)', JSON.stringify({ p: ev1.pauses, t: ev1.pauseTexts, s: ev1.pauseStatuses }));
    log(post.round === 2 && post.st.every((l) => l.length === 1 && l[0] === 'echo_strike:1'), 'b3: the next round, both heroes have Echo Strike (1 turn)', JSON.stringify(post.st));
    log(post.seen.includes('ECHO STRIKE'), 'b3: the glow pops ECHO STRIKE over the heroes', '');
    log(post.nala.on && post.nala.cd === 3 && post.counterVisible && post.counter === 'Glow in 3' && post.nala.left === 1 && !post.nala.used, 'b3: the Glow is on a 3-round cooldown ("Glow in 3" under Nala); her save is back (once per round)', JSON.stringify(post.nala) + ' ' + post.counter);
    const badge = await page.ev(`window.__battle.hud.rows.map((r) => r.badgeSig)`);
    log(badge.every((b) => /echo_strike:1/.test(b)), 'b3: HUD badge "E1" on both heroes', JSON.stringify(badge));
    await page.shot(join(out, 'b3_glow_badges.png'));
    // Round 2: Rhea's Strike on a Hollow now wounds it (ECHO STRIKE text), and the menu's card is no longer "IMMUNE".
    await page.tap(...slots.strike);
    await page.waitFor(`window.__battle.menu.items.some((i) => i.slot === 'target')`, { timeout: 15000 });
    await sleep(300);
    const cardTexts = await page.ev(`(() => { const out = []; const walk = (l) => l.forEach((o) => { if (o.list) walk(o.list); if (o.type === 'Text') out.push(o.text); }); walk(window.__battle.menu.buttons.map(b => b.container)); return out; })()`);
    log(!cardTexts.some((t) => /IMMUNE/.test(t)), 'b3: with Echo Strike the target cards drop the "IMMUNE to Strike" note', cardTexts.join('|'));
    const hpR = await B(page, `B.enemies.map((e) => e.hp)`);
    await page.ev(`window.__seen.clear()`);
    await B(page, `B.menu.choose(B.enemies[1])`);
    await page.waitFor(`window.__battle.counters.hollowDamageThisRound > 0`, { timeout: 15000 });
    const hpR2 = await B(page, `B.enemies.map((e) => e.hp)`);
    log(hpR2[1] < hpR[1], "b3: Rhea's Echo Strike damages the Hollow", `${hpR} -> ${hpR2}`);
    await strikeAt(1);
    await page.waitFor(`window.__battle.stats.turns === 2 && !window.__battle.activeHero || window.__battle.nala.ring`, { timeout: 60000 }).catch(() => {});
    const seen2 = await page.ev(`[...window.__seen]`);
    log(seen2.includes('ECHO STRIKE'), 'b3: "ECHO STRIKE" pops over the striking hero', String(seen2.includes('ECHO STRIKE')));
    // Round 2's enemy phase: the second save (usesLeft was reset at the round start).
    await saveWithNala();
    const save2 = await B(page, `({ used: B.nala.used, left: B.nala.usesLeft, round: B.stats.turns })`);
    log(save2.used && save2.left === 0 && save2.round === 2, 'b3: Nala saves again in round 2 (twice across two rounds)', JSON.stringify(save2));
    await settle({});
    // Round 3: Echo Strike is spent, the cooldown ticks, a tap on Nala does nothing yet.
    const r3 = await B(page, `({ round: B.stats.turns, st: B.heroes.map((h) => Object.keys(h.statuses).length), cd: B.nala.glowCd, counter: B.nala.counter.text, ready: B.nalaGlowReady(), pulse: !!B.nala.readyTween })`);
    log(r3.round === 3 && r3.st.every((n) => n === 0) && r3.cd === 2 && r3.counter === 'Glow in 2' && !r3.ready && !r3.pulse, 'b3: round 3, no Echo Strike left, "Glow in 2", no pulse', JSON.stringify(r3));
    const np3 = await nalaPos();
    await page.tap(np3.x, np3.y);
    await sleep(600);
    const r3b = await B(page, `({ st: B.heroes.map((h) => Object.keys(h.statuses).length), cd: B.nala.glowCd })`);
    log(r3b.st.every((n) => n === 0) && r3b.cd === 2, 'b3: tapping Nala on cooldown does nothing', JSON.stringify(r3b));
    // Ready again: she pulses (teal) and a tap on her during the player's turn calls the glow.
    await B(page, `(B.nala.glowCd = 0, B.nalaRefreshGlow())`);
    await sleep(300);
    const rdy = await B(page, `({ ready: B.nalaGlowReady(), pulse: !!B.nala.readyTween, tint: B.nala.readyGlow.tintTopLeft, alpha: B.nala.readyGlow.alpha, counter: B.nala.counter.text })`);
    log(rdy.ready && rdy.pulse && rdy.counter === 'Glow ready' && rdy.tint === 0x3fd0c9, 'b3: cooldown over, Nala pulses teal and the counter reads "Glow ready"', JSON.stringify(rdy));
    await page.shot(join(out, 'b3_glow_ready.png'));
    await page.tap(np3.x, np3.y);
    await page.waitFor(`window.__battle.heroes.every((h) => h.statuses.echo_strike)`, { timeout: 8000 });
    const re = await B(page, `({ cd: B.nala.glowCd, counter: B.nala.counter.text, menu: !!B.menu.pending, ready: B.nalaGlowReady() })`);
    log(re.cd === 3 && re.counter === 'Glow in 3' && re.menu && !re.ready, 'b3: tapping her on the player turn re-triggers the glow (cooldown 3 again, the menu stays up)', JSON.stringify(re));
    const hpT = await B(page, `B.enemies.map((e) => e.hp)`);
    await page.tap(...slots.strike);
    await page.waitFor(`window.__battle.menu.items.some((i) => i.slot === 'target')`, { timeout: 15000 });
    await B(page, `B.menu.choose(B.enemies[0])`);
    await page.waitFor(`window.__battle.counters.hollowDamageThisRound > 0`, { timeout: 15000 });
    log((await B(page, `B.enemies[0].hp`)) < hpT[0], 'b3: the re-triggered glow lets the Strike wound the Warden', `${hpT[0]} -> ${await B(page, 'B.enemies[0].hp')}`);
    log(!page.errors.length, 'b3: no page errors', JSON.stringify(page.errors.slice(0, 3)));
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
    const prompt = await page.ev(`window.__battle.menu.items.map(i => i.slot)`);
    log(prompt.join() === 'target,target,back', '2 enemies: Strike asks for a target (two cards + Back)', prompt.join(' '));
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

  // ============ F-targeting: the target cards (ui.json target) ============
  if (want('targeting')) {
    // Two Forgotten: a card each (name, HP bar), tapping the SECOND card hits that enemy only.
    let page = await battle(chrome, server, 'b1_forgotten', { extra: '&level=2' });
    await waitMenu(page);
    await page.ev(`window.__battle.tutorialSlow = false`);
    await page.tap(...slots.strike);
    await sleep(500);
    const cards = await page.ev(`window.__battle.menu.items.filter(i => i.slot === 'target').map(i => ({ x: i.x, y: i.y, name: i.label, ex: i.value.container.x }))`);
    log(cards.length === 2 && cards[0].ex < cards[1].ex && cards[0].x < cards[1].x, 'target menu lists 2 enemies left to right', JSON.stringify(cards));
    await page.shot(join(out, 'target_b1_forgotten.png'));
    const hp0 = await page.ev(`window.__battle.enemies.map(e => e.hp)`);
    const order = await page.ev(`window.__battle.menu.items.filter(i => i.slot === 'target').map(i => window.__battle.enemies.indexOf(i.value))`);
    await page.tap(cards[1].x, cards[1].y);
    await sleep(2400);
    const hp1 = await page.ev(`window.__battle.enemies.map(e => e.hp)`);
    const hit = order[1];
    log(hp1[hit] < hp0[hit] && hp1[1 - hit] === hp0[1 - hit], 'tapping the second card hits that enemy only', `${hp0} -> ${hp1}, card 2 = enemy ${hit}`);
    log(page.errors.length === 0, 'no console errors in targeting (enemies)', page.errors.slice(0, 2).join(' | '));

    // Gate: Warden + Hollow. Strike marks the Hollow IMMUNE, a technique does not.
    page = await battle(chrome, server, 'b3_gate', { extra: '&level=3' });
    await waitMenuThroughDialogue(page);
    await page.ev(`window.__battle.tutorialSlow = false`);
    await page.tap(...slots.strike);
    await sleep(500);
    const immune = await page.ev(`window.__battle.menu.items.filter(i => i.slot === 'target').map(i => !!i.value.def.immune?.includes('strike'))`);
    log(immune.length === 2 && immune.every(Boolean), 'gate: both candidates are strike-immune Hollows', immune.join());
    const texts = await page.ev(`(() => { const out = []; const walk = (l) => l.forEach((o) => { if (o.list) walk(o.list); if (o.type === 'Text') out.push(o.text); }); walk(window.__battle.menu.buttons.map(b => b.container)); return out; })()`);
    log(texts.some((t) => /IMMUNE to Strike/.test(t)), 'Strike on a Hollow: card shows "IMMUNE to Strike"', texts.filter((t) => /IMMUNE/.test(t)).join('|'));
    await page.shot(join(out, 'target_b3_gate_strike.png'));
    log(page.errors.length === 0, 'no console errors in targeting (gate)', page.errors.slice(0, 2).join(' | '));

    // Anchor (Dov): the hero cards, driven through pickHero like the real turn does.
    page = await battle(chrome, server, 'b1_forgotten', { extra: '&level=3' });
    await waitMenu(page);
    await page.ev(`(() => { const B = window.__battle; B.tutorialSlow = false; B.hideCommandMenu(); B.activeHero = B.heroes[1]; B.heroes[0].hp = 0; B.heroes[1].hp = 40; B.refreshHud();
      window.__pick = 'pending'; B.pickHero(B.techOf(B.heroes[1], 'anchor')).then((t) => { window.__pick = t ? t.type : null; }); })()`);
    await sleep(500);
    const heroCards = await page.ev(`window.__battle.menu.items.filter(i => i.slot === 'target').map(i => ({ x: i.x, y: i.y, kind: i.kind, id: i.value.type }))`);
    log(heroCards.length === 2 && heroCards.every((c) => c.kind === 'hero'), 'Anchor target menu lists the heroes (the downed one too, Recall 3 revives)', JSON.stringify(heroCards));
    const heroTexts = await page.ev(`(() => { const out = []; const walk = (l) => l.forEach((o) => { if (o.list) walk(o.list); if (o.type === 'Text') out.push(o.text); }); walk(window.__battle.menu.buttons.map(b => b.container)); walk([window.__battle.menu.promptText]); return out; })()`);
    log(heroTexts.includes('DOWNED') && heroTexts.some((t) => /40\/\d+/.test(t)) && heroTexts.includes('Who does Dov anchor?'), 'hero cards show DOWNED, HP numbers and the prompt', heroTexts.join('|'));
    await page.shot(join(out, 'target_anchor_heroes.png'));
    await page.tap(heroCards[0].x, heroCards[0].y);
    await sleep(300);
    log((await page.ev(`window.__pick`)) === 'rhea', 'tapping the first hero card picks that hero (the downed Rhea)');
    // Recall 1: Anchor cannot revive, so the downed hero is no candidate and the only living one is picked without asking.
    await page.ev(`(() => { const B = window.__battle; window.__pick = 'pending'; B.pickHero({ ...B.techOf(B.heroes[1], 'anchor'), canRevive: false }).then((t) => { window.__pick = t ? t.type : null; }); })()`);
    await sleep(300);
    log((await page.ev(`window.__pick`)) === 'dov', 'no revive: the downed hero is no candidate, one valid hero is auto-picked');
    log(page.errors.length === 0, 'no console errors in targeting (anchor)', page.errors.slice(0, 2).join(' | '));
  }

  // ============ F-moves: long-press help cards, move tutorials on the Recall card ============
  if (want('moves')) {
    const hcfg = ui.commands.help;
    const cardUp = (page) => B(page, `!!B.menu.helpCard`);
    const cardTexts = (page) => B(page, `(B.menu.helpCard || []).filter((o) => o.type === 'Text').map((o) => o.text)`);
    const page = await battle(chrome, server, 'b1_forgotten', { extra: '&level=1&pauses=0' });
    await waitMenu(page);
    await page.ev(`window.__battle.tutorialSlow = false`);
    const hp0 = await B(page, `B.enemies.map((e) => e.hp)`);
    // A long press on Strike: the card opens, no Strike; the release closes it.
    await page.move(...slots.strike);
    await page.down(...slots.strike);
    await sleep(hcfg.holdMs + 250);
    const t1 = await cardTexts(page);
    log(t1.includes('Strike') && t1.includes("Free. Builds Echo on hit. Can't touch Hollows."), 'Help: a long press on Strike opens its card (name + short text)', JSON.stringify(t1));
    await page.shot(join(out, 'help_strike.png'));
    await page.up(...slots.strike);
    await sleep(500);
    const a1 = await B(page, `({ pending: !!B.menu.pending, hp: B.enemies.map((e) => e.hp), card: !!B.menu.helpCard, items: B.menu.items.map((i) => i.slot) })`);
    log(a1.pending && JSON.stringify(a1.hp) === JSON.stringify(hp0) && !a1.card && a1.items.includes('strike'), 'Help: the release closes the card and the long press did NOT strike (menu still waiting, enemy HP unchanged)', JSON.stringify(a1));
    // Moving > 10 px cancels the long press (and the tap).
    await page.move(...slots.strike);
    await page.down(...slots.strike);
    await page.move(slots.strike[0] + 30, slots.strike[1]);
    await sleep(hcfg.holdMs + 250);
    log(!(await cardUp(page)), 'Help: a press that moves more than 10 px opens no card');
    await page.up(slots.strike[0] + 30, slots.strike[1]);
    await sleep(400);
    log(await B(page, `!!B.menu.pending && B.menu.items.some((i) => i.slot === 'strike')`), 'Help: ...and that drag is no tap either (nothing struck)');
    // Technique: a long press shows its card and does not open the list; a short tap opens it.
    await page.move(...slots.technique);
    await page.down(...slots.technique);
    await sleep(hcfg.holdMs + 250);
    const t2 = await cardTexts(page);
    log(t2.includes('Technique'), 'Help: Technique has a card too', JSON.stringify(t2));
    await page.up(...slots.technique);
    await sleep(300);
    log(await B(page, `!!B.menu.pending && B.menu.items.some((i) => i.slot === 'technique')`), 'Help: a long press on Technique does not open the list');
    await page.tap(...slots.technique);
    await sleep(500);
    log(await B(page, `B.menu.items.some((i) => i.value === 'blast')`), 'Help: a short tap on Technique opens the list');
    await page.move(...slots.strike);
    await page.down(...slots.strike);
    await sleep(hcfg.holdMs + 250);
    const t3 = await cardTexts(page);
    log(t3.includes('Blast') && t3.some((t) => /^Recall 1: 2 Echo, 2 bolts$/.test(t)) && t3.includes('Bolts of pure memory. Spends Echo.'), "Help: a technique entry shows name, cost, short text and Blast's level line", JSON.stringify(t3));
    await sleep(400);
    await page.shot(join(out, 'help_blast.png'));
    await page.up(...slots.strike);
    await sleep(300);
    log(await B(page, `!!B.menu.pending && B.menu.items.some((i) => i.value === 'blast')`), 'Help: ...and did not cast it');
    await page.tap(...slots.back);
    await sleep(400);
    await page.tap(...slots.strike);
    await sleep(600);
    log(await B(page, `B.menu.items.some((i) => i.slot === 'target')`), 'Help: a short tap on Strike acts (the target cards open)');
    log(page.errors.length === 0, 'Help: no page errors', page.errors.slice(0, 2).join(' | '));

    // Recollection teaser (boss): a card on the disabled button, no action.
    const bp = await battle(chrome, server, 'boss_clerk');
    await waitMenuThroughDialogue(bp);
    await bp.move(...slots.ultimate);
    await bp.down(...slots.ultimate);
    await sleep(hcfg.holdMs + 250);
    const t4 = await cardTexts(bp);
    log(t4.includes('Recollection') && t4.includes('Burn the page. Only this ends him.'), 'Help: the Recollection teaser has its card', JSON.stringify(t4));
    await bp.up(...slots.ultimate);
    await sleep(300);
    log(await B(bp, `!!B.menu.pending && !B.menu.helpCard`), 'Help: releasing the teaser closes the card, menu unchanged');

    // Recall card: b1 from Recall 1 -> Recall 2 (Rhea remembers Return to Sender): the learn pauses.
    const rc = await battle(chrome, server, 'b1_forgotten', { extra: '&level=1&pauses=on' });
    await waitMenu(rc);
    await rc.ev(`(() => { const B = window.__battle; B.tutorialSlow = false; B.recallXp = 40; B.enemies.forEach((e) => { e.hp = 1; }); })()`); // 40 Memories = after the duel
    const seenIds = [];
    for (let i = 0; i < 160 && !seenIds.some((x) => x.startsWith('learn_return_to_sender')); i++) {
      const id = await B(rc, `B.tutorialPause ? B.tutorialPause.id + ':' + B.tutorialPause.step + '/' + B.tutorialPause.steps : null`);
      if (id && !seenIds.includes(id) && id.startsWith('learn_')) {
        seenIds.push(id);
        await sleep(500);
        await rc.shot(join(out, 'learn_' + id.replace(/\W+/g, '_') + '.png'));
      }
      if (id) await rc.tap(180, 600);
      else if ((await rc.scenes()).includes('Dialogue')) await rc.tap(180, 560);
      else if (await B(rc, `B.battleOver`)) await rc.tap(180, 560);
      else {
        const tg = await B(rc, `B.menu.items.find((i) => i.slot === 'target') ? [B.menu.items.find((i) => i.slot === 'target').x, B.menu.items.find((i) => i.slot === 'target').y] : null`);
        if (tg) await rc.tap(...tg);
        else if (await B(rc, `!!B.menu.pending && B.menu.items.some((i) => i.slot === 'strike')`)) await rc.tap(...slots.strike);
      }
      await sleep(350);
    }
    log(seenIds.includes('learn_return_to_sender:0/2'), 'Recall: the Recall card runs the learn_return_to_sender pause (2 steps)', JSON.stringify(seenIds));
    log(rc.errors.length === 0, 'Recall: no page errors', rc.errors.slice(0, 2).join(' | '));

    // Tremor: Recall 1 = cost 3, one chosen enemy (a Hollow takes it); Recall 2+ = cost 4, every enemy.
    const tr = await battle(chrome, server, 'b2_first_hollow', { extra: '&level=1&pauses=0' });
    await waitMenuThroughDialogue(tr);
    for (const [lv, cost, target] of [[1, 3, 'enemy'], [2, 4, 'all']]) {
      const r = await tr.ev(`(async () => { const B = window.__battle; B.hideCommandMenu(); const dov = B.heroes[1]; dov.level = ${lv}; const t = B.techOf(dov, 'tremor'); B.enemies.forEach((e) => { e.hp = e.maxHp; }); const before = B.enemies.map((e) => e.hp); await B.runTechnique(dov, 'tremor', B.enemies[1]); await new Promise((r) => setTimeout(r, 300)); return { cost: t.cost, target: t.target, before, after: B.enemies.map((e) => e.hp), hollow: B.enemies[1].type }; })()`);
      const hit = r.after.map((h, i) => h < r.before[i]);
      log(r.cost === cost && r.target === target && hit[1] && (target === 'all' ? hit[0] : !hit[0]), `Tremor at Recall ${lv}: cost ${cost}, ${target === 'all' ? 'hits every enemy' : 'hits only the chosen enemy (a Hollow takes it)'}`, JSON.stringify(r));
    }
    log(tr.errors.length === 0, 'Tremor: no page errors', tr.errors.slice(0, 2).join(' | '));
  }
});

const bad = rows.filter((r) => !r.ok);
console.log(`\nbattle lab: ${rows.length - bad.length}/${rows.length} ok`);
process.exit(bad.length ? 1 : 0);
