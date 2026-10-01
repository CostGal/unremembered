"""Static asset audit: every assets.json entry exists and has the declared size,
size caps (portraits <=100 KB, cutscene <=1.5 MB, title art <=250 KB), sprite
sheets referenced by *_animations.json exist, nothing in public/assets is
unreferenced. Run from the repo root: python scripts/qa/assets_check.py"""
import json, os, glob
from PIL import Image
root = 'public/assets'
m = json.load(open('src/data/assets.json', encoding='utf8'))
missing, mismatched, refs = [], [], set()
for section in ('sprites', 'portraits', 'backgrounds', 'ui', 'cutscene'):
    for key, d in m[section].items():
        p = os.path.join(root, d['file']); refs.add(os.path.normpath(p))
        if not os.path.exists(p):
            missing.append((section, key, d['file'], 'optional' if d.get('optional') else 'PLACEHOLDER')); continue
        w, h = Image.open(p).size
        if (w, h) != (d['w'], d['h']): mismatched.append((key, (w, h), (d['w'], d['h'])))
print('missing:', missing)
print('size mismatches:', mismatched)
for f in glob.glob(root + '/sprites/*_animations.json'):
    j = json.load(open(f))
    for a in j['animations'].values(): refs.add(os.path.normpath(os.path.join(root, 'sprites', a['sheet'])))
    refs.add(os.path.normpath(f))
    if j.get('rest'): refs.add(os.path.normpath(os.path.join(root, 'sprites', j['rest'])))
    c = os.path.basename(f).replace('_animations.json', '')
    refs.add(os.path.normpath(os.path.join(root, 'sprites', c + '_rest.png')))
unref = []
for d, _, fs in os.walk(root):
    for f in fs:
        p = os.path.normpath(os.path.join(d, f))
        if p not in refs: unref.append(p)
print('unreferenced files:', unref)
big = [(os.path.getsize(p) // 1024, p) for p in glob.glob(root + '/portraits/*.png') if os.path.getsize(p) > 100 * 1024]
print('portraits > 100 KB:', big, ' largest portrait KB:', max(os.path.getsize(p) for p in glob.glob(root + '/portraits/*.png')) // 1024)
cut = sum(os.path.getsize(p) for p in glob.glob(root + '/cutscene/*'))
print('cutscene total MB: %.2f (cap 1.5)' % (cut / 1048576))
title = sum(os.path.getsize(os.path.join(root, m['ui'][k]['file'])) for k in ('logo', 'title_bg') if os.path.exists(os.path.join(root, m['ui'][k]['file'])))
print('title art KB:', title // 1024, '(cap 250)')
mus = glob.glob(root + '/audio/**/*.mp3', recursive=True)
print('music files:', mus, 'MB: %.2f (cap 3)' % (sum(os.path.getsize(p) for p in mus) / 1048576))
