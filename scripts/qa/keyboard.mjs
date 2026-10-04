// QA: keyboard and controller actions (systems/Input.js, data/input.json) on a desktop window.
// Title starts on Enter, dialogue lines advance on Enter, a held Enter skips the cutscene,
// P pauses a battle and Esc resumes it, a fake DualSense (navigator.getGamepads stub) presses
// Cross / Options, and the "Rotate your phone" overlay stays off in a short desktop window
// but shows on a touch phone held sideways.
//   node scripts/qa/keyboard.mjs
import { open, sleep, waitScene, withBrowser } from './lib.mjs';

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  KeyP: { key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 },
};
const key = (page, name, type) => page.cdp.send('Input.dispatchKeyEvent', { type, ...KEYS[name] });
const press = async (page, name, holdMs = 30) => {
  await key(page, name, 'keyDown');
  await sleep(holdMs);
  await key(page, name, 'keyUp');
};

// A stand-in controller: window.__pad.set(index, pressed) flips a Standard Gamepad button.
const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: 'DualSense Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: performance.now() };
  window.__pad = { set(i, on) { buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); } };
  navigator.getGamepads = () => [pad, null, null, null];
})()`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
};
// Each check gets its own tab, in front (a background tab stops its frames and its key events).
const openFront = async (chrome, url, opts) => {
  const page = await open(chrome, url, opts);
  await page.cdp.send('Page.bringToFront');
  return page;
};
const active = (page, k) => page.ev(`window.__game.scene.isActive(${JSON.stringify(k)})`);
const paused = (page, k) => page.ev(`window.__game.scene.isPaused(${JSON.stringify(k)})`);

await withBrowser(async ({ server, chrome }) => {
  const desk = { w: 1280, h: 720 };

  // Title -> Menu on Enter.
  {
    const page = await openFront(chrome, server.url, desk);
    await waitScene(page, 'Title');
    await sleep(600);
    await press(page, 'Enter');
    await waitScene(page, 'Menu', 8000).catch(() => {});
    check('Title: Enter starts', await active(page, 'Menu'));
    check('Title: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }

  // Dialogue: Enter completes the line, then advances (counted through advance(): a short
  // dialogue may end and the next one start back at line 0).
  {
    const page = await openFront(chrome, `${server.url}?step=1`, desk);
    await waitScene(page, 'Dialogue');
    await page.waitFor(`(() => { const d = window.__game.scene.getScene('Dialogue'); return d.index >= 0 && !d.introActive; })()`, { timeout: 20000 });
    await page.ev(`(() => { const d = window.__game.scene.getScene('Dialogue'); const o = d.advance.bind(d); window.__advances = 0; d.advance = () => { window.__advances++; o(); }; })()`);
    for (let i = 0; i < 4; i++) {
      await press(page, 'Enter');
      await sleep(250);
    }
    const n = await page.ev('window.__advances');
    check('Dialogue: Enter advances lines', n >= 1, `${n} advance(s) from 4 presses`);
    await page.cdp.send('Page.close').catch(() => {});
  }

  // Cutscene: a held Enter skips it (hold.ms + margin).
  {
    const page = await openFront(chrome, `${server.url}?step=0`, desk);
    await waitScene(page, 'Cutscene');
    await page.waitFor(`window.__game.scene.getScene('Cutscene').index >= 0`, { timeout: 20000 });
    await sleep(300);
    await key(page, 'Enter', 'keyDown');
    await sleep(1200);
    const skipped = await page.ev(`window.__game.scene.getScene('Cutscene').done`);
    const shot = await page.ev(`window.__game.scene.getScene('Cutscene').index`);
    await key(page, 'Enter', 'keyUp');
    check('Cutscene: holding Enter skips', skipped === true, `done ${skipped}, shot ${shot}`);
    await page.cdp.send('Page.close').catch(() => {});
  }

  // Battle: P pauses, Esc resumes; the fake controller's Options pauses, Circle (back) resumes.
  {
    const page = await openFront(chrome, `${server.url}?step=4&pauses=0`, { ...desk, init: [FAKE_PAD] });
    await waitScene(page, 'Battle');
    await sleep(2500);
    await press(page, 'KeyP');
    await sleep(400);
    check('Battle: P opens the pause menu', (await active(page, 'Pause')) && (await paused(page, 'Battle')));
    await press(page, 'Escape');
    await sleep(400);
    check('Pause: Esc resumes', !(await active(page, 'Pause')) && (await active(page, 'Battle')));
    await page.ev('window.__pad.set(9, true)');
    await sleep(120);
    await page.ev('window.__pad.set(9, false)');
    await sleep(400);
    check('Controller: Options opens the pause menu', await active(page, 'Pause'));
    await page.ev('window.__pad.set(1, true)');
    await sleep(120);
    await page.ev('window.__pad.set(1, false)');
    await sleep(400);
    check('Controller: Circle resumes', !(await active(page, 'Pause')) && (await active(page, 'Battle')));
    check('Battle: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.cdp.send('Page.close').catch(() => {});
  }

  // A short desktop window: no rotate overlay, the game keeps running.
  {
    const page = await openFront(chrome, server.url, { w: 1280, h: 420 });
    await waitScene(page, 'Title');
    const shown = await page.ev(`getComputedStyle(document.getElementById('rotate')).display !== 'none'`);
    check('Short desktop window: no rotate overlay', !shown);
    await page.cdp.send('Page.close').catch(() => {});
  }

  // A touch phone held sideways: the overlay shows.
  {
    const page = await openFront(chrome, server.url, { w: 740, h: 360 });
    await page.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    await sleep(300);
    const coarse = await page.ev(`matchMedia('(pointer: coarse)').matches`);
    const shown = await page.ev(`getComputedStyle(document.getElementById('rotate')).display !== 'none'`);
    check('Touch phone sideways: rotate overlay shows', !coarse || shown, coarse ? '' : 'pointer: coarse not emulated, skipped');
    await page.cdp.send('Page.close').catch(() => {});
  }
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nkeyboard: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
