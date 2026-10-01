from rig import *
from PIL import ImageDraw
COL = {'head': (255,210,80), 'hair_tuft': (255,120,0), 'torso': (60,140,255), 'coat': (40,200,120), 'hem': (0,120,60),
       'legs': (170,90,255), 'front_arm': (255,60,60), 'baton': (255,0,160), 'back_arm': (0,230,230), 'bag': (200,140,60)}
S = 4
base = Image.new('RGBA', (W, H), (26, 28, 40, 255)); base.alpha_composite(Image.fromarray(SRC))
ov = np.zeros((H, W, 4), np.uint8)
for k in ['torso','coat','hem','legs','bag','back_arm','head','front_arm']:
    ov[MASKS[k]] = COL[k] + (150,)
for k in ['hair_tuft','baton']:
    ov[MASKS[k]] = COL[k] + (150,)
img = base.copy(); img.alpha_composite(Image.fromarray(ov))
side = Image.new('RGBA', (W*S*2 + 220, H*S), (26,28,40,255))
side.paste(base.resize((W*S, H*S), Image.NEAREST), (0, 0))
side.paste(img.resize((W*S, H*S), Image.NEAREST), (W*S, 0))
d = ImageDraw.Draw(side)
for k, (px, py) in PIVOTS.items():
    cx, cy = W*S + px*S + 2, py*S + 2
    d.rectangle([cx-3, cy-3, cx+3, cy+3], outline=(255,255,255,255))
ys = 10
for k, c in COL.items():
    d.rectangle([W*S*2+10, ys, W*S*2+30, ys+14], fill=c+(255,)); d.text((W*S*2+36, ys+1), k, fill=(230,230,230,255)); ys += 22
d.text((W*S*2+10, ys+10), 'white squares = pivots', fill=(230,230,230,255))
side.save('/home/claude/rhea/out_overlay.png')
# recomposition check
comp = np.zeros((H,W,4),np.uint8)
for k in DRAW_ORDER:
    L = LAYERS[k]; a = L[:,:,3]>0; comp[a]=L[a]
print('recompose identical:', np.array_equal(comp[OP], SRC[OP]), 'extra px:', int(((comp[:,:,3]>0)&~OP).sum()))
