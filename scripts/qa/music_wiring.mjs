// QA: music + SFX wiring (audio.json music.placement). Runs the dev build headless and asserts the
// play/stop sequence the game REQUESTS (window.__audio.log, see Audio.js audioLog) for each scene:
//   A  ?step=0            the cutscene: a track per shot range, silence on the cs_hush_2 shot, the shot sfx
//   B  ?step=16           records_office: the track, quill_intro one-shot on Quill's first line, then the boss
//   C  ?battle=boss_clerk&level=4   boss, stage change (stop, quill_rise, boss_enraged), keepsake (the recollection
//                         track from the cutscene start through the auto-cast), victory
//   D  ?battle=b1_forgotten         LOSE: gameover; Retry: the battle track again; a level-up: memory_return
//   E  ?step=3 / ?step=9  meet_dov, the reward rest scene (rest_sad + memory_return ducking it)
//   F  engine: aliases, one-shot ducking and resume, silence, next-step prefetch + eviction
//   node scripts/qa/music_wiring.mjs [--out dir]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INIT, open, root, sleep, waitScene, withBrowser } from './lib.mjs';

const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const audio = read('src/data/audio.json');
const origin = read('src/data/cutscene_origin.json');
const dialogue = read('src/data/dialogue.json');
const pl = audio.music.placement;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const want = (k) => !only || only.includes(k);
let failed = 0;
const log = (ok, name, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const fmt = (entries) => entries.map((e) => (e.ev === 'play' ? `play ${e.key}` : e.ev === 'stop' ? 'stop' : e.ev === 'oneshot' ? `oneshot ${e.key}${e.resume ? '' : '(no resume)'}` : e.ev === 'sfx' ? `sfx ${e.name}` : e.ev === 'silence' ? `silence ${e.ms}` : e.ev)).join(', ');
const music = (entries, keepSame = false) => entries.filter((e) => ['play', 'stop', 'oneshot', 'oneshot_end', 'oneshot_stop', 'silence'].includes(e.ev) && (keepSame || !e.same));
const LOG = (page) => page.ev(`(window.__audio.log || []).map((e) => ({ ...e }))`);
const A = (page, expr) => page.ev(`(async () => { const A = window.__A || (window.__A = await import('/src/systems/Audio.js')); return ${expr}; })()`);
const sc = (page, name) => `window.__game.scene.getScene(${JSON.stringify(name)})`;
const active = (page, name) => page.ev(`window.__game.scene.isActive(${JSON.stringify(name)})`);
const unlock = async (page) => {
  await page.tap(180, 20); // any gesture unlocks the AudioContext (a tap near the top corner)
  await sleep(200);
};

await withBrowser(async ({ chrome, server }) => {
  // ============ A: the cutscene ============
  if (want('A')) {
    const page = await open(chrome, `${server.url}?step=0`, { init: [INIT.audioLog] });
    await waitScene(page, 'Cutscene');
    await page.waitFor(`!!(${sc(page, 'Cutscene')}.shots && ${sc(page, 'Cutscene')}.index >= 0)`, { timeout: 30000 });
    await unlock(page);
    const ranges = pl.cutscene_origin.ranges;
    const expectAt = (i) => {
      const r = ranges.find((x) => i >= x.from && i <= x.to);
      return i === r.from ? r.track : undefined;
    };
    const rows = [];
    const total = origin.shots.length;
    log(ranges.at(-1).to === total - 1, `placement ranges cover all ${total} shots`);
    // The scene is on some shot already (the first tap may have advanced it): go to the end shot by shot.
    let seen = 0;
    await page.ev(`(() => { const s = ${sc(page, 'Cutscene')}; s.time.paused = true; s.shotTimer && s.shotTimer.remove(); })()`);
    // Restart from shot 0 deterministically: jump the scene index back and walk forward.
    await page.ev(`(() => { const s = ${sc(page, 'Cutscene')}; window.__audio.log.length = 0; s.musicTrack = undefined; s.index = -1; s.done = false; })()`);
    for (let i = 0; i < total; i++) {
      const before = (await LOG(page)).length;
      await page.ev(`(() => { const s = ${sc(page, 'Cutscene')}; s.nextShot(); s.time.paused = true; s.shotTimer && s.shotTimer.remove(); })()`);
      await sleep(120);
      const entries = music((await LOG(page)).slice(before), true);
      rows.push({ i, entries });
    }
    const wantTrack = (i) => expectAt(i);
    const bad = [];
    for (const { i, entries } of rows) {
      const want = wantTrack(i);
      const plays = entries.filter((e) => e.ev === 'play' || e.ev === 'stop');
      if (want === undefined) {
        if (plays.length) bad.push(`shot ${i}: unexpected ${fmt(plays)}`);
      } else if (want === null) {
        if (!(plays.length === 1 && plays[0].ev === 'stop')) bad.push(`shot ${i}: want stop, got ${fmt(plays) || 'nothing'}`);
      } else if (!(plays.length === 1 && plays[0].ev === 'play' && plays[0].key === want)) bad.push(`shot ${i}: want play ${want}, got ${fmt(plays) || 'nothing'}`);
    }
    log(bad.length === 0, 'cutscene: one play per range start (cs_golden / cs_war / cs_fall / cs_hush), stop on the cs_hush_2 shot, cs_forgotten after', bad.join(' | '));
    const seq = rows.flatMap((r) => r.entries.filter((e) => e.ev === 'play' || e.ev === 'stop').map((e) => `${r.i}:${e.ev === 'play' ? e.key : 'stop'}`));
    console.log('  observed: ' + seq.join('  '));
    const hushIdx = origin.shots.findIndex((s) => s.bg === 'cs_hush_2');
    log(hushIdx === ranges.find((r) => r.track === null).from, `the silence range starts on the cs_hush_2 shot (index ${hushIdx})`);
    // sfx per shot
    const sfxLog = [];
    const page2 = await open(chrome, `${server.url}?step=0`, { init: [INIT.audioLog] });
    await waitScene(page2, 'Cutscene');
    await page2.waitFor(`!!(${sc(page2, 'Cutscene')}.shots && ${sc(page2, 'Cutscene')}.index >= 0)`, { timeout: 30000 });
    await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; s.time.paused = true; s.shotTimer && s.shotTimer.remove(); window.__audio.log.length = 0; s.index = -1; })()`);
    const sfxByShot = {};
    for (let i = 0; i < total; i++) {
      const before = (await LOG(page2)).length;
      await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; s.nextShot(); s.time.paused = true; s.shotTimer && s.shotTimer.remove(); })()`);
      await sleep(100);
      sfxByShot[i] = (await LOG(page2)).slice(before).filter((e) => e.ev === 'sfx').map((e) => e.name);
    }
    const sfxAt = (i, names) => names.every((n) => sfxByShot[i].includes(n));
    const idx = (bg) => origin.shots.findIndex((s) => s.bg === bg);
    log(sfxAt(6, ['sfx_war_horn']) && sfxAt(7, ['sfx_crystal_resonance']) && sfxAt(8, ['sfx_crowd_murmur']) && !sfxByShot[9].includes('sfx_crowd_murmur') && sfxAt(10, ['sfx_bell_toll']), 'sfx: war_horn on shot 7, crystal_resonance 8, crowd_murmur on 9 only, bell_toll 11 (story numbering)', JSON.stringify([6, 7, 8, 9, 10].map((i) => sfxByShot[i])));
    log(sfxAt(idx('cs_statue_2'), ['sfx_stone_crumble']), 'sfx: stone_crumble on the cs_statue_2 shot (13 -> 14 change)', JSON.stringify(sfxByShot[idx('cs_statue_2')]));
    log(sfxAt(idx('cs_hush_1'), ['hush', 'sfx_scream_crowd']), 'sfx: hush + scream_crowd on the cs_hush_1 shot (list)', JSON.stringify(sfxByShot[idx('cs_hush_1')]));
    await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; s.index = ${idx('cs_statue_2')} - 1; s.nextShot(); })()`);
    await sleep(300);
    const statue = await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; const p = s.pictures[0]; return { shot: s.index, key: p && p.texture.key, scale: p && p.scale, y: p && p.y }; })()`);
    log(statue.key === 'cs_statue_2' && statue.shot === 13, 'statue: shot 14 (index 13) draws cs_statue_2 (focus zoom applied)', JSON.stringify(statue));
    // the hush crossfade picture exists on that shot
    await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; s.index = ${idx('cs_hush_1')} - 1; s.nextShot(); })()`);
    await sleep(300);
    const pics = await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; return s.pictures.map((p) => ({ key: p.texture.key, alpha: p.alpha })); })()`);
    log(pics.length === 2 && pics[0].key === 'cs_hush_1' && pics[1].key === 'cs_hush_mid' && pics[1].alpha === 0, 'hush shot: cs_hush_1 with cs_hush_mid waiting above it at alpha 0 (fades in at 55%)', JSON.stringify(pics));
    const fxList = await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; return s.resolveShot(s.shots[s.index]).fx; })()`);
    log(!fxList.includes('lights_out') && fxList.includes('shake') && fxList.includes('red_surge'), 'hush shot with real art: no lights_out (shake + red_surge)', JSON.stringify(fxList));
    // Headless frames are slow and Phaser's clock lags the wall clock: wait for the tween, not for a fixed time.
    await page2.waitFor(`(() => { const s = ${sc(page2, 'Cutscene')}; return !!s.pictures[1] && s.pictures[1].alpha === 1; })()`, { timeout: 60000 }).catch(() => {});
    const alpha = await page2.ev(`(() => { const s = ${sc(page2, 'Cutscene')}; return s.pictures[1] && s.pictures[1].alpha; })()`);
    log(alpha === 1, 'cs_hush_mid fades fully in (at 55% of the shot, over 700 ms)', String(alpha));
    log(page.errors.length + page2.errors.length === 0, 'no console errors (cutscene)', [...page.errors, ...page2.errors].slice(0, 2).join(' | '));
  }

  // ============ B: records_office -> quill_intro -> boss ============
  if (want('B')) {
    const page = await open(chrome, `${server.url}?step=16`, { init: [INIT.audioLog] });
    await waitScene(page, 'Dialogue');
    await page.waitFor(`!!(${sc(page, 'Dialogue')}.lines && ${sc(page, 'Dialogue')}.index >= 0)`, { timeout: 30000 });
    await unlock(page);
    const lines = dialogue.records_office;
    const first = lines.findIndex((l) => l.speaker === 'Quill');
    let at = null;
    const bgKey = await page.ev(`${sc(page, 'Dialogue')}.bgKey`);
    log(bgKey === 'records_office_room', 'records_office dialogue uses the cover key records_office_room', String(bgKey));
    let guard = 0;
    while (guard++ < 60 && (await active(page, 'Dialogue'))) {
      const idx = await page.ev(`${sc(page, 'Dialogue')}.index`);
      if (idx > first + 1) break;
      await page.ev(`${sc(page, 'Dialogue')}.onTap()`);
      await sleep(80);
    }
    const all = await LOG(page);
    const seq = music(all);
    const oneIdx = seq.findIndex((e) => e.ev === 'oneshot');
    log(seq[0]?.ev === 'play' && seq[0].key === pl.dialogue.records_office, `records_office starts "${pl.dialogue.records_office}" (alias of ${audio.music.aliases.records_office})`, fmt(seq));
    log(oneIdx > 0 && seq[oneIdx].key === 'quill_intro' && seq[oneIdx].resume === false && seq.filter((e) => e.ev === 'oneshot').length === 1, 'quill_intro one-shot (no resume) when Quill first speaks, once', fmt(seq));
    const st = await A(page, 'A.musicStatus()');
    log(st.key === null && st.oneShot === 'quill_intro', 'after it the dialogue music is gone (silence until the battle), the one-shot plays', JSON.stringify({ key: st.key, oneShot: st.oneShot }));
    // run to the end -> boss battle starts "boss"
    while (guard++ < 200 && (await active(page, 'Dialogue'))) {
      await page.ev(`${sc(page, 'Dialogue')}.onTap()`);
      await sleep(40);
    }
    await waitScene(page, 'Battle');
    await sleep(900);
    const seq2 = music(await LOG(page));
    const iBoss = seq2.findIndex((e, i) => e.ev === 'play' && e.key === 'boss' && i > oneIdx);
    log(iBoss > oneIdx && seq2.filter((e) => e.ev === 'play' && e.key === 'boss').length === 1, 'the boss battle starts "boss" once (cutting the unfinished quill_intro)', fmt(seq2.slice(-3)));
    const all2 = await LOG(page);
    const kept = all2.filter((e) => e.ev === 'keep' || e.ev === 'prefetch');
    console.log('  observed: ' + fmt(seq2));
    console.log('  prefetch/keep: ' + kept.map((e) => `${e.ev} ${JSON.stringify(e.keys)}${e.dropped ? ' dropped ' + JSON.stringify(e.dropped) : ''}`).join(' | '));
    log(page.errors.length === 0, 'no console errors (records_office)', page.errors.slice(0, 2).join(' | '));
  }

  // ============ C: the boss ============
  if (want('C')) {
    const page = await open(chrome, `${server.url}?battle=boss_clerk&level=4`, { init: [INIT.audioLog] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await unlock(page);
    await page.waitFor(`!!(window.__battle.menu && window.__battle.menu.pending)`, { timeout: 40000 });
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.heroes.forEach((h) => { h.hp = h.maxHp; }); })()`);
    const mark = async () => (await LOG(page)).length;
    const since = async (n) => music((await LOG(page)).slice(n));
    let m0 = 0;
    let s = music(await LOG(page));
    log(s.length >= 1 && s[0].ev === 'play' && s[0].key === 'boss', 'boss starts "boss"', fmt(s));
    // stage 1 -> 0
    m0 = await mark();
    await page.ev(`(() => { const B = window.__battle; B.chain = 0; B.applyHit(B.enemies[0], 999); window.__done = null; B.afterTurn().then(() => { window.__done = true; }); })()`);
    const tapThrough = async () => {
      for (let i = 0; i < 80 && (await active(page, 'Dialogue')); i++) {
        await page.tap(180, 560);
        await sleep(260);
      }
    };
    const waitDialogue = async (id) => {
      for (let i = 0; i < 300; i++) {
        if ((await active(page, 'Dialogue')) && (await page.ev(`${sc(page, 'Dialogue')}.dialogueId`)) === id) return true;
        await sleep(60);
      }
      return false;
    };
    await waitDialogue('quill_rise');
    s = await since(m0);
    log(s.length === 1 && s[0].ev === 'stop', 'stage change: the boss track stops when Quill falls (before the dialogue)', fmt(s));
    await tapThrough();
    await page.waitFor(`window.__done === true`, { timeout: 20000 });
    s = await since(m0);
    const f = fmt(s);
    const tl = (await LOG(page)).filter((e) => e.ev === 'oneshot' || (e.ev === 'play' && e.key === 'boss_enraged'));
    log(f.startsWith('stop, oneshot quill_rise(no resume), play boss_enraged'), `stage change sequence: stop, quill_rise stinger, boss_enraged (${tl.length === 2 ? tl[1].t - tl[0].t : '?'} ms after the stinger)`, f);
    const st = await A(page, 'A.musicStatus()');
    log(st.id === 'boss' && st.key === 'boss_enraged', 'boss_enraged is the boss file (alias) playing', JSON.stringify({ key: st.key, id: st.id }));
    // keepsake: the recollection track starts with the cutscene and plays on through the auto-cast to the kill
    await page.ev(`window.__battle.recollectionForce = 'PERFECT'`); // the cast runs by itself: forced beats (no input)
    m0 = await mark();
    await page.ev(`(() => { const B = window.__battle; const e = B.enemies[0]; B.chain = 0; B.applyHit(e, Math.ceil(e.maxHp * 0.7)); window.__done = null; B.afterTurn().then(() => { window.__done = true; }); })()`);
    const ok = await waitDialogue('keepsake_burn');
    log(ok, 'the keepsake_burn dialogue plays after the HP threshold');
    s = await since(m0);
    log(s.length === 1 && s[0].ev === 'play' && s[0].key === pl.overlay.keepsake_burn.track && pl.overlay.keepsake_burn.loop === true, `the "${pl.overlay.keepsake_burn.track}" track starts with the keepsake cutscene (a loop: no one-shot, no duck)`, fmt(s));
    // the file decodes first: the track is "current" a moment after the request
    for (let i = 0; i < 80 && (await A(page, 'A.musicStatus()')).key !== 'recollection'; i++) await sleep(100);
    const stk = await A(page, 'A.musicStatus()');
    log(stk.key === 'recollection' && stk.oneShot === null && stk.duck === 1, 'it plays at full level under the dialogue', JSON.stringify({ key: stk.key, oneShot: stk.oneShot, duck: stk.duck }));
    for (let i = 0; i < 80 && (await active(page, 'Dialogue')); i++) {
      await page.ev(`${sc(page, 'Dialogue')}.onTap()`);
      await sleep(60);
    }
    s = await since(m0);
    log(fmt(s) === 'play recollection', 'no silence line, no change through the whole dialogue', fmt(s));
    // the Recollection casts itself right after: cut-in, forced beats, finisher, kill
    await page.waitFor(`window.__done === true`, { timeout: 60000 });
    s = await since(m0);
    log(fmt(s) === 'play recollection', 'nothing else plays through the auto-cast and the kill (the same track is not restarted, the stage track does not come back)', fmt(s));
    const rcs = (await LOG(page)).filter((e) => e.ev === 'play' && e.key === 'recollection');
    log(rcs.length === 2 && rcs[1].same === true, 'the cast asks for "recollection" again: a no-op while it plays (same track, not restarted)', JSON.stringify(rcs.map((e) => e.same)));
    // victory
    m0 = await mark();
    await page.ev(`window.__battle.onBattleEnd('WIN')`);
    await sleep(500);
    s = await since(m0);
    log(fmt(s) === 'oneshot victory(no resume)', 'WIN: the victory jingle (battle music fades)', fmt(s));
    const full = music(await LOG(page));
    console.log('  observed: ' + fmt(full));
    log(page.errors.length === 0, 'no console errors (boss)', page.errors.slice(0, 2).join(' | '));
  }

  // ============ D: LOSE / retry / level-up ============
  if (want('D')) {
    const page = await open(chrome, `${server.url}?battle=b1_forgotten`, { init: [INIT.audioLog] });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    await unlock(page);
    await sleep(800);
    let m0 = (await LOG(page)).length;
    await page.ev(`window.__battle.onBattleEnd('LOSE')`);
    await sleep(500);
    let s = music((await LOG(page)).slice(m0));
    log(fmt(s) === 'oneshot gameover(no resume)', 'LOSE: the gameover jingle, music stopped', fmt(s));
    m0 = (await LOG(page)).length;
    await page.ev(`window.__battle.retry()`);
    await sleep(1200);
    s = music((await LOG(page)).slice(m0));
    log(s.some((e) => e.ev === 'play' && e.key === 'battle'), 'Retry: the battle track starts again (cuts the jingle)', fmt(s));
    // level-up -> memory_return
    await page.ev(`(() => { const B = window.__battle; B.registry.set('recallXp', 0); })()`);
    m0 = (await LOG(page)).length;
    await page.ev(`(() => { const B = window.__battle; B.showRecall(); })()`);
    await sleep(500);
    s = music((await LOG(page)).slice(m0));
    const levels = read('src/data/levels.json');
    log(s.length === 0 || fmt(s) === 'oneshot memory_return(no resume)', 'Recall card: memory_return only when a level is gained (this one: ' + (s.length ? 'level-up, jingle' : 'no level-up, silent') + ')', fmt(s));
    log(page.errors.length === 0, 'no console errors (lose/retry)', page.errors.slice(0, 2).join(' | '));
  }

  // ============ E: meet_dov, reward rest, battles ============
  if (want('E')) {
    const page = await open(chrome, `${server.url}?step=3`, { init: [INIT.audioLog] });
    await waitScene(page, 'Dialogue');
    await page.waitFor(`(window.__audio.log || []).some((e) => e.ev === 'play')`, { timeout: 60000 });
    let s = music(await LOG(page));
    log(s[0]?.ev === 'play' && s[0].key === 'meet_dov', 'meet_dov dialogue plays "meet_dov"', fmt(s));
    const p2 = await open(chrome, `${server.url}?step=9`, { init: [INIT.audioLog] });
    await waitScene(p2, 'Reward');
    await p2.waitFor(`(window.__audio.log || []).some((e) => e.ev === 'oneshot')`, { timeout: 60000 });
    s = music(await LOG(p2));
    log(fmt(s) === 'play rest_sad, oneshot memory_return', 'reward_rest: rest_sad with memory_return (ducking it, resume)', fmt(s));
    const st = await A(p2, 'A.musicStatus()');
    console.log('  status: ' + JSON.stringify({ key: st.key, oneShot: st.oneShot, duck: st.duck }));
    // battle keys
    const battles = read('src/data/battles.json');
    const expect = { b0_duel: 'battle_duel', b1_forgotten: 'battle', b2_first_hollow: 'battle_hollow', b3_gate: 'battle_gate', boss_clerk: 'boss' };
    for (const [id, key] of Object.entries(expect)) {
      log(battles[id].music === key, `battles.json ${id} music = ${key}`, String(battles[id].music));
    }
    log(p2.errors.length + page.errors.length === 0, 'no console errors (dialogue/reward)', [...page.errors, ...p2.errors].slice(0, 2).join(' | '));
  }

  // ============ F: engine ============
  if (want('F')) {
    const page = await open(chrome, server.url, { init: [INIT.audioLog, INIT.analyser] });
    await waitScene(page, 'Title');
    await sleep(500);
    await page.tap(180, 300);
    await waitScene(page, 'Menu');
    await sleep(500);
    log((await A(page, 'A.musicStatus()')).key === 'title', 'Title/Menu play "title"');
    // alias
    const waitKey = async (key) => {
      for (let i = 0; i < 60; i++) {
        if ((await A(page, 'A.musicStatus()')).key === key) return;
        await sleep(100);
      }
    };
    await A(page, `A.playMusic('street')`);
    await waitKey('street');
    let st = await A(page, 'A.musicStatus()');
    log(st.key === 'street' && st.id === audio.music.aliases.street, `alias: street -> ${audio.music.aliases.street}`, JSON.stringify({ key: st.key, id: st.id }));
    // one-shot (procedural, resume) ducks and restores
    await A(page, `A.playMusic('battle')`);
    await waitKey('battle');
    await A(page, `A.playOneShot('quill_rise', { duck: 0.3, resume: true })`);
    await sleep(500);
    st = await A(page, 'A.musicStatus()');
    log(st.oneShot === 'quill_rise' && st.key === 'battle' && Math.abs(st.duck - 0.3) < 0.02, 'one-shot (resume): music ducks to 0.3 while it plays', JSON.stringify({ oneShot: st.oneShot, duck: st.duck }));
    await sleep(6500);
    st = await A(page, 'A.musicStatus()');
    const lg = (await LOG(page)).filter((e) => e.ev === 'oneshot_end');
    log(st.oneShot === null && st.key === 'battle' && st.duck > 0.97 && lg.length === 1, 'the procedural one-shot ends by itself and the music is restored', JSON.stringify({ oneShot: st.oneShot, duck: st.duck }));
    // file one-shot, no resume
    await A(page, `A.playOneShot('quill_intro', { duck: 0.3, resume: false })`);
    await sleep(1500);
    st = await A(page, 'A.musicStatus()');
    log(st.oneShot === 'quill_intro' && st.key === null, 'one-shot (no resume): the music fades out, the file plays', JSON.stringify({ oneShot: st.oneShot, key: st.key }));
    // every file track loops: title (11.3 s) is still playing, looping, after its length
    await A(page, `A.playMusic('title')`);
    await waitKey('title');
    let ft = (await A(page, 'A.musicStatus()')).file;
    log(ft && ft.loop === true && ft.loopStart === 0 && Math.abs(ft.loopEnd - ft.duration) < 0.01, 'file track loops over its whole length (loop, loopStart 0, loopEnd = duration)', JSON.stringify(ft));
    for (let i = 0; i < 200 && (!ft || ft.elapsed < ft.duration + 1.5); i++) {
      await sleep(250);
      ft = (await A(page, 'A.musicStatus()')).file;
    }
    log(ft && ft.elapsed > ft.duration + 1 && ft.ended === false && ft.loop === true, `title still playing ${ft && ft.elapsed.toFixed(1)} s in (file ${ft && ft.duration.toFixed(1)} s): it restarted instead of ending`, JSON.stringify(ft));
    // file SFX stop with a fade
    await A(page, `A.playSfx('sfx_crowd_murmur')`);
    await sleep(800);
    const n1 = (await A(page, 'A.musicStatus()')).sfxPlaying;
    await A(page, `A.stopAllSfx(400)`);
    await sleep(900);
    const n2 = (await A(page, 'A.musicStatus()')).sfxPlaying;
    log(n1 >= 1 && n2 === 0, 'stopAllSfx(400) fades the playing file SFX out and stops them', `${n1} -> ${n2}`);
    // silence
    await A(page, `A.playMusic(null)`);
    await sleep(900);
    st = await A(page, 'A.musicStatus()');
    log(st.oneShot === null && st.key === null, 'playMusic(null) fades everything to silence (one-shot too)');
    // musicSilence gate
    const t0 = Date.now();
    await A(page, `A.musicSilence(1500)`);
    await A(page, `A.playMusic('battle')`);
    await sleep(500);
    st = await A(page, 'A.musicStatus()');
    log(st.key === null, 'during musicSilence a requested track waits', String(st.key));
    await sleep(1800);
    st = await A(page, 'A.musicStatus()');
    log(st.key === 'battle', 'and starts once the silence is over', `${Date.now() - t0} ms`);
    // prefetch policy + eviction: decoded buffers are bounded
    await A(page, `A.keepMusic(['battle'])`);
    st = await A(page, 'A.musicStatus()');
    log(st.resident.every((k) => ['title', 'battle'].includes(k)), 'keepMusic frees every decoded track not needed', JSON.stringify(st.resident));
    const pf = (await LOG(page)).filter((e) => e.ev === 'prefetch');
    log(JSON.stringify(pf[0]?.keys) === JSON.stringify(audio.music.bootPrefetch), 'boot prefetch is only the title (next-step policy)', JSON.stringify(pf[0]?.keys));
    log(page.errors.length === 0, 'no console errors (engine)', page.errors.slice(0, 2).join(' | '));
  }
});

function duration55(shot) {
  return (shot.durationMs || 4500) * shot.crossfadeTo.atPct;
}

console.log(`\nmusic wiring: ${failed ? failed + ' failed' : 'all ok'}`);
process.exit(failed ? 1 : 0);
