# Batch report 5 — v3 final jam changes (Sat 3 Oct 2026, 12:15 → 17:10)

Spec: `docs/V3_SPEC.md` + Kostas's replies (12:20 picks, 14:20 cuts, 15:00 asset spec, 15:28 more cuts, 16:20 phone-test list, 16:40 feet). Log with one line per item, commits and checks: `docs/BATCH_PROGRESS.md`. Orchestration: one Sonnet subagent per item (Opus for the Recollection minigame), up to seven lanes in parallel in git worktrees from 15:30, every item cherry-picked onto `main` after its gate and pushed (auto-deploy).

## What shipped (main `982f96a`)
| # | Item | What changed |
|---|---|---|
| 1 | UI quick wins | logo punch 1.08 on the Title tap; audio unlock on pointerdown + touchend + `onstatechange` until running; viewport refit on `visualViewport` resize; difficulty Back button; Credits inert with a POST GAME JAM pill; End screen "Will be revealed post game jam" + music license line; README |
| 2 | Art + SFX slots | every art/SFX key registered with intentional placeholders, alias/fallback portraits, cutscene shots with `bgFallback`/`whenArt`, cover dialogue backgrounds, file SFX (`public/assets/audio/sfx/<key>.mp3`) with procedural fallbacks |
| 3 | Nala bundle | 64×64 sheets idle / alert_in / alert / alert_out / hiss wired; `nalaJumpIn` arc |
| 4 | Echo rules + progression + duel | techniques never give Echo; `xpAt` [0,60,110,190,300]; Rhea cap [2,3,5,7,8]; Blast L1–L5 (crit = one extra bolt, extras never crit); RtS 2, Anchor 2 (L1 heal 20 no revive / L3 25 revive), Brace 4; Dov learns Anchor 1 / Tremor 3 / Brace 4; duel: first attack ×2.5 telegraph with ×4 windows, `duel_parry`, `duel_blast_unlock` (Blast slot blank until then), Nala jump-in, Dov wakes after Rhea's 2nd hit |
| 5 | Tutorial pauses | spotlight pauses: battle start (4 steps), parry, dodge (swipe indicator), leveling (Recall card); `?pauses=0` / `?pauses=all` |
| 6 | Target select UI | cards with name / HP bar / status (IMMUNE to Strike tag) + sprite marker; Anchor hero pick |
| 7 | Quill v3 | acts first; stage 1 at 110 HP → death → `quill_rise` → reversed death → 220 HP ENRAGED (red aura, laugh every 2–3 turns); stage 2 Stamp/Redact 18 @ 620/700 ms, Archive 65 in 2 turns; `archive_warn` / `archive_threat`; Recollection unlocks at 35 % of stage 2; HP floor "He won't fall": only Recollection kills him |
| 8 | Recollection | cut-in band (two Rhea beats), "Burn the memory" HOLD / SWIPE / TAPS, grades FLAWLESS / CLEAN / ROUGH on the result card, any success kills; all three missed → Unwriting (NO ESCAPE) → LOSE card Try again (rewind to the cast) / Quit |
| 10 | Battle backgrounds | illustrated 720×1280 at 0.5–0.56 scale, desaturated 60 %, drift, fog + window glows, 720×220 platform; picture anchored so the road meets the platform top; dark-glass HUD/commands (alpha 0.45); feet inside the pavement band |
| 11 | Opening + rest scene | `wake` with a silent eyelid intro, `letter` on the hands FPV, rest scene over 3 panels, single reward step after it |
| 12 | Red Reliquary + Hush | `red_tint` from shot 20, shake ramp, red surge, lights die, black hold; crossfade to `cs_hush_mid`, silent tower shot |
| 16 | Memory returns | one reward screen (Half a Loaf / Nala's Bell / Bandaged Fists), enemy drops (Grey Raincoat, Dust Shard) with a drop card, The Page registered at the keepsake |
| 20 | Music + SFX wiring | every track loops; placement by shot range / dialogue / battle / boss stage; keepsake → 1.5 s silence → recollection (from the cut-in); victory / memory_return / gameover jingles; next-step prefetch (boot loads the Title track only); SFX stop/fade on skip and shot change; statue_2 shot; new cues on shots 7, 8, 9, 11 |
| — | Assets pass 1 | 32 images processed (cutscene, covers, battle bgs, platforms keyed, portraits, cut-in composites), 14 SFX normalized to −16 LUFS, 16 music files looped/one-shot at −16 LUFS; `docs/ASSETS_INBOX.md` |
| — | Story polish (phone list) | daughter split, "fed it thousands", Hollow lines, no portraits where the picture shows the character, illustrated street dialogues, 19-step chapter with `after_b1_go` / `after_rest` / `approach_b2` / `after_b2` and close transitions, scream tail |

Chapter (19 steps, `?step=N`): 0 origin · 1 wake · 2 letter · 3 meet_dov · 4 b0_duel · 5 after_duel · 6 b1 · 7 after_b1_go · 8 after_b1 (rest) · 9 reward_rest · 10 after_rest · 11 approach_b2 · 12 b2 · 13 after_b2 · 14 before_gate · 15 b3 · 16 records_office · 17 boss · 18 ending.

## Decisions
- Feel B, poise +25 % / crush / Warden slam, Nala glow, Brace rework, Blast L5 minigame, scene pickups, dialogue editor → Post-jam ([#164](https://github.com/CostGal/unremembered/issues/164)).
- Enemy HP was cut by the Echo-economy tuning (blank 55, hollow 45, warden 50); Quill re-set to 220 (stage 1 = 110) with the floor.
- Chapter length for a non-gamer is ~19.4 min in the sim (target was 18): the tutorial pauses and the new dialogues add ~1.5 min; every battle ≥ 99.8 % win on Normal.
- The duel's slowed first attack replaces the slow-mo for that ring (6.4 s rings felt wrong), with ×4 windows.
- `records_office` is now a 720×1280 picture; dialogue steps use the cover alias `records_office_room`.
- Music one-shots that do not resume fade the current music out; `memory_return` plays on a level-up, not on every win.

## Sim (Normal, 2000 runs; `npm run sim`)
| Battle | non-gamer win / min | average | good |
|---|---|---|---|
| b0_duel | 100 % / 2.1 | 100 % / 1.6 | 100 % / 1.5 |
| b1_forgotten | 100 % / 1.6 | 100 % / 1.2 | 100 % / 0.9 |
| b2_first_hollow | 100 % / 2.0 | 100 % / 1.4 | 100 % / 1.1 |
| b3_gate | 100 % / 3.9 | 100 % / 2.0 | 100 % / 1.1 |
| boss_clerk (with Recollection) | 99.9 % / 4.5 | 100 % / 3.4 | 100 % / 2.8 |
| boss_clerk (never casting it) | 0 % | 0 % | 0 % |
Recollection all-three-miss chance: non-gamer 3 % (Story 1 %, Unforgettable 11 %), average 0.3 %, good 0 %. Chapter total: non-gamer ≈ 19.4 min, average ≈ 14.9, good ≈ 12.5.

## Checks on the final head
See the last line of `docs/BATCH_PROGRESS.md` (final gate: validate, build, story playtest, mobile-check).

## Still a placeholder / missing
- `ui_badge_postjam.png` (code pill used), `hollow_slam` / `blank_crush` sheets (features cut), Nala jump sheet (arc uses `alert`).
- Music credits for boss, battle_gate, cs_fall, recollection, rest_sad (TODO in `credits.json musicTodo`).
- The 360×360 pixel-art `street_rain.png` is only the fallback now.

## Phone test URLs (`https://costgal.github.io/unremembered/`)
| URL | What to check |
|---|---|
| `/` | logo punch, sound on first tap, Credits pill, difficulty Back |
| `?step=0` | 33 shots: per-shot music, statue destroyed shot, Hush shake → surge → lights out → crossfade → black, screams fading |
| `?step=1` · `?step=2` | silent eyelid intro, letter on the hands FPV, no portraits |
| `?step=4` or `?battle=b0_duel` | duel: spotlight pauses, slow first ring, dodge pause, Blast unlocked, Nala jump-in, Dov wakes after hit 2 |
| `?step=7` … `?step=13` | new connective dialogues, close transitions, illustrated streets, rest scene, memory return |
| `?battle=b1_forgotten&level=2` | target cards, far street fit, feet on the pavement, drop card after the win |
| `?battle=b3_gate&level=3` | office-gate picture, Warden 2× |
| `?battle=boss_clerk&level=4` | Quill v3 with music: boss → rise stinger → enraged track → keepsake → silence → recollection → victory |
| `?battle=boss_clerk&level=4&recollection=1` | straight to the cut-in and the three beats; miss all three for Unwriting → Try again |
| `?pauses=0` | append to any battle URL to skip the tutorial pauses |

Jam build: branch `jam-build-final` (anonymous build target `npm run build:jam`); zips delivered in chat (v1 4.4 MB base, v2 20 MB final).

## Headless labs (1–3 min each, from the repo root)
`npm run validate` · `npm run build` · `npm run sim` · `node scripts/qa/judge-unit.mjs` · `node scripts/qa/battle.mjs --out <dir> --only duel` · `node scripts/qa/quill.mjs --out <dir>` · `node scripts/qa/recollection.mjs --out <dir>` · `node scripts/qa/dialogue.mjs --out <dir>` · `node scripts/qa/music_wiring.mjs` · `npm run cutscene-check` · `npm run mobile-check` · `npm run playtest -- --story` (12 min).
