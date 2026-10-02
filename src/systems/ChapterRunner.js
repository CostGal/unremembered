import { devInt } from './DevParams.js';

// Walks a chapter's step list (src/data/chapter1.json). Each scene calls
// runner.next(this) when its step is done. A step whose scene doesn't exist
// yet is skipped, so the chapter always plays through.
const SCENE_FOR = { cutscene: 'Cutscene', dialogue: 'Dialogue', battle: 'Battle', reward: 'Reward' };

export default class ChapterRunner {
  constructor(steps) {
    this.steps = steps;
    this.index = -1;
  }

  // ?step=N starts the chapter at step N (0-based, dev).
  static start(scene, steps) {
    const runner = new ChapterRunner(steps);
    scene.registry.set('runner', runner);
    // Fragments picked between battles last for one run.
    scene.registry.set('fragments', []);
    // Parry assist (BattleScene.parryAssist) starts fresh too.
    scene.registry.set('parryAssistMs', 0);
    scene.registry.set('parryMissStreak', 0);
    runner.index = Math.max(-1, Math.min(steps.length - 1, (devInt('step') ?? 0) - 1));
    runner.next(scene);
    return runner;
  }

  get step() {
    return this.steps[this.index];
  }

  next(scene) {
    while (true) {
      this.index += 1;
      const step = this.steps[this.index];

      if (!step || step.type === 'end') {
        scene.registry.remove('runner');
        scene.scene.start(scene.scene.get('End') ? 'End' : 'Title');
        return;
      }

      const key = SCENE_FOR[step.type];
      if (!key || !scene.scene.get(key)) {
        console.warn(`ChapterRunner: no scene for step ${this.index} (${step.type} ${step.id}), skipping`);
        continue;
      }

      if (step.type === 'battle') scene.scene.start(key, { battleId: step.id });
      else if (step.type === 'reward') scene.scene.start(key);
      else scene.scene.start(key, { id: step.id, bg: step.bg });
      return;
    }
  }
}
