// npm run perf — headless performance checks (needs Playwright, see
// scripts/lib/harness.mjs). Run `npm run build` first.
// 1. Load: time until Title takes taps, on the production build served with
//    gzip, under throttled mobile networks + 4x CPU.
// 2. FPS: game.loop.actualFps under 4x CPU throttling while the bot plays a
//    rainy battle that opens with Recollection (rain + hit FX + rings).
//   npm run perf [-- --load | --fps] [battleId]
// Headless Chromium renders WebGL in software (SwiftShader), so FPS here is a
// pessimistic, relative number: use it to compare before/after changes.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadPlaywright, openPage, root, sleep, startServer, waitFor } from './lib/harness.mjs';
import { Bot } from './lib/bot.mjs';

const NETWORKS = {
  '4G': { latency: 85, download: (9 * 1024 * 1024) / 8, upload: (1.5 * 1024 * 1024) / 8 },
  'Slow 4G': { latency: 150, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8 },
};
const CPU = 4;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };

function serveDist() {
  const dist = join(root, 'dist');
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^\/+/, '') || 'index.html';
    const file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = readFileSync(file);
    const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (/\.(html|js|json|txt)$/.test(file) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

async function loadTime(browser, url, net) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.download, uploadThroughput: net.upload });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(url);
  await waitFor(page, () => performance.getEntriesByName('title-interactive').length > 0, null, { timeout: 60000, interval: 50 });
  const ms = await page.evaluate(() => performance.getEntriesByName('title-interactive')[0].startTime);
  await context.close();
  return ms;
}

async function fpsDuringBattle(browser, url, cpu) {
  const page = await openPage(browser, url, { cpuThrottle: cpu });
  await waitFor(page, () => !!window.__battle?.menu?.pending, null, { timeout: 60000 });
  const samples = [];
  const bot = new Bot(page, { profile: { PERFECT: 0.4, GOOD: 0.35, MISS: 0.25 } });
  const end = Date.now() + 25000;
  let lastSample = 0;
  while (Date.now() < end) {
    const st = await bot.step();
    if (st.battle?.over) break;
    if (Date.now() - lastSample > 250) {
      lastSample = Date.now();
      samples.push(await page.evaluate(() => window.__game.loop.actualFps));
    }
    await sleep(40);
  }
  await page.close();
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  return { avg, p5: samples[Math.floor(samples.length * 0.05)], min: samples[0], n: samples.length };
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('Playwright not found: skipping (see scripts/lib/harness.mjs).');
  process.exit(0);
}
const only = process.argv.includes('--load') ? 'load' : process.argv.includes('--fps') ? 'fps' : null;
const battleArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const browser = await pw.chromium.launch();
try {
  if (only !== 'fps') await measureLoad();
  if (only !== 'load') await measureFps();
} finally {
  await browser.close();
}

async function measureLoad() {
  const dist = await serveDist();
  console.log(`Load (production build, gzip, CPU ${CPU}x): time until Title takes taps`);
  for (const [name, net] of Object.entries(NETWORKS)) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await loadTime(browser, dist.url, net));
    runs.sort((a, b) => a - b);
    console.log(`  ${name.padEnd(8)} median ${(runs[1] / 1000).toFixed(2)} s  (runs: ${runs.map((r) => (r / 1000).toFixed(2)).join(', ')})`);
  }
  dist.close();
}

async function measureFps() {
  const dev = await startServer();
  const battle = battleArg || 'b1_forgotten';
  console.log(`\nFPS in ${battle} (rain + hit FX + Recollection first), bot playing ~25 s:`);
  for (const cpu of [1, CPU]) {
    const r = await fpsDuringBattle(browser, `${dev.url}?battle=${battle}&echo=10&level=5`, cpu);
    console.log(`  CPU ${cpu}x: avg ${r.avg.toFixed(1)}  p5 ${r.p5.toFixed(1)}  min ${r.min.toFixed(1)}  (${r.n} samples)`);
  }
  await dev.close();
}
