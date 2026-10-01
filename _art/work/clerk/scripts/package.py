# package.py — rest export, clerk_animations.json, full script check, zip
import json, glob, os, zipfile
from common import *
from rig import REST
from scipy import ndimage

Image.fromarray(up2(REST)).save(f'{OUT}/clerk_rest.png')

# union palette of every source sheet + FX
names = ['clerk','clerk_idle','clerk_raise_fist','clerk_attack','clerk_pages','clerk_write','clerk_present',
         'clerk_overhead_kick','clerk_ledger_guard','clerk_dash','clerk_death']
PAL = set()
for n in names: PAL |= palette_of(load_sheet(n))
PALFX = PAL | set(FX.values())
FXSET = set(FX.values())

anims = {}
order = ['idle','stamp','file_away','redact','archive_charge_in','archive_charge','archive_charge_out',
         'archive_release','hurt','death','parry','dodge']
for a in order:
    meta = json.load(open(f'{OUT}/_{a}.json'))
    sheet = np.array(Image.open(f"{OUT}/{meta['sheet']}").convert('RGBA'))
    n = sheet.shape[1] // F
    assert n == meta['frames'] == len(meta['durations_ms']), (a, n, meta['frames'])
    frames = [sheet[:, i*F:(i+1)*F] for i in range(n)]
    rest2 = up2(REST)
    for i, f in enumerate(frames):
        assert f.shape == (F, F, 4)
        assert set(np.unique(f[..., 3])) <= {0, 255}, (a, i, 'alpha')
        cols = set(map(tuple, f[f[..., 3] > 0][..., :3]))
        assert cols <= PALFX, (a, i, 'palette', list(cols - PALFX)[:3])
        assert (f.reshape(N, 2, N, 2, 4) == f.reshape(N, 2, N, 2, 4)[:, :1, :, :1]).all(), (a, i, '2x grid')
        ys = np.where(f[..., 3] > 0)[0]; assert ys.max() == 241, (a, i, 'ground', ys.max())
        # one connected component without FX pixels
        isfx = np.zeros((F, F), bool)
        for c in FXSET: isfx |= (f[..., :3] == c).all(-1) & (f[..., 3] > 0)
        body = (f[..., 3] > 0) & ~isfx
        lab, ncomp = ndimage.label(body, structure=np.ones((3, 3)))
        sizes = ndimage.sum(body, lab, range(1, ncomp + 1))
        # extra components are allowed only if they were cut off by FX drawn over the sprite (they touch FX)
        fxd = ndimage.binary_dilation(isfx, structure=np.ones((3, 3)))
        big = [k + 1 for k, sz in enumerate(sizes) if sz > 8]
        main = int(np.argmax(sizes)) + 1
        stray = [k for k in big if k != main and not (fxd & (lab == k)).any()]
        assert not stray, (a, i, 'stray components', len(stray))
    if not meta['loop'] and not a.endswith('_in') and not a.endswith('_out'):
        assert np.array_equal(frames[0], rest2), (a, 'rest in')
        if not meta.get('holdLastFrame'): assert np.array_equal(frames[-1], rest2), (a, 'rest out')
    anims[a] = {k: v for k, v in meta.items()}
# in/out == loop0
sh = lambda nm: np.array(Image.open(f'{OUT}/clerk_{nm}.png').convert('RGBA'))
assert np.array_equal(sh('archive_charge_in')[:, -F:], sh('archive_charge')[:, :F])
assert np.array_equal(sh('archive_charge_out')[:, :F], sh('archive_charge')[:, :F])
anims['archive_charge']['in'] = 'archive_charge_in'; anims['archive_charge']['out'] = 'archive_charge_out'

doc = {'frame_size': [F, F], 'facing': 'left', 'faces': 'left', 'rest': 'clerk_rest.png',
       'fx_colors': ['#3fd0c9', '#f1efe8'], 'animations': anims}
json.dump(doc, open(f'{OUT}/clerk_animations.json', 'w'), indent=1)

with zipfile.ZipFile(f'{OUT}/clerk_animations.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(glob.glob(f'{OUT}/clerk_*.png') + glob.glob(f'{OUT}/clerk_*.gif') + [f'{OUT}/clerk_animations.json']):
        if '_contact' in p or 'rig_overlay' in p or 'stamp_preview' in p: continue
        z.write(p, os.path.basename(p))
    for p in sorted(glob.glob('/home/claude/clerk/*.py')):
        z.write(p, 'scripts/' + os.path.basename(p))
print('all checks passed;', len(anims), 'animations; palette', len(PAL), '+FX')
