import Phaser from 'phaser';
import dialogue from '../data/dialogue.json';
import environments from '../data/environments.json';
import ui from '../data/ui.json';
import voices from '../data/voices.json';
import { playAmbience, playBlip, playSceneMusic, playSfx } from '../systems/Audio.js';
import * as Fx from '../systems/Fx.js';
import { whenReady } from '../systems/Assets.js';
import { mirrorEdges, rect as viewRect } from '../systems/View.js';

const cfg = ui.dialogue;

// Voice by speaker, else by "_" + style (letter/narration), else "_default".
// A key that maps to null is deliberately silent.
function voiceFor(line) {
  for (const key of [line.speaker, `_${line.style || 'normal'}`]) {
    if (key && key in voices) return voices[key];
  }
  return voices._default;
}

// Only letters and digits get a blip (no spaces or punctuation).
const VOICED = /[\p{L}\p{N}]/u;

// Visual-novel dialogue: background on top, text box at the bottom with the
// speaker's name and a typewritten line, up to two portraits standing on the
// box (side fixed per character, speaker lit, the other dimmed).
// Tap while typing = finish the line; tap after = next line.
// data = {id, bg} from the chapter, or {id, overlay: true, onDone} when
// another scene (the boss battle) pauses itself for a conversation.
export default class DialogueScene extends Phaser.Scene {
  constructor() {
    super('Dialogue');
  }

  init(data) {
    // Scene instances are reused (dialogue -> dialogue), so reset state here.
    this.finished = false;
    this.silhouette = null;
    this.typing = false;
    this.typeEvent = null;
    this.dialogueId = data.id;
    this.bgKey = data.bg;
    this.overlay = !!data.overlay;
    this.onDone = data.onDone;
    this.lines = dialogue[data.id] || [];
    if (!dialogue[data.id]) console.warn(`dialogue "${data.id}" not found`);
  }

  // Waits for this scene's assets (loaded in the background by the Loader).
  create() {
    whenReady(this, () => this.build());
  }

  build() {
    if (this.overlay) {
      const v = viewRect();
      this.add.rectangle(v.x, v.y, v.w, v.h, Number(cfg.overlayDim.color), cfg.overlayDim.alpha).setOrigin(0);
    } else {
      playSceneMusic('Dialogue');
      this.buildBackground();
    }

    this.portraits = { left: this.buildPortraitSlot('left'), right: this.buildPortraitSlot('right') };
    this.buildBox();

    this.index = -1;
    this.typing = false;
    this.input.on('pointerdown', () => this.onTap());
    this.advance();
  }

  buildBackground() {
    if (!this.bgKey || this.bgKey === 'black' || !this.textures.exists(this.bgKey)) return;
    const bg = this.add.image(180, cfg.bg.size / 2, this.bgKey).setDisplaySize(cfg.bg.size, cfg.bg.size);
    // Wider screens: the picture's edges continue (mirrored) into the margins.
    mirrorEdges(this, bg);
    const env = environments[this.bgKey] || {};
    const v = viewRect();
    const area = { x: v.x, y: 0, w: v.w, h: cfg.bg.size };
    // Rain falls over the whole screen (behind the text box and portraits).
    if (env.rain) Fx.rain(this, env.rain, v, { fill: true });
    if (env.vignette) Fx.vignette(this, { ...env.vignette, depth: 0 }, area);
    if (env.ambience) playAmbience(env.ambience);
    // Fade the picture into the ink below it.
    this.add.rectangle(v.x, cfg.bg.size - cfg.bg.fadeH, v.w, cfg.bg.fadeH, Number(ui.dialogue.box.fill), cfg.bg.fadeAlpha).setOrigin(0);
  }

  // A cutout (e.g. aurelian_exile) in black on the background: it fades in once
  // and stays for the rest of the scene.
  showSilhouette(key) {
    if (this.silhouette || !this.textures.exists(key) || this.textures.get(key).customData.placeholder) return;
    const s = cfg.silhouette;
    const image = this.add.image(s.x, s.bottomY, key).setOrigin(0.5, 1).setDepth(s.depth).setTint(Number(s.tint)).setAlpha(0);
    image.setScale(s.height / image.height);
    this.tweens.add({ targets: image, alpha: s.alpha, duration: s.fadeMs });
    this.silhouette = image;
  }

  buildPortraitSlot(side) {
    const p = cfg.portrait;
    const x = side === 'left' ? p.leftX : p.rightX;
    const image = this.add.image(x, p.bottomY, '__DEFAULT').setOrigin(0.5, 1).setVisible(false).setDepth(p.depth);
    return { side, image, key: null, owner: null };
  }

  buildBox() {
    const b = cfg.box;
    this.box = this.add.rectangle(b.x, b.y, b.w, b.h, Number(b.fill), b.alpha).setOrigin(0).setStrokeStyle(2, Number(b.stroke));
    this.box.setDepth(b.depth);
    this.nameText = this.add.text(b.x + b.padX, b.y + b.nameY, '', {
      fontFamily: ui.font,
      fontSize: `${b.nameFontSize}px`,
      color: cfg.nameColors.default,
    }).setDepth(b.depth);
    this.bodyText = this.add.text(b.x + b.padX, b.y + b.textY, '', {
      fontFamily: ui.font,
      fontSize: `${b.fontSize}px`,
      color: b.textColor,
      lineSpacing: b.lineSpacing,
      wordWrap: { width: b.w - b.padX * 2 },
    }).setDepth(b.depth);
    // The "next" mark is a drawn pixel triangle (the font has no ▼), and a
    // speaker name made of ▯ (a forgotten name) is drawn as outlined boxes:
    // both stay crisp instead of falling back to a system font.
    this.nextMark = this.add.graphics().setDepth(b.depth).setVisible(false);
    this.drawNextMark(b.textColor);
    this.tweens.add({ targets: this.nextMark, alpha: cfg.nextBlinkAlpha, duration: cfg.nextBlinkMs, yoyo: true, repeat: -1 });
    this.nameBoxes = this.add.graphics().setDepth(b.depth);
  }

  drawNextMark(color) {
    const b = cfg.box;
    const m = cfg.nextMark;
    const right = b.x + b.w - b.padX;
    const bottom = b.y + b.h - b.padX;
    const g = this.nextMark;
    g.clear();
    g.fillStyle(Number(color.replace('#', '0x')), 1);
    g.fillTriangle(right - m.w, bottom - m.h, right, bottom - m.h, right - m.w / 2, bottom);
  }

  // A name of N ▯ characters: N outlined boxes sized to the name font.
  drawNameBoxes(name, color) {
    const g = this.nameBoxes;
    g.clear();
    if (!/^▯+$/u.test(name || '')) return false;
    const b = cfg.box;
    const k = cfg.nameBoxes;
    const w = Math.round(b.nameFontSize * k.wPct);
    const h = Math.round(b.nameFontSize * k.hPct);
    const top = b.y + b.nameY + Math.round((b.nameFontSize * k.lineHeightPct - h) / 2);
    g.lineStyle(k.stroke, Number(color.replace('#', '0x')), 1);
    for (let i = 0; i < name.length; i++) g.strokeRect(b.x + b.padX + i * (w + k.gap) + 0.5, top + 0.5, w, h);
    return true;
  }

  onTap() {
    if (this.finished) return;
    if (this.typing) this.completeLine();
    else this.advance();
  }

  advance() {
    this.index += 1;
    const line = this.lines[this.index];
    if (!line) {
      this.finish();
      return;
    }
    this.showLine(line);
  }

  showLine(line) {
    const style = cfg.styles[line.style || 'normal'] || cfg.styles.normal;
    const b = cfg.box;

    this.box.setFillStyle(Number(style.fill), b.alpha);
    this.bodyText.setColor(style.textColor);
    this.bodyText.setAlign(style.align);
    this.bodyText.setOrigin(style.align === 'center' ? 0.5 : 0, 0);
    this.bodyText.x = style.align === 'center' ? b.x + b.w / 2 : b.x + b.padX;
    this.bodyText.y = b.y + (style.showName ? b.textY : b.nameY);
    this.drawNextMark(style.textColor);

    const speaker = style.showName ? line.speaker : null;
    // Story sounds: a style's sfx (the letter unfolding), a speaker's (the glitch of a forgotten name).
    const sfx = line.sfx !== undefined ? line.sfx : cfg.nameSfx[speaker] || style.sfx;
    if (sfx) playSfx(sfx);
    const nameColor = cfg.nameColors[speaker] || cfg.nameColors.default;
    // The data string stays (colour and voice lookups use it); only the drawing changes.
    const boxed = this.drawNameBoxes(speaker, nameColor);
    this.nameText.setText(boxed ? '' : speaker || '');
    this.nameText.setColor(nameColor);

    this.updatePortraits(line, style);
    if (line.silhouette) this.showSilhouette(line.silhouette);

    this.fullText = line.text || '';
    this.shown = 0;
    this.voice = voiceFor(line);
    this.voicedCount = 0;
    this.bodyText.setText('');
    this.nextMark.setVisible(false);
    this.typing = true;
    if (this.typeEvent) this.typeEvent.remove();
    this.typeEvent = this.time.addEvent({
      delay: 1000 / cfg.charsPerSec,
      loop: true,
      callback: () => {
        this.shown += 1;
        this.bodyText.setText(this.fullText.slice(0, this.shown));
        this.blip(this.fullText[this.shown - 1]);
        if (this.shown >= this.fullText.length) this.completeLine();
      },
    });
  }

  // Blip on every Nth voiced character of the line as it is revealed.
  blip(char) {
    if (!this.voice || !char || !VOICED.test(char)) return;
    this.voicedCount += 1;
    if (this.voicedCount % (this.voice.every || 1) === 0) playBlip(this.voice);
  }

  completeLine() {
    if (this.typeEvent) this.typeEvent.remove();
    this.typeEvent = null;
    this.bodyText.setText(this.fullText);
    this.typing = false;
    this.nextMark.setVisible(true);
  }

  // The line's portrait goes on its character's side (null clears the
  // speaker's side). The other side keeps whoever was there, dimmed.
  updatePortraits(line, style) {
    if (!style.portraits) {
      for (const slot of Object.values(this.portraits)) this.setSlot(slot, null);
      return;
    }

    const speakerId = (line.speaker || '').toLowerCase();
    // The lit portrait is the one the line shows ("clerk_smug" -> "clerk"): a
    // speaker label like "The Clerk" never equals its portrait owner.
    const litOwner = line.speaker && line.portrait ? line.portrait.split('_')[0] : speakerId;
    if (line.speaker) {
      const owner = litOwner;
      const side = cfg.portraitSides[owner] || cfg.portraitSides.default;
      this.setSlot(this.portraits[side], line.portrait || null, owner);
    }

    for (const slot of Object.values(this.portraits)) {
      const lit = slot.owner && slot.owner === litOwner;
      slot.image.setTint(lit ? 0xffffff : Number(cfg.portrait.dimTint));
    }
  }

  setSlot(slot, key, owner = null) {
    if (!key) {
      slot.image.setVisible(false);
      slot.key = null;
      slot.owner = null;
      return;
    }
    if (!this.textures.exists(key)) console.warn(`portrait "${key}" not in assets.json`);
    if (slot.key !== key) {
      slot.image.setTexture(this.textures.exists(key) ? key : '__MISSING');
      const p = cfg.portrait;
      const def = this.registry.get('manifest')?.portraits?.[key];
      // Display height comes from data: the entry's own displayHeight, else the shared one.
      slot.image.setScale((def?.displayHeight || p.height) / slot.image.height);
      // Portraits are drawn facing right; the right-hand side faces left.
      const faces = def?.faces || 'right';
      const wantFaces = slot.side === 'left' ? 'right' : 'left';
      // A placeholder's label stays readable.
      const placeholder = !!this.textures.get(slot.image.texture.key).customData.placeholder;
      slot.image.setFlipX(!placeholder && faces !== wantFaces);
    }
    slot.key = key;
    slot.owner = owner;
    slot.image.setVisible(true);
  }

  finish() {
    this.finished = true;
    if (this.overlay) {
      this.scene.stop();
      if (this.onDone) this.onDone();
      return;
    }
    const runner = this.registry.get('runner');
    if (runner) runner.next(this);
    else this.scene.start('Title');
  }
}
