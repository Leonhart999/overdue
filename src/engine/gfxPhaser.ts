/** Phaser implementation of the immediate-mode Gfx interface (pooled images, texts, shape layers). */
import Phaser from 'phaser';
import type { Gfx, ImgOpts, Layer, TextOpts } from './gfx';

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
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class PhaserGfx implements Gfx {
  private imgs: Phaser.GameObjects.Image[] = [];
  private nImg = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private nText = 0;
  private g: Record<Exclude<Layer, 'world'>, Phaser.GameObjects.Graphics>;
  private order = { floor: 0, top: 0, light: 0, ui: 0, text: 0 };
  private dark: Phaser.GameObjects.RenderTexture;
  private hole: Phaser.GameObjects.Image;
  private darkUsed = false;

  constructor(private scene: Phaser.Scene, private mainCam: Phaser.Cameras.Scene2D.Camera, private uiCam: Phaser.Cameras.Scene2D.Camera) {
    const mk = (depth: number, ui = false) => {
      const gr = scene.add.graphics().setDepth(depth);
      this.filter(gr, ui);
      return gr;
    };
    this.g = { floor: mk(DEPTH.floorG), top: mk(DEPTH.topG), light: mk(DEPTH.lightG), ui: mk(DEPTH.uiG, true) };
    this.g.light.setBlendMode(Phaser.BlendModes.ADD);
    const { width, height } = scene.scale;
    this.dark = scene.add.renderTexture(0, 0, width, height).setOrigin(0, 0).setDepth(DEPTH.dark).setVisible(false);
    this.dark.setScrollFactor(0);
    this.filter(this.dark, false);
    this.hole = scene.make.image({ key: 'fx_hole', add: false });
  }

  /** Show an object on exactly one of the two cameras. */
  private filter(o: Phaser.GameObjects.GameObject, ui: boolean): void {
    (o as unknown as { cameraFilter: number }).cameraFilter = ui ? this.mainCam.id : this.uiCam.id;
  }

  begin(): void {
    this.nImg = 0;
    this.nText = 0;
    this.order = { floor: 0, top: 0, light: 0, ui: 0, text: 0 };
    for (const k of Object.keys(this.g) as (keyof typeof this.g)[]) this.g[k].clear();
    this.darkUsed = false;
  }

  end(): void {
    for (let i = this.nImg; i < this.imgs.length; i++) if (this.imgs[i].visible) this.imgs[i].setVisible(false);
    for (let i = this.nText; i < this.texts.length; i++) if (this.texts[i].visible) this.texts[i].setVisible(false);
    if (!this.darkUsed && this.dark.visible) this.dark.setVisible(false);
  }

  img(key: string, frame: string | number, x: number, y: number, o: ImgOpts = {}): void {
    let im = this.imgs[this.nImg];
    if (!im) {
      im = this.scene.add.image(0, 0, key, frame);
      this.imgs.push(im);
    }
    this.nImg++;
    if (im.texture.key !== key || im.frame.name !== String(frame)) im.setTexture(key, frame);
    const layer = o.layer ?? 'world';
    im.setVisible(true);
    im.setPosition(Math.round(x), Math.round(y));
    im.setOrigin(o.ox ?? 0.5, o.oy ?? 1);
    im.setFlip(!!o.flipX, !!o.flipY);
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
      default: depth = DEPTH.uiImg + this.order.ui++ * 0.01;
    }
    im.setDepth(depth);
    this.filter(im, layer === 'ui');
  }

  text(str: string, x: number, y: number, o: TextOpts = {}): void {
    let t = this.texts[this.nText];
    if (!t) {
      t = this.scene.add.text(0, 0, '', { fontFamily: 'FusionPixel', fontSize: '12px', color: '#ffffff' });
      t.setResolution(1);
      this.texts.push(t);
    }
    this.nText++;
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
    t.setDepth((layer === 'ui' ? DEPTH.uiText : DEPTH.topText) + this.order.text++ * 0.01);
    this.filter(t, layer === 'ui');
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
