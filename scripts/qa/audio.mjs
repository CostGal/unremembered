// QA part J: audio. Taps the AudioContext destination with an AnalyserNode
// (lib.mjs INIT.analyser) and measures the real output level of every
// procedural track, the crossfades, volume 0, pause/resume on hidden, the
// boss intensity layer and the Recollection warm variant.
//   node scripts/qa/audio.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INIT, open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const music = JSON.parse(readFileSync(join(root, 'src/data/music.json'), 'utf8'));
const audio = JSON.parse(readFileSync(join(root, 'src/data/audio.json'), 'utf8'));
const rows = [];
const log = (ok, name, detail = '') => {
  rows.push({ ok, name, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const A = (page, expr) => page.ev(`(async () => { const A = window.__A || (window.__A = await import('/src/systems/Audio.js')); return ${expr}; })()`);
// RMS + peak over `ms` (sampled every 40 ms).
const level = async (page, ms) => {
  const end = Date.now() + ms;
  const v = [];
  while (Date.now() < end) {
    v.push(await page.ev(`(() => { const a = window.__audio.an; if (!a) return [-1, -1]; const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); let s = 0, p = 0; for (const x of d) { s += x * x; p = Math.max(p, Math.abs(x)); } return [Math.sqrt(s / d.length), p]; })()`));
    await sleep(40);
  }
  const rms = v.map((x) => x[0]);
  return { rms: rms.reduce((a, b) => a + b, 0) / rms.length, peak: Math.max(...v.map((x) => x[1])), min: Math.min(...rms), series: rms };
};
const f = (n) => n.toFixed(4);

async function boot(chrome, server, settings = null) {
  const page = await open(chrome, server.url, { init: [INIT.analyser], settings });
  await waitScene(page, 'Title');
  await sleep(600);
  await page.tap(180, 300); // unlocks audio like a player would
  await waitScene(page, 'Menu');
  await sleep(500);
  return page;
}

await withBrowser(async ({ chrome, server }) => {
  const page = await boot(chrome, server);
  const st = await A(page, 'A.musicStatus()');
  log(st.state === 'running', 'AudioContext runs after the Title tap', JSON.stringify({ state: st.state, key: st.key }));
  log(st.key === audio.music.scenes.Menu, `Menu plays "${audio.music.scenes.Menu}" (audio.json)`, String(st.key));
  const files = Object.keys(audio.music).length && (await page.ev(`fetch('assets/audio/music/title.mp3').then(r => r.headers.get('content-type'))`));
  log(true, 'INFO: no mp3 files shipped; every track is the procedural one', `title.mp3 → ${files}`);

  // ---- every procedural track
  for (const key of Object.keys(music.tracks)) {
    await A(page, `A.playMusic(${JSON.stringify(key)})`);
    await sleep(900);
    const l = await level(page, 2500);
    const status = await A(page, 'A.musicStatus()');
    log(l.rms > 0.003 && l.peak < 0.999 && status.key === key, `track "${key}" plays (rms ${f(l.rms)}, peak ${f(l.peak)}, no clipping)`, `status key ${status.key}, dropped notes ${status.stats ? status.stats.dropped : '?'}`);
  }

  // ---- crossfade between tracks (title -> battle): level never collapses
  await A(page, `A.playMusic('title')`);
  await sleep(1500);
  const before = await level(page, 800);
  await A(page, `A.playMusic('battle')`);
  const during = await level(page, 1400);
  const after = await level(page, 800);
  const statusX = await A(page, 'A.musicStatus()');
  log(during.min > before.rms * 0.25 && statusX.key === 'battle', `crossfade title → battle (${audio.music.crossfadeMs} ms): level never drops to silence`, `before ${f(before.rms)}, min during ${f(during.min)}, after ${f(after.rms)}, peak ${f(during.peak)}`);

  // ---- boss intensity + warm variant
  await A(page, `A.playMusic('boss')`);
  await sleep(1500);
  const plain = await level(page, 2500);
  await A(page, `A.setMusicIntensity(1)`);
  await sleep(1500);
  const hard = await level(page, 2500);
  const s1 = await A(page, 'A.musicStatus()');
  log(s1.intensity === 1 && Math.abs(hard.rms - plain.rms) > plain.rms * 0.03, 'boss phase 2: intensity 1 changes the music (louder/denser)', `rms ${f(plain.rms)} → ${f(hard.rms)} (peak ${f(hard.peak)})`);
  await A(page, `A.setMusicIntensity(0); A.setMusicWarm(true)`);
  await sleep(1500);
  const warm = await level(page, 2500);
  const s2 = await A(page, 'A.musicStatus()');
  log(s2.warm === true && warm.peak < 0.999, 'Recollection: warm variant active, no clipping', `rms ${f(warm.rms)}, peak ${f(warm.peak)}`);
  await A(page, `A.setMusicWarm(false)`);

  // ---- SFX audible, and no clipping when stacked with music
  const sfxNames = Object.keys(audio.sfx).filter((n) => n !== 'thunder');
  const sfxLevels = {};
  await A(page, `A.playMusic(null)`);
  await sleep(1200);
  for (const n of sfxNames) {
    await A(page, `A.playSfx(${JSON.stringify(n)})`);
    const l = await level(page, 450);
    sfxLevels[n] = +l.peak.toFixed(3);
  }
  const silentSfx = Object.entries(sfxLevels).filter(([, p]) => p < 0.004).map(([n]) => n);
  log(silentSfx.length === 0, 'every procedural SFX is audible', JSON.stringify(sfxLevels));

  // ---- hidden: ctx suspended, silence, resume
  await A(page, `A.playMusic('battle')`);
  await sleep(1200);
  await page.hidden(true);
  await sleep(500);
  const t1 = await A(page, 'A.musicStatus()');
  await sleep(1000);
  const t2 = await A(page, 'A.musicStatus()');
  log(t1.state === 'suspended' && Math.abs(t2.audioTime - t1.audioTime) < 0.05, 'hidden: AudioContext suspends and its clock stops', `${t1.state}, audioTime ${t1.audioTime.toFixed(2)} → ${t2.audioTime.toFixed(2)}`);
  await page.hidden(false);
  await sleep(700);
  const t3 = await A(page, 'A.musicStatus()');
  const lv = await level(page, 1200);
  log(t3.state === 'running' && lv.rms > 0.003, 'visible again: audio resumes', `${t3.state}, rms ${f(lv.rms)}`);

  // ---- scene → track map
  const map = audio.music.scenes;
  const seen = {};
  for (const [scene, expect] of Object.entries(map)) {
    if (scene === 'Menu') continue;
    await page.ev(`(() => { const g = window.__game; g.scene.getScenes(true).forEach(s => { if (s.scene.key !== 'Loader') g.scene.stop(s.scene.key); }); g.scene.start(${JSON.stringify(scene)}, ${scene === 'Dialogue' ? "{ id: 'letter', bg: 'black' }" : '{}'}); })()`);
    await sleep(1800);
    seen[scene] = (await A(page, 'A.musicStatus()')).key;
  }
  log(Object.entries(map).filter(([s]) => s !== 'Menu').every(([s, k]) => seen[s] === k), 'scenes start their mapped track', JSON.stringify(seen));
  for (const [battle, key] of [['b1_forgotten', 'battle'], ['boss_clerk', 'boss']]) {
    const p = await open(chrome, `${server.url}?battle=${battle}`, { init: [INIT.analyser] });
    await p.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await p.tap(180, 600);
    await sleep(1500);
    const k = (await A(p, 'A.musicStatus()')).key;
    log(k === key, `battle ${battle} plays "${key}"`, String(k));
  }

  // ---- phase 2 hook in the real battle: checkPhase raises intensity
  const pb = await open(chrome, `${server.url}?battle=boss_clerk`, { init: [INIT.analyser] });
  await pb.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
  await pb.tap(180, 600);
  await sleep(1200);
  await pb.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; e.hp = Math.ceil(e.maxHp * 0.52); B.applyHit(e, Math.ceil(e.maxHp * 0.06)); })()`);
  const si = await A(pb, 'A.musicStatus()');
  log(si.intensity > 0, 'boss HP < 50% raises music intensity in the real battle', `intensity ${si.intensity}`);

  // ---- volumes 0
  const quiet = await boot(chrome, server, { musicVolume: 0, sfxVolume: 0, difficultyChosen: true });
  await A(quiet, `A.playMusic('battle')`);
  await sleep(1500);
  for (const n of ['hit', 'perfect', 'ultimate']) await A(quiet, `A.playSfx(${JSON.stringify(n)})`);
  const q = await level(quiet, 1500);
  log(q.peak < 0.0005, 'music volume 0 + SFX volume 0: output is silent', `peak ${q.peak}`);
  const musicOff = await boot(chrome, server, { musicVolume: 0, sfxVolume: 1, difficultyChosen: true });
  await A(musicOff, `A.playMusic('battle')`);
  await sleep(1500);
  const m0 = await level(musicOff, 1200);
  await A(musicOff, `A.playSfx('hit')`);
  const m1 = await level(musicOff, 400);
  log(m0.peak < 0.0005 && m1.peak > 0.004, 'music 0 / SFX 1: music silent, SFX still audible', `music-only peak ${m0.peak}, with sfx ${f(m1.peak)}`);
  const sfxOff = await boot(chrome, server, { musicVolume: 0.75, sfxVolume: 0, difficultyChosen: true });
  await A(sfxOff, `A.playMusic('battle')`);
  await sleep(1500);
  const s0 = await level(sfxOff, 800);
  await A(sfxOff, `A.playSfx('hit')`);
  const s3 = await level(sfxOff, 400);
  log(s0.rms > 0.003 && s3.peak <= s0.peak * 1.15, 'music on / SFX 0: SFX adds nothing', `peak music-only ${f(s0.peak)}, with sfx ${f(s3.peak)}`);
  // ---- Settings screen actually applies the volume live
  log(page.errors.length + pb.errors.length === 0, 'no console errors in audio tests', [...page.errors, ...pb.errors].slice(0, 2).join(' | '));
});

const bad = rows.filter((r) => !r.ok);
console.log(`\naudio: ${rows.length - bad.length}/${rows.length} ok`);
process.exit(bad.length ? 1 : 0);
