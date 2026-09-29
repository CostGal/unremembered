# hurt.py - Rhea hurt: side-view flinch built from the rest rig. Upper body knocked back (+x = away from the enemy),
# head snaps further, knees give 2 px, coat/bag lag, small impact sparks (FX layer). 8 frames, rest -> rest.
import numpy as np, json
from common import *
from rig import build_rig, rest_frame, glove_only, REST_GRIP, REST_DIR
from baton import draw_baton
from badge import stamp_badge
from cast import put

P = build_rig(); REST = rest_frame(P)
WHITE = (0xf1,0xef,0xe8); TEAL = (0x3f,0xd0,0xc9)
BODY = stamp_badge(P['body_filled'], 'off'); GLOVE = glove_only(P)

#        0  1  2  3  4  5  6  7
HEAD  = [0, 6, 6, 3, 1,-1, 0, 0]
TORSO = [0, 4, 5, 3, 1, 0, 0, 0]
HAIR  = [0,-2,-1, 0, 0, 0, 0, 0]   # hair trails forward relative to the head
BAG   = [0, 3, 4, 3, 1, 0, 0, 0]   # lags the torso
SQ    = [0, 2, 2, 1, 0, 0, 0, 0]   # knees give (rows removed above the boots)

def sparks(i):
    fx = np.zeros((128,128,4),np.uint8)
    pts = {1: [(52,52,WHITE),(50,50,TEAL),(54,50,TEAL),(50,54,TEAL),(54,54,TEAL),(48,46,WHITE)],
           2: [(48,50,TEAL),(46,56,TEAL),(56,46,TEAL),(44,48,WHITE)],
           3: [(44,52,TEAL)]}
    for x,y,c in pts.get(i,[]): put(fx,x,y,c)
    return fx

def make_hurt():
    frames=[]
    for i in range(8):
        body = BODY.copy()
        body = row_shear(body, 0, 33, HEAD[i])            # head
        body = row_shear(body, 6, 20, HAIR[i])            # hair top trails (extra, relative)
        body = row_shear(body, 34, 75, TORSO[i])          # torso
        body = row_shear(body, 76, 99, TORSO[i]//2)       # hips / coat hem
        for _ in range(SQ[i]): body = delete_row(body, 100)
        dy = SQ[i]
        bat = draw_baton(np.zeros_like(body), np.array(REST_GRIP)+np.array((TORSO[i],dy)), np.array(REST_DIR))
        fr = over(bat, body)
        fr = over(fr, shift(P['bag'], dx=BAG[i], dy=dy))
        fr = over(fr, shift(GLOVE, dx=TORSO[i], dy=dy))
        fr = over(fr, sparks(i))
        fr = clean(fr); assert_frame(fr); frames.append(fr)
    assert (frames[0]==REST).all() and (frames[-1]==REST).all()
    return frames

if __name__=='__main__':
    fr = make_hurt()
    durs = [40,60,90,80,80,80,90,90]
    save_png(sheet(fr), OUT+'rhea_hurt.png')
    save_gif(fr, durs, OUT+'rhea_hurt.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['hurt']={'frames':8,'sheet':'rhea_hurt.png','durations_ms':durs,'loop':False}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    print('ok',sum(durs))
