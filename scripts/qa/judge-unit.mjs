// QA part F (pure logic): the parry judgement boundaries from CLAUDE.md,
// straight from systems/Qte.js with the numbers in data/qte.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judge, scaledWindows } from '../../src/systems/Qte.js';
import { root } from './lib.mjs';

const qte = JSON.parse(readFileSync(join(root, 'src/data/qte.json'), 'utf8'));
const w = qte.windows;
let bad = 0;
const t = (name, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${got} (want ${want})`);
};
t('windows', JSON.stringify(w), JSON.stringify({ perfectMs: 90, goodMs: 200, ignoreBeforeMs: 350 }));
for (const [dt, want] of [[0, 'PERFECT'], [90, 'PERFECT'], [-90, 'PERFECT'], [91, 'GOOD'], [-91, 'GOOD'], [200, 'GOOD'], [-200, 'GOOD'], [201, 'MISS'], [-201, 'MISS'], [-349, 'MISS'], [-350, 'MISS'], [-351, null], [-1000, null], [5000, 'MISS']]) t(`judge(${dt})`, judge(dt, w), want);
const s = scaledWindows(w, qte.storyMode.windowMult);
t('story windows', JSON.stringify([s.perfectMs, s.goodMs, s.ignoreBeforeMs]), JSON.stringify([135, 300, 350]));
for (const [dt, want] of [[135, 'PERFECT'], [136, 'GOOD'], [300, 'GOOD'], [301, 'MISS'], [-350, 'MISS'], [-351, null]]) t(`story judge(${dt})`, judge(dt, s), want);
console.log(bad ? `\n${bad} failed` : '\njudge unit: all passed');
process.exit(bad ? 1 : 0);
