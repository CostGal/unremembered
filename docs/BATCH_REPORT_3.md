# Batch report 3: autonomous run, Thu 1 Oct 2026

Live: https://costgal.github.io/unremembered/. Every commit below was pushed to `main`, so each one deployed.
The batch message arrived complete (it ended with "END OF BATCH"). Another Claude session ("GitHub issues for game mechanics") was working in its own worktree on the same repo at the same time; I stayed in my own worktree, fetched/rebased before each push and never force-pushed. Its CPU use adds noise to the timing numbers below.

| Task | What | Issues | Commits |
|---|---|---|---|
| A0 | Portraits (20, incl. 4 Nala) + title logo/background wired | #47 (closed by hand) | `73d54ee` (pushed before this batch started) |
| A | `records_office` bg, cutscene art, full-bleed cutscene, ending silhouette, headless checks | #28, #29 (closed by the commit) | `ca12eff` |
| B | Procedural music engine, 5 tracks, intensity + warm hooks, `?music=` panel, checks | #73 (new; closed by the commit) | the commit that adds this report |

#35 ("Music: pick 5 tracks") stays open and manual: real tracks still win. Drop `public/assets/audio/music/<key>.mp3` in and rebuild; that key then plays the file instead of the generated track.

Before every push: `npm run build` passed, `npm run validate` showed 0 errors (the 5 warnings are the 3 over-long dialogue lines I may not touch, and the 2 Dov sheets not delivered yet), `npm run budget` was far under 8 MB, and `npm run playtest` passed (real sheets before each push; fake sheets too before the first one).

New dev commands:

| Command | What |
|---|---|
| `npm run cutscene-check` | Screenshots every cutscene shot early + late at 360×640, writes `_art/work/cutscene_check/` (30 `shot_NN.jpg` + `contact_early.jpg` + `contact_late.jpg`). `-- --shots 8,15` for a few |
| `npm run music-check` | Renders every track offline: peak / RMS / loudest and quietest 2 s, clipping, plus a harmony report (every pitched note against its chord). `-- --harmony` for just the report |
| `npm run music-perf` | A/B CPU cost of the music in a rainy battle at 4× CPU throttle (see numbers) |

`playtest`, `perf`, `cutscene-check`, `music-*` now run **without Playwright**: `scripts/lib/cdp.mjs` drives the Chrome/Edge already on the machine over the DevTools protocol (Node's built-in `WebSocket`, no dependency). `playtest` and `perf` use Playwright if it is installed and fall back to this otherwise. I ran `playtest` that way, twice, successfully; `perf` was not run with the fallback.

## Phone test URLs
Base: `https://costgal.github.io/unremembered/`. The dev params work on the live build.

| What | URL |
|---|---|
| Title (key art + logo) | `https://costgal.github.io/unremembered/` |
| Cutscene from the start (full game flow) | `?step=0` |
| One cutscene shot (1–30, as numbered in `docs/STORY.md`) | `?cutscene=origin&shot=15` (kneeling Aurelian), `shot=8`, `shot=18` (glowing eyes), `shot=20` |
| Music alone, with a panel (Play, track, intensity slider, warm box, bar/section readout) | `?music=title`, `?music=battle`, `?music=boss`, `?music=ending`, `?music=cutscene`. Tap **Play** (browsers need a tap to start sound) |
| Boss on `records_office` | `?battle=boss_clerk` |
| Recollection: warm music + gold screen | `?battle=boss_clerk&echo=10` → Recollection |
| Boss phase 2: music intensity layer | same URL; hit the Clerk below 50% HP |
| Dialogue portraits | `?step=2` (Rhea/Dov), `?step=5` (Clerk) |
| Ending with the silhouette | `?step=7`, tap to the 7th line ("Somewhere above the city…") |
| FPS meter | add `&fps=1` to any of the above |

## A — art
**What changed**
- `records_office.png` is the battle and dialogue background (NEAREST, darkened 20% in battle like `street_rain`; `environments.json` already had its ambient tint and vignette). Checked on the boss: Dov and the Clerk stand on the stone floor; Rhea's boots sit on the front lip about 6px lower. I left the shared layout alone because it also serves `street_rain`.
- 6 cutscene illustrations (720×1280, LINEAR) and 4 Aurelian cutouts registered in `assets.json` with their real sizes. `aurelian_king_kneel` is shot 8, `aurelian_exile_kneel` is shot 15 (the suggestion), standing `aurelian_exile` stays at 16 and 20. No shot text changed.
- Ending: `aurelian_exile` appears as a black silhouette on the line "Somewhere above the city, a silhouette watches…". It is a new optional `silhouette` field on that dialogue line (text untouched) plus `ui.dialogue.silhouette` placement data.
- The raw Gemini originals of the new background and cutscene art (11 files in `_art/raw/gemini/`) are committed as-is, like the earlier `_art/` files.
- The inbox is empty.

**Decisions**
1. **Cutscene is full-bleed now** (area 0–640, was a 344px letterboxed window). The art is 9:16 and was made for it. The line sits on a black gradient (`ui.cutscene.gradient`) at the bottom; "Hold to skip" moved to the top. Pans (±24px at 1.15×) and zooms (1.18×) stay inside the picture.
2. **Pixel-art backgrounds scale by whole numbers in the cutscene** (street_rain = 2×), and the Blank/Hollow/Rhea sprites on them are drawn at 2×, so pixels match. The illustrations over the pixel street (shot 16) are a deliberate style mix.
3. **Cutouts in split shots** are framed with new per-shot `bgView` / `bg2View` ({focus, zoom}) so the face lands in the cell (shots 5, 17, 20).
4. **Eye glows live inside the zooming stage** (they used to drift off the eyes on zoom). Points x 0.30 / 0.69, y 0.40 as you gave them, radius 26.
5. `?shot=N` is 1-based so it matches the shot numbers in STORY.md and in your message.
6. Shots 22 and 23 end black by design (`lights_out`); the early frames show the city.

**Checks:** all 30 shots at 360×640, early and late frames, in `_art/work/cutscene_check/` (open `contact_late.jpg` first). Title with `title_bg` + logo, dialogue portraits for Rhea, Dov and the Clerk (Nala has no dialogue lines yet; her 4 portraits are registered at 225px display height so she is smaller than the humans), and the boss on `records_office` were checked in the browser.

## B — procedural music
**How it works** (`src/systems/Music.js`, `MusicData.js`, `src/data/music.json`)
- `playMusic(key)` keeps its API. If `<key>.mp3` exists (the list is read from the folder at build time by `vite.config.js`, so no probing request) it plays as before; otherwise the generated track plays. A listed file that fails to decode falls back to the generated one. 500 ms crossfade, volume from Settings, suspended when the page is hidden, started by the Title tap — all unchanged.
- Lookahead scheduler (200 ms ahead, 40 ms tick) on the shared `AudioContext`. Patterns are compiled once; the tick allocates only the notes' audio nodes. At most 22 notes sound at once (bass, kick, snare, pad, risers always get a voice; arps, bells, hats are dropped first).
- Instruments from oscillators, noise, filters, envelopes: pad, sub/bass, pluck, lead, bell/music box, kick, snare, hat, tom, crash, boom, riser, pink-noise rain bed. One shared convolver reverb (1.2 s, generated noise, mono) and a tempo-synced feedback delay.
- Master limiter (`DynamicsCompressor`, −6 dB threshold) on music + SFX together, so they never clip when they stack. Default music volume is 0.75 and SFX 1.0 (new players only; saved settings are kept).
- Tracks are data: tempo, key, scale, chords as roman numerals, per-layer patterns (chord-tone, scale-degree or drum tokens), sections, form. `npm run validate` compiles every track, so a bad chord/token/reference is an error.
- `setMusicIntensity(0..1)`: layers have an intensity window. Boss phase 2 sets 1 (`enemies.json` → `phases[1].musicIntensity`): doubled bass, 16th hats, hot kick, a high arp, a second pad. `setMusicWarm(bool)`: while Recollection plays, minor chords turn major, melodies use the major scale, filters open ×1.9 and bell shimmer layers join; it switches on a beat and held pads are re-voiced. Verified in a live boss battle: `warm=true` for 4.3 s, then `false`; phase 2 gives intensity 1.
- Engine safety net: a melody note a semitone above a chord tone drops to the chord tone (`snapAvoidNotes`). The harmony report shows 3–23 snapped notes per track out of 86–1,400 and 0 clashes left.

| Track | bpm | key | bars / loop | Notes |
|---|---|---|---|---|
| title | 70 | A minor | 32 / 110 s | pad, music-box motif, soft arp, bell sparkles, rain bed |
| cutscene | 60 | D minor | 32 / 128 s | drones, slow pad, sparse bells, boom hits, riser; no drums |
| battle | 110 | D minor | 48 / 105 s | saw bass ostinato, 16th arp, pluck lead, light kick/snare/hat, fills |
| boss | 124 | F harmonic minor | 48 / 93 s | heavy bass, stabs, syncopated kick, toms; intensity layer |
| ending | 64 | C major | 32 / 120 s | vi–IV–I–V, ends IV → iv → I(maj7); music-box lead |

**Levels** (`npm run music-check`, before the Settings volume and the limiter; the SFX peak around −6 to −10 dBFS, the music is meant to sit well under them):

| Track | Peak dBFS | RMS dBFS | Clipped samples |
|---|---|---|---|
| title | −9.7 | −20.6 | 0 |
| cutscene | −4.1 | −23.4 | 0 |
| battle | −5.1 | −23.6 | 0 |
| boss | −5.9 | −21.4 | 0 |
| boss at intensity 1 | −5.4 | −20.5 | 0 |
| ending | −10.8 | −20.9 | 0 |

**CPU** (`npm run music-perf`: rainy battle, headless Chrome with software WebGL, 4× CPU throttle, 3 rounds, 10 s windows, interleaved in one page). The clean comparison is "music stopped, audio on" against "music again", same game state:

| Battle | fps, no music | fps, music | Scheduler tick (4× throttled) |
|---|---|---|---|
| `b3_hollows` (street_rain, rain) | 134.4 | 135.1 (+0.7) | avg 0.5 ms, max 9–18 ms |
| `boss_clerk` | 149.1 | 147.6 (−1.5, about 1%) | avg 1.0 ms, max 16–19 ms |
| `boss_clerk`, intensity 1 + warm | — | 165.1 (range 149–197) | — |

That is far under the "drop of ~5 fps" bar, so voices and reverb were **not** cut. Headless fps is uncapped software rendering (130–160 fps), so only the difference means anything. Scheduler cost is ~0.1–0.25 ms per tick on a normal CPU, 25 ticks/s. Offline rendering the boss at intensity 1 at 48 kHz costs ~15% of one desktop core in total; a mid-range Android is several times slower, so **listen and watch it on the older phone** (checklist item).

**Tuning knobs** (all in `music.json`): per-track `gain`; `engine.maxVoices`; `engine.reverb.enabled/seconds` and `engine.delay.enabled` if a phone struggles (reverb is the single biggest node); per-layer `params.gain`; `snapAvoidNotes`.

## Known issues / not done
- **Nobody has listened to the music yet.** I tuned levels, harmony and timing by measurement (offline renders, note traces, a live playback check), not by ear. Expect to adjust gains and a few patterns after you hear it on the phone. The `?music=` panel is for exactly that.
- Not tried on iPhone/Safari or the Instagram in-app browser (Web Audio features used are standard: oscillators, biquads, convolver, compressor).
- The first track start builds the reverb impulse and noise buffers, so the first scheduler ticks are the costliest (max 9–19 ms at 4× throttle in the perf run). Expect at most one small hitch on the Title tap and at bar lines where a new pad chord starts.
- Your main checkout (`C:\dev\unremembered`) still has the untracked `_art/...` files that are now committed. Before `git pull` there, delete those untracked paths (they are identical to what origin has), or the pull will refuse. That checkout is also many commits behind `origin/main`.
- `npm run perf` was not re-run with the Chrome fallback; `playtest`, `cutscene-check`, `music-check`, `music-perf` were.
- `docs/STATUS.md` was not touched, as asked. CLAUDE.md's Audio section now describes the procedural fallback.
- Other things from before: Dov's idle/attack sheets are still not delivered (validate warns), `memory_city` background still missing (Recollection falls back to the gold tint), 3 dialogue lines are over the 90-character guideline.
