// QA: the game on a controller only (systems/Input.js, Focus.js; data/input.json), through a stand-in
// DualSense (navigator.getGamepads stub, Standard layout). No taps or clicks anywhere.
//   A  Title -> Menu (Cross), d-pad to Settings, Circle back, New Game -> difficulty -> cutscene.
//   B  b1: Square strikes, the d-pad picks between the two enemies, Cross confirms; R2 opens the
//      technique list and Circle backs out of it.
//   C  b1: Cross at the ring's impact is a PERFECT parry; Circle at impact is a PERFECT dodge.
//   I  b2: □ / R2 on Strike / Technique, ○ on Back, Options by the pause button; Nala's △ dim on the
//      player's turn, lit during a Hollow's telegraph and when the Glow is ready, dim once her save is
//      spent; a disabled command's button dim; every badge hidden after a touch.
//   D  Quill: the Recollection on buttons (hold Cross, press the arrow's way, mash Square) -> Quill dies.
//   node scripts/qa/controller.mjs
import { open, sleep, waitScene, withBrowser } from './lib.mjs';

const BTN = { cross: 0, circle: 1, square: 2, triangle: 3, r1: 5, r2: 7, options: 9, up: 12, down: 13, left: 14, right: 15 };

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
        const p = B.ringPromptLive;
        const snap = { actions: p ? p.items.map((i) => i.action) : null, dim: p ? +p.items[0].alpha.toFixed(2) : null, hint: B.tapHint.text };
        r.promise.then((o) => window.__qte.push({ result: o.result, input: o.input, dt: Math.round(o.dtMs ?? -1), red: !!r.unparryable, button, prompt: snap }));
        setTimeout(() => {
          snap.lit = p ? +p.items[0].alpha.toFixed(2) : null;
          window.__pad.tap(button, 150);
        }, Math.max(0, r.impactAt - performance.now()));
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
    const titleText = await page.ev(`window.__game.scene.getScene('Title').tapText.text`);
    check('A: the Title asks for the controller button', titleText.includes('✕'), titleText);
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

  // ---------- G: Settings > Controls: rebind Parry / Confirm to R1, then Reset with R1 ----------
  {
    const page = await openFront(chrome, server.url, desk);
    await waitScene(page, 'Title');
    await sleep(600);
    await tap(page, 'cross');
    await waitScene(page, 'Menu', 8000).catch(() => {});
    await sleep(1800);
    for (let i = 0; i < 3; i++) await tap(page, 'down');
    await tap(page, 'cross');
    await waitScene(page, 'Settings', 5000).catch(() => {});
    await sleep(500);
    for (let i = 0; i < 5; i++) await tap(page, 'down');
    await tap(page, 'cross');
    await waitScene(page, 'Controls', 5000).catch(() => {});
    check('G: Settings > Controls opens the Controls screen', await active(page, 'Controls'));
    await sleep(500);
    const C = `window.__game.scene.getScene('Controls')`;
    check('G: it opens on the controller rows', (await page.ev(`${C}.device`)) === 'gamepad');
    // Focus the first row (Parry / Confirm): down from the device button, then left if needed.
    await tap(page, 'down');
    if (!(await page.ev(`${C}.__focus.current === ${C}.rowButtons[0].focus`))) await tap(page, 'left');
    check('G: the d-pad reaches the Parry / Confirm row', await page.ev(`${C}.__focus.current === ${C}.rowButtons[0].focus`));
    await tap(page, 'cross');
    await sleep(200);
    check('G: Cross starts waiting for a button', await page.ev(`!!${C}.capturing`));
    await tap(page, 'r1');
    await sleep(200);
    const b1 = await page.ev(`JSON.stringify({ parry: window.__input.getBindings().gamepad.parry, confirm: window.__input.getBindings().gamepad.confirm })`);
    check('G: R1 is now Parry and Confirm', b1 === JSON.stringify({ parry: [5], confirm: [5] }), b1);
    const saved = await page.ev(`(() => { try { return JSON.parse(localStorage.getItem('unremembered:settings')).bindings.gamepad.parry; } catch (e) { return null; } })()`);
    check('G: the binding is saved', JSON.stringify(saved) === '[5]', JSON.stringify(saved));
    // Down to the bottom row, left to Reset, and press it with the new confirm (R1).
    for (let i = 0; i < 6 && !(await page.ev(`${C}.__focus.current === ${C}.resetButton.focus`)); i++) await tap(page, i < 3 ? 'down' : 'left');
    check('G: the d-pad reaches Reset', await page.ev(`${C}.__focus.current === ${C}.resetButton.focus`));
    await tap(page, 'r1');
    await sleep(400);
    const b2 = await page.ev(`JSON.stringify(window.__input.getBindings().gamepad.parry)`);
    check('G: R1 on Reset restores Cross', b2 === '[0]', b2);
    await tap(page, 'circle');
    await waitScene(page, 'Settings', 5000).catch(() => {});
    check('G: Circle goes back to Settings', await active(page, 'Settings'));
    check('G: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }

  // ---------- H: the Arena on the controller ----------
  {
    const page = await openFront(chrome, server.url, desk);
    const T = `window.__game.scene.getScene('ArenaTeam')`;
    await waitScene(page, 'Title');
    await sleep(600);
    await tap(page, 'cross');
    await waitScene(page, 'Menu', 8000).catch(() => {});
    await sleep(1800);
    for (let i = 0; i < 2; i++) await tap(page, 'down');
    await tap(page, 'cross');
    await waitScene(page, 'ArenaTeam', 8000).catch(() => {});
    check('H: Menu > Arena with the d-pad + Cross', await active(page, 'ArenaTeam'));
    await page.waitFor(`!!${T}.cards`, { timeout: 20000 });
    await sleep(600);
    // The first card (Rhea) is focused first: Cross, down, Cross (Dov), down, Cross (Nala).
    await tap(page, 'cross');
    await tap(page, 'down');
    await tap(page, 'cross');
    await tap(page, 'down');
    await tap(page, 'cross');
    const team = await page.ev(`JSON.stringify({ heroes: ${T}.heroes, support: ${T}.support, ready: ${T}.ready() })`);
    check('H: Cross on the cards picks Rhea, Dov and Nala', team === JSON.stringify({ heroes: ['rhea', 'dov'], support: 'nala', ready: true }), team);
    // Down to the bottom row (Begin), then Cross.
    for (let i = 0; i < 4 && !(await page.ev(`${T}.__focus.current === ${T}.begin.focus`)); i++) await tap(page, 'down');
    check('H: the d-pad reaches Begin', await page.ev(`${T}.__focus.current === ${T}.begin.focus`));
    await tap(page, 'cross');
    await page.waitFor(`!!(window.__battle && window.__battle.arena && window.__battle.arena.fight === 1)`, { timeout: 20000 }).catch(() => {});
    check('H: Begin starts Arena fight 1', await page.ev(`!!(window.__battle && window.__battle.arena && window.__battle.arena.fight === 1)`));
    // Square strikes in the Arena too (with several enemies, Cross confirms the target).
    check('H: the command menu comes up', await waitMenu(page));
    await sleep(600);
    await tap(page, 'square');
    if ((await menuValues(page)).some((v) => v.startsWith('target:'))) await tap(page, 'cross');
    await sleep(400);
    check('H: Square = Strike in the Arena', !(await menuPending(page)));
    // Win the fight (as scripts/qa/arena.mjs does), then the level card and the buff with the pad.
    await sleep(2500);
    await page.ev(`(() => { const b = window.__battle; b.enemies.forEach((e) => { if (e.hp > 0) b.killEnemy(e); }); b.onBattleEnd('WIN'); })()`);
    for (let t = 0; t < 40 && (await active(page, 'Battle')); t++) await tap(page, 'cross');
    await waitScene(page, 'Reward', 15000).catch(() => {});
    check('H: Cross passes the result and level cards to the buff pick', await active(page, 'Reward'));
    await sleep(800);
    await tap(page, 'down');
    await tap(page, 'cross');
    await page.waitFor(`!!(window.__battle && window.__battle.arena && window.__battle.arena.fight === 2)`, { timeout: 20000 }).catch(() => {});
    check('H: the d-pad + Cross picks a buff and fight 2 starts', await page.ev(`!!(window.__battle && window.__battle.arena && window.__battle.arena.fight === 2)`));
    check('H: no page errors', page.errors.length === 0, page.errors.join(' | '));
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
    const w = white[0]?.prompt;
    check('E: a white ring shows ✕ and ○ beside the hero, dim, then lit at the close', !!w && w.actions?.join(',') === 'parry,dodge' && w.dim < 0.5 && w.lit === 1, JSON.stringify(w));
    check('E: the hint names the buttons', !!w && w.hint.includes('✕') && w.hint.includes('○'), w?.hint);
    const rp = red[0]?.prompt;
    if (rp) check('E: a red ring shows only ○', rp.actions?.join(',') === 'dodge' && rp.hint.includes('○'), JSON.stringify(rp));
    const dodged = await attack(BTN.circle);
    check('C: Circle at impact dodges PERFECT', dodged.length > 0 && dodged.every((o) => o.result === 'PERFECT' && o.input === 'swipe'), JSON.stringify(dodged));
    await page.ev('window.__ringButton = null');
    check('B/C: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }

  // ---------- I: the buttons on the battle UI (b2: Forgotten + Hollow, Nala) ----------
  {
    const page = await openFront(chrome, `${server.url}?battle=b2_first_hollow&pauses=0`, desk);
    const B = 'window.__battle';
    check('I: the command menu comes up', await waitMenu(page));
    await sleep(600);
    const badges = () => page.ev(`JSON.stringify(${B}.menu.buttons.map((b) => b.badge ? { a: b.badge.action, v: b.badge.visible, al: +b.badge.alpha.toFixed(2) } : null))`).then(JSON.parse);
    const main = await badges();
    check('I: □ on Strike and R2 on Technique, lit', JSON.stringify(main) === JSON.stringify([{ a: 'strike', v: true, al: 1 }, { a: 'technique', v: true, al: 1 }]), JSON.stringify(main));
    const pause = await page.ev(`(() => { const c = ${B}.children.list.find((o) => o.depth === 3000 && o.list); const b = c && c.list[2]; return b ? b.visible && b.list.length === 1 : false; })()`);
    check('I: the pause button shows its button', pause);
    await tap(page, 'r2');
    await sleep(300);
    const list = await badges();
    check('I: ○ on the technique list Back', list[list.length - 1]?.a === 'back' && list[list.length - 1].v && list.slice(0, -1).every((b) => b === null), JSON.stringify(list));
    await tap(page, 'circle');
    await sleep(300);
    const nala = () => page.ev(`JSON.stringify({ state: ${B}.nala.badge.state, alpha: +${B}.nala.badge.container.alpha.toFixed(2), visible: ${B}.nala.badge.container.visible, used: ${B}.nala.used })`).then(JSON.parse);
    const idle = await nala();
    check("I: Nala's △ is shown, dim, on the player's turn", idle.visible && idle.state === null && idle.alpha < 0.5, JSON.stringify(idle));
    await page.ev(`(() => { const n = ${B}.nala; n.glowOn = true; n.glowCd = 0; ${B}.nalaRefreshGlow(); })()`);
    await sleep(200);
    const glow = await nala();
    check("I: Nala's △ is lit when the Glow is ready", glow.state === 'glow' && glow.alpha === 1, JSON.stringify(glow));
    await page.ev(`(() => { const b = ${B}; b.nala.glowOn = false; b.nalaRefreshGlow(); b.hideCommandMenu(); b.tutorialSlow = false; window.__done = false; b.enemyTurn(b.enemies.find((e) => e.def.hollow)).then(() => { window.__done = true; }); })()`);
    await page.waitFor(`!!${B}.nala.ring`, { timeout: 8000 }).catch(() => {});
    const save = await nala();
    check("I: Nala's △ is lit while a Hollow winds up", save.state === 'save' && save.alpha === 1, JSON.stringify(save));
    await tap(page, 'triangle');
    await sleep(300);
    const spent = await nala();
    check("I: △ makes Nala hiss, then her △ is dim (save spent)", spent.used && spent.state === null && spent.alpha < 0.5, JSON.stringify(spent));
    const until = Date.now() + 10000;
    while (Date.now() < until && !(await page.ev('window.__done'))) await sleep(100);
    // A disabled command: its button is dim (the menu is drawn on its own here, outside the battle loop).
    await page.ev(`${B}.menu.show([{ slot: 'strike', label: 'Strike', value: 'strike' }, { slot: 'technique', label: 'Technique', value: 'technique', enabled: false }])`);
    await sleep(200);
    const off = await badges();
    check('I: a disabled Technique shows R2 dim', off[1]?.a === 'technique' && off[1].al < 0.5 && off[0].al === 1, JSON.stringify(off));
    // The pad unplugged and a touch on the screen: the player is on touch now, every badge hides.
    await page.ev('navigator.getGamepads = () => [null, null, null, null]');
    await page.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 300 }] });
    await page.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    const touch = await page.ev(`JSON.stringify({ menu: ${B}.menu.buttons.map((b) => b.badge && b.badge.visible), nala: ${B}.nala.badge.container.visible })`).then(JSON.parse);
    check('I: after a touch no button is shown', touch.menu.every((v) => !v) && !touch.nala, JSON.stringify(touch));
    check('I: no page errors', page.errors.length === 0, page.errors.join(' | '));
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
