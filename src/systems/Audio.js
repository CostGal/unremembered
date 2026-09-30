import audioData from '../data/audio.json';

// One AudioContext for everything: procedural SFX (oscillator/noise
// envelopes from audio.json, no files) and looping music files with a
// crossfade. Missing music files = silence. Everything is suspended while
// the page is hidden.

let ctx = null;
let musicBus = null;
let sfxBus = null;
let volumes = { musicVolume: 1, sfxVolume: 1 };
let wantedMusic = null;
let current = null; // {key, source, gain}
const buffers = new Map(); // key -> Promise<AudioBuffer | null>
let noiseBuffer = null;

export function unlockAudio() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.connect(ctx.destination);
    sfxBus.connect(ctx.destination);
    applyVolumes();
    // iOS only unlocks after a sound starts inside the gesture.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);
    document.addEventListener('visibilitychange', onVisibility);
    if (wantedMusic) playMusic(wantedMusic);
  }
  if (ctx.state === 'suspended' && document.visibilityState !== 'hidden') ctx.resume().catch(() => {});
  return ctx;
}

export function getAudioContext() {
  return ctx;
}

function onVisibility() {
  if (!ctx) return;
  if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
}

export function setVolumes(settings) {
  volumes = { musicVolume: settings.musicVolume, sfxVolume: settings.sfxVolume };
  applyVolumes();
}

function applyVolumes() {
  if (!ctx) return;
  musicBus.gain.value = volumes.musicVolume;
  sfxBus.gain.value = volumes.sfxVolume;
}

// ---------- SFX ----------

export function playSfx(name) {
  const layers = audioData.sfx[name];
  if (!ctx || !layers || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  for (const layer of layers) {
    const start = now + (layer.delayMs || 0) / 1000;
    const end = start + layer.ms / 1000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(layer.gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(sfxBus);

    let source;
    if (layer.type === 'noise') {
      source = ctx.createBufferSource();
      source.buffer = getNoise();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = layer.filterHz;
      source.connect(filter);
      filter.connect(env);
    } else {
      source = ctx.createOscillator();
      source.type = layer.wave;
      source.frequency.setValueAtTime(layer.from, start);
      source.frequency.exponentialRampToValueAtTime(layer.to, end);
      source.connect(env);
    }
    source.start(start);
    source.stop(end + 0.02);
  }
}

// ---------- Dialogue voice blips ----------

let lastBlipAt = -Infinity;

// One short typewriter blip for a voice from voices.json:
// {wave, freq, slideTo?, durMs, jitter?, gain, lowpass?}. wave "noise" uses
// the shared noise buffer. Goes through the SFX bus, so the SFX volume
// setting applies. Does nothing while audio is locked/suspended, and at most
// one blip per audio.json blip.minGapMs.
export function playBlip(voice) {
  if (!voice || !ctx || ctx.state !== 'running') return;
  const nowMs = performance.now();
  if (nowMs - lastBlipAt < audioData.blip.minGapMs) return;
  lastBlipAt = nowMs;

  const start = ctx.currentTime;
  const end = start + voice.durMs / 1000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(voice.gain, start + audioData.blip.attackMs / 1000);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(sfxBus);

  let source;
  if (voice.wave === 'noise') {
    source = ctx.createBufferSource();
    source.buffer = getNoise();
  } else {
    const pitch = 1 + (Math.random() * 2 - 1) * (voice.jitter || 0);
    source = ctx.createOscillator();
    source.type = voice.wave;
    source.frequency.setValueAtTime(voice.freq * pitch, start);
    if (voice.slideTo) source.frequency.linearRampToValueAtTime(voice.slideTo * pitch, end);
  }
  if (voice.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.lowpass;
    source.connect(filter);
    filter.connect(env);
  } else {
    source.connect(env);
  }
  source.start(start);
  source.stop(end + 0.02);
}

function getNoise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// ---------- Music ----------

// The track for a scene key (audio.json music.scenes), if any.
export function playSceneMusic(sceneKey) {
  const key = audioData.music.scenes[sceneKey];
  if (key) playMusic(key);
}

// Crossfades to the looping track `key` (null = fade to silence). Asking for
// the track that is already playing does nothing.
export function playMusic(key) {
  wantedMusic = key;
  if (!ctx) return;
  if (current && current.key === key) return;

  const fade = audioData.music.crossfadeMs / 1000;
  if (current) {
    const old = current;
    const now = ctx.currentTime;
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + fade);
    old.source.stop(now + fade + 0.05);
    current = null;
  }
  if (!key) return;

  loadBuffer(key).then((buffer) => {
    if (!buffer || wantedMusic !== key || (current && current.key === key)) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    source.connect(gain);
    gain.connect(musicBus);
    source.start(now);
    current = { key, source, gain };
  });
}

function loadBuffer(key) {
  if (!buffers.has(key)) {
    const url = `${audioData.music.dir}${key}${audioData.music.ext}`;
    const promise = fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((data) => (data ? decode(data) : null))
      .catch(() => null);
    buffers.set(key, promise);
  }
  return buffers.get(key);
}

// Safari's decodeAudioData still wants callbacks. A file that isn't audio
// (e.g. a dev server's HTML fallback) decodes to null = silence.
function decode(data) {
  return new Promise((resolve) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, () => resolve(null));
      if (p && p.catch) p.catch(() => resolve(null));
    } catch (err) {
      resolve(null);
    }
  });
}
