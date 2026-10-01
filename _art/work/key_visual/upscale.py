import numpy as np, onnxruntime as ort, time, sys
from PIL import Image
so=ort.SessionOptions(); so.intra_op_num_threads=1
s=ort.InferenceSession('animev3.onnx',so,providers=['CPUExecutionProvider'])
im=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)/255
H,W,_=im.shape; T=192; P=12; OUT=2
canvas=Image.new('RGB',(W*OUT,H*OUT))
t0=time.time(); n=0
for y in range(0,H,T):
    for x in range(0,W,T):
        ya,yb=max(0,y-P),min(H,y+T+P); xa,xb=max(0,x-P),min(W,x+T+P)
        tile=im[ya:yb,xa:xb].transpose(2,0,1)[None]
        o=s.run(None,{'x':tile})[0][0].transpose(1,2,0)
        cy0=(y-ya)*4; cx0=(x-xa)*4; th=min(T,H-y)*4; tw=min(T,W-x)*4
        o=o[cy0:cy0+th,cx0:cx0+tw]
        t=Image.fromarray((o.clip(0,1)*255+0.5).astype(np.uint8)).resize((tw//2,th//2),Image.LANCZOS)
        canvas.paste(t,(x*OUT,y*OUT)); n+=1
print('tiles',n,'sec',round(time.time()-t0,1))
canvas.save(sys.argv[2])
