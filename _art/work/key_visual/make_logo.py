import numpy as np, sys
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
src=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
R,G,B=src[...,0],src[...,1],src[...,2]
white=(np.minimum(np.minimum(R,G),B)>175)
navy=(np.maximum(np.maximum(R,G),B)<115)&(B>=R-5)
teal=(G>140)&(R<140)&(B>130)&(G>R+50)
# letter band = bbox of the big white components (the letters)
lw,nw=ndi.label(white); sw=ndi.sum(white,lw,range(1,nw+1))
big=np.zeros(nw+1,bool); big[1:]=sw>20000
ys,xs=np.where(big[lw]); lx0,lx1,ly0,ly1=xs.min(),xs.max(),ys.min(),ys.max()
lab,n=ndi.label(teal); idx=range(1,n+1)
sizes=ndi.sum(teal,lab,idx); cents=ndi.center_of_mass(teal,lab,idx)
keep=np.zeros(n+1,bool)
for i,(s,(cy,cx)) in enumerate(zip(sizes,cents),start=1):
    inside=(lx0<=cx<=lx1) and (ly0<=cy<=ly1)
    keep[i]=(150<s<6000) and not inside          # particles yes, glow pockets between/inside letters no
teal_p=keep[lab]
fg=ndi.binary_opening(white|navy|teal_p,iterations=1)
al=np.array(Image.fromarray((fg*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)/255
inks=[np.array([241,239,232]),np.array([14,16,40]),np.array([63,208,201])]
d=np.stack([((src-v)**2).sum(-1) for v in inks],-1); nearest=np.argmin(d,-1)
col=np.array(inks,dtype=np.float32)[nearest]
col[white]=inks[0]; col[navy]=inks[1]; col[teal_p]=inks[2]
h,w=fg.shape
x0=int(w*0.58); m=np.zeros((h,w),np.float32); m[:,x0:]=(white|teal_p)[:,x0:]
m*=np.clip((np.arange(w)-x0)/(w*0.12),0,1)[None,:]
glow=np.array(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(70))).astype(np.float32)/255
glow=np.clip(glow*1.6,0,0.55)
oa=al+glow*(1-al)
oc=(col*al[...,None]+inks[2][None,None,:]*glow[...,None]*(1-al[...,None]))/np.maximum(oa,1e-4)[...,None]
im=Image.fromarray(np.dstack([oc.clip(0,255),oa*255]).astype(np.uint8),'RGBA')
bb=im.getchannel('A').point(lambda v:255 if v>8 else 0).getbbox()
im=im.crop((max(0,bb[0]-10),max(0,bb[1]-10),min(w,bb[2]+10),min(h,bb[3]+10)))
im.save(sys.argv[2]); print(im.size)
