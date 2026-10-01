// Headless-browser helpers for the dev scripts (playtest, perf checks).
// Playwright is not a project dependency: it is used from wherever it is
// already installed (local node_modules or the global npm root). If it isn't
// available, loadPlaywright() returns null and the caller skips.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { findChrome, launchChrome } from './cdp.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadPlaywright() {
  const require = createRequire(join(root, 'package.json'));
  const candidates = ['playwright'];
  try {
    candidates.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch (err) {
    // no npm on PATH
  }
  for (const id of candidates) {
    try {
      return require(id);
    } catch (err) {
      // try the next place
    }
  }
  // No Playwright: the same small surface on top of the system Chrome (cdp.mjs).
  return findChrome() ? { chromium: { launch: launchShimBrowser }, shim: true } : null;
}

// Just the Playwright calls the dev scripts use: newContext/newPage, page.on
// (console, pageerror, response), goto, mouse.click, evaluate, screenshot, close.
async function launchShimBrowser() {
  const chrome = await launchChrome();
  return {
    async newContext({ viewport = { width: 360, height: 640 }, deviceScaleFactor = 1 } = {}) {
      let page = null;
      const initScripts = [];
      return {
        addInitScript: async (fn, arg) => initScripts.push(`(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`),
        async newPage() {
          const raw = await chrome.newPage({ width: viewport.width, height: viewport.height, dpr: deviceScaleFactor });
          for (const source of initScripts) await raw.addInitScript(source);
          const handlers = { console: [], pageerror: [], response: [] };
          const cdp = raw.cdp;
          cdp.send('Network.enable');
          cdp.on('Runtime.consoleAPICalled', (p) => {
            const text = p.args.map((x) => x.value ?? x.description ?? '').join(' ');
            for (const h of handlers.console) h({ type: () => (p.type === 'warning' ? 'warning' : p.type), text: () => text });
          });
          cdp.on('Runtime.exceptionThrown', (p) => {
            for (const h of handlers.pageerror) h({ message: p.exceptionDetails.exception?.description || p.exceptionDetails.text });
          });
          cdp.on('Network.responseReceived', (p) => {
            for (const h of handlers.response) h({ status: () => p.response.status, url: () => p.response.url });
          });
          page = {
            on: (name, fn) => handlers[name]?.push(fn),
            goto: (url) => raw.goto(url),
            mouse: {
              click: (x, y) => raw.click(x, y),
              move: async (x, y, { steps = 1 } = {}) => {
                const [x0, y0] = [raw.lastX ?? x, raw.lastY ?? y];
                for (let i = 1; i <= steps; i++) await raw.mouse('mouseMoved', x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
              },
              down: () => raw.mouse('mousePressed', raw.lastX ?? 0, raw.lastY ?? 0),
              up: () => raw.mouse('mouseReleased', raw.lastX ?? 0, raw.lastY ?? 0),
            },
            async evaluate(fn, arg) {
              const expr = `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
              return raw.eval(expr);
            },
            async screenshot({ path } = {}) {
              const data = await raw.screenshot({ format: 'png' });
              if (path) writeFileSync(path, data);
              return data;
            },
            close: async () => {},
            __raw: raw,
          };
          return page;
        },
        async newCDPSession() {
          return { send: (method, params) => page && page.__raw.cdp.send(method, params) };
        },
      };
    },
    close: () => chrome.close(),
  };
}

// Vite dev server on a free port (dev build: window.__game / __battle exist).
export async function startServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

// A 360×640 phone-sized page. Collects console errors and page errors into
// page.errors (resource 404s for not-yet-delivered art are expected and kept
// apart in page.missing).
// settings: written to localStorage before the game boots (e.g. {storyMode: true}).
export async function openPage(browser, url, { cpuThrottle = 1, settings = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  if (settings) await context.addInitScript((s) => localStorage.setItem('unremembered:settings', JSON.stringify(s)), settings);
  const page = await context.newPage();
  page.errors = [];
  page.missing = [];
  page.logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    page.logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() !== 'error') return;
    if (/Failed to load resource|Failed to process file/.test(text)) page.missing.push(text);
    else page.errors.push(text);
  });
  page.on('pageerror', (err) => page.errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) page.missing.push(`${res.status()} ${res.url()}`);
  });
  if (cpuThrottle > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  }
  await page.goto(url);
  return page;
}

// The canvas fills the 360×640 viewport, so game coords = page coords.
export async function tap(page, x, y) {
  await page.mouse.click(x, y);
}

// A quick upward drag (a dodge): down, 80px up in four moves, up.
export async function swipe(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 4 });
  await page.mouse.up();
}

// Fakes the app going to the background and back (visibilitychange).
export async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(page, fn, arg, { timeout = 20000, interval = 50 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`waitFor timed out: ${fn.toString().slice(0, 120)}`);
}
