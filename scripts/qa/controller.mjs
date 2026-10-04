// QA: the game on a controller only (systems/Input.js, Focus.js; data/input.json), through a stand-in
// DualSense (navigator.getGamepads stub, Standard layout). No taps or clicks anywhere.
//   A  Title -> Menu (Cross), d-pad to Settings, Circle back, New Game -> difficulty -> cutscene.
//   B  b1: Square strikes, the d-pad picks between the two enemies, Cross confirms; R2 opens the
//      technique list and Circle backs out of it.
//   C  b1: Cross at the ring's impact is a PERFECT parry; Circle at impact is a PERFECT dodge.
//   D  Quill: the Recollection on buttons (hold Cross, press the arrow's way, mash Square) -> Quill dies.
//   node scripts/qa/controller.mjs
import { open, sleep, waitScene, withBrowser } from './lib.mjs';

const BTN = { cross: 0, circle: 1, square: 2, triangle: 3, r2: 7, options: 9, up: 12, down: 13, left: 14, right: 15 };

// window.__pad.set(i, on) / tap(i, ms): flips a button; the game polls the pad once per frame and takes
// the press time from pad.timestamp (set here, at the flip).
const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: 'DualSense Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: performance.now() };
  const set = (i, on) => { buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); };
  window.__pad = { set, tap(i, ms = 60) { set(i, true); setTimeout(() => set(i, false), ms); } };
  navigator.getGamepads = () => [pad, null, null, null];
})()`;

// In-page drivers: answer every new QTE ring with one button at its impact time, and play the
// Recollection beats with buttons. Results land in window.__qte / window.__beatsPlayed.
const DRIVERS = `(() => {
  window.__qte = [];
  window.__ringButton = null;
  const seen = new WeakSet();
  const loop = () => {
    const B = window.__battle;
    if (B && window.__ringButton !== null) {
      for (const r of B.qteRings || []) {
        if (seen.has(r)) continue;
        seen.add(r);
        // A red ring can't be parried: it always gets Circle (dodge).
        const button = r.unparryable ? 1 : window.__ringButton;
        r.promise.then((o) => window.__qte.push({ result: o.result, input: o.input, dt: Math.round(o.dtMs ?? -1), red: !!r.unparryable, button }));
        setTimeout(() => window.__pad.tap(button, 150), Math.max(0, r.impactAt - performance.now()));
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.__beatsPlayed = [];
  const DIR = { up: 12, down: 13, left: 14, right: 15 };
  let last = null;
  const beats = () => {
    const b = window.__battle && window.__battle.recollectionBeat;
    if (b && b.index !== last && !b.forced) {
      last = b.index;
      window.__beatsPlayed.push(b.kind);
      if (b.kind === 'hold') {
        setTimeout(() => {
          window.__pad.set(0, true);
          setTimeout(() => window.__pad.set(0, false), b.centreMs);
        }, 200);
      } else if (b.kind === 'swipe') {
        setTimeout(() => window.__pad.tap(DIR[b.dir]), 120);
      } else if (b.kind === 'taps') {
        // Each press is held until the game counted it (a headless frame can be slower than a thumb).
        let n = 0;
        const step = () => {
          if (n >= b.taps || window.__battle.recollectionBeat !== b) return;
          n += 1;
          window.__pad.set(2, true);
          const t0 = performance.now();
          const wait = () => {
            if (b.count >= n || performance.now() - t0 > 200) {
              window.__pad.set(2, false);
              requestAnimationFrame(() => requestAnimationFrame(step));
            } else requestAnimationFrame(wait);
          };
          requestAnimationFrame(wait);
        };
        setTimeout(step, 150);
      }
    }
    requestAnimationFrame(beats);
  };
  requestAnimationFrame(beats);
})()`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
};
const openFront = async (chrome, url, opts) => {
  const page = await open(chrome, url, opts);
  await page.cdp.send('Page.bringToFront');
  return page;
};
const tap = async (page, name, ms = 150) => {
  await page.ev(`window.__pad.tap(${BTN[name]}, ${ms})`);
  await sleep(ms + 120);
};
const active = (page, k) => page.ev(`window.__game.scene.isActive(${JSON.stringify(k)})`);
const menuPending = (page) => page.ev(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`);
const menuValues = (page) => page.ev(`(window.__battle.menu.items || []).map((i) => i.slot + ':' + (i.value && i.value.name ? i.value.name : i.value))`);
const waitMenu = async (page, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await menuPending(page)) return true;
    if (await active(page, 'Dialogue')) await tap(page, 'cross');
    await sleep(150);
  }
  return false;
};

await withBrowser(async ({ server, chrome }) => {
  const desk = { w: 1280, h: 720, init: [FAKE_PAD, DRIVERS] };

  // ---------- A: menus ----------
  {
    const page = await openFront(chrome, server.url, desk);
    await waitScene(page, 'Title');
    await sleep(600);
    await tap(page, 'cross');
    await waitScene(page, 'Menu', 8000).catch(() => {});
    check('A: Cross on the Title opens the Menu', await active(page, 'Menu'));
    await sleep(1800); // the buttons slide in
    for (let i = 0; i < 3; i++) await tap(page, 'down');
    await tap(page, 'cross');
    await waitScene(page, 'Settings', 5000).catch(() => {});
    check('A: d-pad down x3 + Cross opens Settings', await active(page, 'Settings'));
    await sleep(500);
    await tap(page, 'circle');
    await waitScene(page, 'Menu', 5000).catch(() => {});
    check('A: Circle in Settings goes back to the Menu', await active(page, 'Menu'));
    await sleep(1800);
    await tap(page, 'cross'); // New Game (focused first)
    await sleep(500);
    const panel = await page.ev(`!!window.__game.scene.getScene('Menu').panel`);
    check('A: Cross on New Game opens the difficulty panel', panel);
    await tap(page, 'circle');
    await sleep(300);
    check('A: Circle closes the difficulty panel', !(await page.ev(`!!window.__game.scene.getScene('Menu').panel`)));
    await tap(page, 'cross');
    await sleep(500);
    await tap(page, 'cross'); // the current difficulty (Normal) is focused first
    await waitScene(page, 'Cutscene', 10000).catch(() => {});
    check('A: Cross picks the difficulty and the chapter starts', await active(page, 'Cutscene'));
    check('A: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }

  // ---------- B + C: battle commands and the parry ring (b1: two Forgotten) ----------
  {
    const page = await openFront(chrome, `${server.url}?battle=b1_forgotten&pauses=0`, desk);
    check('B: the first command menu comes up', await waitMenu(page));
    await sleep(600);
    const hits0 = await page.ev('window.__battle.counters.playerHits');
    await tap(page, 'square');
    await sleep(300);
    const targets = await menuValues(page);
    check('B: Square = Strike opens the target cards', targets.some((v) => v.startsWith('target:')), targets.join(', '));
    await tap(page, 'right');
    await tap(page, 'cross');
    const end = Date.now() + 8000;
    while (Date.now() < end && (await page.ev('window.__battle.counters.playerHits')) === hits0) await sleep(100);
    check('B: d-pad + Cross picks a target and the Strike lands', (await page.ev('window.__battle.counters.playerHits')) > hits0);

    check('B: the next hero menu comes up', await waitMenu(page));
    await sleep(600);
    await tap(page, 'r2');
    await sleep(300);
    const list = await menuValues(page);
    check('B: R2 = Technique opens the technique list', list.includes('back:null') && !list.some((v) => v.startsWith('strike:strike')), list.join(', '));
    await tap(page, 'circle');
    await sleep(300);
    const main = await menuValues(page);
    check('B: Circle backs out to the main menu', main.some((v) => v === 'strike:strike'), main.join(', '));

    // C: enemy attacks on demand, answered at impact: white rings with Cross (parry), red ones with
    // Circle (dodge, the only answer there). Then one attack answered with Circle everywhere.
    const attack = async (button) => {
      await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__qte.length = 0; window.__ringButton = ${button}; window.__done = false; B.enemyTurn(B.enemies.find((e) => e.hp > 0)).then(() => { window.__done = true; }); })()`);
      const until = Date.now() + 12000;
      while (Date.now() < until && !(await page.ev('window.__done'))) await sleep(100);
      await sleep(800);
      return page.ev('window.__qte');
    };
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; })()`);
    const crossed = [];
    for (let i = 0; i < 6 && !crossed.some((o) => !o.red); i++) crossed.push(...(await attack(BTN.cross)));
    const white = crossed.filter((o) => !o.red);
    check('C: Cross at impact parries a white ring PERFECT', white.length > 0 && white.every((o) => o.result === 'PERFECT' && o.input === 'tap'), JSON.stringify(crossed));
    const red = crossed.filter((o) => o.red);
    if (red.length) check('C: Circle at impact dodges a red ring PERFECT', red.every((o) => o.result === 'PERFECT' && o.input === 'swipe'), JSON.stringify(red));
    const dodged = await attack(BTN.circle);
    check('C: Circle at impact dodges PERFECT', dodged.length > 0 && dodged.every((o) => o.result === 'PERFECT' && o.input === 'swipe'), JSON.stringify(dodged));
    await page.ev('window.__ringButton = null');
    check('B/C: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }

  // ---------- D: the Recollection on buttons ----------
  {
    const page = await openFront(chrome, `${server.url}?battle=boss_clerk&level=4&echo=10&pauses=0&recollection=1`, desk);
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await page.ev('window.__ringButton = 0'); // parry whatever Quill throws meanwhile
    const end = Date.now() + 90000;
    let beatsStarted = false;
    while (Date.now() < end) {
      const st = await page.ev(`({ beats: window.__beatsPlayed.length, over: window.__battle.battleOver, grade: window.__battle.stats.recollectionGrade || null })`);
      if (st.beats) beatsStarted = true;
      if (st.grade || st.over) break;
      if (!beatsStarted && (await menuPending(page))) {
        await page.ev('window.__battle.heroes.forEach((h) => { h.hp = h.maxHp; }); window.__battle.refreshHud();');
        await sleep(400);
        await tap(page, 'square');
      } else if (await active(page, 'Dialogue')) await tap(page, 'cross');
      await sleep(150);
    }
    await sleep(1500);
    const fin = await page.ev(`({ played: window.__beatsPlayed, grade: window.__battle.stats.recollectionGrade || null, hp: window.__battle.enemies[0].hp })`);
    check('D: all three beats came up', fin.played.join(',') === 'hold,swipe,taps', fin.played.join(','));
    check('D: hold Cross, the d-pad, mash Square: FLAWLESS or CLEAN', fin.grade === 'FLAWLESS' || fin.grade === 'CLEAN', `grade ${fin.grade}, Quill HP ${fin.hp}`);
    check('D: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\ncontroller: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
