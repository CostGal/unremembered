# blast.py - Rhea "Blast": raise -> AIM (holdFrame, bolts are code FX) -> recoil -> lower -> rest. 10 frames.
# keyframes: woman-courier-custom__1_.png (r*) + custom f1 (c1); baton procedural, sword logic (blade continues the forearm)
import numpy as np, json
from scipy import ndimage as ndi
from common import *
from rig import build_rig, rest_frame, glove_only
from baton import draw_baton
from attack import erase_box, despeckle
from badge import stamp_badge

R = frames_of(load(UP+'woman-courier-custom__1_.png'))
P = build_rig(); REST = rest_frame(P)
GLOVE_DARK = (37,35,53)

KF = {
 'c1': dict(grip=(55,63), dir=(-0.60,0.80), box=[]),
 'r3': dict(grip=(45,37), dir=(-0.40,-0.92), box=[(34,0,50,35,'all')]),
 'r2': dict(grip=(31,42), dir=(-0.75,-0.66),box=[(0,16,29,44,'all')]),
 'r1': dict(grip=(40,56), dir=(-1.0,0.03),  box=[(0,50,36,62,'all')]),
 'r7': dict(grip=(46,56), dir=(-1.0,0.02),  box=[(0,48,43,64,'all')]),
 'r5': dict(grip=(46,58), dir=(-0.92,0.39), box=[(6,48,43,78,'all'),(24,86,36,96,'all')]),
 'r6': dict(grip=(54,66), dir=(-0.42,0.91), box=[(34,70,52,106,'all'),(48,86,56,106,'all')]),
}
ORDER = [None,'c1','r3','r2','r1','r7','r1','r5','r6',None]
LEAN  = [0, 0, 1, 2, 2, 0, 1, 1, 0, 0]      # forward weight shift (px), recoil snaps back
BADGE = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0]      # shoulder badge lit (Echo) while firing
BADGE_ON = [(72,232,197),(61,231,194),(88,238,194)]   # original badge teal from rhea.png

def lean(fr, k):
    """upper body leans forward: head/shoulders -k, torso -k//2, hips+legs fixed (row shear, integer)"""
    if not k: return fr
    fr = row_shear(fr, 0, 45, -k)
    fr = row_shear(fr, 46, 75, -(k+1)//2)
    return fr

def unglow(fr):
    """pixler recoloured the glove blue/teal in some frames -> back to dark glove"""
    fr = fr.copy(); a = fr[:,:,3]>0
    r,g,b = [fr[:,:,i].astype(int) for i in range(3)]
    t = a & (b>r+40) & (g>r+30) & (g>90)
    fr[t] = [*GLOVE_DARK,255]
    return fr

def keyframe(k):
    d = KF[k]
    grip = np.array(d['grip'],float); v = np.array(d['dir'],float); v/=np.linalg.norm(v)
    if k=='c1':
        body = stamp_badge(over(over(P['body_filled'].copy(), P['bag']), glove_only(P)), 'off')
    else:
        body = clean(R[int(k[1])])
    if k!='c1':
        for bx in d['box']: body = erase_box(body, bx)
    bm = badge_mask(body); bm[:28]=0; bm[50:]=0; bm[:,:68]=0   # stray teal on the upper arm -> off
    body[bm] = [*BADGE_OFF,255]
    if k!='c1':
        body = unglow(body); body = despeckle(body, 10)
    bat = draw_baton(np.zeros_like(body), grip, v)
    return clean(over(bat, body)), bm   # baton behind body

def make_blast():
    frames=[]
    for i,k in enumerate(ORDER):
        fr, bm = (REST.copy(), badge_mask(RAW)) if k is None else keyframe(k)
        fr = stamp_badge(fr, 'on' if BADGE[i] else 'off')
        fr = clean(lean(fr, LEAN[i]))
        assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_blast()
    durs = [90,90,100,80,140,60,110,100,110,100]
    save_png(sheet(fr), OUT+'rhea_blast.png')
    save_gif(fr, durs, OUT+'rhea_blast.gif', scale=3)
    contact(fr, '/home/claude/blast_contact.png', scale=4, cols=5)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['blast']={'frames':10,'sheet':'rhea_blast.png','durations_ms':durs,'loop':False,'holdFrame':4,
        'projectile':'blast_projectile','spawn_px':[0,57]}   # spawn = baton tip on the hold frame
    # projectile: pixler sheet is already FX-palette clean (#3fd0c9 / #f1efe8), 4 frames 48x48, facing left
    pj = load(UP+'echo_wave_projectile_sheet.png'); assert set(map(tuple,pj[pj[:,:,3]>0][:,:3])) <= FX
    save_png(clean(pj), OUT+'rhea_blast_projectile.png')
    J['animations']['blast_projectile']={'frames':4,'frame_size':[48,48],'sheet':'rhea_blast_projectile.png','durations_ms':[60,60,60,80],'loop':True}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    for i,f in enumerate(fr):
        a=f[:,:,3]>0; lab,n=ndi.label(a,structure=np.ones((3,3))); print(i,'components',n)
    print('ok',sum(durs))
