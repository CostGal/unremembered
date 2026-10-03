# Unremembered — Build Spec

## What this is
A 2D turn-based RPG **demo** with real-time parry QTEs, built for a 1-week game jam.
- Played on **phone browsers**, mostly the **Instagram in-app browser**. Portrait. No install, no login.
- Judges are mostly **non-gamers** scoring 1–10 on "how good and how fun".
- Target playtime: **12–15 min**.
- **Deadline: Sat 3 Oct 2026, 16:00 (Greece).** Teaser screenshot: **Wed 30 Sep**.
- All story, characters and cutscene text: `docs/STORY.md` (source of truth for text).
- The game's text is in **English**.

## Rules for Claude Code (read every session)
1. **Start of session:** run `gh issue list --state open --milestone "<current milestone>" --json number,title,labels`. Pick the highest-priority open issue (P0 > P1 > P2) that is **not** labeled `manual`. Tell Kostas which one you picked before starting.
2. **One issue per session.** When it's done: `npm run build` must pass, commit with `Closes #N`, push to `main` (auto-deploys). End with 1–3 lines on how to test it on the phone.
3. **Never expand scope.** Any new idea (Kostas's or yours) becomes `gh issue create --label idea --milestone "Post-jam" --title "..."`, and then you continue the current issue.
4. **Content is data.** Stats, text, timings, battle lists and cutscene shots live in JSON under `src/data/`. No hardcoded numbers or strings in systems code.
5. **Missing art never blocks code.** If an asset file is missing, the loader draws a placeholder (colored rectangle with a label, same display size) and the game keeps working.
6. **No new dependencies** beyond Phaser and Vite without asking.
7. Kostas works about 1 hour per day. **A playable state beats a perfect partial system.** Stop at a working point.
8. **"Next mechanic issue"** (or "next mechanical issue") means: pick the next open issue labeled `mechanics` that needs nothing from Kostas, so you can run it autonomously. Skip anything labeled `manual` and anything that waits on his art, music, text or a phone test. Order: P0 > P1 > P2, then lowest number. Say which one you picked, then start. A plain "next issue" still follows rule 1.

## Stack
- **Phaser 3** (latest 3.x), **Vite**, plain **JavaScript** (ES modules).
- `vite.config.js`: `base: './'`.
- **GitHub Pages** via Actions: `.github/workflows/deploy.yml` → checkout → setup-node 20 → `npm ci` → `npm run build` → `actions/upload-pages-artifact` (path `dist`) → `actions/deploy-pages`. Trigger on push to `main`.
- Font: **Pixelify Sans** (OFL, Google Fonts), self-hosted in `public/fonts/`. Wait for `document.fonts.load(...)` in Boot before creating any text.
- No backend. `localStorage` only for settings (always wrapped in try/catch).

## Display & input
- Logical resolution **360×640**, portrait. `pixelArt: true`, `roundPixels: true`, `Scale.FIT`, `autoCenter: CENTER_BOTH`, background `#0b0d14`.
- Landscape → full-screen overlay "Rotate your phone".
- `index.html` viewport: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`.
- CSS on html/body/canvas: `touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; overscroll-behavior:none;` height `100dvh`. Block `contextmenu`.
- Tap targets ≥ 56px tall, ≥ 16px from screen edges.

## File structure
```
index.html
vite.config.js
public/
  fonts/
  assets/
    sprites/    rhea_body.png, rhea_arm.png, dov.png, blank.png, hollow.png, clerk.png, nala.png
                <character>_<anim>.png sheets + <character>_animations.json (see Assets pipeline > Sprite-sheet animations);
                body PNG + optional part PNGs for the rig fallback
    bg/         street_rain.png, records_office.png, memory_city.png
    cutscene/   city.png, reliquary.png, battlefield.png, council.png, statue.png, exile_close.png,
                aurelian_king.png, aurelian_exile.png   (cutouts are transparent PNGs)
    portraits/  rhea_sad.png, dov_*.png, clerk_*.png, nala.png   (flat #FF00FF background, keyed out at load)
    ui/         logo.png, letter.png
    audio/music/  title, cutscene, battle, boss, ending (.mp3)
src/
  main.js                 Phaser config + scene list
  scenes/
    BootScene.js          fonts, settings
    PreloadScene.js       loads data/assets.json; placeholders for missing files
    TitleScene.js         logo + "Tap to start" (unlocks audio)
    MenuScene.js
    SettingsScene.js
    CutsceneScene.js
    DialogueScene.js
    BattleScene.js
    EndScene.js           "End of Demo" + credits
  systems/
    ChapterRunner.js      walks data/chapter1.json
    BattleStateMachine.js
    Qte.js                ring timing + judgement
    Echo.js
    Fx.js                 hitstop, shake, flash, particles, damage numbers, rain, tints
    Audio.js              unlock, music, procedural SFX (Web Audio)
    Settings.js
  data/
    assets.json characters.json enemies.json techniques.json battles.json
    chapter1.json dialogue.json cutscene_origin.json credits.json
.github/workflows/deploy.yml
scripts/bootstrap-issues.sh
docs/STORY.md
_art/                       source art: raw downloads + PSDs. Committed, never loaded by the game.
```

## Game flow (state machine)
```
Boot → Preload → Title ("Tap to start") → Menu
Menu: New Game | Chapter 2 🔒 | Arena 🔒 | Settings | Credits
      (locked items show "Coming soon" on tap)
New Game → ChapterRunner(chapter1.json) → EndScene → Menu
```
`chapter1.json`, an ordered list of steps. Reordering the story = editing this file:
```json
[
  {"type": "cutscene", "id": "origin"},
  {"type": "dialogue", "id": "letter", "bg": "black"},
  {"type": "dialogue", "id": "meet_dov", "bg": "street_rain"},
  {"type": "battle",   "id": "b0_duel"},
  {"type": "dialogue", "id": "after_duel", "bg": "street_rain"},
  {"type": "battle",   "id": "b1_forgotten"},
  {"type": "reward",   "id": "reward_1"},
  {"type": "dialogue", "id": "after_b1", "bg": "street_rain"},
  {"type": "battle",   "id": "b2_first_hollow"},
  {"type": "dialogue", "id": "before_gate", "bg": "street_rain"},
  {"type": "battle",   "id": "b3_gate"},
  {"type": "reward",   "id": "reward_2"},
  {"type": "dialogue", "id": "records_office", "bg": "records_office"},
  {"type": "battle",   "id": "boss_clerk"},
  {"type": "dialogue", "id": "ending", "bg": "records_office"},
  {"type": "end"}
]
```
(Story v2: 15 steps, `?step=0..14`; `end` closes the list. See `docs/STATUS.md` > Story v2.)
- **Losing a battle** → "The memory fades…" + a Retry button. Retry restarts the same battle with party HP/Echo restored to the battle-start snapshot. There is no game over screen.

## Battle
### Layout (360×640)
- **y 0–360:** scene. Background, heroes on the left facing right, enemies on the right facing left, baseline y ≈ 300.
- **y 360–440:** party status: per hero a name, HP bar and that hero's own Echo pips (teal; Rhea 10 with the locked ones dim, Dov 5).
- **y 440–640:** command buttons in a 2×2 grid. During the enemy turn this whole lower area becomes the **tap zone**, with the hint "Tap when the ring closes".

### Turn state machine
```
INTRO (enemies slide in, 1s)
→ PLAYER_TURN(Rhea) → PLAYER_TURN(Dov)
→ ENEMY_TURN: for each living enemy → TELEGRAPH → QTE → RESOLVE
→ END_CHECK → next round
WIN → "Victory" → runner.next()      LOSE → Retry
```
- A downed hero skips turns. Both heroes down = LOSE.
- **Commands:** Strike | Technique | Recollection (Rhea only, shown when Echo = 10).
- **Targeting:** with one enemy, the target is automatic. Otherwise tap an enemy sprite (valid targets highlighted). A Back button cancels.
- **Player attack FX:** dash to the target (180ms tween) → attack anim → white flash 60ms + 2px shake + damage number → dash back.

### Parry QTE (the core feel — tune this carefully)
- **Telegraph:** the enemy holds its attack sheet's `windupFrame` (or, on the rig fallback, the `windupT` keyframe) (its windup/telegraph pose — see Assets pipeline > Attack rig). A ring appears around the targeted hero and shrinks from radius 48 → 14 over `telegraphMs`. The moment it reaches 14 is the impact time **T**.
- **Input:** the first `pointerdown` during ENEMY_TURN (anywhere in the lower half, or anywhere at all). Debounced.
- **Judgement on |t − T|:**
  - ≤ 90ms → **PERFECT**: 0 damage, +2 Echo, counter for 4 damage.
  - ≤ 200ms → **GOOD**: 50% damage, +1 Echo.
  - otherwise → **MISS**: full damage.
  - Taps earlier than T − 350ms are **ignored** (no penalty, but they don't count). Taps in [T − 350, T − 200) count as MISS. No tap at all = MISS.
- **Story Mode** (setting): windows × 1.5, damage taken × 0.5.
- **Feedback:**
  - PERFECT: hitstop 80ms, 4px shake, teal spark burst, "PERFECT" text, SFX.
  - GOOD: small flash, "GOOD" text.
  - MISS: red flash + 6px knockback.
- **Tutorial** (`battles.b0_duel.tutorial = true`): on the first real enemy attack (Dov's, once he stops refusing), time scale 0.35 while the ring shrinks, plus the prompt text. Speed returns to normal after the first GOOD or PERFECT.
- **Multi-hit attacks:** each hit gets its own ring, separated by that hit's `telegraphMs`.
- **Feint** (`feint: {atPct, pauseMs}`): the ring shrinks to `atPct` of its travel, freezes for `pauseMs`, then continues to impact.

### Echo
- Per hero, integer 0–cap. The cap follows the Recall level (`levels.json` `echoMax`): Rhea 1 / 3 / 5 / 7 / 8 at Recall 1–5, Dov 5 at every level. The Keepsake raises Rhea's cap to 10 and fills it (every difficulty). HUD pips: `characters.json` `echoPips` (Rhea 10, Dov 5). The striker gets +1 per Strike that lands; the hero who parries gets +2 per PERFECT (GOOD and dodges give 0). Techniques spend their user's Echo according to `techniques.json`.

### Recollection (ultimate, P0)
- Needs Echo = 10 and is used by Rhea.
- Screen warms to golden (tint overlay); the background swaps to `bg/memory_city` if it exists.
- 3 rhythm rings on the target, 500ms apart. Damage per ring: PERFECT 60, GOOD 40, MISS 20. Afterwards the target is **Exposed**: ×1.3 damage taken for its next 3 turns.
- Rhea's Echo → 0, the tint fades back.

### Nala (P1)
- Present in battles with `nala: true` (small sprite behind the heroes). She first appears in `b2_first_hollow`; b0 and b1 have none.
- When a **Hollow** (`hollow: true`) telegraphs and Nala's ability is unused, Nala glows. Tapping Nala during that telegraph **cancels the attack** ("Nala hisses!").
- Once per battle. She never reacts to Forgotten (Blanks).

### Keepsake event (P1)
- Entering boss phase 2 (`onEnter: "keepsake_burn"`) pauses the battle and plays dialogue `keepsake_burn`.
- Then Rhea's `echoMax` becomes 10 and fills; the Recollection button pulses. Before that her cap is 8, so the ultimate is only reachable from here.

## Data (starting values — tune in JSON only)
`characters.json`
```json
{
  "rhea": {"name": "Rhea", "hp": 60, "body": "rhea_body",
           "parts": [{"key": "arm", "sprite": "rhea_arm", "pivot": [56, 65]}],
           "attack": {"windupT": 0.3, "keyframes": [
             {"t": 0,    "body": [0, 0],  "arm": {"rotation": 0,   "offset": [0, 0]}},
             {"t": 0.3,  "body": [-2, 0], "arm": {"rotation": -50, "offset": [0, 0]}},
             {"t": 0.5,  "body": [4, 0],  "arm": {"rotation": 70,  "offset": [2, -2]}},
             {"t": 0.8,  "body": [0, 0],  "arm": {"rotation": 0,   "offset": [0, 0]}}
           ]},
           "strike": [8, 10], "techniques": ["relay"], "canUltimate": true},
  "dov":  {"name": "Dov",  "hp": 90, "body": "dov",
           "attack": {"type": "lunge", "windupT": 0.3, "distance": 10, "squash": 0.15},
           "strike": [7, 9],  "techniques": ["anchor"]}
}
```
`techniques.json`
```json
{
  "relay":  {"name": "Relay", "cost": 2, "type": "attack",
             "hits": [{"dmg": [6, 8]}, {"dmg": [6, 8], "qte": {"perfectMult": 2, "goodMult": 1.5}}]},
  "anchor": {"name": "Anchor", "cost": 3, "type": "heal", "amount": 25, "canRevive": true},
  "recollection": {"name": "Recollection", "cost": 10, "type": "ultimate",
                   "taps": 3, "intervalMs": 500, "dmg": {"perfect": 30, "good": 18, "miss": 6}}
}
```
Relay's second hit uses an offensive ring on the enemy: tap on close for the bonus multiplier.

`enemies.json`
```json
{
  "blank":  {"name": "Forgotten", "hp": 30, "body": "blank",
             "attack": {"type": "lunge", "windupT": 0.3, "distance": 10, "squash": 0.15}, "hollow": false,
             "attacks": [{"id": "punch", "weight": 1, "telegraphMs": 900, "dmg": 10}]},
  "hollow": {"name": "Hollow", "hp": 45, "body": "hollow",
             "attack": {"type": "lunge", "windupT": 0.3, "distance": 10, "squash": 0.15}, "hollow": true,
             "attacks": [{"id": "claw", "weight": 3, "telegraphMs": 700, "dmg": 12},
                         {"id": "siphon", "weight": 1, "telegraphMs": 800, "dmg": 4, "onMiss": {"echo": -2}, "priority": "P2"}]},
  "clerk":  {"name": "Quill", "hp": 250, "body": "clerk",
             "attack": {"type": "lunge", "windupT": 0.3, "distance": 14, "squash": 0.15}, "hollow": false, "boss": true,
             "phases": [
               {"untilHpPct": 50, "attacks": [
                 {"id": "stamp", "weight": 2, "telegraphMs": 800, "dmg": 15},
                 {"id": "file_away", "weight": 1, "hits": [{"telegraphMs": 700, "dmg": 10}, {"telegraphMs": 600, "dmg": 10}]}]},
               {"untilHpPct": 0, "onEnter": "keepsake_burn", "attacks": [
                 {"id": "stamp", "weight": 2, "telegraphMs": 700, "dmg": 15},
                 {"id": "redact", "weight": 2, "telegraphMs": 800, "feint": {"atPct": 0.6, "pauseMs": 400}, "dmg": 15},
                 {"id": "archive", "weight": 1, "chargeTurns": 2, "interruptDmg": 40, "telegraphMs": 900, "dmg": 30}]}]}
}
```
- **Archive:** the Clerk spends `chargeTurns` (4) of his turns charging, guarded: he takes `guardMult` (60%) of every hit and the rest is remembered. Only a **BREAK** cancels the charge (the game never says so; Rhea works it out in the `archive_insight` dialogue after the first release). On release it fires as an unparryable QTE hit and heals `healMitigatedPct` of what the guard absorbed. A phase's `opening` list fixes its first turns' attacks (phase 1: stamp, then archive).

`battles.json`
```json
{
  "b0_duel":         {"bg": "street_rain", "party": ["rhea"], "enemies": ["dov_rival"], "tutorial": true, "redRings": false, "statuses": false, "nala": false, "music": "battle",
                      "events": [{"id": "duel_refuse", "when": {"playerHits": 1}, "dialogue": "duel_refuse"},
                                 {"id": "duel_wake", "when": {"firstOf": [{"playerHits": 3}, {"round": 3}]}, "dialogue": "duel_wake", "then": {"setFlag": "duelWake"}},
                                 {"id": "duel_nala", "when": {"enemyHpBelowPct": 50}, "dialogue": "duel_nala", "then": "endBattle"}]},
  "b1_forgotten":    {"bg": "street_rain", "enemies": ["blank", "blank"], "redRings": false, "statuses": false, "nala": false, "music": "battle"},
  "b2_first_hollow": {"bg": "street_rain", "enemies": ["blank", "hollow"], "nala": true, "music": "battle",
                      "events": [{"id": "b2_start", "when": "battleStart", "dialogue": "b2_start"},
                                 {"id": "b2_immune", "when": "firstImmune", "dialogue": "b2_immune"}]},
  "b3_gate":         {"bg": "street_rain", "enemies": ["hollow_warden", "hollow"], "formation": "gate", "nala": true, "music": "battle"},
  "boss_clerk":      {"bg": "records_office", "enemies": ["clerk"], "nala": true, "music": "boss", "recollection": true}
}
```
- `party` (default `ui.battleLayout.defaultParty`), `formation` (a key of `ui.battleLayout.enemies`), `recollection: true` (the ultimate exists only in battles that set it), `redRings` / `statuses` (default on).
- `events` (grammar: header of `src/systems/BattleEvents.js`): `when` = `battleStart` | `{round}` | `{playerHits}` | `{enemyHpBelowPct}` | `firstImmune` | `{firstOf: [...]}`; `then` = `continue` | `{setFlag}` | `endBattle` (an interrupted end: no Victory card, XP + Recall card, the chapter continues).
- Story v2 removed the v1 battles `b1_tutorial`, `b2_hollows` and `b3_hollows`.

`dialogue.json`: `{ "<id>": [ {"speaker": "Rhea" | null, "style": "normal" | "letter" | "narration", "text": "...", "portrait": "rhea_sad" | null} ] }`
- The typewriter runs at 40 chars/s. A tap during typing completes the line; a tap after advances.
- If a dialogue id is missing, write placeholder lines from the beats in `docs/STORY.md` and mark them `"todo": true`.

### Dialogue layout (visual novel style)
- The scene's background fills the top of the screen; the text box sits at the bottom with the speaker name and the typewritten line. The overworld (a separate walking-around view) is out of scope for the demo — dialogue is this box over a background, nothing else.
- Up to 2 portraits stand on the text box, one left, one right — the side is fixed per character (Rhea left, Dov right), not per line. The current line's `speaker` is lit at full brightness; the other portrait present on screen, if any, is dimmed (~40% brightness).
- A line's `portrait` field names the portrait key to show on its speaker's side (e.g. `"rhea_sad"`); `null`/missing leaves that side empty. The other character's portrait (if it was already showing from an earlier line) stays up, just dimmed, until dismissed by a line that leaves that side `null`.
- Portrait art lives in `public/assets/portraits/`, flat `#FF00FF` background, keyed out (made transparent) at load time — see Assets pipeline.

## Cutscene system
`cutscene_origin.json` → `{"shots": [ ... ]}`. Full text and visual notes are in `docs/STORY.md`, §Cutscene script.

Shot fields:
- `text`
- `bg`: asset key or null for black
- `bg2`: used with `split`
- `split`: `none` | `vertical` | `horizontal`
- `layers`: `[{img, x, y, scale}]`, where x/y are 0–1 relative
- `move`: `none` | `pan_left` | `pan_right` | `zoom_in` | `zoom_out`
- `tint`: hex or null
- `fx`: list of `crystal_particles` | `rain` | `flash` | `lights_out` | `dissolve_layer` | `embers` | `eyes_glow`
- `durationMs`: default 4500

Behaviour:
- Tap = finish typing / next shot. **Hold 800ms anywhere = skip the whole cutscene** (show a radial fill while holding).
- Missing images → black background with the shot's text and fx. **The cutscene must work with zero art.**

## Assets pipeline
- `_art/` holds source art: raw downloads and PSDs. Commit it, but the game never loads from it — only `public/assets/` is served/bundled.
- Sprites come from pixler.dev as transparent PNGs, pre-sized to their canvas — **128×128 for every character, 256×256 for Quill, the boss (key `clerk`)**. Render at `scale: 1`, never fractional; the canvas size *is* the display size.
- Backgrounds are 360×360 canvases, also rendered at `scale: 1`. In battle, darken them ~20% (a flat black overlay at ~20% alpha) so characters read clearly against them.
- Register every sprite in `assets.json`: `key, file, scale, faces ("left"|"right")`. A part sprite (see Attack rig, below) also carries `pivot: [x, y]` in local canvas pixels.
- **Facing:** in-game, heroes face right and enemies face left. Flip based on `faces`.
- **Portraits** (`public/assets/portraits/`, used by the Dialogue scene) are exported on a flat `#FF00FF` background instead of a transparent PNG. The loader keys that exact color out to transparent at load time (a pixel-level pass, not alpha in the source file). Missing portraits fall through to the placeholder loader like any other asset.

### Attack rig
- **Fallback only:** used by any character without a `<character>_animations.json` (below). A character is a `body` PNG plus zero or more named `parts` (also PNGs, same canvas size as the body), each with a fixed pivot point in local pixels.
- `characters.json` / `enemies.json` give each character an `attack`:
  - **With parts:** `{windupT, keyframes: [{t, body: [x,y], <partKey>: {rotation, offset: [x,y]}, ...}, ...]}`. `t` runs 0→1 over the attack's duration; positions/offsets are tweened linearly between keyframes. The keyframe at `windupT` is the pose held during the QTE telegraph (see Parry QTE > Telegraph).
  - **Without parts** (`type: "lunge"`): a body lunge toward the target plus a squash/stretch, using `windupT`, `distance` (px) and `squash` (scale delta). Used by every character that doesn't yet have a part rig — currently Dov, and all enemies until their art lands.
- **Idle is code:** a slow 1px sine bob, period ~1.2s. **Hurt is code:** white flash + knockback.
- Palette anchors: ink navy backgrounds, teal Echo `#3fd0c9`, amber for Dov `#e0a040`, Nala orange accent `#e8883a`, off-white text `#f1efe8`.

### Sprite-sheet animations
- Output contract: `docs/ART_BRIEF.md`. Method (rig, pixel-perfect rules, what broke): `docs/ANIMATION.md`.
- Raw pixler.dev downloads go to `_art/raw/pixler/<character>/` untouched.
- Game-ready sheets live in `public/assets/sprites/` as `<character>_<anim>.png` (horizontal strip, facing left), with one `<character>_animations.json` per character. `<character>` is the key in `characters.json` / `enemies.json`. The JSON sits next to the art (not in `src/data/`) because the art pipeline delivers it with the sheets:
```json
{
  "frame_size": [128, 128],
  "facing": "left",
  "animations": {
    "attack": {"frames": 10, "sheet": "rhea_attack.png", "durations_ms": [90,70,60,50,45,55,70,90,110,150],
               "loop": false, "windupFrame": 4, "impactFrames": [5], "holdFrame": 3}
  }
}
```
- Texture key and Phaser anim key = `<character>_<anim>` (e.g. `rhea_attack`). `durations_ms[i]` is exactly how long frame i is shown.
- Optional, 0-based: `windupFrame` = the pose held during the QTE telegraph. `impactFrames` = frames where damage lands (hit FX + damage number); a Strike deals its damage on the first one, and with none the hit lands when the anim ends. `holdFrame` = the anim pauses there until code resumes it (only when the caller handles the hold; otherwise it plays through, so nothing can soft-lock).
- A character with a JSON that has `idle` is one animated sprite in battle: idle loops, Strike plays `attack`, then back to idle. Without the JSON it uses the rig.
- A sheet listed in the JSON but missing from disk becomes a placeholder strip (the static body + parts in every frame, same frame count and timing), logged as `<key>: sheet missing, using placeholder`. While idle is a placeholder the code bob stays on.

## Audio
- **Unlock** on the Title tap. Pause all audio when `document.visibilityState === 'hidden'`, resume on visible.
- iOS mutes Web Audio when the silent switch is on → the Title screen shows the small line "🔈 Turn off silent mode for sound".
- **SFX are procedural** in `Audio.js`: short oscillator/noise envelopes for hit, perfect, good, miss, menu tick, echo gain, ultimate. No files needed.
- **Music:** a file in `public/assets/audio/music/<key>.mp3` plays looped with a 500ms crossfade. If there is no file for a key, a **procedural track** from `src/data/music.json` plays instead (Web Audio, `systems/Music.js`; no files needed). `setMusicIntensity(0..1)` (boss phase 2) and `setMusicWarm(bool)` (Recollection) shape it. Keep total audio under 6 MB.
- **Settings:** Music volume, SFX volume, Story Mode. Persist to localStorage.

## Performance budget
- Total download < 8 MB. First interactive screen < 3s on 4G.
- ≤ 150 rain particles. Target 60fps on a mid/low Android.

## Day plan (a playable build every evening)
| Day | Goal |
|---|---|
| Tue 29/9 | Setup, Pages live, issues bootstrapped. Battle scene with placeholders: Strike + parry QTE work. |
| Wed 30/9 | **Teaser.** Real sprites and background, HUD, Echo bar, rain, hit FX. Screenshot-ready by evening. |
| Thu 1/10 | Relay/Anchor, enemy AI from JSON, win/lose/retry, tutorial, b1 + b2, Nala. **Story text locked.** |
| Fri 2/10 | Boss (2 phases), Recollection, Keepsake event, ChapterRunner, Dialogue, Cutscene system. **Cut decision tonight.** |
| Sat 3/10 AM | Title / Menu / Settings / End + Credits, music, cutscene art, mobile test pass. **Final deploy by 14:00.** |

**Cut order if behind:** b3 → Siphon → Keepsake event → Nala → cutscene illustrations (keep text + fx) → Settings screen (keep defaults).

## Mobile test checklist (run before every evening push that touches UI)
- [ ] Open the Pages link from an Instagram DM on iPhone **and** Android (in-app browser).
- [ ] "Tap to start" → music/SFX play. With the iPhone silent switch on, the hint is visible.
- [ ] Nothing is cut off by the Instagram toolbars; all buttons reachable with a thumb.
- [ ] Rotating to landscape shows the overlay; back to portrait restores the game.
- [ ] No pinch/double-tap zoom, no text selection, no long-press callout (test hold-to-skip).
- [ ] PERFECT is reachable consistently on both phones (if not, check input latency and widen by 20ms).
- [ ] Smooth during rain + hit FX on the older phone.
- [ ] Switch to another app mid-battle and back → audio pauses/resumes, battle state intact.
- [ ] Full playthrough without a soft-lock; Story Mode works; End of Demo reachable.
- [ ] Cold load on 4G under ~3s to Title.

## Deploy
1. Repo is **public** (GitHub Pages on the Free plan).
2. Repo Settings → Pages → Source: **GitHub Actions** (one time).
3. Every push to `main` deploys to `https://<user>.github.io/<repo>/`.
4. Final build: tag `v0.1-jam` on Saturday.
