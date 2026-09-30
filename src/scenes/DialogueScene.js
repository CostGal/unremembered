import Phaser from 'phaser';
import dialogue from '../data/dialogue.json';
import environments from '../data/environments.json';
import ui from '../data/ui.json';
import { playSceneMusic } from '../systems/Audio.js';
import * as Fx from '../systems/Fx.js';

const cfg = ui.dialogue;

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
    this.dialogueId = data.id;
    this.bgKey = data.bg;
    this.overlay = !!data.overlay;
    this.onDone = data.onDone;
    this.lines = dialogue[data.id] || [];
    if (!dialogue[data.id]) console.warn(`dialogue "${data.id}" not found`);
  }

  create() {
    if (this.overlay) {
      this.add.rectangle(0, 0, 360, 640, Number(cfg.overlayDim.color), cfg.overlayDim.alpha).setOrigin(0);
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
    this.add.image(180, cfg.bg.size / 2, this.bgKey).setDisplaySize(cfg.bg.size, cfg.bg.size);
    const env = environments[this.bgKey] || {};
    const area = { x: 0, y: 0, w: 360, h: cfg.bg.size };
    if (env.rain) Fx.rain(this, env.rain, area);
    if (env.vignette) Fx.vignette(this, { ...env.vignette, depth: 0 }, area);
    // Fade the picture into the ink below it.
    this.add.rectangle(0, cfg.bg.size - cfg.bg.fadeH, 360, cfg.bg.fadeH, Number(ui.dialogue.box.fill), cfg.bg.fadeAlpha).setOrigin(0);
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
    this.nextMark = this.add
      .text(b.x + b.w - b.padX, b.y + b.h - b.padX, cfg.nextMark, { fontFamily: ui.font, fontSize: `${b.nameFontSize}px`, color: b.textColor })
      .setOrigin(1, 1)
      .setDepth(b.depth)
      .setVisible(false);
    this.tweens.add({ targets: this.nextMark, alpha: cfg.nextBlinkAlpha, duration: cfg.nextBlinkMs, yoyo: true, repeat: -1 });
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
    this.nextMark.setColor(style.textColor);

    const speaker = style.showName ? line.speaker : null;
    this.nameText.setText(speaker || '');
    this.nameText.setColor(cfg.nameColors[speaker] || cfg.nameColors.default);

    this.updatePortraits(line, style);

    this.fullText = line.text || '';
    this.shown = 0;
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
        if (this.shown >= this.fullText.length) this.completeLine();
      },
    });
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
    if (line.speaker) {
      const owner = line.portrait ? line.portrait.split('_')[0] : speakerId;
      const side = cfg.portraitSides[owner] || cfg.portraitSides.default;
      this.setSlot(this.portraits[side], line.portrait || null, owner);
    }

    for (const slot of Object.values(this.portraits)) {
      const lit = slot.owner && slot.owner === speakerId;
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
      slot.image.setScale(p.height / slot.image.height);
      // Portraits are drawn facing right; the right-hand side faces left.
      const faces = this.registry.get('manifest')?.portraits?.[key]?.faces || 'right';
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
