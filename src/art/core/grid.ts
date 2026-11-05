/** String-grid sprites: each character maps to a palette index via a legend ('.' = transparent). */
import { DEFAULT_LEGEND } from '../palette';
import { PixBuf } from './pixbuf';

export type Legend = Record<string, number>;

/**
 * Parse a grid. Accepts an array of rows or a multi-line template string (blank lines and
 * leading/trailing whitespace are ignored; use '.' for transparent pixels).
 * Throws if rows have different widths or a character is missing from the legend.
 */
export function grid(src: string | string[], legend: Legend = DEFAULT_LEGEND, name = 'grid'): PixBuf {
  const rows = (Array.isArray(src) ? src : src.split('\n')).map((r) => r.trim()).filter((r) => r.length > 0);
  const w = rows[0]?.length ?? 0;
  const b = new PixBuf(w, rows.length);
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`[art] ${name}: row ${y} has width ${r.length}, expected ${w}: "${r}"`);
    for (let x = 0; x < w; x++) {
      const ch = r[x];
      const c = legend[ch];
      if (c === undefined) throw new Error(`[art] ${name}: unknown char '${ch}' at ${x},${y}`);
      b.px[y * w + x] = c;
    }
  });
  return b;
}

/** Legend = DEFAULT_LEGEND plus overrides. */
export function legend(over: Legend): Legend {
  return { ...DEFAULT_LEGEND, ...over };
}

/** Place a grid into a frame of size (w, h) at (x, y). */
export function framed(src: PixBuf, w: number, h: number, x: number, y: number): PixBuf {
  const b = new PixBuf(w, h);
  b.blit(src, x, y);
  return b;
}
