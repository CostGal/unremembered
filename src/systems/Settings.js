const KEY = 'unremembered:settings';

const DEFAULTS = {
  // Music sits a little under the SFX by default (the SFX are what you play to).
  musicVolume: 0.75,
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
