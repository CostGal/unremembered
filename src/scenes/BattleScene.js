import Phaser from 'phaser';
import battles from '../data/battles.json';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import environments from '../data/environments.json';
import qte from '../data/qte.json';
import ui from '../data/ui.json';
import BattleStateMachine from '../systems/BattleStateMachine.js';
import * as Fx from '../systems/Fx.js';
import Hud from '../systems/Hud.js';
import * as Qte from '../systems/Qte.js';
import { animKey, hasSheet, playOnce } from '../systems/SpriteAnims.js';

const layout = ui.battleLayout;

const ATTACK_DURATION_MS = 400;
const DASH_DURATION_MS = 180;
const LUNGE_OUT_MS = 150;
// Lunge used when a sheet character's attack sheet is missing and its def has no lunge data.
const FALLBACK_LUNGE = { distance: 10, squash: 0.15 };

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
    this.animationSets = this.registry.get('animationSets') || {};
    this.battleOver = false;

    this.add.image(180, 180, this.battleDef.bg).setDisplaySize(360, 360);
    this.add.rectangle(180, 180, 360, 360, 0x000000, 0.2);
    this.environment = environments[this.battleDef.bg] || {};
    this.createEnvironmentFx();

    if (this.battleDef.nala) this.createNala();

    const heroKeys = ['rhea', 'dov'];
    this.heroes = heroKeys.map((key) =>
      this.createEntity(key, key, characters[key], layout.heroes[key], 'right', true)
    );

    const enemyKeys = this.battleDef.enemies;
    const slots = this.enemySlots(enemyKeys);
    this.enemies = enemyKeys.map((key, i) =>
      this.createEntity(`${key}_${i}`, key, enemies[key], slots[Math.min(i, slots.length - 1)], 'left', false)
    );

    this.applyAmbientTint();

    this.echo = 0;
    this.hud = new Hud(this, ui.hud, ui.font, this.heroes);
    if (import.meta.env.DEV) this.enableHudDebug();

    this.buildCommandMenu();
    this.buildTapHint();

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

  // ---------- Environment ----------

  // Lantern glows, rain and vignette for this battle's background (environments.json).
  createEnvironmentFx() {
    const env = this.environment;
    const area = { x: 0, y: 0, w: 360, h: layout.sceneBottom };
    if (env.lights) Fx.lights(this, env.lights);
    if (env.rain) Fx.rain(this, env.rain, area);
    if (env.vignette) Fx.vignette(this, env.vignette, area);
  }

  // Night (or lamp) light on every combatant, so they sit in the scene.
  applyAmbientTint() {
    if (!this.environment.ambientTint) return;
    const images = [...this.heroes, ...this.enemies].flatMap((e) => [e.body, ...Object.values(e.parts).map((p) => p.img)]);
    if (this.nala) images.push(this.nala.image);
    Fx.setBaseTint(images, Number(this.environment.ambientTint));
  }

  // ---------- Entity setup ----------

  // The ui.battleLayout slots for this enemy list: the boss formation if any
  // enemy is a boss, otherwise the one for this many enemies.
  enemySlots(enemyKeys) {
    const formationKey = enemyKeys.some((key) => enemies[key].boss) ? 'boss' : String(enemyKeys.length);
    const slots = layout.enemies[formationKey];
    if (slots && slots.length >= enemyKeys.length) return slots;

    console.warn(`battleLayout: no formation "${formationKey}" for ${enemyKeys.length} enemies`);
    const counts = Object.keys(layout.enemies).map(Number).filter(Number.isFinite);
    return slots || layout.enemies[Math.max(...counts)];
  }

  // Nala sits behind the heroes. Static for now; her ability is its own issue.
  createNala() {
    const sprite = this.manifest.sprites.nala;
    const { x, feetY } = layout.nala;
    const container = this.add.container(x, feetY - sprite.h / 2).setDepth(feetY);
    const image = this.add.image(0, 0, 'nala');
    container.add(image);
    container.setScale((sprite.faces || 'right') !== 'right' ? -1 : 1, 1);
    this.checkLayout('nala', feetY, sprite.h);
    this.nala = { container, image };
    this.idleBob(container);
  }

  // Dev build only: flag any sprite that reaches into the HUD or off the top.
  checkLayout(id, feetY, height) {
    if (!import.meta.env.DEV) return;
    if (feetY > layout.sceneBottom) console.warn(`battleLayout: ${id} feet at y ${feetY} overlap the HUD`);
    if (feetY - height < 0) console.warn(`battleLayout: ${id} is cut off at the top`);
  }

  // type = the characters.json / enemies.json key. With a <type>_animations.json
  // that has an idle, the entity is one animated sprite; otherwise the cutout rig.
  // slot = {x, feetY} from ui.battleLayout; feetY is the bottom edge of the canvas.
  createEntity(id, type, def, slot, facing, isHero) {
    const animSet = this.animationSets[type];
    const anims = animSet?.animations?.idle ? animSet.animations : null;
    const bodyManifest = this.manifest.sprites[def.body] || {};
    const height = anims ? animSet.frame_size[1] : bodyManifest.h || 128;

    const x = slot.x;
    const y = slot.feetY - height / 2;
    const container = this.add.container(x, y).setDepth(slot.feetY);
    this.checkLayout(id, slot.feetY, height);

    if (anims) return this.finishEntity({ id, type, def, container, x, y, facing, isHero, height, anims, animSet });

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

    return this.finishEntity({ id, type, def, container, x, y, facing, isHero, body, parts, height });
  }

  finishEntity({ id, type, def, container, x, y, facing, isHero, body, parts = {}, height, anims = null, animSet }) {
    if (anims) {
      body = this.add.sprite(0, 0, animKey(type, 'idle'));
      container.add(body);
      container.setScale((animSet.facing || 'left') !== facing ? -1 : 1, 1);
      body.play(animKey(type, 'idle'));
    }

    // Heroes' HP lives in the HUD; enemies keep an overhead label.
    const label = isHero
      ? null
      : this.add
          .text(x, y - height / 2 - layout.labelGap, '', {
            fontFamily: '"Pixelify Sans", monospace',
            fontSize: '12px',
            color: '#f1efe8',
          })
          .setOrigin(0.5, 1)
          .setDepth(layout.labelDepth);

    const entity = {
      id,
      type,
      def,
      name: def.name,
      hp: def.hp,
      maxHp: def.hp,
      container,
      body,
      parts,
      anims,
      label,
      facing,
      isHero,
      restX: x,
    };

    this.updateLabel(entity);
    // The code bob stands in for idle until a real idle sheet lands.
    if (!anims || anims.idle.placeholder) entity.bobTween = this.idleBob(container);

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
    if (!entity.label) return;
    entity.label.setText(`${entity.name}  ${entity.hp}/${entity.maxHp}`);
  }

  // ---------- HUD ----------

  // The single place the HUD learns about HP/Echo changes.
  refreshHud() {
    this.hud.update({
      heroes: this.heroes.map((h) => ({ hp: h.hp, maxHp: h.maxHp })),
      echo: this.echo,
    });
    this.updateRecollectionButton();
  }

  // Dev build only: tap a hero row (or keys 1/2) to take HP, tap the Echo row
  // (or E/Q) to change Echo. A downed hero's row tap restores full HP.
  enableHudDebug() {
    const { hpStep, echoStep, keys } = ui.debug;
    const max = ui.hud.echo.max;
    const hurt = (i) => {
      const hero = this.heroes[i];
      if (!hero) return;
      if (hero.hp <= 0) this.revive(hero, hero.maxHp);
      else {
        hero.hp = Math.max(0, hero.hp - hpStep);
        if (hero.hp <= 0) this.markDown(hero);
        else this.playHurt(hero);
      }
      this.refreshHud();
    };
    const addEcho = (d, wrap) => {
      let next = this.echo + d;
      if (wrap && next > max) next = 0;
      this.echo = Math.max(0, Math.min(max, next));
      this.refreshHud();
    };

    this.hud.enableDebugTaps({ onHeroTap: hurt, onEchoTap: () => addEcho(echoStep, true) });
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on(`keydown-${keys.hurtRhea}`, () => hurt(0));
    kb.on(`keydown-${keys.hurtDov}`, () => hurt(1));
    kb.on(`keydown-${keys.echoUp}`, () => addEcho(echoStep, false));
    kb.on(`keydown-${keys.echoDown}`, () => addEcho(-echoStep, false));
  }

  revive(entity, hp) {
    entity.hp = hp;
    this.tweens.killTweensOf(entity.container);
    entity.container.alpha = 1;
    if (entity.anims) entity.body.play(animKey(entity.type, 'idle'));
    if (!entity.anims || entity.anims.idle.placeholder) entity.bobTween = this.idleBob(entity.container);
    this.updateLabel(entity);
  }

  // Downed: the death sheet plays once and holds its last frame. Without one,
  // the entity freezes and dims.
  markDown(entity) {
    if (entity.bobTween) entity.bobTween.stop();

    if (hasSheet(entity.anims, 'death')) {
      entity.body.play(animKey(entity.type, 'death'));
      return;
    }

    if (entity.anims) entity.body.anims.stop();
    this.tweens.add({ targets: entity.container, alpha: 0.35, duration: 200 });
  }

  // Non-lethal damage: the hurt sheet, then back to idle. Without a hurt sheet
  // the white flash from applyHit is the whole reaction.
  playHurt(entity) {
    if (!hasSheet(entity.anims, 'hurt')) return;

    const key = animKey(entity.type, 'hurt');
    playOnce(entity.body, entity.type, 'hurt', entity.anims.hurt).then(() => {
      // Another animation (the next strike, death) may have replaced the hurt one.
      const stillHurt = entity.body.anims.currentAnim?.key === key;
      if (stillHurt && entity.hp > 0) entity.body.play(animKey(entity.type, 'idle'));
    });
  }

  // ---------- Command menu ----------

  buildCommandMenu() {
    const { slots, prompt } = ui.commands;

    this.strikeButton = this.makeButton(slots.strike, 'Strike', () => {
      if (this.onStrikeChosen) this.onStrikeChosen();
    });
    this.techniqueButton = this.makeButton(slots.technique, 'Technique', null, true);
    // Placeholder until Recollection lands: shown for Rhea at full Echo.
    this.recollectionButton = this.makeButton(slots.recollection, 'Recollection', null, true);

    this.promptText = this.add
      .text(prompt.x, prompt.y, prompt.text, {
        fontFamily: ui.font,
        fontSize: `${prompt.fontSize}px`,
        color: ui.commands.button.textColor,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.backButton = this.makeButton(slots.back, 'Back', null);
    this.backButton.container.setVisible(false);

    this.hideCommandMenu();
  }

  makeButton([x, y], label, onTap, disabled = false) {
    const b = ui.commands.button;
    const container = this.add.container(x, y);
    const rect = this.add
      .rectangle(0, 0, b.w, b.h, Number(disabled ? b.disabledFill : b.fill))
      .setStrokeStyle(2, Number(disabled ? b.disabledStroke : b.stroke));
    const text = this.add
      .text(0, 0, label, {
        fontFamily: ui.font,
        fontSize: `${b.fontSize}px`,
        color: disabled ? b.disabledTextColor : b.textColor,
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
    this.menuVisible = true;
    this.strikeButton.container.setVisible(true);
    this.techniqueButton.container.setVisible(true);
    this.updateRecollectionButton();
    this.promptText.setVisible(false);
    this.backButton.container.setVisible(false);
  }

  hideCommandMenu() {
    this.menuVisible = false;
    this.strikeButton.container.setVisible(false);
    this.techniqueButton.container.setVisible(false);
    this.recollectionButton.container.setVisible(false);
  }

  updateRecollectionButton() {
    if (!this.recollectionButton) return;
    const show = this.menuVisible && !!this.activeHero?.def.canUltimate && this.echo >= ui.hud.echo.max;
    this.recollectionButton.container.setVisible(show);
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
    this.activeHero = hero;
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
      Fx.restoreTint(enemy.body);
      enemy.body.off('pointerdown');
      enemy.body.disableInteractive();
    }
  }

  // Each hit of the attack is its own parry ring on the targeted hero.
  async enemyTurn(enemy) {
    const livingHeroes = this.heroes.filter((h) => h.hp > 0);
    const target = Phaser.Utils.Array.GetRandom(livingHeroes);
    const attack = pickWeighted(enemy.def.attacks);

    this.tapHint.setVisible(true);
    for (const hit of attack.hits || [attack]) {
      if (target.hp <= 0 || enemy.hp <= 0) break;
      await this.enemyHit(enemy, target, hit);
    }
    this.tapHint.setVisible(false);
  }

  // ---------- Parry QTE ----------

  buildTapHint() {
    const { x, y, fontSize, color, text } = qte.hint;
    this.tapHint = this.add
      .text(x, y, text, { fontFamily: ui.font, fontSize: `${fontSize}px`, color })
      .setOrigin(0.5)
      .setVisible(false);
  }

  parryWindows() {
    const storyMode = this.registry.get('settings')?.storyMode;
    return storyMode ? Qte.scaledWindows(qte.windows, qte.storyMode.windowMult) : qte.windows;
  }

  // The ring closes at T; the enemy's attack is started early enough that its
  // impact lands on T. The result is applied once the tap is judged.
  async enemyHit(enemy, target, hit) {
    const ring = Qte.runRing(this, {
      x: target.container.x,
      y: target.container.y + qte.ring.offsetY,
      telegraphMs: hit.telegraphMs,
      windows: this.parryWindows(),
      ring: qte.ring,
    });

    const attackDone = new Promise((resolve) => {
      const startIn = Math.max(0, hit.telegraphMs - this.impactLeadMs(enemy));
      this.time.delayedCall(startIn, () => this.playAttackAnim(enemy).then(resolve));
    });

    const { result } = await ring.promise;
    await this.applyParryResult(result, enemy, target, hit.dmg);
    await attackDone;
  }

  // How long an entity's attack takes to reach its impact.
  impactLeadMs(entity) {
    if (hasSheet(entity.anims, 'attack')) {
      const { impactFrames = [], durations_ms: durations = [], frames } = entity.anims.attack;
      const impact = impactFrames.length ? impactFrames[0] : frames;
      return durations.slice(0, impact).reduce((sum, ms) => sum + ms, 0);
    }
    if (entity.def.parts && Object.keys(entity.parts).length > 0) return ATTACK_DURATION_MS / 2;
    return LUNGE_OUT_MS;
  }

  async applyParryResult(result, enemy, hero, baseDmg) {
    const cfg = qte.results[result];
    const x = hero.container.x;
    const y = hero.container.y;

    if (cfg.text) Fx.popText(this, x, y, cfg.text, cfg.color, qte.text);
    if (cfg.flash) Fx.screenFlash(this, cfg.flash, qte.flashDepth);
    this.gainEcho(cfg.echo);

    const storyMult = this.registry.get('settings')?.storyMode ? qte.storyMode.damageMult : 1;
    const dmg = Math.round(baseDmg * cfg.damageMult * storyMult);
    if (dmg > 0) this.applyHit(hero, dmg);
    if (cfg.knockback && hero.hp > 0) Fx.knockback(this, hero.container, hero.facing === 'right' ? -cfg.knockback : cfg.knockback);

    if (result === 'PERFECT') {
      Fx.sparks(this, x, y + qte.ring.offsetY, cfg.sparks, qte.sparks, qte.ring.depth);
      Fx.shake(this, cfg.shake, cfg.hitstopMs * 2);
      await Fx.hitstop(this, cfg.hitstopMs);
      await this.playCounter(hero, enemy, cfg.counterDmg);
    }
  }

  // PERFECT: the hero answers with a counter. With a parry sheet the damage
  // lands on its impact frame; otherwise straight away.
  async playCounter(hero, enemy, dmg) {
    const counter = () => {
      if (enemy.hp > 0) this.applyHit(enemy, dmg);
    };
    if (!hasSheet(hero.anims, 'parry')) {
      counter();
      return;
    }
    await playOnce(hero.body, hero.type, 'parry', hero.anims.parry, { onImpact: (i) => i === 0 && counter() });
    if (hero.hp > 0) hero.body.play(animKey(hero.type, 'idle'));
  }

  gainEcho(amount) {
    if (!amount) return;
    this.echo = Phaser.Math.Clamp(this.echo + amount, 0, ui.hud.echo.max);
    this.refreshHud();
  }

  // ---------- Attack execution ----------

  async playerStrike(hero, target) {
    const restX = hero.container.x;
    const approachX = Phaser.Math.Linear(restX, target.container.x, 0.7);

    await this.tweenPromise(hero.container, { x: approachX }, DASH_DURATION_MS);

    // A Strike deals its damage once, on the first impact frame.
    const dmg = Phaser.Math.Between(hero.def.strike[0], hero.def.strike[1]);
    await this.playAttackAnim(hero, (i) => {
      if (i === 0) this.applyHit(target, dmg);
    });

    await this.tweenPromise(hero.container, { x: restX }, DASH_DURATION_MS);
  }

  // onImpact(i, count) fires on each impact frame of a sheet attack, or once
  // at the end of a rig attack.
  async playAttackAnim(entity, onImpact) {
    if (hasSheet(entity.anims, 'attack')) {
      await playOnce(entity.body, entity.type, 'attack', entity.anims.attack, { onImpact });
      if (entity.hp > 0) entity.body.play(animKey(entity.type, 'idle'));
      return;
    }

    if (entity.def.parts && Object.keys(entity.parts).length > 0) {
      await this.playRigAttack(entity);
    } else {
      const dirSign = entity.facing === 'right' ? 1 : -1;
      await this.playLungeAttack(entity, dirSign);
    }
    if (onImpact) onImpact(0, 1);
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
      const { distance, squash } = entity.def.attack.distance !== undefined ? entity.def.attack : FALLBACK_LUNGE;
      const startX = entity.container.x;
      const baseScaleY = entity.container.scaleY;

      this.tweens.chain({
        targets: entity.container,
        tweens: [
          { x: startX + distance * dirSign, duration: LUNGE_OUT_MS, ease: 'Quad.easeOut' },
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
    if (target.isHero) this.refreshHud();

    if (target.hp <= 0) this.markDown(target);
    else this.playHurt(target);
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

    // Heroes still standing celebrate if they have a victory sheet (last frame held).
    if (result === 'WIN') {
      for (const hero of this.heroes) {
        if (hero.hp > 0 && hasSheet(hero.anims, 'victory')) hero.body.play(animKey(hero.type, 'victory'));
      }
    }

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
