import { musicStatus, playMusic, setMusicIntensity, setMusicWarm, unlockAudio } from './Audio.js';
import { trackKeys } from './Music.js';

// ?music=<key>: plays one track on its own (the game stays on a black screen)
// with a small panel — track, Play/Stop, intensity, warm variant, position.
// Loaded only when that URL param is present.
export function openMusicPanel(initial) {
  const keys = trackKeys();
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:8px;right:8px;bottom:12px;z-index:30;padding:10px;font:14px monospace;color:#f1efe8;background:rgba(18,21,31,.94);border:1px solid #2a2e3d;border-radius:6px;display:flex;flex-direction:column;gap:10px';
  panel.innerHTML = `
    <div style="display:flex;gap:8px">
      <select data-k style="flex:1;min-height:44px;font:inherit;background:#0b0d14;color:inherit;border:1px solid #2a2e3d">${keys
        .map((k) => `<option value="${k}"${k === initial ? ' selected' : ''}>${k}</option>`)
        .join('')}</select>
      <button data-play style="min-width:84px;min-height:44px;font:inherit">Play</button>
      <button data-stop style="min-width:84px;min-height:44px;font:inherit">Stop</button>
    </div>
    <label style="display:flex;align-items:center;gap:8px">intensity
      <input data-i type="range" min="0" max="1" step="0.05" value="0" style="flex:1;min-height:32px">
      <span data-iv>0.00</span></label>
    <label style="display:flex;align-items:center;gap:8px"><input data-w type="checkbox" style="width:24px;height:24px"> warm (Recollection variant)</label>
    <div data-s style="font-size:12px;color:#8a8fa3;white-space:pre-wrap;word-break:break-word"></div>`;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const select = $('[data-k]');
  const slider = $('[data-i]');
  const warm = $('[data-w]');
  // The panel shares the page with the canvas: don't let panel taps reach Phaser.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());

  const apply = () => {
    setMusicIntensity(Number(slider.value));
    setMusicWarm(warm.checked);
    $('[data-iv]').textContent = Number(slider.value).toFixed(2);
  };
  $('[data-play]').addEventListener('click', () => {
    unlockAudio();
    playMusic(null);
    playMusic(select.value);
    apply();
  });
  $('[data-stop]').addEventListener('click', () => playMusic(null));
  slider.addEventListener('input', apply);
  warm.addEventListener('change', apply);
  select.addEventListener('change', () => {
    if (musicStatus().key) $('[data-play]').click();
  });

  setInterval(() => {
    const s = musicStatus();
    const pos = s.position;
    const st = s.stats;
    $('[data-s]').textContent = s.key
      ? `${s.key}${s.procedural ? '' : ' (file)'}  ${pos ? `bar ${pos.bar}/${pos.bars} ${pos.section} ${pos.chord}` : ''}\n` +
        (st ? `notes ${st.notes}  dropped ${st.dropped}  tick avg ${(st.tickMs / Math.max(1, st.ticks)).toFixed(3)} ms  max ${st.maxTickMs.toFixed(2)} ms` : '') +
        `\naudio ${s.state}`
      : `stopped  audio ${s.state}\n\ntap Play (the browser needs a tap to start sound)`;
  }, 250);
  if (import.meta.env.DEV) window.__musicPanel = panel;
}
