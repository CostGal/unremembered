import levels from '../data/levels.json';
import techniques from '../data/techniques.json';
import ui from '../data/ui.json';
import { playSfx } from './Audio.js';
import * as Fx from './Fx.js';
import tutorial from '../data/tutorial.json';
import * as TutorialPause from './TutorialPause.js';
import { learnSteps } from './MoveHelp.js';
import { growth, levelFor, levelUps, maxLevel, techLevelOf, techniqueAt, xpForLevel } from './Recall.js';
import { onAction } from './Input.js';
import { tx } from './Prompts.js';

const color = (hex) => Number(hex);
const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// After the result card on a win (levels.json card): "+N Memories", the Recall
// bar fills (once per level gained), and for each new level the stat gains
// and what each hero remembers. A tap while it plays jumps to the end; a tap
// after that continues.
export default class RecallCard {
  // fromXp/toXp: the party's Memories before and after this battle.
  // cfg: the level table (levels.json; the Arena passes its own, same shape).
  constructor(scene, fromXp, toXp, heroes, cfg = levels) {
    this.scene = scene;
    this.cfg = cfg;
    this.fromXp = fromXp;
    this.toXp = toXp;
    this.heroes = heroes;
    this.ups = levelUps(fromXp, toXp, this.cfg, techniques);
    this.timers = [];
    this.items = [];
    this.lineY = this.cfg.card.lines.firstY;
    this.lineObjs = [];
    this.phase = 'filling'; // filling -> ending -> (paused) -> ready
    // Spotlight targets for the tutorial pause (tutorial.json recallCard): the level text and the bar.
    const c = this.cfg.card;
    if (scene.tutorialTargets) scene.tutorialTargets['recall.bar'] = { x: c.level.x, y: c.level.y - 10, w: c.bar.w, h: c.bar.y - c.level.y + 18 };
  }

  show() {
    return new Promise((resolve) => {
      this.build();
      let offConfirm = () => {};
      const onTap = () => {
        if (this.phase === 'filling') this.finish();
        else if (this.phase === 'ready') {
          this.scene.input.off('pointerdown', onTap);
          offConfirm();
          resolve();
        }
      };
      // The tap that closed the result card must not also skip this one.
      this.after(this.cfg.card.inputDelayMs, () => {
        this.scene.input.on('pointerdown', onTap);
        offConfirm = onAction(this.scene, 'confirm', onTap);
      });
      this.scene.events.once('shutdown', () => this.scene.input.off('pointerdown', onTap));
    });
  }

  text(x, y, str, size, col, extra = {}) {
    const t = this.scene.add
      .text(x, y, str, { fontFamily: ui.font, fontSize: `${size}px`, color: col, ...extra })
      .setDepth(this.cfg.card.depth + 1)
      .setAlpha(0);
    this.items.push(t);
    return t;
  }

  fadeIn(obj) {
    this.scene.tweens.add({ targets: obj, alpha: 1, duration: this.cfg.card.fadeMs });
  }

  after(ms, fn) {
    this.timers.push(this.scene.time.delayedCall(ms, fn));
  }

  build() {
    const scene = this.scene;
    const c = this.cfg.card;
    const t = this.cfg.text;
    const panel = scene.add.rectangle(c.x, c.y, c.w, c.h, color(c.fill), c.alpha).setOrigin(0).setStrokeStyle(1, color(c.stroke)).setDepth(c.depth).setAlpha(0);
    this.items.push(panel);
    this.fadeIn(panel);
    this.fadeIn(this.text(c.title.x, c.title.y, t.title, c.title.fontSize, c.title.color).setOrigin(0, 0.5));
    this.fadeIn(this.text(c.gain.x, c.gain.y, fill(t.memories, { n: this.toXp - this.fromXp }), c.gain.fontSize, c.gain.color).setOrigin(1, 0.5));

    const level = levelFor(this.fromXp, this.cfg);
    this.levelText = this.text(c.level.x, c.level.y, this.levelLabel(level), c.level.fontSize, c.level.color).setOrigin(0, 0.5);
    this.fadeIn(this.levelText);
    this.barBg = scene.add.rectangle(c.bar.x, c.bar.y, c.bar.w, c.bar.h, color(c.bar.bg)).setOrigin(0, 0.5).setDepth(c.depth + 1);
    this.bar = scene.add.rectangle(c.bar.x, c.bar.y, c.bar.w, c.bar.h, color(c.bar.fill)).setOrigin(0, 0.5).setDepth(c.depth + 1);
    this.items.push(this.barBg, this.bar);
    this.bar.scaleX = this.barPct(this.fromXp, level);

    this.after(c.fadeMs, () => this.fillFrom(level));
  }

  levelLabel(level) {
    return fill(this.cfg.text.level, { n: level }) + (level >= maxLevel(this.cfg) ? `  ${this.cfg.text.max}` : '');
  }

  // How full the bar is at xp, within `level`.
  barPct(xp, level) {
    if (level >= maxLevel(this.cfg)) return 1;
    const lo = xpForLevel(level, this.cfg);
    const hi = xpForLevel(level + 1, this.cfg);
    return Math.max(0, Math.min(1, (xp - lo) / (hi - lo)));
  }

  // Fills to the next level (then shows that level's gains) or to toXp.
  fillFrom(level) {
    if (this.phase !== 'filling') return;
    const c = this.cfg.card;
    const up = this.ups.find((u) => u.level === level + 1);
    const target = up ? 1 : this.barPct(this.toXp, level);
    this.tween = this.scene.tweens.add({
      targets: this.bar,
      scaleX: target,
      duration: c.bar.fillMs * Math.max(0.2, target - this.bar.scaleX),
      onComplete: () => {
        if (!up) return this.done();
        this.levelUp(up);
        this.bar.scaleX = up.level >= maxLevel(this.cfg) ? 1 : 0;
        this.after(c.lines.staggerMs * (this.linesFor(up).length + 1), () => this.fillFrom(up.level));
      },
    });
  }

  // "RECALL 2" pops, then the gains line by line.
  levelUp(up, instant = false) {
    const c = this.cfg.card;
    const l = c.levelUp;
    this.levelText.setText(this.levelLabel(up.level));
    if (!this.popText) this.popText = this.text(l.x, l.y, '', l.fontSize, l.color).setOrigin(1, 0.5);
    this.popText.setText(fill(this.cfg.text.levelUp, { n: up.level })).setAlpha(1);
    if (instant) this.popText.setScale(1);
    else {
      this.popText.setScale(l.popScale);
      this.scene.tweens.add({ targets: this.popText, scale: 1, duration: l.popMs, ease: 'Back.easeOut' });
      playSfx(l.sfx);
      Fx.shake(this.scene, l.shake, l.shakeMs);
    }
    this.linesFor(up).forEach((line, i) => {
      const show = () => {
        const obj = this.addLine(line);
        if (instant) obj.forEach((o) => o.setAlpha(1));
        else {
          obj.forEach((o) => this.fadeIn(o));
          playSfx(line.learn ? c.lines.learnSfx : c.lines.sfx);
        }
      };
      if (instant) show();
      else this.after(c.lines.staggerMs * (i + 1), show);
    });
  }

  // Per hero: "+6 HP +1 Strike", then each technique they remember (+ flavor).
  linesFor(up) {
    const t = this.cfg.text;
    const lines = [];
    for (const hero of this.heroes) {
      const now = growth(hero.type, up.level, this.cfg);
      const before = growth(hero.type, up.level - 1, this.cfg);
      const hp = now.hp - before.hp;
      const strike = now.strike - before.strike;
      // A level with HP and no Strike (the Arena's slower Strike growth) uses statsHp when the table has it.
      const tpl = !strike && t.statsHp ? t.statsHp : t.stats;
      if (hp || strike) lines.push({ text: fill(tpl, { hero: hero.name, hp, strike, strikeName: techniques.strike.name }) });
    }
    for (const hero of this.heroes) {
      for (const id of up.learned[hero.type] || []) {
        lines.push({ text: fill(t.remembers, { hero: hero.name, tech: techniques[id]?.name || id }), learn: true, flavor: this.cfg.flavor[id], pauseKey: id });
      }
    }
    for (const hero of this.heroes) {
      for (const id of up.upgraded?.[hero.type] || []) {
        lines.push({ text: fill(t.upgrade, { tech: techniques[id]?.name || id, detail: this.upgradeDetail(id, up.level) }), learn: true, pauseKey: `${id}_${up.level}` });
        // Anchor's revive switches on: its own line (this.cfg.json upgradeDetail.canRevive).
        if (!techniqueAt(id, techLevelOf(up.level - 1, this.cfg), techniques).canRevive && techniqueAt(id, techLevelOf(up.level, this.cfg), techniques).canRevive) {
          lines.push({ text: fill(this.cfg.upgradeDetail.canRevive, { tech: techniques[id]?.name || id }), learn: true });
        }
      }
    }
    return lines;
  }

  // What changed in a technique between two levels, from this.cfg.upgradeDetail
  // ("2 Echo, 3–3 bolts"): only the keys that differ, in that table's order.
  upgradeDetail(id, level) {
    const before = techniqueAt(id, techLevelOf(level - 1, this.cfg), techniques);
    const now = techniqueAt(id, techLevelOf(level, this.cfg), techniques);
    const d = this.cfg.upgradeDetail;
    const parts = [];
    for (const [key, str] of Object.entries(d)) {
      if (key === 'hitsSame' || key === 'canRevive') continue;
      if (JSON.stringify(before[key]) === JSON.stringify(now[key])) continue;
      const v = now[key];
      const vars = key === 'hits' ? { a: v[0], b: v[1] } : key === 'critChance' ? { pct: Math.round(v * 100) } : { n: v };
      parts.push(fill(key === 'hits' && v[0] === v[1] ? d.hitsSame : str, vars));
    }
    return parts.join(', ');
  }

  addLine(line) {
    const l = this.cfg.card.lines;
    const out = [this.text(l.x, this.lineY, line.text, l.fontSize, line.learn ? l.learnColor : l.color).setOrigin(0, 0.5)];
    this.lineObjs.push(out[0]);
    // The Recall-learn pauses spotlight this line (tutorial.json recallLearn).
    if (line.pauseKey && this.scene.tutorialTargets) {
      this.scene.tutorialTargets[`${tutorial.recallLearn.lineTarget}.${line.pauseKey}`] = { x: l.x, y: this.lineY - l.spacing / 2 + 1, w: this.cfg.card.w - (l.x - this.cfg.card.x) * 2, h: l.spacing - 2, pad: 4 };
    }
    this.lineY += line.flavor ? l.flavorSpacing : l.spacing;
    if (line.flavor) {
      const f = this.text(l.x, this.lineY, line.flavor, l.flavorFontSize, l.flavorColor, { fontStyle: 'italic', wordWrap: { width: l.wrap } }).setOrigin(0, 0);
      out.push(f);
      this.lineObjs.push(f);
      this.lineY += f.height + l.spacing / 2 + l.flavorGap;
    }
    return out;
  }

  // Tap while filling: every level's gains at once, bar at its final value.
  finish() {
    if (this.phase !== 'filling') return;
    this.timers.forEach((t) => t.remove());
    this.timers = [];
    if (this.tween) this.tween.stop();
    // Redraw the lines from scratch so none is missing or doubled.
    this.items = this.items.filter((o) => !this.lineObjs.includes(o));
    for (const obj of this.items) obj.setAlpha(1);
    this.lineObjs.forEach((o) => o.destroy());
    this.lineObjs = [];
    this.lineY = this.cfg.card.lines.firstY;
    for (const up of this.ups) this.levelUp(up, true);
    if (!this.ups.length && this.popText) this.popText.setAlpha(0);
    const level = levelFor(this.toXp, this.cfg);
    this.levelText.setText(this.levelLabel(level));
    this.bar.scaleX = this.barPct(this.toXp, level);
    this.done();
  }

  // One pause per move remembered (steps) or grown (upgrades[level]) on this card that the run has not
  // explained yet: pause id learn_<tech> / learn_<tech>_<level>, spotlight on that card line.
  async learnPauses() {
    const cfg = tutorial.recallLearn;
    if (!cfg?.enabled) return;
    this.phase = 'paused';
    for (const up of this.ups) {
      const jobs = [];
      for (const hero of this.heroes) {
        for (const id of up.learned[hero.type] || []) jobs.push({ key: id, id, upgrade: false });
        for (const id of up.upgraded?.[hero.type] || []) jobs.push({ key: `${id}_${up.level}`, id, upgrade: true });
      }
      for (const job of jobs) {
        const steps = learnSteps(job.id, up.level, job.upgrade);
        if (!steps) continue;
        const target = `${cfg.lineTarget}.${job.key}`;
        const def = { always: true, steps: steps.map((text) => ({ text, targets: [target] })) };
        await TutorialPause.show(this.scene, `${cfg.idPrefix}${job.key}`, {}, {}, def);
      }
    }
  }

  done() {
    if (this.phase !== 'filling') return;
    this.phase = 'ending';
    const b = ui.battleEnd;
    this.after(this.cfg.card.fadeMs, async () => {
      // The Recall card's tutorial pause (the first card of the run): the card is still, the bar drawn.
      if (tutorial.recallCard && TutorialPause.wouldShow(this.scene, tutorial.recallCard)) {
        this.phase = 'paused';
        await TutorialPause.show(this.scene, tutorial.recallCard);
      }
      await this.learnPauses();
      this.phase = 'ready';
      const go = this.scene.add
        .text(180, b.hintY, tx(b, 'continueText'), { fontFamily: ui.font, fontSize: `${b.hintFontSize}px`, color: b.hintColor })
        .setOrigin(0.5)
        .setDepth(this.cfg.card.depth + 1);
      this.scene.tweens.add({ targets: go, alpha: b.hintPulseAlpha, duration: b.hintPulseMs, yoyo: true, repeat: -1 });
      this.items.push(go);
    });
  }
}
