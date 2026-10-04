import ui from '../data/ui.json';
import { addText } from './Button.js';

// The game's version (package.json `version`, injected by vite.config.js as
// __APP_VERSION__). Shown small in a corner of the Title and Menu (ui.json `version`).
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

export function addVersionLabel(scene) {
  const cfg = ui.version;
  if (!cfg || !VERSION) return null;
  return addText(scene, cfg.x, cfg.y, cfg.text.replace('{version}', VERSION), cfg)
    .setOrigin(cfg.originX, cfg.originY)
    .setAlpha(cfg.alpha)
    .setDepth(cfg.depth);
}
