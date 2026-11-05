/**
 * PixBuf: an indexed-colour pixel buffer (palette indices, 0 = transparent).
 * All art is drawn into PixBufs and only converted to RGBA when a sheet is rendered.
 */
import { C } from '../palette';

export type Pt = [number, number];

export class PixBuf {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
  /** Optional per-pixel alpha (0..255). Only glow textures use it; null = opaque where px != 0. */
  alpha: Uint8Array | null = null;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }

  set(x: number, y: number, c: number): void {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  /** Set only if the pixel is currently opaque (paint inside existing shapes). */
  setIfOpaque(x: number, y: number, c: number): void {
    if (this.get(x, y) !== 0) this.set(x, y, c);
  }

  /** Set only if the pixel is currently transparent. */
  setIfEmpty(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.get(x, y) === 0) this.set(x, y, c);
  }

  clone(): PixBuf {
    const b = new PixBuf(this.w, this.h);
    b.px.set(this.px);
    if (this.alpha) b.alpha = this.alpha.slice();
    return b;
  }

  clear(): this {
    this.px.fill(0);
    return this;
  }

  fill(c: number): this {
    this.px.fill(c);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: number): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  strokeRect(x: number, y: number, w: number, h: number, c: number): this {
    this.hline(x, x + w - 1, y, c);
    this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c);
    this.vline(x + w - 1, y, y + h - 1, c);
    return this;
  }

  hline(x0: number, x1: number, y: number, c: number): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
    return this;
  }

  vline(x: number, y0: number, y1: number, c: number): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
    return this;
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled capsule: every pixel whose centre is within r of segment a-b. */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, c: number): this {
    const minX = Math.floor(Math.min(x0, x1) - r - 1), maxX = Math.ceil(Math.max(x0, x1) + r + 1);
    const minY = Math.floor(Math.min(y0, y1) - r - 1), maxY = Math.ceil(Math.max(y0, y1) + r + 1);
    const vx = x1 - x0, vy = y1 - y0;
    const len2 = vx * vx + vy * vy || 1e-6;
    const r2 = r * r;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = ((px - x0) * vx + (py - y0) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x0 + vx * t - px, qy = y0 + vy * t - py;
        if (qx * qx + qy * qy <= r2) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Filled ellipse centred on (cx, cy) in pixel-centre coordinates. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): this {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  circle(cx: number, cy: number, r: number, c: number): this {
    return this.ellipse(cx, cy, r, r, c);
  }

  /** Ring (outline of a circle) of thickness ~1. */
  ring(cx: number, cy: number, r: number, c: number, thickness = 1): this {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r - thickness) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Filled polygon (even-odd, sampled at pixel centres). Points are in pixel units. */
  poly(pts: Pt[], c: number): this {
    if (pts.length < 3) return this;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.set(x, y, c);
      }
    }
    return this;
  }

  /**
   * Copy src onto this buffer. Transparent source pixels are skipped.
   * `map` can recolour on the fly (return 0 to skip a pixel).
   */
  blit(src: PixBuf, dx: number, dy: number, opts: { flipX?: boolean; flipY?: boolean; map?: (c: number) => number; only?: 'opaque' | 'empty' } = {}): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        let c = src.px[y * src.w + x];
        if (!c) continue;
        if (opts.map) { c = opts.map(c); if (!c) continue; }
        const tx = dx + (opts.flipX ? src.w - 1 - x : x);
        const ty = dy + (opts.flipY ? src.h - 1 - y : y);
        if (opts.only === 'opaque' && this.get(tx, ty) === 0) continue;
        if (opts.only === 'empty' && this.get(tx, ty) !== 0) continue;
        this.set(tx, ty, c);
        if (src.alpha) {
          if (!this.alpha) { this.alpha = new Uint8Array(this.w * this.h); this.alpha.fill(255); }
          if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.alpha[ty * this.w + tx] = src.alpha[y * src.w + x];
        }
      }
    }
    return this;
  }

  /** Copy a sub-rectangle into a new buffer. */
  crop(x: number, y: number, w: number, h: number): PixBuf {
    const b = new PixBuf(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) b.px[j * w + i] = this.get(x + i, y + j);
    return b;
  }

  flipX(): PixBuf {
    const b = new PixBuf(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.px[y * this.w + (this.w - 1 - x)] = this.px[y * this.w + x];
    return b;
  }

  /** Recolour in place: map palette index -> palette index. */
  recolor(map: Record<number, number> | ((c: number, x: number, y: number) => number)): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x, c = this.px[i];
        if (!c) continue;
        this.px[i] = typeof map === 'function' ? map(c, x, y) : (map[c] ?? c);
      }
    }
    return this;
  }

  /**
   * Move a rectangular region by (dx, dy). Vacated pixels become transparent.
   * Used for walk frames (lift a leg) and breathing (shift the upper body).
   */
  shiftRegion(x: number, y: number, w: number, h: number, dx: number, dy: number): this {
    const part = this.crop(x, y, w, h);
    this.rect(x, y, w, h, 0);
    this.blit(part, x + dx, y + dy);
    return this;
  }

  /**
   * Add a 1px outline around every opaque pixel (4-neighbourhood, plus diagonals if `diag`).
   * Returns this buffer. Pixels that are already opaque are never changed.
   */
  outline(c: number = C.ink, diag = false): this {
    const src = this.px.slice();
    const w = this.w, h = this.h;
    const op = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[y * w + x] !== 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (src[y * w + x]) continue;
        if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1) ||
          (diag && (op(x - 1, y - 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x + 1, y + 1)))) {
          this.px[y * w + x] = c;
        }
      }
    }
    return this;
  }

  /** Count opaque pixels (used by tests / sanity checks). */
  opaqueCount(): number {
    let n = 0;
    for (const v of this.px) if (v) n++;
    return n;
  }
}

/** A boolean mask the same size as a PixBuf, used to shade a single part. */
export class Mask {
  readonly w: number;
  readonly h: number;
  readonly m: Uint8Array;
  constructor(w: number, h: number) { this.w = w; this.h = h; this.m = new Uint8Array(w * h); }
  has(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.m[y * this.w + x] === 1; }
  /** Draw into the mask using any PixBuf drawing call. */
  draw(fn: (b: PixBuf) => void): this {
    const b = new PixBuf(this.w, this.h);
    fn(b);
    for (let i = 0; i < b.px.length; i++) if (b.px[i]) this.m[i] = 1;
    return this;
  }
  /** Remove pixels drawn by fn. */
  cut(fn: (b: PixBuf) => void): this {
    const b = new PixBuf(this.w, this.h);
    fn(b);
    for (let i = 0; i < b.px.length; i++) if (b.px[i]) this.m[i] = 0;
    return this;
  }
}

export interface ShadeOpts {
  /** Ramp of palette indices, dark -> light. */
  ramp: readonly number[];
  /** Index into the ramp used as the base fill. Default: ramp.length - 2. */
  base?: number;
  /** Light comes from this direction (unit grid steps). Default upper-right (facing-right sprites). */
  light?: Pt;
  /** Paint pixels on the boundary next to other opaque pixels with ramp[0] (separates overlapping parts). */
  innerLine?: boolean;
  /** Extra "core shadow" one pixel in from the shadow edge. */
  deepShadow?: boolean;
  /** Rim light colour on the side opposite to the key light (neon spill). */
  rim?: number;
  /** Dither the transition between base and shadow on large parts. */
  dither?: boolean;
}

/**
 * Fill a mask into `dst` with cel shading: edges facing the light get the next lighter ramp
 * step, edges facing away get the next darker step. This is the workhorse behind the rigs.
 */
export function shadeInto(dst: PixBuf, mask: Mask, o: ShadeOpts): void {
  const ramp = o.ramp;
  const bi = o.base ?? Math.max(0, ramp.length - 2);
  const [lx, ly] = o.light ?? [1, -1];
  const hi = ramp[Math.min(ramp.length - 1, bi + 1)];
  const mid = ramp[bi];
  const lo = ramp[Math.max(0, bi - 1)];
  const lo2 = ramp[Math.max(0, bi - 2)];
  const w = mask.w, h = mask.h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask.has(x, y)) continue;
      let c = mid;
      const towardLight = (lx !== 0 && !mask.has(x + lx, y)) || (ly !== 0 && !mask.has(x, y + ly));
      const awayLight = (lx !== 0 && !mask.has(x - lx, y)) || (ly !== 0 && !mask.has(x, y - ly));
      const away2 = (lx !== 0 && !mask.has(x - 2 * lx, y)) || (ly !== 0 && !mask.has(x, y - 2 * ly));
      if (awayLight) c = lo;
      else if (o.deepShadow && away2) c = lo;
      else if (o.dither && away2 && ((x + y) & 1)) c = lo;
      if (towardLight && !awayLight) c = hi;
      if (o.rim !== undefined && awayLight && (lx !== 0 ? !mask.has(x - lx, y) : true)) {
        // rim only on the side edge, not on bottoms
        if (lx !== 0 && !mask.has(x - lx, y)) c = o.rim;
      }
      if (o.innerLine) {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !mask.has(x + dx, y + dy) && dst.get(x + dx, y + dy) !== 0);
        if (edge && c !== hi) c = lo2;
      }
      dst.set(x, y, c);
    }
  }
}
