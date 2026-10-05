import ui from '../data/ui.json';
import { playSfx, setAudioPaused } from './Audio.js';
import { onAction } from './Input.js';
import { liveBadge } from './Prompts.js';

const cfg = ui.pauseButton;

// The ⏸ button (top-left corner, drawn in code) for Battle, Dialogue and
// Cutscene. Its tap stops there: it never reaches the scene's own
// pointerdown (a parry, "next line", hold-to-skip). The pause action
// (systems/Input.js) presses it too; its key / button shows under it. onPause defaults to pauseScene(scene).
export function addPauseButton(scene, onPause = () => pauseScene(scene)) {
  const container = scene.add.container(cfg.x, cfg.y).setDepth(cfg.depth);
  const g = scene.add.graphics();
  g.fillStyle(Number(cfg.fill), cfg.fillAlpha);
  g.fillCircle(0, 0, cfg.radius);
  g.lineStyle(cfg.strokeW, Number(cfg.stroke), cfg.strokeAlpha);
  g.strokeCircle(0, 0, cfg.radius);
  g.fillStyle(Number(cfg.barColor), 1);
  for (const sign of [-1, 1]) g.fillRect(sign * (cfg.barGap / 2 + cfg.barW / 2) - cfg.barW / 2, -cfg.barH / 2, cfg.barW, cfg.barH);
  const hit = scene.add.rectangle(0, 0, cfg.hit, cfg.hit, 0x000000, 0).setInteractive({ useHandCursor: true });
  // Its key / button under it (P / Options; ui.json prompts.pause), not on touch.
  const p = ui.prompts.pause;
  container.add([g, hit, liveBadge(scene, p.dx, p.dy, 'pause', { size: p.size })]);
  hit.on('pointerdown', (pointer, x, y, event) => {
    event.stopPropagation();
    playSfx('menu');
    onPause();
  });
  // The pause action (P / Options) presses it too.
  onAction(scene, 'pause', () => {
    playSfx('menu');
    onPause();
    return true;
  });
  return container;
}

// Pauses `scene` under the pause menu (PauseScene, menu mode); Resume picks
// it up where it was. Resolves when the scene runs again.
export function pauseScene(scene, { menu = true } = {}) {
  return new Promise((resolve) => {
    if (!scene.scene.isActive()) return resolve();
    scene.scene.pause();
    if (menu) setAudioPaused(true);
    scene.scene.launch('Pause', {
      menu,
      onContinue: () => {
        setAudioPaused(false);
        scene.scene.resume();
        resolve();
      },
    });
    scene.scene.bringToTop('Pause');
  });
}
