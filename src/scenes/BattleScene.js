import Phaser from 'phaser';
import battles from '../data/battles.json';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import environments from '../data/environments.json';
import levels from '../data/levels.json';
import allies from '../data/allies.json';
import battleEvents from '../data/battleEvents.json';
import dialogues from '../data/dialogue.json';
import brk from '../data/break.json';
import crit from '../data/crit.json';
import statuses from '../data/statuses.json';
import qte from '../data/qte.json';
import recollection from '../data/recollection.json';
import techniques from '../data/techniques.json';
import ui from '../data/ui.json';
import audioData from '../data/audio.json';
import { playAmbience, playMusic, playOneShot, playSfx, setMusicIntensity, setMusicWarm, vibrate } from '../systems/Audio.js';
import { dueEvents, thenSplit } from '../systems/BattleEvents.js';
import BattleStateMachine from '../systems/BattleStateMachine.js';
import * as Fx from '../systems/Fx.js';
import { clampX, mirrorEdges, rect as viewRect } from '../systems/View.js';
import { difficultyDef, difficultyId } from '../systems/Difficulty.js';
import { aiPickAttack, aiPickTarget, currentStage, enemyWindowMults, recollectionAtOf, recollectionDue, tuneEnemyDef } from '../systems/EnemyTuning.js';
import CommandMenu from '../systems/CommandMenu.js';
import { helpCard, learnSteps } from '../systems/MoveHelp.js';
import { createBackdrop, createPlatform } from '../systems/BattleBackdrop.js';
import CutIn from '../systems/CutIn.js';
import { gradeOf, runBeats } from '../systems/RecollectionBeats.js';
import Hud from '../systems/Hud.js';
import { nalaJumpIn } from '../systems/Nala.js';
import PoiseBar from '../systems/PoiseBar.js';
import ResultCard from '../systems/ResultCard.js';
import TutorialHints from '../systems/TutorialHints.js';
import tutorialData from '../data/tutorial.json';
import * as TutorialPause from '../systems/TutorialPause.js';
import { addPauseButton, pauseScene } from '../systems/PauseButton.js';
import { onAction } from '../systems/Input.js';
import { ringPrompt, tx } from '../systems/Prompts.js';
import * as Qte from '../systems/Qte.js';
import { devInt, devParam } from '../systems/DevParams.js';
import { impact, impactLab, prewarmImpact } from '../systems/Impact.js';
import { dropsFor, effectMax, effectTotal, ownedFragments } from '../systems/Fragments.js';
import DropCard from '../systems/DropCard.js';
import { battleXp, echoMaxFor, growth, learned, levelFor, techniqueAt, xpForLevel } from '../systems/Recall.js';
import RecallCard from '../systems/RecallCard.js';
import { animKey, hasSheet, playLoop, playOnce, playReverseOnce, SheetDriver, trace } from '../systems/SpriteAnims.js';
import { isRealTexture, whenReady } from '../systems/Assets.js';
import { markDebugUsed, recordBattle } from '../systems/JamReport.js';

const layout = ui.battleLayout;
const musicPlan = audioData.music.placement; // where the music plays (audio.json music.placement)

const ATTACK_DURATION_MS = 400;
const LUNGE_OUT_MS = 150;
const WINDUP_MS = 200;
// Two 0xRRGGBB tints multiplied channel by channel (how two lights stack).
const multiplyTints = (a, b) =>
  [16, 8, 0].reduce((out, shift) => out | (Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255) << shift), 0);

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
    this.battleId = data.battleId || 'b1_forgotten';
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
    this.braceHero = null;
    this.activeHero = null;
    this.nala = null;
    this.ultReady = false;
    this.stopReadyAura();
    this.setTimeScale(1);
    playMusic(this.battleDef.music || null);
    setMusicIntensity(0);
    setMusicWarm(false);
    this.difficulty = difficultyDef(this.registry.get('settings'));
    this.difficultyId = difficultyId(this.registry.get('settings'));
    this.tutorialSlow = !!this.battleDef.tutorial;
    // Spotlight targets for the tutorial pauses (TutorialPause.js); Hud, CommandMenu and the
    // helpers below register theirs. battles.json `pauses.battleStart` fires on the first command menu.
    this.tutorialTargets = {};
    this.tutorialPause = null;
    this.pauseOnFirstMenu = this.battleDef.pauses?.battleStart || null;
    this.pendingEvents = [];
    this.pendingDefendHook = null;
    // Generic battle events (battles.json `events`, see systems/BattleEvents.js):
    // flags set by {setFlag}, which events already fired, and the counters their
    // `when` reads. playerHits counts landed player actions (playerAction/actionLanded).
    this.flags = new Set();
    this.firedEvents = new Set();
    // hollowDamageThisRound / hollowImmuneThisRound / noHollowDamageRounds: the Nala glow event ({noHollowDamageRounds: n}).
    this.counters = { playerHits: 0, parries: 0, immuneSeen: false, hollowDamageThisRound: 0, hollowImmuneThisRound: 0, noHollowDamageRounds: 0 };
    this.playerInput = false;
    this.playerAction = false;
    this.actionLanded = false;
    this.timeScale = 1;
    this.resumeGate = null;
    // Recollection (recollection.json): the moment it was cast (Try again comes back there) and
    // whether a memory slipped (3 MISS: the next LOSE offers Try again / Quit).
    this.recollectionSnapshot = this.initData.rewind || null;
    // Stage checkpoint (enemies.json stages[i].checkpoint): the battle as the boss rose into that
    // stage; the lose card then offers Retry from here. Carried over a checkpoint restart.
    this.stageSnapshot = this.initData.checkpoint || null;
    this.memoryFailed = false;
    this.listenForBackground();
    addPauseButton(this, () => this.openPause(true));
    this.hints = new TutorialHints(this, !!this.battleDef.tutorial);
    const followAura = () => this.followReadyAura();
    this.events.on('update', followAura);
    this.events.once('shutdown', () => {
      this.events.off('update', followAura);
      this.stopReadyAura();
    });
    this.activeMarker = null;

    this.environment = environments[this.battleDef.env || this.battleDef.bg] || {};
    this.createBackground();
    this.createPlatform();
    this.createEnvironmentFx();

    if (this.battleDef.nala) this.createNala();

    // The party for this battle (battles.json `party`, else ui.battleLayout.defaultParty).
    const heroKeys = this.battleDef.party ?? layout.defaultParty;
    this.heroes = heroKeys.map((key) =>
      this.createEntity(key, key, characters[key], layout.heroes[key], 'right', true)
    );

    // Recall (levels.json): the party's level grows HP and Strike, and decides
    // which techniques each hero remembers. Without a chapter run (?battle=),
    // ?level=N picks it (default 1).
    const xp = this.registry.get('recallXp') ?? xpForLevel(devInt('level') ?? 1, levels);
    this.recallXp = xp;
    this.level = levelFor(xp, levels);
    for (const hero of this.heroes) {
      const g = growth(hero.type, this.level, levels);
      hero.level = this.level;
      hero.maxHp += g.hp;
      hero.hp = hero.maxHp;
      hero.strike = [hero.def.strike[0] + g.strike, hero.def.strike[1] + g.strike];
      hero.techniques = learned(hero.type, this.level, hero.def.techniques, levels);
    }

    const dov = this.heroes.find((h) => h.type === 'dov');
    if (dov) {
      dov.maxHp += effectTotal(this.fragments, 'dovMaxHp');
      dov.hp = dov.maxHp;
    }

    const enemyKeys = this.battleDef.enemies;
    const slots = this.enemySlots(enemyKeys);
    this.enemies = enemyKeys.map((key, i) =>
      // enemies.json difficulty.<id>: the def is tuned once for the chosen difficulty (EnemyTuning.js).
      this.createEntity(`${key}_${i}`, key, tuneEnemyDef(enemies[key], this.difficultyId), slots[Math.min(i, slots.length - 1)], 'left', false)
    );

    this.applyAmbientTint();

    // Each hero has their own Echo: its capacity comes from the Recall level
    // (levels.json echoMax), else characters.json echoMax, else ui.hud.echo.max;
    // echoPips is how many pips the HUD draws. ?echo=N starts everyone with N
    // (dev, clamped to the cap); Old Ticket adds to everyone.
    for (const hero of this.heroes) {
      hero.echoMax = echoMaxFor(hero.type, this.level, levels) ?? hero.def.echoMax ?? ui.hud.echo.max;
      hero.echoPips = hero.def.echoPips;
      hero.echo = Phaser.Math.Clamp((devInt('echo') ?? 0) + effectTotal(this.fragments, 'startEcho'), 0, hero.echoMax);
    }
    // Perfect chain (qte.json chain). maxChain is read at the end of the battle (battle grade).
    this.chain = 0;
    this.maxChain = 0;
    // Stats for the result card (grade.json): maxChain is above.
    this.stats = { perfects: 0, damageTaken: 0, turns: 0 };
    this.hud = new Hud(this, ui.hud, ui.font, this.heroes);
    this.hud.setFragments(this.fragments);
    this.refreshHud();
    // Try again after a failed Recollection: the battle as it was when she cast it.
    // Retry from here: the battle as the boss rose into its checkpoint stage.
    if (this.initData.rewind) this.applyRewind(this.initData.rewind);
    else if (this.initData.checkpoint) this.applyRewind(this.checkpointState(this.initData.checkpoint));
    if (import.meta.env.DEV) {
      this.enableHudDebug();
      window.__battle = this;
    }
    prewarmImpact(this);
    // ?impact=1: the impact lab loops the impact.json presets at the first enemy (perf checks).
    if (devParam('impact')) {
      window.__battle = this;
      impactLab(this, () => this.impactPoint(this.enemies.find((e) => e.hp > 0)));
    }

    this.buildCommandMenu();
    this.buildTapHint();
    this.registerTutorialTargets();

    const machine = new BattleStateMachine({
      intro: async () => {
        await this.playIntro();
        // Dev: ?recollection=1 jumps a staged boss to the Recollection unlock (phone-testable, no console needed).
        if (devInt('recollection')) this.forceRecollectionReady();
        await this.checkEvents(); // `when: "battleStart"`
      },
      isOver: () => this.battleOver,
      isAlive: (entity) => entity.hp > 0,
      // A stage end (enemies.json stages onZero) is not a defeat: the enemy rises into its next stage.
      allEnemiesDown: () => this.enemies.every((e) => e.hp <= 0 && !e.rising),
      allHeroesDown: () => this.heroes.every((h) => h.hp <= 0),
      roundStart: () => this.roundStart(),
      enemyPhaseEnd: () => this.endBrace(),
      // A rewind re-enters the Recollection right after the intro (cut-in and minigame again).
      resume: this.initData.rewind ? () => this.resumeRecollection() : null,
      playerTurn: (hero) => this.playerTurn(hero),
      enemyTurn: (enemy) => this.enemyTurn(enemy),
      afterTurn: () => this.afterTurn(),
      onEnd: (result) => this.onBattleEnd(result),
    });

    // An exception anywhere in the turn loop used to be a silent unhandled
    // rejection and a frozen battle. Now it ends the battle with Retry. The
    // scene instance is reused, so a loop from before a restart is ignored.
    this.runId = (this.runId || 0) + 1;
    const runId = this.runId;
    machine.run(this.heroes, this.enemies, { initiative: this.battleDef.initiative }).catch((err) => {
      if (runId !== this.runId || !this.scene.isActive()) return;
      console.error('battle: turn loop failed', err);
      if (!this.battleOver) this.onBattleEnd('ERROR');
    });
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
    this.openPause(false);
  }

  // The ⏸ button opens the same pause, as the menu (Resume | Settings | Quit).
  // Live rings stop without a judgement either way and restart on resume, so
  // the tap on the button is never a parry.
  openPause(menu) {
    if (this.resumeGate || !this.scene.isActive()) return;
    Qte.interruptRings(this);
    this.resumeGate = pauseScene(this, { menu }).then(() => {
      this.resumeGate = null;
    });
  }

  // ---------- Environment ----------

  // The background picture: full screen, behind the HUD (dark glass) and the commands, muted and
  // drifting, with fog and window glows (systems/BattleBackdrop.js; battles.json bg / bgShift / env).
  createBackground() {
    this.backdrop = createBackdrop(this, this.battleDef, this.environment);
  }

  // The floor the fighters stand on: battles.json `platform` (a strip of art) or the code-drawn band
  // from environments.json `platform`; a separate layer above the picture, below lights and fighters.
  createPlatform() {
    this.platform = createPlatform(this, this.battleDef.platform, this.environment);
  }

  // Lantern glows, rain and vignette for this battle's background (environments.json).
  createEnvironmentFx() {
    const env = this.environment;
    const view = viewRect();
    const area = { x: view.x, y: 0, w: view.w, h: layout.sceneBottom };
    if (env.lights) Fx.lights(this, env.lights);
    if (env.rain) Fx.rain(this, env.rain, area);
    playAmbience(env.ambience || null);
    if (env.vignette) Fx.vignette(this, env.vignette, area);
    // Lightning waits for a quiet moment: never while a parry ring is live.
    if (env.lightning) this.lightning = Fx.lightning(this, env.lightning, area, () => (this.qteRings?.size || 0) > 0);
  }

  // Night (or lamp) light on every combatant, so they sit in the scene.
  // An enemy def's own `tint` (enemies.json, e.g. a darker Warden) multiplies it.
  applyAmbientTint() {
    const ambient = this.environment.ambientTint ? Number(this.environment.ambientTint) : null;
    for (const entity of [...this.heroes, ...this.enemies]) {
      const own = entity.def.tint ? Number(entity.def.tint) : null;
      const tint = own !== null && ambient !== null ? multiplyTints(ambient, own) : own ?? ambient;
      if (tint === null) continue;
      Fx.setBaseTint([entity.body, ...Object.values(entity.parts).map((p) => p.img)], tint);
    }
    if (ambient !== null && this.nala) Fx.setBaseTint([this.nala.image], ambient);
  }

  // ---------- Entity setup ----------

  // The ui.battleLayout slots for this enemy list: the boss formation if any
  // enemy is a boss, otherwise the one for this many enemies.
  enemySlots(enemyKeys) {
    // battles.json `formation` names a layout explicitly; otherwise by count / boss.
    const formationKey = this.battleDef.formation || (enemyKeys.some((key) => enemies[key].boss) ? 'boss' : String(enemyKeys.length));
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
    // The Glow's ready pulse (teal, softer than the orange Hollow alert) and its cooldown counter under her feet.
    const ready = def.glowReady;
    const readyGlow = this.add.image(0, 0, Fx.glowTexture(this, ready.radius)).setBlendMode(Phaser.BlendModes.ADD).setTint(Number(ready.color)).setAlpha(0);
    container.add([glow, readyGlow, image]);
    this.addShadow(container, sprite.w || 128, sprite.h);
    const faces = anims ? animSet.facing || 'left' : sprite.faces || 'right';
    container.setScale(faces !== 'right' ? -1 : 1, 1);
    this.checkLayout('nala', feetY, sprite.h);
    // body / type / hp make her look like an entity to loopWithInOut (alert_in -> alert -> alert_out).
    const c = def.counter;
    const counter = this.add
      .text(x, feetY + c.offsetY, '', { fontFamily: ui.font, fontSize: `${c.fontSize}px`, color: c.color, stroke: c.stroke, strokeThickness: c.strokeThickness })
      .setOrigin(0.5, 0)
      .setDepth(layout.labelDepth)
      .setVisible(false);
    // usesLeft: the saves she has this battle (never refilled; a Retry restores the battle-start count). glowOn: the Glow is unlocked
    // (battle event nalaGlow); glowCd: rounds until it is ready again.
    this.nala = { container, image, glow, readyGlow, counter, anims, def, used: false, usesLeft: this.nalaSaves(), glowOn: false, glowCd: 0, glowCasting: false, ring: null, body: image, type: 'nala', hp: 1, busy: false, alertLoop: null };
    if (!anims || anims.idle.placeholder) this.idleBob(container);

    image.setInteractive({ useHandCursor: true });
    image.on('pointerdown', () => this.nalaTap());
    // Keyboard / controller: the nala action (Triangle / N) is the tap on her.
    onAction(this, 'nala', () => this.nalaTap());
  }

  // Her saves per battle: 1, +1 per Nala's Bell (fragments.json nalaExtraUses).
  nalaSaves() {
    return 1 + effectTotal(this.fragments, 'nalaExtraUses');
  }

  // Tap on Nala: during a Hollow's telegraph it is the save, on the player's turn it calls the Glow.
  nalaTap() {
    const nala = this.nala;
    if (!nala || this.battleOver) return;
    if (nala.ring) this.nalaHiss();
    else if (this.nalaGlowReady()) this.nalaGlowCast();
  }

  // The Glow can be called now: unlocked, off cooldown, a hero is choosing and nothing else holds Nala.
  nalaGlowReady() {
    const nala = this.nala;
    return !!nala && nala.glowOn && nala.glowCd <= 0 && !nala.glowCasting && !nala.ring && this.playerInput && !this.battleOver;
  }

  // The pulse and the counter under her: "Glow ready" (teal pulse, only while a hero is choosing) or "Glow in N".
  nalaRefreshGlow() {
    const nala = this.nala;
    if (!nala) return;
    const c = nala.def.counter;
    const ready = nala.glowOn && nala.glowCd <= 0 && !nala.glowCasting;
    nala.counter.setVisible(nala.glowOn);
    nala.counter.setText(nala.glowCd > 0 ? c.cooldownText.replace('{n}', nala.glowCd) : c.readyText).setColor(nala.glowCd > 0 ? c.coolColor : c.color);
    const pulse = ready && this.playerInput && !nala.ring;
    if (pulse && !nala.readyTween) {
      const g = nala.def.glowReady;
      nala.readyTween = this.tweens.add({ targets: nala.readyGlow, alpha: { from: g.alphaMin, to: g.alphaMax }, duration: g.pulseMs, yoyo: true, repeat: -1 });
    } else if (!pulse && nala.readyTween) {
      nala.readyTween.stop();
      nala.readyTween = null;
      nala.readyGlow.setAlpha(0);
    }
  }

  // Nala lends the party her Echo. Unlocked by the event (unlock = true) or called by a tap once ready. She plays
  // alert, an orange light travels to each living hero and turns teal there (allies.json nala.glowCast), the hero
  // gets the Echo Strike status (their next turn's Strike can wound Hollows) and the Glow starts its cooldown.
  async nalaGlowCast(unlock = false) {
    const nala = this.nala;
    if (!nala || nala.glowCasting) return;
    const def = nala.def;
    const cast = def.glowCast;
    if (unlock) nala.glowOn = true;
    nala.glowCasting = true;
    nala.glowCd = def.glowCooldownRounds;
    this.nalaRefreshGlow();
    playSfx('echo');
    const wasBusy = nala.busy;
    nala.busy = true;
    const loop = !wasBusy && hasSheet(nala.anims, 'alert') ? this.loopWithInOut(nala, 'alert') : null;
    if (!loop) trace('fallback:alert:nala');
    await this.wait(cast.alertMs);
    const from = { x: nala.container.x, y: nala.container.y };
    const living = this.heroes.filter((h) => h.hp > 0);
    await Promise.all(
      living.map(
        (hero, i) =>
          new Promise((resolve) => {
            this.time.delayedCall(i * cast.staggerMs, () => {
              const orb = this.add.image(from.x, from.y, Fx.glowTexture(this, cast.radius)).setBlendMode(Phaser.BlendModes.ADD).setTint(Number(cast.fromColor)).setDepth(cast.depth);
              const a = Phaser.Display.Color.ValueToColor(Number(cast.fromColor));
              const b = Phaser.Display.Color.ValueToColor(Number(cast.toColor));
              const t = { v: 0 };
              const tx = hero.container.x;
              const ty = hero.container.y - hero.height / 2;
              this.tweens.add({
                targets: t,
                v: 1,
                duration: cast.travelMs,
                ease: 'Sine.easeInOut',
                onUpdate: () => {
                  const k = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 1, t.v);
                  orb.setTint(Phaser.Display.Color.GetColor(k.r, k.g, k.b));
                  orb.setPosition(from.x + (tx - from.x) * t.v, from.y + (ty - from.y) * t.v - Math.sin(t.v * Math.PI) * 18);
                },
                onComplete: () => {
                  Fx.sparks(this, tx, ty, cast.burst.count, cast.burst, cast.depth + 1);
                  this.grantEchoStrike(hero);
                  this.tweens.add({ targets: orb, alpha: 0, scale: 1.8, duration: 200, onComplete: () => orb.destroy() });
                  resolve();
                },
              });
            });
          })
      )
    );
    if (loop) await loop.stop();
    nala.busy = wasBusy;
    if (!wasBusy && !nala.ring) playLoop(nala.image, 'nala', 'idle');
    nala.glowCasting = false;
    this.nalaRefreshGlow();
  }

  // The Echo Strike status (statuses.json echo_strike): 1 turn of the hero's own, ticked after it like the others.
  grantEchoStrike(hero) {
    const id = this.nala.def.glowStatus;
    const def = statuses[id];
    if (!def || hero.hp <= 0) return;
    hero.statuses[id] = { turns: def.turns };
    Fx.popText(this, hero.container.x, hero.container.y, def.applyText, def.color, qte.text);
    this.refreshHud();
  }

  // A hero whose Strikes can wound a Strike-immune Hollow (statuses.json effect echoStrike).
  echoStrikes(hero) {
    return !!hero && Object.keys(hero.statuses || {}).some((id) => statuses[id]?.effect === 'echoStrike');
  }

  // A round has finished (not called before round 1): the Glow bookkeeping, then the events that wait for a
  // finished round ({noHollowDamageRounds}); BattleEvents' {round: n} reads the round that just ended here.
  async roundStart() {
    const finished = this.stats.turns;
    const c = this.counters;
    const nala = this.nala;
    if (finished > 0) {
      if (c.hollowDamageThisRound > 0) c.noHollowDamageRounds = 0;
      else if (c.hollowImmuneThisRound > 0) c.noHollowDamageRounds += 1;
      c.hollowDamageThisRound = 0;
      c.hollowImmuneThisRound = 0;
      if (nala && nala.glowCd > 0) nala.glowCd -= 1;
    }
    // Her save is once per battle: nothing refills it here, only the Glow display updates.
    if (nala) this.nalaRefreshGlow();
    if (finished > 0) await this.checkEvents();
    this.stats.turns += 1;
  }

  // Called when an enemy starts a telegraph. Returns true if Nala is watching it.
  nalaWatch(enemy, ring) {
    const nala = this.nala;
    if (!this.nalaCanWatch(enemy)) return false;
    nala.ring = ring;
    nala.enemy = enemy;
    const g = nala.def.glow;
    nala.glowTween = this.tweens.add({ targets: nala.glow, alpha: { from: g.alphaMin, to: g.alphaMax }, duration: g.pulseMs, yoyo: true, repeat: -1 });
    if (hasSheet(nala.anims, 'alert') && !nala.busy) nala.alertLoop = this.loopWithInOut(nala, 'alert');
    else trace('fallback:alert:nala');
    this.tapHint.setText(tx(nala.def, 'promptText'));
    this.nalaRefreshGlow();
    return true;
  }

  // Nala would sense this enemy's attack now: she has a save left, is not casting, and it is a Hollow.
  nalaCanWatch(enemy) {
    const nala = this.nala;
    return !!nala && !nala.used && !nala.glowCasting && !!enemy.def.hollow;
  }

  nalaStopWatching() {
    const nala = this.nala;
    if (!nala?.ring) return;
    nala.ring = null;
    if (nala.glowTween) nala.glowTween.stop();
    nala.glow.setAlpha(0);
    // alert_out, then back to idle (unless the hiss or a jump took the sprite over).
    const loop = nala.alertLoop;
    nala.alertLoop = null;
    if (loop) loop.stop().then(() => !nala.busy && this.nala === nala && playLoop(nala.image, 'nala', 'idle'));
    this.tapHint.setText(tx(qte.hint));
    this.nalaRefreshGlow();
  }

  // Jump-in arc (systems/Nala.js), in scene coordinates. Defaults: from 90px
  // to the left of where she stands, same height. Dev: __battle.nalaJumpIn().
  nalaJumpIn(fromX, fromY, toX, toY, ms) {
    const c = this.nala?.container;
    if (!c) return Promise.resolve();
    toX ??= c.x;
    toY ??= c.y;
    return nalaJumpIn(this, fromX ?? toX - 90, fromY ?? toY, toX, toY, ms);
  }

  nalaHiss() {
    const nala = this.nala;
    if (!nala?.ring || nala.used) return;
    nala.usesLeft -= 1;
    nala.used = nala.usesLeft <= 0;
    const { ring, enemy, def } = nala;
    // The hiss takes over from the alert loop directly (no alert_out).
    nala.alertLoop?.cancel();
    nala.alertLoop = null;
    nala.busy = true;
    this.nalaStopWatching();
    ring.cancel();

    // The hiss cut-in (allies.json nala.hissCutIn, ~700 ms, not awaited: the cancel and the battle go on
    // under it, and nothing in it takes input). Without one, the plain text pop. The duel's jump-in does
    // not come through here (it stays sprite only).
    if (def.hissCutIn) new CutIn(this).flash(def.hissCutIn);
    else Fx.popText(this, nala.container.x, nala.container.y, def.hissText, def.hissColor, qte.text);
    Fx.popText(this, enemy.container.x, enemy.container.y, def.cancelText, def.hissColor, qte.text);
    if (hasSheet(nala.anims, 'hiss')) {
      // holdFrame: the pose is held for hissHoldMs; impactFrames: the shake lands.
      playOnce(nala.image, 'nala', 'hiss', nala.anims.hiss, {
        onHold: (resume) => this.time.delayedCall(def.hissHoldMs, resume),
        onImpact: () => Fx.shake(this, def.shake, def.shakeMs),
      }).then(() => {
        nala.busy = false;
        playLoop(nala.image, 'nala', 'idle');
      });
    } else {
      nala.busy = false;
      Fx.shake(this, def.shake, def.shakeMs);
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
    // displayScale (integer, default 1): draws the whole entity N times bigger.
    // `height` is the scaled one, so the feet, label, markers and rings follow.
    const displayScale = def.displayScale ?? 1;
    const height = (anims ? animSet.frame_size[1] : bodyManifest.h || 128) * displayScale;

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

    container.setScale(mirror ? -displayScale : displayScale, displayScale);

    return this.finishEntity({ id, type, def, container, x, y, facing, isHero, body, parts, height });
  }

  finishEntity({ id, type, def, container, x, y, facing, isHero, body, parts = {}, height, anims = null, animSet }) {
    // Ground shadow: the container's first child at the feet (local y = half the
    // unscaled frame height), so it follows every move, dash and knockback.
    const ds0 = def.displayScale ?? 1;
    const frameW = anims ? animSet.frame_size[0] : this.manifest.sprites[def.body]?.w || 128;
    this.addShadow(container, frameW, height / ds0);
    if (anims) {
      body = this.add.sprite(0, 0, animKey(type, 'idle'));
      container.add(body);
      const ds = def.displayScale ?? 1;
      container.setScale((animSet.facing || 'left') !== facing ? -ds : ds, ds);
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
      // Difficulty scales enemy HP (qte.json difficulties.enemyHpMult). An enemy with `stages` opens at
      // the first stage's hpPct share of it; the bar (and the label) show that stage's own max.
      hp: isHero ? def.hp : this.startHp(def),
      maxHp: isHero ? def.hp : this.startHp(def),
      container,
      body,
      parts,
      anims,
      label,
      facing,
      isHero,
      restX: x,
      restY: y,
      feetY: y + height / 2,
      // Half the body art's width, scaled: how close a melee attacker stands.
      reach: (def.reach ?? layout.melee.reachDefault) * (def.displayScale ?? 1),
      height,
      // The container's own (positive) scale: tweens that squash it multiply this.
      baseScale: def.displayScale ?? 1,
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

  // An enemy's HP at the start of the battle (see `stages`).
  startHp(def) {
    const full = Math.round(def.hp * this.difficulty.enemyHpMult);
    return def.stages ? Math.round((full * def.stages[0].hpPct) / 100) : full;
  }

  // A later stage's own max HP: hp x the difficulty x the stage's `hpMult` (enemies.json stages, default 1).
  stageMaxHp(enemy, stage) {
    return Math.round(enemy.def.hp * this.difficulty.enemyHpMult * (stage?.hpMult ?? 1));
  }

  addShadow(container, frameW, frameH) {
    const cfg = layout.shadow;
    if (!cfg) return null;
    const shadow = Fx.shadow(this, frameW, cfg).setPosition(0, frameH / 2 + cfg.offsetY);
    container.addAt(shadow, 0);
    return shadow;
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
    // A long name over an enemy near the right edge stays on screen.
    entity.labelX ??= entity.label.x;
    entity.label.x = clampX(entity.labelX, entity.label.width, layout.labelMargin);
  }

  // ---------- HUD ----------

  // The single place the HUD learns about HP/Echo changes.
  refreshHud() {
    this.hud.update({
      heroes: this.heroes.map((h) => ({ hp: h.hp, maxHp: h.maxHp, echo: h.echo, echoMax: h.echoMax, statuses: this.statusList(h) })),
    });
    this.syncRecollectionReady();
  }

  // Recollection is ready to cast: Rhea is up with full Echo in a battle that
  // has the ultimate (battles.json recollection). A KO or spending the Echo
  // ends it; the first frame it turns true plays the one-time burst (#139).
  syncRecollectionReady() {
    if (!this.heroes) return;
    const rhea = this.heroes.find((h) => h.def.canUltimate);
    const ready = !!rhea && rhea.hp > 0 && this.canUltimate(rhea);
    if (ready === !!this.ultReady) return;
    this.ultReady = ready;
    if (!ready) {
      this.stopReadyAura();
      return;
    }
    const r = qte.recollection.ready;
    const { x, y } = rhea.container;
    Fx.screenFlash(this, r.flash, qte.flashDepth);
    Fx.sparks(this, x, y, r.sparks.count, r.sparks, qte.ring.depth);
    Fx.popText(this, x, y, r.text, r.textColor, qte.text);
    playSfx(r.sfx);
    this.startReadyAura(rhea);
  }

  // A pulsing gold glow behind Rhea while Recollection is ready.
  startReadyAura(rhea) {
    this.stopReadyAura();
    const a = qte.recollection.ready.aura;
    const glow = this.add
      .image(0, 0, Fx.glowTexture(this, a.radius))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(Number(a.color))
      .setAlpha(a.alpha[0]);
    this.readyAura = { glow, rhea };
    this.followReadyAura();
    this.readyAuraTween = this.tweens.add({ targets: glow, alpha: a.alpha[1], duration: a.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  followReadyAura() {
    if (!this.readyAura) return;
    const { glow, rhea } = this.readyAura;
    glow.setPosition(rhea.container.x, rhea.container.y + qte.recollection.ready.aura.offsetY).setDepth(rhea.container.depth - 1);
  }

  stopReadyAura() {
    if (this.readyAuraTween) this.readyAuraTween.stop();
    this.readyAuraTween = null;
    if (this.readyAura) this.readyAura.glow.destroy();
    this.readyAura = null;
  }

  // Dev build only: tap a hero row (or keys 1/2) to take HP, tap a hero's Echo
  // pips (or E/Q for the active hero, else Rhea) to change Echo. A downed
  // hero's row tap restores full HP.
  enableHudDebug() {
    const { hpStep, echoStep, keys } = ui.debug;
    const hurt = (i) => {
      markDebugUsed();
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
    const addEcho = (hero, d, wrap) => {
      markDebugUsed();
      if (!hero) return;
      let next = hero.echo + d;
      if (wrap && next > hero.echoMax) next = 0;
      hero.echo = Math.max(0, Math.min(hero.echoMax, next));
      this.refreshHud();
    };
    const keyHero = () => this.activeHero || this.heroes[0];

    this.hud.enableDebugTaps({ onHeroTap: hurt, onEchoTap: (i) => addEcho(this.heroes[i], echoStep, true) });
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on(`keydown-${keys.hurtRhea}`, () => hurt(0));
    kb.on(`keydown-${keys.hurtDov}`, () => hurt(1));
    kb.on(`keydown-${keys.echoUp}`, () => addEcho(keyHero(), echoStep, false));
    kb.on(`keydown-${keys.echoDown}`, () => addEcho(keyHero(), -echoStep, false));
  }

  revive(entity, hp) {
    entity.hp = hp;
    this.tweens.killTweensOf(entity.container);
    entity.container.alpha = 1;
    if (entity.anims) entity.body.play(animKey(entity.type, 'idle'));
    if (!entity.anims || entity.anims.idle.placeholder) entity.bobTween = this.idleBob(entity.container);
    this.updateLabel(entity);
  }

  // A hero goes down: "DOWNED" over them and, under it, whether Anchor can bring them back (ui.json downed):
  // a living hero who knows a heal that can't revive yet, or one that can. No healer in the party, no line.
  popDowned(hero) {
    const d = ui.downed;
    Fx.popText(this, hero.container.x, hero.container.y, d.text, d.color, qte.text);
    const healer = this.heroes.find((h) => h !== hero && h.hp > 0 && h.techniques.some((id) => this.techOf(h, id)?.type === 'heal'));
    if (!healer) return;
    const heal = this.techOf(healer, healer.techniques.find((id) => this.techOf(healer, id)?.type === 'heal'));
    const note = (heal.canRevive ? d.canRevive : d.cantRevive).replace('{hero}', healer.name);
    Fx.popText(this, hero.container.x, hero.container.y, note, d.noteColor, { ...qte.text, fontSize: d.noteFontSize, offsetY: qte.text.offsetY + d.noteOffsetY, ms: qte.text.ms + d.noteExtraMs });
  }

  // Downed: the death sheet plays once and holds its last frame. Without one,
  // the entity freezes and dims. An enemy whose stage ends (enemies.json stages
  // `onZero`) is only down for now: it keeps its label, holds the death pose and
  // rises in the next stage (riseStage, from afterTurn).
  markDown(entity, silent = false) {
    const rising = this.stageEnding(entity);
    if (entity.isHero) {
      entity.statuses = {};
      this.refreshHud();
      if (!silent) this.popDowned(entity);
      // A downed hero drops her guard: no counter stance survives a KO.
      if (this.stance?.hero === entity) this.endStance(false);
    } else {
      entity.exposed = null;
      this.updateEnemyStatus(entity);
      this.dropCharge(entity);
    }
    if (entity.bobTween) entity.bobTween.stop();
    if (rising) {
      entity.rising = true;
      entity.poiseBar?.setBroken(false);
      entity.deathDone = this.playStageDeath(entity, entity.def.stages[entity.phase || 0].onZero);
      return;
    }
    if (entity.aura) this.stopAura(entity);
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

  // ---------- Stages (enemies.json `stages`) ----------

  // True when this enemy's HP reaching 0 ends a stage instead of the enemy.
  stageEnding(entity) {
    const stages = entity.def.stages;
    const i = entity.phase || 0;
    return !entity.isHero && !!stages && i < stages.length - 1 && !!stages[i].onZero;
  }

  // The stage-end death: the death sheet (placeholders too) plays once and holds; without a real
  // sheet the body dims instead. Resolves when it is over.
  playStageDeath(entity, onZero) {
    const def = entity.anims?.[onZero.anim];
    const dim = !hasSheet(entity.anims, onZero.anim);
    if (dim) trace(`fallback:stageDeath:${entity.type}`);
    if (entity.anims) entity.body.anims.stop();
    const dimmed = dim ? this.tweenPromise(entity.container, { alpha: battleEvents.stage.fallbackDeathAlpha }, battleEvents.stage.riseMs) : Promise.resolve();
    const played = def ? playOnce(entity.body, entity.type, onZero.anim, def) : Promise.resolve();
    return Promise.all([played, dimmed]);
  }

  // The charge glow and counter vanish with no _out sheet (the enemy fell, or the stage ended).
  dropCharge(entity) {
    const ch = entity.charge;
    if (!ch) return;
    ch.loop?.cancel();
    ch.glowTween.stop();
    ch.glow.destroy();
    ch.counter.destroy();
    entity.charge = null;
  }

  // Stage end -> next stage: the death pose holds, the story beat plays, the death sheet runs
  // backwards, and the enemy stands up at full HP of the next stage, statuses gone, poise full.
  // The win check ignores the enemy meanwhile (`rising`).
  async riseStage(enemy) {
    const stages = enemy.def.stages;
    const from = stages[enemy.phase || 0];
    const next = stages[(enemy.phase || 0) + 1];
    const z = from.onZero;
    const cfg = battleEvents.stage;
    // Music: the stage's track stops as the enemy falls; the stinger plays as it rises (enterStage starts the next track).
    const musicChange = musicPlan.battle?.[this.battleId]?.stageChange;
    if (musicChange?.stop) playMusic(null);
    await enemy.deathDone;
    await this.wait(cfg.deathHoldMs);
    if (this.battleOver) return;
    if (z.dialogue && dialogues[z.dialogue]) await this.playDialogueOverlay(z.dialogue);

    // The death sheet backwards (a missing or placeholder sheet: the body fades back in).
    if (z.sfx) playSfx(z.sfx);
    if (musicChange?.oneShot) playOneShot(musicChange.oneShot, { resume: false });
    const name = z.reverseAnim || z.anim;
    const def = enemy.anims?.[name];
    const fade = !hasSheet(enemy.anims, name) ? this.tweenPromise(enemy.container, { alpha: 1 }, cfg.riseMs) : Promise.resolve();
    if (def) await Promise.all([playReverseOnce(enemy.body, enemy.type, name), fade]);
    else await fade;

    enemy.phase = (enemy.phase || 0) + 1;
    enemy.turnsInPhase = 0;
    enemy.rising = false;
    enemy.deathDone = null;
    enemy.maxHp = this.stageMaxHp(enemy, next);
    enemy.hp = Math.max(1, Math.round(enemy.maxHp * (z.refillTo ?? 1)));
    enemy.exposed = null;
    this.updateEnemyStatus(enemy);
    if (enemy.maxPoise) this.refillPoise(enemy);
    enemy.container.alpha = 1;
    if (enemy.label) {
      enemy.label.setAlpha(1);
      this.updateLabel(enemy);
      this.tweens.add({ targets: enemy.label, scale: { from: 1.5, to: 1 }, duration: cfg.riseMs, ease: 'Back.easeOut' });
    }
    if (enemy.anims) playLoop(enemy.body, enemy.type, 'idle');
    if (!enemy.anims || enemy.anims.idle.placeholder) enemy.bobTween = this.idleBob(enemy.container);
    this.enterStage(enemy, next);
    if (next.checkpoint) this.stageSnapshot = this.takeRecollectionSnapshot();
    await this.wait(cfg.riseMs);
  }

  // What a stage looks like: a tint on the body, an additive aura behind it, the music pushed up,
  // an ENRAGED pop with a flash, and the first laugh.
  enterStage(enemy, stage) {
    const cfg = battleEvents.stage;
    this.applyStageLook(enemy, stage);
    Fx.popText(this, enemy.container.x, enemy.container.y, cfg.enragedText, cfg.enragedColor, qte.text);
    if (cfg.flash) Fx.screenFlash(this, cfg.flash, qte.flashDepth);
    if (cfg.shake) Fx.shake(this, cfg.shake.amount, cfg.shake.ms);
    this.laugh(enemy, stage, cfg.laughOffsetY);
  }

  // The lasting part of a stage's look (tint, aura, music, laugh clock); also restored by a rewind.
  applyStageLook(enemy, stage) {
    const images = [enemy.body, ...Object.values(enemy.parts).map((p) => p.img)];
    if (stage.tint) Fx.setBaseTint(images, multiplyTints(enemy.body.baseTint ?? 0xffffff, Number(stage.tint)));
    if (stage.aura) this.startAura(enemy, stage.aura);
    if (stage.music) playMusic(stage.music);
    if (stage.musicIntensity !== undefined) setMusicIntensity(stage.musicIntensity);
    if (stage.laughEvery) enemy.laughIn = Phaser.Math.Between(stage.laughEvery[0], stage.laughEvery[1]);
  }

  // The enemy laughs: its stage's laughSfx and a small pop of laughText (may be empty).
  laugh(enemy, stage = enemy.def.stages?.[enemy.phase || 0], offsetY = 0) {
    const cfg = battleEvents.stage;
    if (!stage?.laughSfx || this.battleOver) return;
    playSfx(stage.laughSfx);
    if (cfg.laughText) Fx.popText(this, enemy.container.x, enemy.container.y + offsetY, cfg.laughText, cfg.laughColor, qte.text);
  }

  // After each of its turns: every laughEvery[0..1] turns of a stage the enemy laughs.
  // (Drawn after the turn's own rolls, so a forced attack in a lab isn't disturbed.)
  stageLaugh(enemy) {
    const every = enemy.def.stages?.[enemy.phase || 0]?.laughEvery;
    if (!every || enemy.hp <= 0) return;
    enemy.laughIn = (enemy.laughIn ?? Phaser.Math.Between(every[0], every[1])) - 1;
    if (enemy.laughIn > 0) return;
    enemy.laughIn = Phaser.Math.Between(every[0], every[1]);
    this.laugh(enemy);
  }

  // A pulsing additive glow behind the enemy (stage `aura`), following it wherever it walks.
  startAura(enemy, a) {
    this.stopAura(enemy);
    const glow = this.add
      .image(enemy.container.x, enemy.container.y, Fx.glowTexture(this, a.radius))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(Number(a.color))
      .setAlpha(a.alpha[0])
      .setDepth(enemy.container.depth - 1);
    const tween = this.tweens.add({ targets: glow, alpha: a.alpha[1], duration: a.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const follow = () => glow.setPosition(enemy.container.x, enemy.container.y).setDepth(enemy.container.depth - 1);
    this.events.on('update', follow);
    this.events.once('shutdown', () => this.events.off('update', follow));
    enemy.aura = { glow, tween, follow };
  }

  stopAura(enemy) {
    const a = enemy.aura;
    if (!a) return;
    this.events.off('update', a.follow);
    a.tween.stop();
    this.tweens.add({ targets: a.glow, alpha: 0, duration: ui.downed.enemyFadeMs, onComplete: () => a.glow.destroy() });
    enemy.aura = null;
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
    // A braced hero returns to the brace pose, not to idle.
    if (entity.isHero && this.brace && this.braceHero === entity && hasSheet(entity.anims, 'brace')) return 'brace';
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
    // body.x is in container space; a mirrored or enlarged container changes it.
    const dx = (away * knockbackPx) / (entity.container.scaleX || 1);
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
        { slot: 'strike', label: name(labels.strike), value: 'strike', pulse: this.hints.isShowing('strike'), help: this.helpFor('strike', hero) },
        {
          slot: 'technique',
          label: name(labels.technique),
          value: 'technique',
          enabled: hero.techniques.some((id) => !this.covered(hero, id)),
          pulse: this.hints.isShowing('techniques'),
          help: this.helpFor('technique', hero),
        },
      ];
      // The ultimate slot exists only when ui.commands.ultimateInMenu is on (it is off in chapter 1: the
      // Recollection is cast by the Keepsake and by Try again) and the battle has the ultimate.
      const ultimate = ui.commands.ultimateInMenu ? this.ultimateItem(hero, name(labels.recollection)) : null;
      if (ultimate) main.push(ultimate);
      // Dev/QA (?recollection=1, forceRecollectionReady): the first menu where Rhea can cast, she casts.
      if (this.castWhenReady && this.canUltimate(hero)) {
        this.castWhenReady = false;
        const target = await this.pickEnemy();
        if (target) return { kind: 'ultimate', techId: 'recollection', target };
      }
      const picking = this.menu.show(main);
      // The first menu of a tutorial battle opens with its battleStart pause: the buttons are
      // already drawn (the spotlight needs them) but the dim swallows every tap.
      if (this.pauseOnFirstMenu) {
        const id = this.pauseOnFirstMenu;
        this.pauseOnFirstMenu = null;
        await this.runPause(id);
      }
      // battles.json pauses.menuAfterFlag {flag: id}: the first command menu after a battle event set the flag
      // (the guided "Tap Technique" pause after the duel's Blast unlock).
      const flagPause = this.menuFlagPause();
      if (flagPause) await this.runPause(flagPause);
      await this.menuFirstPause(hero);
      const pick = await picking;

      if (pick === 'strike') {
        const target = await this.pickEnemy('strike');
        if (target) return { kind: 'strike', techId: 'strike', target };
        continue;
      }

      if (pick === 'ultimate') {
        const target = await this.pickEnemy();
        if (target) return { kind: 'ultimate', techId: 'recollection', target };
        continue;
      }

      const listing = this.menu.show(this.techniqueItems(hero));
      await this.techniqueMenuPause(hero);
      const techId = await listing;
      if (!techId) continue;
      const tech = this.techOf(hero, techId);
      // Anchor: pick who gets it (Back returns to the technique list).
      if (tech.type === 'heal') {
        const ally = await this.pickHero(tech);
        if (ally) return { kind: 'technique', techId, target: ally };
        continue;
      }
      if (tech.target !== 'enemy') return { kind: 'technique', techId };
      const target = await this.pickEnemy(techId);
      if (target) return { kind: 'technique', techId, target };
    }
  }

  // The next battles.json pauses.menuAfterFlag pause that is due: its flag is set and it has not run in
  // this battle yet (a pause already seen this run is skipped by TutorialPause itself).
  menuFlagPause() {
    this.menuPausesDone ||= new Set();
    for (const [flag, id] of Object.entries(this.battleDef.pauses?.menuAfterFlag || {})) {
      if (!this.hasFlag(flag) || this.menuPausesDone.has(id)) continue;
      this.menuPausesDone.add(id);
      return id;
    }
    return null;
  }

  // battles.json pauses.menuFirst {heroId: "learn_<tech>"}: that hero's first command menu of the run explains a
  // move they know from Recall 1 (Dov's Anchor: no Recall card ever introduces it). The text is the move's
  // techniques.json help.steps; the id is the one the Recall card would use, so a card that already
  // showed it (or this pause earlier in the run) counts as seen.
  async menuFirstPause(hero) {
    const id = this.battleDef.pauses?.menuFirst?.[hero.type];
    this.menuPausesDone ||= new Set();
    if (!id || this.menuPausesDone.has(id) || this.battleOver) return;
    this.menuPausesDone.add(id);
    const steps = learnSteps(id.slice(tutorialData.recallLearn.idPrefix.length), hero.level ?? this.level, false);
    if (!steps) return;
    const def = { always: true, steps: steps.map((text) => ({ text, targets: ['cmd.technique'] })) };
    await TutorialPause.show(this, id, {}, {}, def);
  }

  // battles.json pauses.techniqueMenu: explains the technique list when it opens with a technique the
  // player can actually use. `cmd.<techId>` spotlights that technique's slot; with less Echo than it
  // costs the second step adds its textIfShort.
  async techniqueMenuPause(hero) {
    const id = this.battleDef.pauses?.techniqueMenu;
    if (!id || this.battleOver) return;
    const usable = (this.menu.items || []).filter((i) => i.slot !== 'back' && !i.locked && !i.covered);
    if (!usable.length) return;
    const targets = {};
    for (const item of usable) targets[`cmd.${item.value}`] = this.tutorialTargets[`cmd.${item.slot}`];
    const short = hero.echo < Math.min(...usable.map((i) => this.techOf(hero, i.value).cost));
    await this.runPause(id, { targets, flags: { short } });
  }

  // Row 2 of the main menu: Recollection. Ready (Rhea at full Echo): the
  // teal button, pulsing. Otherwise a dimmed teaser that fills with Rhea's
  // Echo, on either hero's turn, so the ultimate and what charges it are
  // visible from the first fight.
  ultimateItem(hero, label) {
    if (!this.battleDef.recollection) return null;
    const help = this.helpFor('recollection', hero);
    if (this.canUltimate(hero)) return { slot: 'ultimate', label, value: 'ultimate', pulse: true, variant: 'primary', help };
    const rhea = this.heroes.find((h) => h.def.canUltimate) || this.heroes[0];
    const max = techniques.recollection.cost;
    const cost = ui.commands.labels.ultimateProgress.replace('{n}', Math.min(rhea.echo, max)).replace('{max}', max);
    return { slot: 'ultimate', label, enabled: false, variant: 'teaser', cost, progress: { value: rhea.echo, max }, help };
  }

  canUltimate(hero) {
    return !!this.battleDef.recollection && !!hero.def.canUltimate && hero.echo >= techniques.recollection.cost;
  }

  // A hero's technique as it is at their Recall level (techniques.json `levels`).
  techOf(hero, id) {
    return techniqueAt(id, hero.level ?? this.level, techniques);
  }

  techniqueItems(hero) {
    const slots = ui.commands.techniqueSlots;
    const items = hero.techniques.slice(0, slots.length).map((id, i) => this.isLocked(id) ? {
      // A technique the battle hasn't unlocked yet (battles.json lockedTechniques): a blank slot.
      slot: slots[i],
      label: ui.commands.lockedSlot.text,
      locked: true,
      enabled: false,
      value: id,
    } : ({
      slot: slots[i],
      label: this.fogged(hero) ? statuses.fog.label : this.techOf(hero, id).name,
      cost: this.techOf(hero, id).cost,
      // Redacted: covered by a black bar and can't be used. A heal is greyed
      // while nobody needs it (no Echo wasted on a full party).
      enabled: hero.echo >= this.techOf(hero, id).cost && !this.covered(hero, id) && this.healHasTarget(this.techOf(hero, id)),
      covered: this.covered(hero, id),
      value: id,
      help: this.covered(hero, id) ? null : this.helpFor(id, hero),
    }));
    items.push({ slot: 'back', label: ui.commands.labels.back, value: null });
    return items;
  }

  // The long-press card of a command (MoveHelp.helpCard) at the hero's Recall level; none while fogged.
  helpFor(id, hero) {
    return this.fogged(hero) ? null : helpCard(id, hero.level ?? this.level);
  }

  // battles.json lockedTechniques {techId: flag}: the technique can't be used until a battle event sets the flag.
  isLocked(id) {
    const flag = this.battleDef.lockedTechniques?.[id];
    return !!flag && !this.hasFlag(flag);
  }

  // A heal technique has someone to help: a hurt hero, or a downed one if it revives.
  healHasTarget(tech) {
    if (tech.type !== 'heal') return true;
    return this.heroes.some((h) => (h.hp > 0 && h.hp < h.maxHp) || (h.hp <= 0 && tech.canRevive));
  }

  // One living enemy = automatic. Otherwise the target cards (name, HP bar, status) in the command
  // area, or a tap on a highlighted sprite; Back → null. techId = the pending action (a Strike on
  // a Hollow gets its IMMUNE tag).
  pickEnemy(techId = null) {
    const living = this.enemies.filter((e) => e.hp > 0);
    if (living.length <= 1) return Promise.resolve(living[0] || null);
    living.sort((a, b) => a.container.x - b.container.x);
    return this.pickTarget(living, { kind: 'enemy', techId });
  }

  // Dov's Anchor: who gets it. A level that can't revive offers only the living; a single valid
  // hero is picked without asking (the sim and a one-hero party take this path too).
  pickHero(tech) {
    const candidates = this.heroes.filter((h) => h.hp > 0 || tech.canRevive);
    if (candidates.length <= 1) return Promise.resolve(candidates[0] || null);
    const hero = this.activeHero;
    const prompt = (tech.targetPrompt || ui.target.heroPrompt).replace('{hero}', hero?.name ?? '');
    return this.pickTarget(candidates, { kind: 'hero', prompt });
  }

  // ui.json target: cards for `candidates` + the same sprites highlighted and tappable
  // (tint for enemies, a bobbing marker, a pulsing glow under the feet; the card under the
  // finger lights its sprite up). Resolves with the chosen entity or null (Back).
  pickTarget(candidates, { kind, techId = null, prompt = null }) {
    const cfg = ui.target;
    const hl = cfg.highlight;
    const techName = techId ? this.techOf(this.activeHero, techId)?.name ?? '' : '';
    const names = candidates.map((c) => c.name);
    const badges = candidates.map((c) => (names.filter((n) => n === c.name).length > 1 ? String(names.slice(0, candidates.indexOf(c)).filter((n) => n === c.name).length + 1) : null));

    const fx = [];
    candidates.forEach((entity, i) => {
      if (kind === 'enemy') entity.body.setTint(Number(ui.commands.targetTint));
      entity.body.setInteractive({ useHandCursor: true });
      entity.body.once('pointerdown', () => this.menu.choose(entity));
      const top = entity.label ? entity.label.y - entity.label.height : entity.container.y - entity.height / 2;
      const marker = this.pointer(entity.container.x, top - ui.targetMarker.gapY, ui.targetMarker);
      const glow = this.add
        .ellipse(entity.container.x, entity.feetY - hl.glowOffsetY, entity.height * hl.glowW, hl.glowH, Number(hl.color), hl.alpha[0])
        .setDepth(entity.container.depth - 1);
      const pulse = this.tweens.add({ targets: glow, alpha: hl.alpha[1], duration: hl.pulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const chip = badges[i]
        ? this.add.text(entity.container.x, marker.y - ui.targetMarker.size - hl.chipGap, badges[i], { fontFamily: ui.font, fontSize: `${hl.chipFontSize}px`, color: hl.chipColor, stroke: '#0b0d14', strokeThickness: 3 }).setOrigin(0.5).setDepth(ui.targetMarker.depth)
        : null;
      fx.push({ entity, marker, glow, pulse, chip });
    });

    // The card under the finger: its sprite's marker grows, its glow stays bright.
    let focus = null;
    const setFocus = (entity) => {
      focus = entity;
      for (const f of fx) {
        const on = f.entity === entity;
        f.marker.setScale(on ? hl.focusScale : 1);
        f.pulse.timeScale = on ? 0.4 : 1;
        f.glow.setScale(on ? hl.focusScale : 1);
      }
    };

    return this.menu.showTargets(candidates, { kind, prompt: prompt ?? cfg.prompt, techId, techName, badges, onFocus: setFocus }).then((target) => {
      for (const f of fx) {
        f.marker.destroy();
        f.pulse.stop();
        f.glow.destroy();
        f.chip?.destroy();
        if (kind === 'enemy') Fx.restoreTint(f.entity.body);
        f.entity.body.off('pointerdown');
        f.entity.body.disableInteractive();
      }
      return target;
    });
  }

  // ---------- Tutorial pauses ----------

  // Spotlight targets that belong to the battle itself (the HUD and command buttons register their own).
  registerTutorialTargets() {
    const t = this.tutorialTargets;
    const v = viewRect();
    // The lower screen is the tap zone of every ring; it bleeds past the screen edges.
    const z = tutorialData.style.tapZone;
    t.tapzone = { x: v.x - z.bleed, y: z.y, w: v.w + z.bleed * 2, h: v.h - z.y + z.bleed, pad: 0 };
    t.nala = () => (this.nala ? this.entityRect(this.nala, 56, 56, this.nala.container.y + 28) : null);
    t.enemy = () => {
      const e = this.enemies.find((x) => x.hp > 0) || this.enemies[0];
      return e ? this.entityRect(e) : null;
    };
    // The golden poise line of the first enemy that has one (enemy.poise) or of enemy n (enemy.poise.<n>).
    t['enemy.poise'] = () => this.enemies.find((e) => e.hp > 0 && e.poiseBar)?.poiseBar.rect();
    this.battleDef.enemies.forEach((_, i) => {
      t[`enemy.poise.${i}`] = () => this.enemies[i]?.poiseBar?.rect();
    });
    t.hero = () => {
      const h = this.activeHero || this.heroes.find((x) => x.hp > 0) || this.heroes[0];
      return h ? this.entityRect(h) : null;
    };
  }

  // A fighter's body box (the sprite canvas is mostly empty): feet on the baseline, ~70x100 at scale 1.
  entityRect(entity, w = 70, h = 100, feetY = entity.container.y + entity.height / 2) {
    const s = entity.def?.displayScale ?? 1;
    return { x: entity.container.x - (w * s) / 2, y: feetY - h * s, w: w * s, h: h * s };
  }

  // Runs tutorial pause `id` (tutorial.json) if it applies; `extra` adds targets for this call
  // (the attacker / its target). Safe points only: nothing live (no ring) while it is up.
  runPause(id, extra = {}) {
    if (!id || this.battleOver) return Promise.resolve(false);
    const targets = {};
    if (extra.enemy) targets.enemy = () => this.entityRect(extra.enemy);
    if (extra.hero) targets.hero = () => this.entityRect(extra.hero);
    Object.assign(targets, extra.targets);
    return TutorialPause.show(this, id, targets, extra.flags);
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

    // The present makes new sparks (STORY.md, Echo rule 3): a little Echo
    // every turn, so a fight against Strike-immune Hollows can still be won.
    this.gainEcho(hero, hero.def.turnEcho || 0);

    this.showActiveHero(hero);
    this.playerInput = true;
    this.nalaRefreshGlow();
    // The opening pause explains Strike and Techniques itself: no banner on top of it.
    const opening = this.pauseOnFirstMenu && TutorialPause.wouldShow(this, this.pauseOnFirstMenu);
    if (!opening) this.hints.show('strike');
    const costs = hero.techniques.filter((id) => !this.isLocked(id)).map((id) => this.techOf(hero, id).cost);
    if (!opening && costs.length && hero.echo >= Math.min(...costs)) this.hints.show('techniques');
    const action = await this.chooseAction(hero);
    this.hints.done('strike');
    this.hints.done('techniques');
    this.playerInput = false;
    this.nalaRefreshGlow();
    this.showActiveHero(null);
    this.hideCommandMenu();

    const tech = this.techOf(hero, action.techId);
    this.spendEcho(hero, tech.cost);

    const restoreDepth = this.bringInFront(hero, action.target);
    // playerHits: applyHit marks actionLanded while a Strike or attack technique
    // runs (the ultimate is no "hit"; counters happen in the enemy's turn).
    this.playerAction = action.kind !== 'ultimate';
    this.actionLanded = false;
    try {
      if (action.kind === 'strike') await this.playerStrike(hero, action.target);
      else if (action.kind === 'ultimate') await this.playRecollection(hero, action.target);
      else await this.runTechnique(hero, action.techId, action.target);
    } finally {
      restoreDepth();
      this.playerAction = false;
    }
    await this.flushDefendHook();
    if (this.actionLanded) this.counters.playerHits += 1;
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

  // An enemy's turn, then its own statuses (Exposed) tick down.
  async enemyTurn(enemy) {
    await this.enemyAct(enemy);
    this.tickEnemyStatus(enemy);
    this.stageLaugh(enemy);
  }

  // Each hit of the attack is its own parry ring on the targeted hero.
  // A hero in a counter stance draws the attack.
  async enemyAct(enemy) {
    // A failed Recollection forces this enemy's next turn (recollection.json fail.forceAttack): Unwriting.
    if (enemy.forceNextAttack) {
      const forced = this.enemyAttacks(enemy).find((a) => a.id === enemy.forceNextAttack);
      enemy.forceNextAttack = null;
      if (forced?.noInput) {
        await this.playUnwriting(enemy, forced);
        return;
      }
    }
    if (enemy.broken) {
      await this.skipBrokenTurn(enemy);
      return;
    }
    const livingHeroes = this.heroes.filter((h) => h.hp > 0);
    if (livingHeroes.length === 0) return;
    // An enemy that won't fight yet (enemies.json refuseUntilFlag, set by a battle
    // event): a pop of text and a pause instead of an attack. No ring, no tap hint.
    if (enemy.def.refuseUntilFlag && !this.hasFlag(enemy.def.refuseUntilFlag)) {
      const r = battleEvents.refuse;
      Fx.popText(this, enemy.container.x, enemy.container.y, enemy.def.refuseText ?? r.text, r.color, qte.text);
      await this.wait(enemy.def.refuseMs ?? r.ms);
      return;
    }
    const stanceHero = this.stance && this.stance.hero.hp > 0 ? this.stance.hero : null;
    // enemies.json ai (EnemyTuning.js): a chance to pick on the weakest hero; else a random one.
    const target = stanceHero || aiPickTarget(enemy.def.ai, livingHeroes, Math.random);
    let attack;
    let mitigated = 0;
    if (enemy.charge) {
      enemy.charge.turnsLeft -= 1;
      this.updateChargeCounter(enemy);
      if (enemy.charge.turnsLeft > 0) {
        Fx.popText(this, enemy.container.x, enemy.container.y, battleEvents.charge.chargingText, battleEvents.charge.textColor, qte.text);
        await this.wait(battleEvents.charge.chargingMs);
        return;
      }
      attack = enemy.charge.attack;
      mitigated = enemy.charge.mitigated;
      await this.endCharge(enemy);
    } else {
      attack = this.pickAttack(enemy, target);
      if (attack.chargeTurns) {
        this.startCharge(enemy, attack);
        // attack.onChargeStart: a battle event (battleEvents.json) the first time any charge of
        // that id starts in the battle; it plays after this turn (afterTurn).
        const started = attack.onChargeStart;
        if (started && !this.firedEvents.has(`chargeStart:${started}`)) {
          this.firedEvents.add(`chargeStart:${started}`);
          this.pendingEvents.push(started);
        }
        await this.wait(battleEvents.charge.chargingMs);
        return;
      }
    }

    this.tapHint.setVisible(true);
    const hits = attack.hits || [attack];
    // enemies.json firstAttackTelegraphMult: the enemy's first real attack (a refused turn doesn't count) winds up slower.
    const telegraphMult = !enemy.attacked && enemy.def.firstAttackTelegraphMult ? enemy.def.firstAttackTelegraphMult : 1;
    // enemies.json firstAttackWindowMult (else the telegraph multiplier): how much wider the first ring's windows are.
    const firstWindowMult = !enemy.attacked ? (enemy.def.firstAttackWindowMult ?? telegraphMult) : 1;
    enemy.attacked = true;
    enemy.attackCount = (enemy.attackCount || 0) + 1;
    const restoreDepth = this.bringInFront(enemy, target);
    // A melee attack walks up to its target first (before the first ring) and
    // walks home after the last hit, whatever ended the attack.
    const melee = !!attack.melee;
    let feintHook = null;
    try {
      if (melee) await this.meleeApproach(enemy, target);
      // battles.json pauses.enemyAttack {"1": id, "2": id}: a tutorial pause before the ring of the
      // enemy's nth real attack (the ring does not exist yet).
      await this.runPause(this.battleDef.pauses?.enemyAttack?.[enemy.attackCount], { enemy, hero: target });
      // enemies.json attack.firstUsePause: a tutorial pause before the first ring of THIS move (once per
      // run: the crush). When it shows, it stands in for the generic red_ring pause (enemyHit skips that one).
      const usePaused = attack.firstUsePause ? await this.runPause(attack.firstUsePause, { enemy, hero: target }) : false;
      if (usePaused && attack.unparryable) TutorialPause.markSeen(this.registry, 'red_ring');
      const sheet = this.enemyAttackSheet(enemy, attack, hits.length);
      for (let k = 0; k < hits.length; k++) {
        if (target.hp <= 0 || enemy.hp <= 0) break;
        // A parry counter just pushed Quill under the Keepsake threshold: no more rings, the cast is next.
        if (this.pendingEvents.includes('keepsake_burn') && this.autoCastTarget()) break;
        const hit = {
          ...hits[k],
          telegraphMs: hits[k].telegraphMs * telegraphMult,
          // The slowed first attack is the lesson itself: no extra slow-mo on top, windows widened by the same factor.
          firstSlow: firstWindowMult > 1 ? firstWindowMult : 0,
          unparryable: hits[k].unparryable ?? attack.unparryable ?? false,
          pausedBefore: k === 0 && usePaused,
          // Sounds can be set per hit or once for the whole attack.
          sfx: hits[k].sfx ?? attack.sfx,
          impactSfx: hits[k].impactSfx ?? attack.impactSfx,
        };
        // crit.json enemy: rolled per hit; the bigger hit only shows if damage gets through.
        if (Math.random() < crit.enemy.chance) {
          hit.crit = true;
          hit.dmg = Math.round(hit.dmg * crit.enemy.mult);
        }
        // enemies.json feintChance (hit or attack level): the feint only comes some of the time.
        // A hit without feintChance keeps its feint every time.
        const feintChance = hits[k].feintChance ?? attack.feintChance;
        if (hit.feint && feintChance !== undefined && !(Math.random() < feintChance)) delete hit.feint;
        const result = await this.enemyHit(enemy, target, hit, sheet, k);
        if (result === 'CANCEL') break;
        // The ring just resolved with a real feint (the roll above kept it): the hook plays after the attack.
        if (hit.feint && attack.onFirstFeint) feintHook = attack.onFirstFeint;
      }
      if (sheet) await sheet.finish();
    } finally {
      if (melee) await this.meleeReturn(enemy);
      restoreDepth();
    }
    this.tapHint.setVisible(false);
    // enemies.json onFirstFeint {dialogue, pause}: the first feint of the battle is explained, once.
    if (feintHook && enemy.hp > 0) await this.playEnemyHook(enemy, feintHook);

    // A released charge heals part of what its guard absorbed, and the first
    // release of the battle can queue a story beat (e.g. Rhea's insight).
    if (enemy.hp > 0 && attack.healMitigatedPct && mitigated > 0) this.healEnemy(enemy, Math.round(mitigated * attack.healMitigatedPct));
    if (enemy.hp > 0 && attack.onRelease && !enemy.released?.[attack.id]) {
      enemy.released = { ...(enemy.released || {}), [attack.id]: true };
      this.pendingEvents.push(attack.onRelease);
    }
  }

  // A phase's "opening" (enemies.json) fixes the attack of that phase's first
  // turns (the Clerk charges Archive on his second); then the enemy's `ai` rules
  // (EnemyTuning.aiPickAttack: e.g. Redact a hero with Echo to spend) get a say; after that, weighted.
  pickAttack(enemy, target = null) {
    const phase = currentStage(enemy.def, enemy.phase);
    const n = enemy.turnsInPhase || 0;
    enemy.turnsInPhase = n + 1;
    const pickable = this.pickableAttacks(enemy);
    const id = phase?.opening?.[n];
    const fixed = id ? pickable.find((a) => a.id === id) : null;
    if (fixed) return fixed;
    const ruled = aiPickAttack(enemy.def.ai, pickable, { target, heroes: this.heroes, enemy }, Math.random);
    return ruled || pickWeighted(pickable);
  }

  // The parry tutorial teaches the tap first: no red-ring attack until it's
  // done. A battle with "redRings": false (battles.json) never throws one, so
  // the swipe lesson waits for a later fight.
  pickableAttacks(enemy) {
    // battles.json disabledAttacks {"<enemy id>": ["<attack id>"]}: moves this fight never throws.
    const off = this.battleDef.disabledAttacks?.[enemy.type] || [];
    const attacks = this.enemyAttacks(enemy).filter((a) => !off.includes(a.id));
    const noRed = this.tutorialSlow || this.battleDef.redRings === false;
    const parryable = noRed ? attacks.filter((a) => !a.unparryable) : attacks;
    return parryable.length ? parryable : attacks;
  }

  // ---------- Parry QTE ----------

  buildTapHint() {
    const { x, y, fontSize, color, text } = qte.hint;
    this.tapHint = this.add
      .text(x, y, text, { fontFamily: ui.font, fontSize: `${fontSize}px`, color })
      .setOrigin(0.5)
      .setDepth(ui.commands.button.depth || 0)
      .setVisible(false);
  }

  // The difficulty scales the windows: windowMult for GOOD, perfectWindowMult (default windowMult) for PERFECT.
  parryWindows() {
    const mult = this.difficulty.windowMult;
    const pMult = this.difficulty.perfectWindowMult ?? mult;
    // Worn Glove: a wider PERFECT window. Assist: see parryAssist().
    const extra = effectTotal(this.fragments, 'perfectWindowMs');
    const assist = this.parryAssist();
    const windows = { ...qte.windows, perfectMs: qte.windows.perfectMs + extra + assist, goodMs: qte.windows.goodMs + assist };
    return mult === 1 && pMult === 1 ? windows : Qte.scaledWindows(windows, mult, pMult);
  }

  // The easier windows of a swipe (dodge) on a parryable ring
  // (qte.json dodge.windows). Same extras as parryWindows() (Worn Glove's
  // perfectWindowMs, the miss-streak assist, the difficulty windowMult) so a
  // dodge stays easier than a parry by the same margin everywhere.
  dodgeWindows() {
    const mult = this.difficulty.windowMult;
    const pMult = this.difficulty.perfectWindowMult ?? mult;
    const extra = effectTotal(this.fragments, 'perfectWindowMs');
    const assist = this.parryAssist();
    const w = qte.dodge.windows;
    const windows = { ...qte.windows, perfectMs: w.perfectMs + extra + assist, goodMs: w.goodMs + assist };
    return mult === 1 && pMult === 1 ? windows : Qte.scaledWindows(windows, mult, pMult);
  }

  // The fallback dodge reaction (qte.json dodge.sidestepPx/sidestepMs): the hero's
  // container slides away from the enemy and back, relative to where it stands
  // (melee/restX positions stay as they were). Resolves when it is home again.
  dodgeSidestep(hero) {
    trace(`fallback:dodge:${hero.type}`);
    const c = hero.container;
    const { sidestepPx, sidestepMs } = qte.dodge;
    const dir = hero.facing === 'right' ? -1 : 1;
    return new Promise((resolve) => {
      this.tweens.add({ targets: c, x: c.x + dir * sidestepPx, duration: sidestepMs, yoyo: true, ease: 'Quad.easeOut', onComplete: resolve });
    });
  }

  // Invisible help for a player who keeps missing (qte.json assist): every
  // missStreak MISSes in a row widen both windows by stepMs, up to maxMs; a
  // PERFECT takes it all back. Kept in the registry, so it carries across
  // battles and a Retry. Enemy parries only (not Recollection's rings).
  parryAssist() {
    return this.registry.get('parryAssistMs') || 0;
  }

  trackParryAssist(result) {
    const a = qte.assist;
    if (!a) return;
    let streak = this.registry.get('parryMissStreak') || 0;
    let assist = this.parryAssist();
    if (result === 'MISS') {
      streak += 1;
      if (streak >= a.missStreak) {
        streak = 0;
        assist = Math.min(a.maxMs, assist + a.stepMs);
      }
    } else {
      streak = 0;
      if (result === 'PERFECT') assist = 0;
    }
    this.registry.set('parryMissStreak', streak);
    this.registry.set('parryAssistMs', assist);
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
    // The first red ring of the run: a spotlight pause before the ring exists (tutorial.json red_ring).
    // The slow-mo lesson below still runs; its own text prompt would repeat the pause, so it stays off.
    const redPaused = hit.pausedBefore || (hit.unparryable && (await this.runPause('red_ring', { enemy, hero: target })));
    // battles.json pauses.nalaWatch: the first time Nala senses a Hollow, a guided pause (tap her) before the ring
    // exists. Resolves true when the tap went through to her: the save fires as soon as the ring is up.
    let nalaSave = this.nalaCanWatch(enemy) && (await this.runPause(this.battleDef.pauses?.nalaWatch));
    this.tapHint.setText(hit.unparryable ? tx(red, 'hint') : tx(qte.hint));
    // The second gesture (ui.json tutorial.hints.dodge) is taught on the first white ring after the
    // slow-mo tap lesson, in whichever battle that is; it shows once and waits if another banner is up.
    if (!this.tutorialSlow && !hit.unparryable) this.hints.show('dodge');
    while (true) {
      const slow = (this.tutorialSlow && !hit.firstSlow) || lesson ? qte.tutorial.timeScale : 1;
      this.setTimeScale(slow);
      if ((this.tutorialSlow || lesson) && !(lesson && redPaused)) this.showTutorialPrompt(true, lesson ? tx(red.lesson) : tx(qte.tutorial.prompt));

      // This enemy's own window factors (enemies.json difficulty.<id>.windowMult / perfectWindowMult).
      const [eGood, ePerfect] = enemyWindowMults(enemy.def);
      const ownWindows = (w) => (eGood === 1 && ePerfect === 1 ? w : Qte.scaledWindows(w, eGood, ePerfect));
      const windows = ownWindows(hit.firstSlow ? Qte.scaledWindows(this.parryWindows(), hit.firstSlow) : this.parryWindows());
      const x = target.container.x;
      const y = target.container.y + qte.ring.offsetY;
      const ringWindows = slow === 1 ? windows : Qte.scaledWindows(windows, 1 / slow);
      const ringDodge = slow === 1 ? ownWindows(this.dodgeWindows()) : Qte.scaledWindows(ownWindows(this.dodgeWindows()), 1 / slow);
      ring = Qte.runRing(this, {
        x,
        y,
        telegraphMs: hit.telegraphMs / slow,
        feint: hit.feint ? { ...hit.feint, pauseMs: hit.feint.pauseMs / slow } : null,
        windows: ringWindows,
        ring: hit.unparryable ? { ...qte.ring, color: red.ringColor, targetColor: red.targetColor } : qte.ring,
        swipe: qte.dodge.swipe,
        unparryable: hit.unparryable,
        // Every ring takes both gestures: a tap parries, a swipe dodges (Qte.runRing).
        dodgeWindows: ringDodge,
        // No tap by T: the hit visibly lands now, the judgement (a late GOOD
        // or a MISS) follows when the window closes.
        onImpact: () => target.hp > 0 && this.playHurt(target),
      });
      const icon = hit.unparryable ? this.showUnparryableIcon(x, y) : null;
      // Keys / controller: the parry and dodge buttons beside the hero, lit once the press window opens.
      const openMs = hit.unparryable ? ringWindows.goodMs : Math.max(ringWindows.goodMs, ringDodge.goodMs);
      const prompt = ringPrompt(this, { x, top: target.container.y - target.height / 2, unparryable: hit.unparryable, impactAt: ring.impactAt, openMs });
      this.ringPromptLive = prompt; // QA reads it
      // The attack's own sound as it winds up (enemies.json hit.sfx), e.g. the Clerk's ledger pages.
      if (hit.sfx && k === 0) playSfx(hit.sfx);
      const watched = this.nalaWatch(enemy, ring);
      if (watched && nalaSave) {
        nalaSave = false;
        this.nalaHiss();
      }

      const abort = { aborted: false };
      const feintPauseMs = hit.feint ? hit.feint.pauseMs / slow : 0;
      attackDone = sheet ? sheet.strike(k, ring.impactAt, abort, feintPauseMs) : this.playLungeTelegraph(enemy, ring.impactAt, abort);

      ({ result, input } = await ring.promise);
      icon?.destroy();
      if (prompt && input) prompt.press(input);
      if (prompt) this.time.delayedCall(qte.ring.fadeMs ?? 150, () => prompt.destroy());
      this.ringPromptLive = null;
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
    // The slow-mo tutorial ends with the first GOOD/PERFECT parry (a dodge swipe isn't the lesson).
    if (this.tutorialSlow && !hit.unparryable && result !== 'MISS' && input !== 'swipe') {
      this.tutorialSlow = false;
    }
    if (input === 'swipe' && result !== 'MISS') this.hints.skip('dodge'); // they already found it
    if (lesson) {
      dodgeLesson.runs += 1;
      if (input === 'swipe' && result !== 'MISS') dodgeLesson.learned = true;
    }
    this.tapHint.setText(tx(qte.hint));
    this.trackParryAssist(result);
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

  showTutorialPrompt(on, text = tx(qte.tutorial.prompt)) {
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
    fx.setScale(enemy.container.scaleX, enemy.container.scaleY).setDepth(enemy.container.depth + 1);
    return playLoop(fx, enemy.type, def.projectile);
  }

  playLungeTelegraph(enemy, impactAt, abort) {
    trace(`fallback:lunge:${enemy.type}`);
    const lunge = enemy.def.attack?.distance !== undefined ? enemy.def.attack : FALLBACK_LUNGE;
    const dir = enemy.facing === 'right' ? 1 : -1;
    const c = enemy.container;
    // Lunges from wherever the attacker stands (home, or beside its target).
    const restX = c.x;

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

  // The track the fight plays now: the living staged boss's stage music, else the battle's.
  battleMusic() {
    const boss = this.enemies.find((e) => e.def.stages && e.hp > 0);
    return boss?.def.stages[boss.phase || 0].music || this.battleDef.music || null;
  }

  // ---------- Boss phases (enemies.json phases) ----------

  // A boss uses the attack list of its current phase.
  enemyAttacks(enemy) {
    const phases = enemy.def.stages || enemy.def.phases;
    return phases ? phases[enemy.phase || 0].attacks : enemy.def.attacks;
  }

  // After damage: move a boss into the next phase once its HP share drops to
  // the current phase's untilHpPct. The phase's onEnter event waits for the
  // end of the current turn (afterTurn).
  checkPhase(enemy) {
    if (enemy.def.stages) {
      this.checkStage(enemy);
      return;
    }
    const phases = enemy.def.phases;
    if (!phases || enemy.hp <= 0) return;
    const pct = (enemy.hp / enemy.maxHp) * 100;
    while ((enemy.phase || 0) < phases.length - 1 && pct <= phases[enemy.phase || 0].untilHpPct) {
      enemy.phase = (enemy.phase || 0) + 1;
      // The track plays harder in later phases (phases[n].musicIntensity, else evenly spread).
      setMusicIntensity(phases[enemy.phase].musicIntensity ?? enemy.phase / (phases.length - 1));
      const onEnter = phases[enemy.phase].onEnter;
      if (onEnter) this.pendingEvents.push(onEnter);
      enemy.turnsInPhase = 0;
      // A new phase brings the poise back (a broken enemy recovers at the end of its stunned turn).
      if (enemy.maxPoise && !enemy.broken) this.refillPoise(enemy);
    }
  }

  // `stages` (the Clerk): a stage's own HP is its bar, 0 ends the stage (markDown -> riseStage), and the
  // stage's `recollectionAt` (EnemyTuning.recollectionDue: his HP under a number or a share, or the party
  // in a last-resort state: both heroes in the red, or one down and the other at half or less) unlocks
  // the Recollection (the Keepsake event) once per battle. Checked after every hit on him and on a hero.
  checkStage(enemy) {
    const stage = enemy.def.stages[enemy.phase || 0];
    if (enemy.hp <= 0 || enemy.rising || enemy.recollectionUnlocked) return;
    if (recollectionDue(recollectionAtOf(stage), enemy, this.heroes)) {
      enemy.recollectionUnlocked = true;
      this.pendingEvents.push('keepsake_burn');
    }
  }

  async afterTurn() {
    // A stage end first: the enemy that fell rises before anything else happens.
    for (const enemy of this.enemies) {
      if (enemy.rising && !this.battleOver && this.heroes.some((h) => h.hp > 0)) await this.riseStage(enemy);
    }
    while (this.pendingEvents.length && !this.battleOver) {
      const event = this.pendingEvents.shift();
      if (event === 'keepsake_burn') await this.keepsakeBurn();
      else if (battleEvents[event]?.dialogue && this.enemies.some((e) => e.hp > 0)) await this.playDialogueOverlay(battleEvents[event].dialogue);
    }
    await this.checkEvents();
  }

  // Generic battle events (battles.json `events`; grammar in systems/BattleEvents.js):
  //   when  "battleStart" | {round: n} | {playerHits: n} | {enemyHpBelowPct: n} | "firstImmune"
  //         | {firstOf: [when, ...]}
  //   then  "continue" (default) | {setFlag: name} | "endBattle"
  // Runs after the intro and after every turn (afterTurn), never during a live
  // ring. Each event fires once, in list order; its dialogue plays as an overlay,
  // then `then` applies. Skipped once the battle is over or every hero is down
  // (the loss is already decided). An event whose dialogue is missing is skipped
  // (warning in dev) so the battle cannot soft-lock.
  async checkEvents() {
    const events = this.battleDef.events;
    if (!events?.length || this.battleOver || this.heroes.every((h) => h.hp <= 0)) return;
    const ctx = {
      round: this.stats.turns,
      playerHits: this.counters.playerHits,
      parries: this.counters.parries,
      immuneSeen: this.counters.immuneSeen,
      noHollowDamageRounds: this.counters.noHollowDamageRounds,
      enemies: this.enemies.map((e) => ({ hp: e.hp, maxHp: e.maxHp })),
    };
    for (const event of dueEvents(events, this.firedEvents, ctx)) {
      if (this.battleOver) return;
      this.firedEvents.add(event.id);
      // Order: the PRE actions (nalaJumpIn), the dialogue, the banner, the other actions.
      const { pre, post } = thenSplit(event.then);
      for (const action of pre) await this.runEventAction(action);
      if (event.dialogue) {
        if (!dialogues[event.dialogue]) {
          if (import.meta.env.DEV) console.warn(`battle event "${event.id}": no dialogue "${event.dialogue}", skipped`);
          continue;
        }
        await this.playDialogueOverlay(event.dialogue);
      }
      if (event.banner) {
        this.hints.hide(); // an older banner may still be up from before the dialogue
        this.hints.show(event.banner);
      }
      for (const action of post) {
        if (action === 'endBattle') {
          this.onBattleEnd('INTERRUPTED');
          return;
        }
        await this.runEventAction(action);
      }
      // After the dialogue, the banner and the actions: a tutorial pause that explains what just happened.
      if (event.pause) await this.runPause(event.pause);
    }
  }

  // One `then` action of a battle event (the endBattle word is handled by checkEvents).
  async runEventAction(action) {
    if (action?.setFlag) this.flags.add(action.setFlag);
    else if (action === 'nalaJumpIn') await this.eventNalaJumpIn();
    else if (action === 'nalaGlow') await this.nalaGlowCast(true);
  }

  // Nala leaps in from the left edge and lands between the heroes and the enemies. A battle
  // without Nala (b0_duel) gets her created on the spot, off screen on the left.
  async eventNalaJumpIn() {
    if (!this.nala) this.createNala();
    if (!this.nala) return;
    const c = this.nala.container;
    const hero = this.heroes.find((h) => h.hp > 0) || this.heroes[0];
    const foe = this.enemies.find((e) => e.hp > 0) || this.enemies[0];
    const toX = Math.round(((hero?.container.x ?? c.x) + (foe?.container.x ?? c.x)) / 2);
    const toY = c.y;
    // Hidden until the arc starts (createNala puts her at her usual spot), then in from the left edge.
    const fromX = viewRect().x - this.nala.image.width;
    c.setVisible(false);
    await this.nalaJumpIn(fromX, toY, toX, toY);
    this.nala.glow.setAlpha(0);
  }

  // Flags set by battle events ({setFlag}); e.g. an enemy's refuseUntilFlag reads this.
  hasFlag(name) {
    return this.flags.has(name);
  }

  // Keepsake: the battle pauses for a conversation, Rhea's Echo fills (MEMORY READY) and, right after
  // it, whoever's turn it is, she casts the Recollection on Quill (autoCastRecollection). The command
  // stays in the menu only for the Try again rewind and the dev URLs.
  async keepsakeBurn() {
    if (this.enemies.every((e) => e.hp <= 0)) return;
    // Music: the Recollection track starts with the conversation (audio.json placement.overlay.keepsake_burn,
    // a loop: no duck, no silence) and plays on through the cast and the kill.
    const burn = musicPlan.overlay.keepsake_burn;
    if (burn?.loop) playMusic(burn.track);
    else if (burn) playOneShot(burn.track, { duck: burn.duck, resume: burn.resume });
    await this.playDialogueOverlay(battleEvents.keepsake_burn.dialogue);
    const rhea = this.heroes.find((h) => h.def.canUltimate) || this.heroes[0];
    const auto = this.autoCastTarget();
    // The cast happens even if she fell: she gets back up (recollection.json autoCast.reviveHp).
    if (auto && rhea.hp <= 0) {
      this.revive(rhea, recollection.autoCast.reviveHp);
      this.refreshHud();
    }
    this.autoCasting = !!auto; // the ready banner would only flash for a moment
    const k = battleEvents.keepsake_burn;
    // The burnt Keepsake unlocks the last pips: Recollection is reachable only from here.
    if (k.echoMax) rhea.echoMax = Math.max(rhea.echoMax, k.echoMax);
    this.gainEcho(rhea, rhea.echoMax, true);
    Fx.screenFlash(this, k.flash, qte.flashDepth);
    // The Page joins the collection (fragments.json the_page; no effect of its own).
    const kept = this.registry.get('fragments') || [];
    if (k.memory && !kept.includes(k.memory)) this.registry.set('fragments', [...kept, k.memory]);
    if (auto) await this.autoCastRecollection(rhea);
  }

  // The enemy the keepsake's Recollection goes to (recollection.json autoCast), or null when it doesn't
  // fire (no autoCast block, dev/QA `noAutoCast`, a battle without the ultimate, nobody left).
  autoCastTarget() {
    if (!recollection.autoCast || this.noAutoCast || !this.battleDef.recollection) return null;
    return this.enemies.find((e) => e.hp > 0) || null;
  }

  // Right after the Keepsake: the MEMORY READY flash (played when her Echo filled) for autoCast.delayMs,
  // then the Recollection as Rhea's own action, whoever's turn it was. The rest of the round (a
  // multi-hit attack's remaining rings, the other hero's turn) does not happen before it.
  async autoCastRecollection(rhea) {
    const target = this.autoCastTarget();
    try {
      if (!target) return;
      this.tapHint.setVisible(false);
      await this.wait(recollection.autoCast.delayMs);
      this.spendEcho(rhea, techniques.recollection.cost);
      const restoreDepth = this.bringInFront(rhea, target);
      this.playerAction = false; // the ultimate is not a counted hit
      try {
        await this.playRecollection(rhea, target);
      } finally {
        restoreDepth();
      }
    } finally {
      this.autoCasting = false;
    }
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
  // for chargeTurns of its turns (glow + countdown), guarded: it takes only
  // guardMult of every hit and keeps count of what the guard absorbed. Then
  // it fires as a normal hit and heals healMitigatedPct of that. Only a
  // BREAK (poise to 0) cancels a charge.
  startCharge(enemy, attack) {
    const c = battleEvents.charge;
    if (attack.chargeSfx) playSfx(attack.chargeSfx);
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
    enemy.charge = { attack, turnsLeft: attack.chargeTurns, mitigated: 0, glow, glowTween, counter, loop };
    this.updateChargeCounter(enemy);
    Fx.popText(this, enemy.container.x, enemy.container.y, c.startText, c.textColor, qte.text);
  }

  updateChargeCounter(enemy) {
    const ch = enemy.charge;
    const c = battleEvents.charge;
    ch.counter.setText(c.counterText.replace('{n}', ch.turnsLeft));
  }

  // The enemy regains HP (shown like Anchor's number): a charge's absorbed share
  // by default, or e.g. Siphon's lifesteal with its own text and color.
  healEnemy(enemy, amount, text = battleEvents.charge.healText, color = battleEvents.charge.textColor) {
    const healed = Math.min(amount, enemy.maxHp - enemy.hp);
    if (healed <= 0) return;
    enemy.hp += healed;
    this.updateLabel(enemy);
    Fx.damageNumber(this, enemy.container.x, enemy.container.y - 80, `${ui.heal.textPrefix}${healed}`, null, 'heal');
    Fx.popText(this, enemy.container.x, enemy.container.y, text, color, qte.text);
  }

  // Exposed (Recollection): the enemy takes damageTakenMult until its turns run out.
  applyEnemyStatus(enemy, id, turns) {
    const def = statuses[id];
    if (!def || enemy.isHero || enemy.hp <= 0) return;
    enemy.exposed = { id, mult: def.damageTakenMult, turns };
    Fx.popText(this, enemy.container.x, enemy.container.y, def.applyText, def.color, qte.text);
    this.updateEnemyStatus(enemy);
  }

  tickEnemyStatus(enemy) {
    if (!enemy.exposed) return;
    enemy.exposed.turns -= 1;
    if (enemy.exposed.turns <= 0) enemy.exposed = null;
    this.updateEnemyStatus(enemy);
  }

  updateEnemyStatus(enemy) {
    const s = ui.enemyStatus;
    if (!enemy.exposed || enemy.hp <= 0) {
      enemy.statusText?.destroy();
      enemy.statusText = null;
      return;
    }
    if (!enemy.statusText) {
      enemy.statusText = this.add
        .text(enemy.container.x, enemy.label.y - enemy.label.height + s.offsetY, '', { fontFamily: ui.font, fontSize: `${s.fontSize}px`, color: s.color, stroke: s.stroke, strokeThickness: s.strokeThickness })
        .setOrigin(0.5, 1)
        .setDepth(layout.labelDepth);
    }
    enemy.statusText.setText(statuses[enemy.exposed.id].label.replace('{n}', enemy.exposed.turns));
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

  // The cut-in (Rhea's two lines in a band, systems/CutIn.js), then the screen warms to gold (and
  // the background becomes memory_city if it exists) and the minigame runs on the target:
  // recollection.json mode "beats" = HOLD / SWIPE / TAPS (systems/RecollectionBeats.js), "rings" =
  // the old three rhythm rings. Any success (and every rings run) ends him: the finisher, then
  // the kill (techniques.json recollection.kill). Three MISS: the memory slips (memorySlips).
  async playRecollection(hero, target) {
    const tech = techniques.recollection;
    const r = qte.recollection;
    const beats = recollection.mode !== 'rings';
    // Music: the Recollection track from the cut-in to the end of the attack (placement.overlay.recollection).
    if (musicPlan.overlay.recollection) playMusic(musicPlan.overlay.recollection.track);
    if (beats) {
      // Try again (after a failed memory) comes back to this moment.
      this.recollectionSnapshot = this.takeRecollectionSnapshot(hero, tech);
      if (dialogues[recollection.cutIn]) await new CutIn(this).play(dialogues[recollection.cutIn]);
    }

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
    if (!beats) playSfx('ultimate'); // the cut-in's band already played it
    setMusicWarm(true);
    const castDone = this.playCastLoop(hero);
    await this.wait(r.tint.fadeMs);

    let grade = null;
    if (beats) {
      const results = await runBeats(this, {
        cfg: recollection,
        windowMult: this.difficulty.windowMult,
        difficulty: this.difficultyId,
        swipe: qte.dodge.swipe,
        target,
        force: this.recollectionForce ?? null, // dev/QA only
        onResult: (result) => this.beatHit(target, result),
      });
      grade = gradeOf(results);
      if (grade) await this.recollectionFinisher(target, grade);
      else await this.memorySlips(hero, target);
    } else {
      this.tapHint.setVisible(true);
      await this.recollectionRings(target, tech);
      this.tapHint.setVisible(false);
    }
    // The memory ends it: the ultimate's kill is unconditional once it lands (techniques.json recollection.kill).
    if (tech.kill && target.hp > 0 && (grade || !beats)) this.killEnemy(target);
    castDone.stop();
    setMusicWarm(false);
    // Still fighting after the attack: back to the stage's track (a kill goes on to the Victory jingle).
    if (musicPlan.overlay.recollection && this.enemies.some((e) => e.hp > 0)) playMusic(this.battleMusic());

    this.tweens.add({ targets: overlay, fillAlpha: 0, duration: r.tint.fadeMs, onComplete: () => overlay.destroy() });
    if (memoryBg) this.tweens.add({ targets: [memoryBg, ...(memoryBg.edges || [])], alpha: 0, duration: r.tint.fadeMs, onComplete: () => memoryBg.destroy() });
    await this.wait(r.tint.fadeMs);
  }

  // One beat's feedback on the target: PERFECT / GOOD / MISS pop (gold / white / grey) and a hit
  // (flash + shake scaled by the result; no damage, the finisher decides).
  beatHit(target, result) {
    const cfg = recollection.results[result];
    const { x, y } = target.container;
    playSfx(cfg.sfx);
    Fx.popText(this, x, y, cfg.text, cfg.color, qte.text);
    if (result === 'MISS' || target.hp <= 0) return;
    Fx.flash(this, [target.body, ...Object.values(target.parts).map((p) => p.img)], 80);
    if (cfg.shake) Fx.shake(this, cfg.shake, cfg.shakeMs);
    if (cfg.sparks) Fx.sparks(this, x, y, cfg.sparks, { ...qte.sparks, color: recollection.colors.gold }, qte.ring.depth);
    this.playHurt(target);
  }

  // At least one beat landed: white-out, a burst of sparks, the kill under a hitstop, then the grade
  // (FLAWLESS / CLEAN / ROUGH) with its line. The result card shows the grade too (stats.recollectionGrade).
  async recollectionFinisher(target, grade) {
    const f = recollection.finisher;
    const g = recollection.grades[grade];
    this.stats.recollectionGrade = grade;
    Fx.screenFlash(this, f.flash, qte.flashDepth);
    Fx.sparks(this, target.container.x, target.container.y, f.sparks.count, f.sparks, qte.ring.depth);
    Fx.shake(this, f.shake, f.shakeMs);
    playSfx(f.sfx);
    vibrate(qte.results.PERFECT.vibrateMs);
    if (target.hp > 0) this.killEnemy(target);
    await Fx.hitstop(this, f.hitstopMs);
    const title = this.add
      .text(180, f.title.y, g.title, { fontFamily: ui.font, fontSize: `${f.title.fontSize}px`, color: g.color, stroke: f.title.stroke, strokeThickness: f.title.strokeThickness })
      .setOrigin(0.5)
      .setDepth(recollection.depth + 2)
      .setScale(f.title.popScale);
    const sub = this.add
      .text(180, f.sub.y, g.sub, { fontFamily: ui.font, fontSize: `${f.sub.fontSize}px`, color: f.sub.color, stroke: f.sub.stroke, strokeThickness: f.sub.strokeThickness })
      .setOrigin(0.5)
      .setDepth(recollection.depth + 2)
      .setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, duration: f.title.popMs, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: f.title.popMs, delay: f.title.popMs / 2 });
    await this.wait(f.holdMs);
    await this.tweenPromise([title, sub], { alpha: 0 }, f.fadeMs);
    title.destroy();
    sub.destroy();
  }

  // Three MISS: "The memory slips…". Her Echo is gone, he hangs on at his floor (1 HP) and his next
  // turn is the forced Unwriting (enemyAct): the party falls and the LOSE card offers Try again / Quit.
  async memorySlips(hero, target) {
    const f = recollection.fail;
    this.memoryFailed = true;
    hero.echo = 0;
    this.refreshHud();
    if (target.hp > 0) {
      target.hp = target.def.stages?.[target.phase || 0]?.floorHp ?? 1;
      this.updateLabel(target);
      target.forceNextAttack = f.forceAttack;
    }
    playSfx('miss');
    const text = this.add
      .text(180, f.y, f.text, { fontFamily: ui.font, fontSize: `${f.fontSize}px`, color: f.color, stroke: '#0b0d14', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(recollection.depth + 2)
      .setAlpha(0);
    await this.tweenPromise(text, { alpha: 1 }, qte.recollection.tint.fadeMs);
    await this.wait(f.holdMs);
    await this.tweenPromise(text, { alpha: 0 }, qte.recollection.tint.fadeMs);
    text.destroy();
  }

  // Unwriting (enemies.json `noInput`): a red ring on every living hero that nothing answers (a tap
  // or a swipe only shows NO ESCAPE), then attack.dmg to each of them.
  async playUnwriting(enemy, attack) {
    const heroes = this.heroes.filter((h) => h.hp > 0);
    if (!heroes.length) return;
    this.dropCharge(enemy);
    const red = qte.unparryable;
    const ne = recollection.noEscape;
    const ringCfg = { ...qte.ring, color: red.ringColor, targetColor: red.targetColor };
    this.noEscapeShown = 0; // QA reads it
    const shout = () => {
      this.noEscapeShown += 1;
      Fx.popText(this, heroes[0].container.x, heroes[0].container.y, ne.text, ne.color, qte.text);
    };
    this.input.on('pointerdown', shout);
    // A parry / dodge press answers nothing either: the same shout.
    const offKeys = [onAction(this, ['parry', 'dodge'], shout)];
    this.tapHint.setText(ne.text).setVisible(true);
    const restoreDepth = this.bringInFront(enemy, heroes[0]);
    try {
      while (true) {
        const rings = heroes.map((h) => Qte.runRing(this, { x: h.container.x, y: h.container.y + qte.ring.offsetY, telegraphMs: attack.telegraphMs, windows: this.parryWindows(), ring: ringCfg, unparryable: true, noInput: true }));
        const icons = heroes.map((h) => this.showUnparryableIcon(h.container.x, h.container.y + qte.ring.offsetY));
        if (attack.sfx) playSfx(attack.sfx);
        const abort = { aborted: false };
        const sheet = this.enemyAttackSheet(enemy, attack, 1);
        const attackDone = sheet ? sheet.strike(0, rings[0].impactAt, abort, 0) : this.playLungeTelegraph(enemy, rings[0].impactAt, abort);
        const outcomes = await Promise.all(rings.map((r) => r.promise));
        icons.forEach((i) => i.destroy());
        if (outcomes.some((o) => o.result === 'INTERRUPTED')) {
          rings.forEach((r) => r.interrupt());
          abort.aborted = true;
          sheet?.abort();
          await this.resumeGate;
          await attackDone;
          continue;
        }
        Fx.screenFlash(this, qte.results.MISS.flash, qte.flashDepth);
        for (const h of heroes) if (h.hp > 0) this.applyHit(h, attack.dmg, ne.color);
        await attackDone;
        if (sheet) await sheet.finish();
        break;
      }
    } finally {
      this.input.off('pointerdown', shout);
      offKeys.forEach((off) => off());
      this.tapHint.setText(tx(qte.hint)).setVisible(false);
      restoreDepth();
    }
  }

  // What Try again restores: the party (Rhea with the Echo she just spent), every enemy (stage, HP,
  // poise, unlocks), statuses, flags, fired events and the running stats. Also the stage
  // checkpoint (riseStage), called without a hero: every Echo stays as it is.
  takeRecollectionSnapshot(hero = null, tech = null) {
    return {
      heroes: this.heroes.map((h) => ({ hp: h.hp, maxHp: h.maxHp, echoMax: h.echoMax, echo: h === hero ? Math.min(h.echoMax, h.echo + tech.cost) : h.echo, statuses: JSON.parse(JSON.stringify(h.statuses || {})) })),
      enemies: this.enemies.map((e) => ({ phase: e.phase || 0, hp: e.hp, maxHp: e.maxHp, poise: e.poise, recollectionUnlocked: !!e.recollectionUnlocked, turnsInPhase: e.turnsInPhase || 0, attacked: !!e.attacked, attackCount: e.attackCount || 0, released: e.released || null, floorHits: e.floorHits || 0, exposed: e.exposed ? { ...e.exposed } : null })),
      flags: [...this.flags],
      firedEvents: [...this.firedEvents],
      counters: { ...this.counters },
      stats: { ...this.stats },
      chain: this.chain,
      maxChain: this.maxChain,
      nalaUsed: this.nala ? this.nala.used : null,
      nalaUsesLeft: this.nala ? this.nala.usesLeft : null,
      nalaGlow: this.nala ? { on: this.nala.glowOn, cd: this.nala.glowCd } : null,
    };
  }

  // A stage checkpoint as applyRewind takes it: the party back on its feet at full HP and
  // statuses cleared when battleEvents.stage.checkpoint says so (Echo as it was at the rise).
  checkpointState(snap) {
    const c = battleEvents.stage.checkpoint || {};
    const heroes = snap.heroes.map((h) => ({ ...h, hp: c.fullParty ? h.maxHp : h.hp, statuses: c.clearStatuses ? {} : h.statuses }));
    return { ...snap, heroes };
  }

  // A fresh build puts the snapshot back (Try again, see rewind()).
  applyRewind(snap) {
    snap.heroes.forEach((s, i) => {
      const h = this.heroes[i];
      if (!h) return;
      Object.assign(h, { hp: s.hp, maxHp: s.maxHp, echoMax: s.echoMax, echo: s.echo, statuses: JSON.parse(JSON.stringify(s.statuses)) });
      if (h.hp <= 0) this.markDown(h, true);
    });
    snap.enemies.forEach((s, i) => {
      const e = this.enemies[i];
      if (!e) return;
      const { poise, ...rest } = s;
      Object.assign(e, rest);
      if (e.maxPoise && poise !== undefined) {
        e.poise = poise;
        e.poiseBar?.set(poise);
      }
      const stage = e.def.stages?.[e.phase];
      if (e.phase > 0 && stage) this.applyStageLook(e, stage);
      this.updateLabel(e);
      this.updateEnemyStatus(e);
    });
    this.flags = new Set(snap.flags);
    this.firedEvents = new Set(snap.firedEvents);
    this.counters = { ...snap.counters };
    this.stats = { ...snap.stats };
    this.chain = snap.chain;
    this.maxChain = snap.maxChain;
    if (this.nala) {
      this.nala.used = !!snap.nalaUsed;
      if (typeof snap.nalaUsesLeft === 'number') this.nala.usesLeft = snap.nalaUsesLeft;
    }
    if (this.nala && snap.nalaGlow) {
      this.nala.glowOn = snap.nalaGlow.on;
      this.nala.glowCd = snap.nalaGlow.cd;
      this.nalaRefreshGlow();
    }
    this.refreshHud();
  }

  // The rewound battle's first move: Rhea casts the Recollection again.
  async resumeRecollection() {
    const hero = this.heroes.find((h) => h.def.canUltimate && h.hp > 0);
    const target = this.enemies.find((e) => e.hp > 0);
    if (!hero || !target) return;
    this.spendEcho(hero, techniques.recollection.cost);
    const restoreDepth = this.bringInFront(hero, target);
    try {
      await this.playRecollection(hero, target);
    } finally {
      restoreDepth();
    }
  }

  // Dev/QA (window.__battle.forceRecollectionReady()): a staged boss jumps to its last stage at the
  // Recollection unlock HP, the Keepsake already burnt, Rhea at full Echo.
  forceRecollectionReady() {
    const e = this.enemies.find((x) => x.def.stages);
    if (!e) return;
    const last = e.def.stages.length - 1;
    const stage = e.def.stages[last];
    if ((e.phase || 0) !== last) {
      e.phase = last;
      e.turnsInPhase = 0;
      e.maxHp = this.stageMaxHp(e, stage);
      this.applyStageLook(e, stage);
    }
    // Just at the unlock point: the stage's recollectionAt hp, or its pct share of the max.
    const at = recollectionAtOf(stage);
    e.hp = Math.max(1, Math.min(at?.hp ?? e.maxHp, Math.floor((e.maxHp * (at?.pct ?? 100)) / 100)));
    e.recollectionUnlocked = true;
    this.updateLabel(e);
    const rhea = this.heroes.find((h) => h.def.canUltimate);
    if (!rhea) return;
    rhea.echoMax = Math.max(rhea.echoMax, battleEvents.keepsake_burn.echoMax || 0);
    rhea.echo = rhea.echoMax;
    this.castWhenReady = true;
    this.refreshHud();
  }

  // One ring at a time, each with its own "1/3" counter and feedback; the next
  // one starts intervalMs after the previous ring's impact, so they never
  // overlap. An app switch restarts the ring that was running. When a ring
  // kills the target, the remaining rings move to the next living enemy; with
  // none left the sequence ends early.
  async recollectionRings(target, tech) {
    const r = qte.recollection;
    const ringCfg = { ...qte.ring, color: r.ringColor, targetColor: r.ringColor };
    let x = target.container.x;
    let y = target.container.y + qte.ring.offsetY;
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
      if (target.hp <= 0) {
        const next = this.enemies.find((e) => e.hp > 0);
        if (!next) break;
        target = next;
        x = target.container.x;
        y = target.container.y + qte.ring.offsetY;
        counter.setPosition(x, y - qte.ring.startRadius - c.gap);
      }
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

  // Straight to 0 HP and down (the normal death path: a stage end rises, the last stage is the win).
  killEnemy(enemy) {
    enemy.hp = 0;
    this.updateLabel(enemy);
    this.markDown(enemy);
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
    if (target.hp > 0) this.applyHit(target, dmg, r.textColor, { poiseSource: 'ultimate' });
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
      // Drops the loop without playing <name>_out (something else takes over the sprite).
      cancel: () => {
        stopped = true;
      },
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

    // Battle events {parries: n}: a PERFECT or GOOD answered with a tap (not a dodge, not a reparry ring).
    if (!dodged && result !== 'MISS' && !hit.reparry) this.counters.parries += 1;

    // A PERFECT tap is dressed by the impact system below (word, flashes, sfx and buzz included).
    const big = result === 'PERFECT' && !dodged;
    if (cfg.text && !big) Fx.popText(this, x, y, cfg.text, cfg.color, qte.text);
    if (cfg.flash) Fx.screenFlash(this, cfg.flash, qte.flashDepth);
    // The prop lands (the Clerk's stamp), parried or not.
    if (hit.impactSfx) playSfx(hit.impactSfx);
    if (hit.unparryable && input === 'tap') Fx.popText(this, x, y + qte.text.riseY, qte.unparryable.tapText, qte.unparryable.tapColor, qte.text);
    if (!big) {
      playSfx(result.toLowerCase());
      vibrate(cfg.vibrateMs);
    }
    if (cfg.echo > 0) this.hints.show('echo');
    // Before the counter below, so a PERFECT's own counter already gets the new step.
    // A PERFECT dodge leaves the chain as it is (cfg.chain 0).
    if (cfg.chain !== 0) this.updateChain(result);
    // The hero who parried earns the Echo (their own reserve).
    this.gainEcho(hero, cfg.echo + (result === 'PERFECT' && !dodged ? effectTotal(this.fragments, 'perfectEchoBonus') : 0));
    if (result === 'PERFECT') this.stats.perfects += 1;
    // e.g. Siphon: a missed parry also drains the hero's Echo.
    if (result === 'MISS' && hit.onMiss?.echo) this.gainEcho(hero, hit.onMiss.echo);

    const storyMult = this.difficulty.damageMult;
    const braceMult = this.brace ? this.brace.damageMult : 1; // Brace holds for the whole enemy round
    let dmg = Math.round(baseDmg * cfg.damageMult * storyMult * braceMult);
    // enemies.json hit.maxHpPct: the hit can take at most that share of the hero's max HP (the Archive
    // never one-shots a healthy Dov, whatever the difficulty or a crit added).
    if (hit.maxHpPct !== undefined) dmg = Math.min(dmg, Math.floor(hero.maxHp * hit.maxHpPct));
    // Reactions (ART_BRIEF): PERFECT -> parry (the counter), GOOD -> dodge,
    // MISS -> hurt, each only if the character has that sheet.
    const dodge = (result === 'GOOD' || (result === 'PERFECT' && dodged)) && hero.hp > 0 && hasSheet(hero.anims, 'dodge');
    const hpBefore = hero.hp;
    const showCrit = !!hit.crit && dmg > 0;
    if (dmg > 0) this.applyHit(hero, dmg, undefined, { react: !dodge, type: showCrit ? 'crit' : null });
    if (showCrit) impact(this, 'critEnemy', { ...this.impactPoint(hero), text: crit.text, color: crit.color });
    // e.g. Siphon: the enemy keeps a share of the life it took (enemies.json lifesteal).
    if (hit.lifesteal && dmg > 0 && enemy.hp > 0) {
      this.healEnemy(enemy, Math.round(Math.min(dmg, hpBefore) * hit.lifesteal), battleEvents.lifesteal.text, battleEvents.lifesteal.color);
    }
    if (dodge && hero.hp > 0) this.playReaction(hero, 'dodge');
    // A successful dodge without a dodge sheet: a small sidestep away from the enemy and back.
    const sidestep = dodged && result !== 'MISS' && !dodge && hero.hp > 0 ? this.dodgeSidestep(hero) : null;
    if (dmg > 0 && this.brace) {
      Fx.popText(this, x, y + qte.text.riseY, this.brace.blockText, this.brace.color, qte.text);
      this.braceCounter(hero, enemy);
    }
    if (cfg.knockback && hero.hp > 0) Fx.knockback(this, hero.container, hero.facing === 'right' ? -cfg.knockback : cfg.knockback);
    // e.g. Redact: a missed parry also leaves a memory status.
    if (result === 'MISS' && hit.onMiss?.status && Math.random() < (hit.onMiss.chance ?? 1)) this.applyStatus(hero, hit.onMiss.status);

    let imp = null;
    if (big) {
      imp = impact(this, 'perfect', { x, y: y + qte.ring.offsetY, target: hero, text: cfg.text, color: cfg.color });
      await imp.done;
    } else if (result === 'PERFECT') {
      Fx.sparks(this, x, y + qte.ring.offsetY, cfg.sparks, qte.sparks, qte.ring.depth);
      if (cfg.hitstopMs) {
        Fx.shake(this, cfg.shake, cfg.hitstopMs * 2);
        await Fx.hitstop(this, cfg.hitstopMs);
      }
    }

    await sidestep;
    // A hero in Return to Sender answers any parry with the big counter
    // (a dodge isn't a parry).
    if (this.stance?.hero === hero) {
      await this.endStance(!dodged && result !== 'MISS' && hero.hp > 0, enemy, result);
      imp?.endSlow();
      return;
    }
    if (result === 'PERFECT' && cfg.counterDmg) {
      // A PERFECT on the riposte ring (the enemy parried a Strike, the hero parries the answer) returns it
      // hard: defend.reparry.counterDmg [min, max] (enemies.json) instead of the usual counter, with its pop.
      const rp = hit.reparry ? enemy.def.defend?.reparry : null;
      const big = rp?.counterDmg ? Phaser.Math.Between(rp.counterDmg[0], rp.counterDmg[1]) : null;
      if (big !== null) Fx.popText(this, enemy.container.x, enemy.container.y, battleEvents.defend.counterText, battleEvents.defend.counterColor, qte.text);
      await this.playCounter(hero, enemy, (big ?? cfg.counterDmg) + effectTotal(this.fragments, 'counterBonus'));
    }
    // The slow-mo of a PERFECT never reaches the next ring.
    imp?.endSlow();
  }

  // The impact point of an entity (impact.json): its centre, and the entity for the dust ring at its feet.
  impactPoint(entity) {
    if (!entity) return null;
    return { x: entity.container.x, y: entity.container.y, target: entity };
  }

  // Dev/QA (window.__battle.impact('perfect')): plays an impact.json preset at an entity (default: the first enemy).
  impact(name = 'perfect', entity = null, text = null) {
    const at = entity || this.enemies.find((e) => e.hp > 0) || this.heroes[0];
    return impact(this, name, { ...this.impactPoint(at), text: text ?? name.toUpperCase() });
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
    // Hollow rule: nothing touches a Hollow unless it carries Echo. A PERFECT parry's counter (and Return
    // to Sender's, and Blast / Tremor) carries it, so it goes through applyHit with no isImmune() check;
    // only a plain Strike is checked (playerStrike).
    const counter = () => {
      if (enemy.hp > 0) this.applyHit(enemy, dmg, undefined, { poiseSource: 'counter' });
    };
    if (!hasSheet(hero.anims, 'parry')) {
      trace(`fallback:parry:${hero.type}`);
      counter();
      return;
    }
    await playOnce(hero.body, hero.type, 'parry', hero.anims.parry, { onImpact: (i) => i === 0 && counter() });
    if (hero.hp > 0) playLoop(hero.body, hero.type, this.restAnim(hero));
  }

  // Echo is per hero. Gains show as a small teal "+N" over the pip they fill.
  // `raw` skips the difficulty's echoMult (the Keepsake fills Rhea whatever the difficulty).
  gainEcho(hero, amount, raw = false) {
    if (!amount || !hero) return;
    // A difficulty with echoMult < 1 earns Echo more slowly: the fraction
    // carries over, so half the gains still add up to whole pips.
    if (!raw && amount > 0 && this.difficulty.echoMult !== 1) {
      hero.echoFrac = (hero.echoFrac || 0) + amount * this.difficulty.echoMult;
      amount = Math.floor(hero.echoFrac);
      hero.echoFrac -= amount;
      if (!amount) return;
    }
    const before = hero.echo;
    hero.echo = Phaser.Math.Clamp(hero.echo + amount, 0, hero.echoMax);
    this.refreshHud();
    const gained = hero.echo - before;
    if (gained > 0) {
      playSfx('echo');
      const pip = this.hud.pipPosition(this.heroes.indexOf(hero), hero.echo - 1);
      Fx.damageNumber(this, pip.x, pip.y + ui.damageNumbers.echoOffsetY, `+${gained}`, null, 'echo');
    } else if (gained < 0) {
      // A drain (Siphon on a missed parry): a red "-2 Echo" over the hero, so the loss is not silent.
      const e = ui.hud.echo;
      Fx.popText(this, hero.container.x, hero.container.y, e.lossText.replace('{n}', -gained), e.lossColor, qte.text);
    }
  }

  spendEcho(hero, amount) {
    if (!amount || !hero) return;
    hero.echo = Math.max(0, hero.echo - amount);
    this.refreshHud();
  }

  // ---------- Techniques (techniques.json) ----------

  async runTechnique(hero, techId, target) {
    const tech = this.techOf(hero, techId);
    if (tech.type === 'blast') await this.playBlast(hero, target, tech, techId);
    else if (tech.type === 'counterStance') await this.startStance(hero, tech);
    else if (tech.type === 'heal') await this.playHeal(hero, tech, target);
    else if (tech.type === 'brace') await this.playBrace(hero, tech);
    else if (tech.type === 'quake') await this.playQuake(hero, tech, techId, target);
  }

  // Tremor (Dov): he slams the ground and the shockwave hits every living
  // enemy (Hollows too: it's an Echo move). One cast is one player hit for Echo.
  // At the levels where techniques.json tremor.target is "enemy" (Recall 1) it hits only the chosen one.
  async playQuake(hero, tech, techId, target = null) {
    await this.playMove(hero, tech.anims || ['cast'], () => {
      Fx.popText(this, hero.container.x, hero.container.y, tech.castText, tech.color, qte.text);
      Fx.shake(this, tech.shake, tech.shakeMs);
      Fx.screenFlash(this, tech.flash, qte.flashDepth);
      const targets = this.enemies.filter((e) => e.hp > 0 && (tech.target !== 'enemy' || !target || e === target));
      let landed = 0;
      for (const enemy of targets) {
        Fx.sparks(this, enemy.container.x, enemy.container.y + enemy.height / 2, tech.sparks.count, tech.sparks, ui.battleLayout.labelDepth);
        // enemies.json defend.dodge: rolled once per cast per enemy; a dodged enemy takes nothing.
        if (this.rollDodge(enemy, techId)) {
          this.popDefend(enemy, 'dodge');
          continue;
        }
        this.applyHit(enemy, Phaser.Math.Between(tech.dmg[0], tech.dmg[1]), undefined, { poiseSource: 'ability' });
        landed += 1;
      }
      if (landed) this.gainEcho(hero, tech.echoOnHit);
    });
  }

  // Blast: `hits` base bolts; every base bolt has a chance to crit, and a crit
  // fires ONE extra bolt (up to maxHits) that can never crit itself. With a blast
  // sheet the bolts fly while the anim holds its aim frame.
  // Echo: techniques never give Echo (no echoOnHit in techniques.json); gainEcho
  // ignores an undefined amount, so a technique may still define one.
  async playBlast(hero, target, tech, techId) {
    const base = Phaser.Math.Between(tech.hits[0], tech.hits[1]);
    let total = base;
    // enemies.json defend.dodge: rolled once per cast; the whole volley misses (the bolts still fly).
    const dodged = this.rollDodge(target, techId);
    // Recall 5 (techniques.json blast.aim): a timed tap on the aim ring adds critBonus to this cast.
    const aimed = tech.aimMinigame && tech.aim ? await this.blastAim(target, tech.aim) : false;
    const critChance = Math.max(tech.critChance, effectMax(this.fragments, 'blastCritChance')) + (aimed ? tech.aim.critBonus : 0);
    this.blastCritChance = critChance; // QA reads it (window.__battle)
    const fire = async () => {
      for (let i = 0; i < total && target.hp > 0; i++) {
        // Only a base bolt (i < base) rolls; the extra bolts it queued at the end never do.
        const crit = i < base && Math.random() < critChance && total < tech.maxHits;
        if (crit) total += 1;
        await this.fireBolt(hero, target, tech);
        if (dodged) {
          if (i === 0) this.popDefend(target, 'dodge');
          await this.wait(tech.boltIntervalMs);
          continue;
        }
        const dmg = Phaser.Math.Between(tech.dmg[0], tech.dmg[1]);
        this.applyHit(target, dmg, undefined, { type: crit ? 'crit' : 'normal', poiseSource: 'multiHit', crit });
        if (i === 0) this.gainEcho(hero, tech.echoOnHit);
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

  // Blast's aim ring (Recall 5): a gold reticle and a shrinking ring on the target. Tap only
  // (a swipe counts as a tap: runRing without `swipe` judges the touch-down). PERFECT or GOOD
  // within the parry windows = AIMED. The ring itself deals nothing.
  async blastAim(target, aim) {
    const x = target.container.x;
    const y = target.container.y + qte.ring.offsetY;
    const colour = aim.color.replace('#', '0x');
    const ringCfg = { ...qte.ring, color: colour, targetColor: colour };
    const r = qte.ring.endRadius;
    const reticle = this.add.graphics().setDepth(qte.ring.depth);
    reticle.lineStyle(qte.ring.lineWidth, Number(colour), 1);
    reticle.lineBetween(x - r - 6, y, x - r + 4, y).lineBetween(x + r - 4, y, x + r + 6, y);
    reticle.lineBetween(x, y - r - 6, x, y - r + 4).lineBetween(x, y + r - 4, x, y + r + 6);
    this.blastAiming = true; // QA / the bot read it
    let result;
    do {
      const ring = Qte.runRing(this, { x, y, telegraphMs: aim.ringMs, windows: this.parryWindows(), ring: ringCfg });
      ({ result } = await ring.promise);
      if (result === 'INTERRUPTED') await this.resumeGate;
    } while (result === 'INTERRUPTED');
    this.blastAiming = false;
    reticle.destroy();
    const aimed = result === 'PERFECT' || result === 'GOOD';
    if (aimed) {
      playSfx(result.toLowerCase());
      Fx.popText(this, x, y, aim.text, aim.color, qte.text);
      console.log(`${aim.text} (${result})`);
    }
    return aimed;
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
    // The container may be mirrored (negative scaleX) and enlarged (displayScale).
    const { scaleX, scaleY } = entity.container;
    return [x + (spawnPx[0] - size[0] / 2) * scaleX, y + (spawnPx[1] - size[1] / 2) * scaleY];
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
      this.applyHit(enemy, dmg, tech.color, { poiseSource: 'ability' });
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

  // Anchor: heals the hero chosen on the target cards. With no choice (one valid hero, the sim):
  // the one who needs it most, a downed ally first (if the technique can revive), then the
  // lowest HP share. The heal lands on the move's impact frame.
  async playHeal(hero, tech, chosen = null) {
    // The hero picked on the target cards; without one (a single valid hero, the sim) the
    // automatic choice.
    const candidates = this.heroes.filter((h) => h.hp > 0 || tech.canRevive);
    const target = chosen && candidates.includes(chosen) ? chosen : candidates.sort((a, b) => (a.hp > 0) - (b.hp > 0) || a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!target) return;

    const amount = tech.amount + effectTotal(this.fragments, 'anchorBonus');
    await this.playMove(hero, tech.anims || ['cast'], () => {
      // The number shown is what was really restored (for a revive, the revive HP).
      const before = Math.max(0, target.hp);
      if (target.hp <= 0) this.revive(target, Math.min(target.maxHp, amount));
      else target.hp = Math.min(target.maxHp, target.hp + amount);
      const healed = target.hp - before;
      Fx.damageNumber(this, target.container.x, target.container.y - 80, `${ui.heal.textPrefix}${healed}`, null, 'heal');
      // Anchor also clears the target's statuses (techniques.json clearStatuses, on unless a level turns it off).
      if (tech.clearStatuses !== false && this.clearStatuses(target)) Fx.popText(this, target.container.x, target.container.y, statuses.ui.clearedText, statuses.ui.clearedColor, qte.text);
      this.refreshHud();
    });
  }

  // Brace: the whole party takes reduced damage for the whole enemy round (until the enemy phase ends),
  // and every hit that lands on it gives Dov Echo and the attacker poise damage (braceCounter).
  // The caster holds the brace sheet's loop (brace_in -> loop) until endBrace.
  async playBrace(hero, tech) {
    const cast = () => {
      this.brace = tech;
      this.braceHero = hero;
      for (const h of this.heroes.filter((x) => x.hp > 0)) {
        Fx.popText(this, h.container.x, h.container.y, tech.castText, tech.color, qte.text);
      }
    };
    if (!tech.holdsRound || !hasSheet(hero.anims, 'brace')) {
      // No sheet to hold (or a one-attack Brace): the cast move, then the round-long bonus without a pose.
      await this.playMove(hero, tech.anims || ['cast'], cast);
      return;
    }
    if (hasSheet(hero.anims, 'brace_in')) await playOnce(hero.body, hero.type, 'brace_in', hero.anims.brace_in);
    if (hero.hp > 0) playLoop(hero.body, hero.type, 'brace');
    cast();
  }

  // A hit landed on the braced party (damage > 0): Dov takes it and gives back pressure.
  braceCounter(hero, enemy) {
    const b = this.brace;
    const dov = this.braceHero;
    if (b.echoPerHit && dov && dov.hp > 0) {
      this.gainEcho(dov, b.echoPerHit);
      Fx.popText(this, dov.container.x, dov.container.y + (dov === hero ? qte.text.riseY * 2 : 0), b.counterText, b.color, qte.text);
    }
    if (b.poisePerHit && enemy) this.hitPoise(enemy, b.poisePerHit);
  }

  // The enemy phase is over: the Brace ends and its holder stands up (brace_out, then idle).
  async endBrace() {
    const hero = this.braceHero;
    this.brace = null;
    this.braceHero = null;
    if (!hero || hero.hp <= 0) return;
    const key = animKey(hero.type, 'brace');
    if (hero.body.anims?.currentAnim?.key !== key) return;
    if (hasSheet(hero.anims, 'brace_out')) await playOnce(hero.body, hero.type, 'brace_out', hero.anims.brace_out);
    if (hero.hp > 0 && !this.brace) playLoop(hero.body, hero.type, 'idle');
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

  // While an attacker acts on a target it draws in front of it (normally
  // depth = feet line, so a lunge could pass behind the one it hits). Returns
  // the function that puts it back at its own depth.
  bringInFront(attacker, target) {
    const c = attacker.container;
    const base = c.depth;
    const over = target?.container?.depth;
    if (over !== undefined && base <= over) c.setDepth(over + layout.attackerDepthGap);
    return () => {
      if (c.active) c.setDepth(base);
    };
  }

  // ---------- Melee approach (ui.battleLayout.melee) ----------

  // Where a melee attacker stands to hit target: beside it (the facing side
  // of the target), feet on the target's feet line.
  meleeSpot(attacker, target) {
    const m = layout.melee;
    const dir = attacker.facing === 'right' ? 1 : -1;
    const x = target.container.x - dir * (target.reach + attacker.reach + m.gap);
    return { x: clampX(x, attacker.reach * 2), y: target.feetY - attacker.height / 2 };
  }

  // The idle bob tweens the container's y: stopped while the entity moves.
  pauseBob(entity) {
    if (entity.bobTween) entity.bobTween.stop();
  }

  resumeBob(entity) {
    if (entity.bobTween && entity.hp > 0) entity.bobTween = this.idleBob(entity.container);
  }

  async meleeApproach(attacker, target) {
    const spot = this.meleeSpot(attacker, target);
    this.pauseBob(attacker);
    await this.tweenPromise(attacker.container, spot, layout.melee.approachMs, 'Cubic.easeOut');
  }

  // Back to its own spot. A fallen attacker stays where it fell.
  // `force`: a hero struck down at the spot (by a riposte) still goes home.
  async meleeReturn(attacker, force = false) {
    if (attacker.hp <= 0 && !force) return;
    await this.tweenPromise(attacker.container, { x: attacker.restX, y: attacker.restY }, layout.melee.returnMs, 'Cubic.easeInOut');
    this.resumeBob(attacker);
  }

  async playerStrike(hero, target) {
    await this.meleeApproach(hero, target);

    // A Strike deals its damage once, on the first impact frame.
    // crit.json hero: a chance to hit harder (never against an immune target).
    const immune = this.isImmune(target, 'strike', hero);
    const isCrit = Math.random() < crit.hero.chance && !immune;
    const base = Phaser.Math.Between(hero.strike[0], hero.strike[1]);
    const dmg = isCrit ? Math.round(base * crit.hero.mult) : base;
    let parry = null;
    await this.playAttackAnim(hero, (i) => {
      if (i !== 0) return;
      if (immune) this.passThrough(target);
      else if (this.rollParry(target, 'strike')) parry = this.popDefend(target, 'parry');
      else {
        // Nala's Echo: the Strike wounds a Hollow it would have passed through.
        if (target.def.immune?.includes('strike')) Fx.popText(this, hero.container.x, hero.container.y, allies.nala.glowStrikeText, allies.nala.glowStrikeColor, qte.text);
        this.applyHit(target, dmg, undefined, { poiseSource: 'strike', type: isCrit ? 'crit' : null, crit: isCrit });
        if (isCrit) impact(this, 'crit', { ...this.impactPoint(target), text: crit.text, color: crit.color });
        this.gainEcho(hero, techniques.strike.echoOnHit);
      }
    });

    // A parried Strike deals nothing; the enemy answers at once, while the hero is still at the melee spot.
    if (parry) {
      await parry;
      // defend.onFirstDefend: the first block is explained before the riposte ring comes back.
      await this.flushDefendHook();
      if (hero.hp > 0 && target.hp > 0) await this.reparry(target, hero);
    }

    await this.meleeReturn(hero, true);
  }

  // ---------- Enemy defence (enemies.json "defend", qte.json enemyDefendChance) ----------

  // Never while dead, broken or charging (the guard is its own defence).
  canDefend(enemy) {
    return !!enemy.def.defend && enemy.hp > 0 && !enemy.broken && !enemy.charge;
  }

  // The difficulty's chance x the current stage's `defendChanceMult` (enemies.json stages; an enraged
  // Quill guards more). Story's 0 stays 0.
  rollDefend(enemy) {
    const mult = currentStage(enemy.def, enemy.phase)?.defendChanceMult ?? 1;
    return Math.random() < this.difficulty.enemyDefendChance * mult;
  }

  // kind = 'parry' | 'dodge'; techId = the technique id listed in def.defend[kind].
  // Called once per action (per enemy), at the moment the roll matters.
  rollDefendAs(enemy, kind, techId) {
    return this.canDefend(enemy) && !!enemy.def.defend[kind]?.includes(techId) && this.rollDefend(enemy);
  }

  rollParry(enemy, techId) {
    return this.rollDefendAs(enemy, 'parry', techId);
  }

  rollDodge(enemy, techId) {
    return this.rollDefendAs(enemy, 'dodge', techId);
  }

  // A story beat plus a tutorial pause the first time something happens in a battle: enemies.json
  // onFirstFeint (an attack that really feints) and defend.onFirstDefend (the enemy parries or dodges a
  // hero's move). hook = {dialogue, pause}, both optional; once per battle (it is a fired event, so a
  // Try again rewind remembers it), the pause once per run on top of that.
  async playEnemyHook(enemy, hook) {
    if (!hook) return;
    const key = `hook:${hook.dialogue || hook.pause}`;
    if (this.firedEvents.has(key) || this.battleOver) return;
    this.firedEvents.add(key);
    if (hook.dialogue && dialogues[hook.dialogue]) await this.playDialogueOverlay(hook.dialogue);
    if (hook.pause) await this.runPause(hook.pause, { enemy });
  }

  // popDefend queues defend.onFirstDefend; it plays at the next safe point (before the riposte ring of a
  // parried Strike, or when the hero's action is over, so a dodged volley is not interrupted).
  async flushDefendHook() {
    const enemy = this.pendingDefendHook;
    this.pendingDefendHook = null;
    if (enemy && enemy.hp > 0 && !this.battleOver) await this.playEnemyHook(enemy, enemy.def.defend.onFirstDefend);
  }

  // The defender's reaction sheet (clerk_parry / clerk_dodge) and the text over it.
  // Without the sheet it sidesteps away from the hero for a moment. Returns the reaction's promise.
  popDefend(enemy, kind) {
    const d = battleEvents.defend;
    const name = kind === 'parry' ? 'parry' : 'dodge';
    if (enemy.def.defend?.onFirstDefend) this.pendingDefendHook = enemy;
    Fx.popText(this, enemy.container.x, enemy.container.y, d[`${name}Text`], d.color, qte.text);
    if (hasSheet(enemy.anims, name)) return this.playReaction(enemy, name);
    trace(`fallback:${name}:${enemy.type}`);
    const c = enemy.container;
    const dir = enemy.facing === 'right' ? -1 : 1;
    return new Promise((resolve) => {
      this.tweens.add({ targets: c, x: c.x + dir * d.sidestepPx, duration: d.sidestepMs, yoyo: true, onComplete: resolve });
    });
  }

  // The riposte after a parried Strike: a ring on the hero, with its own telegraph and damage.
  // Judged like any enemy attack (PERFECT = the usual counter + Echo). The counter is applyHit
  // on the enemy, never a Strike, so it can't be parried in turn.
  async reparry(enemy, hero) {
    const rp = enemy.def.defend.reparry;
    const hit = { id: 'reparry', telegraphMs: rp.telegraphMs, dmg: rp.dmg, unparryable: false, reparry: true };
    // Not a counted player hit (applyHit would mark the PERFECT counter as one).
    const wasPlayerAction = this.playerAction;
    this.playerAction = false;
    const restoreDepth = this.bringInFront(enemy, hero);
    this.tapHint.setVisible(true);
    try {
      if (rp.melee) await this.meleeApproach(enemy, hero);
      await this.enemyHit(enemy, hero, hit, null, 0);
    } finally {
      this.tapHint.setVisible(false);
      if (rp.melee) await this.meleeReturn(enemy);
      restoreDepth();
      this.playerAction = wasPlayerAction;
    }
  }

  // enemies.json "immune": ["strike"] (Hollows): steel passes through like smoke.
  // `hero` (optional): a hero with the Echo Strike status (Nala's Glow) wounds a Strike-immune target.
  isImmune(target, techId, hero = null) {
    if (!target.def.immune?.includes(techId)) return false;
    return !(techId === 'strike' && this.echoStrikes(hero));
  }

  // An immune hit: no damage, no Echo, no poise. The body flickers and "IMMUNE" pops up.
  passThrough(target) {
    this.counters.immuneSeen = true;
    if (target.def.hollow) this.counters.hollowImmuneThisRound += 1;
    const s = techniques.strike;
    Fx.flash(this, [target.body, ...Object.values(target.parts).map((p) => p.img)], 60);
    Fx.popText(this, target.container.x, target.container.y, s.immuneText, s.immuneColor, qte.text);
    playSfx('miss');
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
  // poiseSource = which break.json weight applies ('strike'|'counter'|'ability'|'multiHit'|'ultimate',
  // null = none); the poise damage is the final damage x that weight (x critWeight on a crit).
  // A broken enemy takes break.damageMult.
  applyHit(target, dmg, color, { react = true, type = null, poiseSource = null, crit = false } = {}) {
    let kind = type;
    if (!target.isHero) dmg = this.chainDamage(dmg);
    if (target.broken) dmg = Math.round(dmg * brk.damageMult);
    // A charging enemy's guard absorbs part of the hit (and remembers how much).
    if (target.charge?.attack.guardMult) {
      const full = dmg;
      dmg = Math.round(dmg * target.charge.attack.guardMult);
      target.charge.mitigated += full - dmg;
      kind = kind || 'guarded';
    }
    if (target.exposed) dmg = Math.round(dmg * target.exposed.mult);
    if (!target.isHero) dmg = this.floorDamage(target, dmg);
    const images = [target.body, ...Object.values(target.parts).map((p) => p.img)];
    Fx.flash(this, images, 60);
    Fx.shake(this, 2, 80);
    Fx.damageNumber(this, target.container.x, target.container.y - 80, dmg, color, kind || (target.isHero ? 'hurt' : 'normal'));
    playSfx('hit');

    if (target.isHero) this.stats.damageTaken += Math.min(dmg, target.hp);
    else if (this.playerAction && dmg > 0) {
      this.actionLanded = true;
      if (target.def.hollow) this.counters.hollowDamageThisRound += 1;
    }
    target.hp = Math.max(0, target.hp - dmg);
    this.updateLabel(target);
    if (target.isHero) {
      this.refreshHud();
      // The party's state can unlock the Recollection too (stages recollectionAt, checkStage).
      for (const e of this.enemies) if (e.def.stages) this.checkStage(e);
    } else {
      this.checkPhase(target);
      if (poiseSource) this.hitPoise(target, dmg * brk.weights[poiseSource] * (crit ? brk.weights.critWeight : 1));
    }

    if (target.hp <= 0) this.markDown(target);
    else if (react) this.playHurt(target);
  }

  // A stage's `floorHp` (enemies.json stages), active once the Recollection is unlocked: no hit takes the
  // enemy below it (only killEnemy, the Recollection's kill, does). A clamped hit shows floorText, every 2nd time.
  floorDamage(enemy, dmg) {
    const stage = enemy.def.stages?.[enemy.phase || 0];
    if (stage?.floorHp === undefined || !enemy.recollectionUnlocked || enemy.hp - dmg >= stage.floorHp) return dmg;
    enemy.floorHits = (enemy.floorHits || 0) + 1;
    if (enemy.floorHits % 2 === 1) Fx.popText(this, enemy.container.x, enemy.container.y, battleEvents.stage.floorText, battleEvents.stage.floorColor, qte.text);
    return Math.max(0, enemy.hp - stage.floorHp);
  }

  // ---------- Memory statuses ----------

  // statuses.json: Redacted covers one of the hero's techniques, Fog hides the
  // command names. turns = the hero's own turns left (they tick after each turn).
  // A battle with "statuses": false (battles.json) never applies one: the
  // first fight teaches the parry, not FOG on a missed parry.
  applyStatus(hero, id) {
    const def = statuses[id];
    if (!def || !hero.isHero || hero.hp <= 0 || this.battleDef.statuses === false) return;
    let tech = hero.statuses[id]?.tech;
    if (def.effect === 'cover' && !tech) {
      const pool = hero.techniques;
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
  // statuses.json `cleansable: false` (Echo Strike) stays.
  clearStatuses(hero) {
    const ids = Object.keys(hero.statuses).filter((id) => statuses[id].cleansable !== false);
    if (!ids.length) return false;
    for (const id of ids) delete hero.statuses[id];
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
    if (enemy.poise <= brk.line.epsilon) {
      enemy.poise = 0;
      this.breakEnemy(enemy);
    }
  }

  // BROKEN: it skips its next action and takes extra damage until that turn is over.
  // Not awaited by callers: the hitstop at the end only freezes tweens for a beat.
  async breakEnemy(enemy) {
    const fx = brk.fx;
    enemy.broken = true;
    enemy.poiseBar.shatter();
    enemy.poiseBar.setBroken(true);
    const word = Fx.popText(this, enemy.container.x, enemy.container.y, fx.text, fx.color, { ...qte.text, fontSize: fx.fontSize, offsetY: fx.offsetY });
    word.setScale(fx.popScale);
    this.tweens.add({ targets: word, scale: 1, duration: fx.popMs, ease: 'Back.easeOut' });
    // The shake, flashes, sparks, lines, sfx and buzz are the impact.json 'break' preset (the word above stays).
    const imp = impact(this, 'break', this.impactPoint(enemy));
    // A BREAK is the one thing that stops a charge (the player finds this out).
    if (enemy.charge) {
      Fx.popText(this, enemy.container.x, enemy.container.y + qte.text.riseY, battleEvents.charge.brokenText, battleEvents.charge.textColor, qte.text);
      this.endCharge(enemy, true);
    }
    await imp.done;
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

    // INTERRUPTED (a battle event's endBattle): no Victory text unless
    // ui.battleEnd.interruptedText is set (empty = nothing drawn).
    const text = { WIN: cfg.victoryText, ERROR: cfg.errorText, INTERRUPTED: cfg.interruptedText ?? '' }[result] ?? cfg.loseText;
    const style = { fontFamily: ui.font, fontSize: `${cfg.fontSize}px`, color: cfg.color, stroke: cfg.stroke, strokeThickness: cfg.strokeThickness };
    const message = text
      ? this.add.text(180, cfg.textY, text, style).setOrigin(0.5).setDepth(cfg.depth).setAlpha(0)
      : null;
    if (message) this.tweens.add({ targets: message, alpha: 1, duration: cfg.fadeMs });
    this.showActiveHero(null);
    this.hints.hide();

    // Victory: a band across the scene, the word pops in, a short sting.
    if (result === 'WIN') {
      const v = ui.victory;
      const band = this.add.rectangle(180, cfg.textY, viewRect().w, v.band.h, Number(v.band.color), v.band.alpha).setDepth(cfg.depth - 1).setStrokeStyle(1, Number(v.band.lineColor));
      band.setScale(1, 0);
      this.tweens.add({ targets: band, scaleY: 1, duration: v.popMs / 2, ease: 'Cubic.easeOut' });
      if (message) {
        message.setScale(v.popScale);
        this.tweens.add({ targets: message, scale: 1, duration: v.popMs, ease: 'Back.easeOut' });
      }
      // Music: the battle track fades under the Victory jingle (placement.events.battleWin).
      playOneShot(musicPlan.events.battleWin.oneShot, { resume: false });
    } else if (result === 'LOSE') {
      // Music: stopped; the Retry screen gets its own jingle (placement.events.retry).
      playOneShot(musicPlan.events.retry.oneShot, { resume: false });
    }

    // A short delay so the tap that ended the fight doesn't also skip this.
    this.time.delayedCall(cfg.inputDelayMs, () => {
      if (result === 'INTERRUPTED') {
        // No result card or grade: the Recall card, then the story goes on.
        this.showRecall().then(() => this.continueChapter());
        return;
      }
      if (result === 'WIN') {
        const stats = { ...this.stats, maxChain: this.maxChain };
        const partyHp = this.heroes.reduce((sum, h) => sum + h.maxHp, 0);
        const card = new ResultCard(this, this.battleId, stats, partyHp);
        recordBattle(this.registry, this.battleId, card.result);
        card
          .show()
          .then(() => card.hide())
          .then(() => this.showDrops())
          .then(() => this.showRecall())
          .then(() => this.continueChapter());
        return;
      }
      // Lost after a memory slipped (the Unwriting): Try again rewinds to the Recollection, or Quit.
      if (result === 'LOSE' && this.memoryFailed && this.recollectionSnapshot) {
        const items = [
          { slot: 'retryRecollection', label: cfg.retryRecollectionText, value: 'rewind' },
          { slot: 'quit', label: cfg.quitText, value: 'quit' },
        ];
        this.menu.show(items).then((choice) => (choice === 'quit' ? this.quitToMenu() : this.rewind()));
        return;
      }
      // Lost after the boss rose into a checkpoint stage: Retry (from the start) or Retry from here.
      if (result === 'LOSE' && this.stageSnapshot) {
        const items = [
          { slot: 'retryRecollection', label: cfg.retryText, value: 'retry' },
          { slot: 'retryStage', label: cfg.retryStageText, value: 'checkpoint' },
        ];
        this.menu.show(items).then((choice) => (choice === 'checkpoint' ? this.retryStage() : this.retry()));
        return;
      }
      this.menu.show([{ slot: 'retry', label: cfg.retryText, value: 'retry' }]).then(() => this.retry());
    });
  }

  // Memories dropped by the enemy types that fell in this battle (fragments.json
  // `drops`): a drop card each, kept for the run. Not after an interrupted end.
  async showDrops() {
    const ids = dropsFor(this.enemies.filter((e) => e.hp <= 0).map((e) => e.type), ownedFragments(this.registry));
    for (const id of ids) {
      this.registry.set('fragments', [...(this.registry.get('fragments') || []), id]);
      await new DropCard(this, id).show();
    }
  }

  // Recall (levels.json): the fallen enemies' Memories go to the party, and
  // the Recall card shows what they brought back. Only a win gives Memories.
  showRecall() {
    const to = this.recallXp + battleXp(this.battleDef.enemies, enemies);
    this.registry.set('recallXp', to);
    const card = new RecallCard(this, this.recallXp, to, this.heroes);
    // Music: a level gained plays the memory jingle over the card (placement.events.recallCard).
    if (card.ups.length) playOneShot(musicPlan.events.recallCard.oneShot, { resume: false });
    return card.show();
  }

  // Retry restarts the same battle from its starting state (full HP, starting Echo).
  retry() {
    const { rewind, checkpoint, ...data } = this.initData;
    this.scene.restart(data);
  }

  // Retry from here: the same battle, back at the moment the boss rose into its checkpoint stage.
  retryStage() {
    const { rewind, ...data } = this.initData;
    this.scene.restart({ ...data, checkpoint: this.stageSnapshot });
  }

  // Try again (after the Unwriting): the same battle, back at the moment the Recollection was cast.
  rewind() {
    this.scene.restart({ ...this.initData, rewind: this.recollectionSnapshot });
  }

  // Quit from the lose card: the run ends, back to the Menu (as the pause menu's Quit does).
  quitToMenu() {
    playMusic(null);
    for (const key of ui.pause.menu.quitScenes) {
      if (key !== this.scene.key && (this.scene.isActive(key) || this.scene.isPaused(key))) this.scene.stop(key);
    }
    this.registry.remove('runner');
    this.scene.start('Menu');
  }

  continueChapter() {
    const runner = this.registry.get('runner');
    if (runner) runner.next(this);
    else this.scene.start('Title');
  }
}

function pickWeighted(list) {
  const total = list.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const item of list) {
    r -= item.weight ?? 1;
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
