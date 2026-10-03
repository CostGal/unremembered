import allies from '../data/allies.json';
import * as Fx from './Fx.js';
import { animKey, hasSheet, playLoop, playOnce, trace } from './SpriteAnims.js';

// Nala's jump-in: she leaps from (fromX, fromY) to (toX, toY) over `ms` along
// a parabola (container position, so the shadow and glow come along), plays
// her `alert` sheet in the air and lands with a squash and a puff of dust.
// There is no jump sheet; the arc is code. allies.json nala.jump holds the
// height / squash / dust. Reusable by any scene that has `scene.nala`
// ({container, image, anims}, see BattleScene.createNala). Resolves on landing.
export function nalaJumpIn(scene, fromX, fromY, toX, toY, ms) {
  const nala = scene.nala;
  const jump = allies.nala.jump;
  if (!nala) return Promise.resolve();
  const { container, image, anims } = nala;
  const duration = ms ?? jump.ms;
  const sign = Math.sign(container.scaleX) || 1;
  const real = hasSheet(anims, 'alert');

  nala.busy = true;
  scene.tweens.killTweensOf(container);
  container.setPosition(fromX, fromY).setScale(sign, 1).setVisible(true);
  if (real) {
    const intro = hasSheet(anims, 'alert_in') ? playOnce(image, 'nala', 'alert_in', anims.alert_in) : Promise.resolve();
    intro.then(() => {
      if (nala.busy && container.y < toY - 1) playLoop(image, 'nala', 'alert');
    });
  } else trace('fallback:alert:nala');
  trace('nala:jumpIn');

  return new Promise((resolve) => {
    const state = { t: 0 };
    scene.tweens.add({
      targets: state,
      t: 1,
      duration,
      ease: 'Linear',
      onUpdate: () => {
        const t = state.t;
        // Straight line on the ground plane, parabola on top: 4h·t·(1-t) peaks at h.
        container.x = fromX + (toX - fromX) * t;
        container.y = fromY + (toY - fromY) * t - jump.height * 4 * t * (1 - t);
      },
      onComplete: () => {
        container.setPosition(toX, toY);
        Fx.sparks(scene, toX, toY + image.height / 2 - 2, jump.dust.count, jump.dust, container.depth + 1);
        scene.tweens.add({
          targets: container,
          scaleY: jump.squash,
          scaleX: sign * (2 - jump.squash),
          duration: jump.squashMs,
          yoyo: true,
          onComplete: () => {
            container.setScale(sign, 1);
            nala.busy = false;
            if (real && !hasSheet(anims, 'alert_out')) playLoop(image, 'nala', 'idle');
            resolve();
          },
        });
        // Out of the alert pose as she lands.
        if (real && hasSheet(anims, 'alert_out')) {
          const outKey = animKey('nala', 'alert_out');
          playOnce(image, 'nala', 'alert_out', anims.alert_out).then(() => image.anims.currentAnim?.key === outKey && playLoop(image, 'nala', 'idle'));
        }
      },
    });
  });
}

