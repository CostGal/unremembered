// QA: the battle music is ONE looping source (Kostas: "music in the battles starts screeching after a while").
//   node scripts/qa/music_soak.mjs [--secs 150]
// A: ?battle=b1_forgotten&level=2&pauses=0 for --secs of real time (default 150, a loop of the file or more),
//    the heroes and enemies kept alive and Strike tapped every few seconds (every refreshHud / turn hook
//    runs): exactly one `play battle`, no stop, no restart, one live source at all times, a seamless loop
//    (loop on, loopStart / loopEnd trimmed to the audible part of the buffer).
// B: ?battle=boss_clerk&level=4: boss -> quill_rise -> boss_enraged once each, one live source afterwards.
import { INIT, open, sleep, withBrowser } from './lib.mjs';

const secs = process.argv.includes('--secs') ? Number(process.argv[process.argv.indexOf('--secs') + 1]) : 150;
let failed = 0;
const log = (ok, name, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const LOG = (page) => page.ev(`(window.__audio.log || []).map((e) => ({ ...e }))`);
const A = (page, expr) => page.ev(`(async () => { const A = window.__A || (window.__A = await import('/src/systems/Audio.js')); return ${expr}; })()`);
const music = (entries) => entries.filter((e) => ['play', 'stop', 'oneshot', 'silence'].includes(e.ev));

await withBrowser(async ({ chrome, server }) => {
  // ============ A: one battle track, 150 s ============
  {
    const page = await open(chrome, `${server.url}?battle=b1_forgotten&level=2&pauses=0`, { init: [INIT.audioLog] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await page.tap(180, 20); // the gesture that unlocks the AudioContext
    await sleep(300);
    for (let i = 0; i < 80 && (await A(page, 'A.musicStatus()')).key !== 'battle'; i++) await sleep(100);
    const first = await A(page, 'A.musicStatus()');
    log(first.key === 'battle' && first.sources === 1, 'the battle track plays from one source', JSON.stringify({ key: first.key, sources: first.sources }));
    log(!!first.file && first.file.loop === true && first.file.loopStart >= 0 && first.file.loopEnd <= first.file.duration && first.file.loopEnd > first.file.duration - 0.25, 'it loops (source.loop) between the first and the last audible sample', JSON.stringify(first.file));
    const t0 = Date.now();
    let maxSources = 1;
    let strikes = 0;
    while (Date.now() - t0 < secs * 1000) {
      // Immortal party and enemies: every turn hook keeps running; the battle never ends.
      await page.ev(`(() => { const B = window.__battle; B.heroes.forEach((h) => { h.hp = h.maxHp; }); B.enemies.forEach((e) => { e.hp = e.maxHp; }); B.refreshHud(); })()`);
      const st = await A(page, 'A.musicStatus()');
      maxSources = Math.max(maxSources, st.sources);
      if (await page.ev(`!!(window.__battle.menu && window.__battle.menu.pending)`)) {
        await sleep(400);
        await page.tap(180, 500).catch(() => {});
        strikes += 1;
      }
      await sleep(1500);
    }
    const seq = music(await LOG(page));
    const plays = seq.filter((e) => e.ev === 'play' && e.key === 'battle');
    const fin = await A(page, 'A.musicStatus()');
    log(plays.length === 1 && seq.length === 1, `${secs} s of battle (${strikes} menu taps): exactly one "play battle", no stop, no restart, nothing else`, seq.map((e) => `${e.ev}:${e.key || ''}`).join(' '));
    log(maxSources === 1 && fin.sources === 1, 'one live music source the whole time', `max ${maxSources}, now ${fin.sources}`);
    const loops = fin.file ? (fin.file.elapsed / (fin.file.loopEnd - fin.file.loopStart)).toFixed(2) : '?';
    log(!!fin.file && fin.file.loop === true && !fin.file.ended, `still looping (${loops} passes of the loop)`, JSON.stringify(fin.file));
    const warned = [...(page.warnings || [])].filter((w) => /music:/.test(w));
    log(page.errors.length === 0 && warned.length === 0, 'no console errors, no "music: ... still playing" warning from the engine', [...page.errors, ...warned].slice(0, 2).join(' | '));
  }

  // ============ B: the boss stage change ============
  {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4`, { init: [INIT.audioLog] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`, { timeout: 40000 });
    await page.tap(180, 20);
    await sleep(300);
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.heroes.forEach((h) => { h.hp = h.maxHp; }); B.chain = 0; B.applyHit(B.enemies[0], 999); window.__done = null; B.afterTurn().then(() => { window.__done = true; }); })()`);
    for (let i = 0; i < 120 && !(await page.ev(`window.__done === true`)); i++) {
      if ((await page.scenes()).includes('Dialogue')) await page.tap(180, 560);
      await sleep(250);
    }
    for (let i = 0; i < 80 && (await A(page, 'A.musicStatus()')).key !== 'boss_enraged'; i++) await sleep(100);
    await sleep(2500); // the fading boss track is gone
    const seq = music(await LOG(page));
    const f = seq.map((e) => `${e.ev}:${e.key || ''}`).join(' ');
    log(f === 'play:boss stop:boss oneshot:quill_rise play:boss_enraged', 'boss -> quill_rise -> boss_enraged, once each', f);
    const st = await A(page, 'A.musicStatus()');
    log(st.sources === 1 && st.key === 'boss_enraged', 'one live source after the stage change', JSON.stringify({ key: st.key, sources: st.sources }));
    log(page.errors.length === 0, 'no console errors', page.errors.slice(0, 2).join(' | '));
  }
});
console.log(failed ? `\n${failed} check(s) FAILED` : '\nmusic soak: all passed');
process.exit(failed ? 1 : 0);
