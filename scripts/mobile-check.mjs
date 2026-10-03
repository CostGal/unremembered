// npm run mobile-check — the automatable part of the CLAUDE.md mobile test
// checklist, on emulated phones (touch, mobile viewport, Instagram-sized
// screens with its toolbars). Real phones are still needed for: the Instagram
// in-app browser itself, the iOS silent switch, how PERFECT feels, real FPS.
//
// Per device: Title fits and shows the silent-mode hint, CSS/gesture guards,
// touch tap on Title opens the Menu, tap targets (>= 56 px tall, >= 16 px
// from the edges), app switch mid-battle pauses and resumes with state intact,
// landscape shows the overlay and pauses, portrait hides it again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright, root, setHidden, sleep, startServer } from './lib/harness.mjs';

const DEVICES = {
  // Viewport = the screen minus Instagram's in-app browser bars (approx.).
  'iPhone 13 (Instagram)': { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0' },
  'iPhone SE (Instagram)': { viewport: { width: 375, height: 548 }, deviceScaleFactor: 2, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0' },
  'Pixel 5 (Instagram)': { viewport: { width: 393, height: 727 }, deviceScaleFactor: 2.75, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 Instagram 340.0.0' },
};
const slots = JSON.parse(readFileSync(join(root, 'src/data/ui.json'), 'utf8')).commands.slots;
const STRIKE_SLOT = slots.strike;
const BACK_SLOT = slots.back;
const MIN_H = 56;
const EDGE = 16;

const results = [];
const check = (device, name, ok, detail = '') => results.push({ device, name, ok, detail });

// Game coordinates (360×640) -> page coordinates, through the scaled canvas.
async function toPage(page, x, y) {
  const r = await page.evaluate(() => {
    const b = document.querySelector('canvas').getBoundingClientRect();
    return { left: b.left, top: b.top, w: b.width, h: b.height };
  });
  return [r.left + (x * r.w) / 360, r.top + (y * r.h) / 640];
}

const activeScenes = (page) => page.evaluate(() => window.__game.scene.getScenes(true).map((s) => s.scene.key));

async function waitScene(page, key, timeout = 20000) {
  await page.waitForFunction((k) => window.__game?.scene.isActive(k), key, { timeout });
}

// Interactive objects in a scene (buttons, sprites), in game coordinates.
function targets(page, sceneKey) {
  return page.evaluate((key) => {
    const scene = window.__game.scene.getScene(key);
    const out = [];
    const walk = (list) => {
      for (const o of list) {
        if (o.list) walk(o.list);
        if (o.input?.enabled && o.visible !== false && o.getBounds) {
          // Measured at rest: a pulsing button (hint) is scaled by its container.
          const b = o.getBounds();
          const s = o.parentContainer?.scaleX || 1;
          const w = b.width / s;
          const h = b.height / s;
          out.push({ type: o.type, key: o.texture?.key, x: b.centerX - w / 2, y: b.centerY - h / 2, w, h });
        }
      }
    };
    walk(scene.children.list);
    return out;
  }, sceneKey);
}

function checkTargets(device, label, list, { buttonsOnly = true } = {}) {
  const buttons = buttonsOnly ? list.filter((t) => t.type === 'Rectangle') : list;
  const r = Math.round;
  const bad = buttons.filter((t) => r(t.h) < MIN_H || r(t.x) < EDGE || r(t.x + t.w) > 360 - EDGE);
  check(device, `${label}: ${buttons.length} buttons >= ${MIN_H}px tall, >= ${EDGE}px from edges`, buttons.length > 0 && bad.length === 0, bad.map((t) => `${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.w)}x${Math.round(t.h)}`).join('; '));
}

async function runDevice(browser, url, name, d) {
  const context = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: d.ua });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Title
  await page.goto(url);
  await waitScene(page, 'Title');
  await sleep(600);
  const fit = await page.evaluate(() => {
    const b = document.querySelector('canvas').getBoundingClientRect();
    return { ok: b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5, w: Math.round(b.width), h: Math.round(b.height) };
  });
  check(name, `whole game visible (canvas ${fit.w}x${fit.h} in ${d.viewport.width}x${d.viewport.height})`, fit.ok);
  const silent = await page.evaluate(() => window.__game.scene.getScene('Title').children.list.some((o) => o.type === 'Text' && /silent mode/i.test(o.text) && o.visible));
  check(name, 'Title shows the silent-mode hint', silent);

  const guards = await page.evaluate(() => {
    const els = [document.documentElement, document.body, document.querySelector('canvas')];
    const css = els.every((el) => getComputedStyle(el).touchAction === 'none' && ['none'].includes(getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect));
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('canvas').dispatchEvent(ev);
    const meta = document.querySelector('meta[name=viewport]').content;
    return { css, menuBlocked: ev.defaultPrevented, noZoom: /user-scalable=no/.test(meta) && /maximum-scale=1/.test(meta) };
  });
  check(name, 'touch-action/user-select none on html, body, canvas', guards.css);
  check(name, 'long-press menu (contextmenu) blocked', guards.menuBlocked);
  check(name, 'viewport blocks pinch/double-tap zoom', guards.noZoom);

  const [tx, ty] = await toPage(page, 180, 520);
  await page.touchscreen.tap(tx, ty);
  let menu = false;
  try {
    await waitScene(page, 'Menu', 5000);
    menu = true;
  } catch {}
  check(name, 'touch tap on "Tap to start" opens the Menu', menu);
  if (menu) {
    await sleep(800);
    checkTargets(name, 'Menu', await targets(page, 'Menu'));
  }

  // Battle: tap targets, app switch, landscape.
  await page.goto(`${url}?battle=b1_forgotten&pauses=0`);
  await page.waitForFunction(() => window.__battle?.menu?.items?.length, null, { timeout: 20000 });
  await sleep(400);
  checkTargets(name, 'Battle commands', await targets(page, 'Battle'));

  // The target cards (Strike with two enemies): same tap-target rule.
  const [sx, sy] = await toPage(page, ...STRIKE_SLOT);
  await page.touchscreen.tap(sx, sy);
  await sleep(600);
  checkTargets(name, 'Battle target cards', await targets(page, 'Battle'));
  const [bx, by] = await toPage(page, ...BACK_SLOT);
  await page.touchscreen.tap(bx, by);
  await sleep(500);

  const hpBefore = await page.evaluate(() => window.__battle.heroes.map((h) => h.hp).join(','));
  await setHidden(page, true);
  await sleep(300);
  const paused = await page.evaluate(() => window.__game.scene.isPaused('Battle') && window.__game.scene.isActive('Pause'));
  await setHidden(page, false);
  await sleep(300);
  const [px, py] = await toPage(page, 180, 320);
  await page.touchscreen.tap(px, py);
  await sleep(500);
  const resumed = await page.evaluate(() => window.__game.scene.isActive('Battle') && !window.__game.scene.isPaused('Battle'));
  const hpAfter = await page.evaluate(() => window.__battle.heroes.map((h) => h.hp).join(','));
  check(name, 'app switch mid-battle: pauses, "Tap to continue" resumes, HP intact', paused && resumed && hpBefore === hpAfter, `paused=${paused} resumed=${resumed} hp ${hpBefore} -> ${hpAfter}`);

  await page.setViewportSize({ width: d.viewport.height, height: d.viewport.width });
  await sleep(400);
  const side = await page.evaluate(() => ({ overlay: getComputedStyle(document.getElementById('rotate')).display !== 'none', paused: window.__game.scene.isPaused('Battle') }));
  check(name, 'landscape: "Rotate your phone" overlay + battle paused', side.overlay && side.paused, JSON.stringify(side));
  await page.setViewportSize(d.viewport);
  await sleep(400);
  const back = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display === 'none');
  check(name, 'back to portrait: overlay gone', back);

  check(name, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('Playwright is not installed here: skipping.');
  process.exit(0);
}
const server = await startServer();
const browser = await pw.chromium.launch();
try {
  for (const [name, d] of Object.entries(DEVICES)) await runDevice(browser, server.url, name, d);
} finally {
  await browser.close();
  await server.close();
}

let failed = 0;
let device = null;
for (const r of results) {
  if (r.device !== device) console.log(`\n${(device = r.device)}`);
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${!r.ok && r.detail ? `  (${r.detail})` : ''}`);
  if (!r.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
