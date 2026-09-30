# Batch report 2: autonomous run, Wed 30 Sep 2026 (evening)

Live: https://costgal.github.io/unremembered/. Every commit below was pushed to `main`, so each one deployed.
The batch message arrived complete (it ended with "END OF BATCH").

| Task | What | Issue | Commits |
|---|---|---|---|
| T1 | App-switch pause, readable Recollection rings, Echo audit, data validation | #59 (closed) | `3e70c7e` |
| T2 | Sheet readiness for every character, `?fakesheets=1`, `?animtest=1&char=` | #60 (closed) | `e3fe24b` |
| T3 | Title art slots, background loading, size budget, FPS meter | #61 (closed) | `da3f178` |
| T4 | Tutorial hints, feedback juice, readability | #62 (closed) | `c49c64b` |
| T5 | Balance simulation + HP tuning | #63 (closed) | `3b79d30`, plus `scripts/sim.mjs` / `src/data/sim.json`, which landed early as a draft inside `da3f178` |
| T6 | Automated playtest + this report | #64 (closed) | the commit that adds this report |
| T7 | First-run difficulty choice | #65 (closed) | `43c6ec4` |

Before every push: `npm run build` passed, `npm run validate` showed 0 errors, and a headless Chromium check ran at 360×640 (details per task).

New dev commands:

| Command | What |
|---|---|
| `npm run validate` | Cross-checks every JSON in `src/data` + the sprites' `*_animations.json` (the same checks print `[validate]` lines in the dev console at boot) |
| `npm run budget` | Download size of `dist/` + a projection with the art/music still to come (run after `npm run build`) |
| `npm run sim` | Balance simulation (`-- --runs 5000`, `-- --battle boss_clerk`, `-- --set enemies.clerk.hp=400`, `-- --json`) |
| `npm run perf` | Load time to Title (4G / Slow 4G, CPU 4×) + FPS under CPU throttling (`-- --load` / `-- --fps`) |
| `npm run playtest` | Headless bot plays the whole demo, with real sheets and with `?fakesheets=1` |

`perf` and `playtest` need Playwright. It isn't a project dependency; the scripts use whatever is already installed (it is in Claude Code's cloud container) and skip cleanly if it's missing.

## Phone test URLs
Base: `https://costgal.github.io/unremembered/`. The dev params work on the live build.

| What | URL |
|---|---|
| Full game | `https://costgal.github.io/unremembered/` |
| App-switch pause (T1) | `https://costgal.github.io/unremembered/?battle=b1_tutorial`: wait for a ring, switch to another app, come back → "Paused / Tap to continue" → the same attack starts again |
| Recollection 1/3 rings (T1) | `https://costgal.github.io/unremembered/?battle=boss_clerk&echo=10` → Recollection |
| Every animation path with stand-in sheets (T2) | `https://costgal.github.io/unremembered/?battle=boss_clerk&fakesheets=1&echo=10` and `?battle=b1_tutorial&fakesheets=1` |
| Animation preview per character (T2) | `?animtest=1&char=clerk&fakesheets=1` (also `rhea`, `dov`, `blank`, `hollow`, `nala`; drop `&fakesheets=1` to see only real sheets) |
| FPS meter (T3) | `?fps=1` (any screen), e.g. `?battle=b1_tutorial&echo=10&fps=1` |
| Tutorial hints + juice (T4) | `?battle=b1_tutorial` (hints show once per page load) |
| Low-HP pulse | any battle, take hits until a hero is under 25% |
| Chapter from step N | `?step=0` … `?step=7` (as before) |
| First-run difficulty (T7) | a fresh browser (or a private tab) → New Game. Once chosen, it never asks again on that phone (Settings → Story Mode still toggles) |

## T1: Robustness (#59)
**App switch.**
- When the page goes to the background, the battle pauses (Phaser's `HIDDEN` event): scene, tweens, timers, time scale and rings all stop.
- Live rings stop **without a judgement**. Even an early tap that was waiting for T is dropped.
- On return, a "Paused / Tap to continue" overlay (`PauseScene`) waits for a tap. The interrupted telegraph then restarts from the beginning: the enemy's attack animation drops back to idle and the ring, the windup and the tutorial slow-mo all run again.
- Recollection re-runs only the ring that was interrupted.
- A battle already paused by the Keepsake dialogue is left alone. Audio already suspends/resumes on visibility (`Audio.js`).
- Headless: hidden mid-ring → 0 rings, HP unchanged; back → paused + overlay; tap → the ring restarts and resolves normally. Recollection: ring 1 MISS, ring 2 interrupted → exactly 3 hits in total (250 → 232).

**Recollection rings.** They are now **sequential**: each ring starts `intervalMs` (500) after the previous ring's impact, so they never overlap. A gold "1/3 · 2/3 · 3/3" counter pops above the ring, and each ring gets its own PERFECT/GOOD/MISS text and damage. The whole Recollection now takes ~4.2 s instead of ~2 s.

**Echo audit** (CLAUDE.md > Echo):
- Correct already: Strike +1 on hit, GOOD +1, PERFECT +2, clamped 0–10, spending per `techniques.json`.
- **Mismatch fixed:** Blast gave 0 Echo. It now gives +1 per landed volley (`techniques.blast.echoOnHit`).
- *Decision:* "a player hit that lands" = one player attack. One per bolt would make Blast Echo-positive (cost 3, gain 3–10).
- *Decision:* parry counters (the PERFECT counter, Return to Sender) give no extra Echo; they are the parry's reward, which already gives +1/+2.
- *Decision:* Recollection hits give none (Echo → 0 per the spec).

**Validation.**
- `src/systems/Validate.js` is shared by `npm run validate` (Node, which also checks sheet files on disk) and the dev boot (console only; not in the production bundle).
- It checks:
  - chapter steps → cutscene/dialogue/battle ids and dialogue backgrounds
  - battles → enemies and backgrounds
  - dialogue → speakers, portrait keys, styles, lines > 90 chars (warning)
  - characters → techniques, body/part sprites
  - enemies → telegraph/damage, phase events
  - Keepsake dialogue id
  - cutscene shots → images, fx, moves, splits
  - `*_animations.json` → frames vs `durations_ms`, marker frames in range, projectile, and sheet files present or `"optional": true`
- **Real errors found and fixed (data only):** `dov_animations.json` lists `dov_idle.png` and `dov_attack.png`, which aren't in the repo. Both are now marked `"optional": true`.
- **Warnings left for you (text untouched):** `letter[3]` 136 chars, `meet_dov[7]` 92, `after_b1[1]` 98.

## T2: Sheet readiness (#60)
Everything in `docs/ART_BRIEF.md` is wired and data-driven. Every animation falls back to the old code behaviour when its sheet is missing.

- **Enemy attacks** are driven frame by frame (`SheetDriver`):
  - The `windupFrame` is held through the telegraph.
  - Impact frame *k* lands exactly on ring *k*: File Away's 2 impacts hit on its 2 rings.
  - Redact's `holdFrame` (~60%) pauses for the ring's feint pause.
  - An attack's own sheet (`attack.anim` or its id, e.g. `blank_punch`) wins over `attack`.
  - With fewer impact frames than hits, the sheet replays for each hit.
- **Archive:** `archive_charge_in` → `archive_charge` loop while charging (a hurt during the charge returns to the loop) → `archive_charge_out` → `archive_release`. Set in `enemies.json` as `anim` / `chargeAnim`.
- **Dov:**
  - Anchor = `cast` (_in → one loop → _out); the heal lands at the end of the loop.
  - Brace = `brace`, else `cast`; the effect lands on its impact frame.
  - Without sheets: the old hop. Set in `techniques.json` `anims`.
- **Rhea:**
  - Blast bolts start at `spawn_px` (mirrored for the right-facing hero) and use the sheet's `projectile`.
  - Return to Sender guard and Recollection `cast` _in/loop/_out as before.
- **Reactions** (only for characters with the sheet): PERFECT → `parry` (the counter lands on its impact frame), GOOD → `dodge` (the damage still applies; no hurt), MISS → `hurt`.
  - *Decision:* the Clerk's `parry`/`dodge` load and preview, but nothing triggers them. The Clerk never defends in a QTE, and ART_BRIEF says the rule is TBD.
- **Death and victory:** enemy death sheet → then the enemy fades; heroes hold the last death frame; `victory` holds its last frame.
- **Nala:** `idle` / `alert` (loop while a Hollow telegraphs) / `hiss` (impact).
- **Bug found and fixed (a real soft-lock):**
  - Phaser sets `isPlaying = false` on a paused animation, so replacing it emits no stop event.
  - A PERFECT counter's `hurt` on an enemy frozen on its impact frame left the enemy turn waiting forever. The headless bot found it in the boss.
  - Now any other animation starting on the sprite ends the paused one.
- **`?fakesheets=1`:**
  - For every character and animation in `src/data/animSpecs.json` (ART_BRIEF frame counts, sizes and flags; Clerk 256, Nala 64) that has no real file, a stand-in sheet is drawn in memory. Nothing is written to disk.
  - Frames are coloured by kind (plain / amber windup / red impact / teal hold) and labelled with the anim name + frame number over the faded body. Labels are pre-mirrored for right-facing characters.
  - Real sheets and their JSON always win. It works on the live build like the other dev params.
- **`?animtest=1&char=<id>`** previews any character (real or fake), positioned by frame size and facing the way it does in battle.
- **Headless coverage** (bot plays b1 and the boss with `?fakesheets=1`, two passes with different QTE mixes):

| Path | Hit |
|---|---|
| idle loops: Rhea, Dov, Blank, Hollow, Clerk, Nala | ✓ |
| Strike impact frame → damage (Rhea, Dov) | ✓ |
| enemy windup held + impact on T: blank_punch/lunge, hollow_claw, hollow_siphon, clerk_stamp, clerk_file_away (2 impacts), clerk_redact | ✓ |
| holdFrame: rhea_blast, rhea_ability, clerk_redact (feint) | ✓ |
| projectile rhea_blast_projectile | ✓ |
| _in / loop / _out: rhea_cast, clerk_archive_charge, dov_cast | ✓ |
| clerk_archive_release impact | ✓ |
| dov_brace impact | ✓ |
| parry (PERFECT) / dodge (GOOD) / hurt (MISS): Rhea + Dov | ✓ |
| enemy hurt: Blank, Hollow, Clerk | ✓ |
| death: Blank, Hollow, Clerk (then fade) | ✓ |
| victory: Rhea + Dov | ✓ |
| Nala alert + hiss | ✓ |

  49/49 paths, 0 code fallbacks, 0 errors, every battle won. Without fake sheets, b1 and the boss also win with 0 errors, and 17 code-fallback paths run (lunge, knockback, fade, hop, glow…).

## T3: Title art, loading, budget, FPS (#61)
**Title art slots.** Both files are `optional` in `assets.json`: no grey placeholder, the text title stays.
- `public/assets/ui/logo.png` (720×207, transparent)
- `public/assets/ui/title_bg.jpg` (720×1280)

When both are present:
- The background covers the screen with a slow drift/zoom (6% over 14 s).
- Rain (45) and 12 teal motes sit in front.
- The logo is 90% wide at 4% from the top.
- "Tap to start" (y 520) and the silent-mode hint (y 556) sit over a dark gradient.

Checked with temporary generated test images, which were deleted and not committed. Tune the layout in `ui.json > title.art`.

**Filtering.** LINEAR for `ui`, `portraits` and `cutscene` (`assets.json > loading.linear`). Sprites and pixel backgrounds stay NEAREST.

**Loading.**
- Boot waits only for the font (now also `<link rel=preload>` in `index.html`).
- A persistent, invisible `LoaderScene` loads the rest one section at a time: ui → cutscene → sprites → backgrounds → portraits → sheets (including the `*_animations.json` fetches), then prefetches the music bytes (decoded on play).
- Each scene waits only for its own sections (`assets.json > loading.scenes`); a requested section jumps the queue.
- "Loading…" fades in only if the wait lasts more than 150 ms.

**Load time to an interactive Title** (production build, gzip, CPU 4×, headless):

| Network | Before | After |
|---|---|---|
| 4G (9 Mbps, 85 ms) | 2.39 s | **2.10 s** |
| Slow 4G (1.6 Mbps, 150 ms) | 4.15 s | 3.75 s |

The JS bundle (Phaser) is 0.36 MB gzip, most of the first load. The title art will add ~0.25 MB (≈ +0.2 s on 4G).

**Budget** (`npm run budget`):
- Current download: **1.87 MB** (3.03 MB raw); first load before Title: 0.37 MB.
- Projection with 2.5 MB cutscene JPGs + 6 MB music + the registered-but-missing art (9 portraits ≈ 1.28 MB, 2 backgrounds ≈ 0.37 MB, title art ≈ 0.30 MB) = **12.3 MB, over 8 MB by 4.3 MB**.
- ⚠️ The budget numbers conflict on their own: 6 MB audio + 2.5 MB cutscene is already more than 8 MB.
- Levers:
  - music ≤ 3 MB (5 loops at 96 kbps mono ≈ 0.7 MB/min)
  - cutscene JPGs ~40–70 KB each at 360×360, quality ~75
  - portraits are the largest folder (7 × ~140 KB PNG)

**FPS** (`?fps=1` on the phone; `npm run perf` headless):
- Headless Chromium renders WebGL in software, so these numbers are pessimistic and only useful for comparison:

| Scene | CPU 1× | CPU 4× |
|---|---|---|
| Title | 60 | 56 |
| b1 battle, idle | 54 | 36 |
| b1 battle, bot playing + Recollection | 52 | 34 (p5 31) |

- Turning the rain off or halving it changed nothing (33–34), so **particle counts were not reduced**.
- The cost is fill rate from the full-screen vignette (−7 fps) and lantern glows (−5 fps) in software rendering. They should be cheap on a real GPU at 360×640.
- **Check `?fps=1` on the older phone.** If it's under ~50 in rain, remove `vignette` or `lights` from `environments.json > street_rain` first.

## T4: Juice + clarity (#62)
**Tutorial hints** (b1 only, `ui.json > tutorial`):
- A top banner, one at a time, **once per session** (a Retry doesn't repeat them).
- A hint waits while another is showing.
- The next tap anywhere dismisses it, and that tap still counts in the game; the banner also goes after 5 s, or when the player does the thing.

| Hint | When |
|---|---|
| "Tap Strike to attack" | Rhea's first turn; Strike pulses |
| "Tap anywhere when / the ring closes!" | the existing slow-mo prompt, shortened |
| "Good timing charges Echo" | first GOOD/PERFECT |
| "Techniques spend Echo" | first turn with Echo ≥ a technique's cost; Technique pulses |
| "Nala senses a Hollow! Tap her!" | as before |

**Feedback:**
- **Buttons:** a tick, a dip to 93% and a lighter fill for 120 ms, then the action; double taps during the dip are ignored.
- **Active hero:** a bobbing teal marker over the head + a teal name in the HUD.
- **Targets:** bobbing yellow markers over each valid enemy.
- **Damage numbers:** pop in, then rise.

  | Type | Look |
  |---|---|
  | normal | white |
  | crit (Blast) | gold, 20 px |
  | damage to heroes | salmon |
  | heal | green |
  | Echo | teal "+N" over the pip it fills |

- **Echo pips:** fill one after another (60 ms stagger), flashing white, then teal.
- **Low HP (< 25%):** a pulsing red frame around the bar + a red name.
- **Victory:** a band across the scene, the word pops in, plus a short procedural sting (`audio.json > sfx.victory`).
- **Dashes:** eased (`Cubic`), still 180 ms.
- **Haptics:** `navigator.vibrate` 15 ms on PERFECT / 30 ms on MISS (`qte.json > results.*.vibrateMs`), in try/catch. Off when the SFX volume is 0; iOS ignores it.

**Readability:**
- **Command buttons:** 58 px tall. Rows moved to y 486/548, so the bottom edge is at 577.
- **Other positions:**
  - Dialogue box: 150 px, so text and ▼ end by y 574.
  - Title silent hint: y 566, 12 px.
  - End hint: y 566.
  - Settings Back: y 540.
  - "Hold to skip": y 576, readable grey.
- **Contrast:**
  - Cost labels: 12 px.
  - Disabled text: 4.5:1 (was ~2.6:1).
  - Enemy labels: stroked.
  - Floating text is kept 16 px from the edges.
- **Headless layout audit:**
  - Screens checked: Title, Menu, Settings, cutscene, dialogue, battle menu / techniques / target, End.
  - 0 text under 12 px.
  - 0 text within 16 px of an edge.
  - Nothing tappable or textual below y 580 (the IG-toolbar margin).
  - All buttons ≥ 56 px.
  - All text colours ≥ 4.5:1 on their background.

## T5: Balance (#63)
**How the simulation works.** `scripts/sim.mjs` mirrors the battle rules:
- turn order, weighted attacks and phases, multi-hit, feint, Archive charge/interrupt
- Keepsake, Nala, Brace, Return to Sender, Blast crits, Anchor revive
- Story Mode, tutorial slow-mo

It plays 2000–4000 runs per cell.

**QTE model.**
- A tap error follows a biased Gaussian plus a lapse rate (no useful tap), solved so the real windows reproduce each profile. A centred Gaussian can't make PERFECT as rare as 15/50.
- Story Mode's ×1.5 windows then shift the odds the way they would for a real player.

| Profile | P/G/M (Normal) | Solved as | P/G/M (Story Mode) |
|---|---|---|---|
| non-gamer | 15/35/50 | late by 200 ms, σ 106 | 27/56/17 |
| average | 30/45/25 | late by 116 ms, σ 70, 15% lapses | 52/33/15 |
| good | 55/35/10 | late by 68 ms, σ 82, 5% lapses | 75/20/5 |

**Player policy:**
- Recollection at 10; Dov doesn't spend a full bar.
- Dov: Anchor when someone is under 40% (downed first); Brace while Archive charges.
- Rhea: Blast at ≥ 3 Echo, else Return to Sender half the time at 2 Echo, else Strike.
- Nala is tapped 70% / 85% / 95% of the time.

**Time model:**
- Think time: 3.5 / 2.2 / 1.4 s per turn, + 0.9 s to pick a target.
- Animation times are the real sheet sums; each hit adds its telegraph (slow-mo in the tutorial) + 0.7 s.
- Keepsake dialogue 25 s; tutorial hint reading 10 s.
- **Calibrated against the real game** (headless bot, zero think time):
  - b1: 18–24.5 s real vs 21 s simulated.
  - boss: 58–76 s real vs ~90 s simulated. The sim includes 25 s of Keepsake reading that the bot skips.

**Tuning:** JSON only; no QTE windows, damage or costs changed.

| Enemy | HP before | HP after |
|---|---|---|
| Blank | 30 | 80 |
| Hollow | 45 | 110 |
| The Clerk | 250 | 430 |

**Before → after** (Normal mode; win % / mean minutes, p10–p90):

| Battle | Profile | Before | After | Target |
|---|---|---|---|---|
| b1_tutorial | non-gamer | 100% / 1.0 (0.9–1.2) | **100% / 2.0 (1.7–2.3)** | ≥95%, 2–3 min |
| b1_tutorial | average | 100% / 0.8 | 100% / 1.5 | |
| b1_tutorial | good | 100% / 0.7 | 100% / 1.2 | |
| boss_clerk | non-gamer | 99.5% / 2.6 (2.2–3.1) | **77.3% / 4.2 (3.5–5.0)** | 70–85%, 4–6 min |
| boss_clerk | average | 100% / 1.9 | **99.5% / 3.0** | ~95% |
| boss_clerk | good | 100% / 1.5 | 100% / 2.3 | |

**Story Mode** (non-gamer): b1 100% / 1.8 min; boss **100%** / 3.5 min (target ≥ 98%). Average and good: 100% everywhere.

**Other boss stats** (non-gamer → average → good, after):

| Stat | non-gamer | average | good |
|---|---|---|---|
| Recollection per fight | 0.93 | 1.10 | 1.45 |
| Archive attempts per fight | 1.64 | 1.24 | 1.01 |
| Archive interrupted | 16% | 22% | 24% |
| mean Echo | 2.1 | 2.6 | 3.0 |

**Chapter length** (cutscene 2.2 min + current draft dialogue 1.8 min + battles incl. expected retries): **non-gamer ≈ 11.4 min**, average ≈ 8.5, good ≈ 7.5. With the ~3 min of dialogue the brief assumes, that's ≈ 12.6 / 9.7 / 8.7 min.

**Decisions / caveats:**
- b1 at 2–3 min needs ~2.5× the old HP. I stopped at the low end (2.0 min), because more HP only adds rounds of the same two enemies. If it feels grindy on the phone, −10 HP on each enemy ≈ −10 s.
- Average players win the boss ~99.5% (target ~95%). Non-gamer (77%) and average (99.5%) can't both hit their targets by HP alone with this damage table. I prioritised the non-gamer target, since the judges are non-gamers.
- The chapter reaches 12–15 min only for non-gamers. For others it depends on the final dialogue length.
- All numbers are estimates (about ±20% on time). `npm run sim -- --set path=value` tries changes without editing JSON.

## T6: Automated playtest (#64)
**The bot** (`scripts/playtest.mjs`, logic in `scripts/lib/bot.mjs`) plays like a player, with real mouse taps at 360×640:
- Title → Menu → New Game (the T7 panel → Normal) → cutscene (tap through) → letter → meet_dov → b1 → after_b1 → records_office → boss (Keepsake + Recollection) → ending → End of Demo → Menu.
- Parry rings are tapped on time with a "good" mix: PERFECT on T, GOOD 145 ms late, MISS no tap.
- Nala is tapped when she glows. Techniques rotate: Rhea Blast / Return to Sender / Strike, Dov Brace / Anchor / Strike, Recollection when full.
- **It fails on:** any console or page error, a soft-lock (20 s without any change of scene, line, turn, HP, Echo or ring), a chapter step never reached, or 20 min in total.
- Art files that aren't delivered yet are expected and are only counted.
- Final run, at the end of the batch:

```
▶ real sheets:  cutscene 1.9s → letter 18.7s → meet_dov 21.0s → b1 27.4s → after_b1 79.5s → records_office 82.4s
                → boss 85.9s → keepsake_burn 128.8s → boss 131.5s → ending 168.7s → End 172.3s → Menu
▶ ?fakesheets=1: same order, End at 204.4s → Menu
  ✓ real  174s  retries 0  QTE P/G/M 16/14/5  Nala 1  anim events 35  missing art files 23
  ✓ fake  206s  retries 0  QTE P/G/M 15/16/5  Nala 1  anim events 71  missing art files 23
```
0 console errors, 0 soft-locks, every chapter step reached, both boss fights won on the first try. (The 23 missing files are the art not delivered yet: portraits, cutscene, records_office, memory_city, title art.)

- **Bugs the bot found this batch:** the paused-animation soft-lock (T2) and the stale ring shown under the pause overlay (T1). Both are fixed.
- **Manual equivalent** (when Playwright isn't available): open the live link and play New Game to the end.
  - Take at least one PERFECT, one GOOD and one MISS; tap Nala once.
  - Use every technique; let the Keepsake fire, then Recollection.
  - Switch apps mid-ring once.
  - Reach End of Demo → Menu. The dev console must stay free of red errors apart from missing-art 404s.
  - Repeat once with `?fakesheets=1`.

## T7: First-run difficulty choice
- **Issue #65** (closed by `43c6ec4`).
- The very first New Game shows a panel over the menu: "How do you like your fights?" → **Story (easier timing)** / **Normal** + "You can change this any time in Settings."
- The choice sets Story Mode and `difficultyChosen` in the saved settings (localStorage), so it's asked once. Settings keeps its Story Mode toggle.
- Headless:
  - The panel shows; the choice is saved (`storyMode: true, difficultyChosen: true` in localStorage).
  - After a reload, New Game goes straight to the cutscene.
  - The playtest answers "Normal".
- Text and layout: `ui.json > menu.difficulty`.

## Known bugs / risks
- **Still nothing tested on a real phone.** FPS numbers are software-rendered. Real GPU and Instagram-browser behaviour (visibilitychange on app switch, vibrate, toolbar height) need your pass. Use the URLs above.
- **Recollection is ~2 s longer** now that the rings are sequential.
- **b1 is longer** (8 rounds instead of 4). It's the main pacing risk; the levers are in `enemies.json`.
- **Download budget:** the projected total with all art and music is ~12.3 MB against the 8 MB target. Compress music and cutscene JPGs (see T3).
- **Clerk parry/dodge sheets load but never play** (rule TBD).
- **`dov_animations.json`** references sheets that don't exist yet, now marked `optional`. When Fable delivers Dov, its new JSON replaces this one.
- Tutorial hints are once per page load, by design.
- The `?fakesheets=1` stand-ins also work on the live build (like the other dev params). Don't share those links.

## Please update in STATUS.md (I didn't edit it)
- **Done:**
  - #59 app-switch pause + Recollection 1/3 rings + Echo audit + validation
  - #60 sheet readiness for all characters + `?fakesheets=1` + `?animtest=1&char=`
  - #61 title art slots + background loading + budget/perf/FPS tools
  - #62 tutorial hints + juice + readability pass
  - #63 balance sim + HP tuning
  - #64 playtest
  - #65 first-run difficulty choice (Story / Normal)
- **Art pipeline:**
  - Any character's sheets now play as soon as `<id>_<anim>.png` + `<id>_animations.json` land in `public/assets/sprites/` (flags per ART_BRIEF).
  - Enemy attack sheets are named after the attack id (`blank_punch`, `clerk_stamp`…).
  - Archive uses `clerk_archive_charge(_in/_out)` + `clerk_archive_release`; Dov's Brace uses `dov_brace`, falling back to `dov_cast`.
- **New art slots:** `public/assets/ui/logo.png` (720×207) and `ui/title_bg.jpg` (720×1280), both optional.
- **Balance:** Blank 80 / Hollow 110 / Clerk 430 HP, set by simulation. Replace STATUS's numbers if you keep a copy.
- **Budget decision needed:** the 8 MB target doesn't fit 6 MB of music + 2.5 MB of cutscene art. Pick new caps (suggestion: music ≤ 3 MB, cutscene ≤ 1.5 MB).
- **Layout:** command buttons are now 58 px and end at y 577 (nothing important below y 580 for the IG toolbar).
- **Dialogue length check:** `npm run validate` warns on 3 lines over 90 chars.
- **New habits:**
  - `npm run validate` before pushing data.
  - `npm run budget` after adding art/music.
  - `npm run sim` after changing numbers.
  - `npm run playtest` before the final deploy.
