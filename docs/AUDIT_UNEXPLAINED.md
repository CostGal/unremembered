# Audit: things the game does but never explains

Audit of `origin/main` (Sat 3 Oct 2026, after Batch 5 and the v2 items: Nala glow, poise, crush, slam, Feel B). Read-only audit; no game code was changed. Audience: non-gamers on a phone, 12-15 min, 360x640 canvas, so every proposed text must fit in 2 lines.

How the existing teaching works (so the table is easy to read):
- **Spotlight pauses** (`src/data/tutorial.json`): `battle_start` (4 steps), `parry`, `dodge`, `technique_guided`, `blast_explain` only in b0 (`battles.json` b0_duel `pauses`); `break_intro` in b1; `red_ring`, `crush`, `nala_glow` with `always: true`; `leveling` on the first Recall card. Each shows once per run. `learn_<tech>` and `nala_save` are being added by another agent right now: marked "in flight" below and not re-proposed.
- **Banners** (`ui.json` `tutorial.hints`, one line at the top, 5 s): `strike`, `echo`, `techniques` exist only in tutorial battles (b0). `chain`, `break`, `status`, `dodge`, `recollection`, `blast_unlocked` are `always`. `TutorialHints.js` shows each once per session.
- **Dialogue** teaches Hollow immunity (`b2_immune`), Nala's warning (`b2_start`), Archive (`archive_warn`, `archive_insight`, `archive_threat`), the Warden (`before_gate`), Nala's glow (`b3_nala_glow`), Quill's rise and the Keepsake.
- **On-screen words** pop over fighters (PERFECT, GOOD, DODGE, CRIT!, BREAK!, STUNNED, Recovered, Siphoned, Archived, ...).

"Explained?": yes = told, or self-evident from the visuals; partly = a hint exists but leaves out a rule the player needs; no = silent.
Effort: S = JSON text or a one-line trigger; M = new UI line or small code.

## Table

### A. Echo

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Echo bar, one pool per hero (Rhea 10 pips, Dov 5); the ring's target earns the Echo | b0 (Rhea); Dov from b1 | "Echo" label + teal pips under each hero's HP | partly | `battle_start` step 2 "Echo. Strikes and PERFECT parries fill it." (`tutorial.json:32`). Never said that each hero has their own pool. | add to the Dov intro (#55): "Each hero has their own Echo." | S |
| 2 | Turn Echo: +1 at the start of each hero's own turn | every turn from b0 | a teal "+1" over a pip and a blip as the menu opens (`BattleScene.js:1384`, `characters.json:79,93`) | no | none; the pause lists only Strikes and PERFECT parries | `tutorial.json:32` -> "Echo fills every turn, with each Strike, and +2 per PERFECT parry." | S |
| 3 | Strike +1 Echo (only if it lands) | b0 | "+1" pip number | yes | `battle_start` step 2; `hints.strike` | none | - |
| 4 | PERFECT +2 Echo, GOOD 0, dodge 0 | b0, first parry | "+2" pip numbers, PERFECT burst | partly | banner `hints.echo` "PERFECT parries charge Echo" (b0 only, `ui.json` hints.echo), `dodge` pause "no Echo". "+2" and "GOOD gives none" never stated. | `ui.json hints.echo.text` -> "PERFECT parry: +2 Echo. GOOD: none." | S |
| 5 | Techniques spend Echo and never give any | b0 | greyed technique buttons with "{n} Echo" | yes | `battle_start` step 4, `blast_explain` (`tutorial.json:34,58`); cost on the button | none | - |
| 6 | Echo cap grows with Recall (Rhea 2/3/5/7/8, Keepsake 10); dark "locked" pips | b0 (8 of Rhea's 10 pips are dark); every level-up | pips past the cap drawn dark with a grey outline (`Hud.js:306`) | no | The `leveling` pause (`tutorial.json:79-84`) lists HP, Strike, techniques, not Echo room. `upgradeDetail` has no Echo key (`levels.json:29`). | now: `tutorial.json:82` -> "Recall grows: more HP, more Echo room, harder Strikes, new techniques." Later: a "Rhea Echo 3 -> 5" line on the card (`levels.json` text + `RecallCard.js:148`). | S / M |
| 7 | Echo gained at the cap is wasted | late fights | no "+N" appears; full pips pulse (`Hud.js:311`) | partly | pulse only | none needed | - |
| 8 | Siphon: a missed parry drains 2 Echo | b2 (Hollow, weight 1), b3 Warden | pips quietly shrink; no "-2" (`gainEcho` pops only gains, `BattleScene.js:2745`) | partly | `before_gate`: "The big one drinks Echo, and heals on it." | `BattleScene.js:2745`: pop a red "-2 Echo" when `amount < 0` | S |
| 9 | HP full and Echo 0 at the start of every battle | b1 on | bars refill, pips empty | no | none; low confusion | none | - |
| 10 | Difficulty scales Echo (Unforgettable x0.5) | New Game / Settings | picker label "Unforgettable (hard)" | partly | `qte.json:41` hint "Echo comes slowly" shows only in Settings | see #67 | S |

### B. Parry, dodge, chain

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 11 | Ring closing = tap anywhere; PERFECT / GOOD / MISS | b0, Dov's first attack | ring on Rhea, slowed 0.35x, prompt "Tap anywhere when the ring closes!" | yes | `parry` pause (`tutorial.json:37`), `qte.json:117-128`, persistent hint "Tap to parry · swipe to dodge" (`qte.json:116`) | none | - |
| 12 | PERFECT = 0 damage + hit back (counter 4); GOOD = half damage | b0 | PERFECT burst, Rhea swings back, numbers | partly | visible, never named. "Counter" is never taught, yet Bandaged Fists says "PERFECT counter hits 3 harder" (`fragments.json:202`). | `tutorial.json:38` -> "Tap when the ring closes. PERFECT blocks all and hits back." | S |
| 13 | Parry assist (+30 ms per 2 misses, max +90) | any losing streak | nothing | no (intentional) | invisible by design (`qte.json:14`, `BattleScene.js:1647`) | none; keep hidden | - |
| 14 | Dodge (swipe) vs parry trade-off | b0, Dov's 2nd attack | swipe-indicator pause, "DODGE" word, no counter, no Echo | partly | `dodge` pause + banner (`tutorial.json:43`, `ui.json` hints.dodge). Not said: wider windows (180/300 vs 90/200 ms), a dodge keeps the chain, a late dodge still takes half. | `tutorial.json:43` -> "Swipe to dodge: easier timing, but no Echo and no counter." | S |
| 15 | Dodge feedback does not tell PERFECT from late | any dodge | white "DODGE" for both (`qte.json:100-101`, only the colour differs) | partly | none | `qte.json:101` GOOD text -> "late dodge" (data only) | S |
| 16 | Red ring = unparryable, swipe only; a tap says "CAN'T PARRY" | b1, first Forgotten Crush | red ring, "!" icon, hint "Swipe to dodge!", slow-mo for 2 tries | partly | In b1 the `crush` pause stands in for `red_ring` and marks it seen (`BattleScene.js:1528`), so the 2-step `red_ring` text (what a red ring is; PERFECT / late / tap outcomes, `tutorial.json:73-77`) never shows. The `crush` text "A heavy blow: only a PERFECT dodge avoids it fully. Swipe early!" is misleading: the touch is judged at the ring's close; an early swipe (200-350 ms before) is a MISS. Red-ring swipes also use the tight parry windows (90/200 ms), not the dodge windows: unsaid. | `tutorial.json:86` -> "RED ring: can't be parried. Swipe just as it closes." and append the `red_ring` outcomes step. | S |
| 17 | Feints: ring freezes mid-way then rushes (Stamp 30 %, Redact always, Maul hit 2, Dov's Hook in b0) | b0 (Hook: 350 ms freeze) | ring stops at 60 % for 0.35 s, enemy holds the pose, then closes 1.6x faster (Stamp, Redact) | no | none anywhere (`enemies.json:60,94,101,148,170`) | new banner `ui.json hints.feint` (always): "Some attacks fake a pause. Wait for the ring to close." + `this.hints.show('feint')` when `hit.feint` survives in `enemyHit` (`BattleScene.js:~1689`) | S |
| 18 | Multi-hit attacks (File Away 2 rings, Maul 2) | b3 Warden, boss | a 2nd ring starts right after the first resolves | partly | self-evident (rings follow one another); nothing says "again" | optional banner "Two hits: parry each one." | S |
| 19 | Chain: CHAIN xN, +10 % damage per step up to x5, GOOD / dodge keep it, MISS breaks it, IN RHYTHM at 5 | b0, 2nd PERFECT in a row | small gold "CHAIN x2" at 11 px (`ui.json` hud.chain), pop, "IN RHYTHM" flash at 5 | partly | banner `hints.chain` "Chain PERFECTs for bonus damage", once at chain 2 (`BattleScene.js:2707`). The % and the keep / break rules are not said. | `ui.json hud.chain.label` -> "CHAIN x{n}  +{pct}%" (1-line change in `Hud.js:129`) | M |
| 20 | Crit (hero 15 %, enemy 10 %, x1.5) "CRIT!" | b0 on | gold "CRIT!" + big number; same word and colour for both sides | partly | the word explains itself; an enemy crit looks like a good thing | enemy crit in red (`crit.json` + 1 line at `BattleScene.js:2635`) | S |
| 21 | Blast crit adds ONE extra bolt, shown "+1" | Blast at Recall 3+ | teal "+1" over the target, one more bolt | no | none (`techniques.json:199`) | `blast.critText` -> "CRIT +1 bolt" | S |

### C. Break, poise, statuses

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 22 | Poise line + BREAK: empty it, the enemy loses its next turn and takes x1.5 | b1 | a 40x2 px gold line under the enemy name (`break.json:5-17`) | yes | `break_intro` pause, 2 steps, spotlights the line (`tutorial.json:64-71`) | none (the line is tiny; the pause covers it) | - |
| 23 | STUNNED label and "Recovered" | b1, first break | 10 px red "STUNNED" under the name (`break.json:18`), grey "Recovered" later | partly | the pause says it loses its next turn | none | - |
| 24 | Which hits break faster (techniques x1.0-1.5, Strike x0.5) | b1 on | nothing | no | none (`break.json:4`) | `tutorial.json:69` -> add "Techniques break it faster." | S |
| 25 | Target-card tags BRK / CHG | b1, b3, boss target picks | tiny tags "BRK", "CHG" (`ui.json:473`) | no | none | `ui.json target.text` -> "BROKEN" / "CHARGING" if it fits the tag box | S |
| 26 | FOG (Hollow Claw, 30 % on a missed parry): command names read "???" for 1 turn | b2 | "FOG" pop, badge "F1", buttons say "???" but still work | partly | banner `hints.status` "Statuses fade. Anchor clears them" (once) | add "FOG hides names, not buttons" as a second line of that banner for fog | S |
| 27 | REDACTED (Quill's Redact on a miss): a black bar covers one technique for 2 turns | boss stage 2 | "REDACTED" pop, badge "R2", technique greyed with a bar | partly | same banner | same banner (already worded for all statuses) | - |
| 28 | Status badges on the HP row: letter + turns left (R2, F1, E1) | b2 on | a small box "R2" beside the HP bar | no | no legend (`statuses.json:2-5`, `Hud.js:203`) | the apply-pop already names it; add the name to the target-card tag ("FOG 1") instead of a letter | S |
| 29 | Exposed (X, x1.3 damage) | never | `applyEnemyStatus` is never called (`BattleScene.js:2157`); the Recollection now kills outright | n/a | dead content (`statuses.json:4`) | leave; no player impact | - |
| 30 | Echo Strike (E, Nala's Glow): Strikes wound Hollows for one turn | b3 round 1 | "ECHO STRIKE" pop, badge "E1" | yes | `nala_glow` pause (`tutorial.json:91-97`) + `b3_nala_glow` dialogue. Caveat: the event fires only if nothing hurt a Hollow in round 1 (`battles.json:56`); otherwise the Glow is never unlocked or explained. | none now | - |
| 31 | Anchor also clears statuses ("Cleared") | when Dov anchors a statused hero | teal "Cleared" pop | partly | banner `hints.status` | `learn_anchor` (in flight): add "and clears statuses" | S |

### D. Enemy abilities (Hollows, Warden, Quill)

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 32 | Hollow is IMMUNE to Strike | b2, first Strike on it | "IMMUNE" word; target card "IMMUNE to Strike" (`ui.json:470`) | yes | `b2_immune` dialogue; `techniques.json:177` | none | - |
| 33 | Siphon lifesteal: the enemy heals what it hurt | b2 Hollow, b3 Warden | green "+N" over the enemy and "Siphoned" (`battleEvents.json:37`) | partly | `before_gate`: "drinks Echo, and heals on it" (only after b2, where Siphon first appears) | optional: move that line into `b2_start` | S |
| 34 | Warden Hollow: big sprite, Maul (2 hits), Slam (red, unparryable) | b3 | 2x sprite, red ring on Slam | partly | `before_gate`; red rings taught in b1 | none | - |
| 35 | Archive: Quill charges (glow, "Archive in N · guarded"), takes 60 %, then a red unparryable release | boss stage 1, his 2nd turn | "Archive..." pop, teal aura, countdown, grey damage numbers | partly | `archive_warn` after the first charge turn: "Break him before it closes!" "guarded" (he takes only 60 %) is never defined. | `battleEvents.json:26` counterText -> "Archive in {n} · takes 60 %" | S |
| 36 | "Archived" heal after the release; "Archive lost!" on a BREAK | boss | green "+N" + "Archived"; "Archive lost!" | yes | `archive_insight` ("Every blow we landed came back as his"), `archive_warn` | none | - |
| 37 | Quill PARRIES your Strike ("PARRIED"), then a quick riposte ring on your hero (350 ms, 22 dmg) | boss, 10 % per Strike (15 % Unforgettable, 0 Story) | your Strike does nothing, "PARRIED", an unannounced short ring | no | none (`enemies.json:53`, `reparry` at `BattleScene.js:3152`) | banner `hints.reparry` (always) on the first PARRIED: "He parried! Answer his counter." | S |
| 38 | Quill DODGES Blast / Tremor ("DODGE") | boss | bolts fly, nothing lands | no | none (`enemies.json:53`) | fold into #37 banner: "Quill can parry Strikes and dodge Blasts." | S |
| 39 | Quill acts first (`initiative: enemy`) | boss start | his ring appears before any menu | no | none (`battles.json:58`) | none (rings already taught) | - |
| 40 | Quill falls and rises, ENRAGED, red aura, "heh" | boss, end of stage 1 | death pose, dialogue, 220 HP, "ENRAGED" | yes | `quill_rise`, stage pop (`battleEvents.json:155`) | none | - |
| 41 | HP floor "He won't fall" | boss, below 35 % of stage 2 | grey-red word on every 2nd clamped hit | partly | none; short-lived, the Keepsake fires right after | none | - |

### E. Keepsake and Recollection

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 42 | Recollection teaser button "Recollection 3/10 Echo" with a fill bar | boss, from turn 1 | a disabled bar that tops out at 7/10 (Rhea's cap is 7 at Recall 4), so it can never fill | no, and misleading | `ultimateItem` (`BattleScene.js:1181`), `ui.json:403` | show "Not yet" instead of the numeric progress until the Keepsake (`ui.json commands.labels.ultimateProgress` + one branch) | S |
| 43 | Keepsake burn, then an automatic Recollection; Echo jumps to 10 | boss, 35 % of stage 2 | dialogue, teal flash, cut-in, the beats | yes | `keepsake_burn` dialogue + `recollection_cutin`; banner `hints.recollection` is skipped on the auto-cast | none | - |
| 44 | The three beats: HOLD / SWIPE / TAPS | boss | big prompt per beat, counter, gauge | yes | prompts (`recollection.json:18,26,33`) | none | - |
| 45 | PERFECT / GOOD / MISS per beat; grade FLAWLESS / CLEAN / ROUGH | boss | pop per beat, grade word + line, "Memory: X" on the result card | partly | `recollection.json:65-67`; any non-MISS kills, so the grade changes nothing; not said | none (cosmetic) | - |
| 46 | "The memory slips..." then Unwriting (NO ESCAPE), then Try again / Quit | boss, all three beats missed (3 % non-gamer) | grey text, a no-input red ring on both heroes, LOSE card | partly | text only; "Try again" (rewind to the cast) vs "Retry" never contrasted; "Quit" leaves the chapter | line under the buttons (`ui.json battleEnd`): "Try again: replay the Recollection." | S |

### F. Techniques and allies

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 47 | Blast: cost, bolts, grows with Recall | b0 after the 2nd ring | guided "Tap Technique", 2 steps | yes | `technique_guided`, `blast_explain` (`tutorial.json:48-63`) | none | - |
| 48 | Return to Sender: costs 2, "On guard", counters the next enemy attack if you parry it | Recall 2 (after b1) | "On guard" pop, a held pose; later "Return to Sender!" | no | Recall card shows the name + a lore line (`levels.json:14`). **In flight: `learn_<tech>`** | make sure the text says "Costs 2. Parry the next attack to hit back hard." | S |
| 49 | Anchor (Dov): heal 20/25, target pick, revive from Recall 3, clears statuses | b1 (Dov has it at Recall 1, so no level-up card ever introduces it) | a grey "Anchor 2 Echo" button, greyed when nobody is hurt | no | no learn card; target prompt "Who does Dov anchor?" (`techniques.json:233`). **In flight: `learn_<tech>`**: check it also covers level-1 Anchor. | text: "Anchor: heal a hero. Costs 2." | S |
| 50 | Anchor revives only from Recall 3; before that a downed hero stays down | b1 / b2 if a hero falls | row dims, the card says DOWNED (`ui.json:471`); nothing on the field | no | `upgradeDetail` has no revive key, so the unlock is silent | `levels.json:29` add `canRevive: "can revive"`; pop "DOWN" at the KO (`markDown`, `BattleScene.js:840`) | S |
| 51 | Tremor (Dov, Recall 3, costs 5 = all his Echo): hits every enemy | b3 | shockwave on all enemies | no | no flavor line either (`levels.json:13-17`). **In flight: `learn_<tech>`** | text: "Tremor: hits all enemies. Costs all your Echo." | S |
| 52 | Brace (Dov, Recall 4): halves damage from the next enemy attack only | boss | "Brace!" on both heroes, "Braced" on a hit | no | none; it ends after one enemy attack (`this.brace = null`, `BattleScene.js:1531`). **In flight: `learn_<tech>`** | text: "Brace: half damage from the next attack." | S |
| 53 | Nala save: a Hollow telegraphs, she glows, tap her to cancel (once per round, Bell +1); hiss cut-in | b2, first Hollow ring | orange glow, the tap hint becomes "Nala senses a Hollow! Tap her!" (`allies.json:12`) | partly | `b2_start` ("Watch Nala. She feels them before they strike."). **In flight: `nala_save`** | make sure it says "Tap her during the ring"; the "used this round" state shows nothing | S |
| 54 | Nala glow (Echo Strike) call, "Glow ready" / "Glow in N" | b3, round 2 | label over Nala, 3-round cooldown | yes | `nala_glow` pause, `allies.json:75` | none | - |
| 55 | Dov arrives: two heroes, Rhea then Dov each round, own menus | b1 | second HUD row, lit name, marker over the active hero | partly | no pause on Dov joining | one step after `break_intro` in b1: "Rhea acts, then Dov. Each has their own Echo." | S |
| 56 | Technique buttons greyed (not enough Echo, Redacted, Anchor with nobody hurt) | any | grey button with cost | partly | self-evident; the "nobody hurt" case is silent | none | - |

### G. Memories, rewards, Recall, results

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 57 | Reward screen: pick 1 of 3 memories | after the b1 rest scene | "A memory returns..." "Pick one. It stays with you." + cards with an effect line | yes | `fragments.json:5,11,180-235` | none | - |
| 58 | Enemy drops (Grey Raincoat, Dust Shard) | after b1 / b2 | "A memory, left behind" card with effect | yes | `fragments.json:57`, `DropCard.js` | none | - |
| 59 | Small letter icons in the HUD (H B F R D P) | after the first pick | tiny boxes near the Echo row, not tappable | no | none (`Hud.js:191`) | none, or tap-to-name (M); low priority | M |
| 60 | Effect texts use unlearned words ("counter", "Anchor") | reward screen | "PERFECT counter hits 3 harder"; "Anchor heals 10 more" | partly | see #12, #49 | `fragments.json:202` -> "After a PERFECT parry, your hit-back does +3." | S |
| 61 | Recall card: +N Memories, bar, "Recall N", HP and Strike growth | after b0 | gold card, bar fills, "RECALL 2" pops | yes | `leveling` pause (first card), `levels.json:18-27` | none | - |
| 62 | "remembers {tech}" / "{tech} grows: ..." lines | Recall 2 / 3 / 4 | the name and a poem line ("A courier's rule: every letter finds its way home.") | partly | lore only, no mechanic; Tremor has no line. **In flight: `learn_<tech>`**. "grows" omits revive and status-clear (`levels.json:29`). | see #48-52 and #50 | S |
| 63 | "Lv2" beside the name vs "Recall 2" on the card | b1 on | gold "Lv2" at 10 px (`levels.json:27`) | partly | none | `levels.json:27` -> use the same word on both ("Recall 2" if it fits; otherwise rename the card to "Level 2") | S |
| 64 | "Memory" means five things: XP ("+60 Memories"), item ("A memory returns"), loss ("The memory fades..."), ultimate ("MEMORY READY", "Memory: X"), Recall | whole game | five meanings | no | none | smallest change: XP line `levels.json text.memories` -> "+{n} Recall" so XP and items stop sharing the word | S |
| 65 | Result card: Perfects / Max chain / Damage taken / Turns, rank stamp S / A / B | after b1+ | rows then a stamp | partly | one-time hint "Perfect parries raise your rank" (`grade.json:10`). There is no C (ranks S/A/B). "Turns" has a hidden par (5-14) and a penalty (`grade.json:9`). The rank has no gameplay effect. | "Turns 9 (par 7)" in the row (`grade.json` label + one value change at `ResultCard.js:103`) | M |
| 66 | "Best: A" / "New best!" (session memory only) | replay after a Retry | grey text | yes | `grade.json:125` | none | - |

### H. Menus, difficulty, meta

| # | Mechanic / moment | First happens | What the player sees | Explained? | How | Proposed fix | Effort |
|---|---|---|---|---|---|---|---|
| 67 | Difficulty picker: Story / Normal / Unforgettable | New Game | "Story (easier timing)", "Normal", "Unforgettable (hard)" + "change it any time in Settings" | partly | full descriptions only in Settings (`qte.json:21,31,41`). Story also halves damage and removes enemy parries; Unforgettable also +35 % enemy HP and half Echo. | show the focused button's `hint` under the buttons (`MenuScene.js:132-146`, 1 text object) | M |
| 68 | Difficulty effects in Settings | Settings | one hint line under the toggle | yes | `SettingsScene.js:108` | none | - |
| 69 | Lightning, thunder, rain | b0-b3 | flashes and thunder every 14-28 s; suppressed during rings (`BattleScene.js:307`) | yes (ambience) | none needed | none | - |
| 70 | Retry restores the battle-start state | after a loss | "The memory fades..." + Retry; HP full, Echo 0 | yes | `ui.json:579-583` | none | - |
| 71 | End screen: "End of Demo", credits, "Will be revealed post game jam" | end | credits, a teaser line, "Chapter 2: The Gallery - locked." (`dialogue.json` ending) | partly | `credits.json:3` hiddenText reads like a glitch to a judge | `credits.json` hiddenText -> "More of Rhea's story after the jam." | S |
| 72 | Pauses are one-time per run; banners once per session | all | pauses never repeat, even after a Retry | yes | `TutorialPause.js:55-58` | none | - |

## Top 10 by player confusion x ease of fix

1. **Recollection teaser bar stuck at 7/10 (#42).** The only meter in the boss fight that can never fill. Show "Not yet" instead of numbers until the Keepsake. S: `ui.json commands.labels.ultimateProgress` plus one branch in `ultimateItem` (`BattleScene.js:1181`).
2. **Feints (#17).** The most frequent unexplained thing (Dov's Hook is already in the first fight; Stamp 30 %, Redact, Maul); a frozen ring reads as lag. One `always` banner `hints.feint` and one `hints.show('feint')` in `enemyHit`.
3. **Turn Echo +1 per turn (#2).** Half of all Echo income is unmentioned. Edit `tutorial.json:32` to name all three sources.
4. **Quill parries and dodges your attacks, then a riposte ring (#37, #38).** A punishing surprise with no signal. One banner on the first PARRIED / DODGE.
5. **Red-ring text is misleading and its scoring step is never shown (#16).** `crush` says "Swipe early!"; change to "Swipe just as it closes" and add `red_ring` step 2 to `crush`.
6. **Echo cap grows with Recall (#6).** Eight dark pips never explained; one phrase in the `leveling` pause now, a card line later.
7. **Brace / Tremor / Return to Sender / Anchor have no mechanic text (#48-52).** In flight as `learn_<tech>`; check it covers Anchor at Recall 1 (no level-up card exists for it), Brace's "next attack only", and Return to Sender's "needs a parry".
8. **Downed hero and revive from Recall 3 (#50).** Silent KO, silent unlock; add a DOWN pop and a `canRevive` word in the "grows" line.
9. **Siphon's -2 Echo is silent (#8).** One `Fx.popText` in `gainEcho` for negative amounts.
10. **Chain bonus (#19) and par on the result card (#65).** Show "+20 %" next to CHAIN and "Turns 9 (par 7)" so the numbers explain themselves.

Next tier: difficulty picker hints (#67), "memory" naming (#64), BRK / CHG tags (#25), "techniques break faster" (#24), Dov joining line (#55), HUD letter icons (#59), enemy crit colour (#20), end-screen teaser line (#71).

## Findings that are not text gaps

- `applyEnemyStatus` / Exposed is dead code (`BattleScene.js:2157`): the Recollection now kills outright (`techniques.json` recollection `kill: true`) and nothing applies Exposed.
- Result ranks are S / A / B only (`grade.json:4-8`); there is no C.
- `nala_glow` unlocks only when round 1 of b3 dealt no Hollow damage (`battles.json:56`); a player who hurts a Hollow with Blast or a PERFECT counter in round 1 never gets the Glow or its pause.
- Hero crit and enemy crit show the same gold "CRIT!" (`crit.json:5-6`).
- The `red_ring` pause is skipped whenever `crush` shows first (b1), so its dodge-scoring step is lost.
