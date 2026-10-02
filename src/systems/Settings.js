import { normalizeDifficulty } from './Difficulty.js';

const KEY = 'unremembered:settings';

// Fresh-install defaults: full music and SFX, Normal difficulty.
const DEFAULTS = {
  musicVolume: 1,
  sfxVolume: 1,
  difficulty: 'normal',
  font: 'pixelify',
  lang: 'en',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return normalizeDifficulty({ ...DEFAULTS });
    return normalizeDifficulty({ ...DEFAULTS, ...JSON.parse(raw) });
  } catch (err) {
    return normalizeDifficulty({ ...DEFAULTS });
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeDifficulty(settings)));
  } catch (err) {
    // localStorage unavailable — settings just won't persist
  }
}
