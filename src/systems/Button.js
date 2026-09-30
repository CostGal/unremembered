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
// Taps during the dip are ignored.
export function pressButton(scene, container, rect, b, onTap) {
  if (container.pressed) return;
  container.pressed = true;
  playSfx('menu');
  rect.setFillStyle(Number(b.pressFill));
  scene.tweens.killTweensOf(container);
  scene.tweens.add({
    targets: container,
    scale: b.pressScale,
    duration: b.pressMs,
    yoyo: true,
    ease: 'Quad.easeOut',
    onComplete: () => {
      container.pressed = false;
      if (rect.active) rect.setFillStyle(Number(b.fill));
      onTap();
    },
  });
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
