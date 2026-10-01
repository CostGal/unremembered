// A tiny Chrome DevTools Protocol driver for the dev scripts when Playwright
// isn't installed. No dependencies: it launches the Chrome/Edge already on the
// machine and talks to it over Node's built-in WebSocket (Node 22+).
//
//   const chrome = await launchChrome();
//   const page = await chrome.newPage({ width: 360, height: 640 });
//   await page.goto(url);
//   const value = await page.eval('window.__game.scene.keys.Cutscene.index');
//   writeFileSync('shot.jpg', await page.screenshot());
//   await chrome.close();
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

class Page {
  constructor(session) {
    this.cdp = session;
    this.logs = [];
    this.errors = [];
    session.on('Runtime.consoleAPICalled', (p) => {
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      this.logs.push(`[${p.type}] ${text}`);
      if (p.type === 'error' && !/Failed to (load resource|process file)/.test(text)) this.errors.push(text);
    });
    session.on('Runtime.exceptionThrown', (p) => this.errors.push(`pageerror: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
  }

  async init({ width, height, dpr, cpu }) {
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    if (cpu > 1) await this.cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }

  async goto(url) {
    const loaded = new Promise((resolve) => this.cdp.on('Page.loadEventFired', resolve));
    await this.cdp.send('Page.navigate', { url });
    await loaded;
  }

  async eval(expression) {
    const res = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  }

  async waitFor(expression, { timeout = 20000, interval = 100 } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression).catch(() => false)) return true;
      await sleep(interval);
    }
    throw new Error(`waitFor timed out: ${expression}`);
  }

  // JPEG by default (small); pass {format: 'png'} for lossless.
  async screenshot({ format = 'jpeg', quality = 85 } = {}) {
    const res = await this.cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined });
    return Buffer.from(res.data, 'base64');
  }

  async click(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  async setCpuThrottle(rate) {
    await this.cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
}

export async function launchChrome({ headless = true } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('No Chrome/Edge found (set CHROME=path)');
  const dir = mkdtempSync(join(tmpdir(), 'unremembered-chrome-'));
  const args = [
    `--user-data-dir=${dir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: 'ignore' });

  const portFile = join(dir, 'DevToolsActivePort');
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not start');
  }

  const sockets = [];
  let browserSession = null;
  return {
    // Browser-level commands (e.g. SystemInfo.getProcessInfo) need the browser target.
    async browser() {
      if (browserSession) return browserSession;
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      sockets.push(ws);
      browserSession = new Session(ws);
      return browserSession;
    },
    async newPage({ width = 360, height = 640, dpr = 1, cpu = 1 } = {}) {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      sockets.push(ws);
      const page = new Page(new Session(ws));
      await page.init({ width, height, dpr, cpu });
      return page;
    },
    async close() {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch (err) {
          // already closed
        }
      }
      try {
        if (process.platform === 'win32') execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
        else proc.kill();
      } catch (err) {
        // already gone
      }
      await sleep(300);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // Chrome may still hold files; the OS temp dir cleans up later
      }
    },
  };
}
