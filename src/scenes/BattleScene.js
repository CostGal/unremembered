import Phaser from 'phaser';
import battles from '../data/battles.json';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';

const HERO_X = 100;
const HERO_Y = 300;
const HERO_GAP = 60;
const ENEMY_X = 260;
const ENEMY_Y = 300;
const ENEMY_GAP = 130;

export default class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
  }

  init(data) {
    this.battleId = data.battleId || 'b1_tutorial';
    this.battleDef = battles[this.battleId];
  }

  create() {
    this.manifest = this.registry.get('manifest');

    this.add.image(180, 180, this.battleDef.bg).setDisplaySize(360, 360);
    this.add.rectangle(180, 180, 360, 360, 0x000000, 0.2);

    const heroKeys = ['rhea', 'dov'];
    this.heroes = heroKeys.map((key, i) =>
      this.createRig(characters[key], HERO_X, HERO_Y + (i - 0.5) * HERO_GAP, 'right')
    );

    const enemyKeys = this.battleDef.enemies;
    this.enemyRigs = enemyKeys.map((key, i) =>
      this.createRig(
        enemies[key],
        ENEMY_X,
        ENEMY_Y + (i - (enemyKeys.length - 1) / 2) * ENEMY_GAP,
        'left'
      )
    );

    [...this.heroes, ...this.enemyRigs].forEach((rig) => this.idleBob(rig.container));
  }

  createRig(def, x, y, facing) {
    const container = this.add.container(x, y);
    const bodyManifest = this.manifest.sprites[def.body] || {};
    const mirror = (bodyManifest.faces || facing) !== facing;

    const body = this.add.image(0, 0, def.body);
    container.add(body);

    const parts = {};
    for (const part of def.parts || []) {
      const partManifest = this.manifest.sprites[part.sprite] || {};
      const size = partManifest.w || bodyManifest.w || 128;
      const restX = part.pivot[0] - size / 2;
      const restY = part.pivot[1] - size / 2;
      const img = this.add.image(restX, restY, part.sprite);
      img.setOrigin(part.pivot[0] / size, part.pivot[1] / size);
      container.add(img);
      parts[part.key] = { img, restX, restY };
    }

    container.setScale(mirror ? -1 : 1, 1);

    return { def, container, body, parts };
  }

  idleBob(container) {
    this.tweens.add({
      targets: container,
      y: container.y - 1,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
}
