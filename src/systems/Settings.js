import { normalizeDifficulty } from './Difficulty.js';

const KEY = 'unremembered:settings';

// Fresh-install defaults: full music and SFX, Normal difficulty.
const DEFAULTS = {
  musicVolume: 1,
  sfxVolume: 1,
  difficulty: 'normal',
  font: 'play',
  lang: 'en',
  fontVersion: 2,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return normalizeDifficulty({ ...DEFAULTS });
    const saved = JSON.parse(raw);
    // Saved before Play became the game font (fontVersion 2): every save
    // stored the old default, so the font starts over at the new one.
    if (saved.fontVersion !== DEFAULTS.fontVersion) {
      delete saved.font;
      saved.fontVersion = DEFAULTS.fontVersion;
    }
    return normalizeDifficulty({ ...DEFAULTS, ...saved });
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
