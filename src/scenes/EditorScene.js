import Phaser from 'phaser';
import dialogueSource from '../data/dialogue.json';
import cutsceneSource from '../data/cutscene_origin.json';
import chapter from '../data/chapter1.json';
import assets from '../data/assets.json';
import audioData from '../data/audio.json';
import ui from '../data/ui.json';
import { playSfx } from '../systems/Audio.js';
import * as E from '../systems/Editor.js';

// DEV ONLY: ?editor. Every dialogue line and cutscene shot over its real scene, with the fields
// editable in a plain-DOM sidebar / form (desktop: mouse + keyboard) and a download of the edited
// dialogue.json / cutscene_origin.json. The preview is the game's own DialogueScene (data.preview:
// one line, static) or CutsceneScene (data.preview: one shot, silent), restarted on every edit.
// Nothing is written to the repo; unsaved edits are kept as a draft in this browser's localStorage.
// This module is fetched by PreloadScene only when ?editor is in the URL.
//
// Keys: Alt+Up / Alt+Down = previous / next entry, Alt+R = replay the preview. In the list, the
// arrow keys move the selection.

const DRAFT_KEY = 'unremembered:editor-draft';
const SPLITS = ['none', 'vertical', 'horizontal'];
const MOVES = ['none', 'pan_left', 'pan_right', 'zoom_in', 'zoom_out'];
const SHOT_EDITABLE = ['text', 'bg', 'bg2', 'split', 'move', 'tint', 'fx', 'sfx', 'durationMs'];
const TRANSITIONS = ['close'];
const SENTINEL = { none: '__none', other: '__other', default: '__default', silent: '__silent' };

const clone = (v) => JSON.parse(JSON.stringify(v));
const sfxNames = Object.keys(audioData.sfx);
const portraitKeys = Object.keys(assets.portraits);
const backgroundKeys = Object.keys(assets.backgrounds);
const coverKeys = backgroundKeys.filter((k) => assets.backgrounds[k].cover);
const cutsceneKeys = Object.keys(assets.cutscene);
const styleKeys = Object.keys(ui.dialogue.styles);

const CSS = `
#ed-side,#ed-panel{position:fixed;top:0;bottom:0;z-index:5;box-sizing:border-box;background:#10131d;color:#f1efe8;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;flex-direction:column;user-select:text;-webkit-user-select:text;touch-action:auto}
#ed-side{left:0;width:300px;border-right:1px solid #2a3042}
#ed-panel{right:0;width:360px;border-left:1px solid #2a3042}
#ed-side *,#ed-panel *{box-sizing:border-box;user-select:text;-webkit-user-select:text}
.ed-top{padding:8px 10px;border-bottom:1px solid #2a3042;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ed-top h1{font-size:14px;margin:0;flex:1 1 100%;color:#3fd0c9;font-weight:600}
.ed-scroll{overflow-y:auto;flex:1 1 auto;min-height:0}
#ed-panel .ed-scroll{padding:10px}
#ed-panel .ed-foot{padding:8px 10px;border-top:1px solid #2a3042;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ed-btn,.ed-in,.ed-sel,.ed-ta{font:inherit;color:#f1efe8;background:#1b2030;border:1px solid #394058;border-radius:4px;padding:5px 8px}
.ed-btn{cursor:pointer}
.ed-btn:hover:not(:disabled){background:#252c42;border-color:#3fd0c9}
.ed-btn:disabled{opacity:.4;cursor:default}
.ed-btn.primary{background:#1d4a49;border-color:#3fd0c9}
.ed-btn.danger:hover:not(:disabled){border-color:#e8553a}
.ed-btn.small{padding:2px 7px}
.ed-in,.ed-sel,.ed-ta{width:100%}
.ed-ta{min-height:96px;resize:vertical;line-height:1.35}
.ed-in:focus,.ed-sel:focus,.ed-ta:focus,.ed-btn:focus-visible{outline:2px solid #3fd0c9;outline-offset:0}
.ed-bad{border-color:#e8553a !important}
.ed-search{margin:8px 10px}
.ed-group>summary{cursor:pointer;padding:5px 10px;background:#161a27;border-bottom:1px solid #20263a;font-weight:600;position:sticky;top:0;z-index:1}
.ed-group>summary .ed-meta{font-weight:400;color:#8b93ab;margin-left:6px}
.ed-row{display:block;width:100%;text-align:left;padding:4px 10px 4px 14px;background:none;border:0;border-bottom:1px solid #1a1f2e;color:#cfd3e0;font:inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ed-row:hover{background:#1b2030}
.ed-row.sel{background:#1d4a49;color:#fff}
.ed-row.mod::after{content:' \\25CF';color:#e0a040}
.ed-row .n{color:#8b93ab;display:inline-block;min-width:26px}
.ed-row .who{color:#e0a040}
.ed-field{margin-bottom:10px}
.ed-field>label{display:block;color:#8b93ab;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}
.ed-hint{color:#8b93ab;font-size:12px;margin-top:3px}
.ed-warn{color:#e0a040;font-size:12px;margin-top:3px}
.ed-row2{display:flex;gap:6px;align-items:center}
.ed-checks{display:flex;flex-wrap:wrap;gap:4px 12px}
.ed-checks label{display:flex;gap:4px;align-items:center;color:#f1efe8;font-size:13px;text-transform:none;letter-spacing:0;margin:0}
.ed-chip{display:flex;gap:4px;align-items:center;margin-bottom:4px}
.ed-chip span{flex:1;background:#1b2030;border:1px solid #394058;border-radius:4px;padding:3px 8px}
.ed-title{font-size:15px;font-weight:600;margin:0 0 8px}
.ed-badge{display:inline-block;background:#3a2c10;color:#e0a040;border-radius:3px;padding:0 6px;font-size:11px;margin-left:6px}
.ed-toast{color:#3fd0c9;font-size:12px;flex:1 1 100%;min-height:16px}
.ed-banner{background:#2a2410;border:1px solid #6b5a1c;color:#e8d08a;padding:6px 8px;border-radius:4px;margin-bottom:10px;font-size:12px}
.ed-banner button{margin-left:6px}
`;

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) el.append(kid);
  return el;
}

const short = (text, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

class EditorUi {
  constructor(game) {
    this.game = game;
    this.source = { dialogue: dialogueSource, cutscene: cutsceneSource };
    this.model = E.createModel(dialogueSource, cutsceneSource);
    this.restored = 0;
    this.restoreDraft();
    this.sel = null;
    this.rows = new Map(); // "d:id:index" | "s:index" -> button
    this.openGroups = new Set();
    this.previewBg = null; // the dialogue preview background override (not saved)
    this.timers = {};
    this.lastDownload = null;
    this.chapterBg = {};
    for (const step of chapter) if (step.type === 'dialogue' && !(step.id in this.chapterBg)) this.chapterBg[step.id] = step.bg;
    this.build();
    this.select(this.firstSelection());
  }

  // ---------- Draft (localStorage, per browser; every access guarded) ----------

  restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const model = E.fromDraft(this.source, JSON.parse(raw));
      if (!model) return;
      const count = E.editCount(model, this.source);
      if (count > 0) {
        this.model = model;
        this.restored = count;
      }
    } catch (err) {
      // no storage / bad draft: start from the files
    }
  }

  saveDraft() {
    try {
      if (E.editCount(this.model, this.source) === 0) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(E.toDraft(this.model)));
    } catch (err) {
      // quota / blocked: the downloads still work
    }
  }

  discardAll() {
    if (!window.confirm('Discard every edit made in this editor (both files)?')) return;
    this.model = E.createModel(this.source.dialogue, this.source.cutscene);
    this.restored = 0;
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      // ignore
    }
    const sel = this.sel && E.entryOf(this.model, this.sel) ? this.sel : this.firstSelection();
    this.renderList();
    this.select(sel);
    this.toast('All edits discarded.');
  }

  // ---------- Structure ----------

  // Sidebar order: the chapter's (cutscene first), then dialogues no chapter step plays.
  groups() {
    const out = [];
    const seen = new Set();
    for (const step of chapter) {
      if (step.type === 'cutscene' && step.id === 'origin' && !seen.has('cut:origin')) {
        seen.add('cut:origin');
        out.push({ key: 'cut:origin', kind: 'shot', title: 'Cutscene · origin' });
      } else if (step.type === 'dialogue' && this.model.dialogue[step.id] && !seen.has(step.id)) {
        seen.add(step.id);
        out.push({ key: step.id, kind: 'dialogue', id: step.id, title: step.id });
      }
    }
    for (const id of Object.keys(this.model.dialogue)) {
      if (!seen.has(id)) out.push({ key: id, kind: 'dialogue', id, title: id, extra: true });
    }
    return out;
  }

  selectionsOf(group) {
    const list = group.kind === 'shot' ? this.model.cutscene.shots : this.model.dialogue[group.id];
    return list.map((_, index) => (group.kind === 'shot' ? { kind: 'shot', index } : { kind: 'dialogue', id: group.id, index }));
  }

  flat() {
    return this.groups().flatMap((g) => this.selectionsOf(g));
  }

  firstSelection() {
    return this.flat()[0];
  }

  keyOf(sel) {
    return sel.kind === 'shot' ? `s:${sel.index}` : `d:${sel.id}:${sel.index}`;
  }

  same(a, b) {
    return a && b && this.keyOf(a) === this.keyOf(b);
  }

  // ---------- Page ----------

  build() {
    document.head.append(h('style', { text: CSS }));
    // The game canvas lives in the middle column; Phaser re-fits it to that box.
    const gameEl = document.getElementById('game');
    Object.assign(gameEl.style, { position: 'absolute', left: '300px', right: '360px', top: '0', bottom: '0', width: 'auto', height: 'auto' });

    this.search = h('input', { class: 'ed-in', type: 'search', placeholder: 'Search text, speaker, id…  (Esc clears)', oninput: () => this.renderList() });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.search.value = '';
        this.renderList();
      }
    });
    this.list = h('div', { class: 'ed-scroll' });
    this.list.addEventListener('keydown', (e) => this.listKey(e));
    this.side = h('div', { id: 'ed-side' }, h('div', { class: 'ed-top' }, h('h1', { text: 'Dialogue editor (dev)' })), h('div', { class: 'ed-search' }, this.search), this.list);
    this.panelScroll = h('div', { class: 'ed-scroll' });
    this.count = h('span', { class: 'ed-hint' });
    this.toastEl = h('div', { class: 'ed-toast' });
    const btn = (label, fn, cls = '') => h('button', { class: `ed-btn ${cls}`, type: 'button', text: label, onclick: fn });
    this.panel = h(
      'div',
      { id: 'ed-panel' },
      this.panelScroll,
      h(
        'div',
        { class: 'ed-foot' },
        this.toastEl,
        btn('Download dialogue.json', () => this.download('dialogue.json', E.serializeDialogue(this.model.dialogue)), 'primary'),
        btn('Download cutscene_origin.json', () => this.download('cutscene_origin.json', E.serializeCutscene(this.model.cutscene)), 'primary'),
        btn('Copy dialogue.json', () => this.copy('dialogue.json', E.serializeDialogue(this.model.dialogue))),
        btn('Copy cutscene_origin.json', () => this.copy('cutscene_origin.json', E.serializeCutscene(this.model.cutscene))),
        btn('Discard all edits', () => this.discardAll(), 'danger'),
        this.count,
      ),
    );
    document.body.append(this.side, this.panel);
    // The page blocks text selection / the context menu / drag for the phone: not in the editor.
    for (const el of [this.side, this.panel]) for (const type of ['selectstart', 'contextmenu', 'dragstart']) el.addEventListener(type, (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => this.globalKey(e));
    this.renderList();
    this.game.scale.refresh();
  }

  toast(text) {
    this.toastEl.textContent = text;
    clearTimeout(this.timers.toast);
    this.timers.toast = setTimeout(() => (this.toastEl.textContent = ''), 4000);
  }

  updateCount() {
    const n = E.editCount(this.model, this.source);
    this.count.textContent = n ? `${n} edited ${n === 1 ? 'entry' : 'entries'}` : 'no edits';
  }

  // ---------- Sidebar ----------

  matches(entry, group, q) {
    if (!q) return true;
    return group.title.toLowerCase().includes(q) || JSON.stringify(entry).toLowerCase().includes(q);
  }

  renderList() {
    const q = this.search.value.trim().toLowerCase();
    this.rows.clear();
    const frag = document.createDocumentFragment();
    for (const group of this.groups()) {
      const sels = this.selectionsOf(group);
      const shown = sels.filter((s) => this.matches(E.entryOf(this.model, s), group, q));
      if (!shown.length) continue;
      const details = h('details', { class: 'ed-group' });
      const open = q || this.openGroups.has(group.key) || (this.sel && shown.some((s) => this.same(s, this.sel)));
      if (open) details.open = true;
      details.addEventListener('toggle', () => (details.open ? this.openGroups.add(group.key) : this.openGroups.delete(group.key)));
      const meta = group.kind === 'shot' ? `${sels.length} shots` : `${sels.length} lines${this.chapterBg[group.id] ? ` · ${this.chapterBg[group.id]}` : group.extra ? ' · battle / overlay' : ''}`;
      details.append(h('summary', {}, group.title, h('span', { class: 'ed-meta', text: meta })));
      for (const s of shown) {
        const row = this.makeRow(s);
        this.rows.set(this.keyOf(s), row);
        details.append(row);
      }
      frag.append(details);
    }
    this.list.replaceChildren(frag);
    this.updateCount();
  }

  rowLabel(sel) {
    const entry = E.entryOf(this.model, sel);
    const n = h('span', { class: 'n', text: `${sel.index + 1}` });
    if (sel.kind === 'shot') return [n, short(entry.text || '(no text)')];
    return [n, entry.speaker ? h('span', { class: 'who', text: `${entry.speaker}: ` }) : null, short(entry.text || '')];
  }

  makeRow(sel) {
    const row = h('button', { class: 'ed-row', type: 'button', onclick: () => this.select(sel) });
    row.append(...this.rowLabel(sel).flat().filter(Boolean));
    this.styleRow(row, sel);
    return row;
  }

  styleRow(row, sel) {
    row.classList.toggle('sel', this.same(sel, this.sel));
    row.classList.toggle('mod', E.isModified(this.model, sel));
  }

  refreshRow(sel) {
    const row = this.rows.get(this.keyOf(sel));
    if (!row) return;
    row.replaceChildren(...this.rowLabel(sel).flat().filter(Boolean));
    this.styleRow(row, sel);
    this.updateCount();
  }

  listKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    this.step(e.key === 'ArrowDown' ? 1 : -1, true);
  }

  globalKey(e) {
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.step(e.key === 'ArrowDown' ? 1 : -1, false);
    } else if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      this.preview();
    }
  }

  step(dir, focusRow) {
    const flat = this.flat();
    const at = flat.findIndex((s) => this.same(s, this.sel));
    const next = flat[at + dir];
    if (!next) return;
    this.select(next);
    if (focusRow) this.rows.get(this.keyOf(next))?.focus();
  }

  // ---------- Selection + form ----------

  select(sel) {
    if (!sel || !E.entryOf(this.model, sel)) return;
    const prev = this.sel;
    this.sel = sel;
    if (prev) {
      const row = this.rows.get(this.keyOf(prev));
      if (row) this.styleRow(row, prev);
    }
    let row = this.rows.get(this.keyOf(sel));
    if (!row) {
      // The row is hidden by the search or its group is closed: show it.
      this.search.value = '';
      this.openGroups.add(sel.kind === 'shot' ? 'cut:origin' : sel.id);
      this.renderList();
      row = this.rows.get(this.keyOf(sel));
    }
    if (row) {
      row.closest('details').open = true;
      this.styleRow(row, sel);
      row.scrollIntoView({ block: 'nearest' });
    }
    this.previewBg = null;
    this.renderForm();
    this.preview();
  }

  field(label, control, hint, warn) {
    return h('div', { class: 'ed-field' }, h('label', { text: label }), control, hint ? h('div', { class: 'ed-hint', text: hint }) : null, warn ? h('div', { class: 'ed-warn', text: warn }) : null);
  }

  select_(options, value, onChange, { bad = false } = {}) {
    const el = h('select', { class: `ed-sel${bad ? ' ed-bad' : ''}` });
    for (const o of options) el.append(h('option', { value: o.value, text: o.label }));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  // Options for a key list, keeping a current value that is not in it visible (and flagged).
  keyOptions(keys, current, noneLabel) {
    const opts = [{ value: SENTINEL.none, label: noneLabel }, ...keys.map((k) => ({ value: k, label: k }))];
    if (current && !keys.includes(current)) opts.push({ value: current, label: `${current} (unknown)` });
    return opts;
  }

  renderForm() {
    const sel = this.sel;
    const entry = E.entryOf(this.model, sel);
    const flat = this.flat();
    const at = flat.findIndex((s) => this.same(s, sel));
    const modified = E.isModified(this.model, sel);
    const nav = (label, dir) => h('button', { class: 'ed-btn small', type: 'button', text: label, disabled: !flat[at + dir], onclick: () => this.step(dir, false) });
    const total = (sel.kind === 'shot' ? this.model.cutscene.shots : this.model.dialogue[sel.id]).length;
    const title = sel.kind === 'shot' ? `Cutscene origin · shot ${sel.index + 1} / ${total}` : `${sel.id} · line ${sel.index + 1} / ${total}`;
    const kids = [];
    if (this.restored) {
      kids.push(
        h('div', { class: 'ed-banner' }, `Restored an unsaved draft (${this.restored} edited entries) from this browser. Downloads replace the repo files; if src/data changed since, discard it.`, h('button', { class: 'ed-btn small', type: 'button', text: 'Dismiss', onclick: (e) => { this.restored = 0; e.target.closest('.ed-banner').remove(); } })),
      );
    }
    kids.push(
      h('div', { class: 'ed-row2', style: 'margin-bottom:8px' }, nav('◀ Prev', -1), nav('Next ▶', 1), h('button', { class: 'ed-btn small', type: 'button', text: 'Replay ↻', title: 'Alt+R', onclick: () => this.preview() })),
      h('div', { class: 'ed-title' }, title, modified ? h('span', { class: 'ed-badge', text: E.origsOf(this.model, sel)[sel.index] === null ? 'new' : 'edited' }) : null),
      sel.kind === 'shot' ? this.shotForm(entry) : this.lineForm(entry),
      h(
        'div',
        { class: 'ed-row2', style: 'margin-top:14px' },
        h('button', { class: 'ed-btn small', type: 'button', text: 'Revert this entry', disabled: !modified || E.origsOf(this.model, sel)[sel.index] === null, onclick: () => this.revertEntry() }),
        h('button', { class: 'ed-btn small', type: 'button', text: 'Duplicate below', onclick: () => this.duplicate() }),
        h('button', { class: 'ed-btn small danger', type: 'button', text: 'Delete', disabled: total <= 1, onclick: () => this.deleteEntry() }),
      ),
    );
    this.panelScroll.replaceChildren(...kids);
  }

  commit(field, value, { live = true } = {}) {
    E.setField(this.model, this.sel, field, value);
    this.refreshRow(this.sel);
    clearTimeout(this.timers.draft);
    this.timers.draft = setTimeout(() => this.saveDraft(), 300);
    this.updateEditedBadge();
    if (live) this.schedulePreview();
  }

  // The title badge and the revert button follow the entry's state without rebuilding the form.
  updateEditedBadge() {
    const title = this.panelScroll.querySelector('.ed-title');
    if (!title) return;
    const modified = E.isModified(this.model, this.sel);
    const isNew = E.origsOf(this.model, this.sel)[this.sel.index] === null;
    title.querySelector('.ed-badge')?.remove();
    if (modified) title.append(h('span', { class: 'ed-badge', text: isNew ? 'new' : 'edited' }));
    const revert = [...this.panelScroll.querySelectorAll('button')].find((b) => b.textContent === 'Revert this entry');
    if (revert) revert.disabled = !modified || isNew;
  }

  schedulePreview(ms = 150) {
    clearTimeout(this.timers.preview);
    this.timers.preview = setTimeout(() => this.preview(), ms);
  }

  revertEntry() {
    if (!E.revert(this.model, this.sel)) return;
    this.refreshRow(this.sel);
    this.saveDraft();
    this.renderForm();
    this.preview();
  }

  duplicate() {
    this.select(E.insertAfter(this.model, this.sel));
    this.renderList();
    this.select(this.sel);
    this.saveDraft();
  }

  deleteEntry() {
    if (!window.confirm('Delete this entry from the working copy? (Discard all edits brings it back.)')) return;
    this.sel = E.remove(this.model, this.sel);
    this.renderList();
    this.select(this.sel);
    this.saveDraft();
  }

  // ----- dialogue line -----

  lineForm(line) {
    const sel = this.sel;
    const speakers = [...new Set(Object.values(this.model.dialogue).flatMap((ls) => ls.map((l) => l.speaker)).filter(Boolean))];
    const known = line.speaker === null || speakers.includes(line.speaker);
    const speakerValue = line.speaker === null ? SENTINEL.none : known ? line.speaker : SENTINEL.other;
    const custom = h('input', { class: 'ed-in', type: 'text', value: known ? '' : line.speaker, placeholder: 'speaker name', style: `margin-top:4px;${known ? 'display:none' : ''}` });
    const speakerSel = this.select_(
      [{ value: SENTINEL.none, label: '(none: narration / letter)' }, ...speakers.map((s) => ({ value: s, label: s })), { value: SENTINEL.other, label: 'Other…' }],
      speakerValue,
      (v) => {
        custom.style.display = v === SENTINEL.other ? '' : 'none';
        if (v === SENTINEL.other) {
          custom.focus();
          this.commit('speaker', custom.value || '');
        } else this.commit('speaker', v === SENTINEL.none ? null : v);
      },
    );
    custom.addEventListener('input', () => this.commit('speaker', custom.value));

    const portrait = line.portrait ?? null;
    const portraitSel = this.select_(
      this.keyOptions(portraitKeys, portrait, '(none: no portrait)'),
      portrait === null ? SENTINEL.none : portrait,
      (v) => this.commit('portrait', v === SENTINEL.none ? null : v),
      { bad: !!portrait && !portraitKeys.includes(portrait) },
    );

    const styleSel = this.select_(
      styleKeys.map((k) => ({ value: k, label: k })),
      line.style || 'normal',
      (v) => this.commit('style', v),
    );

    const text = h('textarea', { class: 'ed-ta', rows: '5' });
    text.value = line.text || '';
    text.addEventListener('input', () => this.commit('text', text.value));

    const bgSel = this.select_(
      [{ value: SENTINEL.none, label: '(unchanged)' }, ...coverKeys.map((k) => ({ value: k, label: k })), ...(line.bg && !coverKeys.includes(line.bg) ? [{ value: line.bg, label: `${line.bg} (not a cover background)` }] : [])],
      line.bg || SENTINEL.none,
      (v) => this.commit('bg', v === SENTINEL.none ? undefined : v),
      { bad: !!line.bg && !coverKeys.includes(line.bg) },
    );

    const sfxValue = line.sfx === undefined ? SENTINEL.default : line.sfx === null ? SENTINEL.silent : line.sfx;
    const sfxOptions = [
      { value: SENTINEL.default, label: '(default for the style / speaker)' },
      { value: SENTINEL.silent, label: '(silent)' },
      ...sfxNames.map((k) => ({ value: k, label: k })),
      ...(typeof line.sfx === 'string' && !sfxNames.includes(line.sfx) ? [{ value: line.sfx, label: `${line.sfx} (unknown)` }] : []),
    ];
    const sfxSel = this.select_(sfxOptions, sfxValue, (v) => this.commit('sfx', v === SENTINEL.default ? undefined : v === SENTINEL.silent ? null : v, { live: false }), { bad: typeof line.sfx === 'string' && !sfxNames.includes(line.sfx) });
    const play = h('button', { class: 'ed-btn small', type: 'button', text: '▶', title: 'Play this sound', onclick: () => sfxSel.value !== SENTINEL.default && sfxSel.value !== SENTINEL.silent && playSfx(sfxSel.value) });

    const transitionSel = this.select_(
      [{ value: SENTINEL.none, label: '(none)' }, ...TRANSITIONS.map((k) => ({ value: k, label: k }))],
      line.transition || SENTINEL.none,
      (v) => this.commit('transition', v === SENTINEL.none ? undefined : v, { live: false }),
    );
    const lines = this.model.dialogue[sel.id];
    const stepBg = this.chapterBg[sel.id];
    const bgOptions = [{ value: SENTINEL.none, label: stepBg ? `${stepBg} (chapter1.json)` : '(black)' }, ...['black', ...backgroundKeys].filter((k) => k !== stepBg).map((k) => ({ value: k, label: k }))];
    const previewBgSel = this.select_(bgOptions, this.previewBg || SENTINEL.none, (v) => {
      this.previewBg = v === SENTINEL.none ? null : v;
      this.preview();
    });

    return h(
      'div',
      {},
      this.field('Speaker', h('div', {}, speakerSel, custom)),
      this.field('Portrait', portraitSel, 'Shown on the speaker’s side (Rhea left, the others right); none clears that side.'),
      this.field('Style', styleSel, ui.dialogue.noPortraits.includes(sel.id) ? 'This dialogue hides portraits (ui.json dialogue.noPortraits).' : null),
      this.field('Text', text),
      this.field('Background change on this line', bgSel, 'Cover backgrounds only; crossfades in-game, shown already applied here.'),
      this.field('Sound on this line', h('div', { class: 'ed-row2' }, sfxSel, play)),
      this.field('Transition after the last line', transitionSel, sel.index === lines.length - 1 ? null : 'Only the last line of a dialogue uses it.', line.transition && sel.index !== lines.length - 1 ? 'Ignored: this is not the last line.' : null),
      this.field('Preview background (not saved)', previewBgSel, stepBg ? null : 'Not a chapter step (a battle event / overlay): previewed over a plain background.'),
    );
  }

  // ----- cutscene shot -----

  shotForm(shot) {
    const bgKeys = [...cutsceneKeys, ...backgroundKeys.filter((k) => !cutsceneKeys.includes(k))];
    const bgOpts = (current) => [
      { value: SENTINEL.none, label: '(none: black)' },
      ...bgKeys.map((k) => ({ value: k, label: k })),
      ...(current && !bgKeys.includes(current) ? [{ value: current, label: `${current} (unknown)` }] : []),
    ];
    const bg = (field) =>
      this.select_(bgOpts(shot[field]), shot[field] || SENTINEL.none, (v) => this.commit(field, v === SENTINEL.none ? (field === 'bg' ? null : undefined) : v), {
        bad: !!shot[field] && !bgKeys.includes(shot[field]),
      });

    const text = h('textarea', { class: 'ed-ta', rows: '4' });
    text.value = shot.text || '';
    text.addEventListener('input', () => this.commit('text', text.value));

    const splitSel = this.select_(
      SPLITS.map((k) => ({ value: k, label: k })),
      shot.split || 'none',
      (v) => this.commit('split', v === 'none' ? undefined : v),
    );
    const moveSel = this.select_(
      MOVES.map((k) => ({ value: k, label: k })),
      shot.move || 'none',
      (v) => this.commit('move', v === 'none' ? undefined : v),
    );

    const tintOn = h('input', { type: 'checkbox' });
    tintOn.checked = !!shot.tint;
    const tintColor = h('input', { type: 'color', value: E.tintToCss(shot.tint), style: 'width:44px;height:28px;padding:0;background:none;border:1px solid #394058' });
    const tintText = h('span', { class: 'ed-hint', text: shot.tint || '' });
    const commitTint = () => {
      const value = tintOn.checked ? E.cssToTint(tintColor.value) : undefined;
      tintText.textContent = value || '';
      this.commit('tint', value);
    };
    tintOn.addEventListener('change', commitTint);
    tintColor.addEventListener('input', () => {
      tintOn.checked = true;
      commitTint();
    });

    const fxAll = [...new Set([...Object.keys(ui.cutscene.fx), ...Object.values(this.model.cutscene.shots).flatMap((s) => s.fx || [])])];
    const fxBoxes = fxAll.map((name) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = (shot.fx || []).includes(name);
      box.addEventListener('change', () => {
        const base = (E.entryOf(this.model, this.sel).fx || []).filter((f) => f !== name);
        const next = box.checked ? [...base, name] : base;
        this.commit('fx', next.length ? next : undefined);
      });
      return h('label', {}, box, name);
    });

    const duration = h('input', { class: 'ed-in', type: 'number', min: '500', step: '100', placeholder: `default ${ui.cutscene.defaultDurationMs}`, value: shot.durationMs ?? '' });
    duration.addEventListener('input', () => {
      const n = parseInt(duration.value, 10);
      this.commit('durationMs', Number.isFinite(n) && n > 0 ? n : undefined);
    });

    const sfxBox = h('div', {});
    const renderSfx = () => {
      const names = E.sfxToText(E.entryOf(this.model, this.sel).sfx).split(',').map((s) => s.trim()).filter(Boolean);
      const adder = this.select_([{ value: '', label: '+ add a sound…' }, ...sfxNames.map((k) => ({ value: k, label: k }))], '', (v) => {
        if (!v) return;
        this.commit('sfx', E.textToSfx([...names, v].join(',')), { live: false });
        renderSfx();
      });
      sfxBox.replaceChildren(
        ...names.map((name, i) =>
          h(
            'div',
            { class: 'ed-chip' },
            h('span', { class: sfxNames.includes(name) ? '' : 'ed-bad', text: sfxNames.includes(name) ? name : `${name} (unknown)` }),
            h('button', { class: 'ed-btn small', type: 'button', text: '▶', onclick: () => playSfx(name) }),
            h('button', { class: 'ed-btn small', type: 'button', text: '×', title: 'Remove', onclick: () => {
              this.commit('sfx', E.textToSfx(names.filter((_, j) => j !== i).join(',')), { live: false });
              renderSfx();
            } }),
          ),
        ),
        adder,
      );
    };
    renderSfx();

    const others = E.otherShotFields(shot, SHOT_EDITABLE);
    const shadowed = E.shadowedByArt(shot, SHOT_EDITABLE);
    return h(
      'div',
      {},
      this.field('Text', text),
      this.field('Background', bg('bg'), shot.bgFallback ? `Shown when this art is missing: ${shot.bgFallback}` : null),
      this.field('Second background (split)', bg('bg2'), shot.bg2Fallback ? `Shown when this art is missing: ${shot.bg2Fallback}` : null),
      h('div', { class: 'ed-row2' }, h('div', { class: 'ed-field', style: 'flex:1' }, h('label', { text: 'Split' }), splitSel), h('div', { class: 'ed-field', style: 'flex:1' }, h('label', { text: 'Move' }), moveSel)),
      this.field('Tint', h('div', { class: 'ed-row2' }, tintOn, tintColor, tintText)),
      this.field('Effects', h('div', { class: 'ed-checks' }, fxBoxes), shadowed.length ? `With the real art in, whenArt replaces: ${shadowed.join(', ')}. Edits to those show here only while the art is a placeholder.` : null),
      this.field('Sounds (played at the shot’s start)', sfxBox, 'No sound listed = the first effect that has one (ui.json cutscene.fxSfx).'),
      this.field('Duration (ms)', duration),
      others.length ? h('div', { class: 'ed-hint' }, `Kept as is (edit in src/data): ${others.join(', ')}`) : null,
    );
  }

  // ---------- Preview (the real scenes) ----------

  preview() {
    const sel = this.sel;
    if (!sel) return;
    const mgr = this.game.scene;
    mgr.stop('Dialogue');
    mgr.stop('Cutscene');
    const entry = E.entryOf(this.model, sel);
    this.previewSeq = (this.previewSeq || 0) + 1;
    if (sel.kind === 'shot') {
      mgr.start('Cutscene', { id: 'origin', preview: true, shots: clone(this.model.cutscene.shots), shot: sel.index + 1 });
    } else {
      const bg = this.previewBg || this.chapterBg[sel.id] || 'black';
      mgr.start('Dialogue', { id: sel.id, bg, preview: { index: sel.index, lines: clone(this.model.dialogue[sel.id]) } });
    }
    return entry;
  }

  // ---------- Output ----------

  download(name, text) {
    this.lastDownload = { name, text };
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.toast(`Downloaded ${name}. Put it in src/data/ to use it.`);
  }

  async copy(name, text) {
    this.lastCopy = { name, text };
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch (e) {
        this.toast(`Could not copy ${name}: use Download.`);
        ta.remove();
        return;
      }
      ta.remove();
    }
    this.toast(`Copied ${name} to the clipboard.`);
  }
}

export default class EditorScene extends Phaser.Scene {
  constructor() {
    super('Editor');
  }

  create() {
    const editor = new EditorUi(this.game);
    // Test / debugging hook (dev page only).
    window.__editor = editor;
    window.__editorApi = E;
  }
}
