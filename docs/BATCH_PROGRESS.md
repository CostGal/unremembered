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
