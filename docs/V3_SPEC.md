# Unremembered — Spec v3 (Sat 3/10): final jam changes

**Kostas:** delete any item you don't want *before* uploading this file to `docs/V3_SPEC.md`. Whatever is left is the batch.

## Rules for this batch
- **Hard stop:** no new issue starts after **14:15 Europe/Athens**. Everything is merged by **14:45**. Kostas phone-tests 14:45–15:30, then tags `v0.1-jam` and submits before 16:00.
- **Order:** the order of this file. Merge each issue to main as soon as it is green. After every merge, the live build must be shippable.
- **[PROPOSE]:** in the plan, give 2 options with a time estimate each. Kostas picks one.
- **Art and SFX are drop-in.** Every new key gets a placeholder that looks intentional (tinted background + silhouette or text, or silence). Kostas uploads files during the batch. Never block on them; pull main before each merge.
- Anything this file doesn't mention keeps its current behaviour. When this file conflicts with older docs, this file wins. At the end, update `docs/STORY.md` to match.

---

## TIER 1 — ship today, in this order

### 1. UI quick wins
- **Title:** on tap, the logo pops slightly bigger (scale punch ~1.08, ease back), then goes to Menu.
- **Fullscreen:** do the most each platform allows.
  - Size from 100dvh / visualViewport; no scroll or bounce.
  - On the first tap, request the Fullscreen API where it is supported (Android Chrome).
  - Web manifest with `display: "fullscreen"` and a theme color, for Add to Home Screen.
  - iPhone Safari and the Instagram in-app browser can't go truly fullscreen. There, the layout must fill the visible viewport cleanly, with no white bars.
- **Audio unlock:** sometimes sound only starts after a Menu tap. Resume the AudioContext on every pointerdown/touchend until it is `running` (also after `interrupted`). Start the scene's music as soon as it runs.
- **New Game → difficulty select:** add a Back button.
- **Credits:**
  - The Credits menu item stays visible but is not clickable, with a "POST GAME JAM" badge (code-drawn; `ui_badge_postjam` if Kostas makes one).
  - The End screen shows "Will be revealed post game jam" instead of the credits list.
  - **Exception (license):** a small line with the music credits stays on the End screen and in the README (CC BY / BY-SA require attribution).

### 2. Art slots (so Kostas's art lands today)
- **Cutscene:**
  - Support every image key in *Art slots* below, with placeholders.
  - Update `cutscene_origin.json`: replace or insert shots exactly as listed there.
  - Keep the current text unless *New dialogue* says otherwise.
- **Battle backgrounds:** split each battle background into two layers.
  - `bg`: desaturated ~60%, slight blur, slow parallax drift (±6 px), rain over it.
  - `platform`: a saturated strip the fighters stand on, bottom ~25% of the screen.
  - Reference: Sonic-style battles, with a vivid floor and a muted backdrop.
  - Placeholders: the current street, desaturated, plus a code-drawn cobblestone strip.
- **Per-battle backgrounds:**

  | Battle | Background | Platform |
  |---|---|---|
  | b0 | `bg_street_far` | `platform_street` |
  | b1 | the same street shifted slightly ("they moved a bit") | `platform_street` |
  | b2 | `bg_street_mid` | `platform_street` |
  | b3 | `bg_office_gate` | `platform_street` |
  | boss | `records_office` | `platform_office` |
- Backgrounds cover the full 360×640 with no letterboxing.

### 3. Tutorial v3 (b0_duel) + Echo rules
- **Echo:** only Strikes and parries generate Echo. Techniques never do.
- **Rhea's start:** 0/2 Echo. Blast v1 costs **2** and fires **2** bolts.
- **Turn 1:** only Strike is allowed. The Technique button is visible and clickable, but its Blast slot is blank and can't be chosen until it is unlocked.
- **Tutorial pauses:** the game freezes, everything darkens except the element being explained (spotlight), a short text box appears, and a tap continues.
  - (a) Battle start: HP, Echo, Strike, Technique.
  - (b) Dov's first attack: parry.
  - (c) Dov's second attack: **dodge**. What it is, how it differs from parry, and a swipe indicator. Swipe dodge is ON for everyone; keep tap-feedback latency as low as possible and flag it for the phone check.
  - (d) After the duel: leveling (see 7).
- **Flow:**
  - Keep `duel_refuse` / `duel_wake`.
  - Dov's first real attack is very slow (telegraph ×2.5). The rest are normal.
  - After Rhea's first successful parry: dialogue `duel_parry`.
  - After ≥1 successful parry **and** ≥1 landed strike: dialogue `duel_blast_unlock`, then Blast becomes selectable (banner "Blast unlocked").
  - The duel ends at Dov ≤50% HP. Nala **visibly jumps in** between them (Nala bundle, item 9), then `duel_nala` plays with Nala's portrait on the narration line.

### 4. Feel: crits and parries [PROPOSE]
- Make crits and PERFECT parries feel great: hit-stop, camera punch/zoom, flash, particles, big stylized text, layered SFX, a short slow-mo, haptics.
- Must stay smooth on mid-range phones.

### 5. Quill v3 + Recollection
- **Turn order:** Quill takes the first turn.
- **Two stages:**
  - **Stage 1, "Normal":** HP = half of stage 2's max.
  - **At 0 HP:** death animation → dialogue `quill_rise` → the death animation played **in reverse** (he gets up) → HP refilled to the full max.
  - **Stage 2, "Enraged":** red tint/aura, faster telegraphs, music intensity 1.
- **Laugh:** `sfx_laugh` every 2–3 of his turns, and at the stage change.
- **Moveset:** Kostas sends the final list in the plan reply. Until then, stage 1 = current phase 1 and stage 2 = current phase 2.
- **Recollection exists only in stage 2.**
  - When stage-2 HP reaches threshold X (default 35%), `keepsake_burn` plays and Recollection unlocks.
  - **Recollection always kills him.**
- **Balance:**
  - On Normal and Unforgettable he is effectively impossible to beat without Recollection: stage-2 HP is high enough that the threshold is the only way down, and his damage outpaces a no-Recollection attempt.
  - Story mode stays gentle.
  - Report the sim numbers.
- **Recollection presentation:** much more intense and FX-heavy, plus a **cut-in**.
  - The background darkens and blurs, and a horizontal band crosses the screen.
  - Rhea's portrait appears from the neck up inside the band, with the dialogue inside the band.
  - Two beats: powerful (`rhea_cutin_power`), then tears (`rhea_cutin_tears`). Lines: `recollection_cutin`.
- **Recollection minigame [PROPOSE]:**
  - Default: it always kills, and the minigame only decides the grade and the spectacle.
  - Option B: a damage minigame with a guaranteed minimum that still kills.
- **Recollection music:** in the later music patch. Keep the current warm variant for now.

### 6. Battle clarity and rules
- **Target select UI:** when choosing a target, show target buttons in the lower half (Pokémon-style: name, HP bar, status) plus a clear highlight on the sprite. The same UI chooses the hero for Dov's Anchor.
- **Breaking is harder:** poise +25%, tuned with the sim.
- **Forgotten heavy move:** a new move (anim `blank_crush`) with high damage.
  - Only a PERFECT dodge avoids it fully. A GOOD dodge takes partial damage, and parry is not possible.
  - First used in b1, with a perfect-dodge tutorial pause the first time.
- **Hollow lore fix:** nothing touches a Hollow unless it carries Echo.
  - Strikes don't; Blast and parries do (a PERFECT parry's counter damages a Hollow).
  - Update `b2_immune` (see *New dialogue*).
- **b2:** Forgotten + first Hollow, on a new background. The Hollow cutscene plays on Rhea's first strike against it; the Nala tutorial plays on the first Hollow attack.
- **b3 (gate):**
  - The Warden Hollow gets an **unparryable** attack (dodge only).
  - After round 1, if both heroes attacked and nothing landed on a Hollow, event `b3_nala_glow` fires. Nala meows and glows, and the glow passes to Rhea and Dov: **for the next round their strikes carry Echo** and damage Hollows.
  - Then the Glow goes on a **3-round cooldown**; tap Nala to re-trigger it when it is ready.
  - Nala's save is separate and stays **once per battle**.
  - A tutorial pause explains both.

### 7. Progression
- **Duel XP:** the duel gives XP, but **not a full level**.
- **Leveling tutorial:** after the duel, a pause explains leveling: Recall level, what grows, and what you learn.
- **Dov's kit:**
  - Starts with **Anchor Lv1** (choose which hero to heal).
  - Learns **Tremor** (cost 5) later.
  - Then **Brace**, reworked so it has real impact [PROPOSE].
- **Plan table:** per hero, per Recall level: XP needed, Echo max, HP, ATK, techniques learned or upgraded, and where in the chapter that level is reached. Kostas tunes it before execution.

### 8. Story flow, scenes, FX
- **Opening, beat 1 (FPV wake):**
  - Black, then eyelids open with blur and two blinks, over `bg_abandoned_home_fpv`.
  - Lines: "Ow... my head." and the new narration (see *New dialogue*).
  - SFX: `sfx_heartbeat`, `sfx_door_creak`.
- **Opening, beat 2:** `bg_letter_fpv` (looking down at her hands holding the letter) for the letter lines (`sfx_paper`). Then she steps out of the open door into the street (`meet_dov`).
- **Rest scene (after b1):**
  - Replace the single `after_b1` scene with a 3-panel rest cutscene (`rest_panel_1..3`, a quiet place).
  - The after_b1 dialogue is spread across the panels (see *New dialogue*).
  - Nala: walking towards them (panel 1), climbing on Rhea (panel 2), on her lap (panel 3).
  - Then a reward step, "A memory has returned" (item 10). Then they set off for the Records Office.
- **Aurelian scenes:** insert or replace shots per *Art slots*.
- **Red Reliquary:** from shot 20 on, the Reliquary and the tower on Veyra's skyline are red. Use a code tint/overlay until the red art lands. SFX `sfx_red_surge`.
- **The Hush [PROPOSE]:** the most intense moment of the cutscene: shake, lights dying one by one, a red surge from the tower, screams (`sfx_scream_crowd`), then silence and a longer hold.
- **Story SFX pass:**
  - New optional `sfx` field on cutscene shots and dialogue lines, using the SFX slots.
  - Shot 6 gets `sfx_crowd_cheer`.
- **Nala:** her lines use Nala portraits hissing or meowing, with matching SFX.
- **Dov:** the `dov_pet_nala` portrait on the first line of `after_duel`. Add his voice blip in `voices.json`.

### 9. Nala animation bundle
- Kostas uploads `art_inbox/nala/` with `nala_animations.json`, `nala_animations.zip` and `nala_rest.png`.
- Integrate it per `docs/ART_BRIEF.md` and `docs/ANIMATION.md`.
- Use it for battle idle/alert/hiss and for the jump-in (if the bundle has no jump, use a tweened arc).

### 10. Memory returns (minimal today)
- **New reward** after the rest scene: 2–3 options tied to the Rhea–Dov bond or to Nala.
- **Full rework [PROPOSE]:** in the plan, list every current memory return/fragment and where it is obtained, and propose a new table in the Pictos style (found in scenes, earned in the story, dropped by defeated enemies).

---

## TIER 2 — only if Tier 1 is merged before the hard stop
- **Dialogue editor:** a dev page (`?editor`).
  - Shows every dialogue and cutscene line over its real scene (background, portrait, style).
  - Inline text editing.
  - A download button for the edited `dialogue.json` / `cutscene_origin.json`.
  - Desktop-friendly.
- **Memory returns:** the full rework from item 10.

## Not in this batch
- The music patch (Recollection music, extra cues).
- Kostas's list item "The conversation" was cut off: ignore it.
- At the end, open Post-jam issues for every Tier 1/2 item not done.

---

## New dialogue
Notation as in STORY.md: `Speaker [portrait]: text`, `>` = narration, `{sfx}` = optional SFX cue.

### wake (`bg_abandoned_home_fpv`), replaces the first half of `letter`
- Rhea [none]: Ow... my head. {sfx_heartbeat}
- > A ceiling she doesn't know. A door hanging open. Rain. {sfx_door_creak}

### letter (`bg_letter_fpv`): the rest of v2 `letter`, starting at "A letter in her hand." {sfx_paper}

### duel_parry (after Rhea's first successful parry)
- Dov [dov_warm]: What else could I expect? First parry, and it's perfect.
- Rhea [rhea_determined]: Hey. Turns out I'm pretty good at this.

### duel_blast_unlock (≥1 parry and ≥1 landed strike)
- > Something flickers behind her eyes. Not a memory. The edge of one.
- Rhea [rhea_confused]: Oh. Okay.
- Rhea [rhea_determined]: Now I can do this.

### duel_nala (replaces the v2 version)
- > Nala leaps out of the rain and lands between them, fur on end. [nala_hiss] {sfx_hiss}
- Rhea [rhea_confused]: ...Nala?

### after_duel (changes only)
- First line, Dov [dov_pet_nala]: Nala! Easy, girl. Easy.
- After it, new: > Nala meows at Rhea, once, like a question. [nala_meow] {sfx_meow}
- "Nala's fur stands on end. She hisses at the dark." → [nala_hiss] {sfx_hiss}

### rest scene (replaces `after_b1`; v2 lines, split across the panels)
- **Panel 1:** v2 lines from "Talk. Who am I?" to "Dad died fighting his men. Mom became Forgotten."
- **Panel 2:** v2 lines from "Like the ones we just fought?" to "People started forgetting him. So he hit you with everything he had."
- **Panel 3:**
  - Rhea [rhea_pained]: And instead of the world forgetting me... I forgot the world.
  - Dov [dov_sad]: I already lost Mom and Dad. I'm not losing you twice.
  - > Rhea doesn't remember how to hold her brother. She does it anyway.
  - Dov [dov_neutral]: Memorists write down everything they take. It's all in his Ledger.
  - Rhea [rhea_determined]: Then we pay the magistrate a visit.

### b2_immune (replaces the v2 version)
- Rhea [rhea_confused]: It went right through!
- Dov [dov_fierce]: Nothing touches a Hollow unless it carries Echo. Steel alone won't.
- Dov [dov_neutral]: Your Blast carries it. So does a clean parry. That spark you feel? That's Echo.
- Rhea [rhea_determined]: Then I make every parry count.

### b3_nala_glow
- > Nala's fur lights up. She lets out a long, low meow. [nala_meow] {sfx_meow}
- > The glow runs up Rhea's arm, then Dov's.
- Dov [dov_fierce]: She's lending us her Echo. Hit them, now!

### quill_rise (between Quill's stages)
- > Quill crumples. Then the Ledger flips open on its own. {sfx_laugh}
- Quill [clerk_furious]: You don't close a Ledger. It closes you.
- > He rises. His wounds are ink, and the ink is flowing back.

### recollection_cutin (inside the cut-in band)
- Rhea [rhea_cutin_power]: Look at it, Quill. Look at what you took.
- Rhea [rhea_cutin_tears]: Goodbye, Dov. Goodbye, Nala. Goodbye, Dad.

Tutorial banner and pause texts: write them short (≤ 2 lines on a phone).

---

## Art slots
★ = Kostas's priority. The plan gives the exact repo path and pixel size for each key.

### Cutscene (shot numbers = v2 script)
| Key | Shot | What |
|---|---|---|
| `cs_aurelian_build` ★ | 5 (replaces the split) | Young Aurelian building the Reliquary, smiling |
| `cs_aurelian_cheered` ★ | 6 | Young Aurelian cheered by the court and crowd as the lanterns light up |
| `cs_aurelian_war` | 7 | Older Aurelian in armor, leading on the battlefield |
| `cs_aurelian_engine_war` | 8 (replaces the cutout) | Aurelian at the war-engine, kneeling among the fallen |
| `cs_council_trial` ★ | 10 | Council chamber, Aurelian standing in the middle |
| `cs_statue` ★ | 13–14 | Statue in Aurelian's likeness (14 = zoom) |
| `cs_exile_ruins` | 15 (replaces the cutout) | The exile in the ruins |
| `cs_castle_daughter` ★ | 16 (replaces it) | Aurelian in shadow in the castle, watching his daughter (silhouette) |
| `cs_reliquary_red` ★ | 20–21 | His hands on the Reliquary as it turns red |
| `cs_hush_1` ★, `cs_hush_2` | 22 | The Hush: lights dying, a red wave from the tower, screaming silhouettes |
| `cs_city_red_tower` | 23–24 | Veyra with the tower glowing red |
| `cs_forgotten` | 25 | Forgotten in the street; people walk past without seeing them |
| `cs_hollows` | 26 | Hollows rising from memory dust |
| `cs_echo_learning` | new, before 29 | Ordinary people learning Echo (teal glow in their hands) |
| `cs_echo_called` | 29 | Close-up: a hand burning a memory into teal fire |

### Opening
- `bg_abandoned_home_fpv` ★: first-person view from the floor of an abandoned home, door open, rain light.
- `bg_letter_fpv` ★: first-person view looking down at her hands holding the letter.

### Rest scene
- `rest_panel_1`: Rhea and Dov sitting; Nala walking towards them.
- `rest_panel_2`: different angle; Dov trying to be strong, Rhea sad; Nala climbing on Rhea.
- `rest_panel_3`: Dov close, the embrace; Nala on Rhea's lap.

### Battles
| Key | What |
|---|---|
| `bg_street_far` ★ | b0/b1 street, Records Office tower far away |
| `bg_street_mid` | b2, closer to the Office |
| `bg_office_gate` | b3, right outside the Records Office |
| `platform_street` ★ | saturated cobblestone strip, transparent top |
| `platform_office` | boss floor |

### Portraits
- `nala_hiss`, `nala_meow` (list the 4 existing Nala portraits first; reuse any that fit).
- `dov_pet_nala`.
- `rhea_cutin_power` ★ and `rhea_cutin_tears` ★: wide neck-up crops for the cut-in band.

### Sprites (pixler)
- `blank_crush`: the Forgotten's heavy attack.
- `hollow_warden` + its unparryable attack.
- Nala jump, only if the bundle has none.

### UI
- `ui_badge_postjam` (optional; code-drawn fallback).

## SFX slots
File-based SFX with the same override rule as music: if the file exists it plays, otherwise a procedural fallback or silence.

| Key | Use |
|---|---|
| `sfx_laugh` | Quill |
| `sfx_scream_crowd` | the Hush |
| `sfx_crowd_cheer` | shot 6 |
| `sfx_meow` | Nala |
| `sfx_hiss` | Nala |
| `sfx_heartbeat` | FPV wake |
| `sfx_door_creak` | FPV wake |
| `sfx_paper` | the letter |
| `sfx_red_surge` | the Reliquary turning red |
