# death.py - Rhea death: stumble -> fall to knees -> collapse (last frame = downed pose, held by the game). 10 frames.
# keyframes rhea_death.png (d*) + custom f1 (c1). Procedural baton: held (sword logic) until the fall, then lying flat.
import numpy as np, json
from scipy import ndimage as ndi
from common import *
from rig import build_rig, rest_frame, glove_only
from baton import draw_baton
from badge import stamp_badge
from attack import erase_box, despeckle
from blast import unglow

D = frames_of(load(UP+'rhea_death.png'))
P = build_rig(); REST = rest_frame(P)
SH = 10   # kneeling frames shifted right so the dropped baton fits in the canvas

KF = {
 'c1': dict(grip=(55,63), dir=(-0.60,0.80), box=[], shift=0),
 'd2': dict(grip=(54,64), dir=(-0.70,0.71), box=[(22,66,50,94,'all')], shift=0),
 'd3': dict(grip=(47,66), dir=(-0.80,0.60), box=[(10,68,43,92,'all')], shift=0),
 'd4': dict(grip=(47,70), dir=(-0.90,0.44), box=[(8,72,43,90,'all')],  shift=0),
 'd5': dict(grip=(40,100),dir=(-1.0,0.05),  box=[(0,94,29,106,'all')], shift=SH),   # hand on the ground, baton flat
 'd6': dict(grip=(41,115),dir=(-1.0,0.0),   box=[],                     shift=SH, dropped=True),
 'd7': dict(grip=(41,116),dir=(-1.0,0.0),   box=[(0,108,29,120,'all')], shift=SH, dropped=True),
 'd8': dict(grip=(41,116),dir=(-1.0,0.0),   box=[(0,108,29,120,'all')], shift=SH, dropped=True),
 'd9': dict(grip=(41,116),dir=(-1.0,0.0),   box=[(0,108,29,120,'all')], shift=SH, dropped=True),
}
ORDER = [None,'c1','d2','d3','d4','d5','d6','d7','d8','d9']

def keyframe(k):
    d = KF[k]
    grip = np.array(d['grip'],float); v = np.array(d['dir'],float); v/=np.linalg.norm(v)
    if k=='c1':
        body = over(over(P['body_filled'].copy(), P['bag']), glove_only(P))
        body = stamp_badge(body, 'off')
    else:
        body = clean(D[int(k[1])])
        for bx in d['box']: body = erase_box(body, bx)
        bm = badge_mask(body); body[bm] = [*BADGE_OFF,255]
        body = unglow(body); body = despeckle(body, 10)
        body = shift(body, dx=d['shift'])
    bat = draw_baton(np.zeros_like(body), grip, v)
    return clean(over(bat, body))   # baton behind body (dropped: her hand rests on the grip)

def make_death():
    frames=[]
    for k in ORDER:
        fr = REST.copy() if k is None else keyframe(k)
        assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_death()
    durs = [80,90,90,100,90,110,120,140,180,200]
    save_png(sheet(fr), OUT+'rhea_death.png')
    save_gif(fr, durs, OUT+'rhea_death.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['death']={'frames':10,'sheet':'rhea_death.png','durations_ms':durs,'loop':False,'holdLastFrame':True}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    for i,f in enumerate(fr):
        a=f[:,:,3]>0; lab,n=ndi.label(a,structure=np.ones((3,3)))
        if n!=1: print('frame',i,'components',n)
    print('ok',sum(durs))
