import ui from '../data/ui.json';

const cfg = ui.tutorial;
// Each hint shows once per session (a Retry doesn't repeat them).
const shown = new Set();

// One-line tutorial banners (ui.json tutorial.hints), one at a time. They
// never block: the next tap anywhere dismisses the banner and still does
// what it does in the game; the banner also goes after maxMs, or when the
// battle calls done(id) because the player already did the thing.
export default class TutorialHints {
  constructor(scene, enabled) {
    this.scene = scene;
    this.enabled = enabled;
    this.current = null;
  }

  // A hint with "always": true also shows outside tutorial battles (a mechanic
  // that first appears later). Returns true if the hint is shown now. One at a time: while another
  // hint is up this one waits for its next chance (it isn't used up).
  show(id) {
    const hint = cfg.hints[id];
    if (!hint || (!this.enabled && !hint.always) || shown.has(id) || this.current) return false;
    shown.add(id);

    const b = cfg.banner;
    const scene = this.scene;
    const text = scene.add
      .text(b.x, b.y, hint.text, { fontFamily: ui.font, fontSize: `${b.fontSize}px`, color: b.color, align: 'center', wordWrap: { width: b.w - 24 } })
      .setOrigin(0.5)
      .setDepth(b.depth + 1);
    const box = scene.add
      .rectangle(b.x, b.y, b.w, text.height + b.padY * 2, Number(b.fill), b.alpha)
      .setStrokeStyle(1, Number(b.stroke))
      .setDepth(b.depth);
    const parts = [box, text];
    for (const p of parts) p.setAlpha(0);
    scene.tweens.add({ targets: parts, alpha: { from: 0, to: 1 }, duration: b.fadeMs });

    const current = { id, parts };
    this.current = current;
    const dismiss = () => {
      if (this.current === current) this.hide();
    };
    scene.time.delayedCall(b.dismissDelayMs, () => scene.input.once('pointerdown', dismiss));
    scene.time.delayedCall(b.maxMs, dismiss);
    return true;
  }

  // The player did what the hint asks: take it down if it's up.
  done(id) {
    if (this.current?.id === id) this.hide();
  }

  // The player already knows it: take it down if it's up and never show it.
  skip(id) {
    shown.add(id);
    this.done(id);
  }

  isShowing(id) {
    return this.current?.id === id;
  }

  hide() {
    const current = this.current;
    if (!current) return;
    this.current = null;
    this.scene.tweens.add({
      targets: current.parts,
      alpha: 0,
      duration: cfg.banner.fadeMs,
      onComplete: () => current.parts.forEach((p) => p.destroy()),
    });
  }
}
