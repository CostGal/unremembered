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
// perfectMult (default mult): the PERFECT window's own factor (qte.json difficulties.perfectWindowMult).
export function scaledWindows(windows, mult, perfectMult = mult) {
  return { ...windows, perfectMs: windows.perfectMs * perfectMult, goodMs: windows.goodMs * mult };
}

// Shows the ring at (x, y) and resolves with {result, dtMs, input} once the
// gesture is judged: at T for an early touch, once the gesture settles for a
// later one, at T + the widest good window if there is no touch (MISS).
// 'CANCEL' (Nala) and 'INTERRUPTED' (app hidden, see interruptRings) are never
// judgements. impactAt = the performance.now() time of T.
// feint = {atPct, pauseMs, resumeSpeed = 1}: the ring freezes at atPct of its
// travel for pauseMs, then covers the rest resumeSpeed times faster:
// T = start + atPct*tele + pauseMs + (1 - atPct)*tele/resumeSpeed.
//
// Input model (enemy attacks pass `swipe`; Recollection's rings don't and a
// touch there is just a tap): two gestures, one judgement.
//  - The judgement time is the touch-down, dt = down - T (a touch earlier than
//    T - ignoreBeforeMs is ignored, no penalty; it never becomes a judgement).
//  - The gesture is classified once it settles: pointer-up (tap), reaching
//    swipe.minPx within swipe.maxMs (swipe, at once on move), or swipe.maxMs of
//    holding (tap). Feedback follows the settle, never later than maxMs.
//  - tap = parry (input 'tap'), judged with `windows`.
//  - swipe = dodge (input 'swipe'): judged with `dodgeWindows` (the easier pair;
//    perfectMs/goodMs, the rest from `windows`) on a parryable ring, with the
//    normal `windows` on an unparryable one.
//  - unparryable: a tap is always a MISS; only a swipe can answer.
// A ring whose time ran out while a gesture is pending resolves as that gesture's
// judgement (it is never judged twice). It stays alive until T + the widest good
// window, so a late swipe still counts.
// onImpact: called once at T when no touch has come yet (the hit visibly lands;
// a late touch can still make it a GOOD).
// noInput (Quill's Unwriting): no gesture answers the ring; it always ends as a MISS.
export function runRing(scene, { x, y, telegraphMs, feint, windows, ring, swipe = null, unparryable = false, dodgeWindows = null, onImpact = null, noInput = false }) {
  const dodge = swipe && !unparryable && dodgeWindows ? { ...windows, ...dodgeWindows } : null;
  const missAfterMs = dodge ? Math.max(windows.goodMs, dodge.goodMs) : windows.goodMs;
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
      if (judged || noInput) return;
      const time = tapTime(pointer);
      // Overlapping rings (Recollection): a tap counts for one ring only.
      if (pointer.qteUsedAt === pointer.downTime) return;
      const dtMs = time - impactAt;
      const result = judge(dtMs, windows);
      if (!result) return;
      judged = { result, dtMs, input: 'tap' };
      if (swipe) judged.pending = { pointer, at: performance.now() };
      pointer.qteUsedAt = pointer.downTime;
    };

    // The gesture is a swipe or a tap: from here the judgement can resolve.
    const settle = (input) => {
      if (!judged?.pending) return;
      delete judged.pending;
      judged.input = input;
      if (input === 'tap' && unparryable) judged.result = 'MISS';
      else if (input === 'swipe' && dodge) judged.result = judge(judged.dtMs, dodge) ?? judged.result;
      resolveIfDue(performance.now());
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

    let finished = false;
    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      detach();
      // An interrupted ring vanishes at once: its fade would freeze with the paused scene.
      if (outcome.result === 'INTERRUPTED') g.destroy();
      else scene.tweens.add({ targets: g, alpha: 0, duration: ring.fadeMs, onComplete: () => g.destroy() });
      resolve(outcome);
    };

    // A settled judgement shows at T (an early touch waits for it), else at once.
    const resolveIfDue = (now) => {
      if (judged && !judged.pending && judged.result !== 'CANCEL' && judged.result !== 'INTERRUPTED' && now >= impactAt) finish(judged);
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
      if (finished) return;
      if (!judged && !impacted && now >= impactAt) {
        impacted = true;
        if (onImpact) onImpact();
      }
      if (judged) resolveIfDue(now);
      else if (now > impactAt + missAfterMs) finish({ result: 'MISS', dtMs: null, input: null });
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
    if (swipe) {
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

// The direction of a swipe ('up' | 'down' | 'left' | 'right', the dominant axis), or null
// while the gesture is not a swipe (shorter than swipe.minPx, or slower than swipe.maxMs).
export function swipeDirection(pointer, swipe) {
  if (pointer.getDistance() < swipe.minPx || gestureMs(pointer) > swipe.maxMs) return null;
  const dx = (pointer.isDown ? pointer.x : pointer.upX) - pointer.downX;
  const dy = (pointer.isDown ? pointer.y : pointer.upY) - pointer.downY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
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
