/** Phaser implementation of the immediate-mode Gfx interface (pooled images, texts, shape layers). */
import Phaser from 'phaser';
import { glyphSheet, type GlyphRect } from '../art/glyphs';
import type { CrispOpts, Gfx, ImgOpts, Layer, TextOpts } from './gfx';
import { crispTex } from '../ui/crispText';

const DEPTH = {
  floorImg: 10,
  floorG: 900,
  world: 1000,
  topImg: 3000,
  topG: 3800,
  topText: 3900,
  lightG: 5000,
  lightImg: 5100,
  dark: 6000,
  uiG: 7900,
  uiImg: 8000,
  uiText: 9500,
  overG: 9600,
  overImg: 9700,
  overText: 9900,
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/**
 * `${key}|${flip}` -> texture keys of its glyph variants (null: texture cannot be converted).
 * Module-level because the texture manager outlives scenes (and their PhaserGfx).
 */
const glyphTex = new Map<string, string[] | null>();

export class PhaserGfx implements Gfx {
  private imgs: Phaser.GameObjects.Image[] = [];
  private nImg = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private nText = 0;
  private uiTexts: Phaser.GameObjects.Text[] = [];
  private nUiText = 0;
  private g: Record<Exclude<Layer, 'world'>, Phaser.GameObjects.Graphics>;
  private order = { floor: 0, top: 0, light: 0, ui: 0, over: 0, text: 0 };
  private dark: Phaser.GameObjects.RenderTexture;
  private hole: Phaser.GameObjects.Image;
  private darkUsed = false;
  private glyphOn = false;

  constructor(private scene: Phaser.Scene, private mainCam: Phaser.Cameras.Scene2D.Camera, private uiCam: Phaser.Cameras.Scene2D.Camera) {
    const mk = (depth: number, ui = false) => {
      const gr = scene.add.graphics().setDepth(depth);
      this.filter(gr, ui);
      return gr;
    };
    this.g = { floor: mk(DEPTH.floorG), top: mk(DEPTH.topG), light: mk(DEPTH.lightG), ui: mk(DEPTH.uiG, true), over: mk(DEPTH.overG, true) };
    this.g.light.setBlendMode(Phaser.BlendModes.ADD);
    const { width, height } = scene.scale;
    this.dark = scene.add.renderTexture(0, 0, width, height).setOrigin(0, 0).setDepth(DEPTH.dark).setVisible(false);
    this.dark.setScrollFactor(0);
    this.filter(this.dark, false);
    this.hole = scene.make.image({ key: 'fx_hole', add: false });
  }

  /**
   * Show an object on exactly one of the two cameras. Menu scenes pass the same camera twice
   * (no separate ui camera): then everything is shown on it.
   */
  private filter(o: Phaser.GameObjects.GameObject, ui: boolean): void {
    if (this.mainCam === this.uiCam) return;
    (o as unknown as { cameraFilter: number }).cameraFilter = ui ? this.mainCam.id : this.uiCam.id;
  }

  begin(): void {
    this.nImg = 0;
    this.nText = 0;
    this.nUiText = 0;
    this.order = { floor: 0, top: 0, light: 0, ui: 0, over: 0, text: 0 };
    for (const k of Object.keys(this.g) as (keyof typeof this.g)[]) this.g[k].clear();
    this.darkUsed = false;
  }

  end(): void {
    for (let i = this.nImg; i < this.imgs.length; i++) if (this.imgs[i].visible) this.imgs[i].setVisible(false);
    for (let i = this.nText; i < this.texts.length; i++) if (this.texts[i].visible) this.texts[i].setVisible(false);
    for (let i = this.nUiText; i < this.uiTexts.length; i++) if (this.uiTexts[i].visible) this.uiTexts[i].setVisible(false);
    if (!this.darkUsed && this.dark.visible) this.dark.setVisible(false);
  }

  img(key: string, frame: string | number, x: number, y: number, o: ImgOpts = {}): void {
    let im = this.imgs[this.nImg];
    if (!im) {
      im = this.scene.add.image(0, 0, key, frame);
      this.imgs.push(im);
    }
    this.nImg++;
    const layer = o.layer ?? 'world';
    let flipX = !!o.flipX;
    if (this.glyphOn && (layer === 'world' || layer === 'floor')) {
      const gk = this.glyphKey(key, flipX);
      if (gk && this.scene.textures.get(gk).has(String(frame))) { key = gk; flipX = false; }
    }
    if (im.texture.key !== key || String(im.frame.name) !== String(frame)) im.setTexture(key, frame);
    im.setVisible(true);
    im.setPosition(Math.round(x), Math.round(y));
    im.setOrigin(o.ox ?? 0.5, o.oy ?? 1);
    im.setFlip(flipX, !!o.flipY);
    im.setRotation(o.rot ?? 0);
    const s = o.scale ?? 1;
    im.setScale((o.sx ?? 1) * s, (o.sy ?? 1) * s);
    im.setAlpha(o.alpha ?? 1);
    if (o.fill !== undefined) im.setTintFill(o.fill);
    else if (o.tint !== undefined) im.setTint(o.tint);
    else im.clearTint();
    im.setBlendMode(o.add || layer === 'light' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    let depth: number;
    switch (layer) {
      case 'floor': depth = DEPTH.floorImg + this.order.floor++ * 0.01; break;
      case 'world': depth = DEPTH.world + (o.depth ?? y) + this.nImg * 1e-5; break;
      case 'top': depth = DEPTH.topImg + this.order.top++ * 0.01; break;
      case 'light': depth = DEPTH.lightImg + this.order.light++ * 0.01; break;
      case 'over': depth = DEPTH.overImg + this.order.over++ * 0.01; break;
      default: depth = DEPTH.uiImg + this.order.ui++ * 0.01;
    }
    im.setDepth(depth);
    this.filter(im, layer === 'ui' || layer === 'over');
  }

  text(str: string, x: number, y: number, o: TextOpts = {}): void {
    // HUD text has its own pool so world labels coming and going don't shift (and re-render) it
    const ui = o.layer === 'ui' || o.layer === 'over';
    const pool = ui ? this.uiTexts : this.texts;
    const n = ui ? this.nUiText++ : this.nText++;
    let t = pool[n];
    if (!t) {
      t = this.scene.add.text(0, 0, '', { fontFamily: 'FusionPixel', fontSize: '12px', color: '#ffffff' });
      t.setResolution(1);
      pool.push(t);
    }
    const color = hex(o.color ?? 0xf5f6ff);
    if (t.text !== str) t.setText(str);
    if (t.style.color !== color) t.setColor(color);
    const stroke = o.stroke ?? true;
    const wantStroke = stroke ? 3 : 0;
    if (t.style.strokeThickness !== wantStroke) t.setStroke('#0b0a12', wantStroke);
    t.setVisible(true);
    const align = o.align ?? 'left';
    t.setOrigin(align === 'left' ? 0 : align === 'center' ? 0.5 : 1, 0);
    t.setPosition(Math.round(x), Math.round(y));
    t.setAlpha(o.alpha ?? 1);
    t.setScale(o.scale ?? 1);
    const layer = o.layer ?? 'top';
    t.setDepth((layer === 'over' ? DEPTH.overText : layer === 'ui' ? DEPTH.uiText : o.overDark ? DEPTH.dark + 50 : DEPTH.topText) + this.order.text++ * 0.01);
    this.filter(t, ui);
  }

  crisp(str: string, x: number, y: number, o: CrispOpts = {}): void {
    if (!str) return;
    const layer = o.layer ?? 'ui';
    const s = Math.max(1, Math.round(o.scale ?? 1));
    const t = crispTex(this.scene.textures, str, o);
    if (!t) {
      // font not loaded yet: plain text keeps the screen readable
      this.text(str, x, y, { layer, color: o.color, align: o.align, alpha: o.alpha, scale: s, stroke: o.outline !== undefined });
      return;
    }
    let left: number, top: number;
    if (o.stamp) {
      left = Math.round(x - (t.w * s) / 2);
      top = Math.round(y - (t.h * s) / 2);
    } else {
      const w = t.tw * s;
      left = Math.round(o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x) - t.pad * s;
      top = Math.round(y) - t.pad * s;
    }
    this.img(t.key, '__BASE', left, top, { layer, ox: 0, oy: 0, scale: s, alpha: o.alpha });
  }

  private gr(layer: Layer | undefined): Phaser.GameObjects.Graphics {
    const l = layer ?? 'floor';
    return l === 'world' ? this.g.top : this.g[l];
  }

  circle(x: number, y: number, r: number, color: number, alpha = 1, layer?: Layer): void {
    this.gr(layer).fillStyle(color, alpha).fillCircle(x, y, r);
  }

  ring(x: number, y: number, r: number, width: number, color: number, alpha = 1, layer?: Layer): void {
    this.gr(layer).lineStyle(width, color, alpha).strokeCircle(x, y, r);
  }

  ellipse(x: number, y: number, rx: number, ry: number, color: number, alpha = 1, layer?: Layer): void {
    this.gr(layer).fillStyle(color, alpha).fillEllipse(x, y, rx * 2, ry * 2, 20);
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1, layer?: Layer): void {
    this.gr(layer).fillStyle(color, alpha).fillRect(x, y, w, h);
  }

  strokeRect(x: number, y: number, w: number, h: number, width: number, color: number, alpha = 1, layer?: Layer): void {
    this.gr(layer).lineStyle(width, color, alpha).strokeRect(x, y, w, h);
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, color: number, alpha = 1, layer?: Layer): void {
    this.gr(layer).lineStyle(width, color, alpha).lineBetween(x1, y1, x2, y2);
  }

  poly(pts: number[], color: number, alpha = 1, layer?: Layer): void {
    const g = this.gr(layer).fillStyle(color, alpha);
    const ps: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) ps.push({ x: pts[i], y: pts[i + 1] });
    if (ps.length >= 3) g.fillPoints(ps, true);
  }

  sector(x: number, y: number, r: number, a0: number, a1: number, color: number, alpha = 1, layer?: Layer, inner = 0): void {
    const g = this.gr(layer).fillStyle(color, alpha);
    const steps = Math.max(6, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 40));
    const ps: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      ps.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
    if (inner > 0) {
      for (let i = steps; i >= 0; i--) {
        const a = a0 + ((a1 - a0) * i) / steps;
        ps.push({ x: x + Math.cos(a) * inner, y: y + Math.sin(a) * inner });
      }
    } else ps.push({ x, y });
    g.fillPoints(ps, true);
  }

  glyphs(on: boolean): void { this.glyphOn = on; }

  /** Build the mirrored glyph variants of every sheet built so far (call after a warm-up draw). */
  warmGlyphFlips(): void {
    for (const id of [...glyphTex.keys()]) {
      const [key, f] = id.split('|');
      const other = `${key}|${f === '1' ? 0 : 1}`;
      if (!glyphTex.has(other)) glyphTex.set(other, this.buildGlyphs(key, f !== '1'));
    }
  }

  /** Current glyph variant of a texture (variants cycle every 100 ms), built on first use. */
  private glyphKey(key: string, flip: boolean): string | null {
    const id = `${key}|${flip ? 1 : 0}`;
    let keys = glyphTex.get(id);
    if (keys === undefined) {
      keys = this.buildGlyphs(key, flip);
      glyphTex.set(id, keys);
    }
    return keys ? keys[Math.floor(this.scene.time.now / 100) % keys.length] : null;
  }

  /** Convert a whole sheet into glyph-art textures with the same frame names and rects. */
  private buildGlyphs(key: string, flip: boolean): string[] | null {
    const tm = this.scene.textures;
    if (!tm.exists(key)) return null;
    const tex = tm.get(key);
    const img = tex.getSourceImage() as HTMLCanvasElement | HTMLImageElement;
    const w = img.width, h = img.height;
    if (!w || !h) return null;
    const read = document.createElement('canvas');
    read.width = w;
    read.height = h;
    const rctx = read.getContext('2d', { willReadFrequently: true })!;
    rctx.drawImage(img, 0, 0);
    const src = rctx.getImageData(0, 0, w, h).data;
    const frames = Object.entries(tex.frames as Record<string, Phaser.Textures.Frame>).filter(([n]) => n !== '__BASE');
    const rects: GlyphRect[] = [];
    const seen = new Set<string>();
    for (const [, f] of frames) {
      const k = `${f.cutX},${f.cutY},${f.cutWidth},${f.cutHeight}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rects.push({ x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight });
    }
    if (!rects.length) rects.push({ x: 0, y: 0, w, h });
    return glyphSheet(src, w, h, rects, flip).map((px, v) => {
      const gk = `${key}~glyph${flip ? 'f' : ''}${v}`;
      if (tm.exists(gk)) return gk; // survives dev hot reloads
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      const data = ctx.createImageData(w, h);
      data.data.set(px);
      ctx.putImageData(data, 0, 0);
      const t = tm.addCanvas(gk, c)!;
      for (const [n, f] of frames) t.add(n, 0, f.cutX, f.cutY, f.cutWidth, f.cutHeight);
      return gk;
    });
  }

  darkness(alpha: number, holes: { x: number; y: number; r: number }[]): void {
    if (alpha <= 0) return;
    this.darkUsed = true;
    const d = this.dark;
    d.setVisible(true);
    d.clear();
    d.fill(0x05040a, alpha);
    const cam = this.mainCam;
    for (const h of holes) {
      this.hole.setScale((h.r * 2) / 64);
      d.erase(this.hole, h.x - cam.scrollX, h.y - cam.scrollY);
    }
  }
}
