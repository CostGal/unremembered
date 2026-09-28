export function flash(scene, images, durationMs = 60) {
  for (const img of images) img.setTintFill(0xffffff);
  scene.time.delayedCall(durationMs, () => {
    for (const img of images) img.clearTint();
  });
}

export function shake(scene, amount = 2, durationMs = 80) {
  scene.cameras.main.shake(durationMs, amount / 1000);
}

export function damageNumber(scene, x, y, value, color = '#f1efe8') {
  const text = scene.add
    .text(x, y, `${value}`, {
      fontFamily: '"Pixelify Sans", monospace',
      fontSize: '16px',
      color,
    })
    .setOrigin(0.5)
    .setDepth(1000);

  scene.tweens.add({
    targets: text,
    y: y - 24,
    alpha: 0,
    duration: 600,
    ease: 'Cubic.easeOut',
    onComplete: () => text.destroy(),
  });
}
