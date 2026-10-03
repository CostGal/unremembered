# STATUS — Unremembered (updated Fri 2 Oct 2026, night)

Read this first in any new chat. Source of truth: `CLAUDE.md` (build spec), `docs/STORY.md` (story bible + cutscene script), `docs/ART_BRIEF.md` (what animations the game needs + output contract), `docs/ANIMATION.md` (animation method / learnings). This file records **decisions made after those were written** and the current state. If anything conflicts: STATUS > CLAUDE.md.

## Story v2 (Fri 2/10)
Batch issues #141–#151 (Phase 2 follows). Where this section conflicts with anything below, **this section wins**.
- **Story Bible v2** (`docs/STORY.md`) is the source of truth. `chapter1.json` = **19 steps** (`?step=N`, 0-based; the closing `end` marker is not counted): 0 cutscene `origin` · 1 dialogue `wake` (silent eyelid intro, `ui.json dialogue.intro.wake`) · 2 dialogue `letter` · 3 dialogue `meet_dov` (`street_far_room`) · 4 battle `b0_duel` · 5 dialogue `after_duel` · 6 battle `b1_forgotten` · 7 dialogue `after_b1_go` (NEW, ends with a `close` transition) · 8 dialogue `after_b1` (rest scene, 3 panels via a line's `bg`) · 9 reward `reward_rest` · 10 dialogue `after_rest` (NEW, close) · 11 dialogue `approach_b2` (NEW, `street_mid_room`) · 12 battle `b2_first_hollow` · 13 dialogue `after_b2` (NEW, close) · 14 dialogue `before_gate` (`office_gate_room`) · 15 battle `b3_gate` · 16 dialogue `records_office` · 17 battle `boss_clerk` · 18 dialogue `ending`. Dialogue backgrounds are cover aliases of the battle pictures (`street_far_room`, `street_mid_room`, `office_gate_room`); `ui.json dialogue.noPortraits` (wake, letter, after_b1) hides portraits where the art shows the characters. The v1 battles `b1_tutorial` / `b3_hollows` are removed.
- **Renames (display only):** "Blank" -> **Forgotten**, "The Clerk" -> **Quill**. Code keys `blank`, `clerk`, `boss_clerk` are unchanged; `voices.json` / `nameColors` are keyed "Quill".
- **Echo capacity by Recall level** (`levels.json` `echoMax`, read by `Recall.js` `echoMaxFor`): Rhea 1 / 3 / 5 / 7 / 8, Dov 5 at every level. The Keepsake sets Rhea to 10 and fills her, on every difficulty. HUD pips (`characters.json` `echoPips`): Rhea 10 (pips above her cap drawn dim/locked), Dov 5. Chapter levels: b0 Recall 1, b1-b2 Recall 2, b3 Recall 3, boss Recall 4.
- **Blast grows by level** (`techniques.json` `blast.levels`, resolved by `Recall.js` `techniqueAt`): L1 cost 1 / 2 bolts / no crit · L2 cost 2 / 3 bolts · L3 cost 3 / 3-5 bolts / 20% crit · L4 = the full Blast (3 Echo, 3-6 bolts, 30% crit). **Tremor costs 5** (was 3). The Recall card shows "{tech} grows: ..." (`levels.json` `text.upgrade` + `upgradeDetail`). `npm run validate` checks that every known technique's cost <= its hero's cap at that level.
- **Recollection only in `boss_clerk`** (`battles.json` `recollection: true`). On unlock the ready FX plays (`qte.json` `recollection.ready`: flash, sparks, aura, "MEMORY READY") and the tutorial hint `recollection` shows (`ui.tutorial.hints.recollection`).
- **Generic battle events** (`battles.json` `events: [{id, when, dialogue, then}]`; grammar in the header of `src/systems/BattleEvents.js`, shared by BattleScene, the sim and Validate): `when` = `battleStart` | `{round: n}` | `{playerHits: n}` | `{enemyHpBelowPct: n}` | `firstImmune` | `{firstOf: [...]}`; `then` = `continue` (default) | `{setFlag: "<name>"}` | `endBattle`. `endBattle` is an **INTERRUPTED end**: no Victory / grade card, XP + the Recall card are given, the chapter continues. `playerHits` counts landed player actions (one per Strike or attack technique that dealt damage; counters and Recollection excluded). Each event fires once, between turns. `keepsake_burn` / `archive_insight` stay on their phase / release hooks. `ui.battleEnd.interruptedText` is the text shown on an interrupted end ("" = nothing drawn).
- **Party per battle:** `battles.json` `party` (default `ui.battleLayout.defaultParty` = rhea, dov). **`dov_rival`** (`enemies.json`): uses Dov's sheets via `animSet: "dov"` (`SpriteAnims.js` `aliasAnimationSets`; works for any character or enemy), no poise, `refuseUntilFlag: "duelWake"` (he won't fight back until the flag is set; refuse text in `battleEvents.json` `refuse`).
- **Battles:** `b0_duel` (Rhea alone vs `dov_rival`; the tutorial slow-mo moved here; events `duel_refuse` / `duel_wake` / `duel_nala`; ends interrupted when Dov <= 50%) · `b1_forgotten` (2 Forgotten, teaches Break, `redRings` off) · `b2_first_hollow` (blank + hollow, Nala's first battle, events `b2_start` / `b2_immune`; red rings + statuses on from here) · `b3_gate` (hollow + `hollow_warden`, `formation: "gate"`) · `boss_clerk` (mechanics unchanged).
- **Warden Hollow:** generic `displayScale` field (integer only, any character/enemy; a generic `tint` field also exists), warden = `displayScale: 2`. Gate formation slots (`ui.battleLayout.enemies.gate`: warden {262, 330}, hollow {196, 346}, hollow drawn in front); name labels are clamped on screen (`ui.battleLayout.labelMargin`). HP 100, poise 12, **Siphon with `lifesteal: 1`** (the normal Hollow's Siphon too; text `battleEvents.json` `lifesteal` "Siphoned"), **Maul** = 2 hits with a feint. **K3** (a real 256x256 sprite) stays open: do it only if the 2x looks wrong on a phone.
- **Balance** (sim, normal): hollow hp 80 -> 65, claw 12 -> 8, warden maul 7 -> 6. Every battle 100% win for every profile. Chapter length ~16.5 min non-gamer / 13.1 average / 11.1 good (cutscene 2.2 + dialogue 2.8 + battles). Playtests (real, fake, story, average profile) pass with 0 retries; mobile-check 36/36.
- **Swipe dodge is the real mechanic (#163):** the `qte.json swipeDodge` flag and the unparryable-only swipe path are gone; every enemy ring takes both gestures (`Qte.runRing` header). Tap = parry (windows 90/200, +2 Echo on PERFECT, counter), swipe = dodge (`dodge.windows` 180/300 on white rings, the normal windows on red ones; PERFECT 0 damage, GOOD half, no Echo, no counter, chain unchanged; sheet `dodge`, fallback sidestep `dodge.sidestepPx/sidestepMs` 10 px / 120 ms). Gesture settles on pointer-up, on `dodge.swipe.minPx` 32 (immediately on move) or after `maxMs` 180 held still; judgement time = touch-down. Hint "Tap to parry · swipe to dodge" (`qte.hint.text`), banner `ui.tutorial.hints.dodge` once after the tutorial slow-mo. Sim/bot: `sim.json policy.dodgeChance` {non-gamer .35, average .2, good .1} = share of white rings swiped. Dodging costs Echo income (none from a dodge) but no battle dropped below 100% win; chapter totals in the sim barely move.
- **Echo rules + progression + duel flow (batch 5, item 4):** techniques never give Echo (only Strikes +1 and parries PERFECT +2, plus `turnEcho`); `echoOnHit` is gone from Blast/Tremor. `levels.json`: `xpAt` 0/60/110/190/300, Rhea `echoMax` 2/3/5/7/8, `learn` rhea blast 1 / return_to_sender 2, dov anchor 1 / tremor 3 / brace 4. Blast levels (cost, bolts, crit): L1 2, 2, 0 · L2 3, 4, 0 · L3 4, 4-6, 20% · L4 4, 4-6, 25% · L5 4, 4-6 dmg 4-5, 30%, `aimMinigame` flag (the minigame is a later item). **A crit fires ONE extra bolt that can never crit** (cap `maxHits`). Anchor cost 2, L1 heals 20 and cannot revive, L3 = 25 + revive + clears statuses (`clearStatuses`, on when absent); Return to Sender cost 2, Brace cost 4. Events grammar: `{parries: n}`, `{all: [...]}`, `then` may be a list, `nalaJumpIn` (a PRE action: runs before the dialogue), `banner` (a `ui.tutorial.hints` id shown after the dialogue); battles `lockedTechniques: {techId: flag}` (blank `? ? ?` slot, `ui.commands.lockedSlot`); enemies `firstAttackTelegraphMult`. b0_duel: Blast unlocks on the first parry (`duel_parry` + `duel_blast_unlock`), Dov's first real attack has a x2.5 telegraph on top of the tutorial slow-mo, Nala jumps in from the left (`duel_nala`) before the interrupted end. Balance: the new Echo economy slowed the fights, so enemy HP was cut (blank 80 -> 55, hollow 65 -> 45, warden 100 -> 50, Quill 440 -> 320); non-gamer chapter 17.8 min. Battle lab: `node scripts/qa/battle.mjs --only duel`.
- **Fix:** the Keepsake fill ignored the difficulty `echoMult` on Unforgettable (`gainEcho` raw).
- **Dev params** unchanged: `?step=N` (new mapping above), `?battle=<id>` (new ids), `?level`, `?echo`, `?shot`, `?fakesheets`, `?reward`, `?fragments`. The battle lab and QA scripts moved to the new ids.
- **Branching for this batch:** Phase 1 on a PR to main (not merged by Claude), Phase 2 stacked on it; report in `docs/BATCH_REPORT_4.md` (log: `docs/BATCH_PROGRESS.md`).

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
10. *(Superseded by Story v2, see top.)* **Chapter 1 shortened (Kostas, 29/9):** b1 tutorial = 1 Blank + 1 Hollow, then straight to Records Office + boss Clerk. **b2_hollows is dropped** (edit `chapter1.json` + `battles.json`, data only). The story beats stay. Nala's save happens in b1.
11. **Parry input (Kostas, 29/9): single tap, as in CLAUDE.md** (PERFECT/GOOD/MISS). The double-tap parry + swipe dodge redesign was considered and not built for the jam. Update (#68): a swipe dodge was added on top of the tap parry (superseded by #163, see Story v2: swipe is now the real second gesture on every ring). Red-ring attacks (`unparryable`: Blank lunge, Clerk Archive) can only be dodged; on normal attacks a swipe works too but gives no counter. Tuning in `qte.json` (`dodge`, `unparryable`).
12. **Hollows, Tremor, Recall (2/10, #124–#126):** Strike passes through Hollows (IMMUNE, no Echo; `enemies.json` `immune`). Every hero gains `turnEcho` (1) at the start of their turn. Dov gets **Tremor** (3 Echo, hits every enemy). **Recall** = Pokemon-style levels in `levels.json`: the party shares Memories (XP, `enemies.json` `xp`); each level adds HP + Strike, and some unlock techniques (L1 Blast/Tremor, L2 Return to Sender/Anchor, L3 Brace). A Recall card follows the result card. Retuned: Blast 3 Echo, Hollow 80 HP, Clerk 440 HP. Dev: `?level=N`.

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

## Fragments (#72)
A `reward` step in `chapter1.json` (after b1 and after b3, since b2 was dropped): "A memory returns…", 3 random fragments from `src/data/fragments.json`, tap one; it stays for the whole run (registry `fragments`, reset on New Game) and shows as a small letter icon at the end of the Echo row. Effects: Old Ticket (+2 Echo at battle start), Cat Hair (Nala twice), Worn Glove (PERFECT window +20ms), Dov's Scarf (+15 max HP), Ink Stain (Blast crit 40%), Echo Shard (+1 Echo on PERFECT). Dev: `?reward=1` opens the screen, `?fragments=a,b` gives fragments in a battle. The sim does not model fragments.

## Lightning (#56)
`environments.json` `street_rain.lightning`: a rare flash over the scene area (~80ms + a weaker flicker) and a procedural thunder rumble (`audio.json` `thunder`) 0.4-1.5s later. First strike after 7-16s, then every 14-28s; it waits (retry 1.5s) while a parry ring is live, so it never covers a QTE. Add `lightning` to another environment to give it storms.

## Mobile pass, automated part (#38, Thu 1/10)
`npm run mobile-check` runs the automatable half of the CLAUDE.md mobile checklist on emulated phones (iPhone 13, iPhone SE, Pixel 5, viewports cut to Instagram's in-app toolbars, touch input): game fully visible, silent-mode hint, touch/selection/zoom/long-press guards, Title tap, tap targets (>= 56 px, >= 16 px from edges), app switch pause/resume with state intact, landscape overlay + pause. 36/36 passed. `npm run playtest -- --story` plays the whole chapter in Story Mode (passed). `npm run perf`: 4G + 4x CPU load to Title 3.3-3.5 s (target 3 s; it was 2.1 s before the title art, portraits and music engine; today's features add ~0.25 s). Halving the title art was tried and rejected: visibly softer on 3x screens. FPS with rain + FX: 39 avg at 1x CPU, 21 at 4x (headless software WebGL, pessimistic).
Still needs real phones: the Instagram in-app browser itself, iOS silent switch, PERFECT feel/latency, real FPS on an older Android, real 4G load. Then tag `v0.1-jam` Saturday.

## Echo per hero (Kostas, Thu 1/10)
*(Costs, caps and Tremor/Blast numbers below are superseded by Story v2, see top: Echo capacity now follows the Recall level, Blast grows by level, Tremor costs 5.)*

Each hero has **their own Echo** (`hero.echo`, max `characters.json echoMax`, default `ui.hud.echo.max` = 10), drawn as a row of pips under that hero's HP bar. The hero who lands a Strike earns it (+1); the hero who parries earns it (PERFECT +2, GOOD 0, dodge 0); Siphon drains the hero it hit; Old Ticket gives everyone +2 at battle start; the Keepsake fills Rhea only. Techniques spend their user's reserve: Blast 4, Return to Sender 3, Anchor 4, Brace 3, Recollection 10 (Rhea). The sim, the playtest bot and the battle lab model the split. Design intent: Echo is scarce, every technique is a decision, and the boss should have more than one route (next design step).

## Boss rework (Kostas, Fri 2/10)
- **Archive** (`enemies.json` clerk): phase 1 opens stamp → archive (`opening`), 4-turn charge, the Clerk takes 60% of every hit meanwhile (`guardMult`), only a BREAK cancels it (`brokenText`), release = 35 unparryable + heals half of what the guard absorbed. The game never explains the break: after the first release the `archive_insight` dialogue (Rhea + Dov, marked `todo` for a text pass) plays.
- *(Cap-8 sentence superseded by Story v2: Rhea's cap follows `levels.json` `echoMax` and the Recollection is boss-only.)* **Recollection**: 60/40/20 per ring and the target is **Exposed** (`statuses.json`, ×1.3 damage taken for its next 3 turns). Rhea's Echo caps at 8 (`characters.json echoMax`) until the Keepsake raises it to 10 (`battleEvents.keepsake_burn.echoMax`) and fills it: the ultimate is reachable only from there. Locked pips are drawn dim.
- Clerk HP 260, boss par 14. `npm run sim` (normal): non-gamer 17 rounds / 100% win, average 14, good 12.

## Quill v3 (batch 5): he acts first, two stages with a revive
- `battles.json boss_clerk.initiative: "enemy"`: the enemies act before the heroes in every round (BattleStateMachine + sim; default heroes first).
- `enemies.json clerk.stages` replaces `phases` (the engine still supports `phases` for other enemies). `hp` is the **stage-2 max**; stage 1 opens at `stages[0].hpPct` % of it and its label/bar shows that stage's own max. At 0 HP in a stage with `onZero` he is **not** down (`entity.rising`, ignored by the win check): the death sheet plays and holds, the `onZero.dialogue` (`quill_rise`) plays, the death sheet runs **in reverse** (`playReverseOnce` in SpriteAnims), then HP = `hp` x `refillTo`, poise full, statuses cleared, the next stage's look starts (body tint, additive aura, `musicIntensity`, "ENRAGED" pop + flash, laugh). Texts/timings: `battleEvents.json stage`. A missing/placeholder death sheet dims the body and fades it back instead.
- Stage 2 (`enraged`): Stamp 620 ms / 18, Redact 700 ms / 18, Archive `chargeTurns` 2 / 65 dmg / 800 ms; `hp` 220 (stage 1 = 110); `laughEvery [2, 3]` (+ `laughSfx`) laugh after his turns.
- **Recollection** only in stage 2: `recollectionAtHpPct` (35 %) of the stage-2 max queues `keepsake_burn` once (Rhea's cap 10, Echo full); the old `onEnter: keepsake_burn` is gone. `techniques.json recollection.kill: true`: a completed Recollection sets his HP to 0 (the three rings stay for now, the kill is unconditional).
- **HP floor**: once the Recollection is unlocked, `stages[1].floorHp` (1) is the lowest any hit can take him (poise/break untouched); a clamped hit pops `battleEvents.stage.floorText` every 2nd time. Only the Recollection's kill goes below, so a player who never casts it cannot win (sim: 0 %).
- Attack hook `onChargeStart: "<battleEvents id>"` (once per battle per id, like `onRelease`): `archive_warn` (first charge, stage 1), `archive_threat` (first charge, stage 2). `quill_rise`, `archive_warn`, `archive_threat` are in `dialogue.json`.
- `npm run validate` checks `stages` (ids, hpPct, attacks, onZero, recollectionAtHpPct, laughEvery/laughSfx, aura, tint), the hook ids and `initiative`.
- Sim: `--no-recollection` (or `sim.json policy.recollection: false`) = the player never casts it; `--unforgettable` adds the third difficulty (enemyHpMult, echoMult, enemyDefendChance are modelled for it).
- Lab: `node scripts/qa/quill.mjs --out <dir>` (direct beats + the real loop to Victory).


## Session Thu 1/10 (autonomous batch: every `who:claude-auto` issue)
Done in one batch (#84 #110 #111 #109 #107 #97 #96 #95 #98 #99 #93 #91 #113 #104 #100 #81 #82 #83 #105 #106). Decisions that change the spec:
- **Difficulty replaces Story Mode** (#95/#96/#97): `qte.json difficulties` = story / normal / unforgettable, each with `windowMult`, `damageMult`, `enemyHpMult`, `echoMult` (Echo fractions carry over). `settings.difficulty` holds the id; an old `storyMode: true` maps to `story`. New Game asks every time; Settings cycles it. Fresh defaults: music 100 %, SFX 100 %, Normal.
- **Wider view on wide viewports** (#107): `systems/View.js`. The canvas grows from 360 up to `ui.view.maxW` (448) when the viewport is wider than 9:16 (iPhone Chrome, Instagram toolbars); every camera is shifted so x 0–360 stays the design space. Cover images span the view, 360 px pixel-art backgrounds continue as mirrored edges (`mirrorEdges`), full-screen rects/flashes use `View.rect()`. Floating text clamps with `View.clampX`. Keep designing at 360×640.
- **Cutscene pictures always cover** (#111): a `focus` scales the image up as needed and the position is clamped; the eyes_glow fx is picture-relative (`shot.eyes` = 0–1 on the image).
- **Rain fill mode** (#113): `Fx.rain(scene, cfg, area, {fill: true})` for pictures without a floor (cutscene, dialogue); the battle keeps its ground line.
- **Story SFX + ambience** (#100): `audio.json sfx` (crystal_hum, lights_out, hush, letter, glitch, ledger, archive, stamp) and `audio.json ambience.beds` (rain, city, office). Hooks: `ui.cutscene.fxSfx` + a shot's `sfx`; `ui.dialogue.nameSfx` + a style's `sfx`; `enemies.json` attack `sfx` / `impactSfx` / `chargeSfx`; `environments.<bg>.ambience`.
- **Fonts** (#105): `ui.fonts.list`; Handjet and Tiny5 (Greek subsets) self-hosted; `ui.font` is swapped at runtime by `systems/Fonts.js`. Pixelify Sans stays the default and the only preloaded one.
- **Full screen / PWA** (#106): `public/manifest.webmanifest` + icons, `systems/Fullscreen.js`. Android: Title toggle "Fullscreen: On/Off" (default on), entered on the Tap-to-start. iOS / in-app browsers: a one-line tip (Add to Home Screen / open in the browser); from the home screen the game launches full screen. No service worker.
- **Nala** sits out b1 (#93); first joins b3. *(Superseded by Story v2: Nala first joins in `b2_first_hollow`; b0/b1 have none.)* **Shot 1** opens on `city` (#91).
- `npm run validate` warns on on-screen characters outside Pixelify Sans (#83). Dev scripts find Playwright's Chromium and pass `--no-sandbox` as root (#84), so `cutscene-check` / `music-check` run in the cloud container.
- Known: the cloud container's headless Chromium renders no audio, so `scripts/qa/audio.mjs` level checks read 0 there (unrelated to the code).
