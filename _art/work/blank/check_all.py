# check_all.py — regenerate everything, export blank_rest.png, verify every sheet against the
# JSON (palette-only, alpha 0/255, 1 component, ground, frames == durations, rest in/out), zip.
import json, subprocess, zipfile, os, shutil
import numpy as np
from PIL import Image
from common import *

HERE = os.path.dirname(os.path.abspath(__file__))
for s in ['anim_idle.py', 'anim_punch.py', 'anim_lunge.py', 'anim_hurt.py', 'anim_death.py']:
    subprocess.run(['python3', f'{HERE}/{s}'], check=True)

Image.fromarray(REST).save(f'{OUTDIR}/blank_rest.png')          # original art, flipped, no weapon/emblem
rest = np.array(Image.open(f'{OUTDIR}/blank_rest.png').convert('RGBA'))
assert (rest == REST).all()

data = json.load(open(f'{OUTDIR}/blank_animations.json'))
assert data['frame_size'] == [FS, FS] and data['facing'] == 'left'
AIR = {'lunge': {4}, 'death': {4}}
report = []
for name, a in data['animations'].items():
    sheet = np.array(Image.open(f"{OUTDIR}/{a['sheet']}").convert('RGBA'))
    assert sheet.shape[0] == FS and sheet.shape[1] == FS * a['frames'], name
    frames = [sheet[:, i*FS:(i+1)*FS] for i in range(a['frames'])]
    assert len(a['durations_ms']) == a['frames'], (name, 'durations')
    check_frames(frames, name, rest_in_out=False, airborne=AIR.get(name, set()))
    assert (frames[0] == REST).all(), (name, 'frame 0 != rest')
    if not a.get('loop') and not a.get('holdLastFrame'):
        assert (frames[-1] == REST).all(), (name, 'last != rest')
    if name in ('punch', 'lunge'):
        assert 'windupFrame' in a and a['impactFrames'], (name, 'enemy attack needs windup+impact')
    assert os.path.exists(f'{OUTDIR}/blank_{name}.gif')
    report.append(f"{name:6s} {a['frames']:2d} frames {sum(a['durations_ms']):5d} ms  "
                  f"loop={a.get('loop')} windup={a.get('windupFrame')} impact={a.get('impactFrames')} hold={a.get('holdLastFrame')}")
print('\n'.join(report)); print('ALL CHECKS OK')

for s in ['rig.py', 'common.py', 'check_all.py']:
    shutil.copy(f'{HERE}/{s}', OUTDIR)
with zipfile.ZipFile(f'{OUTDIR}/blank_animations.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(OUTDIR)):
        if f.endswith(('.png', '.gif', '.json', '.py')) and not f.endswith('_review_4x.png') \
           and f not in ('rig_overlay_6x.png', 'sources_flipped_2x.png'):
            z.write(f'{OUTDIR}/{f}', f)
    print('zip:', z.namelist())
