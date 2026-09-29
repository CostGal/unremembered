# badge.py - the shoulder badge (Echo emblem): locate the dark patch on the upper arm, fill holes, set off/on state
import numpy as np
from scipy import ndimage as ndi
from common import *

REGION = (68,28,90,50)   # x0,y0,x1,y1 where the badge can be
DARK_OUT = (0x0c,0x12,0x37)
ON = [(0x3f,0xd0,0xc9),(72,232,197)]   # FX teal + original badge teal
CORE = (0xf1,0xef,0xe8)               # neon core

def badge_blob(fr):
    x0,y0,x1,y1 = REGION
    a = fr[:,:,3]>0
    filled = a.copy()                    # silhouette with row-span holes closed
    for y in range(128):
        xs = np.where(a[y])[0]
        if len(xs): filled[y, xs.min():xs.max()+1] = True
    cand = np.zeros((128,128),bool)
    for y in range(y0,y1+1):
        xs = np.where(a[y])[0]
        if len(xs)==0: continue
        lo,hi = xs.min(), xs.max()
        for x in range(max(x0,lo+2), min(x1,hi-4)+1):
            p = fr[y,x]
            if p[3]==0: cand[y,x]=True                       # hole inside the silhouette
            elif p[0]<0x16 and p[1]<0x16:
                if filled[y-1,x] and filled[y+1,x] and filled[y,x-1] and filled[y,x+1]: cand[y,x]=True   # dark interior pixel
    lab,n = ndi.label(cand, structure=np.ones((3,3)))
    if n==0: return None
    sizes = ndi.sum(cand,lab,range(1,n+1)); k = int(np.argmax(sizes))+1
    blob = lab==k
    if blob.sum()<8: return None
    return blob

def set_badge(fr, state):
    """state: 'off' (dark patch, grey core) or 'on' (teal neon)"""
    fr = fr.copy()
    blob = badge_blob(fr)
    if blob is None: return fr
    er = ndi.binary_erosion(blob, structure=np.ones((3,3)))
    border = blob & ~er
    fr[border] = [*DARK_OUT,255]
    if state=='on':
        ys,xs = np.where(er)
        for j,(y,x) in enumerate(zip(ys,xs)): fr[y,x] = [*ON[(x+y)%2],255]
        er2 = ndi.binary_erosion(er, structure=np.ones((3,3)))
        fr[er2] = [*CORE,255]
    else:
        fr[er] = [*BADGE_OFF,255]
    return fr

ANCHOR = (77,38)   # badge centre on the rest body (same in every rest-body pixler frame measured)
STAMP = [".XXX.",
         "XOOOX",
         "XOCOX",
         "XOOOX",
         ".XXX."]

def stamp_badge(fr, state, anchor=ANCHOR):
    """fixed 5x5 emblem: X dark outline, O teal/grey, C neon core/grey"""
    fr = fr.copy(); cx,cy = anchor
    for j,row in enumerate(STAMP):
        for i,ch in enumerate(row):
            if ch=='.': continue
            x,y = cx-2+i, cy-2+j
            if ch=='X': col = DARK_OUT
            elif state=='on': col = CORE if ch=='C' else ON[(x+y)%2]
            else: col = BADGE_OFF
            fr[y,x] = [*col,255]
    return fr
