import ui from '../data/ui.json';
import { playSfx } from './Audio.js';

// A plain menu button in the battle-button style (ui.json commands.button).
// size = {w, h, fontSize}. Returns {container, text}.
export function makeButton(scene, x, y, size, label, onTap) {
  const b = ui.commands.button;
  const container = scene.add.container(x, y);
  const rect = scene.add.rectangle(0, 0, size.w, size.h, Number(b.fill)).setStrokeStyle(2, Number(b.stroke));
  const text = scene.add
    .text(0, 0, label, { fontFamily: ui.font, fontSize: `${size.fontSize}px`, color: b.textColor })
    .setOrigin(0.5);
  container.add([rect, text]);
  rect.setInteractive({ useHandCursor: true });
  rect.on('pointerdown', () => pressButton(scene, container, rect, b, onTap));
  return { container, rect, text };
}

// Press feedback: tick, the button dips and lights up for a beat, then
// onTap runs (so the press is visible before the screen changes).
// Taps during the dip are ignored. paint(pressed), when given, redraws the
// button instead of refilling rect (glass buttons).
export function pressButton(scene, container, rect, b, onTap, paint = null) {
  if (container.pressed) return;
  container.pressed = true;
  playSfx('menu');
  if (paint) paint(true);
  else rect.setFillStyle(Number(b.pressFill));
  scene.tweens.killTweensOf(container);
  scene.tweens.add({
    targets: container,
    scale: b.pressScale,
    duration: b.pressMs,
    yoyo: true,
    ease: 'Quad.easeOut',
    onComplete: () => {
      container.pressed = false;
      if (rect.active) {
        if (paint) paint(false);
        else rect.setFillStyle(Number(b.fill));
      }
      onTap();
    },
  });
}

// A rounded translucent "glass" panel button (Menu). size = {w, h, fontSize};
// glass = ui.json menu.glass; variant = a key of glass.variants. The hit area is
// an invisible Rectangle the size of the button. Returns {container, rect,
// text, body, setVariant}; body holds what is drawn, so an entrance can move
// it while the hit area stays put.
// opts.instant: onTap runs on the tap itself and the dip is only a visual
// (rows that change a value in place, e.g. Settings; rapid taps all count).
export function makeGlassButton(scene, x, y, size, glass, variant, label, onTap, opts = {}) {
  const container = scene.add.container(x, y);
  const body = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const text = scene.add
    .text(0, 0, label, { fontFamily: ui.font, fontSize: `${size.fontSize}px`, color: '#ffffff' })
    .setOrigin(0.5);
  body.add([g, text]);
  const rect = scene.add.rectangle(0, 0, size.w, size.h, 0x000000, 0);
  container.add([body, rect]);

  let v = glass.variants[variant];
  const paint = (pressed) => {
    const { w, h } = size;
    const r = glass.radius;
    g.clear();
    g.fillStyle(Number(pressed ? v.pressFill : v.fill), v.fillAlpha);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    const hl = glass.highlight;
    g.lineStyle(1, Number(hl.color), hl.alpha);
    g.lineBetween(-w / 2 + hl.inset, -h / 2 + 2, w / 2 - hl.inset, -h / 2 + 2);
    if (v.accent) {
      g.fillStyle(Number(v.accent), v.accentAlpha ?? 1);
      g.fillRect(-w / 2 + glass.accentInset, -h / 2 + glass.accentInset, glass.accentW, h - glass.accentInset * 2);
    }
    g.lineStyle(glass.strokeW, Number(v.stroke), v.strokeAlpha);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    text.setColor(v.textColor);
  };
  paint(false);

  rect.setInteractive({ useHandCursor: true });
  rect.on('pointerdown', () => {
    if (!opts.instant) {
      pressButton(scene, container, rect, glass, onTap, paint);
      return;
    }
    playSfx('menu');
    onTap();
    paint(true);
    scene.tweens.killTweensOf(container);
    container.setScale(1);
    scene.tweens.add({
      targets: container,
      scale: glass.pressScale,
      duration: glass.pressMs,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => rect.active && paint(false),
    });
  });
  const setVariant = (name) => {
    v = glass.variants[name];
    paint(false);
  };
  return { container, rect, text, body, setVariant };
}

export function addText(scene, x, y, str, cfg) {
  return scene.add
    .text(x, y, str, {
      fontFamily: ui.font,
      fontSize: `${cfg.fontSize}px`,
      color: cfg.color,
      align: 'center',
      wordWrap: cfg.wrap ? { width: cfg.wrap } : undefined,
    })
    .setOrigin(0.5);
}
