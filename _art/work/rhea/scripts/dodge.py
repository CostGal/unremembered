# dodge.py - Rhea dodge (crouch): quick duck under the attack and back up. 8 frames, holdFrame = deepest crouch.
# keyframes woman-courier-crouch.png (k*). Procedural baton, sword logic.
import numpy as np, json
from scipy import ndimage as ndi
from common import *
from rig import rest_frame
from baton import draw_baton
from attack import erase_box, despeckle
from blast import unglow

K = frames_of(load(UP+'woman-courier-crouch.png'))
REST = rest_frame()

KF = {
 3: dict(grip=(40,60), dir=(-0.75,0.66), box=[(8,62,37,88,'all')]),
 4: dict(grip=(34,64), dir=(-0.85,0.53), box=[(2,66,27,88,'all'),(28,71,34,77,'all')]),
 6: dict(grip=(40,76), dir=(-0.97,0.24), box=[(0,74,35,92,'all')]),
 7: dict(grip=(40,77), dir=(-0.98,0.20), box=[(0,74,35,90,'all')]),
}
ORDER = [None,3,4,6,7,4,3,None]

def keyframe(k):
    d = KF[k]
    grip = np.array(d['grip'],float); v = np.array(d['dir'],float); v/=np.linalg.norm(v)
    body = clean(K[k])
    for bx in d['box']: body = erase_box(body, bx)
    bm = badge_mask(body); body[bm] = [*BADGE_OFF,255]
    body = unglow(body); body = despeckle(body, 10)
    bat = draw_baton(np.zeros_like(body), grip, v)
    return clean(over(bat, body))

def make_dodge():
    frames=[]
    for k in ORDER:
        fr = REST.copy() if k is None else keyframe(k)
        assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_dodge()
    durs = [60,60,60,80,140,80,80,90]
    save_png(sheet(fr), OUT+'rhea_dodge.png')
    save_gif(fr, durs, OUT+'rhea_dodge.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['dodge']={'frames':8,'sheet':'rhea_dodge.png','durations_ms':durs,'loop':False,'holdFrame':4}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    for i,f in enumerate(fr):
        a=f[:,:,3]>0; lab,n=ndi.label(a,structure=np.ones((3,3)))
        if n!=1: print('frame',i,'components',n)
    print('ok',sum(durs))
