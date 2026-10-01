# build_all.py — regenerates the whole Dov set, writes dov_animations.json + dov_rest.png,
# runs the delivery checks (ANIMATION.md §8) and zips sheets + GIFs + JSON + scripts.
import json, shutil, os, glob
from common import *
import idle, attack, cast, death, victory, hurt, brace_parry, dodge

anims = {}


def add(name, frames, dur, **extra):
    assert len(frames) == len(dur), name
    save_sheet(name, frames); save_gif(name, frames, dur)
    anims[name] = {'frames': len(frames), 'sheet': f'{CHAR}_{name}.png', 'durations_ms': dur,
                   'loop': extra.pop('loop', False), **extra}
    return frames


# rest
REST.save(f'{OUT}/{CHAR}_rest.png')

f = idle.build();                add('idle', f, idle.DURATIONS, loop=True)
f, d = attack.build();           add('attack', f, d, windupFrame=attack.WINDUP, impactFrames=attack.IMPACT)
loop, cin, cout = cast.build()
add('cast', loop, cast.LOOP_DUR, loop=True); add('cast_in', cin, cast.IN_DUR); add('cast_out', cout, cast.OUT_DUR)
loop, bin_, bout, pf, pd = brace_parry.build()
add('brace', loop, brace_parry.BRACE_DUR, loop=True)
add('brace_in', bin_, brace_parry.IN_DUR); add('brace_out', bout, brace_parry.OUT_DUR)
add('parry', pf, pd, holdFrame=brace_parry.PARRY_HOLD, impactFrames=brace_parry.PARRY_IMPACT)
f, d = death.build();            add('death', f, d, holdLastFrame=True)
f, d = victory.build();          add('victory', f, d, holdLastFrame=True)
f, d = hurt.build();             add('hurt', f, d)
f, d = dodge.build();            add('dodge', f, d, holdFrame=dodge.HOLD)

write_json(anims)

# ---- delivery checks (script, not eye)
J = json.load(open(f'{OUT}/{CHAR}_animations.json'))
rest = Image.open(f'{OUT}/{CHAR}_rest.png').convert('RGBA')
report = []
for name, a in J['animations'].items():
    sh = Image.open(f"{OUT}/{a['sheet']}").convert('RGBA')
    n = sh.width // W
    assert sh.height == H and n == a['frames'] == len(a['durations_ms']), name
    frs = [sh.crop((i * W, 0, (i + 1) * W, H)) for i in range(n)]
    for fr in frs:
        assert_frame(fr, SHEET_PALETTE)
        assert components(fr) == 1, name
    held = a.get('holdLastFrame', False)
    if not a['loop'] and not name.endswith(('_in', '_out')):
        assert diff_px(frs[0], rest) == 0, name + ' first != rest'
        assert held or diff_px(frs[-1], rest) == 0, name + ' last != rest'
    if name.endswith('_in'):
        loop0 = Image.open(f"{OUT}/{CHAR}_{name[:-3]}.png").convert('RGBA').crop((0, 0, W, H))
        assert diff_px(frs[0], rest) == 0 and diff_px(frs[-1], loop0) == 0, name
    if name.endswith('_out'):
        loop0 = Image.open(f"{OUT}/{CHAR}_{name[:-4]}.png").convert('RGBA').crop((0, 0, W, H))
        assert diff_px(frs[0], loop0) == 0 and diff_px(frs[-1], rest) == 0, name
    report.append(f"{name:10s} {n:2d} frames {sum(a['durations_ms']):5d} ms  OK")
# parry hold == brace loop0
b0 = Image.open(f'{OUT}/{CHAR}_brace.png').convert('RGBA').crop((0, 0, W, H))
p = Image.open(f'{OUT}/{CHAR}_parry.png').convert('RGBA')
h = J['animations']['parry']['holdFrame']
assert diff_px(p.crop((h * W, 0, (h + 1) * W, H)), b0) == 0
report.append('parry holdFrame == brace loop0  OK')
print('\n'.join(report))

# ---- zip
Z = f'{OUT}/zip'; shutil.rmtree(Z, ignore_errors=True); os.makedirs(Z)
for p in glob.glob(f'{OUT}/{CHAR}_*.png') + glob.glob(f'{OUT}/{CHAR}_*.gif') + [f'{OUT}/{CHAR}_animations.json']:
    shutil.copy(p, Z)
os.makedirs(f'{Z}/scripts')
for p in glob.glob('/home/claude/dov/*.py'):
    shutil.copy(p, f'{Z}/scripts')
shutil.make_archive(f'{OUT}/{CHAR}_animations', 'zip', Z)
print('zip', os.path.getsize(f'{OUT}/{CHAR}_animations.zip'))
