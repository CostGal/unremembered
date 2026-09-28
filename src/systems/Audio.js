let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

export function getAudioContext() {
  return ctx;
}
