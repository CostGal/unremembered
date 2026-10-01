import music from '../data/music.json';
import { STEPS, compileTrack } from './MusicData.js';

// Procedural music: tracks are data (data/music.json), played by a lookahead
// scheduler on the shared AudioContext. Instruments are oscillators / noise /
// filters / envelopes; no files. systems/Audio.js picks this when
// public/assets/audio/music/<key>.mp3 does not exist.
//
//   engine = new MusicEngine(ctx, destinationNode)
//   track  = engine.play('battle', fadeSec)      // crossfade: engine.stop(old, fadeSec)
//   track.setIntensity(0..1)  track.setWarm(true) // boss phase 2 / Recollection
//
// Cost control: patterns are compiled once; the scheduler tick allocates
// nothing but the audio nodes of the notes it fires; at most engine.maxVoices
// notes sound at once (essential ones — bass, kick, pad — always get one).

const cfg = music.engine;
export const engineConfig = cfg; // tests / tuning scripts may adjust it before a render
const HZ = Float32Array.from({ length: 128 }, (_, m) => 440 * Math.pow(2, (m - 69) / 12));
const hz = (m) => HZ[Math.max(0, Math.min(127, Math.round(m)))];
const SILENT = 0.0001;
const ESSENTIAL = new Set(['bass', 'kick', 'snare', 'pad', 'swell']);

const compiled = new Map();

function compile(key) {
  if (!compiled.has(key)) compiled.set(key, compileTrack(music, key));
  return compiled.get(key);
}

export function hasTrack(key) {
  return !!music.tracks[key];
}

export function trackKeys() {
  return Object.keys(music.tracks);
}

// Length of one loop of a track, in seconds.
export function trackSeconds(key) {
  const c = compile(key);
  return (c.bars.length * STEPS * 60) / c.def.bpm / 4;
}

// ---------- Engine: shared bus, reverb, delay, scheduler timer ----------

export class MusicEngine {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = cfg.gain;
    this.bus.connect(destination);
    this.tracks = new Set();
    this.timer = null;
    this.voiceEnds = new Float64Array(cfg.maxVoices);
    this.stats = { notes: 0, dropped: 0, ticks: 0, tickMs: 0, maxTickMs: 0 };

    this.reverbIn = null;
    if (cfg.reverb.enabled) {
      this.reverbIn = ctx.createGain();
      const convolver = ctx.createConvolver();
      convolver.buffer = makeImpulse(ctx, cfg.reverb.seconds, cfg.reverb.decay, cfg.reverb.darken);
      this.reverbIn.connect(convolver);
      convolver.connect(this.bus);
    }

    this.delayIn = null;
    this.delay = null;
    if (cfg.delay.enabled) {
      this.delayIn = ctx.createGain();
      this.delay = ctx.createDelay(2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cfg.delay.lowpassHz;
      const feedback = ctx.createGain();
      feedback.gain.value = cfg.delay.feedback;
      this.delayIn.connect(this.delay);
      this.delay.connect(lp);
      lp.connect(feedback);
      feedback.connect(this.delay);
      lp.connect(this.bus);
    }

    this.noise = makeNoise(ctx, cfg.noiseBuffer.seconds, false);
    this.rainNoise = null; // built on first use
  }

  // Starts a track (crossfade in over fadeSec). The caller stops the old one.
  play(key, fadeSec = 0.5) {
    const data = compile(key);
    if (!data) return null;
    const track = new Track(this, data);
    this.tracks.add(track);
    track.start(fadeSec);
    if (!this.timer) this.timer = setInterval(() => this.tick(), cfg.tickMs);
    return track;
  }

  stop(track, fadeSec = 0.5) {
    if (!track) return;
    track.fadeOut(fadeSec);
  }

  tick() {
    const t0 = performance.now();
    const now = this.ctx.currentTime;
    for (const track of this.tracks) {
      if (track.dead(now)) {
        track.dispose();
        this.tracks.delete(track);
        continue;
      }
      track.update(now);
      track.scheduleUntil(now + cfg.lookaheadMs / 1000, now);
    }
    if (!this.tracks.size) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const ms = performance.now() - t0;
    this.stats.ticks += 1;
    this.stats.tickMs += ms;
    if (ms > this.stats.maxTickMs) this.stats.maxTickMs = ms;
  }

  // Claims a voice slot until `end`. Essential notes always get one (they
  // replace the slot that ends soonest); the rest are dropped when all are busy.
  takeVoice(end, essential) {
    const now = this.ctx.currentTime;
    const ends = this.voiceEnds;
    let soonest = 0;
    for (let i = 0; i < ends.length; i++) {
      if (ends[i] <= now) {
        ends[i] = end;
        return true;
      }
      if (ends[i] < ends[soonest]) soonest = i;
    }
    if (!essential) {
      this.stats.dropped += 1;
      return false;
    }
    ends[soonest] = end;
    return true;
  }

  rainBuffer() {
    if (!this.rainNoise) this.rainNoise = makeNoise(this.ctx, cfg.rainBuffer.seconds, true);
    return this.rainNoise;
  }
}

function makeNoise(ctx, seconds, pink) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    if (pink) {
      // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    } else {
      d[i] = white;
    }
  }
  return buf;
}

function makeImpulse(ctx, seconds, decay, darken) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += (Math.random() * 2 - 1 - lp) * (1 - darken);
    d[i] = lp * Math.pow(1 - i / n, decay);
  }
  return buf;
}

// ---------- Track: one playing instance of a compiled track ----------

class Track {
  constructor(engine, data) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.data = data;
    this.key = data.key;
    const def = data.def;
    this.stepSec = 60 / def.bpm / 4;
    this.barSec = this.stepSec * STEPS;

    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(engine.bus);

    // Per-layer: a bus (level) with reverb / delay sends, and the pad voice.
    this.layers = data.layers.map((l) => {
      const bus = this.ctx.createGain();
      bus.connect(this.out);
      const send = (target, amount) => {
        if (!target || !amount) return;
        const g = this.ctx.createGain();
        g.gain.value = amount;
        bus.connect(g);
        g.connect(target);
      };
      send(engine.reverbIn, l.p.reverb);
      send(engine.delayIn, l.p.delay);
      // Noise percussion shares one filter per layer (instead of one per hit).
      let noiseIn = bus;
      if (l.type === 'hat' || l.type === 'snare') {
        const f = this.ctx.createBiquadFilter();
        f.type = l.type === 'hat' ? 'highpass' : 'bandpass';
        f.frequency.value = l.type === 'hat' ? l.p.hp : l.p.freq;
        if (l.type === 'snare') f.Q.value = l.p.q;
        f.connect(bus);
        noiseIn = f;
      }
      return { ...l, bus, noiseIn, voice: null, rainGain: null, rainSrc: null };
    });

    this.barIndex = 0;
    this.step = 0;
    this.nextTime = 0;
    this.intensity = 0;
    this.intensityTarget = 0;
    this.warmFlag = false;
    this.warmTarget = false;
    this.warmAmt = 0;
    this.barFilter = 1;
    this.lastUpdate = 0;
    this.endAt = Infinity;
    this.stopped = false;
    this.forceRepad = false;
    this.trace = null; // tests: [] collects {t, bar, layer, midi, chord} for every note fired
  }

  start(fadeSec) {
    const now = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(this.data.def.gain, now + fadeSec);
    this.nextTime = now + 0.06;
    this.lastUpdate = now;
    if (this.engine.delay) this.engine.delay.delayTime.setTargetAtTime(cfg.delay.beats * 60 / this.data.def.bpm, now, 0.05);
    for (const l of this.layers) if (l.type === 'rain') this.startRain(l, now);
  }

  fadeOut(fadeSec) {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + fadeSec);
    // The scheduler stops now; notes already queued ring out under the fade.
    this.endAt = now + fadeSec + cfg.lookaheadMs / 1000 + 0.1;
    this.stopped = true;
  }

  dead(now) {
    return now >= this.endAt;
  }

  dispose() {
    for (const l of this.layers) {
      if (l.rainSrc) {
        try {
          l.rainSrc.stop();
        } catch (err) {
          // already stopped
        }
      }
      if (l.voice) this.killVoice(l, this.ctx.currentTime);
    }
    this.out.disconnect();
  }

  setIntensity(v) {
    this.intensityTarget = Math.max(0, Math.min(1, v));
  }

  setWarm(on) {
    this.warmTarget = !!on;
  }

  // Slews intensity and warmth (called from the engine tick).
  update(now) {
    const dt = Math.max(0, now - this.lastUpdate);
    this.lastUpdate = now;
    const slew = (cur, target, perSec) => (cur < target ? Math.min(target, cur + perSec * dt) : Math.max(target, cur - perSec * dt));
    this.intensity = slew(this.intensity, this.intensityTarget, cfg.intensitySlewPerSec);
    this.warmAmt = slew(this.warmAmt, this.warmTarget ? 1 : 0, cfg.warmSlewPerSec);
  }

  // Filter openness for notes started now: the section's sweep, opened by warmth.
  get cutMul() {
    return this.barFilter * (1 + (cfg.warmFilterMult - 1) * this.warmAmt);
  }

  scheduleUntil(limit, now) {
    if (this.stopped) return;
    // Behind (tab was busy): skip ahead instead of firing a burst of old steps.
    if (now !== undefined && this.nextTime < now - 0.05) this.nextTime = now + 0.02;
    while (this.nextTime < limit) {
      this.scheduleStep(this.nextTime);
      this.step += 1;
      if (this.step >= STEPS) {
        this.step = 0;
        this.barIndex = (this.barIndex + 1) % this.data.bars.length;
      }
      this.nextTime += this.stepSec;
    }
  }

  active(L) {
    if (this.intensity < L.range[0] || this.intensity >= L.range[1]) return false;
    if (L.warm === 'only') return this.warmFlag;
    if (L.warm === 'off') return !this.warmFlag;
    return true;
  }

  scheduleStep(t) {
    const bar = this.data.bars[this.barIndex];
    const step = this.step;
    // The warm variant switches on a beat, not only on a bar line; held pads are re-voiced.
    if (this.warmFlag !== this.warmTarget && step % 4 === 0) {
      this.warmFlag = this.warmTarget;
      if (step === 0) this.forceRepad = true;
      else this.retriggerPads(bar, t);
    }
    if (step === 0) this.onBar(bar, t);
    for (let i = 0; i < bar.entries.length; i++) {
      const e = bar.entries[i];
      const L = this.layers[e.li];
      if (!e.steps || !this.active(L)) continue;
      const tok = e.steps[step];
      if (tok) this.fire(L, tok, t, bar);
    }
  }

  onBar(bar, t) {
    this.barFilter = bar.filter;
    for (const L of this.layers) if (L.rainGain) L.rainLevel = 0;
    for (let i = 0; i < bar.entries.length; i++) {
      const e = bar.entries[i];
      const L = this.layers[e.li];
      if (L.type === 'pad') {
        if (!this.active(L)) {
          if (L.voice) this.killVoice(L, t);
        } else if (this.forceRepad && L.voice) {
          this.killVoice(L, t, 0.3);
          this.startPad(L, bar, t, bar.padLeft * this.barSec, true);
        } else if (bar.padStart || !(L.voice && L.voice.end > t + 0.05)) {
          this.startPad(L, bar, t, bar.padLeft * this.barSec, false);
        }
      } else if (L.type === 'rain' && L.rainGain) {
        L.rainLevel = e.level;
      }
    }
    this.forceRepad = false;
    // Sections that don't use the rain bed fade it out.
    for (const L of this.layers) if (L.rainGain) L.rainGain.gain.setTargetAtTime(L.rainLevel * L.p.gain, t, 0.8);
  }

  // ---- notes ----

  fire(L, tok, t, bar) {
    const eng = this.engine;
    const vel = tok.v * (0.92 + Math.random() * 0.16);
    const when = Math.max(t + (L.type === 'kick' ? 0 : (Math.random() - 0.5) * cfg.humanizeMs * 0.001), this.ctx.currentTime);
    let midi = 0;
    let snapped = false;
    if (L.mode === 'chord') {
      const chord = this.warmFlag ? bar.chordWarm : bar.chord;
      midi = 12 * (L.oct + 1) + this.data.rootPc + chord.root + chord.ints[tok.i] + (tok.up ? 12 : 0);
    } else if (L.mode === 'scale') {
      const scale = this.warmFlag ? this.data.scaleWarm : this.data.scaleCool;
      midi = 12 * (L.oct + 1) + this.data.rootPc + scale[tok.deg - 1] + 12 * tok.oct;
      // A melody note a semitone above a chord tone (a minor 9th) grates: it drops to that chord tone.
      if (cfg.snapAvoidNotes) {
        const chord = this.warmFlag ? bar.chordWarm : bar.chord;
        const pc = midi % 12;
        let isTone = false;
        let above = false;
        for (let i = 0; i < 4; i++) {
          const c = (this.data.rootPc + chord.root + chord.ints[i]) % 12;
          if (c === pc) isTone = true;
          else if (i < 3 && (pc - c + 12) % 12 === 1) above = true;
        }
        if (above && !isTone) {
          midi -= 1;
          snapped = true;
        }
      }
    }
    if (this.trace) this.traceNote(when, bar, L, midi, snapped);
    const ring = this.ringTime(L);
    if (!eng.takeVoice(when + ring, ESSENTIAL.has(L.type))) return;
    eng.stats.notes += 1;
    INSTRUMENTS[L.type].call(this, L, tok, midi, when, vel);
  }

  // Tests only: one record per note with the chord and scale it was played over.
  traceNote(t, bar, L, midi, snapped = false) {
    const chord = this.warmFlag ? bar.chordWarm : bar.chord;
    const scale = this.warmFlag ? this.data.scaleWarm : this.data.scaleCool;
    this.trace.push({
      t,
      bar: this.barIndex,
      step: this.step,
      layer: L.id,
      mode: L.mode,
      type: L.type,
      midi,
      snapped,
      chord: chord.token,
      warm: this.warmFlag,
      tones: chord.ints.map((i) => (this.data.rootPc + chord.root + i) % 12),
      scale: scale.map((i) => (this.data.rootPc + i) % 12),
    });
  }

  ringTime(L) {
    const p = L.p;
    if (L.type === 'bass') return p.len * this.stepSec;
    if (L.type === 'bell') return p.decay;
    if (L.type === 'swell') return p.dur;
    return p.decay || 0.3;
  }

  // ---- pad voices (held chords) ----

  startPad(L, bar, t, dur, quick) {
    const ctx = this.ctx;
    const p = L.p;
    const chord = this.warmFlag ? bar.chordWarm : bar.chord;
    const base = 12 * (L.oct + 1) + this.data.rootPc + chord.root;
    const attack = Math.min(quick ? 0.35 : p.attack, dur * 0.6);
    const peak = p.gain;
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENT, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + dur);
    env.gain.setTargetAtTime(0, t + dur, p.release / 3);
    const end = t + dur + p.release;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.q;
    filter.frequency.setValueAtTime(p.cutoff * this.cutMul, t);
    env.connect(filter);
    filter.connect(L.bus);

    const oscs = [];
    for (const tok of L.voicing) {
      const f = hz(base + chord.ints[tok.i] + (tok.up ? 12 : 0));
      if (this.trace) this.traceNote(t, bar, L, base + chord.ints[tok.i] + (tok.up ? 12 : 0));
      for (const cents of p.voices === 1 ? [0] : [-p.detune, p.detune]) {
        const o = ctx.createOscillator();
        o.type = p.wave;
        o.frequency.setValueAtTime(f, t);
        o.detune.value = cents;
        o.connect(env);
        o.start(t);
        o.stop(end + 0.1);
        oscs.push(o);
      }
    }
    this.engine.takeVoice(end, true);
    L.voice = { env, oscs, filter, end };
  }

  killVoice(L, t, release = 0.15) {
    const v = L.voice;
    L.voice = null;
    if (!v) return;
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(0, t, release / 3);
    for (const o of v.oscs) {
      try {
        o.stop(t + release * 3);
      } catch (err) {
        // already scheduled to stop
      }
    }
  }

  // The chord quality changed under a held pad: re-voice it from this beat.
  retriggerPads(bar, t) {
    for (const L of this.layers) {
      if (L.type !== 'pad' || !this.active(L)) continue;
      const left = bar.padLeft * this.barSec - this.step * this.stepSec;
      if (left < 0.2) continue;
      if (L.voice) this.killVoice(L, t, 0.3);
      this.startPad(L, bar, t, left, true);
    }
  }

  // ---- rain bed ----

  startRain(L, now) {
    const ctx = this.ctx;
    const p = L.p;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.rainBuffer();
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = p.hp;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lp;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(L.bus);
    src.start(now, Math.random() * 2);
    L.rainSrc = src;
    L.rainGain = g;
  }

  // For the dev panel / tests.
  position() {
    const bar = this.data.bars[this.barIndex];
    return { bar: this.barIndex + 1, bars: this.data.bars.length, section: bar.section, chord: bar.token };
  }
}

// ---------- Instruments (called with this = Track) ----------

function env(param, t, peak, attack, decay) {
  param.setValueAtTime(SILENT, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(SILENT, t + attack + decay);
}

function noiseSource(track, t, dur) {
  const src = track.ctx.createBufferSource();
  src.buffer = track.engine.noise;
  src.start(t, Math.random() * 0.8);
  src.stop(t + dur + 0.02);
  return src;
}

const INSTRUMENTS = {
  // Short filtered saw/square line with a sine on the fundamental.
  bass(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const f = hz(midi);
    const dur = p.len * this.stepSec;
    const cut = p.cutoff * this.cutMul;
    const o = ctx.createOscillator();
    o.type = p.wave;
    o.frequency.setValueAtTime(f, t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.1;
    lp.frequency.setValueAtTime(cut * p.envMul, t);
    if (p.envMul !== 1) lp.frequency.exponentialRampToValueAtTime(cut, t + p.decay);
    const g = ctx.createGain();
    const peak = p.gain * vel;
    const rel = Math.min(0.25, dur * 0.4);
    g.gain.setValueAtTime(SILENT, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.setValueAtTime(peak, t + Math.max(0.011, dur - rel));
    g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(L.bus);
    o.start(t);
    o.stop(t + dur + 0.03);
    if (p.subMix > 0) {
      const s = ctx.createOscillator();
      s.type = 'sine';
      s.frequency.setValueAtTime(f, t);
      const sg = ctx.createGain();
      sg.gain.value = p.subMix;
      s.connect(sg);
      sg.connect(g);
      s.start(t);
      s.stop(t + dur + 0.03);
    }
  },

  // Plucked line: oscillator -> closing lowpass -> fast decay.
  pluck(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const o = ctx.createOscillator();
    o.type = p.wave;
    o.frequency.setValueAtTime(hz(midi), t);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    const cut = p.cutoff * this.cutMul;
    lp.frequency.setValueAtTime(cut, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.25), t + p.decay);
    const g = ctx.createGain();
    env(g.gain, t, p.gain * vel, 0.004, p.decay);
    o.connect(lp);
    lp.connect(g);
    g.connect(L.bus);
    o.start(t);
    o.stop(t + p.decay + 0.06);
  },

  // Bell / music box: a few sine partials, each with its own decay.
  bell(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const f = hz(midi);
    for (const [ratio, amp, decayMul] of p.partials) {
      if (f * ratio > 11000) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * ratio, t);
      const g = ctx.createGain();
      const decay = p.decay * decayMul;
      env(g.gain, t, p.gain * amp * vel, 0.002, decay);
      o.connect(g);
      g.connect(L.bus);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  },

  // Kick / tom / boom: a sine that falls in pitch.
  kick(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(p.from, t);
    o.frequency.exponentialRampToValueAtTime(p.to, t + p.sweep);
    const g = ctx.createGain();
    env(g.gain, t, p.gain * vel, 0.002, p.decay);
    o.connect(g);
    g.connect(L.bus);
    o.start(t);
    o.stop(t + p.decay + 0.06);
  },

  // Soft snare: band-passed noise plus a short tone.
  snare(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const src = noiseSource(this, t, p.decay);
    const g = ctx.createGain();
    env(g.gain, t, p.gain * vel, 0.002, p.decay);
    src.connect(g);
    g.connect(L.noiseIn);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(p.toneHz, t);
    o.frequency.exponentialRampToValueAtTime(p.toneHz * 0.6, t + p.toneDecay);
    const tg = ctx.createGain();
    env(tg.gain, t, p.gain * 0.5 * vel, 0.002, p.toneDecay);
    o.connect(tg);
    tg.connect(L.bus);
    o.start(t);
    o.stop(t + p.toneDecay + 0.05);
  },

  // Hat / crash: high-passed noise.
  hat(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const src = noiseSource(this, t, p.decay);
    const g = ctx.createGain();
    env(g.gain, t, p.gain * vel, 0.001, p.decay);
    src.connect(g);
    g.connect(L.noiseIn);
  },

  // Riser: band-passed noise sweeping up.
  swell(L, tok, midi, t, vel) {
    const ctx = this.ctx;
    const p = L.p;
    const src = this.ctx.createBufferSource();
    src.buffer = this.engine.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = p.q;
    bp.frequency.setValueAtTime(p.from, t);
    bp.frequency.exponentialRampToValueAtTime(p.to, t + p.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(p.gain * vel, t + p.dur * 0.9);
    g.gain.linearRampToValueAtTime(0, t + p.dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(L.bus);
    src.start(t, Math.random() * 0.8);
    src.stop(t + p.dur + 0.05);
  },

  // pad and rain are driven per bar, not per step.
  pad() {},
  rain() {},
};

// ---------- Offline render (level checks, dev tools) ----------

// Renders `seconds` of a track into an AudioBuffer (no real-time playback).
export async function renderTrack(key, seconds, { intensity = 0, warm = false, sampleRate = 22050, trace = null } = {}) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(2, Math.ceil(seconds * sampleRate), sampleRate);
  const engine = new MusicEngine(ctx, ctx.destination);
  const track = new Track(engine, compile(key));
  track.start(0.001);
  track.nextTime = 0.01;
  track.intensity = track.intensityTarget = intensity;
  track.warmFlag = track.warmTarget = warm;
  track.warmAmt = warm ? 1 : 0;
  if (trace) track.trace = trace;
  track.scheduleUntil(seconds);
  return ctx.startRendering();
}
