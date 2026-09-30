const KEY = 'unremembered:settings';

const DEFAULTS = {
  musicVolume: 1,
  sfxVolume: 1,
  storyMode: false,
  // Set once the first New Game asked "How do you like your fights?".
  difficultyChosen: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    // localStorage unavailable — settings just won't persist
  }
}
