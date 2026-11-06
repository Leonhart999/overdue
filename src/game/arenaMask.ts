/**
 * Arena outlines as tile masks. One mask drives both the baked background walls
 * (src/art/arenas.ts autotiles it) and the collision walls inside the playable bounds,
 * so the art and the physics cannot disagree. Tiles are 16 px on the 40x23 screen grid.
 */
import type { Rect } from '../engine/math';

export const TILE = 16;
export const MASK_COLS = 40;
export const MASK_ROWS = 23;

/** true = wall tile. Columns 0-39, rows 0-22. */
export type TileMask = (c: number, r: number) => boolean;

/** The border every arena has: top rows 0-2, bottom rows 21-22, side columns 0 and 39. */
export const borderMask: TileMask = (c, r) => r <= 2 || r >= 21 || c === 0 || c === 39;

/**
 * Collision rects for the mask's wall tiles inside `bounds` (World already walls off everything
 * outside the bounds). Each row's runs become rects; identical runs on consecutive rows merge.
 */
export function maskWalls(mask: TileMask, bounds: Rect): Rect[] {
  const c0 = Math.floor(bounds.x / TILE), c1 = Math.ceil((bounds.x + bounds.w) / TILE);
  const r0 = Math.floor(bounds.y / TILE), r1 = Math.ceil((bounds.y + bounds.h) / TILE);
  const out: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let r = r0; r < r1; r++) {
    const next = new Map<string, Rect>();
    let c = c0;
    while (c < c1) {
      if (!mask(c, r)) { c++; continue; }
      const s = c;
      while (c < c1 && mask(c, r)) c++;
      const key = `${s}:${c - s}`;
      const prev = open.get(key);
      if (prev) {
        prev.h += TILE;
        next.set(key, prev);
      } else {
        const rc = { x: s * TILE, y: r * TILE, w: (c - s) * TILE, h: TILE };
        out.push(rc);
        next.set(key, rc);
      }
    }
    open = next;
  }
  return out;
}
