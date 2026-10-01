# anim_parry_dodge.py — PARRY (ledger_guard f2-6: ledger up as a shield, block sparks) and
# DODGE (dash f4-10: ducks into a low lunge under the attack, back up). ~0.6 s each.
from common import *
from draw import fx_flash, fx_sparks
from rig import REST
import json

G = load_sheet('clerk_ledger_guard')
DS = load_sheet('clerk_dash')

SP = [(-5, -6), (-8, -1), (-6, 5), (-3, -9), (-9, 4), (-2, 8)]
PARRY = [REST, G[2], G[4],
         composite([G[5], fx_flash((44, 26), 5), fx_sparks((42, 26), SP)]),   # 3 block: sparks on the ledger face
         composite([G[6], fx_sparks((40, 24), [(x - 3, y - 2) for x, y in SP])]),
         G[4], G[2], REST]
PARRY_DUR = [40, 60, 70, 120, 110, 80, 70, 60]   # 610 ms
PARRY_HOLD = 3

DODGE = [REST, DS[4], DS[6], DS[8], DS[10], DS[10], DS[8], DS[6], DS[4], REST]
DODGE_DUR = [40, 50, 50, 60, 90, 90, 70, 70, 60, 60]   # 640 ms

if __name__ == '__main__':
    pal = palette_of([REST] + G + DS)
    for name, fr, d, extra in (('parry', PARRY, PARRY_DUR, {'holdFrame': PARRY_HOLD}), ('dodge', DODGE, DODGE_DUR, {})):
        fr = [pin_ground(f) for f in fr]
        check_frames(fr, pal, name, rest=REST)
        for i, f in enumerate(fr): assert ground_row(f) == GROUND, (name, i)
        save_sheet(fr, f'{OUT}/clerk_{name}.png'); save_gif(fr, d, f'{OUT}/clerk_{name}.gif')
        contact_sheet(fr, f'{OUT}/clerk_{name}_contact.png', scale=1, cols=10)
        json.dump({'frames': len(fr), 'sheet': f'clerk_{name}.png', 'durations_ms': d, 'loop': False, **extra},
                  open(f'{OUT}/_{name}.json', 'w'))
        print(name, len(fr), sum(d))
