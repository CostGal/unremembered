# STATUS — Unremembered (updated Tue 29 Sep 2026, late evening)

Read this first in any new chat. Source of truth: `CLAUDE.md` (build spec), `docs/STORY.md` (story bible + cutscene script), `docs/ART_BRIEF.md` (what animations the game needs + output contract), `docs/ANIMATION.md` (animation method / learnings). This file records **decisions made after those were written** and the current state. If anything conflicts: STATUS > CLAUDE.md.

## Context
- Game jam vs Amarildo & Fanis. **Teaser screenshot Wed 30 Sep. Final deploy Sat 3 Oct, 14:00** (hard deadline 16:00). Friends vote 1–10 live on Discord Saturday evening.
- Kostas has ~1h/day Tue–Fri and ~5h Saturday morning. Art and code run in parallel.
- Repo: github.com/CostGal/unremembered (public), local `C:\dev\unremembered`. Live: https://costgal.github.io/unremembered/ (auto-deploys on push to main).
- Claude Code runs in Claude Desktop (Code tab), in **its own worktree**. When Kostas adds files to `C:\dev\unremembered`, he tells it: "pick up the new files from the main checkout, commit and push". Never two sessions on the repo at once.
- Tasks: GitHub Issues + one Project board. Labels: ui, art, audio, music, mechanics, story, tech, idea, manual, P0–P2. Milestones: Teaser, Demo, Post-jam.

## Board rules
- **One issue per character** with a checklist: Sprite → pixler anims → Fable → files in repo → wired in game → phone test. Plus one issue "Sprites: Hollow, Clerk, Nala".
- **Max one art card and one code card In Progress.**

## Done
- #1 Setup, #2 scene skeleton, #3 battle core (turn order, commands, Strike, HP, damage numbers). Tested on phone via Instagram.
- **Sheet loader** per ART_BRIEF (`<character>_<anim>.png` + `<character>_animations.json` in `public/assets/sprites/`, `windupFrame`, `impactFrames`, `holdFrame`). Idle and Strike play from sheets, placeholders until files arrive (commit `0ebb730`). The part rig stays only as a fallback.
- **HUD #5** done (`4ee8df9`): status panel, Echo pips, `src/data/ui.json`, dev-only debug taps (`npm run dev -- --host`). Known issue **#55** (Teaser, ui, P1): 2nd enemy and Dov sit too low, hidden behind the HUD — move positions into `src/data/`, keep everyone above y 360.
- **Rhea full animation set** delivered by Fable: idle, attack, blast (+ blast_projectile sheet), ability, cast (+ cast_in / cast_out), death, victory, plus extras hurt, dodge, parry. Sheets + `rhea_animations.json` + GIFs + the generator `.py` scripts. Not yet in the repo / wired.
- Rhea Strike = `rhea_attack_v2` (8 frames, windupFrame 2, impactFrames [5]).
- **Sprites (128×128):** Rhea, Dov, Blank, Hollow. Blank faces right → needs mirror (or `faces: "right"` in assets.json). Hollow: 128×128, alpha clean.
- Background `bg/street_rain.png` (360×360, 32 colors).
- Raw pixler (MCP) in `_art/raw/pixler/`: Rhea blast + counter, Dov cast (colors need restoring), Dov attack (from the UI).
- pixler paid plan ($8/month, ~160 animations). MCP `animate` only works on pixler-generated jobs.

## In progress
- **Code:** wire Rhea sheets (loader check vs contract, death/victory, `?animtest=1` preview). Files arrive via `_inbox/` in the main checkout; Claude Code sorts them.
- **Art:** Rhea done → Dov next (pixler anims → Fable). Flow: Kostas makes keyframe anims in the pixler UI → Fable processes → `_inbox/` → Claude Code sorts + wires → phone test.

## Decisions made after the spec
1. **Story locked** (STORY.md v1). Origin cutscene = 30 shots. Vael is post-jam.
2. **Visual novel between battles.** No overworld. Background on top, up to 2 portraits on the text box, speaker lit, other dimmed.
3. **Portrait style A:** story = illustrated (Gemini), battle = pixel. Cutscene uses the illustrated style.
   - Gemini: base portrait with the sprite as reference, then one expression per edit, **one change per edit**, flat magenta #FF00FF background. If edits stop applying, new chat + re-upload.
   - Expressions: **Rhea** neutral, confused, determined, sad, angry, pained · **Dov** neutral, warm, worried, fierce, sad · **Clerk** cold, smug, furious, desperate · **Nala** calm, alert, hissing, affectionate.
   - Processing (key out magenta, resize, compress) by Claude, not by hand.
4. **Animation = sprite sheets.** pixler keyframes → Fable project ("Unremembered — Animation", other account) per ANIMATION.md + ART_BRIEF.md → sheets + JSON in `public/assets/sprites/`.
5. **Art tools:** pixler.dev (sprites + anims), Gemini (backgrounds, portraits, cutscene), Photopea/Piskel (fixes). Folders: `_art/raw` → `_art/work` → `public/assets/*`. `_art` committed, never loaded.
6. **Integer scale 1:** 128×128 canvases, boss 256×256, Nala 64×64. Backgrounds 360×360, darkened ~20% in battle.
7. **Scope cuts (restorable):** Oaths → post-jam. Battle 3 = P2. Cutscene illustrations = P1 (fallback text + fx). Cut order in CLAUDE.md.
8. **Combat kit (replaces CLAUDE.md techniques):**
   - **Rhea:** Strike (0 cost, 5–6 dmg, +1 Echo) · Blast (3 Echo, 3–6 hits of 3–4 dmg; each 30% crit adds a hit, max 10) · Return to Sender (2 Echo, counter stance: parry the next attack → big counter) · Recollection (ultimate, 10 Echo, 3 rhythm taps).
   - **Dov:** Strike · Anchor (3 Echo, heal/revive 25) · Brace (2 Echo, party takes half damage from the next attack). No ultimate.
   - **Enemies:** Blank: punch + lunge (600ms telegraph) · Hollow: claw + siphon · Boss: Stamp, File Away, Redact, Archive.
   - Stats system like Clair Obscur → post-jam.
9. **Move budget (29/9):** Rhea 4 moves, Clerk 4, Dov 3 (1 attack + 2 abilities), all others 2. `parry` and `dodge` anims: Rhea, Dov, Clerk only (Clerk dodges randomly, rule later). `hurt` + `death` for every combatant (not Nala). `victory`: Rhea + Dov. Extra anims beyond ART_BRIEF are allowed; ART_BRIEF.md updated.
10. **Chapter 1 shortened (Kostas, 29/9):** b1 tutorial = 1 Blank + 1 Hollow, then straight to Records Office + boss Clerk. **b2_hollows is dropped** (edit `chapter1.json` + `battles.json`, data only). The story beats stay. Nala's save happens in b1.
11. **Parry input (Kostas, 29/9): single tap, as in CLAUDE.md** (PERFECT/GOOD/MISS). The double-tap parry + swipe dodge redesign was considered and not built for the jam. Update (#68): a swipe dodge was added on top of the tap parry. Red-ring attacks (`unparryable`: Blank lunge, Clerk Archive) can only be dodged; on normal attacks a swipe works too but gives no counter. Tuning in `qte.json` (`dodge`, `unparryable`).

## Work order
**Art (one character at a time until it plays fully in game and is phone-tested):**
Rhea → Dov → Blank → Hollow → Clerk → Nala.
Still missing sprites: **Clerk (256×256), Nala (64×64)** — needed before their turn comes.
Also pending: portraits (Rhea, Dov first) for dialogue.

**Code (Claude Code, one issue at a time):**
Rhea wiring → #55 (layout, Teaser) → rain FX → parry QTE #4 → combat kit in JSON + logic → per CLAUDE.md day plan.

## Deadlines
- **Wed 30/9:** teaser screenshot. Fallback `_art/work/teaser_mock.png`.
- **Thu 1/10:** sound + dialogue text lock.
- **Fri 2/10 night:** cut decision.
- **Sat 3/10 14:00:** final deploy, tag `v0.1-jam`.

## Habits
- New art/files: drop them in `C:\dev\unremembered\_inbox\<character>\` (git-ignored) and tell Claude Code "sort the _inbox". Sorting rule: sheets + JSON → `public/assets/sprites/`; GIFs, scripts, raw → `_art/work/<character>/`; docs → `docs/`.
- Before leaving the PC: "commit and push everything, including _art".
- New ideas → issue with label `idea`, milestone Post-jam. Never mid-build.

## Break gauge (#69)
Enemies have `poise` in `enemies.json` (Blank 6, Hollow 8, Clerk 20), shown as pips under the name label. Poise damage per hit: `src/data/break.json` `sources` (player hit 1, PERFECT counter 2, Return to Sender counter 3). At 0: BREAK! (enemy skips its next action, takes `damageMult` 1.5 until that turn ends, then poise refills; a phase change also refills). `npm run sim` has a `breaks` column.

## Battle grade (#70)
After a victory, a result card (Perfects, Max chain, Damage taken, Turns) and a rank S/A/B/C that lands like a rubber stamp. Formula, thresholds, par turns, layout and texts: `src/data/grade.json`; the pure scoring is `src/systems/Grade.js` (also used by `npm run sim`, which prints score and rank split per profile). Best rank per battle is kept in memory only. A tap while the card plays jumps to the stamp; the next tap continues.

## Memory statuses (#71)
`src/data/statuses.json`: REDACTED (a random technique of the hero is covered by a black bar and can't be used, 2 of the hero's turns) and FOG (command names read "???", 1 turn). Applied from an enemy attack's `onMiss.status` (+ optional `chance`) in `enemies.json`: Hollow Claw -> fog (30%), Hollow Siphon and Clerk Redact -> redacted. Badges (letter + turns left) sit at the end of the hero's HP bar. Anchor clears its target's statuses; a KO clears them too.

