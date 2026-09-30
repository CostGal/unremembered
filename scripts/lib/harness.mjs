// Headless-browser helpers for the dev scripts (playtest, perf checks).
// Playwright is not a project dependency: it is used from wherever it is
// already installed (local node_modules or the global npm root). If it isn't
// available, loadPlaywright() returns null and the caller skips.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return null;
}

// Vite dev server on a free port (dev build: window.__game / __battle exist).
export async function startServer() {
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

// A 360×640 phone-sized page. Collects console errors and page errors into
// page.errors (resource 404s for not-yet-delivered art are expected and kept
// apart in page.missing).
export async function openPage(browser, url, { cpuThrottle = 1 } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
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
