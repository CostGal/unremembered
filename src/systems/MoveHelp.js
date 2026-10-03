import levels from '../data/levels.json';
import techniques from '../data/techniques.json';
import ui from '../data/ui.json';
import { techniqueAt } from './Recall.js';

// Text for a move's help: the long-press card in the command menu and the
// "you remember a new move" pauses on the Recall card. All of it is data:
// techniques.json <id>.help {short, steps, upgrades: {level: [steps]}}.
// Tokens in the strings ({amount}, {cost}) are filled from the move as it is at
// the hero's Recall level.

const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

const varsOf = (tech) => ({ amount: tech?.amount ?? '', cost: tech?.cost ?? '', n: tech?.cost ?? '' });

// "2 Echo, 4 bolts, 20% crit": every figure that levels.upgradeDetail knows, for a move that has `levels`.
function levelDetail(tech) {
  const d = levels.upgradeDetail;
  const parts = [];
  for (const [key, str] of Object.entries(d)) {
    if (key === 'hitsSame' || key === 'target' || tech[key] === undefined) continue;
    if (key === 'amount' || (key === 'critChance' && !tech[key])) continue;
    const v = tech[key];
    const vars = key === 'hits' ? { a: v[0], b: v[1] } : key === 'critChance' ? { pct: Math.round(v * 100) } : { n: v };
    parts.push(fill(key === 'hits' && v[0] === v[1] ? d.hitsSame : str, vars));
  }
  return parts.join(', ');
}

// The card of a command-menu entry: {name, cost, short, level} or null when it has no help.
// id: a techniques.json key, or 'technique' (the submenu button, ui.commands.help.technique).
export function helpCard(id, level = 1) {
  const cfg = ui.commands.help;
  if (id === 'technique') return { name: cfg.technique.name, cost: null, short: cfg.technique.short, level: null };
  const tech = techniqueAt(id, level, techniques);
  if (!tech?.help?.short) return null;
  const hasLevels = !!techniques[id].levels && !!tech.hits; // only Blast grows in the figures a card can show
  return {
    name: tech.name,
    cost: tech.cost > 0 ? ui.commands.labels.cost.replace('{n}', tech.cost) : null,
    short: fill(tech.help.short, varsOf(tech)),
    level: hasLevels ? fill(cfg.levelLine, { n: level, detail: levelDetail(tech) }) : null,
  };
}

// The pause steps for a move the party just remembered or upgraded: the strings, or null when there are none.
export function learnSteps(id, level, upgrade) {
  const help = techniques[id]?.help;
  const list = upgrade ? help?.upgrades?.[String(level)] : help?.steps;
  if (!list?.length) return null;
  const vars = varsOf(techniqueAt(id, level, techniques));
  return list.map((s) => fill(s, vars));
}
