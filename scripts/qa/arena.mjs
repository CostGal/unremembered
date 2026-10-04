// Arena (arena.json, systems/ArenaRunner.js): team select -> fight 1 -> level card -> buff pick ->
// fight 2 with HP carried -> the campfire after fight 4 -> every tier-4 bundle on screen -> the
// Recollection at Rhea level 10 -> a wipe ends the run (summary). --out <dir> saves screenshots.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../lib/cdp.mjs';
import { startServer } from '../lib/harness.mjs';

const arena = JSON.parse(readFileSync(new URL('../../src/data/arena.json', import.meta.url), 'utf8'));
const oi = process.argv.indexOf('--out');
const out = oi > 0 ? process.argv[oi + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer();
const chrome = await launchChrome();
const checks = [];
const check = (label, ok, info = '') => {
  checks.push([label, !!ok]);
  console.log(ok ? 'PASS' : 'FAIL', label, info);
};
const active = (key) => `(window.__game && window.__game.scene.isActive(${JSON.stringify(key)}))`;

try {
  const page = await chrome.newPage();
  const shot = async (name) => {
    if (out) writeFileSync(join(out, `${name}.png`), await page.screenshot({ format: 'png' }));
  };
  const battleReady = (fight) => `${active('Battle')} && !!window.__battle && !!window.__battle.arena && window.__battle.arena.fight === ${fight} && !!window.__battle.menu && !window.__battle.battleOver`;
  // Wins the fight now: the heroes' HP as given, every enemy down, the end of battle.
  const win = (hpExpr = 'h.hp') => page.eval(`(() => { const b = window.__battle; b.heroes.forEach((h) => { h.hp = ${hpExpr}; }); b.enemies.forEach((e) => { if (e.hp > 0) b.killEnemy(e); }); b.onBattleEnd('WIN'); })()`);
  // The level card: taps until it lets go (the battle scene stops).
  const passLevelCard = async () => {
    for (let t = 0; t < 40 && (await page.eval(active('Battle'))); t++) {
      await page.click(180, 320);
      await sleep(400);
    }
  };

  // ---- Team select ----
  await page.goto(`${server.url}?arena=1`);
  await page.waitFor(`${active('ArenaTeam')} && !!window.__game.scene.getScene('ArenaTeam').cards`, { timeout: 60000 });
  await sleep(800);
  await shot('01_team_empty');
  const begin0 = await page.eval(`window.__game.scene.getScene('ArenaTeam').ready()`);
  check('Begin is off until the team is picked', begin0 === false);
  const L = arena.ui.team;
  await page.click(180, L.heroFirstY);
  await sleep(250);
  await page.click(180, L.heroFirstY + L.card.spacing);
  await sleep(250);
  await page.click(180, L.supportFirstY);
  await sleep(600);
  await shot('02_team_full');
  const team = await page.eval(`(() => { const s = window.__game.scene.getScene('ArenaTeam'); return { heroes: s.heroes, support: s.support, ready: s.ready() }; })()`);
  check('tapping the cards fills two heroes and the support', team.ready && team.heroes.join() === 'rhea,dov' && team.support === 'nala', JSON.stringify(team));
  // A tap on a filled slot empties it, a tap on the card puts them back.
  const s = L.slots;
  const x0 = 180 - (s.w + s.gap);
  await page.click(x0, s.y);
  await sleep(250);
  const removed = await page.eval(`window.__game.scene.getScene('ArenaTeam').heroes.join()`);
  check('tap a filled slot to take the hero out', removed === 'dov', removed);
  await page.click(180, L.heroFirstY);
  await sleep(250);
  await page.click(L.buttons.beginX, L.buttons.y);

  // ---- Fight 1 ----
  await page.waitFor(battleReady(1), { timeout: 60000 });
  await sleep(1600);
  await shot('03_fight1');
  const f1 = await page.eval(`(() => { const b = window.__battle; return { party: b.heroes.map((h) => h.type), nala: !!b.nala, glow: !!(b.nala && b.nala.glowOn), noStory: !!b.battleDef.noStory, level: b.level, hp: b.heroes.map((h) => [h.hp, h.maxHp]) }; })()`);
  check('fight 1: the picked team, Nala with her Glow on, no story', f1.party.join() === 'dov,rhea' && f1.nala && f1.glow && f1.noStory, JSON.stringify(f1));
  await win(`h.type === 'rhea' ? h.maxHp - 20 : h.hp`);
  await page.waitFor(`${active('Battle')} && window.__battle.battleOver`, { timeout: 10000 });
  await sleep(2200);
  await shot('04_level_card');
  await passLevelCard();
  await page.waitFor(`${active('Reward')} && !!window.__game.scene.getScene('Reward').cards`, { timeout: 20000 });
  await sleep(600);
  await shot('05_buffs');
  const buffs = await page.eval(`window.__game.scene.getScene('Reward').cards.map((c) => c.id)`);
  check('buff pick offers 3 arena buffs', buffs.length === 3 && buffs.every((id) => id.startsWith('a_')), buffs.join());
  await page.eval(`(() => { const r = window.__game.scene.getScene('Reward'); r.pick(r.cards[0].id, r.cards[0].container); })()`);

  // ---- Fight 2: HP carried ----
  await page.waitFor(battleReady(2), { timeout: 30000 });
  await sleep(1200);
  const f2 = await page.eval(`(() => { const b = window.__battle; const r = b.heroes.find((h) => h.type === 'rhea'); return { lost: r.maxHp - r.hp, fragments: window.__game.registry.get('fragments'), heal: b.registry.get('runner').wounds }; })()`);
  // The after-win heal (arena.json healAfterFightPct of her max HP at the win) comes off; the buff is picked
  // after the win, so even Second Wind only heals from the next win on.
  const rheaMax1 = f1.hp[f1.party.indexOf('rhea')][1];
  const carried = Math.max(0, Math.round(20 - (rheaMax1 * arena.healAfterFightPct) / 100));
  check(`fight 2: Rhea carries what she lost (20) minus the after-win heal (${carried})`, f2.lost === carried, JSON.stringify(f2));

  // A wipe ends the run: End run -> the summary.
  await page.eval(`(() => { const b = window.__battle; b.heroes.forEach((h) => { h.hp = 0; b.markDown(h); }); b.onBattleEnd('LOSE'); })()`);
  await page.waitFor(`(window.__battle.menu.items || []).length === 1`, { timeout: 10000 });
  const lose = await page.eval(`window.__battle.menu.items.map((i) => i.label + ':' + i.value)`);
  check('lose card: only End run', lose.length === 1 && lose[0].endsWith(':end'), lose.join());
  await page.eval(`window.__battle.menu.choose('end')`);
  await page.waitFor(active('ArenaEnd'), { timeout: 10000 });
  await sleep(800);
  await shot('06_summary');
  const sum = await page.eval(`window.__game.scene.getScene('ArenaEnd').summary`);
  check('summary: 1 fight won, 1 buff', sum.won === 1 && sum.buffs.length === 1, JSON.stringify(sum));

  // ---- Campfire after fight 4 ----
  await page.goto(`${server.url}?arena=1&arenaFight=4`);
  await page.waitFor(`${active('ArenaTeam')} && !!window.__game.scene.getScene('ArenaTeam').cards`, { timeout: 60000 });
  await page.eval(`window.__game.scene.getScene('ArenaTeam').toggle('hero', 'rhea'); window.__game.scene.getScene('ArenaTeam').toggle('hero', 'dov'); window.__game.scene.getScene('ArenaTeam').toggle('support', 'nala'); window.__game.scene.getScene('ArenaTeam').tryBegin()`);
  await page.waitFor(battleReady(4), { timeout: 60000 });
  await sleep(1500);
  await shot('07_fight4');
  await win(`h.type === 'dov' ? 0 : 5`);
  await sleep(2000);
  await passLevelCard();
  await page.waitFor(`${active('Reward')} && !!window.__game.scene.getScene('Reward').cards`, { timeout: 20000 });
  await page.eval(`(() => { const r = window.__game.scene.getScene('Reward'); r.pick(r.cards[0].id, r.cards[0].container); })()`);
  await sleep(1500);
  await page.waitFor(`${active('Reward')} && !!window.__game.scene.getScene('Reward').cards && window.__game.scene.getScene('Reward').arenaStep.pool === 'campfire'`, { timeout: 20000 });
  await sleep(1200);
  await shot('08_campfire');
  const fire = await page.eval(`window.__game.scene.getScene('Reward').cards.map((c) => c.id)`);
  check('campfire offers team upgrades', fire.length === 3 && fire.every((id) => id.startsWith('c_')), fire.join());
  await page.eval(`(() => { const r = window.__game.scene.getScene('Reward'); r.pick(r.cards[0].id, r.cards[0].container); })()`);
  await page.waitFor(battleReady(5), { timeout: 30000 });
  await sleep(1000);
  const f5 = await page.eval(`window.__battle.heroes.map((h) => [h.type, h.hp, h.maxHp])`);
  check('after the campfire: everyone full, Dov back up', f5.every(([, hp, max]) => hp === max), JSON.stringify(f5));

  // ---- Every tier bundle on screen, at fight 12 (level 10+: the Recollection) ----
  const tiers = arena.tiers;
  const bundles = tiers.flatMap((t, ti) => t.bundles.map((b, bi) => ({ ...b, fight: t.fromFight, name: `t${ti + 1}_${bi + 1}_${b.enemies.join('+')}` })));
  for (const b of bundles) {
    await page.eval(`(async () => {
      const { default: ArenaRunner } = await import('/src/systems/ArenaRunner.js');
      const g = window.__game;
      const runner = new ArenaRunner({ heroes: ['rhea', 'dov'], support: 'nala' });
      runner.skipTo(${b.fight});
      g.registry.set('runner', runner);
      const def = runner.battleDefFor(${b.fight}, ${JSON.stringify(b)});
      g.scene.getScenes(true).forEach((s) => { if (s.scene.key !== 'Loader') g.scene.stop(s.scene.key); });
      g.scene.start('Battle', { battleId: 'arena', battleDef: def });
    })()`);
    await page.waitFor(battleReady(b.fight), { timeout: 30000 });
    await sleep(1800);
    await shot(`10_${b.name}`);
    const lay = await page.eval(`window.__battle.enemies.map((e) => { const bnd = e.body.getBounds(); return { x: Math.round(e.container.x), l: Math.round(bnd.left), r: Math.round(bnd.right), top: Math.round(bnd.top), hp: e.hp }; })`);
    const inside = lay.every((e) => e.x >= 16 && e.x <= 344 && e.top >= 0);
    check(`bundle ${b.name} stands on screen`, inside, JSON.stringify(lay));
  }

  // Level 10: the Recollection button once Rhea's Echo is full.
  await page.eval(`(async () => {
    const { default: ArenaRunner } = await import('/src/systems/ArenaRunner.js');
    const g = window.__game;
    const runner = new ArenaRunner({ heroes: ['rhea', 'dov'], support: 'nala' });
    runner.won = 11;
    runner.xp = ${arena.levels.xpAt[9]};
    g.registry.set('runner', runner);
    const def = runner.battleDefFor(12, ${JSON.stringify(arena.tiers.at(-1).bundles[0])});
    g.scene.getScenes(true).forEach((s) => { if (s.scene.key !== 'Loader') g.scene.stop(s.scene.key); });
    g.scene.start('Battle', { battleId: 'arena', battleDef: def });
  })()`);
  await page.waitFor(battleReady(12), { timeout: 30000 });
  await sleep(1500);
  const ult = await page.eval(`(() => { const b = window.__battle; const r = b.heroes.find((h) => h.type === 'rhea'); r.echo = r.echoMax; return { level: r.level, echoMax: r.echoMax, can: b.canUltimate(r), rec: !!b.battleDef.recollection }; })()`);
  check('level 10: Rhea has 10 Echo pips and can cast the Recollection', ult.level === 10 && ult.echoMax === 10 && ult.can && ult.rec, JSON.stringify(ult));
  // Her next menu shows the Ultimate button: open a fresh one.
  await page.waitFor(`(window.__battle.menu.items || []).some((i) => i.slot === 'ultimate')`, { timeout: 30000 }).catch(() => {});
  const menu = await page.eval(`(window.__battle.menu.items || []).map((i) => i.slot + (i.enabled === false ? '(off)' : ''))`);
  await shot('11_recollection_ready');
  check('the command menu has the Ultimate slot', menu.some((m) => m.startsWith('ultimate')), menu.join());

  const errors = page.errors.filter((e) => !/Failed to load|404/.test(e));
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (err) {
  console.error(err);
  checks.push(['script', false]);
} finally {
  await chrome.close();
  await server.close();
}
const failed = checks.filter(([, ok]) => !ok);
console.log(`\narena: ${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
