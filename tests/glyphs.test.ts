import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, GLYPH_VARIANTS, glyphSheet } from '../src/art/glyphs';
import { PALETTE_RGB } from '../src/art/palette';

/** RGBA buffer filled with one palette colour inside the given box. */
function sheet(w: number, h: number, box: { x: number; y: number; w: number; h: number }, colour: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  const [r, g, b] = PALETTE_RGB[colour];
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) px.set([r, g, b, 255], (y * w + x) * 4);
  return px;
}

const opaqueCells = (px: Uint8ClampedArray, w: number, h: number) => {
  const cells = new Set<string>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]) cells.add(`${Math.floor(x / CELL_W)},${Math.floor(y / CELL_H)}`);
  return cells;
};

describe('glyph art', () => {
  it('keeps transparent pixels empty and draws glyphs where the sprite is', () => {
    const w = 24, h = 24;
    const src = sheet(w, h, { x: 0, y: 0, w: 12, h: 24 }, 9);
    const out = glyphSheet(src, w, h, [{ x: 0, y: 0, w, h }]);
    expect(out).toHaveLength(GLYPH_VARIANTS);
    const cells = opaqueCells(out[0], w, h);
    expect(cells.size).toBe(3 * 4); // left 12 px = 3 cell columns, 24 px = 4 rows
    for (const c of cells) expect(Number(c.split(',')[0])).toBeLessThan(3);
  });

  it('flip mirrors the cells inside each frame', () => {
    const w = 24, h = 12;
    const src = sheet(w, h, { x: 0, y: 0, w: 4, h: 12 }, 9);
    const [normal] = glyphSheet(src, w, h, [{ x: 0, y: 0, w, h }]);
    const [flipped] = glyphSheet(src, w, h, [{ x: 0, y: 0, w, h }], true);
    expect([...opaqueCells(normal, w, h)].every((c) => c.startsWith('0,'))).toBe(true);
    expect([...opaqueCells(flipped, w, h)].every((c) => c.startsWith('5,'))).toBe(true);
  });

  it('variants change some glyphs but not the silhouette', () => {
    const w = 48, h = 48;
    const src = sheet(w, h, { x: 0, y: 0, w, h }, 7);
    const out = glyphSheet(src, w, h, [{ x: 0, y: 0, w, h }]);
    expect(opaqueCells(out[1], w, h)).toEqual(opaqueCells(out[0], w, h));
    expect(out[1]).not.toEqual(out[0]);
  });
});
