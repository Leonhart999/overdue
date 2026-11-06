/**
 * Crisp pixel text: a string is rendered once into a hard-edged texture (FusionPixel 12 px with
 * the alpha thresholded, or the 3x5 micro font), optionally with a baked 1 px outline and drop
 * shadow, or turned into a rotated rubber stamp. Textures are cached by (string, style) and drawn
 * at integer scale, so headings never blur.
 *
 * Everything here is DOM-guarded: in node (tests, NullGfx) `crispTex` returns null and
 * `textWidth` falls back to an estimate (CJK 12 px, ASCII 6 px).
 */
import type Phaser from 'phaser';
import type { CrispStyle } from '../engine/gfx';
import { MICRO_H, microGlyph, microWidth } from '../art/uiKit';
import { PALETTE_RGB } from '../art/palette';

/** Glyph box height of FusionPixel 12 px (baseline at 10, descenders to 12). */
export const FUSION_H = 12;
const BASELINE = 10;
const FONT = '12px FusionPixel';
const RASTER = 4;
const PALETTE_WHITE = (() => { const [r, g, b] = PALETTE_RGB[9]; return (r << 16) | (g << 8) | b; })();

export interface CrispTex {
  key: string;
  /** Texture size in pixels (unscaled), including outline/shadow pads. */
  w: number;
  h: number;
  /** Width of the text itself (advance), without pads. */
  tw: number;
  /** Pixels of outline padding on the left/top. */
  pad: number;
}

const hasDom = (): boolean => typeof document !== 'undefined';
let measureCtx: CanvasRenderingContext2D | null = null;
const advance = new Map<string, number>();
const cache = new Map<string, CrispTex>();

function fontReady(): boolean {
  if (!hasDom()) return false;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  try { return !fonts || fonts.check(FONT); } catch { return true; }
}

function measurer(): CanvasRenderingContext2D | null {
  if (!hasDom()) return null;
  if (!measureCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
}

function fusionAdvance(ch: string): number {
  const known = advance.get(ch);
  if (known !== undefined) return known;
  const ctx = fontReady() ? measurer() : null;
  if (!ctx) return ch.charCodeAt(0) < 0x2e80 ? 6 : 12;
  ctx.font = `${12 * RASTER}px FusionPixel`;
  const w = Math.round(ctx.measureText(ch).width / RASTER);
  advance.set(ch, w);
  return w;
}

/** Width in pixels of `str` as crisp text (the layout width, before outline pads). */
export function textWidth(str: string, o: { font?: 'fusion' | 'micro'; spacing?: number; scale?: number } = {}): number {
  const s = o.scale ?? 1;
  const sp = o.spacing ?? 0;
  if (o.font === 'micro') return microWidth(str, sp) * s;
  let w = 0, n = 0;
  for (const ch of str) { w += fusionAdvance(ch); n++; }
  return (w + Math.max(0, n - 1) * sp) * s;
}

/** Glyph box height of a font (unscaled). */
export function textHeight(font?: 'fusion' | 'micro'): number {
  return font === 'micro' ? MICRO_H : FUSION_H;
}

// ------------------------------------------------------------------ rasterising

interface Mask { w: number; h: number; m: Uint8Array }

function newMask(w: number, h: number): Mask { return { w, h, m: new Uint8Array(Math.max(1, w * h)) }; }

function glyphMask(str: string, font: 'fusion' | 'micro', spacing: number): Mask | null {
  if (font === 'micro') {
    const out = newMask(microWidth(str, spacing), MICRO_H);
    let x = 0;
    for (const ch of str) {
      const g = microGlyph(ch);
      g.forEach((row, y) => row.forEach((on, gx) => { if (on) out.m[y * out.w + x + gx] = 1; }));
      x += g[0].length + 1 + spacing;
    }
    return out;
  }
  if (!fontReady()) return null;
  const tw = textWidth(str, { spacing });
  // Canvas text at 12 px is anti-aliased off the pixel grid. Render at 4x instead, where each
  // font pixel is a 4x4 block, and sample block centres: that recovers the exact glyph pixels.
  const S = RASTER;
  const W = tw + 4, Hc = FUSION_H + 4;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = Hc * S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = `${12 * S}px FusionPixel`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  let x = 0;
  for (const ch of str) {
    ctx.fillText(ch, x * S, (2 + BASELINE) * S);
    x += fusionAdvance(ch) + spacing;
  }
  const data = ctx.getImageData(0, 0, W * S, Hc * S).data;
  const out = newMask(W, FUSION_H);
  for (let y = 0; y < FUSION_H; y++) for (let xx = 0; xx < W; xx++) {
    if (data[(((y + 2) * S + S / 2) * W * S + xx * S + S / 2) * 4 + 3] > 127) out.m[y * W + xx] = 1;
  }
  // trim the right slack to the advance or the last inked column, whichever is wider
  let right = tw;
  for (let xx = W - 1; xx >= tw; xx--) {
    let ink = false;
    for (let y = 0; y < FUSION_H; y++) if (out.m[y * W + xx]) { ink = true; break; }
    if (ink) { right = xx + 1; break; }
  }
  if (right === W) return out;
  const t = newMask(right, FUSION_H);
  for (let y = 0; y < FUSION_H; y++) for (let xx = 0; xx < right; xx++) t.m[y * right + xx] = out.m[y * W + xx];
  return t;
}

/** Deterministic hash noise in 0..1. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function stampMask(text: Mask, glyph: number, angleDeg: number, seed: number): Mask {
  const g = glyph;
  const P = 3 * g + 2;
  const sw = text.w * g + 2 * P, shh = text.h * g + 2 * P;
  const s = newMask(sw, shh);
  // double border: thick outer frame, thin inner line
  for (let y = 0; y < shh; y++) for (let x = 0; x < sw; x++) {
    const d = Math.min(x, y, sw - 1 - x, shh - 1 - y);
    if (d < g || d === g + 1) s.m[y * sw + x] = 1;
  }
  for (let y = 0; y < text.h * g; y++) for (let x = 0; x < text.w * g; x++) {
    if (text.m[Math.floor(y / g) * text.w + Math.floor(x / g)]) s.m[(y + P) * sw + x + P] = 1;
  }
  // rotate with nearest sampling so the result stays on the pixel grid
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const ow = Math.ceil(Math.abs(sw * ca) + Math.abs(shh * sa)) + 2;
  const oh = Math.ceil(Math.abs(sw * sa) + Math.abs(shh * ca)) + 2;
  const out = newMask(ow, oh);
  const cxo = ow / 2, cyo = oh / 2, cxs = sw / 2, cys = shh / 2;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const dx = x + 0.5 - cxo, dy = y + 0.5 - cyo;
    const sx = Math.floor(ca * dx + sa * dy + cxs), sy = Math.floor(-sa * dx + ca * dy + cys);
    if (sx < 0 || sy < 0 || sx >= sw || sy >= shh || !s.m[sy * sw + sx]) continue;
    // distress: worn patches plus scattered missing pixels
    const patch = hash(Math.floor(x / 5), Math.floor(y / 4), seed);
    const grain = hash(x, y, seed + 7);
    if ((patch > 0.86 && grain > 0.45) || grain > 0.97) continue;
    out.m[y * ow + x] = 1;
  }
  return out;
}

function compose(mask: Mask, color: number, outline: number | undefined, shadow: number | undefined): { canvas: HTMLCanvasElement; pad: number } {
  const pad = outline !== undefined ? 1 : 0;
  const sh = shadow !== undefined ? 1 : 0;
  const W = mask.w + 2 * pad + sh, H = mask.h + 2 * pad + sh;
  const idx = new Uint8Array(W * H); // 0 empty, 1 glyph, 2 outline, 3 shadow
  for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) if (mask.m[y * mask.w + x]) idx[(y + pad) * W + x + pad] = 1;
  if (pad) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (idx[y * W + x]) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && idx[yy * W + xx] === 1) { near = true; break; }
      }
      if (near) idx[y * W + x] = 2;
    }
  }
  if (sh) {
    for (let y = H - 1; y >= 1; y--) for (let x = W - 1; x >= 1; x--) {
      const src = idx[(y - 1) * W + x - 1];
      if (!idx[y * W + x] && (src === 1 || src === 2)) idx[y * W + x] = 3;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const cols = [null, rgb(color), rgb(outline ?? 0), rgb(shadow ?? 0)];
  for (let i = 0; i < W * H; i++) {
    const c = cols[idx[i]];
    if (!c) continue;
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, pad };
}

/**
 * Texture for a crisp string (built on first use, then cached). Returns null without a DOM or
 * before the pixel font has loaded; callers then fall back to plain Phaser text.
 */
export function crispTex(tm: Phaser.Textures.TextureManager, str: string, st: CrispStyle = {}): CrispTex | null {
  if (!hasDom()) return null;
  const font = st.font ?? 'fusion';
  const color = st.color ?? PALETTE_WHITE;
  const sp = st.spacing ?? 0;
  const stamp = st.stamp;
  const id = `${font}|${color}|${st.outline ?? -1}|${st.shadow ?? -1}|${sp}|${stamp ? `${stamp.angle},${stamp.glyph ?? 2},${stamp.seed ?? 1}` : ''}|${str}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const m = glyphMask(str, font, sp);
  if (!m) return null;
  const key = 'crisp:' + id;
  const tw = font === 'micro' ? m.w : textWidth(str, { spacing: sp });
  let entry: CrispTex;
  if (stamp) {
    const sm = stampMask(m, stamp.glyph ?? 2, stamp.angle, stamp.seed ?? 1);
    if (!tm.exists(key)) tm.addCanvas(key, compose(sm, color, undefined, undefined).canvas);
    entry = { key, w: sm.w, h: sm.h, tw: sm.w, pad: 0 };
  } else {
    const pad = st.outline !== undefined ? 1 : 0, sh = st.shadow !== undefined ? 1 : 0;
    if (!tm.exists(key)) tm.addCanvas(key, compose(m, color, st.outline, st.shadow).canvas);
    entry = { key, w: m.w + 2 * pad + sh, h: m.h + 2 * pad + sh, tw, pad };
  }
  cache.set(id, entry);
  return entry;
}

