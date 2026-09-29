# attack.py - Rhea "Strike" v3: 12 frames, pixler keyframes + procedural baton (fixed length/thickness, glued to the glove)
# 0 rest | 1 f1 | 2 f2 lift | 3 f5 WINDUP | 4 f6 overhead | 5 f9 diagonal | 6 f7 CONTACT | 7 f8 follow-through
# 8 f11 settle | 9 f2 recover | 10 f1 | 11 rest
import numpy as np, json
from scipy import ndimage as ndi
from common import *
from rig import build_rig, rest_frame, glove_only
from baton import draw_baton
from badge import stamp_badge

SRC = frames_of(load(UP+'woman-courier-custom.png'))
P = build_rig(); REST = rest_frame(P)

# per keyframe: grip (x,y), direction (unit, grip->tip), erase box (x0,y0,x1,y1) for pixler's baton, z = 'back'/'front'
KF = {
 1:  dict(grip=(55,63), dir=(-0.60,0.80), box=None,            z='back', anchor=(77,38)),
 2:  dict(grip=(40,52), dir=(-1.0,0.05), box=[(20,55,43,90,'all')],   z='back', anchor=(78,39)),
 5:  dict(grip=(56,20), dir=(-0.90,-0.44), box=[(86,8,102,32),(80,14,102,24,'nothair')],  z='back', anchor=(85,39)),
 6:  dict(grip=(43,29), dir=(-0.87,-0.48),box=[(44,0,57,27),(44,0,95,9,'all')], z='back', anchor=(80,40)),
 9:  dict(grip=(21,36), dir=(-0.96,-0.28),box=[(0,6,22,33,'all')],     z='back', anchor=(77,42)),
 7:  dict(grip=(40,58), dir=(-1.0,0.02),  box=[(0,52,35,64)],    z='back', anchor=(77,41)),
 8:  dict(grip=(24,44), dir=(-0.55,0.83),   box=[(16,49,30,82,'all')],   z='back', anchor=(76,41)),
 11: dict(grip=(46,68), dir=(-0.15,0.99), box=None,            z='front', anchor=(81,39)),
}
ORDER = [None,1,2,5,6,9,7,8,11,2,1,None]

def erase_box(fr, box):
    fr = fr.copy(); x0,y0,x1,y1 = box[:4]; mode = box[4] if len(box)>4 else 'baton'
    sub = fr[y0:y1+1, x0:x1+1]
    a = sub[:,:,3]>0
    dark = sub[:,:,:3].max(axis=2)<70
    silver = sub[:,:,:3].min(axis=2)>150
    light = sub[:,:,:3].min(axis=2)>170
    sel = {'baton': a&(dark|silver), 'all': a, 'nothair': a&~light}[mode]
    sub[sel] = 0
    # despeckle leftovers inside the box (<6 px components)
    a = sub[:,:,3]>0
    lab,n = ndi.label(a, structure=np.ones((3,3)))
    for k in range(1,n+1):
        m = lab==k
        if m.sum()<6: sub[m]=0
    fr[y0:y1+1, x0:x1+1] = sub
    return fr

def despeckle(fr, minsize):
    """drop stray components (pixler leftovers) smaller than minsize px"""
    fr=fr.copy(); a=fr[:,:,3]>0
    lab,n=ndi.label(a, structure=np.ones((3,3)))
    for k in range(1,n+1):
        m=lab==k
        if m.sum()<minsize: fr[m]=0
    return fr

def compose(fr, k):
    grip = np.array(KF[k]['grip'],float); v = np.array(KF[k]['dir'],float); v/=np.linalg.norm(v)
    bat = draw_baton(np.zeros_like(fr), grip, v)
    if KF[k]['z']=='back':
        return over(bat, fr)     # body on top of baton
    return over(fr.copy(), bat)  # baton on top

def make_attack():
    frames=[]
    for k in ORDER:
        if k is None: frames.append(REST.copy()); continue
        if k==1:
            # rest body without its baton (rig), far glove kept, baton redrawn slightly lifted
            body = over(over(P['body_filled'].copy(), P['bag']), glove_only(P))
            body = stamp_badge(body, 'off', KF[1]['anchor'])
            fr = compose(body, 1)
        else:
            fr = clean(SRC[k]); fr[badge_mask(fr)] = [*BADGE_OFF,255]
            for bx in (KF[k]['box'] or []): fr = erase_box(fr, bx)
            fr = despeckle(fr, 10)
            fr = stamp_badge(fr, 'off', KF[k]['anchor'])
            fr = compose(fr, k)
        assert_frame(fr); frames.append(fr)
    return frames


if __name__=='__main__':
    fr = make_attack()
    durs = [100,90,110,160,60,45,60,100,140,120,110,120]
    save_png(sheet(fr), OUT+'rhea_attack.png')
    save_gif(fr, durs, OUT+'rhea_attack.gif', scale=3)
    contact(fr, '/home/claude/attack_contact.png', scale=3, cols=6)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['attack']={'frames':12,'sheet':'rhea_attack.png','durations_ms':durs,'loop':False,'windupFrame':3,'impactFrames':[6]}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    print('ok', sum(durs),'ms')
