import ui from '../data/ui.json';
import { isRealTexture } from './Assets.js';
import * as Fx from './Fx.js';
import { rect as viewRect } from './View.js';

const cfg = ui.keyArt;

// The Title's key art behind a menu-style screen (Menu, Settings, Credits,
// End): darkened, slowly drifting, rain and teal motes in front, a dark
// gradient toward the bottom. Without the art: just the motes on the plain
// background. Returns whether the art is there.
export function keyArtBackdrop(scene) {
  const art = isRealTexture(scene, 'title_bg');
  if (art) {
    const b = cfg.backdrop;
    const view = viewRect();
    const bg = scene.add.image(180, 320, 'title_bg').setDepth(b.depth);
    const cover = Math.max(view.w / bg.width, view.h / bg.height);
    bg.setScale(cover);
    scene.tweens.add({
      targets: bg,
      scale: cover * b.drift.zoom,
      x: 180 + b.drift.x,
      y: 320 + b.drift.y,
      duration: b.drift.ms,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.add.rectangle(view.x, view.y, view.w, view.h, Number(b.dim.color), b.dim.alpha).setOrigin(0).setDepth(b.depth);
    const g = b.gradient;
    scene.add.image(view.x, g.y, Fx.gradientTexture(scene, view.w, 640 - g.y, g.color, g.alpha)).setOrigin(0).setDepth(b.depth);
    Fx.rain(scene, cfg.rain, view);
  }
  Fx.motes(scene, cfg.motes);
  return art;
}

// A rounded glass panel (ui.glass style) drawn at x, y (centre), w × h.
// p = {fill, fillAlpha, stroke, strokeAlpha, radius}.
export function glassPanel(scene, x, y, w, h, p) {
  const g = scene.add.graphics();
  g.fillStyle(Number(p.fill), p.fillAlpha);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, p.radius);
  g.lineStyle(ui.glass.strokeW, Number(p.stroke), p.strokeAlpha);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, p.radius);
  return g;
}
