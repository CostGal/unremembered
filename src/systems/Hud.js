// Battle HUD: party status rows (name + HP bar) and the shared Echo bar.
// It only displays state. The battle owns HP/Echo and calls update(state).
import statuses from '../data/statuses.json';

const color = (hex) => Number(hex);

export default class Hud {
  // heroes: [{name, hp, maxHp}] in row order.
  constructor(scene, config, font, heroes) {
    this.scene = scene;
    this.cfg = config;
    this.font = font;

    const { panel } = config;
    scene.add
      .rectangle(panel.x, panel.y, panel.w, panel.h, color(panel.color))
      .setOrigin(0, 0)
      .setStrokeStyle(1, color(panel.borderColor));

    this.rows = heroes.map((hero, i) => this.buildRow(hero, config.rows.firstY + i * config.rows.spacing));
    this.buildEcho();
    this.buildChain();
  }

  text(x, y, str, size) {
    return this.scene.add.text(x, y, str, {
      fontFamily: this.font,
      fontSize: `${size}px`,
      color: this.cfg.textColor,
    });
  }

  buildRow(hero, y) {
    const { name, hpBar, hpText, lowHp } = this.cfg;
    // Low HP: a red frame around the bar that pulses (see setLow).
    const warn = this.scene.add
      .rectangle(hpBar.x - lowHp.pad, y, hpBar.w + lowHp.pad * 2, hpBar.h + lowHp.pad * 2, color(lowHp.color))
      .setOrigin(0, 0.5)
      .setAlpha(0);
    const bg = this.scene.add.rectangle(hpBar.x, y, hpBar.w, hpBar.h, color(hpBar.bgColor)).setOrigin(0, 0.5);
    const lag = this.scene.add.rectangle(hpBar.x, y, hpBar.w, hpBar.h, color(hpBar.lagColor)).setOrigin(0, 0.5);
    const fill = this.scene.add.rectangle(hpBar.x, y, hpBar.w, hpBar.h, color(hpBar.fillColor)).setOrigin(0, 0.5);
    const label = this.text(name.x, y, hero.name, name.fontSize).setOrigin(0, 0.5);
    const value = this.text(hpText.x, y, '', hpText.fontSize).setOrigin(1, 0.5);

    const row = { y, warn, bg, lag, fill, label, value, hp: hero.hp, maxHp: hero.maxHp, shown: { hp: hero.hp }, low: false, active: false, badges: [], badgeSig: '' };
    this.setBarWidths(row, hero.hp);
    this.setHpText(row, hero.hp);
    return row;
  }

  buildEcho() {
    const e = this.cfg.echo;
    this.text(e.labelX, e.y, e.label, e.labelFontSize).setOrigin(0, 0.5);

    this.pips = [];
    for (let i = 0; i < e.max; i++) {
      const x = e.pipX + i * (e.pipW + e.pipGap) + e.pipW / 2;
      const glow = this.scene.add
        .rectangle(x, e.y, e.pipW + e.glowPad * 2, e.pipH + e.glowPad * 2, color(e.fullColor))
        .setAlpha(0);
      const pip = this.scene.add.rectangle(x, e.y, e.pipW, e.pipH, color(e.emptyColor));
      this.pips.push({ pip, glow });
    }
    this.echo = 0;
    this.paintPips(0);
  }

  // "CHAIN xN" under the Echo bar: hidden at 0, pops on every step. Dropping
  // to 0 from a chain shakes the last value in red and fades it out.
  buildChain() {
    const c = this.cfg.chain;
    this.chainText = this.text(c.x, c.y, '', c.fontSize).setOrigin(0, 0.5).setAlpha(0);
    this.chainShown = 0;
  }

  setChain(n) {
    const c = this.cfg.chain;
    const text = this.chainText;
    const prev = this.chainShown;
    if (n === prev) return;
    this.chainShown = n;
    this.scene.tweens.killTweensOf(text);
    text.setX(c.x).setScale(1).setAlpha(1);

    if (n === 0) {
      text.setText(c.label.replace('{n}', prev)).setColor(c.breakColor);
      this.scene.tweens.add({ targets: text, x: c.x + c.shakePx, duration: c.shakeMs, yoyo: true, repeat: 3 });
      this.scene.tweens.add({ targets: text, alpha: 0, delay: c.breakFadeDelayMs, duration: c.breakFadeMs });
      return;
    }
    text.setText(c.label.replace('{n}', n)).setColor(c.color);
    this.scene.tweens.add({ targets: text, scale: { from: c.popScale, to: 1 }, duration: c.popMs, ease: 'Back.easeOut' });
  }

  // Where the chain label sits (for FX that burst from it).
  chainPosition() {
    const c = this.cfg.chain;
    return { x: c.x + this.chainText.width / 2, y: c.y };
  }

  // state: {heroes: [{hp, maxHp, statuses: [{id, turns}]}], echo}
  update(state) {
    state.heroes.forEach((hero, i) => this.updateRow(this.rows[i], hero));
    this.updateEcho(state.echo);
  }

  updateRow(row, hero) {
    if (!row) return;
    const { hpBar, rows } = this.cfg;
    const alpha = hero.hp > 0 ? 1 : rows.downedAlpha;
    for (const obj of [row.bg, row.lag, row.fill, row.label, row.value]) obj.setAlpha(alpha);
    this.setLow(row, hero.hp > 0 && hero.hp < hero.maxHp * this.cfg.lowHp.pct);
    this.setStatuses(row, hero.statuses || []);

    if (hero.hp === row.hp && hero.maxHp === row.maxHp) return;
    const dropped = hero.hp < row.hp;
    row.hp = hero.hp;
    row.maxHp = hero.maxHp;

    const target = this.barWidth(row, hero.hp);
    this.scene.tweens.killTweensOf([row.fill, row.lag, row.shown]);

    this.scene.tweens.add({ targets: row.fill, width: target, duration: hpBar.tweenMs, ease: 'Cubic.easeOut' });
    if (dropped) {
      // The lost chunk lingers in a light bar, then drains.
      this.scene.tweens.add({
        targets: row.lag,
        width: target,
        delay: hpBar.lagDelayMs,
        duration: hpBar.lagTweenMs,
        ease: 'Cubic.easeIn',
      });
    } else {
      row.lag.width = target;
    }

    this.scene.tweens.add({
      targets: row.shown,
      hp: hero.hp,
      duration: hpBar.tweenMs,
      onUpdate: () => this.setHpText(row, Math.round(row.shown.hp)),
      onComplete: () => this.setHpText(row, hero.hp),
    });
  }

  // Status badges (statuses.json) at the end of the HP bar: the status's letter
  // and its remaining turns, in its colour. Rebuilt when they change.
  setStatuses(row, list) {
    const sig = list.map((s) => `${s.id}:${s.turns}`).join(',');
    if (sig === row.badgeSig) return;
    row.badgeSig = sig;
    for (const obj of row.badges) obj.destroy();
    const b = this.cfg.statusBadge;
    row.badges = list.flatMap((s, i) => {
      const def = statuses[s.id];
      const x = b.x + i * (b.w + b.gap);
      const box = this.scene.add.rectangle(x, row.y, b.w, b.h, color(b.fill)).setOrigin(0, 0.5).setStrokeStyle(1, color(def.color.replace('#', '0x')), b.strokeAlpha);
      const text = this.text(x + b.w / 2, row.y, `${def.short}${s.turns}`, b.fontSize).setOrigin(0.5).setColor(def.color);
      this.scene.tweens.add({ targets: [box, text], scale: { from: b.popScale, to: 1 }, duration: b.popMs, ease: 'Back.easeOut' });
      return [box, text];
    });
  }

  // Under lowHp.pct the bar's red frame pulses and the name turns red.
  setLow(row, low) {
    if (low === row.low) return;
    row.low = low;
    const l = this.cfg.lowHp;
    if (row.lowTween) row.lowTween.stop();
    row.lowTween = null;
    row.warn.setAlpha(0);
    if (low) row.lowTween = this.scene.tweens.add({ targets: row.warn, alpha: { from: l.alphaMin, to: l.alphaMax }, duration: l.pulseMs, yoyo: true, repeat: -1 });
    this.paintName(row);
  }

  // The hero whose turn it is gets a lit name (index -1 = nobody).
  setActive(index) {
    this.rows.forEach((row, i) => {
      row.active = i === index;
      this.paintName(row);
    });
  }

  paintName(row) {
    row.label.setColor(row.low ? this.cfg.lowHp.nameColor : row.active ? this.cfg.activeColor : this.cfg.textColor);
  }

  // Centre of Echo pip i (for "+N" numbers).
  pipPosition(i) {
    const { pip } = this.pips[Math.max(0, Math.min(this.pips.length - 1, i))];
    return { x: pip.x, y: pip.y };
  }

  barWidth(row, hp) {
    return row.maxHp > 0 ? (this.cfg.hpBar.w * Math.max(0, hp)) / row.maxHp : 0;
  }

  setBarWidths(row, hp) {
    row.fill.width = row.lag.width = this.barWidth(row, hp);
  }

  setHpText(row, hp) {
    row.value.setText(`${hp}/${row.maxHp}`);
  }

  updateEcho(value) {
    const e = this.cfg.echo;
    const next = Math.max(0, Math.min(e.max, value));
    if (next === this.echo) return;

    const lo = Math.min(this.echo, next);
    const hi = Math.max(this.echo, next);
    this.echo = next;
    this.paintPips(next);

    // The pips that changed pulse; gained ones fill one after another,
    // flashing white before they settle on teal.
    const gained = next > lo && hi === next;
    for (let i = lo; i < hi; i++) {
      const { pip } = this.pips[i];
      const delay = gained ? (i - lo) * e.fillStaggerMs : 0;
      this.scene.tweens.killTweensOf(pip);
      pip.setScale(1);
      this.scene.tweens.add({ targets: pip, scale: e.pulseScale, delay, duration: e.pulseMs, yoyo: true, ease: 'Quad.easeOut' });
      if (!gained) continue;
      pip.setFillStyle(color(e.emptyColor)).setStrokeStyle(1, color(e.emptyStroke));
      this.scene.time.delayedCall(delay, () => {
        if (i < this.echo) pip.setFillStyle(color(e.flashColor)).setStrokeStyle();
      });
      this.scene.time.delayedCall(delay + e.pulseMs, () => {
        if (i < this.echo) pip.setFillStyle(color(e.fullColor));
      });
    }

    this.setGlow(next === e.max);
  }

  paintPips(value) {
    const e = this.cfg.echo;
    this.pips.forEach(({ pip }, i) => {
      if (i < value) pip.setFillStyle(color(e.fullColor)).setStrokeStyle();
      else pip.setFillStyle(color(e.emptyColor)).setStrokeStyle(1, color(e.emptyStroke));
    });
  }

  setGlow(on) {
    const e = this.cfg.echo;
    const glows = this.pips.map((p) => p.glow);
    this.scene.tweens.killTweensOf(glows);
    if (!on) {
      for (const g of glows) g.setAlpha(0);
      return;
    }
    for (const g of glows) g.setAlpha(e.glowAlphaMin);
    this.scene.tweens.add({
      targets: glows,
      alpha: e.glowAlphaMax,
      duration: e.glowPeriodMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // Dev only: invisible tap zones over each hero row and the Echo row.
  enableDebugTaps({ onHeroTap, onEchoTap }) {
    const { panel, rows, echo } = this.cfg;
    const zone = (y, cb) =>
      this.scene.add
        .zone(panel.x, y - rows.spacing / 2, panel.w, rows.spacing)
        .setOrigin(0, 0)
        .setInteractive()
        .on('pointerdown', cb);

    this.rows.forEach((row, i) => zone(row.y, () => onHeroTap(i)));
    zone(echo.y, onEchoTap);
  }
}
