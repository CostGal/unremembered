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

// Shows the ring at (x, y) and resolves with {result, dtMs, input} once the tap
// is judged: at T for an early tap, at the tap for a late one, at T + goodMs if
// there is no tap (MISS). 'CANCEL' (Nala) and 'INTERRUPTED' (app hidden, see
// interruptRings) are never judgements. impactAt = the performance.now() time of T.
// feint = {atPct, pauseMs, resumeSpeed = 1}: the ring freezes at atPct of its
// travel for pauseMs, then covers the rest resumeSpeed times faster:
// T = start + atPct*tele + pauseMs + (1 - atPct)*tele/resumeSpeed.
// swipe = {minPx, maxMs} (enemy attacks only): a gesture that travels minPx
// within maxMs is a dodge (input 'swipe'), anything else a parry ('tap'). Both
// are judged on the touch-down time. unparryable: a tap is always a MISS, only
// a swipe can answer, so the result waits until the gesture is classified.
// On a parryable ring every touch is a parry, judged and shown at T (a parry
// beats a dodge for the player, and the feedback never waits for finger-up).
// onImpact: called once at T when no tap has come yet (the hit visibly lands;
// a late tap can still make it a GOOD).
export function runRing(scene, { x, y, telegraphMs, feint, windows, ring, swipe = null, unparryable = false, onImpact = null }) {
  const start = performance.now();
  const pauseAt = feint ? feint.atPct * telegraphMs : Infinity;
  const pauseMs = feint ? feint.pauseMs : 0;
  const resumeSpeed = feint ? feint.resumeSpeed ?? 1 : 1;
  const impactAt = start + telegraphMs + pauseMs + (feint ? (telegraphMs - pauseAt) / resumeSpeed - (telegraphMs - pauseAt) : 0);

  const g = scene.add.graphics().setDepth(ring.depth);
  const target = Number(ring.targetColor);
  const color = Number(ring.color);

  let radiusNow = ring.startRadius; // current ring radius (QA reads it)
  let cancel = () => {};
  let interrupt = () => {};
  const promise = new Promise((resolve) => {
    let judged = null;
    let impacted = false;

    const onDown = (pointer) => {
      if (judged) return;
      const time = tapTime(pointer);
      // Overlapping rings (Recollection): a tap counts for one ring only.
      if (pointer.qteUsedAt === pointer.downTime) return;
      const dtMs = time - impactAt;
      const result = judge(dtMs, windows);
      if (!result) return;
      judged = { result, dtMs, input: 'tap' };
      if (swipe && unparryable) judged.pending = { pointer, at: performance.now() };
      pointer.qteUsedAt = pointer.downTime;
    };

    // The gesture is a swipe or a tap: from here the judgement can resolve.
    const settle = (input) => {
      if (!judged?.pending) return;
      delete judged.pending;
      judged.input = input;
      if (input === 'tap' && unparryable) judged.result = 'MISS';
    };
    const isSwipe = (pointer) => pointer.getDistance() >= swipe.minPx && gestureMs(pointer) <= swipe.maxMs;
    const onMove = (pointer) => {
      if (judged?.pending?.pointer === pointer && isSwipe(pointer)) settle('swipe');
    };
    const onUp = (pointer) => {
      if (judged?.pending?.pointer === pointer) settle(isSwipe(pointer) ? 'swipe' : 'tap');
    };

    const detach = () => {
      liveRings(scene).delete(handle);
      scene.input.off('pointerdown', onDown);
      scene.input.off('pointermove', onMove);
      scene.input.off('pointerup', onUp);
      scene.events.off('update', onUpdate);
      scene.events.off('shutdown', detach);
    };

    const finish = (outcome) => {
      detach();
      // An interrupted ring vanishes at once: its fade would freeze with the paused scene.
      if (outcome.result === 'INTERRUPTED') g.destroy();
      else scene.tweens.add({ targets: g, alpha: 0, duration: ring.fadeMs, onComplete: () => g.destroy() });
      resolve(outcome);
    };

    const onUpdate = () => {
      const now = performance.now();
      const elapsed = now - start;
      // Before the freeze: linear. Frozen for pauseMs. After: the rest at resumeSpeed (1 = today's path).
      const travel = elapsed < pauseAt ? elapsed : Math.max(pauseAt, pauseAt + (elapsed - pauseAt - pauseMs) * resumeSpeed);
      const t = Math.min(1, travel / telegraphMs);
      const radius = ring.startRadius + (ring.endRadius - ring.startRadius) * t;
      radiusNow = radius;

      g.clear();
      g.lineStyle(ring.lineWidth, target, ring.targetAlpha);
      g.strokeCircle(x, y, ring.endRadius);
      g.lineStyle(ring.lineWidth, t >= 1 ? target : color, 1);
      g.strokeCircle(x, y, radius);

      // Held still past the swipe time: it was a tap.
      if (judged?.pending && now - judged.pending.at > swipe.maxMs) settle('tap');
      if (!judged && !impacted && now >= impactAt) {
        impacted = true;
        if (onImpact) onImpact();
      }
      if (judged && !judged.pending && now >= impactAt) finish(judged);
      else if (!judged && now > impactAt + windows.goodMs) finish({ result: 'MISS', dtMs: null, input: null });
    };

    // e.g. Nala cancels the attack: resolves at once with result 'CANCEL'.
    cancel = () => {
      if (judged?.result === 'CANCEL') return;
      judged = { result: 'CANCEL', dtMs: null };
      finish(judged);
    };

    // The app went to the background: the ring stops without a judgement
    // (even an early tap already waiting for T is dropped). The caller restarts it.
    interrupt = () => {
      if (judged?.result === 'CANCEL') return;
      judged = { result: 'INTERRUPTED', dtMs: null };
      finish(judged);
    };

    scene.input.on('pointerdown', onDown);
    if (swipe && unparryable) {
      scene.input.on('pointermove', onMove);
      scene.input.on('pointerup', onUp);
    }
    scene.events.on('update', onUpdate);
    // Leaving the scene mid-ring (e.g. a restart) must not leave listeners behind.
    scene.events.once('shutdown', detach);
    onUpdate();
  });

  const handle = { promise, impactAt, startAt: start, telegraphMs, unparryable, radius: () => radiusNow, cancel: () => cancel(), interrupt: () => interrupt() };
  liveRings(scene).add(handle);
  return handle;
}

// Stops every ring still running in the scene with result 'INTERRUPTED'.
export function interruptRings(scene) {
  for (const ring of [...liveRings(scene)]) ring.interrupt();
}

function liveRings(scene) {
  if (!scene.qteRings) scene.qteRings = new Set();
  return scene.qteRings;
}

// How long the pointer has been down (its last move or up vs its down).
function gestureMs(pointer) {
  const end = pointer.isDown ? pointer.moveTime : pointer.upTime;
  const ms = end - pointer.downTime;
  return Number.isFinite(ms) && ms >= 0 && ms < 1000 ? ms : 0;
}

// The pointer event's own timestamp is closest to the real touch. Fall back to
// now if the browser stamps events on a different clock.
function tapTime(pointer) {
  const now = performance.now();
  const stamp = pointer.downTime;
  return Number.isFinite(stamp) && Math.abs(now - stamp) < 1000 ? stamp : now;
}
