# baton.py - remove pixler's baton from a keyframe, find grip + angle, redraw the canonical baton
import numpy as np
from scipy import ndimage as ndi
from common import *

SHAFT = (1,0,1); TIP = [(212,214,219),(235,237,241),(235,237,241),(242,248,247)]
GRIP = [(37,35,53),(54,50,68)]   # wrapped grip bands (palette colours), first 8 px above the fist
LEN = 39; THICK = 4

def find_pixler_baton(fr):
    a = fr[:,:,3]>0
    opened = ndi.binary_opening(a, structure=np.ones((5,5),bool))
    thin = a & ~opened
    lab, n = ndi.label(thin, structure=np.ones((3,3)))
    best=None
    for k in range(1,n+1):
        m = lab==k
        if m.sum()<25: continue
        cols = fr[m][:,:3]
        dark = (cols.max(axis=1)<60).mean()
        if dark<0.4: continue
        if best is None or m.sum()>best.sum(): best=m
    return best

def grip_and_dir(fr, m):
    """grip = baton end closest to the body core; dir = unit vector grip->tip"""
    ys,xs = np.where(m); pts=np.stack([xs,ys],1).astype(float)
    c=pts.mean(0); u,s,vt=np.linalg.svd(pts-c); d=vt[0]
    proj=(pts-c)@d; p0=c+d*proj.min(); p1=c+d*proj.max()
    a = fr[:,:,3]>0
    body = ndi.binary_opening(a, structure=np.ones((5,5),bool))
    dist = ndi.distance_transform_edt(~body)
    def dd(p):
        y=min(max(int(round(p[1])),0),127); x=min(max(int(round(p[0])),0),127)
        return dist[y,x]
    if dd(p0) <= dd(p1): grip,tip=p0,p1
    else: grip,tip=p1,p0
    v=tip-grip; v/=np.linalg.norm(v)
    return grip, v

def draw_baton(canvas, grip, v, length=LEN, back=3):
    """procedural baton: thick line from grip (minus 'back' px into the glove) along v."""
    out=canvas.copy(); n=np.array([-v[1],v[0]])
    total=length+back
    for t in np.arange(-back, length+0.01, 0.5):
        for w in np.arange(-(THICK-1)/2,(THICK-1)/2+0.01,0.5):
            p=grip+v*t+n*w; x=int(round(p[0])); y=int(round(p[1]))
            if 0<=x<128 and 0<=y<128:
                k=int(length-t)
                if k<4: col = TIP[min(k,len(TIP)-1)]
                elif 0<=t<8: col = GRIP[int(t)//2 % 2]
                else: col = SHAFT
                out[y,x]=[*col,255]
    return out

def strip_baton(fr):
    m=find_pixler_baton(fr); out=fr.copy(); out[m]=0
    # despeckle leftovers touching the baton: pixels isolated after removal
    a=out[:,:,3]>0
    lab,n=ndi.label(a, structure=np.ones((3,3)))
    sizes=ndi.sum(a,lab,range(1,n+1))
    for k,s in enumerate(sizes,1):
        if s<6: out[lab==k]=0
    return out, m
