"""Regenerate the whole Nala set: rest, idle, alert(in/loop/out), hiss, JSON, final check, zip."""
import sys, subprocess, shutil, zipfile; sys.path.insert(0, '/home/claude/nala')
from common import *
os.makedirs(f'{OUT}/out', exist_ok=True)
# rest = nala_idle f0 (on the 63-colour sheet palette; closest to every other sheet's f0)
rest = load_sheet('nala_idle')[0]
Image.fromarray(rest).save(f'{OUT}/work/idle0.png'); Image.fromarray(rest).save(f'{OUT}/out/nala_rest.png')
for s in ['rig.py', 'idle.py', 'alert.py', 'hiss.py']:
    subprocess.run([sys.executable, f'{OUT}/{s}'], check=True)
anims = {}
for j in ['idle', 'alert', 'hiss']: anims.update(json.load(open(f'{OUT}/work/{j}.json')))
meta = {'frame_size': [W, W], 'facing': 'left', 'fx_colors': ['#e8883a', '#3fd0c9'], 'rest': 'nala_rest.png', 'animations': anims}
json.dump(meta, open(f'{OUT}/out/nala_animations.json', 'w'), indent=2)

# ---- final script check on the exported sheets ----
pal = sheet_palette(); ok = True
rest_out = np.array(Image.open(f'{OUT}/out/nala_rest.png'))
sheets = {}
for name, a in anims.items():
    sh = np.array(Image.open(f"{OUT}/out/{a['sheet']}").convert('RGBA'))
    fr = [sh[:, i*W:(i+1)*W] for i in range(sh.shape[1] // W)]
    sheets[name] = fr
    assert len(fr) == a['frames'] == len(a['durations_ms']), name
    errs = check(fr, name, pal, None if name in ('alert_in', 'alert_out') else rest_out, loop=a['loop'], durations=a['durations_ms'])
    ok &= not errs
assert diff(sheets['alert_in'][0], rest_out) == 0 and diff(sheets['alert_out'][-1], rest_out) == 0
assert diff(sheets['alert_in'][-1], sheets['alert'][0]) == 0 and diff(sheets['alert_out'][0], sheets['alert'][0]) == 0
assert diff(sheets['idle'][0], rest_out) == 0
print('rest/in/out/loop0 links OK; all checks', 'OK' if ok else 'FAILED')

with zipfile.ZipFile(f'{OUT}/out/nala_animations.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(f'{OUT}/out')):
        if f.endswith(('.png', '.gif', '.json')): z.write(f'{OUT}/out/{f}', f)
    for s in ['common.py', 'rig.py', 'idle.py', 'alert.py', 'hiss.py', 'build_all.py']: z.write(f'{OUT}/{s}', f'scripts/{s}')
print(subprocess.run(['unzip', '-l', f'{OUT}/out/nala_animations.zip'], capture_output=True, text=True).stdout)
