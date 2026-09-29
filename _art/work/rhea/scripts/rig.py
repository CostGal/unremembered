# rig.py - split rhea.png into parts on the same canvas, with occlusion fill
import numpy as np
from PIL import Image
from common import *

def is_brown(p):
    r,g,b = [int(v) for v in p[:3]]
    return r>g>b and r-b>40 and r>70

def build_rig(base=BASE):
    a = base[:,:,3]>0
    H,W = 128,128
    bag = np.zeros((H,W),bool)
    # bag body: brown pixels rows 48..82, x>=79, then close the row span (buckle etc.)
    for y in range(48,83):
        xs=[x for x in range(79,100) if a[y,x] and is_brown(base[y,x])]
        if len(xs)>=2:
            bag[y, min(xs):max(xs)+1] = a[y, min(xs):max(xs)+1]
    # baton (+far glove): everything left of the coat's left edge, rows 60..100.
    # edge interpolated between clean rows 58 and 101 (no glove/baton there)
    baton = np.zeros((H,W),bool)
    e0 = np.where(a[58])[0].min(); e1 = np.where(a[101])[0].min()
    for y in range(60,101):
        e = int(round(e0 + (e1-e0)*(y-58)/(101-58)))
        baton[y,:e] = a[y,:e]
    body = a & ~bag & ~baton
    # occlusion fill under the bag: copy the coat pixel 2px inside the coat's right edge, same row
    fill = base.copy()
    for y in range(48,83):
        bx = np.where(bag[y])[0]
        if len(bx)==0: continue
        cx = np.where(body[y] & (np.arange(W)<bx.min()))[0]
        if len(cx)==0: continue
        edge = cx.max()
        src = base[y, edge-2]
        # estimate coat right edge from rows without bag (row 46 and row 84)
        e_top = np.where(body[46])[0].max(); e_bot = np.where(body[84])[0].max()
        e = int(round(e_top + (e_bot-e_top)*(y-46)/(84-46)))
        for x in bx:
            if x <= e-1:
                fill[y,x] = src
            elif x == e:
                fill[y,x] = base[y, edge]  # outline
            else:
                fill[y,x] = 0
    parts = {}
    parts['body'] = clean(np.where(body[:,:,None], base, 0).astype(np.uint8))
    parts['body_filled'] = clean(np.where((body|bag)[:,:,None], fill, 0).astype(np.uint8))
    parts['bag'] = clean(np.where(bag[:,:,None], base, 0).astype(np.uint8))
    parts['baton'] = clean(np.where(baton[:,:,None], base, 0).astype(np.uint8))
    return parts

def glove_only(P):
    g = P['baton'].copy(); m=g[:,:,3]>0
    shaft = (g[:,:,:3].max(axis=2)<45) | (g[:,:,:3].min(axis=2)>150)
    g[m&shaft]=0
    g[73:]=0   # glove lives in rows 60..72; anything lower is baton
    return g

REST_GRIP = (55.0,63.0); REST_DIR = (-0.5,0.866)

def rest_frame(P=None):
    """canonical rest: rig body + bag + far glove + procedural baton (behind body)"""
    from baton import draw_baton
    P = P or build_rig()
    bat = draw_baton(np.zeros((128,128,4),np.uint8), np.array(REST_GRIP), np.array(REST_DIR))
    fr = over(bat, P['body_filled'].copy())
    fr = over(fr, P['bag']); fr = over(fr, glove_only(P))
    from badge import stamp_badge
    return clean(stamp_badge(fr, 'off'))

if __name__ == '__main__':
    P = build_rig()
    # reconstruction test
    rec = over(over(P['body'].copy(), P['baton']), P['bag'])
    print('recon diff', int((rec!=BASE).any(axis=2).sum()))
    ov = np.zeros((128,128,4),np.uint8)
    ov[P['body'][:,:,3]>0]=(60,120,255,255); ov[P['bag'][:,:,3]>0]=(255,160,40,255); ov[P['baton'][:,:,3]>0]=(255,60,60,255)
    z=4
    out=Image.new('RGBA',(128*3*z,128*z),(60,60,60,255))
    for i,arr in enumerate([ov, P['body_filled'], over(over(P['body'].copy(),P['baton']),P['bag'])]):
        im=Image.fromarray(arr).resize((128*z,128*z),Image.NEAREST); out.paste(im,(i*128*z,0),im)
    out.save('/home/claude/rig_overlay.png')
