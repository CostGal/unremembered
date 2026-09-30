// npm run budget — download size check of the built game (run after
// `npm run build`). Download = gzip size for text files (GitHub Pages
// compresses them) and file size for everything else.
// Fails if the current build is over the budget (CLAUDE.md: < 8 MB total).
// Also projects the total with the art/music that is still coming, and flags
// what would push it over.
//
//   npm run budget [-- --cutscene-mb 2.5 --music-mb 6]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { root } from './lib/harness.mjs';

const BUDGET_MB = 8;
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
// Still to come (defaults from the batch brief): cutscene JPGs + music tracks.
const COMING = { 'cutscene art (JPG)': opt('cutscene-mb', 2.5), 'music (5 tracks)': opt('music-mb', 6) };
const TEXT = new Set(['.js', '.html', '.css', '.json', '.txt', '.svg', '.mjs']);
const MB = 1024 * 1024;
const mb = (b) => `${(b / MB).toFixed(2)} MB`;

const dist = join(root, 'dist');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const raw = statSync(p).size;
      const download = TEXT.has(extname(p)) ? gzipSync(readFileSync(p)).length : raw;
      files.push({ path: relative(dist, p), raw, download });
    }
  }
};
try {
  walk(dist);
} catch (err) {
  console.error('No dist/ — run `npm run build` first.');
  process.exit(1);
}

const total = files.reduce((s, f) => s + f.download, 0);
const byDir = {};
for (const f of files) {
  const dir = f.path.split('/').slice(0, -1).join('/') || '.';
  byDir[dir] = (byDir[dir] || 0) + f.download;
}
// Before Title can take a tap: the page, the JS, the font and the title art.
const firstLoad = files.filter((f) => /^(index\.html|assets\/index-.*\.js|fonts\/.*\.woff2|assets\/ui\/)/.test(f.path)).reduce((s, f) => s + f.download, 0);

console.log(`dist/: ${files.length} files, download ${mb(total)} (raw ${mb(files.reduce((s, f) => s + f.raw, 0))})`);
console.log(`first load before Title: ${mb(firstLoad)}\n`);
console.log('largest files (download):');
for (const f of [...files].sort((a, b) => b.download - a.download).slice(0, 10)) {
  console.log(`  ${mb(f.download).padStart(9)}  ${f.path}`);
}
console.log('\nby folder:');
for (const [dir, size] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) console.log(`  ${mb(size).padStart(9)}  ${dir}`);

// Registered in assets.json but not delivered yet (cutscene art is in COMING):
// estimated at the average size of what that section already has.
const manifest = JSON.parse(readFileSync(join(root, 'src/data/assets.json'), 'utf8'));
for (const section of ['portraits', 'backgrounds', 'sprites', 'ui']) {
  const entries = Object.values(manifest[section] || {});
  const have = entries.map((e) => files.find((f) => f.path === `assets/${e.file}`)).filter(Boolean);
  const missing = entries.length - have.length;
  if (!missing) continue;
  const avg = have.length ? have.reduce((s, f) => s + f.download, 0) / have.length : 0.15 * MB;
  COMING[`${missing} ${section} not delivered yet (est.)`] = (missing * avg) / MB;
}
const coming = Object.values(COMING).reduce((s, v) => s + v, 0) * MB;
const projected = total + coming;
console.log('\nprojection:');
for (const [what, size] of Object.entries(COMING)) console.log(`  + ${size.toFixed(2)} MB  ${what}`);
console.log(`  = ${mb(projected)} of ${BUDGET_MB} MB  (${projected > BUDGET_MB * MB ? `OVER by ${mb(projected - BUDGET_MB * MB)}` : `${mb(BUDGET_MB * MB - projected)} left`})`);
if (projected > BUDGET_MB * MB) {
  const room = BUDGET_MB * MB - total;
  console.log(`  ! The art/music still to come would push the total over ${BUDGET_MB} MB.`);
  console.log(`    Room left for everything still to come: ${mb(Math.max(0, room))}. Biggest levers:`);
  console.log('    - music: 5 loops at 96 kbps mono ≈ 0.7 MB/min; aim for ≤ 3 MB total');
  console.log('    - cutscene JPGs: 360×360 display, quality ~75 ≈ 40–70 KB each');
  console.log('    - portraits: PNG → WebP/JPG-with-key or palette PNG (currently the largest folder)');
}

if (total > BUDGET_MB * MB) {
  console.error(`\n✗ current build is ${mb(total)} > ${BUDGET_MB} MB`);
  process.exit(1);
}
console.log(`\n✓ current build ${mb(total)} ≤ ${BUDGET_MB} MB`);
