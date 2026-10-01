# anim_stamp.py — Clerk STAMP attack: raise_fist windup (held) → overhead slam in the dash lunge → rest. ~1.3 s
from common import *
from stamp import place_stamp, find_back_fist
from draw import *
from rig import REST
import json

RF = load_sheet('clerk_raise_fist')
DS = load_sheet('clerk_dash')

# keyframe table: (source, erase boxes, arm (shoulder, elbow, fist) or None, stamp (dir, anchor) or None, fx)
#   anchor = grip pixel = fist top-center. For pixler fists the anchor comes from find_back_fist.
def pix_anchor(f, dy=0):
    b = find_back_fist(f); return ((b[0] + b[1]) // 2, b[2] + dy)

# pixler back arm removal: erase right of a sloped back edge, re-outline (see draw.erase_beyond)
E6  = (range(30, 70), lambda y: 80 + (y - 30) * 0.3)
E11 = (range(40, 72), lambda y: 78 + (y - 41) * 0.5)
E13 = (range(37, 70), lambda y: 78 + (y - 38) * 0.5)

K = [
    dict(src=REST),                                                                    # 0 rest
    dict(src=RF[2]),                                                                   # 1 hand leaves the pocket
    dict(src=RF[4], stamp=('up', pix_anchor(RF[4]))),                                  # 2 stamp out, at the hip
    dict(src=RF[5], stamp=('up', pix_anchor(RF[5]))),                                  # 3 rising
    dict(src=RF[7], stamp=('up', pix_anchor(RF[7]))),                                  # 4 WINDUP (held): fist cocked by the head
    dict(src=RF[6], stamp=('up', pix_anchor(RF[6]))),                                  # 5 anticipation: fist at the top
    dict(src=DS[6],  erase=E6,  arm=((78, 33), (66, 10), (52, 12)), stamp=('left', (52, 9))),    # 6 swing, lunge starts
    # 7-10: the arm swings ACROSS the face (asked for): arm + fist + stamp drawn IN FRONT of the body
    dict(src=DS[11], erase=E11, arm=((80, 46), (64, 34), (41, 38)), stamp=('left', (41, 35)), front=True,
         fx=('flash', (32, 38), 6)),                                                             # 7 IMPACT: cross-slam at face height
    dict(src=DS[13], erase=E13, arm=((80, 44), (64, 34), (42, 39)), stamp=('left', (42, 36)), front=True,
         fx=('sparks', (33, 39))),                                                               # 8 hold
    dict(src=DS[13], erase=E13, arm=((80, 44), (70, 38), (55, 43)), stamp=('left', (55, 40)), front=True),  # 9 retract across the jaw
    dict(src=DS[6],  erase=E6,  arm=((80, 35), (76, 46), (68, 52)), stamp=('up', (68, 49)), front=True),    # 10 standing up, fist at the chest
    dict(src=RF[4], stamp=('up', pix_anchor(RF[4]))),                                  # 11 hand at the hip
    dict(src=RF[2]),                                                                   # 12 back to the pocket
    dict(src=REST),                                                                    # 13 rest
]
DUR = [80, 100, 100, 90, 170, 70, 60, 50, 110, 100, 100, 110, 110, 120]   # 1370 ms
WINDUP, IMPACT = 4, [7]
SPARKS = [(-6, -5), (-9, 0), (-7, 5), (-3, -8), (-2, 7), (-10, -3), (-11, 3), (-5, 9)]

def build():
    frames = []
    for k in K:
        body = k['src'].copy()
        if 'erase' in k: body = erase_beyond(body, *k['erase'])
        layers = []
        front = k.get('front', False)
        if 'arm' in k and not front:
            s, e, f = k['arm']
            layers.append(back_arm(s, e, f))                      # sleeve behind the body
        if 'stamp' in k and not front:
            layers.append(place_stamp(*k['stamp']))              # stamp behind the body (handle inside the fist)
        layers.append(body)
        if 'arm' in k:
            if front: layers.append(back_arm(*k['arm']))          # sleeve in front of the body (crosses the face)
            layers.append(fist(k['arm'][2]))                      # procedural fist in front
            if 'stamp' in k:
                layers.append(place_stamp(*k['stamp']))          # stamp over the fist
        if 'fx' in k:
            if k['fx'][0] == 'flash': layers.append(fx_flash(k['fx'][1], k['fx'][2]))
            else: layers.append(fx_sparks(k['fx'][1], SPARKS))
        fr = composite(layers)
        frames.append(pin_ground(fr) if ground_row(fr) != GROUND else fr)
    return frames

if __name__ == '__main__':
    frames = build()
    pal = palette_of([REST] + RF + DS)
    check_frames(frames, pal, 'stamp', rest=REST)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_stamp.png')
    save_gif(frames, DUR, f'{OUT}/clerk_stamp.gif')
    contact_sheet(frames, f'{OUT}/clerk_stamp_contact.png', scale=1, cols=7)
    json.dump({'frames': len(frames), 'sheet': 'clerk_stamp.png', 'durations_ms': DUR, 'loop': False,
               'windupFrame': WINDUP, 'impactFrames': IMPACT}, open(f'{OUT}/_stamp.json', 'w'))
    print('ok', len(frames), sum(DUR), 'ms')
