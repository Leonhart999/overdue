/**
 * Arena backgrounds: one 640x360 texture per arena (floor + walls baked together).
 * Built from tilesets with the shared wall autotile, then decorated per arena.
 */
import { C } from './palette';
import { PixBuf } from './core/pixbuf';
import { hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { autotileWalls } from './tiles/autotile';
import { buildJunkyard } from './tiles/junkyard';
import { YARD, yardMask } from '../game/arenas/scrapyard';

export const BG_W = 640;
export const BG_H = 360;

function tilesOf(spec: SheetSpec): (name: string) => PixBuf {
  const idx = (spec.meta?.tiles ?? {}) as Record<string, number>;
  return (name: string) => {
    const i = idx[name];
    if (i === undefined) throw new Error(`[art] ${spec.key}: no tile ${name}`);
    return spec.frames[i].buf;
  };
}

/**
 * Lay out a tile map of `size` pixels (default one screen, 40x23 tiles; a scrolling map passes its
 * Arena.size). `isWall` decides wall cells; `floor` picks floor tile names.
 */
export function tiled(spec: SheetSpec, isWall: (x: number, y: number) => boolean, floor: (x: number, y: number) => string, size = { w: BG_W, h: BG_H }): PixBuf {
  const T = tilesOf(spec);
  const cols = Math.ceil(size.w / 16), rows = Math.ceil(size.h / 16);
  const out = new PixBuf(size.w, size.h);
  const at = autotileWalls(cols, rows, isWall);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wall = at.wall[y][x];
      const name = wall ?? (at.shadow[y][x] ? 'floor_shadow' : floor(x, y));
      out.blit(T(name), x * 16, y * 16);
    }
  }
  return out;
}

function scrapyard(): PixBuf {
  const spec = buildJunkyard();
  const T = tilesOf(spec);
  // walls from the shared mask: border plus the stepped scrap heaps in the corners
  const b = tiled(spec, yardMask, (x, y) => {
    const h = hash2(x, y, 5);
    return `floor_${Math.floor(h * 4)}`;
  });
  // scrap heaps and tyres on the wall tops and piled into the corners
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(hash2(i, 1, 7) * 38) + 1;
    const top = hash2(i, 2, 7) < 0.6;
    const y = top ? 0 : 21;
    const t = T(hash2(i, 3, 7) < 0.5 ? 'scrap_big' : hash2(i, 4, 7) < 0.5 ? 'scrap_small' : 'tires');
    b.blit(t, x * 16, y * 16 - (top ? 2 : 0));
  }
  for (const [cx, cy] of [[1, 3], [2, 3], [3, 3], [1, 4], [36, 3], [37, 3], [38, 3], [38, 4], [1, 19], [2, 20], [3, 20], [37, 20], [36, 20], [38, 19]] as [number, number][]) {
    const t = T(hash2(cx, cy, 8) < 0.5 ? 'scrap_big' : 'tires');
    b.blit(t, cx * 16, cy * 16 - 4);
  }
  // hydraulic rams behind the compactor plates on both side walls
  const { y0, y1 } = YARD.plates;
  for (let y = y0; y < y1; y += 24) {
    for (const x of [4, 628]) { b.rect(x, y + 6, 8, 4, C.slate); b.hline(x, x + 7, y + 6, C.fog); b.hline(x, x + 7, y + 9, C.ink); }
  }
  // the drop line: yellow/black paint down the crane rail, with end markers
  const { x: rx, y0: ry0, y1: ry1 } = YARD.rail;
  for (let y = ry0 - 8; y <= ry1 + 8; y++) {
    if (hash2(rx, y, 3) > 0.85) continue;
    const c = (y >> 3) % 2 === 0 ? C.sodium : C.ink;
    for (const x of [rx - 2, rx - 1, rx + 1, rx + 2]) b.set(x, y, c);
  }
  for (const y of [ry0 - 10, ry1 + 10]) b.hline(rx - 10, rx + 10, y, C.sodium);
  // faded lane paint along the three ram lanes
  for (const ly of [84, 200, 306]) {
    for (let x = 40; x < 600; x++) {
      if ((x >> 4) % 2 === 0 && Math.abs(x - rx) > 14 && hash2(x, ly, 9) < 0.7) b.set(x, ly, C.umber);
    }
  }
  return b;
}

export function buildArenaBackgrounds(): SheetSpec[] {
  return [
    { key: 'bg_scrapyard', group: 'Arenas', frameW: BG_W, frameH: BG_H, frames: [{ name: 'bg', buf: scrapyard() }] },
  ];
}
