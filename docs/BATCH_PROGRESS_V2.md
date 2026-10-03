# v2 line — progress (Sat 3/10 evening, branch `v2-dev`)

Built on the frozen jam version (main `ac4590f`, zip v4). Kostas's order: 1 Feel B · 2 Nala glow · 3 poise +25 % + lore text + Warden retune · 4 Brace A · 5 Blast L5 aim minigame · 6 memory scene pickups · 7 Warden slam · 8 Forgotten crush · 9 audio housekeeping (duplicate track alias, music credits). One Sonnet lane per item in a worktree off `origin/v2-dev`, cherry-picked onto `v2-dev` after validate · build · dialogue QA (+ the item's lab); `v2-dev` reaches main only when Kostas says so.

| item | status | commit | checks |
|---|---|---|---|
| 2 Nala glow (b3) | done | 724978e | validate 0/0, build ok, dialogue QA 128/0, b3 lab 18/18, playtest --story real 0 retries; event `b3_nala_glow` at the start of round 2 when nothing landed on a Hollow (new `roundStart` hook), Echo Strike status for a round, 3-round cooldown with "Glow in N" + tap to re-trigger, save once per round (Nala's Bell = +1 per round); sim b3 non-gamer 3.9 → 2.6 min, chapter 19.2 min; fixed a crash in the `nala` spotlight target |
