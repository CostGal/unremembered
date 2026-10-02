import Phaser from 'phaser';
import manifest from '../data/assets.json';
import allies from '../data/allies.json';
import animSpecs from '../data/animSpecs.json';
import characters from '../data/characters.json';
import enemies from '../data/enemies.json';
import { finishSection, sectionEntries } from '../systems/Assets.js';
import { prefetchMusic } from '../systems/Audio.js';
import { devParam } from '../systems/DevParams.js';
import { applyFakeSheets } from '../systems/FakeSheets.js';
import { buildAnimations, fetchAnimationSets, queueSheets } from '../systems/SpriteAnims.js';

const cfg = manifest.loading;

// Runs for the whole game, invisible, next to whatever scene is on screen.
// Loads one manifest section at a time: first the ones a scene is waiting
// for (request), then the rest in loading.background order, then prefetches
// the music. Textures and animations are global, so every scene sees them.
export default class LoaderScene extends Phaser.Scene {
  constructor() {
    super('Loader');
    this.done = new Set();
    this.queue = [...cfg.background];
    this.waiters = [];
    this.busy = false;
    this.started = false;
  }

  create() {
    this.started = true;
    this.pump();
  }

  isReady(sections) {
    return this.expand(sections).every((s) => this.done.has(s));
  }

  // Loads these sections next (before the background ones). Resolves when all are in.
  request(sections) {
    const wanted = this.expand(sections).filter((s) => !this.done.has(s));
    if (!wanted.length) return Promise.resolve();
    this.queue = [...wanted, ...this.queue.filter((s) => !wanted.includes(s))];
    const promise = new Promise((resolve) => this.waiters.push({ sections: wanted, resolve }));
    this.pump();
    return promise;
  }

  // A section's dependencies come first (sheet placeholders draw the body sprites).
  expand(sections) {
    const out = [];
    const add = (s) => {
      for (const dep of cfg.deps[s] || []) add(dep);
      if (!out.includes(s)) out.push(s);
    };
    sections.forEach(add);
    return out;
  }

  pump() {
    if (!this.started || this.busy) return;
    this.queue = this.queue.filter((s) => !this.done.has(s));
    const next = this.queue.shift();
    if (!next) {
      if (!this.prefetched) {
        this.prefetched = true;
        prefetchMusic();
      }
      return;
    }
    const missingDep = (cfg.deps[next] || []).find((d) => !this.done.has(d));
    if (missingDep) {
      this.queue.unshift(missingDep, next);
      this.pump();
      return;
    }

    this.busy = true;
    // A section that throws (a sheet JSON with the wrong shape, a bad texture)
    // is logged and counted as done: the game goes on with whatever loaded,
    // instead of every scene waiting on "Loading…" forever.
    this.loadSection(next)
      .catch((err) => console.error(`loader: section ${next} failed`, err))
      .then(() => {
        this.done.add(next);
        this.busy = false;
        this.waiters = this.waiters.filter((w) => {
          if (!w.sections.every((s) => this.done.has(s))) return true;
          w.resolve();
          return false;
        });
        this.pump();
      });
  }

  async loadSection(section) {
    if (section === 'sheets') {
      // <id>_animations.json per character (missing = that character uses its rig).
      const ids = [...Object.keys(characters), ...Object.keys(enemies), ...Object.keys(allies)];
      this.registry.set('animationSets', await fetchAnimationSets(ids));
    }
    return new Promise((resolve) => {
      if (section === 'sheets') {
        queueSheets(this.load, this.registry.get('animationSets'));
      } else {
        for (const [key, def] of Object.entries(sectionEntries(section))) {
          if (!this.textures.exists(key)) this.load.image(key, `assets/${def.file}`);
        }
      }
      const finish = () => {
        try {
          this.finish(section);
        } catch (err) {
          console.error(`loader: finishing section ${section} failed`, err);
        }
        resolve();
      };
      if (this.load.list.size === 0) {
        finish();
        return;
      }
      this.load.once(Phaser.Loader.Events.COMPLETE, finish);
      this.load.start();
    });
  }

  finish(section) {
    if (section !== 'sheets') {
      finishSection(this, section);
      return;
    }
    const sets = this.registry.get('animationSets') || {};
    const bodyDefs = { ...characters, ...enemies, ...allies };
    // ?fakesheets=1: stand-in sheets for every animation that has no file yet.
    if (devParam('fakesheets') === '1') {
      const facesRight = new Set([...Object.keys(characters), ...Object.keys(allies)]);
      applyFakeSheets(this, sets, animSpecs, bodyDefs, manifest, facesRight);
      this.registry.set('animationSets', sets);
    }
    buildAnimations(this, sets, bodyDefs);
  }
}
