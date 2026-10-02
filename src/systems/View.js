import Phaser from 'phaser';
import ui from '../data/ui.json';

// The game is designed on a 360×640 canvas (x 0–360 is the design space).
// A phone whose viewport is wider than 9:16 (browser toolbars eat height,
// e.g. iPhone Chrome) would get empty bars left and right under Scale.FIT.
// Instead the logical width grows to match the viewport, up to ui.view.maxW,
// and every scene's camera is shifted so the design space stays centred:
// `pad` extra pixels show on each side, which backgrounds cover (rect()).
// Measured once at boot; a later rotation / toolbar change only re-fits.

const cfg = ui.view;

function measure() {
  const el = typeof document !== 'undefined' && document.getElementById('game');
  const vw = (el && el.clientWidth) || window.innerWidth || cfg.designW;
  const vh = (el && el.clientHeight) || window.innerHeight || cfg.designH;
  const wanted = vh > 0 ? (cfg.designH * vw) / vh : cfg.designW;
  const maxPad = Math.floor((cfg.maxW - cfg.designW) / 2);
  const pad = Phaser.Math.Clamp(Math.round((wanted - cfg.designW) / 2), 0, maxPad);
  return { w: cfg.designW + pad * 2, h: cfg.designH, pad, designW: cfg.designW, designH: cfg.designH };
}

export const VIEW = measure();

// The whole visible screen in world coordinates (x from -pad to 360 + pad).
export function rect() {
  return { x: -VIEW.pad, y: 0, w: VIEW.w, h: VIEW.h };
}

// Shifts a scene's camera so x = 0..360 sits in the middle of the wider canvas.
export function applyToScene(scene) {
  const cam = scene.cameras && scene.cameras.main;
  if (cam && VIEW.pad) cam.setScroll(-VIEW.pad, 0);
}

// Hooks every scene of the game: the camera offset is applied each time a
// scene is (re)started, right after its create().
export function install(game) {
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.scenes) {
      scene.events.on(Phaser.Scenes.Events.CREATE, () => applyToScene(scene));
      applyToScene(scene);
    }
  });
}

// Fills the side margins next to a 360 px wide image with mirrored copies of
// its edges (seamless at the seam, keeps the integer pixel scale). Returns
// the extra images (empty when there are no margins). `force` makes the copies
// even without margins: an image that drifts sideways needs them at the seams.
export function mirrorEdges(scene, image, force = false) {
  if (!VIEW.pad && !force) return [];
  const left = image.x - image.displayWidth / 2;
  const right = image.x + image.displayWidth / 2;
  const make = (x) =>
    scene.add
      .image(x, image.y, image.texture.key)
      .setDisplaySize(image.displayWidth, image.displayHeight)
      .setFlipX(!image.flipX)
      .setDepth(image.depth)
      .setAlpha(image.alpha);
  const l = make(left - image.displayWidth / 2);
  const r = make(right + image.displayWidth / 2);
  if (image.tintTopLeft !== 0xffffff || image.isTinted) {
    l.setTint(image.tintTopLeft);
    r.setTint(image.tintTopLeft);
  }
  return [l, r];
}

// Clamps a centred object of width `w` so it stays on the visible screen with
// `pad` px to spare (floating text near the edges).
export function clampX(x, w, pad = 0) {
  const half = w / 2 + pad;
  return Phaser.Math.Clamp(x, -VIEW.pad + half, VIEW.designW + VIEW.pad - half);
}
