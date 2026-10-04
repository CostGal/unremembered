# Changelog

Newest first. Versioning rules: `CLAUDE.md` > Versioning.

## 0.5.1 — 2026-10-04
- The game-jam zip is built automatically on every update to main and always waits at one link: https://github.com/CostGal/unremembered/releases/download/jam-latest/unremembered-jam.zip (download it, upload it to the jam site).

## 0.5.0 — 2026-10-04
- Keyboard and PS5 controller: the whole game plays without touch. Cross = a tap (and the parry), Circle = dodge / back, Square = Strike, R2 = Technique, Triangle = Nala, d-pad or left stick moves a teal highlight through menus and targets, Options pauses. A short desktop window no longer shows "Rotate your phone".
- Button prompts: tutorials, hints and the Recollection (hold Cross, the arrow's way, mash Square) name the key or button you play with, and every enemy attack shows the parry and dodge buttons over the hero (only dodge on a red ring).
- Settings > Controls rebinds the keyboard and the controller.

## 0.4.0 — 2026-10-04
- New mode: the Arena (Menu > Arena). Pick two heroes and a support, then fight an endless line of ever stronger enemies with no story in between. HP carries over from fight to fight.
- The team levels up as it wins (Rhea learns the Recollection at level 10), picks a buff after every fight and rests at a campfire every 4 fights (full heal plus a team upgrade).
- New enemy groups for the Arena: Quill with a Forgotten, two Quills, three Warden Hollows and more.

## 0.3.2 — 2026-10-04
- Credits: the champion's record is now 8:59 (Unforgettable).
- Music loops for real: each pass of a track is scheduled to start on the exact sample the previous one ends, instead of relying on the browser's loop flag (which went silent after the first pass in desktop Chrome on the jam site).
- Music diagnostics: `unrememberedMusic()` in the browser console shows what the music is doing, its live level and its last events.

## 0.3.1 — 2026-10-04
- Unforgettable: the Forgotten's parry, dodge and red-ring timing windows are a bit wider (PERFECT 56 ms, GOOD 172 ms instead of 45 / 150).
- Blast can no longer be dodged by Quill, and Rhea now reaches Recall 5 after the gate battle, so the Blast aim minigame is live in the boss fight.
- Music keeps looping: tracks loop the whole file unless a real silence is trimmed, and a track that ever stops looping restarts at once.
- Credits: "Unremembered Champions" with the first champion, Κώστας (Unforgettable, 12:32, rank A). The Greek credit roles line up again.

## 0.3.0 — 2026-10-04
- Game-jam site reporting: finishing a run tells the host page the run's time, difficulty and battle results (no change on screen).
- `npm run build:jam` is back on main: the jam zip with `index.html` and `thumb.jpg` at the root.

## 0.2.0 — 2026-10-04
- Post-jam development starts. The version number now shows on the Title and Menu screens.
- Boss checkpoint: losing in Quill's second stage offers "Retry from here", which restarts at that stage instead of the whole fight.

## 0.1.0 — 2026-10-03
- Game jam build: Chapter 1 complete (branch `jam-build-final`).
