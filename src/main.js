import Phaser from 'phaser';

class SetupScene extends Phaser.Scene {
  create() {
    this.add
      .text(180, 320, 'Unremembered', {
        fontSize: '24px',
        color: '#f1efe8',
      })
      .setOrigin(0.5);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 360,
  height: 640,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#0b0d14',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [SetupScene],
};

new Phaser.Game(config);
