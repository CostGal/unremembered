# Trailer

`unremembered_trailer_v1.mp4`: 1080×1920 (9:16), ~32 s, H.264 + AAC, for Instagram / Discord. `cover.jpg` is the end card. The deploy copies both to Pages: https://costgal.github.io/unremembered/trailer/unremembered_trailer_v1.mp4 (a direct link that plays in any browser or `<video>` embed; GitHub's raw link does not, it is served as octet-stream).

Regenerate from the current game with `npm run trailer` (headless Chromium + ffmpeg, ~3 minutes). The edit is `scripts/trailer/shotlist.json`; text cards come from `scripts/trailer/card.html`. Every game shot is recorded from the real dev build and the battles are played by the playtest bot. `--cut-only` re-cuts the last recordings, `--only id,id` records a few shots.

Music attribution (paste under the post):
Music: Eric Skiff — Resistor Anthems (CC BY 4.0), ericskiff.com/music
