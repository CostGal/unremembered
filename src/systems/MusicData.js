// The pure half of the procedural music: turns a track of data/music.json into
// per-bar play data. No Web Audio and no JSON import, so Node (npm run validate)
// can compile every track and fail on a bad chord, token or reference.

export const STEPS = 16;
export const NOTE_PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

const DEGREE = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
const CHORD_RE = /^([b#]?)(VII|VI|IV|III|II|V|I|vii|vi|iv|iii|ii|v|i)(7|M7|dim|sus2|sus4)?$/;

function chordFrom(token, root, minor, ext) {
  let third = minor ? 3 : 4;
  let fifth = 7;
  if (ext === 'dim') [third, fifth] = [3, 6];
  if (ext === 'sus2') third = 2;
  if (ext === 'sus4') third = 5;
  // Major chords on the tonic / subdominant take the major seventh.
  const seventh = ext === 'M7' || (!minor && ext !== '7' && (root === 0 || root === 5)) ? 11 : 10;
  return { token, root, minor, ext, ints: [0, third, fifth, seventh] };
}

function parseChord(token) {
  const m = CHORD_RE.exec(token);
  if (!m) throw new Error(`music: bad chord "${token}"`);
  const [, acc, numeral, ext = ''] = m;
  const root = (DEGREE[numeral.toUpperCase()] + (acc === 'b' ? -1 : acc === '#' ? 1 : 0) + 12) % 12;
  return chordFrom(token, root, numeral === numeral.toLowerCase(), ext);
}

// Warm variant: the minor chords (i, iv, v) turn major.
function warmChord(c) {
  if (!c.minor || c.ext === 'dim') return c;
  return chordFrom(c.token, c.root, false, c.ext === '7' ? 'M7' : c.ext);
}

// chord-tone token -> [index into chord.ints, one octave up?]
const CHORD_TONE = { r: [0, false], 3: [1, false], 5: [2, false], 7: [3, false], R: [0, true], T: [1, true], F: [2, true], S: [3, true] };

function parseToken(tok, mode) {
  if (tok === '.') return null;
  const accent = tok.endsWith('!') ? 1.3 : tok.endsWith('~') ? 0.6 : 1;
  const body = tok.replace(/[!~]$/, '');
  if (mode === 'drum') return { v: body === 'X' ? 1.3 : body === 'o' ? 0.5 : 1 };
  if (mode === 'scale') {
    const m = /^([1-7])([',]*)$/.exec(body);
    if (!m) throw new Error(`music: bad scale token "${tok}"`);
    const octaves = [...m[2]].reduce((n, ch) => n + (ch === "'" ? 1 : -1), 0);
    return { deg: Number(m[1]), oct: octaves, v: accent };
  }
  const tone = CHORD_TONE[body];
  if (!tone) throw new Error(`music: bad chord-tone token "${tok}"`);
  return { i: tone[0], up: tone[1], v: accent };
}

// "r . 5 ..." -> 16 parsed tokens; "-" -> null (empty bar).
function parseBar(text, mode) {
  const t = text.trim();
  if (t === '-') return null;
  const toks = t.split(/\s+/);
  if (toks.length !== STEPS) throw new Error(`music: bar needs ${STEPS} steps, got ${toks.length}: "${text}"`);
  return toks.map((tok) => parseToken(tok, mode));
}

// Compiles one track of music.json into per-bar data: chord, pattern steps per layer,
// pad hold lengths. Throws on any bad chord / token / reference (npm run validate).
export function compileTrack(music, key) {
  const def = music.tracks[key];
  if (!def) return null;

  const layers = Object.entries(def.layers).map(([id, l], li) => {
    const inst = music.instruments[l.inst];
    return {
      li,
      id,
      type: inst.type,
      mode: l.mode || 'none',
      oct: l.oct ?? 3,
      range: l.range || [0, 1.01],
      warm: l.warm || null,
      voicing: l.voicing ? l.voicing.split(' ').map((t) => parseToken(t, 'chord')) : null,
      p: { ...inst, ...(l.params || {}) },
    };
  });
  const layerIndex = Object.fromEntries(layers.map((l) => [l.id, l.li]));

  const patterns = {};
  const patternFor = (layer, name) => {
    const k = `${layer.mode}:${name}`;
    if (!patterns[k]) {
      const bars = def.patterns[name];
      if (!bars) throw new Error(`music: ${key}: pattern "${name}" not defined`);
      patterns[k] = bars.map((b) => parseBar(b, layer.mode));
    }
    return patterns[k];
  };

  const bars = [];
  def.form.forEach((sectionId, sIndex) => {
    const s = def.sections[sectionId];
    if (!s) throw new Error(`music: ${key}: section "${sectionId}" not defined`);
    for (let b = 0; b < s.bars; b++) {
      const token = s.chords[b % s.chords.length];
      const chord = parseChord(token);
      const entries = [];
      for (const [layerId, spec] of Object.entries(s.use)) {
        const li = layerIndex[layerId];
        if (li === undefined) throw new Error(`music: ${key}: section ${sectionId} uses unknown layer "${layerId}"`);
        const layer = layers[li];
        if (spec === true || typeof spec === 'number') {
          entries.push({ li, steps: null, level: spec === true ? 1 : spec });
          continue;
        }
        const name = Array.isArray(spec) ? spec[b % spec.length] : spec;
        const list = patternFor(layer, name);
        entries.push({ li, steps: list[b % list.length], level: 1 });
      }
      bars.push({
        section: sectionId,
        sIndex,
        b,
        last: b === s.bars - 1,
        token,
        chord,
        chordWarm: warmChord(chord),
        filter: s.filter[0] + (s.filter[1] - s.filter[0]) * (s.bars > 1 ? b / (s.bars - 1) : 0),
        entries,
        padStart: true,
        padLeft: 1,
      });
    }
  });
  // Pad chords hold across bars with the same chord inside a section.
  bars.forEach((bar, i) => {
    const prev = bars[(i + bars.length - 1) % bars.length];
    bar.padStart = !(prev.sIndex === bar.sIndex && prev.token === bar.token);
  });
  for (let i = bars.length - 1; i >= 0; i--) {
    const next = bars[i + 1];
    bars[i].padLeft = next && next.sIndex === bars[i].sIndex && next.token === bars[i].token ? next.padLeft + 1 : 1;
  }

  const out = {
    key,
    def,
    layers,
    bars,
    rootPc: NOTE_PC[def.root],
    scaleCool: music.scales[def.scale],
    scaleWarm: music.scales[def.warmScale || def.scale],
  };
  return out;
}
