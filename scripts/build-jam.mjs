// npm run build:jam — the anonymous build for the game-jam site (see vite.jam.config.js).
//   1. vite build -c vite.jam.config.js            -> dist-jam/
//   2. scripts/jam-thumb.py                        -> dist-jam/thumb.jpg (1280x720)
//   3. dist-jam/README-JAM.txt
//   4. zip of the CONTENTS of dist-jam (index.html + thumb.jpg at the zip root)
// The zip goes to JAM_ZIP_DIR, or <repo>/dist-jam-zip (git-ignored).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-jam');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

run('npx', ['vite', 'build', '-c', 'vite.jam.config.js']);

// Files that are not part of the game (and carry names / links): not shipped.
for (const f of ['manifest.webmanifest', 'fonts/FONTS.txt', 'README.md']) rmSync(join(out, f), { force: true });

run('python3', [join(root, 'scripts/jam-thumb.py'), join(out, 'thumb.jpg')]);

writeFileSync(
  join(out, 'README-JAM.txt'),
  `Unremembered - game jam build (portrait, touch)

Static files: serve this folder with any web server and open index.html
(it does not work from file:// because the browser blocks module scripts there).
thumb.jpg is the 1280x720 thumbnail.

Embedding: the iframe should carry  allow="autoplay; fullscreen"  so the sound
starts on the player's first tap. The game has no fullscreen button of its own
and opens no new tabs. UI is kept clear of the top-right 60x60 px corner (the
host page's button).
`
);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const zipDir = process.env.JAM_ZIP_DIR || join(root, 'dist-jam-zip');
mkdirSync(zipDir, { recursive: true });
const zip = join(zipDir, `unremembered-jam-${stamp}.zip`);
if (existsSync(zip)) rmSync(zip);
run('zip', ['-r', '-X', '-q', zip, '.'], { cwd: out });
console.log(`zip: ${zip} (${(statSync(zip).size / 1048576).toFixed(2)} MB)`);
