# cast.py - Rhea "Recollection / Echo": looping channel. Pose = cast keyframe f4 (baton raised), aura = FX layer only
# (#3fd0c9 teal, #f1efe8 white): rising motes + echo arcs from the blade tip. Sprite colours never recoloured.
import numpy as np, json, math
from scipy import ndimage as ndi
from common import *
from rig import build_rig
from baton import draw_baton
from badge import stamp_badge
from attack import erase_box, despeckle
from blast import unglow

S = frames_of(load(UP+'rhea_cast.png'))
TEAL = (0x3f,0xd0,0xc9); WHITE = (0xf1,0xef,0xe8)
N = 8
GRIP = np.array((42.0,40.0)); DIR = np.array((-0.70,-0.71)); DIR/=np.linalg.norm(DIR)
TIP = GRIP + DIR*39

def base_pose():
    b = clean(S[4])
    b = erase_box(b, (0,10,39,44,'all'))          # pixler blade + its tip glow
    bm = badge_mask(b); bm[:20]=0; bm[60:]=0; bm[:,:55]=0; bm[:,100:]=0; b[bm]=[*BADGE_OFF,255]
    b = unglow(b); b = despeckle(b, 10)
    b = stamp_badge(b, 'on', (78,38))
    return b

def put(fx, x, y, col):
    x=int(round(x)); y=int(round(y))
    if 0<=x<128 and 0<=y<128: fx[y,x]=[*col,255]

def aura(i, lift):
    fx = np.zeros((128,128,4),np.uint8)
    rng = np.random.RandomState(7)
    # rising motes: fixed columns, phase-offset, loop-seamless (period N)
    for p in range(26):
        x = rng.randint(26, 104); ph = rng.randint(0,N); y0 = rng.randint(40,118); span = 3*N
        t = (i+ph)%N
        y = y0 - 3*t
        col = WHITE if (t==N//2 and p%3==0) else TEAL
        put(fx, x, y, col)
        if p%4==0: put(fx, x+1, y, col)
    # echo arcs from the blade tip, expanding, two waves half a period apart
    cx,cy = TIP[0]-2, TIP[1]-2
    for w in range(2):
        t = (i + w*(N//2)) % N
        r = 2 + 1.6*t + w*0.5
        col = WHITE if t==0 else TEAL
        for a in np.linspace(math.radians(135), math.radians(225), int(6+r*2)):
            put(fx, cx + r*math.cos(a), cy + r*math.sin(a) - lift, col)
    return fx

def make_cast():
    pose = base_pose()
    lift = [0,0,1,1,1,1,0,0]
    frames=[]
    for i in range(N):
        body = pose.copy()
        for k in range(lift[i]): body = insert_row(body, 76+k)
        bat = draw_baton(np.zeros_like(body), GRIP + np.array((0,-lift[i])), DIR)
        fr = over(aura(i, lift[i]), over(bat, body))     # aura behind, baton behind body
        # motes outside the silhouette are visible; add a few in front near the coat hem for depth
        fr = clean(fr); assert_frame(fr); frames.append(fr)
    return frames

if __name__=='__main__':
    fr = make_cast()
    durs = [100]*N
    save_png(sheet(fr), OUT+'rhea_cast.png')
    save_gif(fr, durs, OUT+'rhea_cast.gif', scale=3)
    J=json.load(open(OUT+'rhea_animations.json'))
    J['animations']['cast']={'frames':N,'sheet':'rhea_cast.png','durations_ms':durs,'loop':True}
    json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    print('ok')

# ---- cast_in / cast_out: rest <-> the loop's frame 0, so the game can enter/leave the channel without a cut
def make_cast_in_out(loop_frames):
    from rig import rest_frame
    from blast import keyframe as bkf
    REST = rest_frame()
    c1,_ = bkf('c1')
    r2,_ = bkf('r2'); r2 = stamp_badge(r2, 'on', (77,38))
    cin  = [REST.copy(), c1, r2, loop_frames[0].copy()]
    cout = [loop_frames[0].copy(), r2.copy(), c1.copy(), REST.copy()]
    for f in cin+cout: assert_frame(f)
    return cin, cout

if __name__=='__main__':
    cin, cout = make_cast_in_out(fr)
    for name,frs,durs in [('cast_in',cin,[80,90,90,100]),('cast_out',cout,[100,90,90,80])]:
        save_png(sheet(frs), OUT+f'rhea_{name}.png'); save_gif(frs, durs, OUT+f'rhea_{name}.gif', scale=3)
        J=json.load(open(OUT+'rhea_animations.json'))
        J['animations'][name]={'frames':4,'sheet':f'rhea_{name}.png','durations_ms':durs,'loop':False}
        json.dump(J,open(OUT+'rhea_animations.json','w'),indent=2)
    print('cast_in/out ok')
