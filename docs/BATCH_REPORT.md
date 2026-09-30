# Batch report — autonomous run, Wed 30 Sep 2026

Live: https://costgal.github.io/unremembered/ (every commit below was pushed to `main`, so each one deployed).

## ⚠️ Read first: the task list was missing
The batch prompt said "Run TASK 0 → TASK 7 below" but the list itself never arrived: the message ended after the rules. Since you said not to ask, I **inferred the 8 tasks** from STATUS.md's work order + the CLAUDE.md day plan (Thu → Sat), i.e. the rest of the P0/P1 code issues in the Demo milestone that aren't `manual`. If you had a different list in mind, compare it against the table below. Everything is in separate commits, so any of it can be reverted.

| Task | What | Issues | Commit |
|---|---|---|---|
| 0 | Chapter 1 data: b1 = Blank + Hollow, drop b2 (STATUS #10), `chapter1.json` | #57 (new) | `2cfdb48` |
| 1 | Combat kit (STATUS #8): Blast, Return to Sender, Anchor, Brace, technique submenu | #12, #45 | `231363a` |
| 2 | Enemy AI from JSON (windup hold, feint, Blank Lunge, Siphon) + win/lose/retry | #13, #14, #40 | `d086523` |
| 3 | Tutorial slow-mo parry + Nala cancel | #15, #16 | `db66b09` |
| 4 | ChapterRunner + Dialogue scene + draft chapter text | #20, #21, refs #22 | `0a1da5e` |
| 5 | Boss phases + Archive charge, Recollection, Keepsake event | #17, #18, #19 | `54e997a` |
| 6 | Cutscene system + 30-shot origin cutscene | #23, #24 | `bd325bc` |
| 7 | Title, Menu, Settings, End + credits, procedural SFX, music, mobile hardening | #30–#34, #36, refs #37 | `463c526` |
| — | Fix: scene-reuse soft-lock (dialogue → dialogue froze), found by a full headless playthrough | — | `dc79a7a` |

I moved ChapterRunner/Dialogue ahead of the boss because the Keepsake event needs the dialogue scene.

`npm run build` passed before every push. Each task got a headless Chromium check at 360×640 (screenshots plus scripted taps). At the end a scripted bot played **New Game → cutscene → all dialogues → b1 → boss (Keepsake + Recollection) → ending → End of Demo** with no errors. Real phones haven't been tested yet.

## Phone test URLs (dev params work on the live build)
Base: `https://costgal.github.io/unremembered/`
- Full game: `https://costgal.github.io/unremembered/` (Title → Menu → New Game)
- Chapter from step N (0-based, `chapter1.json`): `?step=0` cutscene, `?step=1` letter, `?step=2` meet Dov, `?step=3` b1, `?step=5` Records Office, `?step=6` boss, `?step=7` ending
- Tutorial battle: `https://costgal.github.io/unremembered/?battle=b1_tutorial`
- Techniques with full Echo: `https://costgal.github.io/unremembered/?battle=b1_tutorial&echo=10`
- Boss + Recollection right away: `https://costgal.github.io/unremembered/?battle=boss_clerk&echo=10`
- Keepsake quickly: `?battle=boss_clerk&echo=10`, then Recollection + Blasts to push the Clerk under 125 HP
- Animation preview (existing): `?animtest=1`
- `?echo=N` works with any `?battle=`.

## Per task

### TASK 0 — Chapter 1 data (#57, closed)
- **Works:** `battles.json`: b1 = `["blank","hollow"]`, `b2_hollows` removed, b3 kept (optional). New `src/data/chapter1.json`: origin → letter → meet_dov → b1 → after_b1 → records_office → boss → ending → end.
- **Decision:** CLAUDE.md still lists b2 in its examples. I left it as is, since STATUS wins.

### TASK 1 — Combat kit (#12, #45, closed)
- **Works:** Technique opens a submenu with Echo costs, greyed out when you can't pay. Back steps out. Strike: +1 Echo on hit (Rhea 5–6, Dov 7–9).
  - **Blast** (3): 3–6 bolts of 3–4. Each bolt has a 30% crit that adds a bolt, up to 10. The bolts fly while the blast sheet holds its aim frame, using the `blast_projectile` sheet.
  - **Return to Sender** (2): Rhea holds the `ability` guard frame and **draws the next enemy attack**. Any parry (GOOD or PERFECT) triggers a 14–18 counter on the ability's impact frame, ×1.5 on PERFECT. On MISS the guard drops.
  - **Anchor** (3): heals/revives 25. The target is automatic: a downed ally first, then the lowest HP share.
  - **Brace** (2): the party takes ×0.5 damage from the next enemy attack (all hits of that one attack).
- **Decisions:** only Strike generates Echo from hits; Blast doesn't give Echo per bolt, which would be +10 for 3. Anchor has no target picker, to keep taps down for non-gamers. `Relay` is gone from the data.
- **Placeholder:** Dov has no cast/ability sheets, so Anchor/Brace show a small hop.

### TASK 2 — Enemy AI, win/lose/retry (#13, #14, #40, closed)
- **Works:**
  - Weighted attacks. Enemies hold their `windupFrame` through the telegraph, then release so the impact frame lands exactly when the ring closes. An attack's own sheet (e.g. `blank_punch`) wins over `attack`. Without sheets, the lunge rig leans back `windupPx` and lunges on time.
  - Multi-hit attacks work. The feint ring freezes at `atPct` for `pauseMs`.
  - Blank: Punch 900 ms / 10, Lunge 600 ms / 8. Hollow Siphon: −2 Echo on a missed parry.
  - Downed enemies fade out.
  - Victory → "Tap to continue". Lose → "The memory fades…" + Retry, which restarts that battle from its start state.
- **Decisions:** HP doesn't carry between battles; every battle starts at full HP and 0 Echo (the simplest option for the Retry snapshot). Lunge damage is 8.

### TASK 3 — Tutorial + Nala (#15, #16, closed)
- **Works:**
  - Tutorial: in b1, every enemy hit runs at time scale 0.35 with the prompt "An attack is coming! Tap anywhere the moment the ring closes." until the first GOOD/PERFECT.
  - Nala: when a Hollow telegraphs she glows orange and the hint changes to "Nala senses a Hollow! Tap her!". Tapping her cancels the attack ("Nala hisses!"). Once per battle, never for Blanks. Her config is in new `src/data/allies.json`.
- **Decision:** during slow-mo the timing windows also stretch ×1/0.35, since the whole world is slowed. The rule in `qte.json` → `windows` is unchanged.
- **Placeholder:** Nala has no alert/hiss sheets yet (code glow + squash). They will be picked up automatically from `nala_animations.json`.

### TASK 4 — ChapterRunner + Dialogue (#20, #21 closed; #22 referenced, stays open)
- **Works:** New Game runs the whole chapter. Steps whose scene is missing are skipped.
  - Dialogue: background on top (with rain), text box at the bottom, 40 chars/s, tap = finish/next. Styles: normal / narration / letter (paper box).
  - Portraits: Rhea on the left, Dov/Clerk on the right, speaker lit and the other at ~40%.
- **Draft/placeholder:** **all dialogue text is my draft** from STORY.md beats. Every line has `"todo": true`, so rewrite freely in `src/data/dialogue.json`. #22 stays open for you.
  - Dov and Clerk portraits don't exist yet, so they show as grey placeholder boxes with the key name. Their keys are registered in `assets.json`, so the files will just work when dropped in `public/assets/portraits/`.
  - Ending: Dov's name shows as "▯▯▯". There's no real Aurelian silhouette image yet, just a narration line.

### TASK 5 — Boss, Recollection, Keepsake (#17, #18, #19, closed)
- **Works:**
  - Clerk phase 1 (Stamp, File Away 2-hit) → at ≤50% HP, phase 2 (Stamp, Redact with a feint, Archive).
  - Archive: 2 enemy turns of charging with a teal glow and an "Interrupt: n/40" counter. 40 party damage cancels it; otherwise it fires as a normal parry hit (30).
  - Keepsake: the battle pauses and `keepsake_burn` plays as an overlay. Then Echo = 10, a flash, and the Recollection button pulses.
  - Recollection: golden tint (swaps to `memory_city` when that art exists), cast loop, 3 gold rings 500 ms apart, 30/18/6 damage. A tap only counts for one ring.
- **Placeholder:** `records_office` background is missing, so a grey box with the label shows. The Clerk has no animation sheets, so he uses the lunge rig. The Clerk is the static 256×256 sprite.

### TASK 6 — Cutscene (#23, #24, closed)
- **Works:** all shot fields from CLAUDE.md, plus a `flip` on layers.
  - Auto-advance after `durationMs` (default 4500). Tap = finish/next. **Hold 800 ms = skip**, with a teal radial fill at the finger and a "Hold to skip" hint for the first 4 s.
  - It plays fully with zero art: black picture + text + particles/rain/flash.
  - It reuses the Blank/Hollow/Rhea sprites for shots 25–29.
- **Placeholder:** none of the cutscene art exists yet (`public/assets/cutscene/*.png`, keys registered). Layer positions/scales for Aurelian are guesses: tune them in `src/data/cutscene_origin.json`.

### TASK 7 — Title / Menu / Settings / End / Audio / Mobile (#30–#34, #36 closed; #37 referenced)
- **Works:**
  - Title → Menu. Menu: New Game | Chapter 2 🔒 | Arena 🔒 ("Coming soon") | Settings | Credits.
  - Settings: Music / SFX cycle 100→75→50→25→0%, Story Mode on/off, saved in localStorage.
  - End of Demo + credits (`credits.json`) → Menu.
  - Procedural SFX for hit/perfect/good/miss/menu/echo/ultimate (tuned in `audio.json`).
  - Music: looping, 500 ms crossfade, per scene/battle. Missing file = silence.
  - Audio suspends when the tab is hidden. iOS unlock uses a silent buffer, and the first tap anywhere also unlocks audio (for dev-param links).
  - **Pixelify Sans is now self-hosted** (`public/fonts`, latin subset, OFL.txt). Before this, the game was rendering in fallback monospace.
  - "Rotate your phone" overlay on short landscape screens.
- **Decisions:**
  - With no `logo.png`, the Title shows "UNREMEMBERED" as text instead of a grey box.
  - Music mapping: Menu = `title`, Cutscene + Dialogue = `cutscene`, battles = `battles.json` music, End = `ending`. Change it in `audio.json`.
  - #37 is referenced, not closed: the Instagram in-app browser still needs a real-phone pass (#38).
- **Placeholder:** no music files exist (#35), so the game is silent apart from SFX. Credits "A game by" and "Music" are marked `todo`.

## Known bugs / risks
- **Nothing tested on a real phone.** PERFECT timing, IG toolbars and iOS audio are unverified. Run the CLAUDE.md mobile checklist.
- Switching apps mid-ring: the ring runs on real time, so coming back after the impact time counts as a MISS. The battle state itself stays intact.
- Recollection rings overlap visually on the same spot. That reads as "rhythm", but it can look busy.
- Brace only covers one enemy's attack, not the whole enemy phase. Change it in code if you want the whole phase.
- Placeholder boxes (Dov/Clerk portraits, `records_office`) are visible in the chapter until their art lands.
- The `▯` glyph isn't in Pixelify Sans, so it falls back to the system font.

## Files added
`src/data/{chapter1,techniques,allies,battleEvents,dialogue,cutscene_origin,credits,audio}.json`, `src/systems/{CommandMenu,ChapterRunner,DevParams,Button}.js`, `src/scenes/{Dialogue,Cutscene,Menu,Settings,End}Scene.js`, `public/fonts/*`.

STATUS.md was not updated. Worth a pass: the "In progress" and "Work order" sections are now stale.
