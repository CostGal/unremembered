// QA: the dev dialogue / cutscene editor (?editor). Headless desktop Chromium:
//  1. opens ?editor, selects after_duel line 2 and origin shot 22 through the sidebar,
//  2. edits their text in the form and checks the REAL scenes' preview text follows,
//  3. edits portrait / bg / sfx / transition / fx / tint / duration through the form controls,
//  4. downloads both files and compares them with the source in node: equal except the edits,
//  5. an unedited download of cutscene_origin.json is byte for byte the source file.
// Usage: node scripts/qa/editor.mjs [--out dir]   (screenshots when --out is given)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { open, root, sleep, withBrowser } from './lib.mjs';

const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
const dialogueFile = readFileSync(join(root, 'src/data/dialogue.json'), 'utf8');
const cutsceneFile = readFileSync(join(root, 'src/data/cutscene_origin.json'), 'utf8');
const dialogue = JSON.parse(dialogueFile);
const cutscene = JSON.parse(cutsceneFile);
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message.split('\n').slice(0, 14).join(' | ')}`);
  }
};

await withBrowser(async ({ chrome, server }) => {
  const page = await open(chrome, `${server.url}?editor`, { w: 1280, h: 800 });
  await page.waitFor(`!!window.__editor`, { timeout: 30000 });
  const text = (scene) => page.eval(`(() => { const s = window.__game.scene.getScene('${scene}'); return s.sys.isActive() ? (s.fullText ?? null) : null; })()`);
  const bodyShown = (scene, prop) => page.eval(`(() => { const s = window.__game.scene.getScene('${scene}'); return s.sys.isActive() && s.${prop} ? s.${prop}.text : null; })()`);
  // Clicks a sidebar row by its group title and 1-based number (a real DOM click).
  const clickRow = (group, n) =>
    page.eval(`(() => {
      const g = [...document.querySelectorAll('.ed-group')].find((d) => d.querySelector('summary').childNodes[0].textContent === ${JSON.stringify(group)});
      if (!g) return false;
      g.open = true;
      const row = [...g.querySelectorAll('.ed-row')].find((r) => r.querySelector('.n').textContent === '${n}');
      row.click();
      return true;
    })()`);
  const setValue = (selector, value, event = 'input') =>
    page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); return true; })()`);
  // Form control by its label text.
  const control = (label) =>
    `(() => { const f = [...document.querySelectorAll('#ed-panel .ed-field')].find((d) => d.querySelector('label') && d.querySelector('label').textContent === ${JSON.stringify(label)}); return f; })()`;
  const setByLabel = (label, value, event = 'change', sub = 'select, textarea, input') =>
    page.eval(`(() => { const f = ${control(label)}; const el = f.querySelector(${JSON.stringify(sub)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); return true; })()`);

  // 1. dialogue line
  assert.ok(await clickRow('after_duel', 2), 'after_duel group');
  await page.waitFor(`(() => { const s = window.__game.scene.getScene('Dialogue'); return s.sys.isActive() && s.preview && s.index === 1 && s.bodyText && s.bodyText.text === s.fullText && s.fullText.length > 0; })()`, { timeout: 30000 });
  const original = dialogue.after_duel[1];
  assert.equal(await bodyShown('Dialogue', 'bodyText'), original.text, 'preview text = source text');
  if (out) await page.shot(join(out, 'editor_dialogue.png'));

  const EDIT_LINE = 'EDITED line for the QA run.';
  await setByLabel('Text', EDIT_LINE, 'input');
  await page.waitFor(`window.__game.scene.getScene('Dialogue').bodyText && window.__game.scene.getScene('Dialogue').bodyText.text === ${JSON.stringify(EDIT_LINE)}`, { timeout: 10000 });
  // portrait / sfx / transition through their selects (preview must survive and show the portrait).
  const otherPortrait = original.portrait === 'rhea_sad' ? 'rhea_angry' : 'rhea_sad';
  await setByLabel('Portrait', otherPortrait);
  await setByLabel('Sound on this line', 'sfx_paper');
  await setByLabel('Transition after the last line', 'close');
  await setByLabel('Background change on this line', 'rest_panel_2');
  await page.waitFor(`(() => { const s = window.__game.scene.getScene('Dialogue'); return s.sys.isActive() && s.preview && s.bodyText && s.bodyText.text === s.fullText && s.bgKey === 'rest_panel_2'; })()`, { timeout: 30000 });
  await sleep(500);
  const slots = await page.eval(`(() => { const s = window.__game.scene.getScene('Dialogue'); return Object.fromEntries(Object.entries(s.portraits).map(([k, p]) => [k, { key: p.key, visible: p.image.visible }])); })()`);
  check('portrait select drives the preview', () => assert.ok(Object.values(slots).some((p) => p.key === otherPortrait && p.visible), JSON.stringify(slots)));
  if (out) await page.shot(join(out, 'editor_dialogue_edited.png'));

  // 2. cutscene shot 22
  assert.ok(await clickRow('Cutscene · origin', 22), 'cutscene group');
  await page.waitFor(`(() => { const s = window.__game.scene.getScene('Cutscene'); return s.sys.isActive() && s.preview && s.index === 21 && s.text && s.text.text === s.fullText && s.fullText.length > 0; })()`, { timeout: 30000 });
  assert.equal(await bodyShown('Cutscene', 'text'), cutscene.shots[21].text);
  const EDIT_SHOT = 'EDITED shot text for the QA run.';
  await setByLabel('Text', EDIT_SHOT, 'input');
  await page.waitFor(`window.__game.scene.getScene('Cutscene').text.text === ${JSON.stringify(EDIT_SHOT)}`, { timeout: 10000 });
  // Other shot controls: move, a second fx, tint, duration, sfx chip.
  await setByLabel('Move', 'zoom_in');
  await page.eval(`(() => { const f = ${control('Effects')}; const box = [...f.querySelectorAll('label')].find((l) => l.textContent === 'embers').querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setByLabel('Duration (ms)', '7000', 'input');
  await page.eval(`(() => { const f = ${control('Tint')}; const on = f.querySelector('input[type=checkbox]'); const c = f.querySelector('input[type=color]'); c.value = '#102030'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1200);
  if (out) await page.shot(join(out, 'editor_cutscene.png'));
  assert.equal(await page.eval(`window.__game.scene.getScene('Cutscene').index`), 21);

  // 3. keyboard: Alt+ArrowDown moves on, then back.
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))`);
  await page.waitFor(`window.__game.scene.getScene('Cutscene').index === 22`, { timeout: 15000 });
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))`);
  await page.waitFor(`window.__game.scene.getScene('Cutscene').index === 21`, { timeout: 15000 });

  // 4. download
  await page.eval(`[...document.querySelectorAll('#ed-panel .ed-btn')].find((b) => b.textContent === 'Download dialogue.json').click()`);
  const dl = await page.eval(`window.__editor.lastDownload`);
  assert.equal(dl.name, 'dialogue.json');
  const gotD = JSON.parse(dl.text);
  const expectD = structuredClone(dialogue);
  Object.assign(expectD.after_duel[1], { text: EDIT_LINE, portrait: otherPortrait, sfx: 'sfx_paper', transition: 'close', bg: 'rest_panel_2' });
  check('dialogue.json equals the source except the edits', () => assert.deepEqual(gotD, expectD));
  check('dialogue.json keeps the key order of untouched lines', () => assert.deepEqual(Object.keys(gotD), Object.keys(dialogue)));
  check('edited line keeps the original key order, new keys appended', () => assert.deepEqual(Object.keys(gotD.after_duel[1]), [...Object.keys(original), ...['transition', 'bg'].filter((k) => !(k in original))]));

  await page.eval(`[...document.querySelectorAll('#ed-panel .ed-btn')].find((b) => b.textContent === 'Download cutscene_origin.json').click()`);
  const dc = await page.eval(`window.__editor.lastDownload`);
  const gotC = JSON.parse(dc.text);
  const expectC = structuredClone(cutscene);
  Object.assign(expectC.shots[21], { text: EDIT_SHOT, move: 'zoom_in', durationMs: 7000, tint: '0x102030' });
  expectC.shots[21].fx = [...(cutscene.shots[21].fx || []), 'embers'];
  check('cutscene_origin.json equals the source except the edits', () => assert.deepEqual(gotC, expectC));
  check('cutscene_origin.json is 2-space indented JSON + newline', () => assert.equal(dc.text, `${JSON.stringify(gotC, null, 2)}\n`));

  // 4b. the draft survives a reload (a second page on the same profile restores both edits).
  await sleep(600);
  const page2 = await open(chrome, `${server.url}?editor`, { w: 1280, h: 800, fresh: false });
  await page2.waitFor(`!!window.__editor`, { timeout: 30000 });
  const restored = await page2.eval(`window.__editor.restored`);
  const restoredText = await page2.eval(`window.__editor.model.dialogue.after_duel[1].text`);
  check('a reloaded editor restores the unsaved draft', () => {
    assert.equal(restored, 2);
    assert.equal(restoredText, EDIT_LINE);
  });

  // 5. revert both edited entries, then both files must be byte for byte the sources again (cutscene) / JSON-equal (dialogue).
  await page.eval(`(() => { window.confirm = () => true; })()`);
  await page.eval(`[...document.querySelectorAll('#ed-panel .ed-btn')].find((b) => b.textContent === 'Discard all edits').click()`);
  await page.eval(`[...document.querySelectorAll('#ed-panel .ed-btn')].find((b) => b.textContent === 'Download cutscene_origin.json').click()`);
  const clean = await page.eval(`window.__editor.lastDownload`);
  check('unedited cutscene_origin.json download is byte for byte the source', () => assert.equal(clean.text, cutsceneFile));
  await page.eval(`[...document.querySelectorAll('#ed-panel .ed-btn')].find((b) => b.textContent === 'Download dialogue.json').click()`);
  const cleanD = await page.eval(`window.__editor.lastDownload`);
  check('unedited dialogue.json download parses to the source', () => assert.deepEqual(JSON.parse(cleanD.text), dialogue));

  // 6. every entry renders without a page error.
  const total = await page.eval(`window.__editor.flat().length`);
  for (let i = 0; i < total; i += 1) {
    await page.eval(`window.__editor.select(window.__editor.flat()[${i}])`);
    await sleep(40);
  }
  await sleep(1500);
  check(`stepped through all ${total} entries with no page error`, () => assert.deepEqual(page.errors, []));
  const missing = [...new Set(page.missing)];
  if (missing.length) console.log(`note: files not on disk yet (placeholders used): ${missing.join('; ')}`);
});

console.log(failed ? `\n${failed} check(s) failed` : '\neditor QA passed');
process.exit(failed ? 1 : 0);
