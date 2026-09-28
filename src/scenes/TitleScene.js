import Phaser from 'phaser';
import { unlockAudio } from '../systems/Audio.js';

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
      this.scene.start('Battle', { battleId: 'b1_tutorial' });
    });
  }
}
