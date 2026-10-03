# Batch progress — Story v2 (Fri 2/10 → Sat 3/10)

Orchestrator log, one line per issue. A new session continues from here.
Branches: Phase 1 on `claude/blissful-allen-frelxh` (PR to main), Phase 2 on `claude/story-v2-phase2` (stacked PR). Kostas merges.
Order: A1 #141 · #128+A5 #142 · #129+#139 · A2 #143 · A3 #144 · A4 #145 · A6 #146 · A7 #147 · #131+A8 #148 · A9 #149 · A10 #150 · A11 #151 → PR. Phase 2: #135 #137 #134 #130 #132 #136 #138 #140 #133.

| issue | status | commit | checks |
|---|---|---|---|
| setup | done | – | issues #141–#160 created, comments on #128–#140 and #38; cutscene-check runs here (headless Chromium OK) |
| A1 #141 | done | cd94583 | validate 0/0, build ok |
| #128+A5 #142 | done | 69c257d | validate 0/0, build ok, sim 100% wins (non-gamer chapter 13.6 min) |
| #129+#139 | done | 945c629 | validate 0/0, build ok, sim boss recoll 1.00 / others 0; battle lab: keepsake case passes; pre-existing failing 'tap 2nd enemy' case on b3 (Hollows immune to Strike) noted for A10 |
| A2 #143 | done | cc47fb3 | validate 0/0, build ok, sim unchanged; headless test of endBattle + setFlag + firstOf passed |
| A3 #144 | done | 6c32159 | validate 0/0, build ok, sim unchanged; headless duel test (1 hero vs dov_rival, refuse then rings) WIN, real + fake sheets |
| A4 #145 | done | 4a2f5bc | validate 0/0, build ok, sim b0_duel 100% ~4.6 rounds ~1 min; headless run: refuse → wake → nala, INTERRUPTED end, Recall 2 card, Retry replays events |
| A6 #146 | done | 3de5710 | validate 0/0, build ok, sim 100% (Recall 2 preview 7.6 rounds non-gamer); headless: break banner first, WIN |
| A7 #147 | done | bc7a344 | validate 0/0, build ok, sim 100% at Recall 2 (7.9 rounds non-gamer); headless: b2_start before first menu, b2_immune after IMMUNE, Nala prompt, WIN |
| #131+A8 #148 | done | ffc71a5 | validate 0/0, build ok; warden 2x (slots gate 262/330 + 196/346, hollow in front), hp 100 after tuning; sim b3_gate @Recall3 non-gamer 97.9% (A10 tunes to 100%); headless WIN real+fake, lifesteal seen, targeting ok |
| A9 #149 | done | e882a33 | boss text verified vs STORY, boss lab errors 0, bot boss run WIN (archive_insight, keepsake, recollection hint + cast); fix: keepsake fill ignored echoMult on Unforgettable |
| A10 #150 | done | 81ee6d8 | validate 0/0, build ok; sim 100% every battle, non-gamer chapter 16.5 min (avg 13.1, good 11.1); playtest real/fake/story/average all pass, 0 retries; mobile-check 36/36; tuned hollow hp 80→65, claw 12→8, warden maul 7→6 |
| A11 #151 | done | cf1ef2e | STATUS.md Story v2 section, CLAUDE.md examples updated |
| Phase 1 | PR | – | https://github.com/CostGal/unremembered/pull/161 (25 commits; validate/build/sim/playtest/mobile-check green). Phase 2 continues on claude/story-v2-phase2 |
| P2 #135 | done | 6bf5801 | validate 0/0, build ok, sim 100% (b3 non-gamer 99.9% as before), boss interrupt 77-86%, chapter 16.4 min; headless b1: BREAK x3, shards ok; battle lab 10/10 |
| P2 #137 | done | 69b3d0c | validate 0/0, build ok, sim chapter 16.6 min non-gamer; headless b1/b3/boss WIN, approach/return positions exact, ring timing unchanged, battle lab 10/10 |
| P2 #134 | done | e7d274e | validate 0/0, build ok, sim 16.4 min non-gamer, lowest win 99.9%; headless b1: hero + enemy CRIT! seen, PERFECT negates, WIN; battle lab 10/10 |
| P2 #130 | done | 7e516d2 | validate 0/0, build ok; sim boss 100% all profiles, interrupt 70-80%, chapter 16.4 min; boss lab errors 0, counter 'Archive in 3' |
| P2 #132 | done | c688edb | validate 0/0, build ok, sim boss 100%; ring lab: redact 1080 ms, stamp feint 945 ms, plain rings unchanged; boss lab errors 0. Note: clerk_redact impact frame lands ~345 ms after T (was ~250 before: pre-existing sheet length) |
| P2 #136 | done | b40d3c3 | validate 0/0, build ok; sim boss non-gamer 99.98%, chapter 16.8 min; boss lab errors 0; forced parry/dodge run: PARRIED + reparry ring, DODGE, Story never defends, WIN |
| P2 #138 | done | 88e14f1 | validate 0/0, build ok; displayScale 1 explicit, portraits dov 310 / clerk 380, dialogue QA 96 lines 0 issues; art list for Kostas in the report |
| P2 #140 | done | 39297fb | validate 0/0, build ok; headless b1/boss WIN, drift visible, shadows on floor; mobile-check 36/36; battle lab 10/10; art list in the report |
| P2 #133 | done | 4ed950a | flag off: timing unchanged, playtest real pass (319 s, 0 retries), mobile-check 36/36; flag on: 14/14 input checks (swipe=dodge, tap=parry, red ring tap=CAN'T PARRY). Pre-existing lab fail 'PERFECT gives +2 Echo' (Rhea cap 1 at level 1 in ?battle= runs) |
| Phase 2 | report | – | docs/BATCH_REPORT_4.md written; final gate on Phase 2 head: validate 0/0, build ok, sim 16.8 min non-gamer (b3 99.9%), playtest real + story pass, mobile-check 36/36 |
| Phase 2 | PR | – | https://github.com/CostGal/unremembered/pull/162 (stacked on #161). Batch complete 01:05 Sat. |
| #163 | done | (this commit) | swipe = dodge on every ring, no flag; validate 0/0, build ok, judge-unit pass, battle lab 33/33, playtest real 342 s 0 retries, mobile-check 36/36, sim 100% / 16.9 min non-gamer; duel hints strike→techniques→echo→dodge |
