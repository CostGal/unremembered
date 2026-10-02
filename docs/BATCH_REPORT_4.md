# Batch report 4 — Story v2 (Fri 2/10 night → Sat 3/10 01:00)

Orchestrated batch: every `who:claude-auto` issue of the Story v2 prompt, one Sonnet subagent per issue, one commit per issue, checks run by the orchestrator after each one. Log: `docs/BATCH_PROGRESS.md`.

## Was main merged?
**No.** Claude did not push to main. Two PRs, both green on validate / build / sim / playtest / mobile-check:

| Phase | Branch | PR | Base |
|---|---|---|---|
| 1 — Story v2 | `claude/blissful-allen-frelxh` (25 commits, 12 issue commits) | [#161](https://github.com/CostGal/unremembered/pull/161) | `main` |
| 2 — polish | `claude/story-v2-phase2` (stacked, 9 issue commits) | #162 (see the PR list) | `claude/blissful-allen-frelxh` |

Merge order in the morning: **#161 first, then #162** (or merge #162 into #161's branch and that into main). Every Phase 2 issue is one commit; to drop one, `git revert <hash>` on the Phase 2 branch:

| Phase 2 issue | commit | revert cost |
|---|---|---|
| #135 break line + weighted poise | `6bf5801` | later commits touch applyHit's `poiseSource`/`crit` (#134, #136); revert last if at all |
| #137 melee approach | `69b3d0c` | #136's reparry uses `meleeReturn(force)`: revert #136 first |
| #134 crits | `e7d274e` | #136 reads nothing from it; safe |
| #130 Archive 3 turns / 50 | `7e516d2` | data only; safe |
| #132 feint resumeSpeed | `c688edb` | data + Qte.js; safe |
| #136 Quill parry/dodge | `b40d3c3` | safe |
| #138 displayScale data + portraits | `88e14f1` | data + CLAUDE.md; safe |
| #140 platform / drift / shadows | `39297fb` | safe |
| #133 swipe dodge (flag off) | `4ed950a` | safe; flag is off anyway |

## Decisions (logged as they were made)
1. **Branching:** no pushes to main; PR per phase (Addendum 2). Reason: nothing half-done can deploy while Kostas sleeps.
2. **Echo caps** (`levels.json echoMax`): Rhea 1 / 3 / 5 / 7 / 8 for Recall 1–5, Dov 5 at every level. Chapter levels: b0 Recall 1 (cap 1), b1–b2 Recall 2 (cap 3), b3 Recall 3 (cap 5), boss Recall 4 (cap 7) → Keepsake 10. `characters.json echoPips`: Rhea draws 10 pips (locked dim), Dov exactly 5.
3. **Blast by level** (`techniques.json blast.levels`): L1 cost 1 / exactly 2 bolts / no crit · L2 cost 2 / 3 bolts · L3 cost 3 / 3–5 bolts / 20 % crit · L4 = today's Blast (3 / 3–6 / 30 %). Tremor costs 5, Anchor 4, Brace 3, Return to Sender 3. The Recall card prints "Blast grows: …". Validate errors if any known technique costs more than its hero's cap at that level.
4. **"Landed player hit"** (events `playerHits`) = one per player action (Strike or attack technique) that dealt damage to at least one enemy; counters, Return to Sender and Recollection don't count.
5. **Events** fire once, in list order, only between turns (`afterTurn`) and once after the intro; `endBattle` = INTERRUPTED end: no Victory band, no grade card, XP + Recall card, chapter continues. `keepsake_burn` / `archive_insight` stay on their phase/release hooks (not trivial to move).
6. **dov_rival** uses Dov's sheets through a generic `animSet` alias (loader + `animKey`); no `poise` → no break line; `refuseUntilFlag: "duelWake"`, text in `battleEvents.json refuse` (translatable).
7. **Warden Hollow = 2×** (`displayScale: 2`, integer only). Measured `hollow.png` art bbox 97×103 in the 128 canvas; at 2× (≈200×210) it cannot avoid overlapping the second enemy's canvas, but the plain Hollow draws in front (higher feetY), nothing crosses y 360, and the story line says "one is twice the size of the other", so 2× ships. Gate formation `ui.battleLayout.enemies.gate`: warden {262, 330}, hollow {196, 346}. Enemy labels are clamped to the view (`labelMargin`). K3 stays open only if it looks wrong on a phone. Tap targeting: the hollow's frame wins in the overlap; the warden is tappable on its upper body / right side.
8. **Lifesteal** (#131) on both Siphons (warden + plain Hollow), amount = damage that got through, text "Siphoned".
9. **Balance** (enemy HP/damage only): hollow hp 80 → 65, claw 12 → 8, warden maul 7 → 6 (warden hp 100, siphon 4 after the A8 tune). Clerk untouched in Phase 1.
10. **Fix found on the way:** the Keepsake fill went through `echoMult`, so on Unforgettable Rhea got 5/10 and Recollection never unlocked. Now the fill is raw.
11. **Greek:** `el.json` holds no dialogue/cutscene text, so only UI strings got Greek (anchor flavor, refuse / lifesteal / defend / crit texts, hints, upgrade line).
12. **Phase 2 numbers:** poise in damage units (blank 18, hollow 24, warden 36, clerk 60) with weights strike 0.5 / counter 0.5 / ability 1 / multiHit 0.75 / ultimate 1.5 / crit ×1.5; crit chance hero 15 % / enemy 10 % (×1.5); Archive 3 turns / 50 dmg; feints resume ×1.6, Stamp feints 30 %; Quill defends 0 / 10 / 15 % by difficulty, reparry 350 ms for 22; `qte.swipeDodge` false (dodge windows 180 / 300 when on).
13. **#138 as changed:** `displayScale` is explicit data (`1` for everyone but the Warden), portraits dov 310 / clerk 380 tall. The Clerk portrait's right sleeve loses a sliver at the right screen edge at 380; no clamp added (it would shift Dov/Nala too). Size differences must come from new PNGs (list below).

## Per issue

### Phase 1
| Issue | Works | Placeholders / notes |
|---|---|---|
| A1 #141 text pass | 30 cutscene texts; 14 dialogue ids with exact text/speakers/portraits; Blank → Forgotten, The Clerk → Quill (`voices.json`, `nameColors`); anchor flavor + Greek; one 97-char keepsake line split at the sentence | – |
| #128 + A5 #142 Echo caps + Blast levels | caps by Recall, HUD pips 10/5, Blast levels, Tremor 5, Recall card upgrade line, validate cost ≤ cap | – |
| #129 + #139 Recollection boss-only + ready FX | button/teaser only in boss_clerk; gold flash + sparks + "MEMORY READY" + aura + `recollection` hint on unlock | – |
| A2 #143 events | `BattleEvents.js` grammar shared by scene / sim / validate; INTERRUPTED end | `ui.battleEnd.interruptedText` is "" (draw nothing) |
| A3 #144 party + dov_rival | `party` per battle, one-row HUD, `animSet` alias, refuse turn with no ring | – |
| A4 #145 b0_duel | refuse → wake (3 hits or round 3) → Nala at ≤ 50 %, interrupted end, XP 40 → Recall 2, slow-mo on Dov's first real ring, hints strike/techniques/echo | Nala is only in the dialogue (no sprite) |
| A6 #146 b1_forgotten | 2 Forgotten, Break hint first banner, red rings off | – |
| A7 #147 b2_first_hollow | b2_start after the intro, b2_immune after the IMMUNE pop, Nala's prompt, red rings + statuses on from here | – |
| #131 + A8 #148 Warden + b3_gate | 2× warden, gate formation, lifesteal, Maul 2 hits + feint, label clamp | K3 sprite only if 2× looks wrong |
| A9 #149 boss polish | texts verified vs STORY, boss lab 0 errors, Keepsake fill fix, dialogue QA reads portrait facing | – |
| A10 #150 chapter v2 | 15 steps, v1 battles removed, scripts/QA on the new ids, sim chapter table, tuning | – |
| A11 #151 docs | STATUS.md "Story v2" section, CLAUDE.md examples | – |

### Phase 2
| Issue | Works | Notes |
|---|---|---|
| #135 | gold line under the name, shrinks from the right, shatters into shards on BREAK, 120 ms hitstop, bigger pop; poise = damage × weight | break hint text now says "golden line" |
| #137 | Strike and enemy melee attacks walk to a spot beside the target (feet aligned), fight there, walk back; ranged (Siphon, Archive) stay put; ring timing unchanged | an enemy killed by a counter stays where it fell |
| #134 | `crit.json`; hero Strike and enemy hits crit; a parry/dodge negates the enemy crit silently | Blast keeps its own bolt crit |
| #130 | Archive 3 turns / 50; CLAUDE.md updated | boss interrupt rate 60–73 % (normal) |
| #132 | `feint.resumeSpeed` 1.6 on Redact and Stamp (30 % chance); plain rings byte-identical | the `clerk_redact` sheet's impact frame lands ≈345 ms after T (≈250 before): the sheet is longer than the ring; pre-existing, ring/judgement are on T |
| #136 | Quill parries Strike (reparry ring 350 ms / 22) and dodges Blast/Tremor; Story 0 % | sim boss non-gamer 99.98 % |
| #138 | integer `displayScale` data, portraits 310/380 | art list below |
| #140 | platform layer (procedural gradient band until the PNGs exist), bg drift ±4 / ±2 px, soft shadows under every fighter and Nala | art list below |
| #133 | `qte.swipeDodge` false by default; flag-off path verified unchanged (timing lab, playtest, mobile-check); flag-on: swipe = dodge with 180/300 windows, tap = parry | not exposed in Settings (data flag only) |

## Sim (normal, 2000 runs per cell, Phase 2 head)
| Battle | non-gamer rounds / min / win | average | good |
|---|---|---|---|
| b0_duel | 4.9 / 1.0 / 100 % | 4.6 / 0.9 / 100 % | 4.4 / 0.8 / 100 % |
| b1_forgotten | 7.5 / 1.7 / 100 % | 6.9 / 1.3 / 100 % | 6.2 / 1.0 / 100 % |
| b2_first_hollow | 7.1 / 1.8 / 100 % | 6.8 / 1.4 / 100 % | 6.3 / 1.2 / 100 % |
| b3_gate | 16.6 / 3.8 / 99.9 % | 11.2 / 2.1 / 100 % | 8.1 / 1.3 / 100 % |
| boss_clerk | 13.9 / 3.4 / 100 % | 11.6 / 2.4 / 100 % | 10.0 / 1.9 / 100 % |

Chapter total = cutscene 2.2 + dialogue 2.8 + battles incl. expected retries:

| Profile | Phase 1 head | Phase 2 head |
|---|---|---|
| non-gamer | 16.5 min | **16.8 min** (target ≤ 18) |
| average | 13.1 min | 13.2 min |
| good | 11.1 min | 11.2 min |

Story mode: 100 % in every cell, 10.9 rounds on b3_gate for a non-gamer.

## Checks
| Check | Phase 1 head | Phase 2 head |
|---|---|---|
| `npm run validate` | 0 / 0 | 0 / 0 |
| `npm run build` | ok | ok |
| `npm run sim` | 100 % (b3 99.9 %), 16.5 min | 100 % (b3 99.9 %), 16.8 min |
| `npm run playtest` (real + fake) | pass, 0 retries | real pass (319 s, 0 retries); fake not re-run after Phase 2 |
| `npm run playtest -- --story` | pass | pass (340 s, 0 retries) |
| `npm run playtest -- --profile average` | pass | not re-run |
| `npm run mobile-check` | 36/36 | 36/36 |
| boss lab (`scripts/qa/boss.mjs`) | errors 0 | errors 0 |
| battle lab `--only nala,commands` | 10/10 | 10/10 |

Could not run / not run here: nothing was blocked; the container's headless Chromium ran every browser script. Known lab noise: `scripts/qa/battle.mjs` full run has one pre-existing failing case ("PERFECT gives +2 Echo", because `?battle=` runs at Recall 1 where Rhea's cap is 1: add `&level=2` to that case) and `scripts/qa/timing.mjs` shows `clerk file_away` impact nulls as before the batch.

## Phone test URLs
Base: `https://costgal.github.io/unremembered/` (after merge). `?step=N` starts the chapter at that step with the Recall a real run would have.

| Step | URL | What to check |
|---|---|---|
| 0 cutscene | `?step=0` | 30 shots, shot 22 Hush + hush sfx, 23 lit again, 30 "fight back" |
| 1 letter | `?step=1` | Rhea "Ow... my head." first, letter lines |
| 2 meet_dov | `?step=2` | she draws the baton |
| 3 b0_duel | `?step=3` or `?battle=b0_duel` | Rhea alone, 1 pip, Blast costs 1; refuse → wake → slow-mo ring → Nala stops it at 50 %; Recall 2 card |
| 4 after_duel | `?step=4` | |
| 5 b1_forgotten | `?step=5` or `?battle=b1_forgotten&level=2` | Break banner, gold line shatters |
| 6 reward | `?step=6` | |
| 7 after_b1 | `?step=7` | |
| 8 b2_first_hollow | `?step=8` or `?battle=b2_first_hollow&level=2` | b2_start overlay, IMMUNE → b2_immune, Nala prompt, red ring lesson |
| 9 before_gate | `?step=9` | |
| 10 b3_gate | `?step=10` or `?battle=b3_gate&level=3` | 2× Warden, Siphoned heal, Maul feint |
| 11 reward | `?step=11` | |
| 12 records_office | `?step=12` | Quill portrait (380 tall), name "Quill" |
| 13 boss | `?step=13` or `?battle=boss_clerk&level=4` | Archive in 3, Stamp feint, PARRIED/DODGE, Keepsake → MEMORY READY + hint |
| 14 ending | `?step=14` | ▯▯▯ line, silhouette |
| Recollection at once | `?battle=boss_clerk&echo=10&level=5` | ready FX |

## Art Kostas must make (none blocks the game)
**#138 — size differences (integer scale only; canvases unchanged unless noted)**

| Character | Canvas | Art height today | Target |
|---|---|---|---|
| Rhea | 128×128 | 116 px | unchanged (reference) |
| Dov | 128×128 | 113 px | ~126 px (taller than Rhea). If 128 is too tight: 160×160 canvas, then every `dov_<anim>.png` + `frame_size` in `dov_animations.json` |
| Forgotten (`blank`) | 128×128 | 113 px | ~100 px; regenerate every `blank_<anim>.png` |
| Hollow | 128×128 | 103 px | ~120 px; regenerate every `hollow_<anim>.png` (the Warden reuses them at 2×) |
| Quill (`clerk`) | 256×256 | 228 px | ~240 px; regenerate every `clerk_<anim>.png` |
| Warden Hollow (K3) | 256×256 | – | only if the 2× Hollow looks wrong; prompt in STORY.md |

Portraits: `dov_*` and `clerk_*` stay 299×400 (`displayHeight` does the sizing).

**#140 — platform PNGs (optional; the procedural band stands in)**
- `public/assets/bg/street_rain_platform.png`, 360×110 (y 250–360): wet cobbles, lit top edge/curb, navy + teal, near-opaque, sides tileable (mirrored on wide screens).
- `public/assets/bg/records_office_platform.png`, 360×104 (y 256–360): wooden/stone floor, warm brown, lit top edge.
- The 360×360 backgrounds should have seamless left/right borders (they sway ±4 / ±2 px). If a floor PNG changes size, update `w`/`h` in `assets.json` and `platform.y` in `environments.json`.

## Checklist for Kostas (who:kostas)
1. **Merge** [#161](https://github.com/CostGal/unremembered/pull/161), then #162 (Phase 2). If anything in Phase 2 feels wrong on the phone, revert that one commit (table above).
2. **K1 #152 — text on a phone:** `?step=0` (cutscene), then `?step=1,2,4,7,9,12,14` for every dialogue; read the duel/b2 overlays inside `?step=3` and `?step=8`.
3. **K2 #153 — feel check:** `?battle=b0_duel` (refuse beats, Nala stop), `?battle=b1_forgotten&level=2` (Break line), `?battle=b2_first_hollow&level=2` (immune, Nala, red ring), `?battle=b3_gate&level=3` (Warden 2×, Siphoned, Maul feint), `?battle=boss_clerk&level=4` (Archive in 3, Stamp feint, PARRIED/DODGE, Keepsake). PERFECT must still feel the same: nothing in the parry windows changed (`qte.swipeDodge` stays off).
4. **K3 #154 — Warden sprite:** only if the 2× Hollow looks wrong in b3.
5. **K4 #38 — real-phone pass + tag `v0.1-jam`** after the merge (checklist in CLAUDE.md; deploy by 14:00).
6. Optional art: the #138 / #140 lists above.
