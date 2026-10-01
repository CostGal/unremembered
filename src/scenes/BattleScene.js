import Phaser from 'phaser';
import battles from '../data/battles.json';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import environments from '../data/environments.json';
import allies from '../data/allies.json';
import battleEvents from '../data/battleEvents.json';
import brk from '../data/break.json';
import statuses from '../data/statuses.json';
import qte from '../data/qte.json';
import techniques from '../data/techniques.json';
import ui from '../data/ui.json';
import { playMusic, playSfx, setMusicIntensity, setMusicWarm, vibrate } from '../systems/Audio.js';
import BattleStateMachine from '../systems/BattleStateMachine.js';
import * as Fx from '../systems/Fx.js';
import { mirrorEdges, rect as viewRect } from '../systems/View.js';
import { difficultyDef } from '../systems/Difficulty.js';
import CommandMenu from '../systems/CommandMenu.js';
import Hud from '../systems/Hud.js';
import PoiseBar from '../systems/PoiseBar.js';
import ResultCard from '../systems/ResultCard.js';
import TutorialHints from '../systems/TutorialHints.js';
import * as Qte from '../systems/Qte.js';
import { devInt } from '../systems/DevParams.js';
import { effectMax, effectTotal, ownedFragments } from '../systems/Fragments.js';
import { animKey, hasSheet, playLoop, playOnce, SheetDriver, trace } from '../systems/SpriteAnims.js';
import { whenReady } from '../systems/Assets.js';

const layout = ui.battleLayout;

const ATTACK_DURATION_MS = 400;
const DASH_DURATION_MS = 180;
const LUNGE_OUT_MS = 150;
const WINDUP_MS = 200;
// Lunge used when a sheet character's attack sheet is missing and its def has no lunge data.
const FALLBACK_LUNGE = { distance: 10, squash: 0.15 };

// The first red ring runs in slow-mo with a prompt until the player has dodged
// once (or seen it unparryable.lesson.attempts times). Lives for the page
// session, like the tutorial hints: a Retry doesn't repeat it.
const dodgeLesson = { runs: 0, learned: false };

// ?battle=<id> (e.g. ?battle=boss_clerk) — starts that battle straight from
// Preload. Not linked from anywhere, works in the production build.
export function devBattleId() {
  try {
    const id = new URLSearchParams(window.location.search).get('battle');
    if (!id) return null;
    if (battles[id]) return id;
    console.warn(`?battle=${id}: no such battle in battles.json`);
  } catch (err) {
    // no URL access (e.g. sandboxed webview) — just boot normally
  }
  return null;
}

export default class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
  }

  init(data) {
    this.initData = data;
    this.battleId = data.battleId || 'b1_tutorial';
    this.battleDef = battles[this.battleId];
  }

  // Waits for this scene's assets (loaded in the background by the Loader).
  create() {
    whenReady(this, () => this.build());
  }

  build() {
    this.manifest = this.registry.get('manifest');
    this.animationSets = this.registry.get('animationSets') || {};
    this.battleOver = false;
    // Fragments picked this run (fragments.json): passives for every battle.
    this.fragments = ownedFragments(this.registry);
    // Scene instances are reused (Retry, battle -> battle), so reset state here.
    this.tutorialPrompt = null;
    this.stance = null;
    this.brace = null;
    this.activeHero = null;
    this.nala = null;
    this.setTimeScale(1);
    playMusic(this.battleDef.music || null);
    setMusicIntensity(0);
    setMusicWarm(false);
    this.difficulty = difficultyDef(this.registry.get('settings'));
    this.echoFrac = 0;
    this.tutorialSlow = !!this.battleDef.tutorial;
    this.pendingEvents = [];
    this.timeScale = 1;
    this.resumeGate = null;
    this.listenForBackground();
    this.hints = new TutorialHints(this, !!this.battleDef.tutorial);
    this.activeMarker = null;

    const view = viewRect();
    mirrorEdges(this, this.add.image(180, 180, this.battleDef.bg).setDisplaySize(360, 360));
    this.add.rectangle(view.x, 0, view.w, 360, 0x000000, 0.2).setOrigin(0);
    this.environment = environments[this.battleDef.bg] || {};
    this.createEnvironmentFx();

    if (this.battleDef.nala) this.createNala();

    const heroKeys = ['rhea', 'dov'];
    this.heroes = heroKeys.map((key) =>
      this.createEntity(key, key, characters[key], layout.heroes[key], 'right', true)
    );

    const dov = this.heroes.find((h) => h.type === 'dov');
    dov.maxHp += effectTotal(this.fragments, 'dovMaxHp');
    dov.hp = dov.maxHp;

    const enemyKeys = this.battleDef.enemies;
    const slots = this.enemySlots(enemyKeys);
    this.enemies = enemyKeys.map((key, i) =>
      this.createEntity(`${key}_${i}`, key, enemies[key], slots[Math.min(i, slots.length - 1)], 'left', false)
    );

    this.applyAmbientTint();

    // ?echo=N starts the battle with N Echo (dev).
    this.echo = Phaser.Math.Clamp((devInt('echo') ?? 0) + effectTotal(this.fragments, 'startEcho'), 0, ui.hud.echo.max);
    // Perfect chain (qte.json chain). maxChain is read at the end of the battle (battle grade).
    this.chain = 0;
    this.maxChain = 0;
    // Stats for the result card (grade.json): maxChain is above.
    this.stats = { perfects: 0, damageTaken: 0, turns: 0 };
    this.hud = new Hud(this, ui.hud, ui.font, this.heroes);
    this.hud.setFragments(this.fragments);
    this.refreshHud();
    if (import.meta.env.DEV) {
      this.enableHudDebug();
      window.__battle = this;
    }

    this.buildCommandMenu();
    this.buildTapHint();

    const machine = new BattleStateMachine({
      intro: () => this.playIntro(),
      isAlive: (entity) => entity.hp > 0,
      allEnemiesDown: () => this.enemies.every((e) => e.hp <= 0),
      allHeroesDown: () => this.heroes.every((h) => h.hp <= 0),
      roundStart: () => (this.stats.turns += 1),
      playerTurn: (hero) => this.playerTurn(hero),
      enemyTurn: (enemy) => this.enemyTurn(enemy),
      afterTurn: () => this.afterTurn(),
      onEnd: (result) => this.onBattleEnd(result),
    });

    machine.run(this.heroes, this.enemies);
  }

  // ---------- App switch ----------

  // The app went to the background (another app, lock screen): the battle
  // pauses, live rings stop without a judgement, and "Tap to continue" waits
  // on return. Whoever was waiting on a ring restarts it (resumeGate).
  // A battle already paused by the Keepsake dialogue is left alone.
  listenForBackground() {
    const onHidden = () => this.pauseForBackground();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once('shutdown', () => this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden));
  }

  pauseForBackground() {
    if (this.resumeGate || !this.scene.isActive()) return;
    Qte.interruptRings(this);
    this.scene.pause();
    this.resumeGate = new Promise((resolve) => {
      this.scene.launch('Pause', {
        onContinue: () => {
          this.resumeGate = null;
          this.scene.resume();
          resolve();
        },
      });
      this.scene.bringToTop('Pause');
    });
  }

  // ---------- Environment ----------

  // Lantern glows, rain and vignette for this battle's background (environments.json).
  createEnvironmentFx() {
    const env = this.environment;
    const view = viewRect();
    const area = { x: view.x, y: 0, w: view.w, h: layout.sceneBottom };
    if (env.lights) Fx.lights(this, env.lights);
    if (env.rain) Fx.rain(this, env.rain, area);
    if (env.vignette) Fx.vignette(this, env.vignette, area);
    // Lightning waits for a quiet moment: never while a parry ring is live.
    if (env.lightning) this.lightning = Fx.lightning(this, env.lightning, area, () => (this.qteRings?.size || 0) > 0);
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

  // Nala sits behind the heroes. When a Hollow telegraphs she glows, and a
  // tap on her cancels that attack — once per battle (allies.json).
  createNala() {
    const sprite = this.manifest.sprites.nala;
    const def = allies.nala;
    const { x, feetY } = layout.nala;
    const container = this.add.container(x, feetY - sprite.h / 2).setDepth(feetY);
    const glow = this.add.image(0, 0, Fx.glowTexture(this, def.glow.radius)).setBlendMode(Phaser.BlendModes.ADD).setTint(Number(def.glow.color)).setAlpha(0);
    const animSet = this.animationSets.nala;
    const anims = animSet?.animations?.idle ? animSet.animations : null;
    const image = anims ? playLoop(this.add.sprite(0, 0, animKey('nala', 'idle')), 'nala', 'idle') : this.add.image(0, 0, 'nala');
    container.add([glow, image]);
    const faces = anims ? animSet.facing || 'left' : sprite.faces || 'right';
    container.setScale(faces !== 'right' ? -1 : 1, 1);
    this.checkLayout('nala', feetY, sprite.h);
    this.nala = { container, image, glow, anims, def, used: false, usesLeft: 1 + effectTotal(this.fragments, 'nalaExtraUses'), ring: null };
    if (!anims || anims.idle.placeholder) this.idleBob(container);

    image.setInteractive({ useHandCursor: true });
    image.on('pointerdown', () => this.nalaHiss());
  }

  // Called when an enemy starts a telegraph. Returns true if Nala is watching it.
  nalaWatch(enemy, ring) {
    const nala = this.nala;
    if (!nala || nala.used || !enemy.def.hollow) return false;
    nala.ring = ring;
    nala.enemy = enemy;
    const g = nala.def.glow;
    nala.glowTween = this.tweens.add({ targets: nala.glow, alpha: { from: g.alphaMin, to: g.alphaMax }, duration: g.pulseMs, yoyo: true, repeat: -1 });
    if (hasSheet(nala.anims, 'alert')) playLoop(nala.image, 'nala', 'alert');
    else trace('fallback:alert:nala');
    this.tapHint.setText(nala.def.promptText);
    return true;
  }

  nalaStopWatching() {
    const nala = this.nala;
    if (!nala?.ring) return;
    nala.ring = null;
    if (nala.glowTween) nala.glowTween.stop();
    nala.glow.setAlpha(0);
    if (hasSheet(nala.anims, 'alert')) nala.image.play(animKey('nala', 'idle'));
    this.tapHint.setText(qte.hint.text);
  }

  nalaHiss() {
    const nala = this.nala;
    if (!nala?.ring || nala.used) return;
    nala.usesLeft -= 1;
    nala.used = nala.usesLeft <= 0;
    const { ring, enemy, def } = nala;
    this.nalaStopWatching();
    ring.cancel();

    Fx.popText(this, nala.container.x, nala.container.y, def.hissText, def.hissColor, qte.text);
    Fx.popText(this, enemy.container.x, enemy.container.y, def.cancelText, def.hissColor, qte.text);
    Fx.shake(this, def.shake, def.shakeMs);
    if (hasSheet(nala.anims, 'hiss')) {
      playOnce(nala.image, 'nala', 'hiss', nala.anims.hiss).then(() => nala.image.play(animKey('nala', 'idle')));
    } else {
      this.tweens.add({ targets: nala.container, scaleY: nala.container.scaleY * def.hopSquash, duration: def.hopMs, yoyo: true });
    }
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
      playLoop(body, type, 'idle');
    }

    // Heroes' HP lives in the HUD; enemies keep an overhead label.
    const label = isHero
      ? null
      : this.add
          .text(x, y - height / 2 - layout.labelGap, '', {
            fontFamily: ui.font,
            fontSize: `${layout.label.fontSize}px`,
            color: layout.label.color,
            stroke: layout.label.stroke,
            strokeThickness: layout.label.strokeThickness,
          })
          .setOrigin(0.5, 1)
          .setDepth(layout.labelDepth);

    const entity = {
      id,
      type,
      def,
      name: def.name,
      // Difficulty scales enemy HP (qte.json difficulties.enemyHpMult).
      hp: isHero ? def.hp : Math.round(def.hp * this.difficulty.enemyHpMult),
      maxHp: isHero ? def.hp : Math.round(def.hp * this.difficulty.enemyHpMult),
      container,
      body,
      parts,
      anims,
      label,
      facing,
      isHero,
      restX: x,
      height,
    };

    this.updateLabel(entity);
    // Memory statuses (statuses.json): {id: {turns, tech}} on heroes.
    if (isHero) entity.statuses = {};
    // Poise (break.json): pips under the name; at 0 the enemy is BROKEN.
    if (!isHero && def.poise) {
      entity.poise = def.poise;
      entity.maxPoise = def.poise;
      entity.broken = false;
      entity.poiseBar = new PoiseBar(this, label, def.poise);
    }
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
      heroes: this.heroes.map((h) => ({ hp: h.hp, maxHp: h.maxHp, statuses: this.statusList(h) })),
      echo: this.echo,
    });
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
    if (entity.isHero) {
      entity.statuses = {};
      this.refreshHud();
    }
    if (entity.bobTween) entity.bobTween.stop();
    if (entity.label) this.tweens.add({ targets: entity.label, alpha: 0, duration: ui.downed.enemyFadeMs });
    if (entity.poiseBar) {
      entity.poiseBar.setBroken(false);
      this.tweens.add({ targets: entity.poiseBar.objects, alpha: 0, duration: ui.downed.enemyFadeMs });
    }

    // The death sheet holds its last frame; an enemy then fades out.
    if (hasSheet(entity.anims, 'death')) {
      playOnce(entity.body, entity.type, 'death', entity.anims.death).then(() => {
        if (!entity.isHero && entity.hp <= 0) this.tweens.add({ targets: entity.container, alpha: 0, duration: ui.downed.enemyFadeMs });
      });
      return;
    }
    trace(`fallback:death:${entity.type}`);

    if (entity.anims) entity.body.anims.stop();
    if (entity.isHero) {
      this.tweens.add({ targets: entity.container, alpha: ui.downed.heroAlpha, duration: ui.downed.fadeMs });
      return;
    }
    this.tweens.add({ targets: entity.container, alpha: 0, duration: ui.downed.enemyFadeMs });
  }

  // Non-lethal damage: the hurt sheet, then back to idle. Without a hurt sheet
  // it's the white flash from applyHit plus a knockback (heroes already get
  // theirs from the parry result).
  playHurt(entity) {
    if (!hasSheet(entity.anims, 'hurt')) {
      trace(`fallback:hurt:${entity.type}`);
      if (!entity.isHero) this.hurtKnockback(entity);
      return;
    }
    this.playReaction(entity, 'hurt');
  }

  // A one-shot reaction (hurt, dodge, parry), then back to the entity's rest
  // loop — unless another animation (the next strike, death) replaced it.
  playReaction(entity, name) {
    const key = animKey(entity.type, name);
    return playOnce(entity.body, entity.type, name, entity.anims[name]).then(() => {
      const still = entity.body.anims.currentAnim?.key === key;
      if (still && entity.hp > 0) playLoop(entity.body, entity.type, this.restAnim(entity));
    });
  }

  // The loop an entity returns to: idle, or its charge loop while charging.
  restAnim(entity) {
    const chargeAnim = entity.charge?.attack.chargeAnim;
    return entity.charge?.loop && hasSheet(entity.anims, chargeAnim) ? chargeAnim : 'idle';
  }

  // Knocks the body image (not the container, which the lunge/intro/dash tweens
  // own) away from the entity's facing, and always settles it back at 0.
  hurtKnockback(entity) {
    const { knockbackPx, durationMs } = ui.hurt;
    const body = entity.body;
    if (entity.hurtTween) entity.hurtTween.stop();
    body.x = 0;
    const away = entity.facing === 'right' ? -1 : 1;
    // body.x is in container space; a mirrored container flips it.
    const dx = (away * knockbackPx) / Math.sign(entity.container.scaleX || 1);
    entity.hurtTween = this.tweens.add({
      targets: body,
      x: dx,
      duration: durationMs / 2,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => (body.x = 0),
      onStop: () => (body.x = 0),
    });
  }

  // ---------- Command menu ----------

  buildCommandMenu() {
    this.menu = new CommandMenu(this, ui.commands, ui.font);
  }

  hideCommandMenu() {
    this.menu.hide();
  }

  // Main menu → (technique submenu) → (target). Back steps out one level.
  // Resolves {kind: 'strike' | 'technique' | 'ultimate', techId, target}.
  async chooseAction(hero) {
    const labels = ui.commands.labels;
    // Fog: the command names read "???" (the buttons still work).
    const name = (label) => (this.fogged(hero) ? statuses.fog.label : label);
    while (true) {
      const main = [
        { slot: 'strike', label: name(labels.strike), value: 'strike', pulse: this.hints.isShowing('strike') },
        {
          slot: 'technique',
          label: name(labels.technique),
          value: 'technique',
          enabled: (hero.def.techniques || []).some((id) => !this.covered(hero, id)),
          pulse: this.hints.isShowing('techniques'),
        },
      ];
      if (this.canUltimate(hero)) {
        main.push({ slot: 'recollection', label: name(labels.recollection), value: 'ultimate', pulse: true });
      }
      const pick = await this.menu.show(main);

      if (pick === 'strike') {
        const target = await this.pickEnemy();
        if (target) return { kind: 'strike', techId: 'strike', target };
        continue;
      }

      if (pick === 'ultimate') {
        const target = await this.pickEnemy();
        if (target) return { kind: 'ultimate', techId: 'recollection', target };
        continue;
      }

      const techId = await this.menu.show(this.techniqueItems(hero));
      if (!techId) continue;
      if (techniques[techId].target !== 'enemy') return { kind: 'technique', techId };
      const target = await this.pickEnemy();
      if (target) return { kind: 'technique', techId, target };
    }
  }

  canUltimate(hero) {
    return !!hero.def.canUltimate && this.echo >= techniques.recollection.cost;
  }

  techniqueItems(hero) {
    const slots = ui.commands.techniqueSlots;
    const items = (hero.def.techniques || []).slice(0, slots.length).map((id, i) => ({
      slot: slots[i],
      label: this.fogged(hero) ? statuses.fog.label : techniques[id].name,
      cost: techniques[id].cost,
      // Redacted: covered by a black bar and can't be used.
      enabled: this.echo >= techniques[id].cost && !this.covered(hero, id),
      covered: this.covered(hero, id),
      value: id,
    }));
    items.push({ slot: 'back', label: ui.commands.labels.back, value: null });
    return items;
  }

  // One living enemy = automatic. Otherwise tap a highlighted enemy, or Back (→ null).
  pickEnemy() {
    const living = this.enemies.filter((e) => e.hp > 0);
    if (living.length <= 1) return Promise.resolve(living[0] || null);

    const markers = [];
    for (const enemy of living) {
      enemy.body.setTint(Number(ui.commands.targetTint));
      enemy.body.setInteractive({ useHandCursor: true });
      enemy.body.once('pointerdown', () => this.menu.choose(enemy));
      const top = enemy.label ? enemy.label.y - enemy.label.height : enemy.container.y - enemy.height / 2;
      markers.push(this.pointer(enemy.container.x, top - ui.targetMarker.gapY, ui.targetMarker));
    }

    const back = [{ slot: 'back', label: ui.commands.labels.back, value: null }];
    return this.menu.show(back, ui.commands.prompt.text).then((target) => {
      markers.forEach((m) => m.destroy());
      for (const enemy of living) {
        Fx.restoreTint(enemy.body);
        enemy.body.off('pointerdown');
        enemy.body.disableInteractive();
      }
      return target;
    });
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
    // A stance that was never tested ends when its owner acts again.
    if (this.stance?.hero === hero) this.endStance(false);

    this.showActiveHero(hero);
    this.hints.show('strike');
    const costs = (hero.def.techniques || []).map((id) => techniques[id].cost);
    if (costs.length && this.echo >= Math.min(...costs)) this.hints.show('techniques');
    const action = await this.chooseAction(hero);
    this.hints.done('strike');
    this.hints.done('techniques');
    this.showActiveHero(null);
    this.hideCommandMenu();

    const tech = techniques[action.techId];
    this.spendEcho(tech.cost);

    if (action.kind === 'strike') await this.playerStrike(hero, action.target);
    else if (action.kind === 'ultimate') await this.playRecollection(hero, action.target);
    else await this.runTechnique(hero, action.techId, action.target);
    this.tickStatuses(hero);
  }

  // The hero whose turn it is: a bobbing marker over their head and their
  // HUD row lit. null clears it.
  showActiveHero(hero) {
    if (this.activeMarker) this.activeMarker.destroy();
    this.activeMarker = null;
    this.hud.setActive(hero ? this.heroes.indexOf(hero) : -1);
    if (!hero) return;
    const a = ui.activeHero;
    this.activeMarker = this.pointer(hero.container.x, hero.container.y - hero.height / 2 - a.gapY, a);
  }

  // A small down-pointing triangle that bobs over (x, y). cfg = {color, size, bobPx, bobMs, depth}
  pointer(x, y, cfg) {
    const g = this.add.graphics({ x, y }).setDepth(cfg.depth);
    g.fillStyle(Number(cfg.color), 1);
    g.fillTriangle(-cfg.size, -cfg.size, cfg.size, -cfg.size, 0, 0);
    g.lineStyle(1, 0x0b0d14, 1);
    g.strokeTriangle(-cfg.size, -cfg.size, cfg.size, -cfg.size, 0, 0);
    this.tweens.add({ targets: g, y: y - cfg.bobPx, duration: cfg.bobMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return g;
  }

  // Each hit of the attack is its own parry ring on the targeted hero.
  // A hero in a counter stance draws the attack.
  async enemyTurn(enemy) {
    if (enemy.broken) {
      await this.skipBrokenTurn(enemy);
      return;
    }
    const livingHeroes = this.heroes.filter((h) => h.hp > 0);
    if (livingHeroes.length === 0) return;
    const stanceHero = this.stance && this.stance.hero.hp > 0 ? this.stance.hero : null;
    const target = stanceHero || Phaser.Utils.Array.GetRandom(livingHeroes);
    let attack;
    if (enemy.charge) {
      enemy.charge.turnsLeft -= 1;
      if (enemy.charge.turnsLeft > 0) {
        Fx.popText(this, enemy.container.x, enemy.container.y, battleEvents.charge.chargingText, battleEvents.charge.textColor, qte.text);
        await this.wait(battleEvents.charge.chargingMs);
        return;
      }
      attack = enemy.charge.attack;
      await this.endCharge(enemy);
    } else {
      attack = pickWeighted(this.pickableAttacks(enemy));
      if (attack.chargeTurns) {
        this.startCharge(enemy, attack);
        await this.wait(battleEvents.charge.chargingMs);
        return;
      }
    }

    this.tapHint.setVisible(true);
    const hits = attack.hits || [attack];
    const sheet = this.enemyAttackSheet(enemy, attack, hits.length);
    for (let k = 0; k < hits.length; k++) {
      if (target.hp <= 0 || enemy.hp <= 0) break;
      const hit = { ...hits[k], unparryable: hits[k].unparryable ?? attack.unparryable ?? false };
      const result = await this.enemyHit(enemy, target, hit, sheet, k);
      if (result === 'CANCEL') break;
    }
    if (sheet) await sheet.finish();
    this.tapHint.setVisible(false);
    this.brace = null;
  }

  // The parry tutorial teaches the tap first: no red-ring attack until it's done.
  pickableAttacks(enemy) {
    const attacks = this.enemyAttacks(enemy);
    const parryable = this.tutorialSlow ? attacks.filter((a) => !a.unparryable) : attacks;
    return parryable.length ? parryable : attacks;
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
    const mult = this.difficulty.windowMult;
    // Worn Glove: a wider PERFECT window.
    const windows = { ...qte.windows, perfectMs: qte.windows.perfectMs + effectTotal(this.fragments, 'perfectWindowMs') };
    return mult === 1 ? windows : Qte.scaledWindows(windows, mult);
  }

  // The ring closes at T. The enemy holds its windup pose through the
  // telegraph and is released just early enough for its impact to land on T.
  // Tutorial: while the player hasn't landed a GOOD/PERFECT yet, the whole
  // scene runs slowed down (ring, windows and animations alike).
  // An app switch mid-telegraph (INTERRUPTED) drops the attack back to idle
  // and, after "Tap to continue", runs the whole telegraph again.
  // sheet = enemyAttackSheet(...) or null (lunge rig); k = the hit's index.
  async enemyHit(enemy, target, hit, sheet, k) {
    let ring;
    let result;
    let input;
    let attackDone;
    const red = qte.unparryable;
    const lesson = hit.unparryable && !dodgeLesson.learned && dodgeLesson.runs < red.lesson.attempts;
    this.tapHint.setText(hit.unparryable ? red.hint : qte.hint.text);
    while (true) {
      const slow = this.tutorialSlow || lesson ? qte.tutorial.timeScale : 1;
      this.setTimeScale(slow);
      if (this.tutorialSlow || lesson) this.showTutorialPrompt(true, lesson ? red.lesson.text : qte.tutorial.prompt.text);

      const windows = this.parryWindows();
      const x = target.container.x;
      const y = target.container.y + qte.ring.offsetY;
      ring = Qte.runRing(this, {
        x,
        y,
        telegraphMs: hit.telegraphMs / slow,
        feint: hit.feint ? { ...hit.feint, pauseMs: hit.feint.pauseMs / slow } : null,
        windows: slow === 1 ? windows : Qte.scaledWindows(windows, 1 / slow),
        ring: hit.unparryable ? { ...qte.ring, color: red.ringColor, targetColor: red.targetColor } : qte.ring,
        swipe: qte.dodge.swipe,
        unparryable: hit.unparryable,
      });
      const icon = hit.unparryable ? this.showUnparryableIcon(x, y) : null;
      const watched = this.nalaWatch(enemy, ring);

      const abort = { aborted: false };
      const feintPauseMs = hit.feint ? hit.feint.pauseMs / slow : 0;
      attackDone = sheet ? sheet.strike(k, ring.impactAt, abort, feintPauseMs) : this.playLungeTelegraph(enemy, ring.impactAt, abort);

      ({ result, input } = await ring.promise);
      icon?.destroy();
      if (watched) this.nalaStopWatching();
      this.setTimeScale(1);
      this.showTutorialPrompt(false);

      if (result === 'INTERRUPTED') {
        abort.aborted = true;
        sheet?.abort();
        await this.resumeGate;
        await attackDone;
        continue;
      }
      if (result === 'CANCEL') {
        abort.aborted = true;
        sheet?.abort();
        await attackDone;
        return 'CANCEL';
      }
      break;
    }
    if (this.tutorialSlow && !hit.unparryable && result !== 'MISS') this.tutorialSlow = false;
    if (lesson) {
      dodgeLesson.runs += 1;
      if (input === 'swipe' && result !== 'MISS') dodgeLesson.learned = true;
    }
    this.tapHint.setText(qte.hint.text);
    await this.applyParryResult(result, enemy, target, hit, input);
    await attackDone;
    return result;
  }

  setTimeScale(scale) {
    this.timeScale = scale;
    this.tweens.timeScale = scale;
    this.anims.globalTimeScale = scale;
    this.time.timeScale = scale;
  }

  showTutorialPrompt(on, text = qte.tutorial.prompt.text) {
    if (!this.tutorialPrompt) {
      const p = qte.tutorial.prompt;
      this.tutorialPrompt = this.add
        .text(p.x, p.y, text, { fontFamily: ui.font, fontSize: `${p.fontSize}px`, color: p.color, align: 'center', wordWrap: { width: p.wrap } })
        .setOrigin(0.5)
        .setDepth(p.depth);
    }
    this.tutorialPrompt.setText(text).setVisible(on);
    this.tapHint.setVisible(!on);
  }

  // The "!" over a red ring (an attack that can't be parried).
  showUnparryableIcon(x, y) {
    const c = qte.unparryable.icon;
    const icon = this.add
      .text(x, y + c.offsetY, c.text, { fontFamily: ui.font, fontSize: `${c.fontSize}px`, color: c.color, stroke: c.stroke, strokeThickness: c.strokeThickness })
      .setOrigin(0.5)
      .setDepth(qte.ring.depth);
    this.tweens.add({ targets: icon, scale: 1.25, duration: c.pulseMs, yoyo: true, repeat: -1 });
    return icon;
  }

  // The attack's sheet: its own (attack.anim, else e.g. blank_punch), else the
  // generic attack sheet; null = the lunge rig. strike(k) holds the windup
  // (hit 0) or the frame after the previous impact (hit k), then releases so
  // impact frame k lands on the ring's impact time. A holdFrame between them
  // (Redact's feint) pauses there for the ring's feint pause. With fewer
  // impact frames than hits, the sheet replays for every hit.
  // abort() drops the attack (Nala, app switch); finish() plays out to idle.
  enemyAttackSheet(enemy, attack, hitCount) {
    const name = [attack.anim, attack.id, 'attack'].find((n) => n && hasSheet(enemy.anims, n));
    if (!name) return null;
    const def = enemy.anims[name];
    const impacts = def.impactFrames?.length ? [...def.impactFrames].sort((a, b) => a - b) : [def.frames - 1];
    const perHit = impacts.length < hitCount;
    const durations = def.durations_ms || [];
    const span = (from, to) => durations.slice(from, to).reduce((sum, ms) => sum + ms, 0);
    let driver = null;

    return {
      strike: async (k, impactAt, abort, feintPauseMs) => {
        const i = perHit ? 0 : Math.min(k, impacts.length - 1);
        if (driver && (perHit || driver.ended)) {
          driver.stop();
          driver = null;
        }
        if (!driver) driver = new SheetDriver(enemy.body, enemy.type, name, def);
        const d = driver;
        const impact = impacts[i];
        const holdAt = i === 0 ? Math.min(def.windupFrame ?? 0, impact) : Math.min(impacts[i - 1] + 1, impact);
        await d.runTo(holdAt);
        if (holdAt === def.windupFrame) trace(`windup:${d.key}`);
        const feintAt = feintPauseMs && def.holdFrame > holdAt && def.holdFrame < impact ? def.holdFrame : null;
        const lead = span(holdAt, impact) / (this.timeScale || 1) + (feintAt !== null ? feintPauseMs : 0);
        await new Promise((resolve) => this.atRealTime(impactAt - lead, resolve, () => abort.aborted));
        if (abort.aborted) return;
        if (feintAt !== null) {
          await d.runTo(feintAt);
          trace(`hold:${d.key}`);
          await new Promise((resolve) => this.atRealTime(performance.now() + feintPauseMs, resolve, () => abort.aborted));
          if (abort.aborted) return;
        }
        // An FX sheet named by def.projectile (Hollow's siphon stream) plays over
        // the sprite's frame while the move runs from here to its impact.
        const fx = this.enemyAttackFx(enemy, def);
        try {
          await d.runTo(impact);
        } finally {
          fx?.destroy();
        }
        trace(`impact:${d.key}`);
      },
      abort: () => driver?.stop(),
      finish: async () => {
        if (!driver) return;
        const { key } = driver;
        await driver.finish();
        const current = enemy.body.anims.currentAnim?.key;
        // A hurt/death that replaced the attack takes care of itself.
        if (enemy.hp > 0 && !enemy.charge && (!enemy.body.anims.isPlaying || current === key)) playLoop(enemy.body, enemy.type, 'idle');
      },
    };
  }

  enemyAttackFx(enemy, def) {
    if (!def.projectile || !hasSheet(enemy.anims, def.projectile)) return null;
    const fx = this.add.sprite(enemy.container.x, enemy.container.y, animKey(enemy.type, def.projectile));
    fx.setScale(enemy.container.scaleX, 1).setDepth(enemy.container.depth + 1);
    return playLoop(fx, enemy.type, def.projectile);
  }

  playLungeTelegraph(enemy, impactAt, abort) {
    trace(`fallback:lunge:${enemy.type}`);
    const lunge = enemy.def.attack?.distance !== undefined ? enemy.def.attack : FALLBACK_LUNGE;
    const dir = enemy.facing === 'right' ? 1 : -1;
    const restX = enemy.restX;
    const c = enemy.container;

    const windup = this.tweens.add({ targets: c, x: restX - dir * (lunge.windupPx || 0), duration: WINDUP_MS, ease: 'Quad.easeOut' });

    return new Promise((resolve) => {
      const outMs = LUNGE_OUT_MS / (this.timeScale || 1);
      this.atRealTime(impactAt - outMs, () => {
        windup.stop();
        if (abort.aborted) {
          this.tweens.add({ targets: c, x: restX, duration: WINDUP_MS, onComplete: resolve });
          return;
        }
        const baseScaleY = c.scaleY;
        this.tweens.chain({
          targets: c,
          tweens: [
            { x: restX + dir * lunge.distance, duration: LUNGE_OUT_MS, ease: 'Quad.easeOut' },
            { x: restX, duration: 150, ease: 'Quad.easeIn' },
          ],
          onComplete: () => {
            c.x = restX;
            resolve();
          },
        });
        this.tweens.add({ targets: c, scaleY: baseScaleY * (1 - lunge.squash), duration: 100, yoyo: true });
      }, () => abort.aborted);
    });
  }

  // ---------- Boss phases (enemies.json phases) ----------

  // A boss uses the attack list of its current phase.
  enemyAttacks(enemy) {
    return enemy.def.phases ? enemy.def.phases[enemy.phase || 0].attacks : enemy.def.attacks;
  }

  // After damage: move a boss into the next phase once its HP share drops to
  // the current phase's untilHpPct. The phase's onEnter event waits for the
  // end of the current turn (afterTurn).
  checkPhase(enemy) {
    const phases = enemy.def.phases;
    if (!phases || enemy.hp <= 0) return;
    const pct = (enemy.hp / enemy.maxHp) * 100;
    while ((enemy.phase || 0) < phases.length - 1 && pct <= phases[enemy.phase || 0].untilHpPct) {
      enemy.phase = (enemy.phase || 0) + 1;
      // The track plays harder in later phases (phases[n].musicIntensity, else evenly spread).
      setMusicIntensity(phases[enemy.phase].musicIntensity ?? enemy.phase / (phases.length - 1));
      const onEnter = phases[enemy.phase].onEnter;
      if (onEnter) this.pendingEvents.push(onEnter);
      // A new phase brings the poise back (a broken enemy recovers at the end of its stunned turn).
      if (enemy.maxPoise && !enemy.broken) this.refillPoise(enemy);
    }
  }

  async afterTurn() {
    while (this.pendingEvents.length && !this.battleOver) {
      const event = this.pendingEvents.shift();
      if (event === 'keepsake_burn') await this.keepsakeBurn();
    }
  }

  // Keepsake: the battle pauses for a conversation, then Echo fills and the
  // Recollection button pulses on Rhea's next turn.
  async keepsakeBurn() {
    if (this.enemies.every((e) => e.hp <= 0)) return;
    await this.playDialogueOverlay(battleEvents.keepsake_burn.dialogue);
    this.gainEcho(ui.hud.echo.max);
    const k = battleEvents.keepsake_burn;
    Fx.screenFlash(this, k.flash, qte.flashDepth);
  }

  playDialogueOverlay(id) {
    return new Promise((resolve) => {
      if (!this.scene.get('Dialogue')) {
        resolve();
        return;
      }
      this.scene.pause();
      this.scene.launch('Dialogue', {
        id,
        overlay: true,
        onDone: () => {
          this.scene.resume();
          resolve();
        },
      });
      this.scene.bringToTop('Dialogue');
    });
  }

  // ---------- Archive (charged attack) ----------

  // First pick: the enemy starts charging instead of attacking. It charges
  // for chargeTurns enemy turns (glow + damage-to-interrupt counter), then
  // fires as a normal hit. Enough damage during the charge cancels it.
  startCharge(enemy, attack) {
    const c = battleEvents.charge;
    const glow = this.add
      .image(enemy.container.x, enemy.container.y, Fx.glowTexture(this, c.glowRadius))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(Number(c.glowColor))
      .setDepth(enemy.container.depth - 1);
    const glowTween = this.tweens.add({ targets: glow, alpha: { from: c.glowAlphaMin, to: c.glowAlphaMax }, duration: c.glowPulseMs, yoyo: true, repeat: -1 });
    const counter = this.add
      .text(enemy.container.x, enemy.label.y - enemy.label.height + c.counterOffsetY, '', { fontFamily: ui.font, fontSize: `${c.counterFontSize}px`, color: c.counterColor })
      .setOrigin(0.5, 1)
      .setDepth(layout.labelDepth);
    // The charge sheet (archive_charge: _in -> loop -> _out) if there is one.
    const loop = attack.chargeAnim && hasSheet(enemy.anims, attack.chargeAnim) ? this.loopWithInOut(enemy, attack.chargeAnim) : null;
    if (!loop) trace(`fallback:charge:${enemy.type}`);
    enemy.charge = { attack, turnsLeft: attack.chargeTurns, dealt: 0, glow, glowTween, counter, loop };
    this.updateChargeCounter(enemy);
    Fx.popText(this, enemy.container.x, enemy.container.y, c.startText, c.textColor, qte.text);
  }

  updateChargeCounter(enemy) {
    const ch = enemy.charge;
    const c = battleEvents.charge;
    ch.counter.setText(c.counterText.replace('{n}', ch.dealt).replace('{max}', ch.attack.interruptDmg));
  }

  // Party damage during a charge counts toward the interrupt.
  chargeDamage(enemy, dmg) {
    const ch = enemy.charge;
    if (!ch) return;
    ch.dealt += dmg;
    this.updateChargeCounter(enemy);
    if (ch.dealt >= ch.attack.interruptDmg || enemy.hp <= 0) {
      if (enemy.hp > 0) Fx.popText(this, enemy.container.x, enemy.container.y, battleEvents.charge.interruptText, battleEvents.charge.textColor, qte.text);
      this.endCharge(enemy, true);
    }
  }

  // Resolves once the charge sheet's _out has played. interrupted = back to
  // idle afterwards (when firing, the release attack takes over instead).
  async endCharge(enemy, interrupted = false) {
    const ch = enemy.charge;
    if (!ch) return;
    ch.glowTween.stop();
    ch.glow.destroy();
    ch.counter.destroy();
    enemy.charge = null;
    if (!ch.loop) return;
    await ch.loop.stop();
    if (interrupted && enemy.hp > 0 && !enemy.body.anims.isPlaying) playLoop(enemy.body, enemy.type, 'idle');
  }

  // ---------- Recollection (ultimate) ----------

  // The screen warms to gold (and the background becomes memory_city if it
  // exists), then three rhythm rings close on the target, intervalMs apart.
  async playRecollection(hero, target) {
    const tech = techniques.recollection;
    const r = qte.recollection;

    const view = viewRect();
    const overlay = this.add.rectangle(view.x, 0, view.w, layout.sceneBottom, Number(r.tint.color), 0).setOrigin(0).setDepth(r.tint.depth);
    this.tweens.add({ targets: overlay, fillAlpha: r.tint.alpha, duration: r.tint.fadeMs });
    let memoryBg = null;
    if (this.textures.exists(r.bg) && !this.textures.get(r.bg).customData.placeholder) {
      memoryBg = this.add.image(180, 180, r.bg).setDisplaySize(360, 360).setDepth(r.bgDepth).setAlpha(0);
      const edges = mirrorEdges(this, memoryBg);
      memoryBg.edges = edges;
      this.tweens.add({ targets: [memoryBg, ...edges], alpha: 1, duration: r.tint.fadeMs });
      const destroyBg = memoryBg.destroy.bind(memoryBg);
      memoryBg.destroy = () => {
        edges.forEach((e) => e.destroy());
        destroyBg();
      };
    }
    Fx.popText(this, hero.container.x, hero.container.y, tech.name, r.textColor, qte.text);
    playSfx('ultimate');
    setMusicWarm(true);
    const castDone = this.playCastLoop(hero);
    await this.wait(r.tint.fadeMs);

    this.tapHint.setVisible(true);
    await this.recollectionRings(target, tech);
    this.tapHint.setVisible(false);
    castDone.stop();
    setMusicWarm(false);

    this.tweens.add({ targets: overlay, fillAlpha: 0, duration: r.tint.fadeMs, onComplete: () => overlay.destroy() });
    if (memoryBg) this.tweens.add({ targets: [memoryBg, ...(memoryBg.edges || [])], alpha: 0, duration: r.tint.fadeMs, onComplete: () => memoryBg.destroy() });
    await this.wait(r.tint.fadeMs);
  }

  // One ring at a time, each with its own "1/3" counter and feedback; the next
  // one starts intervalMs after the previous ring's impact, so they never
  // overlap. An app switch restarts the ring that was running.
  async recollectionRings(target, tech) {
    const r = qte.recollection;
    const ringCfg = { ...qte.ring, color: r.ringColor, targetColor: r.ringColor };
    const x = target.container.x;
    const y = target.container.y + qte.ring.offsetY;
    const c = r.counter;
    const counter = this.add
      .text(x, y - qte.ring.startRadius - c.gap, '', {
        fontFamily: ui.font,
        fontSize: `${c.fontSize}px`,
        color: r.textColor,
        stroke: c.stroke,
        strokeThickness: c.strokeThickness,
      })
      .setOrigin(0.5, 1)
      .setDepth(qte.ring.depth);

    for (let i = 0; i < tech.taps; i++) {
      counter.setText(r.counter.text.replace('{i}', i + 1).replace('{n}', tech.taps));
      this.tweens.add({ targets: counter, scale: { from: r.counter.popScale, to: 1 }, duration: r.counter.popMs, ease: 'Back.easeOut' });
      let ring;
      let result;
      do {
        ring = Qte.runRing(this, { x, y, telegraphMs: r.ringMs, windows: this.parryWindows(), ring: ringCfg });
        ({ result } = await ring.promise);
        if (result === 'INTERRUPTED') await this.resumeGate;
      } while (result === 'INTERRUPTED');
      this.recollectionHit(target, result, tech);
      if (i < tech.taps - 1) await this.wait(Math.max(0, ring.impactAt + tech.intervalMs - performance.now()));
    }
    counter.destroy();
  }

  recollectionHit(target, result, tech) {
    const r = qte.recollection;
    const cfg = qte.results[result];
    const dmg = tech.dmg[result.toLowerCase()];
    playSfx(result.toLowerCase());
    Fx.popText(this, target.container.x, target.container.y, cfg.text || result, result === 'MISS' ? r.missColor : r.textColor, qte.text);
    if (result === 'PERFECT') {
      Fx.sparks(this, target.container.x, target.container.y, cfg.sparks, { ...qte.sparks, color: r.ringColor }, qte.ring.depth);
      Fx.shake(this, cfg.shake, cfg.hitstopMs * 2);
    }
    if (target.hp > 0) this.applyHit(target, dmg, r.textColor, { poise: brk.sources.hit });
  }

  // Loops the cast sheet (cast_in first) until stop(); cast_out on stop.
  playCastLoop(hero) {
    if (!hasSheet(hero.anims, 'cast')) {
      trace(`fallback:cast:${hero.type}`);
      return { stop: () => {} };
    }
    const loop = this.loopWithInOut(hero, 'cast');
    return { stop: () => loop.stop().then(() => hero.hp > 0 && playLoop(hero.body, hero.type, 'idle')) };
  }

  // <name>_in (if any) -> <name> looping, until stop(); stop() plays
  // <name>_out (if any) and resolves when it's done. Something else taking
  // over the sprite in between (hurt, death) just ends the loop.
  loopWithInOut(entity, name) {
    const loopKey = animKey(entity.type, name);
    let stopped = false;
    const intro = hasSheet(entity.anims, `${name}_in`) ? playOnce(entity.body, entity.type, `${name}_in`, entity.anims[`${name}_in`]) : Promise.resolve();
    const started = intro.then(() => {
      if (!stopped && entity.hp > 0) playLoop(entity.body, entity.type, name);
    });
    return {
      stop: async () => {
        stopped = true;
        await started;
        const current = entity.body.anims.currentAnim?.key;
        if (entity.hp <= 0 || (current !== loopKey && current !== animKey(entity.type, `${name}_in`))) return;
        if (hasSheet(entity.anims, `${name}_out`)) await playOnce(entity.body, entity.type, `${name}_out`, entity.anims[`${name}_out`]);
        else entity.body.anims.stop();
      },
    };
  }

  // Calls fn once performance.now() reaches t (or as soon as early() is true),
  // checked every frame, so it follows the ring's clock whatever the scene's
  // time scale is.
  atRealTime(t, fn, early = () => false) {
    const check = () => {
      if (performance.now() < t && !early()) return;
      this.events.off('update', check);
      fn();
    };
    this.events.on('update', check);
    this.events.once('shutdown', () => this.events.off('update', check));
    check();
  }

  // input = 'tap' (parry) | 'swipe' (dodge, qte.json dodge.results overrides:
  // no counter, less Echo) | null (no input at all).
  async applyParryResult(result, enemy, hero, hit, input = 'tap') {
    const dodged = input === 'swipe';
    const cfg = dodged ? { ...qte.results[result], ...qte.dodge.results[result] } : qte.results[result];
    const baseDmg = hit.dmg;
    const x = hero.container.x;
    const y = hero.container.y;

    if (cfg.text) Fx.popText(this, x, y, cfg.text, cfg.color, qte.text);
    if (cfg.flash) Fx.screenFlash(this, cfg.flash, qte.flashDepth);
    if (hit.unparryable && input === 'tap') Fx.popText(this, x, y + qte.text.riseY, qte.unparryable.tapText, qte.unparryable.tapColor, qte.text);
    playSfx(result.toLowerCase());
    vibrate(cfg.vibrateMs);
    if (result !== 'MISS') this.hints.show('echo');
    // Before the counter below, so a PERFECT's own counter already gets the new step.
    // A PERFECT dodge leaves the chain as it is (cfg.chain 0).
    if (cfg.chain !== 0) this.updateChain(result);
    this.gainEcho(cfg.echo + (result === 'PERFECT' ? effectTotal(this.fragments, 'perfectEchoBonus') : 0));
    if (result === 'PERFECT') this.stats.perfects += 1;
    // e.g. Siphon: a missed parry also drains Echo.
    if (result === 'MISS' && hit.onMiss?.echo) this.gainEcho(hit.onMiss.echo);

    const storyMult = this.difficulty.damageMult;
    const braceMult = this.brace ? this.brace.damageMult : 1;
    const dmg = Math.round(baseDmg * cfg.damageMult * storyMult * braceMult);
    // Reactions (ART_BRIEF): PERFECT -> parry (the counter), GOOD -> dodge,
    // MISS -> hurt, each only if the character has that sheet.
    const dodge = (result === 'GOOD' || (result === 'PERFECT' && dodged)) && hero.hp > 0 && hasSheet(hero.anims, 'dodge');
    if (dmg > 0) this.applyHit(hero, dmg, undefined, { react: !dodge });
    if (dodge && hero.hp > 0) this.playReaction(hero, 'dodge');
    if (dmg > 0 && this.brace) Fx.popText(this, x, y + qte.text.riseY, this.brace.blockText, this.brace.color, qte.text);
    if (cfg.knockback && hero.hp > 0) Fx.knockback(this, hero.container, hero.facing === 'right' ? -cfg.knockback : cfg.knockback);
    // e.g. Redact: a missed parry also leaves a memory status.
    if (result === 'MISS' && hit.onMiss?.status && Math.random() < (hit.onMiss.chance ?? 1)) this.applyStatus(hero, hit.onMiss.status);

    if (result === 'PERFECT') {
      Fx.sparks(this, x, y + qte.ring.offsetY, cfg.sparks, qte.sparks, qte.ring.depth);
      if (cfg.hitstopMs) {
        Fx.shake(this, cfg.shake, cfg.hitstopMs * 2);
        await Fx.hitstop(this, cfg.hitstopMs);
      }
    }

    // A hero in Return to Sender answers any parry with the big counter
    // (a dodge isn't a parry).
    if (this.stance?.hero === hero) {
      await this.endStance(!dodged && result !== 'MISS' && hero.hp > 0, enemy, result);
      return;
    }
    if (result === 'PERFECT' && cfg.counterDmg) await this.playCounter(hero, enemy, cfg.counterDmg);
  }

  // ---------- Perfect chain ----------

  // PERFECT +1, GOOD keeps it, MISS (full damage) breaks it. Only enemy-attack
  // parries count; Recollection's rhythm rings don't.
  updateChain(result) {
    const c = qte.chain;
    const before = this.chain;
    if (result === 'PERFECT') this.chain += 1;
    else if (result === 'MISS') this.chain = 0;
    if (this.chain === before) return;

    this.maxChain = Math.max(this.maxChain, this.chain);
    this.hud.setChain(this.chain);
    if (this.chain === 0) {
      const at = this.hud.chainPosition();
      Fx.sparks(this, at.x, at.y, c.break.sparks, { ...qte.sparks, color: c.break.sparkColor }, qte.ring.depth);
      return;
    }
    if (this.chain >= 2) this.hints.show('chain');
    if (this.chain === c.rhythmAt) {
      const r = c.rhythm;
      Fx.screenFlash(this, r.flash, qte.flashDepth);
      Fx.shake(this, r.shake, r.shakeMs);
      Fx.popText(this, r.x, r.y, r.text, r.color, { ...qte.text, fontSize: r.fontSize });
      Fx.sparks(this, r.x, r.y, r.sparks, { ...qte.sparks, color: r.sparkColor }, qte.ring.depth);
    }
  }

  // +stepPct% per chain step, capped at maxSteps. Fractions round up or down by
  // chance (expected value stays exact), so +10% still means something on a 3-damage bolt.
  chainDamage(dmg) {
    const c = qte.chain;
    const mult = 1 + (Math.min(this.chain, c.maxSteps) * c.stepPct) / 100;
    return mult === 1 ? dmg : Math.floor(dmg * mult + Math.random());
  }

  // PERFECT: the hero answers with a counter. With a parry sheet the damage
  // lands on its impact frame; otherwise straight away.
  async playCounter(hero, enemy, dmg) {
    const counter = () => {
      if (enemy.hp > 0) this.applyHit(enemy, dmg, undefined, { poise: brk.sources.counter });
    };
    if (!hasSheet(hero.anims, 'parry')) {
      trace(`fallback:parry:${hero.type}`);
      counter();
      return;
    }
    await playOnce(hero.body, hero.type, 'parry', hero.anims.parry, { onImpact: (i) => i === 0 && counter() });
    if (hero.hp > 0) hero.body.play(animKey(hero.type, 'idle'));
  }

  // Gains show as a small teal "+N" over the pip they fill.
  gainEcho(amount) {
    if (!amount) return;
    // A difficulty with echoMult < 1 earns Echo more slowly: the fraction
    // carries over, so half the gains still add up to whole pips.
    if (amount > 0 && this.difficulty.echoMult !== 1) {
      this.echoFrac = (this.echoFrac || 0) + amount * this.difficulty.echoMult;
      amount = Math.floor(this.echoFrac);
      this.echoFrac -= amount;
      if (!amount) return;
    }
    const before = this.echo;
    this.echo = Phaser.Math.Clamp(this.echo + amount, 0, ui.hud.echo.max);
    this.refreshHud();
    const gained = this.echo - before;
    if (gained > 0) {
      playSfx('echo');
      const pip = this.hud.pipPosition(this.echo - 1);
      Fx.damageNumber(this, pip.x, pip.y + ui.damageNumbers.echoOffsetY, `+${gained}`, null, 'echo');
    }
  }

  spendEcho(amount) {
    if (!amount) return;
    this.echo = Math.max(0, this.echo - amount);
    this.refreshHud();
  }

  // ---------- Techniques (techniques.json) ----------

  async runTechnique(hero, techId, target) {
    const tech = techniques[techId];
    if (tech.type === 'blast') await this.playBlast(hero, target, tech);
    else if (tech.type === 'counterStance') await this.startStance(hero, tech);
    else if (tech.type === 'heal') await this.playHeal(hero, tech);
    else if (tech.type === 'brace') await this.playBrace(hero, tech);
  }

  // Blast: 3–6 bolts; every bolt has a chance to crit, and each crit adds a
  // bolt (up to maxHits). With a blast sheet the bolts fly while the anim holds
  // its aim frame.
  // Echo: one landed volley is one player hit (+echoOnHit), not one per bolt.
  async playBlast(hero, target, tech) {
    let total = Phaser.Math.Between(tech.hits[0], tech.hits[1]);
    const fire = async () => {
      for (let i = 0; i < total && target.hp > 0; i++) {
        const crit = Math.random() < Math.max(tech.critChance, effectMax(this.fragments, 'blastCritChance')) && total < tech.maxHits;
        if (crit) total += 1;
        await this.fireBolt(hero, target, tech);
        const dmg = Phaser.Math.Between(tech.dmg[0], tech.dmg[1]);
        this.applyHit(target, dmg, undefined, { type: crit ? 'crit' : 'normal', poise: brk.sources.hit });
        if (i === 0) this.gainEcho(tech.echoOnHit);
        if (crit) Fx.popText(this, target.container.x, target.container.y, tech.critText, tech.critColor, qte.text);
        await this.wait(tech.boltIntervalMs);
      }
    };

    if (!hasSheet(hero.anims, 'blast')) {
      await fire();
      return;
    }
    await playOnce(hero.body, hero.type, 'blast', hero.anims.blast, {
      onHold: (resume) => fire().then(resume),
    });
    if (hero.hp > 0) hero.body.play(animKey(hero.type, 'idle'));
  }

  // One bolt from the hero to the target: the blast sheet's projectile sheet
  // (starting at its spawn_px) if there is one, otherwise a small teal square
  // from the hero's centre.
  fireBolt(hero, target, tech) {
    const blast = hasSheet(hero.anims, 'blast') ? hero.anims.blast : null;
    const projectile = blast?.projectile || 'blast_projectile';
    const hasProjectile = hasSheet(hero.anims, projectile);
    const [fromX, fromY] = this.spawnPoint(hero, blast?.spawn_px);
    if (!hasProjectile) trace(`fallback:projectile:${hero.type}`);
    const bolt = hasProjectile
      ? playLoop(this.add.sprite(fromX, fromY, animKey(hero.type, projectile)), hero.type, projectile)
      : this.add.rectangle(fromX, fromY, tech.boltSize, tech.boltSize, Number(tech.boltColor));
    bolt.setDepth(ui.battleLayout.labelDepth);
    // The projectile sheet faces left like every sheet; heroes fire to the right.
    if (hasProjectile) bolt.setFlipX(true);
    return this.tweenPromise(bolt, { x: target.container.x, y: target.container.y }, tech.boltFlightMs).then(() => bolt.destroy());
  }

  // spawn_px is in the (left-facing) sheet frame; a flipped sprite mirrors it.
  spawnPoint(entity, spawnPx) {
    const { x, y } = entity.container;
    const size = this.animationSets[entity.type]?.frame_size;
    if (!spawnPx || !size) return [x, y];
    const flipped = entity.container.scaleX < 0;
    const dx = spawnPx[0] - size[0] / 2;
    return [x + (flipped ? -dx : dx), y + spawnPx[1] - size[1] / 2];
  }

  // Return to Sender: the hero holds a guard (the ability sheet's holdFrame)
  // and draws the next enemy attack. A parry answers it with a big counter.
  async startStance(hero, tech) {
    Fx.popText(this, hero.container.x, hero.container.y, tech.castText, tech.color, qte.text);
    const stance = { hero, tech, resume: null, done: null, onImpact: null };
    this.stance = stance;
    if (!hasSheet(hero.anims, 'ability')) return;

    this.stance.done = playOnce(hero.body, hero.type, 'ability', hero.anims.ability, {
      onHold: (resume) => {
        if (this.stance === stance) stance.resume = resume;
        else resume();
      },
      onImpact: () => stance.onImpact?.(),
    });
  }

  // Ends the stance. countered = the parry landed: the rest of the ability
  // anim plays as the counter swing and the damage lands on its impact frame.
  // Otherwise the guard just drops.
  async endStance(countered, enemy, result) {
    const stance = this.stance;
    if (!stance) return;
    this.stance = null;
    const { hero, tech } = stance;
    const abilityKey = animKey(hero.type, 'ability');
    const inGuard = () => hero.body.anims?.currentAnim?.key === abilityKey;

    if (!countered) {
      if (stance.done && inGuard() && hero.hp > 0) hero.body.play(animKey(hero.type, 'idle'));
      return;
    }

    const counter = () => {
      if (enemy.hp <= 0) return;
      const base = Phaser.Math.Between(tech.counterDmg[0], tech.counterDmg[1]);
      const dmg = Math.round(base * (result === 'PERFECT' ? tech.perfectMult : 1));
      Fx.popText(this, hero.container.x, hero.container.y, tech.counterText, tech.color, qte.text);
      this.applyHit(enemy, dmg, tech.color, { poise: brk.sources.stanceCounter });
    };

    if (!stance.done || !inGuard()) {
      counter();
      return;
    }

    stance.onImpact = counter;
    if (stance.resume) stance.resume();
    await stance.done;
    if (hero.hp > 0) hero.body.play(animKey(hero.type, 'idle'));
  }

  // Anchor: heals the hero who needs it most — a downed ally first (if the
  // technique can revive), then the lowest HP share. The heal lands on the
  // move's impact frame.
  async playHeal(hero, tech) {
    const candidates = this.heroes.filter((h) => h.hp > 0 || tech.canRevive);
    const target = candidates.sort((a, b) => (a.hp > 0) - (b.hp > 0) || a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!target) return;

    await this.playMove(hero, tech.anims || ['cast'], () => {
      const amount = Math.min(tech.amount, target.maxHp - target.hp);
      if (target.hp <= 0) this.revive(target, Math.min(target.maxHp, tech.amount));
      else target.hp += amount;
      Fx.damageNumber(this, target.container.x, target.container.y - 80, `${ui.heal.textPrefix}${Math.min(tech.amount, target.maxHp)}`, null, 'heal');
      // Anchor also clears the target's statuses.
      if (this.clearStatuses(target)) Fx.popText(this, target.container.x, target.container.y, statuses.ui.clearedText, statuses.ui.clearedColor, qte.text);
      this.refreshHud();
    });
  }

  // Brace: the whole party takes reduced damage from the next enemy attack.
  async playBrace(hero, tech) {
    await this.playMove(hero, tech.anims || ['cast'], () => {
      this.brace = tech;
      for (const h of this.heroes.filter((x) => x.hp > 0)) {
        Fx.popText(this, h.container.x, h.container.y, tech.castText, tech.color, qte.text);
      }
    });
  }

  // A support move's body language: the first of `names` the character has a
  // sheet for. A looping sheet plays _in -> one loop -> _out; a one-shot sheet
  // plays once. onImpact fires on its first impact frame (or when the loop
  // finishes / at the end). Without any sheet: a short hop, then onImpact.
  async playMove(hero, names, onImpact) {
    const name = names.find((n) => hasSheet(hero.anims, n));
    if (!name) {
      trace(`fallback:move:${hero.type}_${names[0]}`);
      const y = hero.container.y;
      await this.tweenPromise(hero.container, { y: y - ui.cast.hopPx }, ui.cast.hopMs, 'Quad.easeOut');
      await this.tweenPromise(hero.container, { y }, ui.cast.hopMs, 'Quad.easeIn');
      onImpact();
      return;
    }

    const def = hero.anims[name];
    if (def.loop) {
      if (hasSheet(hero.anims, `${name}_in`)) await playOnce(hero.body, hero.type, `${name}_in`, hero.anims[`${name}_in`]);
      await new Promise((resolve) => {
        playLoop(hero.body, hero.type, name);
        hero.body.once('animationrepeat', resolve);
      });
      onImpact();
      if (hasSheet(hero.anims, `${name}_out`)) await playOnce(hero.body, hero.type, `${name}_out`, hero.anims[`${name}_out`]);
    } else {
      await playOnce(hero.body, hero.type, name, def, { onImpact: (i) => i === 0 && onImpact() });
    }
    if (hero.hp > 0) playLoop(hero.body, hero.type, 'idle');
  }

  wait(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  // ---------- Attack execution ----------

  async playerStrike(hero, target) {
    const restX = hero.container.x;
    const approachX = Phaser.Math.Linear(restX, target.container.x, 0.7);

    await this.tweenPromise(hero.container, { x: approachX }, DASH_DURATION_MS, 'Cubic.easeOut');

    // A Strike deals its damage once, on the first impact frame.
    const dmg = Phaser.Math.Between(hero.def.strike[0], hero.def.strike[1]);
    await this.playAttackAnim(hero, (i) => {
      if (i !== 0) return;
      this.applyHit(target, dmg, undefined, { poise: brk.sources.hit });
      this.gainEcho(techniques.strike.echoOnHit);
    });

    await this.tweenPromise(hero.container, { x: restX }, DASH_DURATION_MS, 'Cubic.easeInOut');
  }

  // onImpact(i, count) fires on each impact frame of a sheet attack, or once
  // at the end of a rig attack.
  async playAttackAnim(entity, onImpact) {
    if (hasSheet(entity.anims, 'attack')) {
      await playOnce(entity.body, entity.type, 'attack', entity.anims.attack, { onImpact });
      if (entity.hp > 0) entity.body.play(animKey(entity.type, 'idle'));
      return;
    }

    trace(`fallback:attack:${entity.type}`);
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

  // react: false = the caller plays its own reaction instead of hurt.
  // type = damage number style (ui.json damageNumbers); heroes' damage is "hurt".
  // poise = poise damage to an enemy (break.json sources). A broken enemy takes break.damageMult.
  applyHit(target, dmg, color, { react = true, type = null, poise = 0 } = {}) {
    if (!target.isHero) dmg = this.chainDamage(dmg);
    if (target.broken) dmg = Math.round(dmg * brk.damageMult);
    const images = [target.body, ...Object.values(target.parts).map((p) => p.img)];
    Fx.flash(this, images, 60);
    Fx.shake(this, 2, 80);
    Fx.damageNumber(this, target.container.x, target.container.y - 80, dmg, color, type || (target.isHero ? 'hurt' : 'normal'));
    playSfx('hit');

    if (target.isHero) this.stats.damageTaken += Math.min(dmg, target.hp);
    target.hp = Math.max(0, target.hp - dmg);
    this.updateLabel(target);
    if (target.isHero) this.refreshHud();
    else {
      this.chargeDamage(target, dmg);
      this.checkPhase(target);
      if (poise) this.hitPoise(target, poise);
    }

    if (target.hp <= 0) this.markDown(target);
    else if (react) this.playHurt(target);
  }

  // ---------- Memory statuses ----------

  // statuses.json: Redacted covers one of the hero's techniques, Fog hides the
  // command names. turns = the hero's own turns left (they tick after each turn).
  applyStatus(hero, id) {
    const def = statuses[id];
    if (!def || !hero.isHero || hero.hp <= 0) return;
    let tech = hero.statuses[id]?.tech;
    if (def.effect === 'cover' && !tech) {
      const pool = hero.def.techniques || [];
      if (!pool.length) return;
      tech = Phaser.Utils.Array.GetRandom(pool);
    }
    hero.statuses[id] = { turns: def.turns, tech };
    Fx.popText(this, hero.container.x, hero.container.y, def.applyText, def.color, qte.text);
    this.hints.show('status');
    this.refreshHud();
  }

  tickStatuses(hero) {
    const ids = Object.keys(hero.statuses);
    if (!ids.length) return;
    for (const id of ids) {
      hero.statuses[id].turns -= 1;
      if (hero.statuses[id].turns <= 0) delete hero.statuses[id];
    }
    this.refreshHud();
  }

  // Returns true if there was anything to clear.
  clearStatuses(hero) {
    if (!Object.keys(hero.statuses).length) return false;
    hero.statuses = {};
    this.refreshHud();
    return true;
  }

  statusList(hero) {
    return Object.entries(hero.statuses || {}).map(([id, s]) => ({ id, turns: s.turns }));
  }

  fogged(hero) {
    return Object.keys(hero.statuses).some((id) => statuses[id].effect === 'fog');
  }

  covered(hero, techId) {
    return Object.entries(hero.statuses).some(([id, s]) => statuses[id].effect === 'cover' && s.tech === techId);
  }

  // ---------- Break gauge ----------

  hitPoise(enemy, amount) {
    if (!enemy.maxPoise || enemy.hp <= 0 || enemy.broken) return;
    enemy.poise = Math.max(0, enemy.poise - amount);
    enemy.poiseBar.set(enemy.poise);
    this.hints.show('break');
    if (enemy.poise === 0) this.breakEnemy(enemy);
  }

  // BROKEN: it skips its next action and takes extra damage until that turn is over.
  breakEnemy(enemy) {
    const fx = brk.fx;
    enemy.broken = true;
    enemy.poiseBar.setBroken(true);
    Fx.popText(this, enemy.container.x, enemy.container.y, fx.text, fx.color, { ...qte.text, fontSize: fx.fontSize, offsetY: fx.offsetY });
    Fx.shake(this, fx.shake, fx.shakeMs);
    Fx.screenFlash(this, fx.flash, qte.flashDepth);
    Fx.sparks(this, enemy.container.x, enemy.container.y, fx.sparks, { ...qte.sparks, color: fx.sparkColor }, qte.ring.depth);
    playSfx(fx.sfx);
    vibrate(qte.results.PERFECT.vibrateMs);
  }

  // The broken enemy's turn: it does nothing, then recovers with full poise.
  async skipBrokenTurn(enemy) {
    await this.wait(brk.stunMs);
    if (enemy.hp <= 0) return;
    this.refillPoise(enemy);
    Fx.popText(this, enemy.container.x, enemy.container.y, brk.recoverText.text, brk.recoverText.color, qte.text);
  }

  refillPoise(enemy) {
    enemy.broken = false;
    enemy.poise = enemy.maxPoise;
    enemy.poiseBar.setBroken(false);
    enemy.poiseBar.set(enemy.poise);
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
    this.tapHint.setVisible(false);
    const cfg = ui.battleEnd;

    // Heroes still standing celebrate if they have a victory sheet (last frame held).
    if (result === 'WIN') {
      for (const hero of this.heroes) {
        if (hero.hp > 0 && hasSheet(hero.anims, 'victory')) playOnce(hero.body, hero.type, 'victory', hero.anims.victory);
        else if (hero.hp > 0) trace(`fallback:victory:${hero.type}`);
      }
    }

    const style = { fontFamily: ui.font, fontSize: `${cfg.fontSize}px`, color: cfg.color, stroke: cfg.stroke, strokeThickness: cfg.strokeThickness };
    const message = this.add
      .text(180, cfg.textY, result === 'WIN' ? cfg.victoryText : cfg.loseText, style)
      .setOrigin(0.5)
      .setDepth(cfg.depth)
      .setAlpha(0);
    this.tweens.add({ targets: message, alpha: 1, duration: cfg.fadeMs });
    this.showActiveHero(null);
    this.hints.hide();

    // Victory: a band across the scene, the word pops in, a short sting.
    if (result === 'WIN') {
      const v = ui.victory;
      const band = this.add.rectangle(180, cfg.textY, viewRect().w, v.band.h, Number(v.band.color), v.band.alpha).setDepth(cfg.depth - 1).setStrokeStyle(1, Number(v.band.lineColor));
      band.setScale(1, 0);
      this.tweens.add({ targets: band, scaleY: 1, duration: v.popMs / 2, ease: 'Cubic.easeOut' });
      message.setScale(v.popScale);
      this.tweens.add({ targets: message, scale: 1, duration: v.popMs, ease: 'Back.easeOut' });
      playSfx('victory');
    }

    // A short delay so the tap that ended the fight doesn't also skip this.
    this.time.delayedCall(cfg.inputDelayMs, () => {
      if (result === 'WIN') {
        const stats = { ...this.stats, maxChain: this.maxChain };
        const partyHp = this.heroes.reduce((sum, h) => sum + h.maxHp, 0);
        new ResultCard(this, this.battleId, stats, partyHp).show().then(() => this.continueChapter());
        return;
      }
      this.menu.show([{ slot: 'retry', label: cfg.retryText, value: 'retry' }]).then(() => this.retry());
    });
  }

  // Retry restarts the same battle from its starting state (full HP, starting Echo).
  retry() {
    this.scene.restart(this.initData);
  }

  continueChapter() {
    const runner = this.registry.get('runner');
    if (runner) runner.next(this);
    else this.scene.start('Title');
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
