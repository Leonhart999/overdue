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

/** Lay out a 40x23 tile map. `isWall` decides wall cells; `floor` picks floor tile names. */
function tiled(spec: SheetSpec, isWall: (x: number, y: number) => boolean, floor: (x: number, y: number) => string): PixBuf {
  const T = tilesOf(spec);
  const cols = 40, rows = 23;
  const out = new PixBuf(BG_W, BG_H);
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
  // walls: two rows of wall top + one face row at the top, one column each side, two rows at the bottom
  const isWall = (x: number, y: number) => y <= 2 || y >= 21 || x === 0 || x === 39;
  const b = tiled(spec, isWall, (x, y) => {
    const h = hash2(x, y, 5);
    if (x >= 16 && x <= 23 && y >= 9 && y <= 13) return 'floor_plate';
    return `floor_${Math.floor(h * 4)}`;
  });
  // scrap heaps and tyres on the wall tops for silhouette variety
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(hash2(i, 1, 7) * 38) + 1;
    const top = hash2(i, 2, 7) < 0.6;
    const y = top ? 0 : 21;
    const t = T(hash2(i, 3, 7) < 0.5 ? 'scrap_big' : hash2(i, 4, 7) < 0.5 ? 'scrap_small' : 'tires');
    b.blit(t, x * 16, y * 16 - (top ? 2 : 0));
  }
  // gantry rails on the side walls
  for (let y = 40; y < 336; y++) {
    for (const x of [6, 9, 630, 633]) b.set(x, y, y % 8 === 0 ? C.ink : C.steel);
  }
  // painted lines: a faded hazard circle in the middle and drop markers
  for (let a = 0; a < Math.PI * 2; a += 0.01) {
    const x = Math.round(320 + Math.cos(a) * 64), y = Math.round(200 + Math.sin(a) * 40);
    if (Math.floor(a * 12) % 2 === 0 && hash2(x, y, 3) < 0.75) b.set(x, y, C.rust);
  }
  for (let x = 24; x < 616; x++) {
    if ((x >> 3) % 2 === 0 && hash2(x, 1, 9) < 0.8) { b.set(x, 330, C.umber); b.set(x, 331, C.umber); }
  }
  return b;
}

export function buildArenaBackgrounds(): SheetSpec[] {
  return [
    { key: 'bg_scrapyard', group: 'Arenas', frameW: BG_W, frameH: BG_H, frames: [{ name: 'bg', buf: scrapyard() }] },
  ];
}
