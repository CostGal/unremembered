import battles from '../data/battles.json';
import enemies from '../data/enemies.json';
import levels from '../data/levels.json';
import { devInt } from './DevParams.js';
import { stopAllSfx } from './Audio.js';
import audioData from '../data/audio.json';
import { prefetchMusicFor } from './MusicPlan.js';
import { resetPauses } from './TutorialPause.js';
import { chapterXpBefore, xpForLevel } from './Recall.js';

// Walks a chapter's step list (src/data/chapter1.json). Each scene calls
// runner.next(this) when its step is done. A step whose scene doesn't exist
// yet is skipped, so the chapter always plays through.
const SCENE_FOR = { cutscene: 'Cutscene', dialogue: 'Dialogue', battle: 'Battle', reward: 'Reward' };

export default class ChapterRunner {
  constructor(steps) {
    this.steps = steps;
    this.index = -1;
    this.openFromBlack = false;
  }

  // ?step=N starts the chapter at step N (0-based, dev).
  static start(scene, steps) {
    const runner = new ChapterRunner(steps);
    scene.registry.set('runner', runner);
    // Memories (fragments.json) won between battles last for one run.
    scene.registry.set('fragments', []);
    // Tutorial pauses show once per run (TutorialPause.js).
    resetPauses(scene.registry);
    // Parry assist (BattleScene.parryAssist) starts fresh too.
    scene.registry.set('parryAssistMs', 0);
    scene.registry.set('parryMissStreak', 0);
    runner.index = Math.max(-1, Math.min(steps.length - 1, (devInt('step') ?? 0) - 1));
    // Recall (levels.json): Memories for this run. ?step=N starts with what the
    // battles before step N would have given; ?level=N sets it outright.
    const level = devInt('level');
    scene.registry.set('recallXp', level ? xpForLevel(level, levels) : chapterXpBefore(steps, runner.index + 1, battles, enemies));
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

      // Music: download what this step and the next can play, free the rest (audio.json music.prefetchPolicy).
      prefetchMusicFor(step, this.steps[this.index + 1]);
      // A cue still ringing from the scene that just ended fades out.
      stopAllSfx(audioData.sfxFadeMs);
      if (step.type === 'battle') scene.scene.start(key, { battleId: step.id });
      else if (step.type === 'reward') scene.scene.start(key, { id: step.id });
      else {
        // A dialogue that ended with a "close" transition: the next one opens from black.
        const fadeIn = step.type === 'dialogue' && this.openFromBlack;
        scene.scene.start(key, { id: step.id, bg: step.bg, fadeIn });
      }
      this.openFromBlack = false;
      return;
    }
  }
}
