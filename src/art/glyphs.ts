/**
 * Glyph art: redraw a sprite sheet as a grid of tiny 3x5 characters (the jack arm's "hacked" look).
 *
 * Pure pixel code (no DOM) so it runs in tests; gfxPhaser.ts turns the result into textures.
 * Each 4x6 cell of a frame becomes one glyph: denser glyphs for brighter cells, coloured with the
 * cell's main palette colour (dark colours lifted so they stay visible on the dark floors).
 * Several variants are produced; about a third of the cells change glyph between variants, so
 * cycling them makes the characters shimmer while the silhouette holds still.
 */
import { C, PALETTE_RGB } from './palette';

export const CELL_W = 4;
export const CELL_H = 6;
export const GLYPH_VARIANTS = 3;

/** 3x5 bitmaps, rows top to bottom. */
const GLYPHS: Record<string, string[]> = {
  '.': ['000', '000', '000', '000', '010'],
  ':': ['000', '010', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '+': ['000', '010', '111', '010', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '=': ['000', '111', '000', '111', '000'],
  '7': ['111', '001', '010', '010', '010'],
  '1': ['010', '110', '010', '010', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '3': ['111', '001', '011', '001', '111'],
  '5': ['111', '100', '111', '001', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '8': ['111', '101', '111', '101', '111'],
  '#': ['101', '111', '101', '111', '101'],
};

/** Glyphs by brightness level, sparse to dense. */
const LEVELS: string[][] = [
  ['.', ':'],
  ['-', '+', '/'],
  ['=', '7', '1'],
  ['4', '3', '5'],
  ['0', '8', '#'],
];

const BITS: Record<string, boolean[]> = Object.fromEntries(
  Object.entries(GLYPHS).map(([k, rows]) => [k, rows.join('').split('').map((b) => b === '1')]),
);

/** Dark palette colours drawn one ramp step or two lighter. */
const LIFT: Partial<Record<number, number>> = {
  [C.ink]: C.slate, [C.night]: C.slate, [C.navy]: C.steel, [C.indigo]: C.steel, [C.slate]: C.fog,
  [C.plum]: C.orchid, [C.grape]: C.orchid, [C.abyss]: C.teal, [C.moss]: C.lime,
  [C.maroon]: C.red, [C.umber]: C.rust, [C.skinX]: C.skinD,
};

/** One cell in six (it moves between variants) is drawn in the hack colour. */
const ACCENT = C.acid;

const rgbKey = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const PAL_INDEX = new Map<number, number>(PALETTE_RGB.map(([r, g, b], i) => [rgbKey(r, g, b), i]));

function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export interface GlyphRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Glyph versions of an RGBA sheet (`width * height * 4` bytes), one buffer per variant, same size.
 * Only pixels inside `rects` (the frames) are processed; cells never cross a frame edge.
 * `flip` reads every frame mirrored, so a sprite drawn with flipX can use it unflipped and keep
 * its characters the right way round.
 */
export function glyphSheet(src: ArrayLike<number>, width: number, height: number, rects: GlyphRect[], flip = false): Uint8ClampedArray[] {
  const out = Array.from({ length: GLYPH_VARIANTS }, () => new Uint8ClampedArray(width * height * 4));
  const counts = new Uint16Array(PALETTE_RGB.length + 1);
  rects.forEach((rc, fi) => {
    const cols = Math.ceil(rc.w / CELL_W), rows = Math.ceil(rc.h / CELL_H);
    const lum = new Float32Array(cols * rows).fill(-1);
    const col = new Int32Array(cols * rows).fill(-1);
    const edge = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        counts.fill(0);
        let n = 0, sum = 0, area = 0, raw = -1;
        for (let py = cy * CELL_H; py < Math.min(rc.h, (cy + 1) * CELL_H); py++) {
          for (let px = cx * CELL_W; px < Math.min(rc.w, (cx + 1) * CELL_W); px++) {
            area++;
            const sx = rc.x + (flip ? rc.w - 1 - px : px), sy = rc.y + py;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            const o = (sy * width + sx) * 4;
            if (src[o + 3] < 128) continue;
            const r = src[o], g = src[o + 1], b = src[o + 2];
            n++;
            sum += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const pi = PAL_INDEX.get(rgbKey(r, g, b));
            if (pi !== undefined) counts[pi]++;
            else raw = rgbKey(r, g, b);
          }
        }
        if (n < 4 || n < area * 0.2) continue;
        const i = cy * cols + cx;
        lum[i] = sum / n;
        // main colour: the most common one, ignoring outline ink unless the cell is only ink
        let best = -1;
        for (let k = 1; k < counts.length; k++) if (k !== C.ink && counts[k] > 0 && (best < 0 || counts[k] > counts[best])) best = k;
        if (best < 0 && counts[C.ink] > 0) best = C.ink;
        if (best < 0 && raw < 0) best = C.slate;
        col[i] = best >= 0 ? -2 - best : raw; // palette colours stored as -2 - index
        edge[i] = n < area * 0.45 ? 1 : 0; // ragged edge cells stay sparse
      }
    }
    // Density by brightness rank inside the frame (ties share a rank), so dark sprites still get
    // dense glyphs. Solid cells use levels 1-4, ragged edge cells 0-1.
    const sorted = Array.from(lum).filter((v, i) => v >= 0 && !edge[i]).sort((a, b) => a - b);
    const bound = (v: number, orEqual: boolean) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (sorted[m] < v || (orEqual && sorted[m] === v)) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    const rank = (v: number) => (sorted.length ? (bound(v, false) + bound(v, true)) / 2 / sorted.length : 0.5);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (lum[i] < 0) continue;
        const q = rank(lum[i]);
        const level = edge[i] ? (q > 0.5 ? 1 : 0) : 1 + Math.min(3, Math.floor(q * 4));
        const bucket = LEVELS[level];
        const h = hash(cx, cy, fi);
        const moving = h % 3 === 0;
        let rgb: [number, number, number];
        if (col[i] <= -2) {
          const pi = -2 - col[i];
          rgb = PALETTE_RGB[LIFT[pi] ?? pi];
        } else rgb = [(col[i] >> 16) & 255, (col[i] >> 8) & 255, col[i] & 255];
        for (let v = 0; v < GLYPH_VARIANTS; v++) {
          const ch = bucket[((h >>> 4) + (moving ? v : 0)) % bucket.length];
          const accent = ((h >>> 8) + v * 2) % 6 === 0;
          const [r, g, b] = accent ? PALETTE_RGB[ACCENT] : rgb;
          const bits = BITS[ch], buf = out[v];
          for (let gy = 0; gy < 5; gy++) {
            const py = cy * CELL_H + gy;
            if (py >= rc.h) break;
            for (let gx = 0; gx < 3; gx++) {
              const px = cx * CELL_W + gx;
              if (px >= rc.w || !bits[gy * 3 + gx]) continue;
              const o = ((rc.y + py) * width + rc.x + px) * 4;
              buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
            }
          }
        }
      }
    }
  });
  return out;
}
