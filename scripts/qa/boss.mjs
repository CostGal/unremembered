// Forces each Clerk attack (File Away, Redact feint, Archive charge + release)
// in a live boss battle and reports which animation events ran. --out = shots.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../lib/cdp.mjs';
import { startServer } from '../lib/harness.mjs';
const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer();
const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  await page.goto(`${server.url}?battle=boss_clerk`);
  await page.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 30000 });
  await sleep(1800);
  writeFileSync(join(out, 'boss_intro.png'), await page.screenshot({ format: 'png' }));
  const run = async (label, phase, rand, waitKey) => {
    await page.eval(`(() => { window.__animTrace = {}; const b = window.__battle; const e = b.enemies[0]; e.phase = ${phase}; const o = Math.random; let n = 0; Math.random = () => { if (++n >= 2) Math.random = o; return ${rand}; }; window.__p = b.enemyTurn(e).then(() => { window.__done = true; }); window.__done = false; })()`);
    let shot = false;
    for (let i = 0; i < 400; i++) {
      const st = await page.eval(`({ done: window.__done, t: Object.keys(window.__animTrace) })`);
      if (!shot && st.t.some((k) => k.startsWith(waitKey))) { await sleep(150); writeFileSync(join(out, `${label}.png`), await page.screenshot({ format: 'png' })); shot = true; }
      if (st.done) break;
      await sleep(50);
    }
    console.log(label.padEnd(18), (await page.eval(`Object.keys(window.__animTrace).join(' ')`)));
  };
  await run('file_away', 0, 0.9999, 'windup:');
  await run('redact', 1, 0.5, 'windup:');
  await run('archive_charge', 1, 0.9999, 'play:clerk_archive_charge');
  console.log('charging?', await page.eval(`!!window.__battle.enemies[0].charge`));
  await run('archive_wait', 1, 0.9999, 'zzz');
  console.log('charging?', await page.eval(`!!window.__battle.enemies[0].charge`));
  await run('archive_release', 1, 0.9999, 'windup:');
  // Brace (guard counter, fresh page): Dov braces; two enemy hits in the round are both halved, Dov earns +1 Echo
  // per hit, the attacker loses 1 poise per hit, the brace pose holds until the enemy phase ends, then it is cleared
  // (a third hit after that is full damage with no Echo). Hits go through applyParryResult directly: an unanswered
  // ring is a MISS, and the lab's forced-random enemy turns above can stall on the charge sheet under load.
  const bp = await chrome.newPage();
  await bp.goto(`${server.url}?battle=boss_clerk`);
  await bp.waitFor(`!!(window.__battle && window.__battle.menu)`, { timeout: 60000 });
  await sleep(1500);
  const poll = async (expr, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await bp.eval(expr)) return true; await sleep(250); } return false; };
  const info = `(() => { const b = window.__battle; const dov = b.heroes.find((h) => h.type === 'dov'); const rhea = b.heroes.find((h) => h.type === 'rhea'); const e = b.enemies[0]; return { b, dov, rhea, e, pose: () => dov.body.anims.currentAnim && dov.body.anims.currentAnim.key }; })()`;
  await bp.eval(`(async () => { const { b, dov } = ${info}; await b.runTechnique(dov, 'brace'); dov.echo = 1; b.enemies[0].poise = b.enemies[0].maxPoise; })()`);
  const cast = await bp.eval(`(() => { const { b, pose } = ${info}; return { brace: !!b.brace, mult: b.brace && b.brace.damageMult, pose: pose() }; })()`);
  const hitFn = (who) => `(async () => { const { b, dov, rhea, e } = ${info}; const t = ${who}; const hp = t.hp; await b.applyParryResult('MISS', e, t, { dmg: 10 }, 'tap'); return hp - t.hp; })()`;
  const lostRhea = await bp.eval(hitFn('rhea'));
  const lostDov = await bp.eval(hitFn('dov'));
  const during = await bp.eval(`(() => { const { b, dov, e } = ${info}; return { echo: dov.echo, poise: e.maxPoise - e.poise, brace: !!b.brace }; })()`);
  const held = await poll(`${info}.pose() === 'dov_brace'`);
  await bp.eval(`(async () => { await ${info}.b.endBrace(); })()`);
  const cleared = await poll(`!${info}.b.brace && ${info}.pose() !== 'dov_brace'`);
  const after = await bp.eval(`(async () => { const { b, dov, rhea, e } = ${info}; const hp = rhea.hp; const echo = dov.echo; await b.applyParryResult('MISS', e, rhea, { dmg: 10 }, 'tap'); return { lost: hp - rhea.hp, echoGain: dov.echo - echo }; })()`);
  const hasSheet = /dov_brace$/.test(cast.pose || '');
  console.log('brace lab', JSON.stringify({ cast, lostRhea, lostDov, during, held, cleared, after }));
  const checks = [
    ['Brace cast: x0.5 and the pose loop', cast.brace && cast.mult === 0.5 && hasSheet],
    ['both hits of the round halved', lostRhea === 5 && lostDov === 5],
    ['Dov +2 Echo (one per hit)', during.echo === 3],
    ['attacker poise -2', during.poise === 2],
    ['Brace and the pose hold through the hits', during.brace && held],
    ['cleared at the end of the round', cleared],
    ['next hit is full damage, no Echo', after.lost === 10 && after.echoGain === 0],
  ];
  for (const [name, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', name);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  console.log('errors:', page.errors.length + bp.errors.length, [...page.errors, ...bp.errors].slice(0, 3));
} finally { await chrome.close(); await server.close(); }
