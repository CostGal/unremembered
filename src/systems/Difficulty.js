import qte from '../data/qte.json';

// Difficulty = a named set of multipliers in qte.json (difficulties): parry
// window width, damage taken, enemy HP and how fast Echo comes. Story Mode
// of the spec is the "story" entry. The chosen id lives in settings.difficulty.

const D = qte.difficulties;

export function difficultyIds() {
  return D.order;
}

export function difficultyDef(settings) {
  const id = settings?.difficulty;
  return D[id] || D[D.default];
}

// A settings object may still carry the old storyMode flag (saved before the
// difficulty list existed, or written by a test): map it to an id.
export function normalizeDifficulty(settings) {
  const s = { ...settings };
  if (!D[s.difficulty]) s.difficulty = s.storyMode ? 'story' : D.default;
  // Kept in step for anything that still reads the flag.
  s.storyMode = s.difficulty === 'story';
  return s;
}
