// Parry QTE: a ring shrinks around the target and closes at impact time T.
// The first counted tap anywhere is judged on |tap - T| (CLAUDE.md > Parry QTE).
// Ring and judgement both run on performance.now(), so dropped frames never
// shift T or the tap time.

// dtMs = tap - T. Returns 'PERFECT' | 'GOOD' | 'MISS', or null for a tap that is
// too early to count (no penalty).
export function judge(dtMs, windows) {
  if (dtMs < -windows.ignoreBeforeMs) return null;
  const off = Math.abs(dtMs);
  if (off <= windows.perfectMs) return 'PERFECT';
  if (off <= windows.goodMs) return 'GOOD';
  return 'MISS';
}

// Story Mode widens the timing windows; the early-ignore cutoff stays put.
export function scaledWindows(windows, mult) {
  return { ...windows, perfectMs: windows.perfectMs * mult, goodMs: windows.goodMs * mult };
}

// Shows the ring at (x, y) and resolves with {result, dtMs} once the tap is
// judged: at T for an early tap, at the tap for a late one, at T + goodMs if
// there is no tap (MISS). impactAt = the performance.now() time of T.
// feint = {atPct, pauseMs}: the ring freezes at atPct of its travel for
// pauseMs, so T moves pauseMs later.
export function runRing(scene, { x, y, telegraphMs, feint, windows, ring }) {
  const start = performance.now();
  const pauseAt = feint ? feint.atPct * telegraphMs : Infinity;
  const pauseMs = feint ? feint.pauseMs : 0;
  const impactAt = start + telegraphMs + pauseMs;

  const g = scene.add.graphics().setDepth(ring.depth);
  const target = Number(ring.targetColor);
  const color = Number(ring.color);

  let cancel = () => {};
  const promise = new Promise((resolve) => {
    let judged = null;

    const onDown = (pointer) => {
      if (judged) return;
      const time = tapTime(pointer);
      // Overlapping rings (Recollection): a tap counts for one ring only.
      if (pointer.qteUsedAt === pointer.downTime) return;
      const dtMs = time - impactAt;
      const result = judge(dtMs, windows);
      if (!result) return;
      judged = { result, dtMs };
      pointer.qteUsedAt = pointer.downTime;
    };

    const detach = () => {
      scene.input.off('pointerdown', onDown);
      scene.events.off('update', onUpdate);
      scene.events.off('shutdown', detach);
    };

    const finish = (outcome) => {
      detach();
      scene.tweens.add({ targets: g, alpha: 0, duration: ring.fadeMs, onComplete: () => g.destroy() });
      resolve(outcome);
    };

    const onUpdate = () => {
      const now = performance.now();
      const elapsed = now - start;
      const travel = elapsed < pauseAt ? elapsed : Math.max(pauseAt, elapsed - pauseMs);
      const t = Math.min(1, travel / telegraphMs);
      const radius = ring.startRadius + (ring.endRadius - ring.startRadius) * t;

      g.clear();
      g.lineStyle(ring.lineWidth, target, ring.targetAlpha);
      g.strokeCircle(x, y, ring.endRadius);
      g.lineStyle(ring.lineWidth, t >= 1 ? target : color, 1);
      g.strokeCircle(x, y, radius);

      if (judged && now >= impactAt) finish(judged);
      else if (!judged && now > impactAt + windows.goodMs) finish({ result: 'MISS', dtMs: null });
    };

    // e.g. Nala cancels the attack: resolves at once with result 'CANCEL'.
    cancel = () => {
      if (judged?.result === 'CANCEL') return;
      judged = { result: 'CANCEL', dtMs: null };
      finish(judged);
    };

    scene.input.on('pointerdown', onDown);
    scene.events.on('update', onUpdate);
    // Leaving the scene mid-ring (e.g. a restart) must not leave listeners behind.
    scene.events.once('shutdown', detach);
    onUpdate();
  });

  return { promise, impactAt, cancel: () => cancel() };
}

// The pointer event's own timestamp is closest to the real touch. Fall back to
// now if the browser stamps events on a different clock.
function tapTime(pointer) {
  const now = performance.now();
  const stamp = pointer.downTime;
  return Number.isFinite(stamp) && Math.abs(now - stamp) < 1000 ? stamp : now;
}
