# idle.py - Rhea idle: 8-frame loop, breathing (1px torso lift), head/hair/coat/bag lag, blink
import numpy as np, json
from common import *
from rig import build_rig, rest_frame, glove_only, REST_GRIP, REST_DIR
from baton import draw_baton
from badge import stamp_badge

P = build_rig()
SKIN = (0xfc,0xcc,0xa4)
REST = rest_frame(P)
BATON = draw_baton(np.zeros((128,128,4),np.uint8), np.array(REST_GRIP), np.array(REST_DIR))
GLOVE = glove_only(P)

def make_idle():
    n = 8
    torso = [0,1,2,2,2,1,0,0]      # inhale rise (px)
    head  = [0,0,1,2,2,2,1,0]      # 1-frame lag
    bag   = [0,0,1,2,2,2,1,0]      # hangs, lags
    hair  = [0,0,1,1,1,0,0,0]      # hair tips shear back (+x) while rising
    hem   = [0,0,0,1,1,1,1,0]      # coat hem sways back (+x), lag
    blink = [0,0,0,0,0,1,0,0]
    frames = []
    for i in range(n):
        body = stamp_badge(P['body_filled'], 'off')
        # blink: close rows 15-16 of the eye with skin, keep lash row 14
        if blink[i]:
            body[15:17, 63:68] = [*SKIN, 255]
        # hair tips (rows 24-31, x>=73) shear
        if hair[i]:
            seg = body[24:32].copy(); seg[:, :73] = 0
            body[24:32, 73:] = 0
            body[24:32] = over(body[24:32], shift(seg, dx=1))
        # head relative to torso (neck row 33)
        rel = head[i]-torso[i]
        if rel == 1: body = insert_row(body, 33)
        elif rel == -1: body = delete_row(body, 33)
        # torso lift: duplicate flat coat row 76
        for k in range(torso[i]): body = insert_row(body, 76+k)
        # coat hem sway (rows 92-101)
        if hem[i]: body = row_shear(body, 92, 101, +1)
        bagp  = shift(P['bag'],   dy=-bag[i])
        fr = over(shift(BATON, dy=-torso[i]), body)     # baton behind body
        fr = over(over(fr, bagp), shift(GLOVE, dy=-torso[i]))
        fr = clean(fr)
        assert_frame(fr)
        frames.append(fr)
    assert (frames[0]==REST).all(), 'frame 0 must equal rest'
    return frames

if __name__ == '__main__':
    fr = make_idle()
    durs = [160,160,150,140,140,90,150,160]
    save_png(sheet(fr), OUT+'rhea_idle.png')
    save_gif(fr, durs, OUT+'rhea_idle.gif', scale=3)
    contact(fr, '/home/claude/idle_contact.png', scale=3)
    json.dump({'frame_size':[128,128],'facing':'left','animations':{
        'idle':{'frames':8,'sheet':'rhea_idle.png','durations_ms':durs,'loop':True}}},
        open(OUT+'rhea_animations.json','w'), indent=2)
    print('ok')
