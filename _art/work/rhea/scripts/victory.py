# victory.py - Rhea victory: baton raised (rest -> raise -> hold with a small pump). 8 frames, last frame held.
import numpy as np, json
from scipy import ndimage as ndi
from common import *
from rig import rest_frame
from blast import keyframe, lean
from cast import put

REST = rest_frame()
WHITE = (0xf1,0xef,0xe8); TEAL = (0x3f,0xd0,0xc9)

def sparkle(fr, i):
    fx = np.zeros_like(fr)
    # tip of the raised blade in r3 ~ (29,1); small 4-point sparkle to the left/below it
    pts = {4: [(24,4,WHITE),(23,4,TEAL),(25,4,TEAL),(24,3,TEAL),(24,5,TEAL)],
           5: [(24,4,WHITE),(22,4,TEAL),(26,4,TEAL),(24,2,TEAL),(24,6,TEAL),(36,10,TEAL)],
           6: [(23,4,TEAL),(25,4,TEAL),(36,10,WHITE)]}
    for x,y,c in pts.get(i,[]): put(fx, x, y, c)
    return over(fx, fr)

def make_victory():
    seq  = [None,'c1','r2','r3','r3','r3','r3','r3']
    lift = [0, 0, 0, 0, 1, 1, 1, 0]
    frames=[]
    for i,k in enumerate(seq):
        if k is None: fr = REST.copy()
        else:
            fr,_ = keyframe(k)
            for j in range(lift[i]): fr = insert_row(fr, 76+j)
        fr = sparkle(fr, i)
        fr = clean(fr); assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_victory()
    durs = [90,90,90,120,110,140,160,200]
    save_png(sheet(fr), OUT+'rhea_victory.png')
    save_gif(fr, durs, OUT+'rhea_victory.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['victory']={'frames':8,'sheet':'rhea_victory.png','durations_ms':durs,'loop':False,'holdLastFrame':True}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    print('ok')
