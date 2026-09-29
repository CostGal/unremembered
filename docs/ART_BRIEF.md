# ART BRIEF — Unremembered (animation pipeline)

What the game needs from the animation project. The method (rig, rules, what broke and why) is in `ANIMATION.md` (learnings). This file is the **what** and the **output contract**. Updated Tue 29 Sep 2026 (after the Rhea set was delivered; reaction rules revised).

## Output contract (the game loads exactly this)
- Frames: **128×128** (Clerk **256×256**, Nala **64×64**). One horizontal PNG sheet per animation. Transparent background. Alpha only 0 or 255.
- Colors: the source palette + that character's FX colors only.
- Facing: **left** (the game flips heroes; enemies use `faces` from assets.json).
- File names: `<character>_<anim>.png` (e.g. `rhea_attack.png`), plus one `<character>_animations.json`:
```json
{
  "frame_size": [128, 128],
  "facing": "left",
  "animations": {
    "attack": {"frames": 8, "sheet": "rhea_attack.png", "durations_ms": [90,70,60,50,45,55,70,90],
               "loop": false, "windupFrame": 2, "impactFrames": [4]}
  }
}
```
- **`windupFrame`:** the pose held during the enemy QTE telegraph. Required on every enemy attack. Optional for heroes.
- **`impactFrames`:** the frames where damage lands (the game spawns hit FX and damage numbers there). Multi-hit moves list each hit.
- **`holdFrame`** (optional): the game pauses the animation on this frame while something happens in code (Blast bolts firing, counter stance waiting for the enemy, Clerk's Redact feint), then resumes to the end.
- **`holdLastFrame`** (bool): after the animation ends the game keeps showing its last frame (death, victory).
- **Looping animations with `_in` / `_out`** (e.g. `cast`): separate 4-frame sheets `<anim>_in` and `<anim>_out`. The game plays `_in` → loops `<anim>` → plays `_out`. The last frame of `_in` and the first frame of `_out` are pixel-identical to frame 0 of the loop.
- **Projectiles:** FX-only sheet (e.g. `rhea_blast_projectile.png`), referenced in the JSON by `projectile`, with `spawn_px` = where it starts (see `rhea_animations.json`). Never drawn into the character frames.
- **`<character>_rest.png`:** the rest pose (original art + fixed weapon + inactive emblem), delivered with every character.
- **First and last frame of every non-looping animation = the rest pose**, so it cuts cleanly from and to idle.
- **Extra animations beyond this brief are fine** (Rhea shipped hurt, dodge, parry, cast_in, cast_out, blast_projectile). The loader loads everything in the JSON; unused ones are ignored. Projectile/FX-only sheets (e.g. `rhea_blast_projectile.png`) are separate sheets, not part of the character frames.
- Deliver: sheets + JSON + a GIF preview per animation + one zip. Keep the generator scripts (`*.py`): the set must be regenerable.

## Move budget per character (locked 29/9)
| Character | Moves | Notes |
|---|---|---|
| Rhea | 4 | Strike, Blast, Return to Sender, Recollection |
| The Clerk | 4 | Stamp, File Away, Redact, Archive (charge + release) |
| Dov | 3 | Strike (1 attack) + Anchor, Brace (2 abilities) |
| Blank | 2 | Punch, Lunge |
| Hollow | 2 | Claw, Siphon (P2) |
| Nala | 2 | Alert, Hiss |

**Reaction animations (revised 29/9):**
- `parry` and `dodge`: **Rhea, Dov and the Clerk only**. Rhea and Dov use them from player input. The Clerk uses dodge on a random basis (rule decided later; may get extras). Blank, Hollow and Nala get neither.
- `hurt` and `death`: **every combatant** (Rhea, Dov, Blank, Hollow, Clerk). Nala gets neither. If an enemy `hurt` sheet is missing, the game falls back to the code flash + knockback.
- `victory`: Rhea and Dov.
- Animation to play: successful parry → `parry`, successful dodge → `dodge`, damage taken → `hurt`. The input scheme (double-tap parry, swipe dodge) is pending, see STATUS.

## Head / face patch
pixler keyframes can carry face errors (e.g. black eyes). Kostas fixes **one head** in Photopea (the `*_fixed.png` base). The pipeline locates the head in every frame and pastes the fixed head, keeping integer offsets. Never fix frames by hand.

## Characters

### Rhea (hero), base `rhea.png` — FX `#3fd0c9` teal, `#f1efe8` — **DELIVERED 29/9**
Weapon: black telescopic baton with silver tip, front hand.

Delivered: idle, attack (Strike), blast (+ `blast_projectile` sheet), ability (Return to Sender), cast (+ cast_in, cast_out), death, victory, hurt, dodge, parry. Next step is wiring and the phone test.

| anim | notes |
|---|---|
| idle | loop |
| attack | Strike. 12 frames, windupFrame 3, impactFrames [6] (as shipped in rhea_animations.json) |
| blast | holdFrame = aim pose. Bolts are code FX (or the projectile sheet) |
| ability | "Return to Sender". holdFrame = guard pose, held through the enemy turn. After a parry, the rest plays as the counter swing |
| cast | Recollection / Echo aura. Loop. Aura is an FX layer, never a recolor |
| death | downed pose, last frame held |
| victory | baton raised |
| hurt / dodge / parry | reaction anims |

### Dov (hero), base `dov.png` — FX `#e0a040` amber, `#f1efe8`
Weapon: bandaged fists. Same animation set as Rhea, but 1 attack + 2 abilities: Strike, Anchor, Brace.

| anim | source | notes |
|---|---|---|
| idle | derived | heavier, slower breathing than Rhea |
| attack | pixler keyframes (have it) | Strike. Heavy punch, deep lunge. 1 impact |
| cast | pixler keyframes (`dov_raise_fists_amber_glow_8f.png`) | Anchor. The pixler output recolored the whole sprite amber: **restore the original colors, make the amber a glow/aura FX**. Add frames back to rest at the end |
| brace | derived or pixler | guard stance for Brace. May reuse `cast` with a different FX if time is short |
| hurt, dodge, parry | pixler / derived | reaction anims (same set as Rhea) |
| death | derived | downed pose |
| victory | derived | |

### Blank (enemy) — FX: none (grey, dull)
Hunched, grey raincoat, smooth featureless face. Faces right in the source.

| anim | notes |
|---|---|
| idle | slow sway |
| punch | slow, windupFrame clear, 1 impact |
| lunge | faster, shorter windup (600ms telegraph), 1 impact |
| death | dissolves / collapses |

### Hollow (enemy) — FX `#3fd0c9` dull teal cracks
Memory-dust creature with crystal shards. Faces left in the source.

| anim | notes |
|---|---|
| idle | float / drift |
| claw | windupFrame, 1 impact |
| siphon | pulls teal particles from the target, 1 impact (P2) |
| death | bursts into dust |

### The Clerk (boss, 256×256) — FX `#3fd0c9`, `#f1efe8`
Very tall, gaunt archivist, long black coat, huge ledger, brass stamp. 4 moves.

| anim | notes |
|---|---|
| idle | loop |
| stamp | windupFrame, 1 impact |
| file_away | 2 impacts |
| redact | feint: windupFrame, a **hold frame at ~60%**, then the impact |
| archive_charge | loop, glowing ledger |
| archive_release | 1 big impact |
| hurt | short |
| parry, dodge | reaction anims (dodge = random, extras TBD; first to cut if behind) |
| death | |

### Nala (ally cat, 64×64 canvas) — FX `#e8883a` orange, `#3fd0c9`
Calico: white with orange and black patches.

| anim | notes |
|---|---|
| idle | tail flick, blink. Loop |
| alert | ears up, glow. Loop |
| hiss | 1 impact (the "cancel attack" moment) |

## Priority order
Art goes one character at a time until it plays fully in the game and is phone-tested.
1. Rhea (done) → wiring + phone test
2. Dov: idle (teaser), attack, cast, brace, hurt, death, victory, then parry/dodge
3. Blank: idle, punch, lunge, hurt, death
4. Hollow: idle, claw, hurt, death, then siphon
5. Clerk: idle, stamp, file_away, redact, archive, hurt, death, then parry/dodge
6. Nala
Within any character, reaction anims (parry/dodge) are the first to cut.
