# Unremembered

A short turn-based RPG demo with real-time parry timing, made in one week for a game jam. Play it on your phone, in portrait, in the browser: no install, no login. Rhea and Dov walk through a rain-soaked city of forgotten things, and every enemy attack is a ring to time.

**Play:** https://costgal.github.io/unremembered/

## How to run

```
npm ci
npm run dev      # local dev server
npm run build    # production build into dist/
```

## Credits

The full credits are revealed post game jam.

## Music

Music: Eric Skiff — Resistor Anthems (CC BY 4.0) · xDeviruchi — 8-Bit Fantasy & Adventure (CC BY-SA 4.0) · Juhani Junkala (CC0) · other artists: full credits post-jam.

| Artist | License | Tracks |
|---|---|---|
| Eric Skiff, *Resistor Anthems* | CC BY 4.0 | `battle_duel`, `cs_forgotten`, `keepsake`, `meet_dov` |
| xDeviruchi, *8-Bit Fantasy & Adventure* | CC BY-SA 4.0 | `cs_golden`, `cs_hush`, `cs_war` |
| Juhani Junkala | CC0 | `title`, `battle`, `battle_hollow` |
| TODO (author and license to be confirmed) | TODO | `boss`, `battle_gate`, `cs_fall`, `recollection`, `rest_sad` |

The tracks are trimmed, looped and loudness-normalised copies (see `docs/ASSETS_INBOX.md`); tracks without a file (warm, quill_rise, ending, victory, memory_return, gameover) are procedural (Web Audio). Sound effects are CC0 or procedural: no credit needed.
