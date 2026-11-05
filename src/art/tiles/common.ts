/**
 * Tileset helpers: a named-tile builder, noise fills and the shared 2-layer wall autotile.
 *
 * WALL AUTOTILE (same layout in every tileset, starting at `wall_top_0`):
 *   wall_top_<m>   m = 0..15, bitmask of neighbours that are NOT wall-top cells:
 *                  1 = north, 2 = east, 4 = south, 8 = west.  (index = wall_top_0 + m)
 *   wall_face_<m>  m = 0..3, bitmask of horizontal neighbours that are NOT wall-face cells:
 *                  1 = east, 2 = west.                          (index = wall_face_0 + m)
 *   floor_shadow   floor cell directly below a wall face (contact shadow).
 * A wall cell is a FACE if the cell below it is not a wall, otherwise a TOP.
 * Out-of-bounds neighbours count as wall tops (no rim at map edges).
 */
import { C } from '../palette';
import { PixBuf } from '../core/pixbuf';
import { hash2 } from '../core/rng';
import { SheetSpec } from '../core/sheet';

export const TS = 16;

export function tile(): PixBuf {
  return new PixBuf(TS, TS);
}

export class TileSetBuilder {
  frames: { name: string; buf: PixBuf }[] = [];
  index: Record<string, number> = {};
  constructor(public key: string, public group: string) {}

  add(name: string, buf: PixBuf): number {
    if (this.index[name] !== undefined) throw new Error(`[art] ${this.key}: duplicate tile ${name}`);
    this.index[name] = this.frames.length;
    this.frames.push({ name, buf });
    return this.index[name];
  }

  /** Pad to the next multiple of 8 so the next block starts on a new row. */
  newRow(): void {
    while (this.frames.length % 8) this.add(`_pad${this.frames.length}`, tile());
  }

  build(meta: Record<string, unknown> = {}): SheetSpec {
    return {
      key: this.key, group: this.group, frameW: TS, frameH: TS, columns: 8, frames: this.frames,
      meta: { tiles: this.index, ...meta },
    };
  }
}

/** Fill with `base` and sprinkle colours by hash. specks: [colour, probability][] */
export function noise(b: PixBuf, base: number, specks: [number, number][], seed: number, region?: [number, number, number, number]): void {
  const [x0, y0, w, h] = region ?? [0, 0, TS, TS];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    let c = base;
    let r = hash2(x, y, seed);
    for (const [col, p] of specks) {
      if (r < p) { c = col; break; }
      r -= p;
    }
    b.set(x, y, c);
  }
}

/** Speckle only existing opaque pixels. */
export function speckle(b: PixBuf, specks: [number, number][], seed: number): void {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (!b.get(x, y)) continue;
    let r = hash2(x, y, seed);
    for (const [col, p] of specks) {
      if (r < p) { b.set(x, y, col); break; }
      r -= p;
    }
  }
}

export interface WallStyle {
  /** Draw the top surface (no rims). */
  top: (b: PixBuf, seed: number) => void;
  /** Draw the vertical face (full 16x16). */
  face: (b: PixBuf, seed: number) => void;
  rimLight: number;
  rimDark: number;
  /** Colour of the face's end-cap shading (east/west ends). */
  faceEdge: number;
  floorShadow: (b: PixBuf) => void;
}

/** Adds wall_top_0..15, wall_face_0..3 and floor_shadow (starting on a fresh row). */
export function addWallSet(t: TileSetBuilder, s: WallStyle): void {
  t.newRow();
  for (let m = 0; m < 16; m++) {
    const b = tile();
    s.top(b, 100 + m);
    if (m & 1) { b.hline(0, 15, 0, s.rimDark); b.hline(0, 15, 1, s.rimLight); }
    if (m & 2) { b.vline(15, 0, 15, s.rimDark); b.vline(14, 0, 15, s.rimLight); }
    if (m & 8) { b.vline(0, 0, 15, s.rimDark); b.vline(1, 0, 15, s.rimLight); }
    if (m & 4) { b.hline(0, 15, 15, s.rimLight); b.hline(0, 15, 14, s.rimLight); b.hline(0, 15, 13, s.rimDark); }
    // corner touch-ups
    if ((m & 1) && (m & 8)) b.set(1, 1, s.rimLight), b.set(0, 0, C.ink);
    if ((m & 1) && (m & 2)) b.set(14, 1, s.rimLight), b.set(15, 0, C.ink);
    t.add(`wall_top_${m}`, b);
  }
  for (let m = 0; m < 4; m++) {
    const b = tile();
    s.face(b, 200 + m);
    b.hline(0, 15, 0, C.ink);
    if (m & 1) { b.vline(15, 1, 15, C.ink); b.vline(14, 1, 15, s.faceEdge); }
    if (m & 2) { b.vline(0, 1, 15, C.ink); b.vline(1, 1, 15, s.faceEdge); }
    t.add(`wall_face_${m}`, b);
  }
  const fs = tile();
  s.floorShadow(fs);
  t.add('floor_shadow', fs);
}

/** Darken the top rows of a floor tile (contact shadow under a wall). */
export function shadowTop(b: PixBuf, map: Record<number, number>, rows = 4): void {
  for (let y = 0; y < rows; y++) for (let x = 0; x < TS; x++) {
    const c = b.get(x, y);
    if (y < rows - 2 || (x + y) % 2 === 0) b.set(x, y, map[c] ?? C.ink);
  }
}

/** A neon tube glyph: draws `pts` polylines with a bright core and coloured edge, plus a dithered halo. */
export function neonTube(b: PixBuf, lines: [number, number, number, number][], core: number, edge: number, halo: number): void {
  const m = new PixBuf(TS, TS);
  for (const [x0, y0, x1, y1] of lines) m.line(x0, y0, x1, y1, 1);
  // halo on empty pixels around tubes
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    if (m.get(x, y)) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (m.get(x + dx, y + dy)) { near = true; break; }
    if (near && ((x + y) & 1) === 0) b.setIfEmpty(x, y, halo);
  }
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    if (!m.get(x, y)) continue;
    const solo = !m.get(x - 1, y) && !m.get(x + 1, y);
    b.set(x, y, solo || (x + y) % 3 ? core : edge);
  }
}

/** Rain streaks over a region (thin diagonal lines). */
export function rainStreaks(b: PixBuf, seed: number, c: number, region: [number, number, number, number], n = 4): void {
  const [x0, y0, w, h] = region;
  for (let i = 0; i < n; i++) {
    const sx = x0 + Math.floor(hash2(i, seed) * w);
    const sy = y0 + Math.floor(hash2(i, seed + 7) * (h - 3));
    const len = 2 + Math.floor(hash2(i, seed + 3) * 3);
    for (let k = 0; k < len; k++) {
      const x = sx + Math.floor(k / 3), y = sy + k;
      if (x < x0 + w && y < y0 + h) b.set(x, y, c);
    }
  }
}
