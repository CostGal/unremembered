// Shared helpers for scripts/qa/*: one Chrome (via scripts/lib/cdp.mjs), one dev
// server, pages with console/pageerror/404 capture and real mouse input.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome } from '../lib/cdp.mjs';
import { startServer, root } from '../lib/harness.mjs';

export { root };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withBrowser(fn, { prod = false } = {}) {
  let server;
  if (prod) {
    const { preview } = await import('vite');
    const s = await preview({ root, logLevel: 'error', preview: { port: 0, host: '127.0.0.1' } });
    server = { url: s.resolvedUrls.local[0], close: () => new Promise((r) => s.httpServer.close(r)) };
  } else server = await startServer();
  const chrome = await launchChrome();
  try {
    return await fn({ server, chrome });
  } finally {
    await chrome.close();
    await server.close();
  }
}

// opts: {w,h,dpr,cpu, init: [source strings], settings: object|null, network: {latency, down, up}}
export async function open(chrome, url, opts = {}) {
  const { w = 360, h = 640, dpr = 1, cpu = 1, init = [], settings = null, network = null } = opts;
  const page = await chrome.newPage({ width: w, height: h, dpr, cpu });
  page.missing = [];
  page.warnings = [];
  page.requests = [];
  page.cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'warning') page.warnings.push(text);
    if (p.type === 'error' && /Failed to (load resource|process file)/.test(text)) page.missing.push(text);
  });
  await page.cdp.send('Network.enable');
  if (network) await page.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: network.latency, downloadThroughput: network.down, uploadThroughput: network.up });
  page.cdp.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400) page.missing.push(`${p.response.status} ${p.response.url}`);
  });
  page.cdp.on('Network.loadingFinished', (p) => page.requests.push({ id: p.requestId, bytes: p.encodedDataLength, t: Date.now() }));
  if (settings) await page.addInitScript(`try{localStorage.setItem('unremembered:settings', ${JSON.stringify(JSON.stringify(settings))})}catch(e){}`);
  for (const src of init) await page.addInitScript(src);
  // Every page starts from empty localStorage for its origin (the Chrome profile is shared
  // by all pages of a run, so settings written by one test would otherwise leak into the next).
  if (opts.fresh !== false && /^https?:/.test(url)) {
    try {
      await page.cdp.send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'local_storage,session_storage' });
    } catch (e) {
      // best effort
    }
  }
  page.vp = { w, h };
  page.ev = (expr) => page.eval(expr);
  page.tap = async (x, y) => page.click(x, y);
  page.down = (x, y) => page.mouse('mousePressed', x, y);
  page.up = (x, y) => page.mouse('mouseReleased', x, y);
  page.move = (x, y) => page.mouse('mouseMoved', x, y);
  page.swipe = async (x, y, dy = -80) => {
    await page.move(x, y);
    await page.down(x, y);
    for (let i = 1; i <= 4; i++) await page.move(x, y + (dy * i) / 4);
    await page.up(x, y + dy);
  };
  page.hold = async (x, y, ms) => {
    await page.move(x, y);
    await page.down(x, y);
    await sleep(ms);
    await page.up(x, y);
  };
  page.shot = async (path) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, await page.screenshot({ format: 'png' }));
  };
  page.hidden = (hidden) =>
    page.eval(`(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${hidden ? "'hidden'" : "'visible'"} }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  page.scenes = () => page.eval(`window.__game ? window.__game.scene.getScenes(true).map(s => s.scene.key) : []`);
  page.gameReady = (timeout = 30000) => page.waitFor(`!!(window.__game && window.__game.scene.getScenes(true).length)`, { timeout });
  await page.goto(url);
  return page;
}

// Waits until one of the listed scene keys is active.
export const waitScene = (page, key, timeout = 30000) =>
  page.waitFor(`!!(window.__game && window.__game.scene.getScenes(true).some(s => s.scene.key === ${JSON.stringify(key)}))`, { timeout });

export const INIT = {
  // localStorage throws on every access (some in-app browsers / privacy modes).
  blockedStorage: `(() => { const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); }; Object.defineProperty(window, 'localStorage', { configurable: true, get: deny }); Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny }); })()`,
  // The AudioContext never leaves 'suspended' (autoplay lock that no gesture lifts).
  audioLocked: `(() => { const Base = window.AudioContext; class Locked extends Base { get state() { return 'suspended'; } resume() { return new Promise(() => {}); } } window.AudioContext = Locked; window.webkitAudioContext = Locked; })()`,
  // window.__audio.log collects every music request of the game (Audio.js audioLog): play, stop, oneshot,
  // oneshot_end, silence, prefetch, keep, sfx. Without the analyser this is all that window.__audio holds.
  audioLog: `(() => { window.__audio = window.__audio || { ctxs: [] }; window.__audio.log = window.__audio.log || []; })()`,
  // Taps the destination bus through an AnalyserNode so a headless run can measure the actual output level.
  analyser: `(() => {
    const Base = window.AudioContext;
    const orig = AudioNode.prototype.connect;
    window.__audio = { ctxs: [], rms() { const a = window.__audio.an; if (!a) return -1; const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); } };
    AudioNode.prototype.connect = function (target, ...rest) {
      const r = orig.call(this, target, ...rest);
      try { if (target && target.constructor && target.constructor.name === 'AudioDestinationNode' && this.context === window.__audio.ctx && !this.__tapped) {
        this.__tapped = true; if (!window.__audio.an) { const an = this.context.createAnalyser(); an.fftSize = 2048; window.__audio.an = an; } orig.call(this, window.__audio.an); } } catch (e) {}
      return r;
    };
    window.AudioContext = window.webkitAudioContext = class extends Base { constructor(...a) { super(...a); window.__audio.ctx = this; window.__audio.ctxs.push(this); } };
  })()`,
};

export function summarise(page) {
  return { errors: [...page.errors], missing: [...new Set(page.missing)], warnings: [...new Set(page.warnings)] };
}

// Playwright-shaped adapter so scripts/lib/bot.mjs can drive a raw CDP page.
export function adaptBot(page) {
  let lx = 0;
  let ly = 0;
  return {
    errors: page.errors,
    evaluate: (fn, arg) => page.eval(`(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`),
    mouse: {
      click: (x, y) => page.click(x, y),
      move: async (x, y, { steps = 1 } = {}) => {
        const [x0, y0] = [lx, ly];
        for (let i = 1; i <= steps; i++) await page.move(x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
        lx = x;
        ly = y;
      },
      down: () => page.down(lx, ly),
      up: () => page.up(lx, ly),
    },
  };
}

// The Recollection minigame (recollection.json beats), played through the dev hook window.__battle:
// each beat is answered once with the wanted result ('PERFECT' | 'GOOD' | 'MISS' = no input).
// hold: press, release at the centre (+150 ms for a GOOD); swipe: the arrow's way, at once (GOOD:
// after 500 ms); taps: 6 quick taps (GOOD: spread so less than perfectSpareMs is left).
const BEAT_AT = [180, 560];
const STEP = { up: [0, -20], down: [0, 20], left: [-20, 0], right: [20, 0] };
export async function playBeats(page, { results = ['PERFECT', 'PERFECT', 'PERFECT'], timeout = 40000, onBeat = null } = {}) {
  const done = new Set();
  const end = Date.now() + timeout;
  while (done.size < results.length && Date.now() < end) {
    const beat = await page.ev(`(() => { const b = window.__battle && window.__battle.recollectionBeat; return b ? { kind: b.kind, index: b.index, dir: b.dir || null, centreMs: b.centreMs || 0, taps: b.taps || 0, windowMs: b.windowMs || 0, forced: b.forced || null } : null; })()`);
    if (!beat || done.has(beat.index)) {
      await sleep(20);
      continue;
    }
    done.add(beat.index);
    if (onBeat) await onBeat(beat);
    const want = results[beat.index];
    if (want === 'MISS' || beat.forced) continue;
    const [x, y] = BEAT_AT;
    if (beat.kind === 'hold') {
      await page.move(x, y);
      await page.down(x, y);
      const t0 = Date.now();
      await sleep(Math.max(0, beat.centreMs + (want === 'GOOD' ? 150 : 0) - (Date.now() - t0) - 4));
      await page.up(x, y);
    } else if (beat.kind === 'swipe') {
      if (want === 'GOOD') await sleep(500);
      const [dx, dy] = STEP[beat.dir];
      await page.move(x, y);
      await page.down(x, y);
      for (let i = 1; i <= 4; i++) await page.move(x + dx * i, y + dy * i);
      await page.up(x + dx * 4, y + dy * 4);
    } else if (beat.kind === 'taps') {
      // GOOD: the last tap lands 120 ms before the window closes (under perfectSpareMs to spare).
      const span = want === 'GOOD' ? beat.windowMs - 120 : 0;
      const t0 = Date.now();
      for (let i = 0; i < beat.taps; i++) {
        if (span) await sleep(Math.max(0, t0 + (span * i) / (beat.taps - 1) - Date.now()));
        await page.click(x, y);
      }
    }
  }
  return done.size;
}
