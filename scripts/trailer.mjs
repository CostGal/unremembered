// Records the trailer from the real game (dev build, headless Chromium) and cuts
// it with ffmpeg: `npm run trailer`. The edit is data: scripts/trailer/shotlist.json
// (shots, cut windows, cards, music); text cards come from scripts/trailer/card.html.
//
// Each game shot opens a dev URL (?cutscene=, ?step=, ?battle=…), drives it (the
// playtest bot plays battles with every parry PERFECT), and captures the 360×640
// canvas with a CDP screencast, one PNG per frame with its time. The recorder logs
// markers (ready, typed, line:N, ringImpact, nala, cast:<hero>, beat, battle) and
// the shot's `cut` picks a window around one. Frames are upscaled ×3 with nearest
// neighbour (what a phone does with the canvas), clips are concatenated, and the
// soundtrack is mixed from the game's own mp3s (only the cleared tracks).
//
// Flags: --only a,b (shot ids) · --cut-only (re-cut from the frames of the last
// run, no browser) · --keep (keep work files). Work files: _art/trailer/work/.
// Needs ffmpeg on PATH and Playwright somewhere npm can find it (see harness.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright, root, sleep, startServer, tap } from './lib/harness.mjs';
import { Bot } from './lib/bot.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const only = opt('only') ? opt('only').split(',') : null;
const cutOnly = flag('cut-only');

const LIST = JSON.parse(readFileSync(join(root, 'scripts/trailer/shotlist.json'), 'utf8'));
const CARD_HTML = readFileSync(join(root, 'scripts/trailer/card.html'), 'utf8');
const WORK = join(root, '_art/trailer/work');
const OUT = LIST.output;
const shots = LIST.shots.filter((s) => !only || only.includes(s.id));
const POLL_MS = 40;
const BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--mute-audio', '--autoplay-policy=no-user-gesture-required'];

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const ffprobe = (file) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
const dir = (p) => { mkdirSync(p, { recursive: true }); return p; };

// Seeded Math.random (mulberry32) so a re-run gives the same attacks and rolls.
function seedRandom(seed) {
  let s = (seed >>> 0) || 1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- recording

async function record(browser, server, shot) {
  const shotDir = join(WORK, shot.id);
  rmSync(shotDir, { recursive: true, force: true });
  dir(shotDir);
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  await context.addInitScript(seedRandom, shot.seed ?? 1);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (err) => page.errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|Failed to process file/.test(msg.text())) page.errors.push(msg.text()); });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  let pending = Promise.resolve();
  cdp.on('Page.screencastFrame', (f) => {
    const t = Date.now();
    const file = join(shotDir, `f${String(frames.length).padStart(5, '0')}.png`);
    frames.push({ file, t });
    pending = pending.then(() => writeFileSync(file, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await page.goto(server.url + shot.url);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  const t0 = Date.now();
  const markers = {};
  const mark = (name, t = Date.now()) => { if (!(name in markers)) { markers[name] = t; console.log(`  ${shot.id}: ${name} @ ${((t - t0) / 1000).toFixed(2)}s`); } };
  const done = () => markers[shot.stop.marker] !== undefined && Date.now() >= markers[shot.stop.marker] + shot.stop.after;
  const deadline = Date.now() + (shot.timeoutMs || 150000);
  const guard = () => {
    if (page.errors.length) throw new Error(`${shot.id}: page error: ${page.errors[0]}`);
    if (Date.now() > deadline) throw new Error(`${shot.id}: timed out waiting for marker "${shot.stop.marker}" (have: ${Object.keys(markers).join(', ') || 'none'})`);
  };

  if (shot.kind === 'cutscene' || shot.kind === 'dialogue' || shot.kind === 'title') {
    const key = { cutscene: 'Cutscene', dialogue: 'Dialogue', title: 'Title' }[shot.kind];
    let lastTap = 0;
    while (!done()) {
      guard();
      const st = await page.evaluate((k) => {
        const g = window.__game;
        if (!g) return null;
        const s = g.scene.getScene(k);
        return { active: g.scene.isActive(k), index: s?.index, typing: !!s?.typing, interactive: performance.getEntriesByName('title-interactive').length > 0 };
      }, key);
      if (st && st.active) {
        if (shot.kind === 'title' && st.interactive) mark('ready');
        if (shot.kind === 'cutscene' && st.typing) mark('ready');
        if (shot.kind === 'dialogue') {
          if (st.index >= 0) mark('ready');
          if (st.index === shot.line) mark(`line:${shot.line}`);
          else if (st.index < shot.line && Date.now() - lastTap > 220) { lastTap = Date.now(); await tap(page, 180, 560); }
        }
        if ('ready' in markers && (shot.kind === 'cutscene' || markers[`line:${shot.line}`]) && !st.typing) mark('typed');
      }
      await sleep(POLL_MS);
    }
  } else if (shot.kind === 'battle') {
    const bot = new Bot(page, { profile: { PERFECT: 1, GOOD: 0, MISS: 0 }, dodgeChance: 0, useNala: true });
    let patched = false;
    let nala = 0;
    const echo = {};
    await bot.run({
      timeoutMs: shot.timeoutMs || 150000,
      stallMs: 30000,
      stopWhen: (st) => {
        guard();
        const b = st.battle;
        if (!b) return done();
        const nodeNow = Date.now();
        mark('battle');
        if (!patched) {
          patched = true;
          // Every bot tap lands PERFECT: the windows are widened well past headless input jitter.
          page.evaluate(() => {
            const bs = window.__battle;
            if (!bs) return;
            bs.parryWindows = () => ({ perfectMs: 400, goodMs: 500, ignoreBeforeMs: 350 });
            bs.dodgeWindows = bs.parryWindows;
          }).catch(() => {});
        }
        if (b.rings.length) mark('ringImpact', nodeNow + (b.rings[0] - st.now));
        if (bot.results.nala > nala) { nala = bot.results.nala; mark('nala'); }
        for (const h of b.heroes) {
          if (h.id in echo && h.echo < echo[h.id]) mark(`cast:${h.id}`);
          echo[h.id] = h.echo;
        }
        if (b.beat) mark('beat');
        return done();
      },
    });
    console.log(`  ${shot.id}: bot results`, JSON.stringify(bot.results));
  } else throw new Error(`${shot.id}: unknown kind ${shot.kind}`);

  await cdp.send('Page.stopScreencast').catch(() => {});
  await pending;
  await context.close();
  if (!frames.length) throw new Error(`${shot.id}: no frames captured`);
  const fps = frames.length / ((frames[frames.length - 1].t - frames[0].t) / 1000);
  console.log(`  ${shot.id}: ${frames.length} frames, ${fps.toFixed(1)} fps`);
  writeFileSync(join(shotDir, 'recording.json'), JSON.stringify({ t0, markers, frames: frames.map((f) => ({ file: f.file, t: f.t })) }));
}

async function renderCard(browser, server, shot) {
  const shotDir = dir(join(WORK, shot.id));
  const context = await browser.newContext({ viewport: { width: OUT.width, height: OUT.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = shot.lines.map((l, i) => `<div class="line${i === 1 && shot.logo ? ' accent' : ''}${i === 2 && shot.logo ? ' small' : ''}">${esc(l)}</div>`).join('\n');
  const html = CARD_HTML
    .replace('<head>', `<head><base href="${server.url}">`)
    .replace('<!--LOGO-->', shot.logo ? '<img class="logo" src="assets/ui/logo.png">' : '')
    .replace('<!--LINES-->', lines);
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(100);
  const file = join(shotDir, 'card.png');
  await page.screenshot({ path: file });
  await context.close();
  return file;
}

// ---------------------------------------------------------------- cutting

function fadeFilters(shot, durationS) {
  const f = [];
  if (shot.fadeIn) f.push(`fade=t=in:st=0:d=${shot.fadeIn / 1000}`);
  if (shot.fadeOut) f.push(`fade=t=out:st=${Math.max(0, durationS - shot.fadeOut / 1000)}:d=${shot.fadeOut / 1000}`);
  return f;
}

const ENCODE = ['-r', String(OUT.fps), '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(OUT.crf), '-pix_fmt', 'yuv420p', '-an'];

// A game shot: the frames inside the cut window, each shown for its real duration.
function cutShot(shot) {
  const source = shot.sameRecordingAs || shot.id;
  const rec = JSON.parse(readFileSync(join(WORK, source, 'recording.json'), 'utf8'));
  const at = rec.markers[shot.cut.from];
  if (at === undefined) throw new Error(`${shot.id}: marker "${shot.cut.from}" was never logged (have: ${Object.keys(rec.markers).join(', ')})`);
  const frames = rec.frames;
  const last = frames[frames.length - 1].t + 1000 / OUT.fps;
  const until = shot.cut.until;
  if (until && rec.markers[until.from] === undefined) throw new Error(`${shot.id}: marker "${until.from}" was never logged (have: ${Object.keys(rec.markers).join(', ')})`);
  const b = Math.min(last, until ? rec.markers[until.from] + until.after : at + shot.cut.after);
  // before > 0: the window opens that long before the marker (on the frame showing then);
  // before 0: on the first frame captured at or after the marker (never an earlier frame).
  const before = shot.cut.before || 0;
  const first = before > 0 ? Math.max(0, frames.findLastIndex((f) => f.t <= at - before)) : Math.max(0, frames.findIndex((f) => f.t >= at));
  const a = before > 0 ? Math.max(frames[0].t, at - before) : frames[first].t;
  const sel = frames.slice(first).filter((f, i) => i === 0 || f.t < b);
  const lines = [];
  for (let i = 0; i < sel.length; i++) {
    const start = i === 0 ? a : sel[i].t;
    const end = i + 1 < sel.length ? sel[i + 1].t : b;
    lines.push(`file '${sel[i].file}'`, `duration ${Math.max(0.001, (end - start) / 1000).toFixed(4)}`);
  }
  lines.push(`file '${sel[sel.length - 1].file}'`);
  const listFile = join(WORK, `${shot.id}.txt`);
  writeFileSync(listFile, lines.join('\n') + '\n');
  const durationS = (b - a) / 1000;
  const vf = [`scale=${OUT.width}:${OUT.height}:flags=neighbor`, ...fadeFilters(shot, durationS)].join(',');
  const clip = join(WORK, 'clips', `${shot.id}.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf, ...ENCODE, clip]);
  return { clip, durationS: Number(ffprobe(clip)) };
}

function cutCard(shot) {
  const png = join(WORK, shot.id, 'card.png');
  const durationS = shot.durationMs / 1000;
  const vf = ['format=yuv420p', ...fadeFilters(shot, durationS)].join(',');
  const clip = join(WORK, 'clips', `${shot.id}.mp4`);
  ffmpeg(['-loop', '1', '-framerate', String(OUT.fps), '-i', png, '-t', String(durationS), '-vf', vf, ...ENCODE, clip]);
  return { clip, durationS: Number(ffprobe(clip)) };
}

function mixAndMux(clips) {
  const video = join(WORK, 'video.mp4');
  const list = join(WORK, 'clips.txt');
  writeFileSync(list, clips.map((c) => `file '${c.clip}'`).join('\n') + '\n');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  const total = clips.reduce((s, c) => s + c.durationS, 0);
  const m = LIST.music;
  let switchAt = 0;
  for (const c of clips) { switchAt += c.durationS; if (c.id === m.switchAfterShot) break; }
  const cf = m.crossfadeMs / 1000;
  const [t1, t2] = m.tracks;
  const out = join(root, OUT.file);
  dir(join(out, '..'));
  const filter = [
    `[1:a]atrim=start=${t1.start}:duration=${(switchAt + cf / 2).toFixed(3)},asetpts=PTS-STARTPTS[a1]`,
    `[2:a]atrim=start=${t2.start}:duration=${(total - switchAt + cf / 2).toFixed(3)},asetpts=PTS-STARTPTS[a2]`,
    `[a1][a2]acrossfade=d=${cf}:c1=tri:c2=tri[ax]`,
    `[ax]afade=t=out:st=${(total - m.fadeOutMs / 1000).toFixed(3)}:d=${m.fadeOutMs / 1000},loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:${total.toFixed(3)}[a]`,
  ].join(';');
  ffmpeg(['-i', video, '-i', join(root, t1.file), '-i', join(root, t2.file), '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', out]);
  return { out, total };
}

// ---------------------------------------------------------------- main

async function main() {
  dir(join(WORK, 'clips'));
  if (!cutOnly) {
    const pw = await loadPlaywright();
    if (!pw || pw.shim) throw new Error('Playwright is needed for the screencast (npm i -g playwright, with its Chromium)');
    const server = await startServer();
    const browser = await pw.chromium.launch({ args: BROWSER_ARGS });
    try {
      for (const shot of shots) {
        if (shot.sameRecordingAs) continue;
        console.log(`recording ${shot.id} (${shot.kind}) ${shot.url ?? ''}`);
        if (shot.kind === 'card') await renderCard(browser, server, shot);
        else await record(browser, server, shot);
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }
  const clips = [];
  for (const shot of shots) {
    const c = shot.kind === 'card' ? cutCard(shot) : cutShot(shot);
    clips.push({ id: shot.id, ...c });
    console.log(`cut ${shot.id}: ${c.durationS.toFixed(2)}s`);
  }
  if (only) { console.log('--only: clips are in', join(WORK, 'clips'), '(no final mix)'); return; }
  const { out, total } = mixAndMux(clips);
  const cover = LIST.shots.find((s) => s.id === OUT.coverShot);
  if (cover) ffmpeg(['-i', join(WORK, cover.id, 'card.png'), '-q:v', '3', join(root, OUT.cover)]);
  console.log(`\n${OUT.file}: ${total.toFixed(1)}s, ${OUT.width}x${OUT.height}`);
  if (!flag('keep')) rmSync(WORK, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
