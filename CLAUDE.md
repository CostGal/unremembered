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
                (body PNG + optional named part PNGs per character — see Assets pipeline > Attack rig)
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
  {"type": "battle",   "id": "b1_tutorial"},
  {"type": "dialogue", "id": "after_b1", "bg": "street_rain"},
  {"type": "battle",   "id": "b2_hollows"},
  {"type": "dialogue", "id": "records_office", "bg": "records_office"},
  {"type": "battle",   "id": "boss_clerk"},
  {"type": "dialogue", "id": "ending", "bg": "records_office"},
  {"type": "end"}
]
```
- **Losing a battle** → "The memory fades…" + a Retry button. Retry restarts the same battle with party HP/Echo restored to the battle-start snapshot. There is no game over screen.

## Battle
### Layout (360×640)
- **y 0–360:** scene. Background, heroes on the left facing right, enemies on the right facing left, baseline y ≈ 300.
- **y 360–440:** party status (name, HP bar, shared Echo bar with 10 teal pips).
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
- **Telegraph:** the enemy holds the pose at its attack rig's `windupT` keyframe (its windup/telegraph pose — see Assets pipeline > Attack rig). A ring appears around the targeted hero and shrinks from radius 48 → 14 over `telegraphMs`. The moment it reaches 14 is the impact time **T**.
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
- **Tutorial** (`battles.b1_tutorial.tutorial = true`): on the first enemy attack, time scale 0.35 while the ring shrinks, plus the prompt text. Speed returns to normal after the first GOOD or PERFECT.
- **Multi-hit attacks:** each hit gets its own ring, separated by that hit's `telegraphMs`.
- **Feint** (`feint: {atPct, pauseMs}`): the ring shrinks to `atPct` of its travel, freezes for `pauseMs`, then continues to impact.

### Echo
- Shared integer 0–10. +1 per player hit that lands, +1 per GOOD, +2 per PERFECT. Techniques spend it according to `techniques.json`.

### Recollection (ultimate, P0)
- Needs Echo = 10 and is used by Rhea.
- Screen warms to golden (tint overlay); the background swaps to `bg/memory_city` if it exists.
- 3 rhythm rings on the target, 500ms apart. Damage per ring: PERFECT 30, GOOD 18, MISS 6.
- Echo → 0, the tint fades back.

### Nala (P1)
- Present in battles with `nala: true` (small sprite behind the heroes).
- When a **Hollow** (`hollow: true`) telegraphs and Nala's ability is unused, Nala glows. Tapping Nala during that telegraph **cancels the attack** ("Nala hisses!").
- Once per battle. She never reacts to Blanks.

### Keepsake event (P1)
- Entering boss phase 2 (`onEnter: "keepsake_burn"`) pauses the battle and plays dialogue `keepsake_burn`.
- Then Echo = 10 and the Recollection button pulses.

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
  "blank":  {"name": "Blank", "hp": 30, "body": "blank",
             "attack": {"type": "lunge", "windupT": 0.3, "distance": 10, "squash": 0.15}, "hollow": false,
             "attacks": [{"id": "punch", "weight": 1, "telegraphMs": 900, "dmg": 10}]},
  "hollow": {"name": "Hollow", "hp": 45, "body": "hollow",
             "attack": {"type": "lunge", "windupT": 0.3, "distance": 10, "squash": 0.15}, "hollow": true,
             "attacks": [{"id": "claw", "weight": 3, "telegraphMs": 700, "dmg": 12},
                         {"id": "siphon", "weight": 1, "telegraphMs": 800, "dmg": 4, "onMiss": {"echo": -2}, "priority": "P2"}]},
  "clerk":  {"name": "The Clerk", "hp": 250, "body": "clerk",
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
- **Archive:** the Clerk spends 2 turns charging (visible glow plus a "damage to interrupt" counter). If the party deals ≥ `interruptDmg` during the charge, the attack is cancelled. Otherwise it fires as a normal QTE hit.

`battles.json`
```json
{
  "b1_tutorial": {"bg": "street_rain", "enemies": ["blank", "blank"], "tutorial": true, "nala": true, "music": "battle"},
  "b2_hollows":  {"bg": "street_rain", "enemies": ["blank", "hollow", "hollow"], "nala": true, "music": "battle"},
  "b3_hollows":  {"bg": "street_rain", "enemies": ["hollow", "hollow"], "nala": true, "music": "battle", "optional": true},
  "boss_clerk":  {"bg": "records_office", "enemies": ["clerk"], "nala": true, "music": "boss"}
}
```
`b3_hollows` is P2: it is only inserted into `chapter1.json` if there's time.

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
- Sprites come from pixler.dev as transparent PNGs, pre-sized to their canvas — **128×128 for every character, 256×256 for The Clerk (boss)**. Render at `scale: 1`, never fractional; the canvas size *is* the display size.
- Backgrounds are 360×360 canvases, also rendered at `scale: 1`. In battle, darken them ~20% (a flat black overlay at ~20% alpha) so characters read clearly against them.
- Register every sprite in `assets.json`: `key, file, scale, faces ("left"|"right")`. A part sprite (see Attack rig, below) also carries `pivot: [x, y]` in local canvas pixels.
- **Facing:** in-game, heroes face right and enemies face left. Flip based on `faces`.
- **Portraits** (`public/assets/portraits/`, used by the Dialogue scene) are exported on a flat `#FF00FF` background instead of a transparent PNG. The loader keys that exact color out to transparent at load time (a pixel-level pass, not alpha in the source file). Missing portraits fall through to the placeholder loader like any other asset.

### Attack rig
- Used by any character without a sheet in `animations.json` (below). A character is a `body` PNG plus zero or more named `parts` (also PNGs, same canvas size as the body), each with a fixed pivot point in local pixels.
- `characters.json` / `enemies.json` give each character an `attack`:
  - **With parts:** `{windupT, keyframes: [{t, body: [x,y], <partKey>: {rotation, offset: [x,y]}, ...}, ...]}`. `t` runs 0→1 over the attack's duration; positions/offsets are tweened linearly between keyframes. The keyframe at `windupT` is the pose held during the QTE telegraph (see Parry QTE > Telegraph).
  - **Without parts** (`type: "lunge"`): a body lunge toward the target plus a squash/stretch, using `windupT`, `distance` (px) and `squash` (scale delta). Used by every character that doesn't yet have a part rig — currently Dov, and all enemies until their art lands.
- **Idle is code:** a slow 1px sine bob, period ~1.2s. **Hurt is code:** white flash + knockback.
- Palette anchors: ink navy backgrounds, teal Echo `#3fd0c9`, amber for Dov `#e0a040`, Nala orange accent `#e8883a`, off-white text `#f1efe8`.

### Sprite-sheet animations
- How to animate pixel-art sprites (rig, pixel-perfect rules, what broke, using pixler.dev sheets): `docs/ANIMATION.md`.
- Raw pixler.dev sheets go to `_art/raw/pixler/<character>/` untouched; processed sheets go to `public/assets/anim/`.
- Every sheet is registered in `src/data/animations.json`. The entry key is the texture key and the Phaser anim key:
```json
"rhea_strike": {"sheet": "anim/rhea_strike.png", "frame_size": [128, 128], "frames": 8,
                "durations_ms": [110, 90, 100, 60, 50, 45, 90, 140], "loop": false,
                "windupFrame": 2, "impactFrame": 5}
```
- `durations_ms[i]` is how long frame i is shown (slow–fast–slow; the impact frame is the shortest).
- Optional, 0-based: `windupFrame` = the pose held during the QTE telegraph; `impactFrame` = the frame where the hit lands (flash, shake, damage number).
- A missing sheet loads as a placeholder strip with the same frame count and timing.

## Audio
- **Unlock** on the Title tap. Pause all audio when `document.visibilityState === 'hidden'`, resume on visible.
- iOS mutes Web Audio when the silent switch is on → the Title screen shows the small line "🔈 Turn off silent mode for sound".
- **SFX are procedural** in `Audio.js`: short oscillator/noise envelopes for hit, perfect, good, miss, menu tick, echo gain, ultimate. No files needed.
- **Music:** files in `public/assets/audio/music/`, loop, 500ms crossfade. If a file is missing → silence, no error. Keep total audio under 6 MB.
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
