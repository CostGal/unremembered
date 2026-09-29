# parry.py - Rhea parry: same guard as Return to Sender (RtS = enhanced parry), no counter. Guard is the holdFrame
# (waits for the enemy hit), then a block: upper body pushed back 2 px + sparks on the blade, then recover to rest. 8 frames.
import numpy as np, json
from common import *
from rig import rest_frame
from ability import keyframe
from blast import lean
from cast import put

REST = rest_frame()
WHITE = (0xf1,0xef,0xe8); TEAL = (0x3f,0xd0,0xc9)

def block_sparks(fr, i):
    fx = np.zeros_like(fr)
    # blade in the guard runs along y~50, x 4..43; the hit lands near x 14
    pts = {4: [(14,46,WHITE),(12,44,TEAL),(16,44,TEAL),(11,49,TEAL),(17,48,TEAL),(13,42,TEAL)],
           5: [(10,43,TEAL),(18,43,TEAL),(9,50,TEAL),(14,40,WHITE)],
           6: [(8,42,TEAL)]}
    for x,y,c in pts.get(i,[]): put(fx,x,y,c)
    return over(fr, fx)

def make_parry():
    seq  = [None,'c1','s2','s3','s3','s3','s2',None]
    push = [0,0,0,0,2,1,0,0]      # knocked back on the block (row shear, +x)
    frames=[]
    for i,k in enumerate(seq):
        if k is None: fr = REST.copy()
        else:
            fr = keyframe(k, False)
            if push[i]: fr = lean(fr, -push[i])       # lean() with negative k = backwards
            fr = block_sparks(fr, i)
        fr = clean(fr); assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_parry()
    durs = [80,90,100,140,50,90,110,100]
    save_png(sheet(fr), OUT+'rhea_parry.png')
    save_gif(fr, durs, OUT+'rhea_parry.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['parry']={'frames':8,'sheet':'rhea_parry.png','durations_ms':durs,'loop':False,'holdFrame':3,'impactFrames':[4]}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    print('ok',sum(durs))
