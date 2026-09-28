import Phaser from 'phaser';
import battles from '../data/battles.json';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import BattleStateMachine from '../systems/BattleStateMachine.js';
import * as Fx from '../systems/Fx.js';

const HERO_X = 100;
const HERO_Y = 300;
const HERO_GAP = 60;
const ENEMY_X = 260;
const ENEMY_Y = 300;
const ENEMY_GAP = 130;

const ATTACK_DURATION_MS = 400;
const DASH_DURATION_MS = 180;

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
    this.battleOver = false;

    this.add.image(180, 180, this.battleDef.bg).setDisplaySize(360, 360);
    this.add.rectangle(180, 180, 360, 360, 0x000000, 0.2);

    const heroKeys = ['rhea', 'dov'];
    this.heroes = heroKeys.map((key, i) =>
      this.createEntity(key, characters[key], HERO_X, HERO_Y + (i - 0.5) * HERO_GAP, 'right', true)
    );

    const enemyKeys = this.battleDef.enemies;
    this.enemies = enemyKeys.map((key, i) =>
      this.createEntity(
        `${key}_${i}`,
        enemies[key],
        ENEMY_X,
        ENEMY_Y + (i - (enemyKeys.length - 1) / 2) * ENEMY_GAP,
        'left',
        false
      )
    );

    this.buildCommandMenu();

    const machine = new BattleStateMachine({
      intro: () => this.playIntro(),
      isAlive: (entity) => entity.hp > 0,
      allEnemiesDown: () => this.enemies.every((e) => e.hp <= 0),
      allHeroesDown: () => this.heroes.every((h) => h.hp <= 0),
      playerTurn: (hero) => this.playerTurn(hero),
      enemyTurn: (enemy) => this.enemyTurn(enemy),
      onEnd: (result) => this.onBattleEnd(result),
    });

    machine.run(this.heroes, this.enemies);
  }

  // ---------- Entity setup ----------

  createEntity(id, def, x, y, facing, isHero) {
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

    const label = this.add
      .text(x, y - (bodyManifest.h || 128) / 2 - 10, '', {
        fontFamily: '"Pixelify Sans", monospace',
        fontSize: '12px',
        color: '#f1efe8',
      })
      .setOrigin(0.5, 1);

    const entity = {
      id,
      def,
      name: def.name,
      hp: def.hp,
      maxHp: def.hp,
      container,
      body,
      parts,
      label,
      facing,
      isHero,
      restX: x,
    };

    this.updateLabel(entity);
    entity.bobTween = this.idleBob(container);

    return entity;
  }

  idleBob(container) {
    return this.tweens.add({
      targets: container,
      y: container.y - 1,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  updateLabel(entity) {
    entity.label.setText(`${entity.name}  ${entity.hp}/${entity.maxHp}`);
  }

  markDown(entity) {
    if (entity.bobTween) entity.bobTween.stop();
    this.tweens.add({ targets: entity.container, alpha: 0.35, duration: 200 });
  }

  // ---------- Command menu ----------

  buildCommandMenu() {
    this.commandItems = [];

    this.strikeButton = this.makeButton(90, 490, 160, 64, 'Strike', () => {
      if (this.onStrikeChosen) this.onStrikeChosen();
    });
    this.commandItems.push(this.strikeButton);

    this.techniqueButton = this.makeButton(270, 490, 160, 64, 'Technique', null, true);
    this.commandItems.push(this.techniqueButton);

    this.promptText = this.add
      .text(180, 460, 'Choose a target', {
        fontFamily: '"Pixelify Sans", monospace',
        fontSize: '14px',
        color: '#f1efe8',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.backButton = this.makeButton(180, 570, 160, 64, 'Back', null);
    this.backButton.container.setVisible(false);

    this.hideCommandMenu();
  }

  makeButton(x, y, w, h, label, onTap, disabled = false) {
    const container = this.add.container(x, y);
    const rect = this.add
      .rectangle(0, 0, w, h, disabled ? 0x1c1e29 : 0x232636)
      .setStrokeStyle(2, disabled ? 0x3a3d4a : 0x5a5f73);
    const text = this.add
      .text(0, 0, label, {
        fontFamily: '"Pixelify Sans", monospace',
        fontSize: '16px',
        color: disabled ? '#5a5f73' : '#f1efe8',
      })
      .setOrigin(0.5);
    container.add([rect, text]);

    if (!disabled && onTap) {
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', onTap);
    }

    return { container, rect, text, onTap };
  }

  showCommandMenu() {
    this.strikeButton.container.setVisible(true);
    this.techniqueButton.container.setVisible(true);
    this.promptText.setVisible(false);
    this.backButton.container.setVisible(false);
  }

  hideCommandMenu() {
    this.strikeButton.container.setVisible(false);
    this.techniqueButton.container.setVisible(false);
  }

  // ---------- Turn flow ----------

  playIntro() {
    return new Promise((resolve) => {
      let remaining = this.enemies.length;
      if (remaining === 0) {
        resolve();
        return;
      }
      for (const enemy of this.enemies) {
        const targetX = enemy.container.x;
        enemy.container.x = targetX + 80;
        enemy.container.alpha = 0;
        this.tweens.add({
          targets: enemy.container,
          x: targetX,
          alpha: 1,
          duration: 1000,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            remaining -= 1;
            if (remaining === 0) resolve();
          },
        });
      }
    });
  }

  async playerTurn(hero) {
    this.showCommandMenu();

    const target = await this.waitForStrikeChoice();

    this.hideCommandMenu();

    if (target) await this.playerStrike(hero, target);
  }

  waitForStrikeChoice() {
    return new Promise((resolve) => {
      this.onStrikeChosen = () => {
        this.onStrikeChosen = null;
        const livingEnemies = this.enemies.filter((e) => e.hp > 0);

        if (livingEnemies.length <= 1) {
          resolve(livingEnemies[0] || null);
          return;
        }

        this.enterTargeting(livingEnemies, resolve);
      };
    });
  }

  enterTargeting(livingEnemies, resolve) {
    this.hideCommandMenu();
    this.promptText.setVisible(true);
    this.backButton.container.setVisible(true);
    this.backButton.rect.off('pointerdown');
    this.backButton.rect.setInteractive({ useHandCursor: true });
    this.backButton.rect.once('pointerdown', () => {
      this.clearTargeting(livingEnemies);
      this.promptText.setVisible(false);
      this.backButton.container.setVisible(false);
      this.backButton.rect.disableInteractive();
      this.showCommandMenu();
      this.waitForStrikeChoice().then(resolve);
    });

    for (const enemy of livingEnemies) {
      enemy.body.setTint(0xfff066);
      enemy.body.setInteractive({ useHandCursor: true });
      enemy.body.once('pointerdown', () => {
        this.clearTargeting(livingEnemies);
        this.promptText.setVisible(false);
        this.backButton.container.setVisible(false);
        this.backButton.rect.disableInteractive();
        resolve(enemy);
      });
    }
  }

  clearTargeting(livingEnemies) {
    for (const enemy of livingEnemies) {
      enemy.body.clearTint();
      enemy.body.off('pointerdown');
      enemy.body.disableInteractive();
    }
  }

  async enemyTurn(enemy) {
    const livingHeroes = this.heroes.filter((h) => h.hp > 0);
    const target = Phaser.Utils.Array.GetRandom(livingHeroes);
    const attack = pickWeighted(enemy.def.attacks);
    const dmg = attack.dmg !== undefined ? attack.dmg : (attack.hits || []).reduce((sum, h) => sum + h.dmg, 0);

    await this.playAttackAnim(enemy);
    this.applyHit(target, dmg);
  }

  // ---------- Attack execution ----------

  async playerStrike(hero, target) {
    const restX = hero.container.x;
    const approachX = Phaser.Math.Linear(restX, target.container.x, 0.7);

    await this.tweenPromise(hero.container, { x: approachX }, DASH_DURATION_MS);
    await this.playAttackAnim(hero);

    const dmg = Phaser.Math.Between(hero.def.strike[0], hero.def.strike[1]);
    this.applyHit(target, dmg);

    await this.tweenPromise(hero.container, { x: restX }, DASH_DURATION_MS);
  }

  playAttackAnim(entity) {
    if (entity.def.parts && Object.keys(entity.parts).length > 0) {
      return this.playRigAttack(entity);
    }
    const dirSign = entity.facing === 'right' ? 1 : -1;
    return this.playLungeAttack(entity, dirSign);
  }

  playRigAttack(entity) {
    return new Promise((resolve) => {
      const keyframes = entity.def.attack.keyframes;
      const progress = { t: 0 };

      this.tweens.add({
        targets: progress,
        t: 1,
        duration: ATTACK_DURATION_MS,
        onUpdate: () => {
          const frame = interpolateKeyframes(keyframes, progress.t);
          entity.body.setPosition(frame.body[0], frame.body[1]);
          for (const [key, partFrame] of Object.entries(frame.parts)) {
            const part = entity.parts[key];
            if (!part) continue;
            part.img.setPosition(part.restX + partFrame.offset[0], part.restY + partFrame.offset[1]);
            part.img.setAngle(partFrame.rotation);
          }
        },
        onComplete: () => {
          entity.body.setPosition(0, 0);
          for (const part of Object.values(entity.parts)) {
            part.img.setPosition(part.restX, part.restY);
            part.img.setAngle(0);
          }
          resolve();
        },
      });
    });
  }

  playLungeAttack(entity, dirSign) {
    return new Promise((resolve) => {
      const { distance, squash } = entity.def.attack;
      const startX = entity.container.x;
      const baseScaleY = entity.container.scaleY;

      this.tweens.chain({
        targets: entity.container,
        tweens: [
          { x: startX + distance * dirSign, duration: 150, ease: 'Quad.easeOut' },
          { x: startX, duration: 150, ease: 'Quad.easeIn' },
        ],
        onComplete: resolve,
      });

      this.tweens.add({
        targets: entity.container,
        scaleY: baseScaleY * (1 - squash),
        duration: 100,
        yoyo: true,
      });
    });
  }

  applyHit(target, dmg) {
    const images = [target.body, ...Object.values(target.parts).map((p) => p.img)];
    Fx.flash(this, images, 60);
    Fx.shake(this, 2, 80);
    Fx.damageNumber(this, target.container.x, target.container.y - 80, dmg);

    target.hp = Math.max(0, target.hp - dmg);
    this.updateLabel(target);

    if (target.hp <= 0) this.markDown(target);
  }

  tweenPromise(target, props, duration, ease = 'Linear') {
    return new Promise((resolve) => {
      this.tweens.add({ targets: target, ...props, duration, ease, onComplete: resolve });
    });
  }

  // ---------- End of battle ----------

  onBattleEnd(result) {
    this.battleOver = true;
    this.hideCommandMenu();

    const message = result === 'WIN' ? 'Victory' : 'The memory fades…';

    this.add
      .text(180, 320, message, {
        fontFamily: '"Pixelify Sans", monospace',
        fontSize: '28px',
        color: '#f1efe8',
      })
      .setOrigin(0.5)
      .setDepth(2000);
  }
}

function pickWeighted(list) {
  const total = list.reduce((sum, item) => sum + (item.weight || 1), 0);
  let r = Math.random() * total;
  for (const item of list) {
    r -= item.weight || 1;
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}

function interpolateKeyframes(keyframes, t) {
  let k0 = keyframes[0];
  let k1 = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (t >= keyframes[i].t && t <= keyframes[i + 1].t) {
      k0 = keyframes[i];
      k1 = keyframes[i + 1];
      break;
    }
  }

  const span = k1.t - k0.t || 1;
  const localT = Phaser.Math.Clamp((t - k0.t) / span, 0, 1);

  const body = [
    Phaser.Math.Linear(k0.body[0], k1.body[0], localT),
    Phaser.Math.Linear(k0.body[1], k1.body[1], localT),
  ];

  const parts = {};
  for (const key of Object.keys(k0)) {
    if (key === 't' || key === 'body') continue;
    const a = k0[key];
    const b = k1[key] || a;
    parts[key] = {
      rotation: Phaser.Math.Linear(a.rotation, b.rotation, localT),
      offset: [
        Phaser.Math.Linear(a.offset[0], b.offset[0], localT),
        Phaser.Math.Linear(a.offset[1], b.offset[1], localT),
      ],
    };
  }

  return { body, parts };
}
