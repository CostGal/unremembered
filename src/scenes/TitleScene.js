import Phaser from 'phaser';
import chapter1 from '../data/chapter1.json';
import { unlockAudio } from '../systems/Audio.js';
import ChapterRunner from '../systems/ChapterRunner.js';

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create() {
    this.add.image(180, 220, 'logo');

    const tap = this.add
      .text(180, 420, 'Tap to start', {
        fontFamily: '"Pixelify Sans", monospace',
        fontSize: '20px',
        color: '#f1efe8',
      })
      .setOrigin(0.5);

    this.tweens.add({ targets: tap, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

    this.add
      .text(180, 600, '🔈 Turn off silent mode for sound', {
        fontFamily: '"Pixelify Sans", monospace',
        fontSize: '11px',
        color: '#8a8f9e',
      })
      .setOrigin(0.5);

    this.input.once('pointerdown', () => {
      unlockAudio();
      ChapterRunner.start(this, chapter1);
    });
  }
}
