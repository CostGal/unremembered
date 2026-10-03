// QA part F (animation timing): for every enemy attack sheet, how far from the
// ring's impact time T does the sheet's impact frame actually land, and is the
// windup frame held during the telegraph. Real clicks on the beat, N repeats.
//   node scripts/qa/timing.mjs [--repeat 3]
import { open, sleep, withBrowser } from './lib.mjs';

const repeat = process.argv.includes('--repeat') ? +process.argv[process.argv.indexOf('--repeat') + 1] : 3;
const HOOKS = `(() => {
  window.__frames = []; window.__results = [];
  window.__stub = (vals) => { const o = Math.random; let i = 0; Math.random = () => { const v = vals[i++]; if (i >= vals.length) Math.random = o; return v === undefined ? o() : v; }; };
  window.__hook = () => { const B = window.__battle; if (!B || B.__hooked) return; B.__hooked = true;
    for (const e of B.enemies) e.body.on('animationupdate', (a, f) => window.__frames.push({ key: a.key, frame: f.index - 1, t: performance.now() }));
    for (const e of B.enemies) e.body.on('animationstart', (a, f) => window.__frames.push({ key: a.key, frame: f.index - 1, t: performance.now(), start: true })); };
})()`;

const CASES = [
  { battle: 'b2_first_hollow', enemy: 0, label: 'blank punch', stub: [0, 0.25], anim: 'blank_punch', phase: 0 },
  { battle: 'b2_first_hollow', enemy: 0, label: 'blank lunge (red)', stub: [0, 0.75], anim: 'blank_lunge', phase: 0, swipe: true },
  { battle: 'b2_first_hollow', enemy: 1, label: 'hollow claw', stub: [0, 0.1], anim: 'hollow_claw', phase: 0 },
  { battle: 'b2_first_hollow', enemy: 1, label: 'hollow siphon', stub: [0, 0.99], anim: 'hollow_siphon', phase: 0 },
  { battle: 'boss_clerk', enemy: 0, label: 'clerk stamp', stub: [0, 0.1], anim: 'clerk_stamp', phase: 0 },
  { battle: 'boss_clerk', enemy: 0, label: 'clerk file_away', stub: [0, 0.9], anim: 'clerk_file_away', phase: 0 },
  { battle: 'boss_clerk', enemy: 0, label: 'clerk redact (feint)', stub: [0, 0.5], anim: 'clerk_redact', phase: 1 },
];

const rows = [];
await withBrowser(async ({ chrome, server }) => {
  const pages = {};
  for (const c of CASES) {
    if (!pages[c.battle]) {
      const p = await open(chrome, `${server.url}?battle=${c.battle}`, { init: [HOOKS] });
      // b2_first_hollow opens a battleStart dialogue overlay: tap through it. (The tutorial slow-mo now lives only in b0_duel, so tutorialSlow=false below is a no-op here.)
      const until = Date.now() + 40000;
      while (Date.now() < until && !(await p.ev(`!!(window.__battle && window.__battle.menu && window.__battle.menu.pending)`))) {
        if ((await p.scenes()).includes('Dialogue')) await p.tap(180, 560);
        await sleep(250);
      }
      await p.ev(`window.__hook(); window.__battle.hideCommandMenu(); window.__battle.tutorialSlow = false;`);
      pages[c.battle] = p;
    }
    const page = pages[c.battle];
    const out = [];
    for (let n = 0; n < repeat; n++) {
      await page.ev(`(() => { const B = window.__battle; B.heroes.forEach(h => { h.hp = h.maxHp; }); B.enemies.forEach(e => { e.hp = e.maxHp; }); B.enemies[${c.enemy}].phase = ${c.phase}; window.__frames.length = 0; window.__done = false; window.__stub(${JSON.stringify(c.stub)}); B.enemyTurn(B.enemies[${c.enemy}]).then(() => { window.__done = true; }); })()`);
      const rings = [];
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const st = await page.ev(`({ done: window.__done, rings: [...(window.__battle.qteRings || [])].map(r => ({ at: r.impactAt, red: !!r.unparryable })), now: performance.now() })`);
        for (const r of st.rings) {
          const id = Math.round(r.at);
          if (rings.some((x) => x.id === id)) continue;
          rings.push({ id, at: r.at, red: r.red, seenAt: st.now });
          const delay = Math.max(0, r.at - st.now - 6);
          setTimeout(() => (r.red ? page.swipe(180, 610, -80) : page.tap(180, 610)).catch(() => {}), delay);
        }
        if (st.done) break;
        await sleep(25);
      }
      const frames = await page.ev(`window.__frames.filter(f => f.key === '${c.anim}')`);
      const def = await page.ev(`(() => { const d = window.__battle.animationSets['${c.anim.split('_')[0]}'].animations['${c.anim.split('_').slice(1).join('_')}']; return { windup: d.windupFrame, impacts: d.impactFrames, hold: d.holdFrame, dur: d.durations_ms }; })()`);
      const impacts = def.impacts.map((f, i) => {
        const ev = frames.find((x) => x.frame === f && !x.start) || frames.find((x) => x.frame === f);
        return ev && rings[i] ? Math.round(ev.t - rings[i].at) : null;
      });
      const windupEv = frames.find((x) => x.frame === def.windup);
      const holdStart = windupEv ? windupEv.t : null;
      const holdMs = holdStart && rings[0] ? Math.round(rings[0].at - holdStart) : null;
      out.push({ impacts, holdMs, rings: rings.length });
      await sleep(900);
    }
    const all = out.flatMap((o) => o.impacts).filter((x) => x !== null);
    const worst = all.length ? all.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;
    rows.push({ label: c.label, runs: out, worst });
    console.log(`${c.label.padEnd(24)} impact frame − ring T (ms), per run: ${out.map((o) => JSON.stringify(o.impacts)).join(' ')}   worst ${worst}   windup→T ${out.map((o) => o.holdMs).join('/')} ms`);
  }
});
