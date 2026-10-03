import ui from '../data/ui.json';
import { JAM } from './Jam.js';

// Full screen on phones that allow it (Android Chrome and most Android
// browsers: the Fullscreen API, which must be called inside a tap). iOS
// Safari and the Instagram in-app browsers can't fullscreen a canvas: there
// the Title shows what works instead (Add to Home Screen, which launches the
// game full screen through the web manifest; or open in the real browser).

const cfg = ui.title.fullscreen;
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

export const isIOS = () => /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInAppBrowser = () => /Instagram|FBAN|FBAV|FB_IAB|Messenger|Line\//i.test(UA);

// Launched from the home screen (manifest display: fullscreen / standalone).
export function isStandalone() {
  try {
    return navigator.standalone === true || ['fullscreen', 'standalone'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
  } catch (err) {
    return false;
  }
}

export function canFullscreen() {
  if (JAM) return false; // the host page owns full screen (iframe)
  const el = document.documentElement;
  return !isIOS() && !!((document.fullscreenEnabled && el.requestFullscreen) || (document.webkitFullscreenEnabled && el.webkitRequestFullscreen));
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// Must run inside a user gesture. Failures (in-app WebViews) are silent.
export function requestFullscreen() {
  if (JAM) return;
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {
    // not allowed here
  }
}

export function exitFullscreen() {
  try {
    const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {
    // nothing to leave
  }
}

// The player's choice (settings.fullscreen, default on): enter full screen on
// the Title tap where the browser allows it.
export function wantsFullscreen(settings) {
  return settings?.fullscreen !== false && canFullscreen() && !isStandalone();
}

// What the Title shows at the bottom: a toggle where full screen works, a
// one-line tip where it can't, nothing once the game runs from the home screen.
export function titleLine(settings) {
  if (JAM) return null; // no "Fullscreen" toggle, no iOS / in-app tips
  if (isStandalone() || isFullscreen()) return null;
  if (canFullscreen()) return { toggle: true, text: settings?.fullscreen !== false ? cfg.on : cfg.off };
  if (isInAppBrowser()) return { toggle: false, text: cfg.inApp };
  if (isIOS()) return { toggle: false, text: cfg.ios };
  return null;
}
