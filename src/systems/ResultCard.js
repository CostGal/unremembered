import grade from '../data/grade.json';
import qte from '../data/qte.json';
import ui from '../data/ui.json';
import { playSfx } from './Audio.js';
import * as Fx from './Fx.js';
import { computeGrade, rankIndex } from './Grade.js';

// Best rank per battle this session (memory only) and the one-time hint.
const bestRanks = {};
let hintShown = false;

const color = (hex) => Number(hex);

// The result card after a victory (grade.json): the battle's stats appear one
// by one, then the rank lands like a rubber stamp. A tap while it plays jumps
// to the stamp; a tap after that continues.
export default class ResultCard {
  // stats = {perfects, maxChain, damageTaken, turns}; partyHp = the heroes' total max HP.
  constructor(scene, battleId, stats, partyHp) {
    this.scene = scene;
    this.battleId = battleId;
    this.stats = stats;
    this.result = computeGrade({ ...stats, partyHp }, battleId, grade);
    this.rank = grade.ranks.find((r) => r.id === this.result.rank);
    this.timers = [];
    this.phase = 'rows'; // rows -> stamped -> ready
  }

  // Resolves when the player taps to continue.
  show() {
    return new Promise((resolve) => {
      this.build();
      const onTap = () => {
        if (this.phase === 'rows') this.stamp();
        else if (this.phase === 'ready') {
          this.scene.input.off('pointerdown', onTap);
          resolve();
        }
      };
      this.scene.input.on('pointerdown', onTap);
      this.scene.events.once('shutdown', () => this.scene.input.off('pointerdown', onTap));
    });
  }

  text(x, y, str, size, col, extra = {}) {
    return this.scene.add
      .text(x, y, str, { fontFamily: ui.font, fontSize: `${size}px`, color: col, ...extra })
      .setDepth(grade.card.depth + 1)
      .setAlpha(0);
  }

  build() {
    const scene = this.scene;
    const c = grade.card;
    this.items = [];
    const panel = scene.add
      .rectangle(c.x, c.y, c.w, c.h, color(c.fill), c.alpha)
      .setOrigin(0)
      .setStrokeStyle(1, color(c.stroke))
      .setDepth(c.depth)
      .setAlpha(0);
    scene.tweens.add({ targets: panel, alpha: 1, duration: c.fadeMs });
    this.items.push(panel);

    const title = this.text(c.title.x, c.title.y, c.title.text, c.title.fontSize, c.title.color).setOrigin(0, 0.5);
    scene.tweens.add({ targets: title, alpha: 1, duration: c.fadeMs });
    this.items.push(title);

    const r = c.rows;
    const values = {
      perfects: this.stats.perfects,
      maxChain: `${r.chainPrefix}${this.stats.maxChain}`,
      damageTaken: this.stats.damageTaken,
      turns: this.stats.turns,
    };
    this.rows = Object.keys(r.labels).map((key, i) => {
      const y = r.firstY + i * r.spacing;
      const label = this.text(r.x, y, r.labels[key], r.fontSize, r.color).setOrigin(0, 0.5);
      const value = this.text(r.valueX, y, String(values[key]), r.fontSize, r.valueColor).setOrigin(0, 0.5);
      this.items.push(label, value);
      return [label, value];
    });
    this.rows.forEach((pair, i) => {
      this.after(c.fadeMs + i * r.staggerMs, () => scene.tweens.add({ targets: pair, alpha: 1, duration: c.fadeMs / 2 }));
    });
    this.after(c.fadeMs + this.rows.length * r.staggerMs + grade.stamp.delayMs, () => this.stamp());
  }

  after(ms, fn) {
    this.timers.push(this.scene.time.delayedCall(ms, fn));
  }

  // The rank lands: scale 2 -> 1, a thud, shake and a puff of sparks.
  stamp() {
    if (this.phase !== 'rows') return;
    this.phase = 'stamped';
    this.timers.forEach((t) => t.remove());
    const scene = this.scene;
    const s = grade.stamp;
    const col = color(this.rank.color.replace('#', '0x'));
    for (const obj of this.rows.flat()) obj.setAlpha(1);

    const box = scene.add.graphics().lineStyle(s.lineWidth, col, 1).strokeRect(-s.boxW / 2, -s.boxH / 2, s.boxW, s.boxH);
    const letter = scene.add
      .text(0, 0, this.rank.id, { fontFamily: ui.font, fontSize: `${s.fontSize}px`, color: this.rank.color, stroke: s.stroke, strokeThickness: s.strokeThickness })
      .setOrigin(0.5);
    const stamp = scene.add
      .container(s.x, s.y, [box, letter])
      .setDepth(grade.card.depth + 2)
      .setAngle(s.angle)
      .setScale(s.startScale)
      .setAlpha(s.startAlpha);
    this.items.push(stamp);
    scene.tweens.add({
      targets: stamp,
      scale: 1,
      alpha: 1,
      duration: s.landMs,
      ease: 'Quad.easeIn',
      onComplete: () => {
        playSfx(s.sfx);
        Fx.shake(scene, s.shake, s.shakeMs);
        Fx.sparks(scene, s.x, s.y, s.sparks, { ...qte.sparks, color: col }, grade.card.depth + 2);
        this.afterStamp();
      },
    });
  }

  afterStamp() {
    const scene = this.scene;
    const c = grade.card;
    const { best, hint } = c;

    const prev = bestRanks[this.battleId];
    const better = prev === undefined || rankIndex(this.rank.id, grade) < rankIndex(prev, grade);
    if (prev !== undefined) {
      const t = this.text(best.x, best.y, better ? best.newText : best.text.replace('{rank}', prev), best.fontSize, better ? best.newColor : best.color).setOrigin(0.5);
      scene.tweens.add({ targets: t, alpha: 1, duration: c.fadeMs });
      this.items.push(t);
    }
    if (better) bestRanks[this.battleId] = this.rank.id;

    if (!hintShown) {
      hintShown = true;
      const h = this.text(hint.x, hint.y, grade.hint, hint.fontSize, hint.color, { wordWrap: { width: hint.wrap } }).setOrigin(0, 0.5);
      scene.tweens.add({ targets: h, alpha: 1, duration: c.fadeMs });
      this.items.push(h);
    }

    this.after(grade.continueDelayMs, () => {
      const b = ui.battleEnd;
      const go = scene.add
        .text(180, b.hintY, b.continueText, { fontFamily: ui.font, fontSize: `${b.hintFontSize}px`, color: b.hintColor })
        .setOrigin(0.5)
        .setDepth(c.depth + 1);
      scene.tweens.add({ targets: go, alpha: b.hintPulseAlpha, duration: b.hintPulseMs, yoyo: true, repeat: -1 });
      this.items.push(go);
      this.phase = 'ready';
    });
  }
}
