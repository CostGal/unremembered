"""Regenerate every Hollow sheet, write hollow_animations.json, run checks, zip the delivery."""
from common import *
from rig import REST
import idle, claw, hurt, death, siphon, json, zipfile, shutil

pal = palette()
anims = {}
def add(name, frames, durs, loop=False, **extra):
    check(frames, durs, pal, rest=None if (loop or extra.get('holdLastFrame')) else REST, loop=loop, name=name)
    if extra.get('holdLastFrame'): assert np.array_equal(frames[0], REST)
    save_png(to_sheet(frames), f'{OUT}/hollow_{name}.png')
    save_gif(frames, durs, f'{OUT}/hollow_{name}.gif')
    anims[name] = {'frames': len(frames), 'sheet': f'hollow_{name}.png', 'durations_ms': durs, 'loop': loop, **extra}

add('idle', idle.build(), idle.DURS, loop=True)
add('claw', claw.build(), claw.DURS, windupFrame=claw.WINDUP, impactFrames=[claw.IMPACT])
add('hurt', hurt.build(), hurt.DURS)
add('death', death.build(), death.DURS, holdLastFrame=True)
add('siphon', siphon.build(), siphon.DURS, windupFrame=siphon.WINDUP, holdFrame=siphon.HOLD,
    impactFrames=[siphon.IMPACT], projectile='hollow_siphon_fx.png', spawn_px=list(siphon.CRYSTAL),
    projectile_frames=siphon.FX_N, projectile_durations_ms=siphon.FX_DURS, projectile_loop=True,
    projectile_note='particle stream flows from the target (-x) INTO spawn_px; play while holdFrame is held')
fx = siphon.build_fx(); save_png(to_sheet(fx), f'{OUT}/hollow_siphon_fx.png')
save_png(REST, f'{OUT}/hollow_rest.png')
assert np.array_equal(np.array(Image.open(f'{OUT}/hollow_rest.png').convert('RGBA')), REST)

meta = {'frame_size': [128, 128], 'facing': 'left', 'fx_colors': ['#3fd0c9'], 'float_line_y': 114,
        'rest': 'hollow_rest.png', 'animations': anims}
json.dump(meta, open(f'{OUT}/hollow_animations.json', 'w'), indent=2)

with zipfile.ZipFile(f'{OUT}/hollow_animations.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for n in ['hollow_rest.png', 'hollow_animations.json', 'hollow_siphon_fx.png', 'hollow_siphon_fx_preview.gif',
              'hollow_rig_overlay_4x.png'] + [f'hollow_{a}.{e}' for a in anims for e in ('png', 'gif')]:
        z.write(f'{OUT}/{n}', n)
    for s in ['common.py', 'rig.py', 'idle.py', 'claw.py', 'hurt.py', 'death.py', 'siphon.py', 'build_all.py']:
        z.write(s, f'scripts/{s}')
print('zip written')
