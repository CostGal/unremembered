// Battle HUD: party status rows (name + HP bar) and the shared Echo bar.
// It only displays state. The battle owns HP/Echo and calls update(state).

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
  }

  text(x, y, str, size) {
    return this.scene.add.text(x, y, str, {
      fontFamily: this.font,
      fontSize: `${size}px`,
      color: this.cfg.textColor,
    });
  }

  buildRow(hero, y) {
    const { name, hpBar, hpText } = this.cfg;
    const bg = this.scene.add.rectangle(hpBar.x, y, hpBar.w, hpBar.h, color(hpBar.bgColor)).setOrigin(0, 0.5);
    const lag = this.scene.add.rectangle(hpBar.x, y, hpBar.w, hpBar.h, color(hpBar.lagColor)).setOrigin(0, 0.5);
    const fill = this.scene.add.rectangle(hpBar.x, y, hpBar.w, hpBar.h, color(hpBar.fillColor)).setOrigin(0, 0.5);
    const label = this.text(name.x, y, hero.name, name.fontSize).setOrigin(0, 0.5);
    const value = this.text(hpText.x, y, '', hpText.fontSize).setOrigin(1, 0.5);

    const row = { y, bg, lag, fill, label, value, hp: hero.hp, maxHp: hero.maxHp, shown: { hp: hero.hp } };
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

  // state: {heroes: [{hp, maxHp}], echo}
  update(state) {
    state.heroes.forEach((hero, i) => this.updateRow(this.rows[i], hero));
    this.updateEcho(state.echo);
  }

  updateRow(row, hero) {
    if (!row) return;
    const { hpBar, rows } = this.cfg;
    const alpha = hero.hp > 0 ? 1 : rows.downedAlpha;
    for (const obj of [row.bg, row.lag, row.fill, row.label, row.value]) obj.setAlpha(alpha);

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

    // Pulse the pips that changed.
    for (let i = lo; i < hi; i++) {
      const { pip } = this.pips[i];
      this.scene.tweens.killTweensOf(pip);
      pip.setScale(1);
      this.scene.tweens.add({ targets: pip, scale: e.pulseScale, duration: e.pulseMs, yoyo: true, ease: 'Quad.easeOut' });
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
