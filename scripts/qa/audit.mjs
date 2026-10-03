// QA: the audit fixes (docs/AUDIT_UNEXPLAINED.md top 10) in the dev build.
//   node scripts/qa/audit.mjs --out dir [--lang el]
//   1  no Recollection slot in the main menu (boss), ?recollection=1 still casts (recollection.mjs)
//   7  Dov's first menu in b1: the one-time learn_anchor pause (help.steps), never again
//   8  DOWNED + revive note over a downed hero; the Recall card prints "Anchor now revives" at Recall 3
//   9  a drain pops a red "-2 Echo" over the hero
//   10 the chain hint on the first chain >= 2 in b1 (not a tutorial battle); "Turns 9 (par 7)" on the result card
//   11 "Recall n" in the HUD, "Mementos" on the reward / drop / pickup texts, "Recollection: X" on the card
// --lang el runs the same flows in Greek and checks the Greek twins (read from src/data/lang/el.json).
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { open, root, sleep, withBrowser } from './lib.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ui = read('src/data/ui.json');
const el = read('src/data/lang/el.json');
const tech = read('src/data/techniques.json');
const grade = read('src/data/grade.json');
const lv = read('src/data/levels.json');
const frag = read('src/data/fragments.json');
const slots = ui.commands.slots;
const argv = process.argv;
const out = argv[argv.indexOf('--out') + 1];
const greek = argv.includes('--lang') && argv[argv.indexOf('--lang') + 1] === 'el';
mkdirSync(out, { recursive: true });
let failed = 0;
const log = (ok, name, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

// The text the page should show: English, or the Greek overlay value at the same path.
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const tr = (path, en) => (greek ? at(el, path) ?? en : en);
const settings = greek ? { lang: 'el', fontVersion: 2 } : null;

const B = (page, expr) => page.ev(`(() => { const B = window.__battle; return ${expr}; })()`);
const texts = (page) => B(page, `B.children.list.filter((c) => c.type === 'Text' && c.active && c.visible).map((c) => c.text)`);
const hasDialogue = async (page) => (await page.scenes()).includes('Dialogue');
async function menuPending(page, timeout = 40000) {
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout });
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await hasDialogue(page)) await page.tap(180, 560);
    else if (await page.ev(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`)) return;
    await sleep(120);
  }
  throw new Error('menuPending timed out');
}

await withBrowser(async ({ chrome, server }) => {
  const base = `${server.url}?`;

  // ============ 7: Dov's first menu in b1 explains Anchor, once ============
  {
    const page = await open(chrome, `${base}battle=b1_forgotten&level=2`, { settings });
    await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 40000 });
    const seen = [];
    const end = Date.now() + 120000;
    let dovPause = null;
    let heroAtPause = null;
    let strikes = 0;
    while (Date.now() < end && strikes < 5) {
      const tp = await B(page, 'B.tutorialPause ? { id: B.tutorialPause.id, step: B.tutorialPause.step, steps: B.tutorialPause.steps } : null');
      if (tp) {
        const key = `${tp.id}:${tp.step}`;
        if (!seen.includes(key)) {
          seen.push(key);
          if (tp.id === 'learn_anchor') {
            heroAtPause ||= await B(page, 'B.activeHero && B.activeHero.type');
            dovPause = { ...(dovPause || {}), [tp.step]: await B(page, `B.children.list.filter((c) => c.type === 'Text' && c.depth > 6000).map((c) => c.text)`) };
            await sleep(500);
            await page.shot(join(out, `learn_anchor_${tp.step}.png`));
          }
        }
        await sleep(450);
        await page.tap(180, 600);
      } else if (await hasDialogue(page)) await page.tap(180, 560);
      else if (await B(page, `!!(B.menu && B.menu.pending && B.menu.items.some((i) => i.slot === 'strike'))`)) {
        await sleep(500);
        if (await B(page, `!B.tutorialPause`)) {
          strikes += 1;
          await page.tap(...slots.strike);
          await sleep(500);
          const tg = await B(page, `B.menu.items.find((i) => i.slot === 'target') ? [B.menu.items.find((i) => i.slot === 'target').x, B.menu.items.find((i) => i.slot === 'target').y] : null`);
          if (tg) await page.tap(...tg);
        }
      }
      await sleep(300);
    }
    const ids = seen.map((s) => s.split(':')[0]);
    log(ids.includes('break_intro') && ids.indexOf('learn_anchor') > ids.indexOf('break_intro'), 'b1: break_intro (Rhea\'s first menu), then learn_anchor', seen.join(' '));
    log(heroAtPause === 'dov', 'b1: learn_anchor opens on Dov\'s first command menu', String(heroAtPause));
    log(seen.filter((s) => s.startsWith('learn_anchor')).length === 2 && ids.filter((i) => i === 'learn_anchor').length === 2, 'b1: learn_anchor has 2 steps and does not come back on later menus', seen.join(' '));
    const steps = tech.anchor.help.steps.map((s) => s.replace('{amount}', '20'));
    const flat = Object.values(dovPause || {}).flat();
    log(steps.every((s) => flat.some((t) => t === s)), 'b1: the steps are anchor\'s techniques.json help.steps (English)', JSON.stringify(flat.filter((t) => /Dov|Pick/.test(t))));
    log(page.errors.length === 0, 'b1: no page errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ 8 + 9: DOWNED, revive note, -2 Echo ============
  for (const level of [2, 3]) {
    const page = await open(chrome, `${base}battle=b1_forgotten&level=${level}&pauses=0`, { settings });
    await menuPending(page);
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.chain = 0; B.applyHit(B.heroes[0], 9999); })()`);
    await sleep(250);
    const t = await texts(page);
    const note = level >= 3 ? tr('ui.downed.canRevive', ui.downed.canRevive).replace('{hero}', 'Dov') : tr('ui.downed.cantRevive', ui.downed.cantRevive);
    log(t.includes(tr('ui.downed.text', ui.downed.text)) && t.includes(note), `Recall ${level}: a downed Rhea pops "${tr('ui.downed.text', ui.downed.text)}" and "${note}"`, JSON.stringify(t.filter((x) => /DOWN|ΕΚΤΟΣ|Anchor/.test(x))));
    await page.shot(join(out, `downed_recall${level}.png`));
    if (level === 2) {
      // -2 Echo
      await page.ev(`(() => { const B = window.__battle; B.heroes[1].echo = 4; B.gainEcho(B.heroes[1], -2); })()`);
      await sleep(200);
      const t2 = await texts(page);
      const lost = tr('ui.hud.echo.lossText', ui.hud.echo.lossText).replace('{n}', 2);
      const popColor = await B(page, `(() => { const o = B.children.list.find((c) => c.type === 'Text' && c.text === ${JSON.stringify(lost)}); return o ? o.style.color : null; })()`);
      log(t2.includes(lost) && popColor === ui.hud.echo.lossColor, `a drain pops "${lost}" in ${ui.hud.echo.lossColor}`, `${popColor}`);
      await page.shot(join(out, 'echo_loss.png'));
      await page.ev(`(() => { const B = window.__battle; B.heroes[1].echo = 0; B.children.list.filter((c) => c.type === 'Text' && /Echo/.test(c.text) && c.text.startsWith('-')).forEach((c) => c.destroy()); B.gainEcho(B.heroes[1], -2); })()`);
      await sleep(150);
      log(!(await texts(page)).includes(lost), 'no pop when there was no Echo to lose');
    }
    log(page.errors.length === 0, `Recall ${level}: no page errors`, page.errors.slice(0, 2).join(' | '));
  }
  {
    // Solo Rhea (b0): the word only, nobody to anchor.
    const page = await open(chrome, `${base}battle=b0_duel&pauses=0`, { settings });
    await menuPending(page);
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.tutorialSlow = false; B.chain = 0; B.applyHit(B.heroes[0], 9999); })()`);
    await sleep(250);
    const t = await texts(page);
    log(t.includes(tr('ui.downed.text', ui.downed.text)) && !t.some((x) => /Anchor/.test(x)), 'b0 (Rhea alone): "DOWNED" and no Anchor line', JSON.stringify(t.filter((x) => /DOWN|ΕΚΤΟΣ|Anchor/.test(x))));
  }

  // ============ 10: chain hint in b1, par on the result card ============
  {
    const page = await open(chrome, `${base}battle=b1_forgotten&level=2&pauses=0`, { settings });
    await menuPending(page);
    log(await B(page, `!B.battleDef.tutorial`), 'b1 is not a tutorial battle (the chain hint is "always")');
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.updateChain('PERFECT'); B.updateChain('PERFECT'); })()`);
    let showing = await B(page, `B.hints.isShowing('chain')`);
    for (let i = 0; i < 6 && !showing; i++) {
      await sleep(1500);
      await page.ev(`window.__battle.updateChain('PERFECT')`);
      showing = await B(page, `B.hints.isShowing('chain')`);
    }
    const chainText = tr('ui.tutorial.hints.chain.text', ui.tutorial.hints.chain.text);
    await sleep(400);
    log(showing && (await texts(page)).includes(chainText), `the chain banner shows in b1: "${chainText}"`, `chain ${await B(page, 'B.chain')}`);
    await page.shot(join(out, 'chain_hint_b1.png'));
    // The result card.
    await page.ev(`(() => { const B = window.__battle; B.stats.turns = 9; B.stats.perfects = 3; B.enemies.forEach((e) => B.applyHit(e, 9999)); B.onBattleEnd('WIN'); })()`);
    const want = tr('grade.card.rows.turnsPar', grade.card.rows.turnsPar).replace('{n}', 9).replace('{par}', grade.par.b1_forgotten);
    let shown = false;
    for (let i = 0; i < 40 && !shown; i++) {
      await sleep(250);
      shown = (await texts(page)).includes(want);
    }
    log(shown, `the result card reads "${want}"`);
    await sleep(2200);
    await page.shot(join(out, 'result_card_par.png'));
    log(page.errors.length === 0, 'b1: no page errors', page.errors.slice(0, 2).join(' | '));
  }

  // ============ 8: the Recall card line at Recall 3 ============
  {
    const page = await open(chrome, `${base}battle=b1_forgotten&level=2&pauses=0`, { settings });
    await menuPending(page);
    await page.ev(`(() => { const B = window.__battle; B.hideCommandMenu(); B.recallXp = ${lv.xpAt[2] - 1}; B.onBattleEnd('INTERRUPTED'); })()`);
    const want = tr('levels.upgradeDetail.canRevive', lv.upgradeDetail.canRevive).replace('{tech}', tech.anchor.name);
    let shown = false;
    for (let i = 0; i < 60 && !shown; i++) {
      await sleep(250);
      shown = (await texts(page)).includes(want);
    }
    await sleep(1500);
    await page.shot(join(out, 'recall_card_revive.png'));
    const t = await texts(page);
    log(shown, `the Recall card at Recall 3 prints "${want}"`, JSON.stringify(t.filter((x) => /Anchor|Brace|Tremor|grows|δυναμ/.test(x))));
  }

  // ============ 11: names ============
  {
    const page = await open(chrome, `${base}battle=b0_duel&level=4&pauses=0`, { settings });
    await menuPending(page);
    const hud = (await texts(page)).filter((x) => /^(Recall|Ανάκληση) \d$/.test(x));
    const hudWant = tr('levels.text.hud', lv.text.hud).replace('{n}', 4);
    log(hud.includes(hudWant), `HUD level text "${hudWant}"`, JSON.stringify(hud));
    const rect = await B(page, `(() => { const o = B.children.list.find((c) => c.type === 'Text' && c.text === ${JSON.stringify(hudWant)}); const b = o.getBounds(); const hp = B.children.list.filter((c) => c.type === 'Text' && /^\\d+\\/\\d+$/.test(c.text)).map((c) => c.getBounds()); return { right: b.right, left: b.left, hpLeft: hp.length ? Math.min(...hp.map((r) => r.left)) : null }; })()`);
    log(rect.hpLeft === null || rect.right < rect.hpLeft - 4, `HUD level text does not collide with the HP numbers (right ${Math.round(rect.right)} < HP left ${Math.round(rect.hpLeft)})`);
    await page.shot(join(out, 'hud_recall.png'));
  }
  log(frag.screen.title.text === 'A memento returns…' && frag.dropCard.title.text === 'A memento, left behind' && frag.pickupBanner.text === 'A memento returns: {name}' && read('src/data/recollection.json').card.text === 'Recollection: {grade}', 'data: reward title / drop card / pickup say memento; the result card line says Recollection', `${frag.screen.title.text} | ${frag.dropCard.title.text}`);
});
console.log(failed ? `\n${failed} check(s) FAILED` : '\naudit lab: all passed');
process.exit(failed ? 1 : 0);
