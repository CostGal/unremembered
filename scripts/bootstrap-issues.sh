#!/usr/bin/env bash
# One-time setup: labels, milestones, issues and a Project board for Unremembered.
# Needs: gh CLI logged in (gh auth login) and project scope (gh auth refresh -s project).
# Safe to re-run: existing labels are updated, existing issues/project are skipped.
set -euo pipefail

# ---------- Labels ----------
label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null; }
label ui        1d76db "Screens, HUD, menus"
label art       e99695 "Sprites, backgrounds, cutscene art"
label audio     5319e7 "SFX and audio system"
label music     b60205 "Music tracks"
label mechanics 0e8a16 "Combat and gameplay"
label story     fbca04 "Narrative, dialogue, cutscene text"
label tech      555555 "Setup, build, deploy, mobile"
label idea      c5def5 "Parking lot, not for this jam"
label manual    d4c5f9 "Done by Kostas by hand. Claude Code skips these."
label P0        b60205 "Must ship"
label P1        fbca04 "Should ship"
label P2        0e8a16 "Only if time"
echo "Labels ready."

# ---------- Milestones ----------
ms() {
  if gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --jq '.[].title' | grep -Fxq "$1"; then return; fi
  if [ -n "$2" ]; then
    gh api "repos/{owner}/{repo}/milestones" -f title="$1" -f due_on="$2" -f description="$3" >/dev/null
  else
    gh api "repos/{owner}/{repo}/milestones" -f title="$1" -f description="$3" >/dev/null
  fi
}
ms "Teaser"    "2026-09-30T12:00:00Z" "Screenshot-ready battle scene, Wed 30/9"
ms "Demo"      "2026-10-03T12:00:00Z" "Full demo, deploy by Sat 3/10 14:00"
ms "Post-jam"  ""                     "Ideas and cut features"
echo "Milestones ready."

# ---------- Issues ----------
EXISTING="$(gh issue list --state all --limit 300 --json title --jq '.[].title')"
issue() { # title, milestone, labels, body
  if printf '%s\n' "$EXISTING" | grep -Fxq "$1"; then echo "skip: $1"; return; fi
  gh issue create --title "$1" --milestone "$2" --label "$3" --body "$4" >/dev/null
  echo "created: $1"
}

# Teaser (Tue–Wed)
issue "Project setup: Vite + Phaser, 360x640 portrait, Pages deploy" "Teaser" "tech,P0" \
"See CLAUDE.md > Stack, Display. Done when the Pages URL shows a Phaser canvas on the phone and pushes auto-deploy."
issue "Scene skeleton: Boot, Preload (placeholders), Title, Battle stubs" "Teaser" "tech,P0" \
"Preload reads data/assets.json; missing files become labeled placeholder rects."
issue "Battle core: turn order, command menu, Strike, HP, damage numbers" "Teaser" "mechanics,P0" \
"Rhea then Dov, then enemies. Win/lose can be stubbed. Stats from JSON."
issue "Parry QTE: shrinking ring, PERFECT/GOOD/MISS, hitstop, shake" "Teaser" "mechanics,P0" \
"Exact windows and feedback in CLAUDE.md > Parry QTE."
issue "Battle HUD: names, HP bars, Echo bar (10 pips), 2x2 command buttons" "Teaser" "ui,P0" \
"Layout in CLAUDE.md > Battle > Layout. Buttons >= 56px tall."
issue "Rain + night lighting FX on battle scene" "Teaser" "ui,P1" \
"<= 150 particles. Must stay smooth on low-end Android."
issue "Art: Rhea attack animation" "Teaser" "art,manual,P0" "pixler.dev, attack preset. Sheet to public/assets/sprites/."
issue "Art: Dov sprite + attack animation" "Teaser" "art,manual,P0" "Prompt in docs/STORY.md. rhea.png as reference."
issue "Art: Blank sprite + attack animation" "Teaser" "art,manual,P0" "Prompt in docs/STORY.md."
issue "Art: rainy street background (battle + cutscene)" "Teaser" "art,manual,P0" "Used by b1, b2 and cutscene shots 16, 25, 26."
issue "Post teaser screenshot" "Teaser" "manual,P0" "Fallback: compose in Photoshop from real sprites if the build isn't pretty yet."

# Demo (Thu–Sat)
issue "Echo economy + Relay (Rhea) + Anchor (Dov) from techniques.json" "Demo" "mechanics,P0" "Relay 2nd hit uses an offensive ring. Anchor can revive."
issue "Enemy AI from enemies.json: weighted attacks, windup frame, multi-hit, feint" "Demo" "mechanics,P0" "Blank and Hollow first; the feint is needed for the boss."
issue "Win / lose + instant retry from battle-start snapshot" "Demo" "mechanics,P0" "No game over screen."
issue "Tutorial: slow-mo first parry + prompt in b1" "Demo" "mechanics,P0" "Time scale 0.35 until the first GOOD/PERFECT."
issue "Nala: glow on Hollow telegraph, tap to cancel, once per battle" "Demo" "mechanics,P1" "Never reacts to Blanks."
issue "Boss: The Clerk, 2 phases (Stamp, File Away, Redact, Archive)" "Demo" "mechanics,P0" "Archive: 2-turn charge, interrupted by >= 40 damage."
issue "Recollection ultimate: golden tint + 3 rhythm rings" "Demo" "mechanics,P0" "Needs Echo 10. Rhea only."
issue "Keepsake event at boss phase 2" "Demo" "story,mechanics,P1" "Pause, dialogue keepsake_burn, Echo = 10, pulse Recollection."
issue "ChapterRunner: chapter1.json step sequence" "Demo" "tech,P0" "cutscene → dialogue → battle → ... → end."
issue "Dialogue scene: text box, typewriter, speaker name, letter style" "Demo" "ui,P0" "Tap completes the line, then advances."
issue "Write dialogue: letter, meet_dov, after_b1, records_office, keepsake_burn, ending" "Demo" "story,manual,P0" "Lock by Thu 1/10 evening. Beats in docs/STORY.md."
issue "Cutscene system: shots, pan/zoom/tint/split/layers/fx, hold-to-skip" "Demo" "ui,P0" "Must work with zero art. Script in docs/STORY.md."
issue "Convert cutscene script to cutscene_origin.json" "Demo" "story,P0" "30 shots from docs/STORY.md."
issue "Art: Hollow sprite + attack animation" "Demo" "art,manual,P0" "Prompt in docs/STORY.md."
issue "Art: The Clerk sprite + attack animation" "Demo" "art,manual,P0" "Prompt in docs/STORY.md."
issue "Art: Nala sprite" "Demo" "art,manual,P1" "Static; the glow is done in code."
issue "Art: Records Office background" "Demo" "art,manual,P0" "Boss arena."
issue "Art: cutscene backgrounds + Aurelian cutouts" "Demo" "art,manual,P1" "city, reliquary, battlefield, council, statue, exile_close + 2 cutouts. Fallback: text + fx only."
issue "Title screen + logo (Tap to start unlocks audio)" "Demo" "ui,P0" "Includes the iOS silent-mode hint."
issue "Main menu: New Game, Chapter 2 locked, Arena locked, Settings, Credits" "Demo" "ui,P0" "Locked items show Coming soon."
issue "Settings: music volume, SFX volume, Story Mode" "Demo" "ui,P1" "Persist to localStorage."
issue "End of Demo + credits screen" "Demo" "ui,P0" "Then back to menu."
issue "Procedural SFX: hit, perfect, good, miss, menu, echo, ultimate" "Demo" "audio,P1" "Web Audio, no files."
issue "Music: pick 5 tracks (title, cutscene, battle, boss, ending)" "Demo" "music,manual,P1" "Phase 5 on Thu with Claude chat."
issue "Music playback: loop, crossfade, pause on hidden tab" "Demo" "audio,P1" "Missing file = silence, no error."
issue "Mobile hardening: IG in-app browser, no zoom/select/callout, landscape overlay" "Demo" "tech,P0" "See CLAUDE.md > Display & input."
issue "Mobile test pass + final deploy (tag v0.1-jam)" "Demo" "tech,manual,P0" "Checklist in CLAUDE.md. Deploy by Sat 14:00."
issue "Battle 3: two Hollows" "Demo" "mechanics,P2" "Only if on schedule Friday night."
issue "Hollow Siphon attack (-2 Echo on miss)" "Demo" "mechanics,P2" "Only if on schedule."

# Post-jam ideas
issue "Vael, the Strongest" "Post-jam" "idea,story" "Joins later, different from the first draft."
issue "Aurelian's daughter twist" "Post-jam" "idea,story" "Who is she?"
issue "Good Forgotten + intelligent Hollows as allies" "Post-jam" "idea,story" ""
issue "Oaths: risk-for-power vows" "Post-jam" "idea,mechanics" "Reckless Oath (Rhea), Oath of the Wall (Dov)."
issue "More techniques: Brace, Return to Sender" "Post-jam" "idea,mechanics" ""
issue "Chapter 2: The Gallery" "Post-jam" "idea,story" ""
echo "Issues ready."

# ---------- Project board ----------
OWNER="$(gh repo view --json owner --jq .owner.login)"
REPO="$(gh repo view --json name --jq .name)"
PNUM="$(gh project list --owner "$OWNER" --format json --jq '.projects[] | select(.title=="Unremembered") | .number' 2>/dev/null || true)"
if [ -z "$PNUM" ]; then
  PNUM="$(gh project create --owner "$OWNER" --title "Unremembered" --format json --jq .number 2>/dev/null || true)"
fi
if [ -z "$PNUM" ]; then
  echo "Project board skipped. Run: gh auth refresh -s project   then re-run this script."
  exit 0
fi
gh project link "$PNUM" --owner "$OWNER" --repo "$OWNER/$REPO" >/dev/null 2>&1 || true
for url in $(gh issue list --state open --limit 300 --json url --jq '.[].url'); do
  gh project item-add "$PNUM" --owner "$OWNER" --url "$url" >/dev/null 2>&1 || true
done
echo "Project board #$PNUM ready. In the browser, switch its view to Board and group by Status."
