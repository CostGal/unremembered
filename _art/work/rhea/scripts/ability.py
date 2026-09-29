# ability.py - Rhea "Return to Sender": guard (holdFrame, held through the enemy turn) -> counter thrust -> rest. 10 frames.
# keyframes: rhea_Return_to_Sender.png (s*) + custom f1 (c1). Procedural baton, sword logic. Badge lit = Echo active.
import numpy as np, json
from scipy import ndimage as ndi
from common import *
from rig import build_rig, rest_frame, glove_only
from baton import draw_baton
from badge import stamp_badge
from attack import erase_box, despeckle
from blast import unglow

S = frames_of(load(UP+'rhea_Return_to_Sender.png'))
P = build_rig(); REST = rest_frame(P)

KF = {
 'c1': dict(grip=(55,63), dir=(-0.60,0.80), box=[], anchor=(77,38)),
 's2': dict(grip=(47,57), dir=(-0.70,0.71), box=[(14,58,44,86,'all')], anchor=(74,40)),
 's3': dict(grip=(43,50), dir=(-1.0,0.02),  box=[(6,42,39,56,'all')],  anchor=(69,37)),   # GUARD
 's4': dict(grip=(40,38), dir=(-1.0,0.02),  box=[(4,30,34,47,'all')],  anchor=(68,37)),
 's8': dict(grip=(40,45), dir=(-1.0,0.02),  box=[(6,38,35,52,'all')],  anchor=(64,45)),   # CONTACT
 's9': dict(grip=(43,45), dir=(-1.0,0.02),  box=[(8,38,39,52,'all')],  anchor=(65,43)),
}
ORDER = [None,'c1','s2','s3','s4','s8','s9','s4','s2',None]
BADGE = [0,0,0,1,1,1,1,0,0,0]

def keyframe(k, lit):
    d = KF[k]
    grip = np.array(d['grip'],float); v = np.array(d['dir'],float); v/=np.linalg.norm(v)
    if k=='c1':
        body = stamp_badge(over(over(P['body_filled'].copy(), P['bag']), glove_only(P)), 'off')
    else:
        body = clean(S[int(k[1])])
        for bx in d['box']: body = erase_box(body, bx)
        bm = badge_mask(body); bm[:20]=0; bm[70:]=0; bm[:,:40]=0; bm[:,100:]=0
        body[bm] = [*BADGE_OFF,255]
        body = unglow(body); body = despeckle(body, 10)
    body = stamp_badge(body, 'on' if lit else 'off', d['anchor'])
    bat = draw_baton(np.zeros_like(body), grip, v)
    return clean(over(bat, body))

def make_ability():
    frames=[]
    for i,k in enumerate(ORDER):
        fr = REST.copy() if k is None else keyframe(k, BADGE[i])
        assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_ability()
    durs = [90,90,100,140,50,60,110,110,110,100]
    save_png(sheet(fr), OUT+'rhea_ability.png')
    save_gif(fr, durs, OUT+'rhea_ability.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['ability']={'frames':10,'sheet':'rhea_ability.png','durations_ms':durs,'loop':False,'holdFrame':3,'impactFrames':[5]}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    for i,f in enumerate(fr):
        a=f[:,:,3]>0; lab,n=ndi.label(a,structure=np.ones((3,3)))
        if n!=1: print('frame',i,'components',n)
    print('ok',sum(durs))
