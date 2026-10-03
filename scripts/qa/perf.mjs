// QA part I: load time on throttled networks (production build) and FPS under
// 4x CPU throttling in the heavy moments. Run `npm run build` first.
//   node scripts/qa/perf.mjs [--load] [--fps]
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Bot } from '../lib/bot.mjs';
import { adaptBot, open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const args = process.argv.slice(2);
const doLoad = !args.includes('--fps');
const doFps = !args.includes('--load');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };
const NETWORKS = {
  'Slow 4G': { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
  '4G': { latency: 85, down: (9 * 1024 * 1024) / 8, up: (1.5 * 1024 * 1024) / 8 },
};

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

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const stats = (s) => {
  const v = [...s].sort((a, b) => a - b);
  return { avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), p5: +v[Math.floor(v.length * 0.05)].toFixed(1), min: +v[0].toFixed(1), n: v.length };
};

await withBrowser(async ({ chrome, server }) => {
  if (doLoad) {
    const dist = await serveDist();
    console.log('LOAD (production build, gzip): ms until Title takes taps + bytes before Title');
    for (const [name, net] of Object.entries(NETWORKS)) {
      for (const cpu of [1, 4]) {
        const runs = [];
        const bytes = [];
        const reqs = [];
        for (let i = 0; i < 3; i++) {
          const page = await open(chrome, 'about:blank', { cpu, network: net });
          await page.goto(dist.url);
          await page.waitFor(`performance.getEntriesByName('title-interactive').length > 0`, { timeout: 90000, interval: 50 });
          const ms = await page.eval(`performance.getEntriesByName('title-interactive')[0].startTime`);
          const mark = Date.now();
          const before = page.requests.filter((r) => r.t <= mark);
          runs.push(Math.round(ms));
          bytes.push(before.reduce((s, r) => s + r.bytes, 0));
          reqs.push(before.length);
        }
        console.log(`  ${name.padEnd(8)} CPU ${cpu}x  Title interactive median ${(median(runs) / 1000).toFixed(2)} s (runs ${runs.join(', ')} ms)  bytes before Title ${(median(bytes) / 1048576).toFixed(2)} MB in ${median(reqs)} requests`);
      }
    }
    dist.close();
  }

  if (doFps) {
    console.log('\nFPS (headless software WebGL: pessimistic), ?fps=1 meter:');
    const sample = async (page, ms) => {
      const out = [];
      const end = Date.now() + ms;
      while (Date.now() < end) {
        out.push(await page.eval(`window.__game.loop.actualFps`));
        await sleep(250);
      }
      return out;
    };
    const botSample = async (page, ms, profile = { PERFECT: 0.4, GOOD: 0.35, MISS: 0.25 }) => {
      const bot = new Bot(adaptBot(page), { profile });
      const out = [];
      const end = Date.now() + ms;
      let last = 0;
      while (Date.now() < end) {
        const st = await bot.step();
        if (st.battle && st.battle.over) break;
        if (Date.now() - last > 250) {
          last = Date.now();
          out.push(await page.eval(`window.__game.loop.actualFps`));
        }
        await sleep(40);
      }
      return out;
    };
    const ready = (page) => page.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`, { timeout: 90000 });
    for (const cpu of [1, 4]) {
      const res = {};
      let page = await open(chrome, `${server.url}?battle=b1_forgotten&fps=1`, { cpu });
      await ready(page);
      await sleep(1500);
      res['rain + hit FX (b1, bot)'] = stats(await botSample(page, 25000));
      page = await open(chrome, `${server.url}?battle=boss_clerk&echo=10&level=5&fps=1`, { cpu });
      await ready(page);
      await sleep(1500);
      res['Recollection (gold tint + rings)'] = stats(await botSample(page, 14000, { PERFECT: 0.6, GOOD: 0.3, MISS: 0.1 }));
      page = await open(chrome, `${server.url}?battle=boss_clerk&fps=1`, { cpu });
      await ready(page);
      await page.eval(`(() => { const B = window.__battle; const e = B.enemies[0]; e.hp = Math.floor(e.maxHp * 0.45); e.phase = 1; })()`);
      res['boss phase 2 (bot)'] = stats(await botSample(page, 25000));
      page = await open(chrome, `${server.url}?battle=b1_forgotten&fps=1`, { cpu });
      await ready(page);
      await sleep(2000);
      res['battle idle (rain only)'] = stats(await sample(page, 6000));
      // The impact lab (?impact=1): impact.json presets loop every 1.5 s at the first enemy, over the rain.
      page = await open(chrome, `${server.url}?battle=b1_forgotten&level=2&impact=1&fps=1`, { cpu });
      await ready(page);
      await sleep(2000);
      res['impact lab (?impact=1, b1)'] = stats(await sample(page, 12000));
      const shots = JSON.parse(readFileSync(join(root, 'src/data/cutscene_origin.json'), 'utf8')).shots;
      const fxShots = shots.map((s, i) => [i, s.fx || []]).filter(([, fx]) => fx.some((f) => ['rain', 'embers', 'crystal_particles', 'eyes_glow'].includes(f)));
      page = await open(chrome, `${server.url}?cutscene=origin&shot=1&fps=1`, { cpu });
      await waitScene(page, 'Cutscene', 90000);
      const per = [];
      for (const [i, fx] of fxShots) {
        await page.eval(`(() => { const c = window.__game.scene.getScene('Cutscene'); c.index = ${i} - 1; c.nextShot(); })()`);
        await sleep(1200);
        const s = stats(await sample(page, 3500));
        per.push({ shot: i + 1, fx: fx.join('+'), ...s });
      }
      res['cutscene fx shots'] = { worstAvg: Math.min(...per.map((p) => p.avg)), worstMin: Math.min(...per.map((p) => p.min)), shots: per.map((p) => `#${p.shot} ${p.fx} avg ${p.avg} min ${p.min}`) };
      console.log(`\n  CPU ${cpu}x`);
      for (const [k, v] of Object.entries(res)) console.log(`    ${k.padEnd(34)} ${JSON.stringify(v)}`);
    }
  }
});
