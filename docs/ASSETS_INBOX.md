# Assets inbox, pass 1

Processed from `art_inbox/` (raws now in `_art/raw/gemini/` and `_art/raw/audio/`). Scope: `public/assets/`, `src/data/assets.json`, `src/data/audio.json` (data only), `src/data/credits.json`, `README.md`. No code, `cutscene_origin.json` or `dialogue.json` was touched. Status: OK = within spec, FLAG = see the note.

## Images

| key | path | px | format | bytes | status |
|---|---|---|---|---|---|
| `bg_street_far` | `bg/bg_street_far.jpg` | 720x1280 | JPEG | 142,577 | OK |
| `bg_street_mid` | `bg/bg_street_mid.jpg` | 720x1280 | JPEG | 157,654 | OK |
| `bg_office_gate` | `bg/bg_office_gate.jpg` | 720x1280 | JPEG | 146,166 | OK |
| `records_office` | `bg/records_office.jpg` | 720x1280 | JPEG | 185,481 | OK |
| `records_office_room` | `bg/records_office.jpg` | 720x1280 | JPEG | 185,481 | OK |
| `cs_aurelian_build` | `cutscene/cs_aurelian_build.jpg` | 720x1280 | JPEG | 164,128 | OK |
| `cs_aurelian_cheered` | `cutscene/cs_aurelian_cheered.jpg` | 720x1280 | JPEG | 151,714 | OK |
| `cs_aurelian_engine_war` | `cutscene/cs_aurelian_engine_war.jpg` | 720x1280 | JPEG | 119,543 | OK |
| `cs_aurelian_war` | `cutscene/cs_aurelian_war.jpg` | 720x1280 | JPEG | 98,046 | OK |
| `cs_castle_daughter` | `cutscene/cs_castle_daughter.jpg` | 720x1280 | JPEG | 115,141 | OK |
| `cs_council_trial` | `cutscene/cs_council_trial.jpg` | 720x1280 | JPEG | 97,622 | OK |
| `cs_echo_called` | `cutscene/cs_echo_called.jpg` | 720x1280 | JPEG | 81,682 | OK |
| `cs_echo_learning` | `cutscene/cs_echo_learning.jpg` | 720x1280 | JPEG | 144,448 | OK |
| `cs_exile_ruins` | `cutscene/cs_exile_ruins.jpg` | 720x1280 | JPEG | 134,759 | OK |
| `cs_forgotten` | `cutscene/cs_forgotten.jpg` | 720x1280 | JPEG | 138,007 | OK |
| `cs_hollows` | `cutscene/cs_hollows.jpg` | 720x1280 | JPEG | 138,378 | OK |
| `cs_hush_1` | `cutscene/cs_hush_1.jpg` | 720x1280 | JPEG | 170,645 | OK |
| `cs_hush_2` | `cutscene/cs_hush_2.jpg` | 720x1280 | JPEG | 119,430 | OK |
| `cs_reliquary_red` | `cutscene/cs_reliquary_red.jpg` | 720x1280 | JPEG | 144,418 | OK |
| `cs_statue` | `cutscene/cs_statue.jpg` | 720x1280 | JPEG | 157,640 | OK |
| `cs_statue_2` | `cutscene/cs_statue_2.jpg` | 720x1280 | JPEG | 150,307 | OK |
| `cs_hush_mid` | `cutscene/cs_hush_mid.jpg` | 720x1280 | JPEG | 145,869 | OK |
| `bg_abandoned_home_fpv` | `bg/bg_abandoned_home_fpv.jpg` | 720x1280 | JPEG | 105,475 | OK |
| `bg_letter_fpv` | `bg/bg_letter_fpv.jpg` | 720x1280 | JPEG | 79,614 | OK |
| `rest_panel_1` | `bg/rest_panel_1.jpg` | 720x1280 | JPEG | 123,610 | OK |
| `rest_panel_2` | `bg/rest_panel_2.jpg` | 720x1280 | JPEG | 125,753 | OK |
| `rest_panel_3` | `bg/rest_panel_3.jpg` | 720x1280 | JPEG | 122,294 | OK |
| `platform_street` | `bg/platform_street.png` | 720x220 | PNG (RGBA) | 229,678 | OK (curb joints: first 6 rows cut so no V-notches remain) |
| `platform_office` | `bg/platform_office.png` | 720x220 | PNG (RGBA) | 258,221 | OK |
| `dov_pet_nala` | `portraits/dov_pet_nala.png` | 299x400 | PNG (RGBA) | 145,307 | OK |
| `nala_meow` | `portraits/nala_meow.png` | 264x310 | PNG (RGBA) | 93,484 | OK |
| `rhea_cutin_power` | `portraits/rhea_cutin_power.png` | 720x240 | PNG (RGBA) | 318,496 | OK |
| `rhea_cutin_tears` | `portraits/rhea_cutin_tears.png` | 720x240 | PNG (RGBA) | 181,173 | OK |

### Image notes

- Battle backgrounds (`bg_street_far`, `bg_street_mid`, `bg_office_gate`, `records_office`): 720x1280 JPG, cover-cropped keeping the TOP rows (raw ratio 0.558 vs 0.5625, so only 10 px of the bottom is lost). The buildings, windows and the Office clock tower all sit in the top 42 %. Entries carry `filter: "linear"`, `displayScale: 0.5`, `desaturate: 0.6` and an `ambient` block (the code item consumes them).
- `records_office` now points at `bg/records_office.jpg` (720x1280); the old 360x360 `bg/records_office.png` is deleted. **Until the code item lands, anything that draws `records_office` as a 360x360 picture (the two dialogue steps and the boss battle) will draw the new 720x1280 image unscaled.**
- `records_office_room` = the same JPG with `cover: true`. **Wiring item:** point the `records_office` and `ending` dialogue steps in `chapter1.json` at `records_office_room`; the battle keeps `records_office`.
- Platforms (`platform_street`, `platform_office`): PNG with alpha, 720x220, `filter: "linear"`, `displayScale: 0.5` (drawn 360x110). The raws had a magenta band above the strip (the street one is portrait 1536x2752, the office one landscape 2752x1536); the strip is cropped from the first fully opaque row downward. The street curb has V-shaped joints that reach the top edge; those first ~6 rows were skipped so the top edge is straight and fully opaque. Key: magenta-ness `min(r,b)-g >= 110`, 3 px defringe (fringe colour = nearest opaque core pixel), soft alpha ramp. Verified on a green backdrop: 1 faintly pinkish pixel in the street strip, none in the office strip.
- Portraits: `dov_pet_nala` 1792x2400 -> 299x400 (straight resize, ratio 0.7467 vs 0.7475). `nala_meow` arrived as JPG; keyed, cropped to the cat's bounding box and fitted bottom-centre into 264x310 (the raw has much more margin than the other Nala portraits, so the cat is slightly narrower than `nala_calm` at the same height). Keying: threshold 100, 2 px defringe only (Rhea's white hair is in the cut-ins; checked on black, no pink halo visible).
- Cut-ins (720x240 PNG, RGBA flattened onto the background, so effectively opaque): background cover-cropped to 3:1 around the burst centre (source px 1361,750). The head fills the band height (top of the hair to the bottom of the collar area, 234 px wide), eyes at about 44 % of the height (the raw image ends at the shoulders, so 40 % would need extra canvas). Power: background as is plus a soft teal `#3fd0c9` outer glow (about 6 px). Tears: background x0.6 (darker 40 %), desaturated 50 %, pushed toward indigo, blurred 2.2 px, no glow.
- `cs_statue_1` -> `cs_statue` (shot 13), `cs_statue_2` -> new `cs_statue_2` (shot 14) with `view: {"focus": [0.5, 0.4]}`, `cs_hush_11` -> new `cs_hush_mid`. **The wiring item inserts the `cs_hush_mid` shot between cs_hush_1 and cs_hush_2 (index 22; cs_hush_2 becomes 23) and switches shot 14 to `cs_statue_2`.**
- `cs_city_red_tower`: kept as a placeholder entry because `cutscene_origin.json` still references it (shots 23 and 24). The wiring item should repoint those two shots (the new `cs_hush_mid`, a dark city with the red tower, is the obvious candidate) and then delete the entry.
- Old `street_rain_platform` / `records_office_platform` (optional, never delivered) are superseded by `platform_street` / `platform_office` and can be removed by the wiring item.
- Not in the inbox (still placeholders or optional): `ui/logo.png` and `ui/title_bg.jpg` already exist; `ui_badge_postjam` is still missing.

### Glow points (`ambient.glowPoints`, x/y 0-1 on the 720x1280 picture, all above y = 0.40)

`bg_street_far` (fog 6 px/s, alpha 0.18, `0x8fa0c8`), 4 points:
- (0.50, 0.271) amber `0xf0a040`: the only lit window in the clock-tower spire.
- (0.21, 0.332) teal `0x3fd0c9`: big bay window of the left house.
- (0.745, 0.285) teal: dormer window of the right house.
- (0.58, 0.36) teal: small window beside the spire.

`bg_street_mid` (same fog), 5 points:
- (0.50, 0.137) teal r 24: tall tower window.
- (0.50, 0.334) teal r 22: clock face.
- (0.21, 0.324) teal: left bay window.
- (0.745, 0.285) teal: right dormer window.
- (0.70, 0.19) teal r 10: small spire window on the right.

`bg_office_gate` (fog 5 px/s, alpha 0.16), 5 points:
- (0.153, 0.332) amber and (0.847, 0.332) amber: the two lanterns.
- (0.257, 0.297) teal and (0.743, 0.297) teal: the tall glowing windows flanking the gate.
- (0.50, 0.137) teal r 14, dim: the rune crest above the arch.

`records_office` (fog 4 px/s, alpha 0.10, warm `0xc8b090`), 6 points:
- (0.114, 0.184) amber and (0.875, 0.194) amber: the upper left and right lanterns.
- (0.861, 0.266) amber: the right scaffold lantern.
- (0.50, 0.125) teal: the crystal at the centre of the clock.
- (0.264, 0.270) teal and (0.746, 0.270) teal: the wall crystals.

## SFX (mono 44.1 kHz, 96 kbps MP3, target -16 LUFS, peak <= -1 dB, 60 ms fade-out)

| key | path | duration | LUFS | peak dBFS | bytes | status |
|---|---|---|---|---|---|---|
| `sfx_bell_toll` | `audio/sfx/sfx_bell_toll.mp3` | 5.02 s | -16.6 | -2.5 | 60,587 | OK (0-5.0 s; -16.6 LUFS) |
| `sfx_crowd_cheer` | `audio/sfx/sfx_crowd_cheer.mp3` | 6.03 s | -16.7 | -1.2 | 72,812 | OK |
| `sfx_crowd_murmur` | `audio/sfx/sfx_crowd_murmur.mp3` | 6.03 s | -16.2 | -2.4 | 72,895 | OK |
| `sfx_crystal_resonance` | `audio/sfx/sfx_crystal_resonance.mp3` | 3.03 s | -16.3 | -1.8 | 36,760 | OK |
| `sfx_door_creak` | `audio/sfx/sfx_door_creak.mp3` | 1.93 s | -16.4 | -1.6 | 23,555 | OK (very quiet source, +32 dB, compressed + limited) |
| `sfx_heartbeat` | `audio/sfx/sfx_heartbeat.mp3` | 3.03 s | -16.3 | -1.8 | 36,720 | OK (cut to 3 s) |
| `sfx_hiss` | `audio/sfx/sfx_hiss.mp3` | 1.54 s | -16.4 | -3.2 | 18,853 | OK |
| `sfx_laugh` | `audio/sfx/sfx_laugh.mp3` | 3.03 s | -16.4 | -1.3 | 36,790 | OK |
| `sfx_meow` | `audio/sfx/sfx_meow.mp3` | 1.31 s | -16.4 | -7.7 | 16,053 | OK (peak -7.7: short peaky source, loudness first) |
| `sfx_paper` | `audio/sfx/sfx_paper.mp3` | 0.84 s | -17.0 | -1.9 | 10,411 | OK (cut 2.09-3.00 s; very peaky, compressed then limited) |
| `sfx_red_surge` | `audio/sfx/sfx_red_surge.mp3` | 3.03 s | -22.3 | -14.5 | 36,775 | OK (-6 dB after normalising, as asked: -22.3 LUFS on purpose) |
| `sfx_scream_crowd` | `audio/sfx/sfx_scream_crowd.mp3` | 6.03 s | -16.2 | -1.6 | 72,809 | OK |
| `sfx_stone_crumble` | `audio/sfx/sfx_stone_crumble.mp3` | 1.93 s | -16.1 | -1.4 | 23,760 | OK (cut 6.10-8.00 s, 150 ms fade-in) |
| `sfx_war_horn` | `audio/sfx/sfx_war_horn.mp3` | 4.05 s | -16.4 | -7.9 | 48,998 | OK |

Where they play (data note, also in `audio.json` `music.placement.sfxCues`; shot numbers are the STORY numbering 1-30 of STORY.md, which equals the 0-based array index + 1 for these early shots):
- `sfx_war_horn`: shot 7 ("Then came the Long War").
- `sfx_crystal_resonance`: shot 8 ("To end it, he taught the engine...").
- `sfx_crowd_murmur`: shots 9-10 (the council), as a low bed.
- `sfx_bell_toll`: shot 11 ("...the Unwriting").
- `sfx_stone_crumble`: shot 13 -> 14 (the statue falls).
The five new keys are registered in `audio.json` `sfx` as empty recipes (`[]`): `Audio.playSfx` already plays the file when `public/assets/audio/sfx/<key>.mp3` exists (listed at build time) and an empty layer list is silent, so nothing breaks if a file is ever removed. The other nine files (`sfx_crowd_cheer`, `sfx_door_creak`, `sfx_heartbeat`, `sfx_hiss`, `sfx_laugh`, `sfx_meow`, `sfx_paper`, `sfx_red_surge`, `sfx_scream_crowd`) already had recipes; the file now overrides them.
Method: mono 44.1 kHz, leading silence stripped (`silenceremove`, -50 dB), length capped (3 s default; murmur, scream, cheer 6 s; bell 5 s; horn 4 s), loudnorm two-pass (linear) to -16 LUFS / -1 dB TP, 60 ms fade-out, 96 kbps. Very peaky or quiet sources (`door_creak`, `paper`, `stone_crumble`, `heartbeat`) could not reach -16 LUFS under loudnorm's true-peak limit, so they were compressed, gained and limited (limit -1.4 dBFS) until they landed within about 1 LU of -16. Sources were long (bell 45 s, murmur 60 s, scream 39 s, horn 19 s, heartbeat 28 s, crystal 12.6 s, laugh 6.9 s, red_surge 13 s): they are cut from the start (after the silence strip), so only the first N seconds of each raw are used.

## Music (96 kbps joint-stereo MP3, -16 LUFS integrated, peak <= -1 dB)

| key | path | duration | LUFS | peak dBFS | bytes | loop / one-shot | source segment | status |
|---|---|---|---|---|---|---|---|---|
| `battle` | `audio/music/battle.mp3` | 74.3 s | -16.0 | -6.2 | 891,865 | loop | whole file (already an exact loop render: seam checked) | OK |
| `battle_duel` | `audio/music/battle_duel.mp3` | 66.3 s | -16.0 | -3.8 | 795,630 | loop | 33.61 s + 66.23 s, bar-aligned, 60 ms seam crossfade | OK |
| `battle_gate` | `audio/music/battle_gate.mp3` | 76.6 s | -16.0 | -1.2 | 919,450 | loop | 11.48 s + 76.54 s, bar-aligned, 60 ms seam crossfade | OK |
| `battle_hollow` | `audio/music/battle_hollow.mp3` | 72.8 s | -16.0 | -6.4 | 874,311 | loop | whole file (already an exact loop render: seam checked) | OK |
| `boss` | `audio/music/boss.mp3` | 60.1 s | -16.0 | -6.2 | 721,024 | loop | 34.8 s + 60.01 s, bar-aligned, 60 ms seam crossfade | OK |
| `cs_fall` | `audio/music/cs_fall.mp3` | 62.0 s | -16.0 | -1.8 | 744,848 | loop | 28.0 s + 62.0 s, ambient (no beat grid; picked by spectral match at the seam), 2500 ms equal-power seam crossfade | FLAG: cs_fall.mp3 and rest_sad.mp3 are byte-identical in the inbox |
| `cs_forgotten` | `audio/music/cs_forgotten.mp3` | 69.3 s | -16.0 | -3.7 | 831,992 | loop | 41.22 s + 69.27 s, bar-aligned, 60 ms seam crossfade | OK |
| `cs_golden` | `audio/music/cs_golden.mp3` | 64.1 s | -16.0 | -4.8 | 768,985 | loop | 42.97 s + 64.01 s, bar-aligned, 60 ms seam crossfade | OK |
| `cs_hush` | `audio/music/cs_hush.mp3` | 70.5 s | -16.0 | -5.2 | 845,785 | loop | 29.17 s + 70.42 s, bar-aligned, 60 ms seam crossfade | OK |
| `cs_war` | `audio/music/cs_war.mp3` | 68.3 s | -16.0 | -5.2 | 820,080 | loop | 26.1 s + 68.28 s, bar-aligned, 60 ms seam crossfade | OK |
| `keepsake` | `audio/music/keepsake.mp3` | 71.7 s | -16.0 | -4.4 | 861,145 | one-shot | 0 - 71.68 s (bar-aligned end), 3 s fade-out | OK |
| `meet_dov` | `audio/music/meet_dov.mp3` | 64.1 s | -16.0 | -2.7 | 769,298 | loop | 14.14 s + 64.03 s, bar-aligned, 60 ms seam crossfade | OK |
| `quill_intro` | `audio/music/quill_intro.mp3` | 12.0 s | -16.0 | -7.7 | 144,867 | one-shot | 0 - 12 s of boss, 0.9 s fade-out | OK |
| `recollection` | `audio/music/recollection.mp3` | 61.0 s | -16.0 | -4.1 | 732,936 | one-shot | 0 - 61.0 s (bar-aligned end), 3 s fade-out | OK |
| `rest_sad` | `audio/music/rest_sad.mp3` | 62.0 s | -16.0 | -1.8 | 744,848 | loop | 28.0 s + 62.0 s, ambient (no beat grid; picked by spectral match at the seam), 2500 ms equal-power seam crossfade | FLAG: cs_fall.mp3 and rest_sad.mp3 are byte-identical in the inbox |
| `title` | `audio/music/title.mp3` | 11.3 s | -16.0 | -5.3 | 136,404 | loop | whole file (already an exact loop render: seam checked) | OK (11 s: the raw is only an 11.3 s exact loop; cannot reach 60 s without repeating) |

### How the loops were made

Tempo was found per track from the onset envelope (comb filter over 60-180 BPM, refined to 0.01 BPM), giving a beat grid; loop length is a multiple of 16 beats (4 bars) between 60 and 90 s, and the start is a bar line; (start, length) were chosen by comparing the spectrum beat by beat across the seam. The last 60 ms (rhythmic tracks) or 2.5 s (ambient `cs_fall` / `rest_sad`, which have no beat) of each loop are cross-faded (equal power) with the audio that precedes the loop start, so the end flows into the start. Measured seam distance (log-mel z-score of last vs first frame, 0 = as smooth as any two neighbouring frames): all loops 0.6-3.8 (`battle_gate` 3.8, `meet_dov` 3.3, `cs_golden` 2.6 are the roughest; none has a waveform click). `title`, `battle` and `battle_hollow` are exact-loop renders (11.29 s = 16 beats at 85 BPM, 74.25 s = 112 beats at 90.5 BPM, 72.8 s = 128 beats at 105.5 BPM, seam z 0.5-1.2), so they are kept whole with a 3 ms de-click. Loudness: gain then limiter (-1.4 dBFS), re-measured on the MP3 until within 0.35 LU of -16.

One-shots (`keepsake`, `recollection`) are cut to 72 s / 61 s at a bar line with a 3 s fade-out (the raws are 140 s / 106 s; at 96 kbps they would be 1.7 / 1.3 MB). `quill_intro` is the first 12 s of `boss` (its intro), 0.9 s fade-out. `boss` loops from 34.8 s, i.e. without its 15 s intro (which is `quill_intro`).

### Gaps (data in `audio.json` `music.aliases` / `music.procedural` / `music.loop`)

| key | filled with | why |
|---|---|---|
| `street` | alias -> `cs_forgotten` | default; calm, 111 BPM, fits the rain street |
| `records_office` | alias -> `cs_hush` | default; low and tense |
| `warm` | procedural (warm variant) | default (the engine already has `setMusicWarm` and the warm chord set) |
| `quill_intro` | file, 12 s one-shot from `boss` | as asked |
| `quill_rise` | procedural stinger | default |
| `boss_enraged` | alias -> `boss` (+ procedural intensity layer) | measured: `boss` is the heavier of the two: 160 vs 150 BPM, 4.7 LU louder in the raw (-9.1 vs -13.8 LUFS), more low-band energy (60 % vs 47 % below 200 Hz), lower spectral centroid (493 vs 531 Hz); `battle_gate` only has more note density (8.4 vs 6.2 onsets/s) |
| `ending` | procedural | default |
| `victory`, `memory_return`, `gameover` | procedural jingles | default |

`music.loop` has a true/false per key (every track and gap), `music.prefetchPolicy: "next-step"`, `music.crossfadeRangeMs: [500, 800]`, and `music.placement` is the full table (scenes, `cutscene_origin` ranges by shot index, dialogue, step, battle, overlay and event rules). Cutscene ranges use the FINAL order (cs_hush_mid inserted at index 22): golden 0-5, war 6-10, fall 11-17, hush 18-22, SILENCE 23 (the cs_hush_2 shot), forgotten 24-32; `currentOrderWithoutHushMid` has the same table for today's 32-entry file. Judgement call: Kostas's "shot 24 (cs_hush_2) SILENCE" is the cs_hush_2 shot, which in his numbering (hush_1 = 22, hush_mid = 23) is 24; "forgotten 25-30" starts at "When the light returned" and runs to the end.

### Credits

`credits.json`: `musicLine` is Kostas's exact one-line credit; `music[]` has Eric Skiff / xDeviruchi / Juhani Junkala entries (title and author are written in swapped order so the End screen format `Music: {title} — {author} ({license})` reads in Kostas's order) plus an "other artists" entry; the five unknown tracks are in `musicTodo[]` (author and license "TODO") rather than in `music[]`, so the End screen does not print "TODO" lines. README "Music" section updated with the same table. **Open an issue "Music credits: 5 tracks"** for `boss`, `battle_gate`, `cs_fall`, `recollection`, `rest_sad` (author and license unknown).

## Problems and decisions to look at

1. **Budget: the build is now about 20.3 MB against the 8 MB rule** (`npm run budget` exits 1; it was about 4 MB before). Music is 11.1 MB (16 files), cutscene art 3.4 MB, sprites 1.8, bg 1.8, portraits 1.1, sfx 0.5. Even without any music the build is 9.2 MB. Everything except the first load is lazy (first load before Title 0.66 MB), and the per-file spec (<= 1.2 MB, loops 60-90 s) was followed as written. Levers if Kostas wants to hit 8 MB: (a) a different budget rule that counts only what loads before Title / per step; (b) shorter loops (every 10 s less is 0.12 MB per track); (c) 64 kbps (-33 %); (d) alias `rest_sad` -> `cs_fall` (0.74 MB, see 2).
2. **`cs_fall.mp3` and `rest_sad.mp3` in the inbox are byte-identical** (same md5, 200 s). Both were processed (identical output). Probably one is the wrong upload; if `rest_sad` should be a different piece, replace it, or alias it to `cs_fall` and delete the file.
3. `title` is only 11.3 s (the raw is an exact 4-bar loop), below the 60 s guideline; it loops seamlessly.
4. Looped tracks start in the middle of the raw song (e.g. `battle_duel` at 33.6 s) because the best seam in the file was there; the first listen therefore starts "in the groove", not at the raw's intro.
5. Nothing else could not be fixed: both platform keys are clean.

## Sizes

- `public/assets` before: 4,013,066 bytes (4.0 MB). After: 20,805,463 bytes (21 MB by `du -sh`).
- `npm run validate`: 0 errors, 0 warnings. `npm run build`: OK. `npm run budget`: see below.

```
dist/: 183 files, download 20.31 MB (raw 21.60 MB)
first load before Title: 0.66 MB
by folder: audio/music 11.07, cutscene 3.38, sprites 1.81, bg 1.78, portraits 1.06, audio/sfx 0.54, assets 0.41, ui 0.19, fonts 0.06
x current build 20.31 MB > 8 MB (exit 1)
```
