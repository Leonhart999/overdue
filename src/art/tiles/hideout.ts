/**
 * Hideout interior tileset `tiles_hideout`: a converted container flat. Warm desk light,
 * city glow through the window, concrete + plank floor.
 */
import { C } from '../palette';
import { PixBuf } from '../core/pixbuf';
import { hash2 } from '../core/rng';
import { SheetSpec } from '../core/sheet';
import { addWallSet, noise, rainStreaks, shadowTop, tile, TileSetBuilder } from './common';

function planks(b: PixBuf, seed: number): void {
  for (let y = 0; y < 16; y++) {
    const band = y >> 2;
    for (let x = 0; x < 16; x++) {
      const seam = (x + band * 5) % 16 === 0;
      let c: number = band % 2 ? C.umber : C.plum;
      if (y % 4 === 0) c = C.ink;
      else if (seam) c = C.ink;
      else if (hash2(x, y, seed) < 0.08) c = C.rust;
      else if (y % 4 === 1 && hash2(x, y, seed + 1) < 0.5) c = band % 2 ? C.rust : C.grape;
      b.set(x, y, c);
    }
  }
}

function concrete(b: PixBuf, seed: number): void {
  noise(b, C.indigo, [[C.navy, 0.12], [C.slate, 0.04], [C.night, 0.02]], seed);
}

function wallFace(b: PixBuf, seed: number): void {
  // painted concrete with a pipe and a dado stripe
  noise(b, C.slate, [[C.indigo, 0.1], [C.steel, 0.03]], seed);
  b.hline(0, 15, 10, C.indigo); b.hline(0, 15, 11, C.navy);
  for (let y = 12; y < 16; y++) for (let x = 0; x < 16; x++) b.set(x, y, hash2(x, y, seed) < 0.15 ? C.night : C.navy);
  b.hline(0, 15, 3, C.steel); b.hline(0, 15, 4, C.fog); b.hline(0, 15, 5, C.slate);
  if (seed % 3 === 0) b.vline(12, 5, 9, C.rust);
}

function wallTop(b: PixBuf, seed: number): void {
  noise(b, C.night, [[C.navy, 0.15], [C.plum, 0.05]], seed);
}

function overlayBed(part: 'top' | 'bottom'): PixBuf {
  const b = tile();
  if (part === 'top') {
    b.rect(1, 2, 14, 14, C.slate);
    b.rect(2, 3, 12, 13, C.night);
    b.rect(3, 4, 10, 5, C.pale); b.hline(3, 12, 4, C.white); b.hline(3, 12, 8, C.fog);
    b.rect(2, 10, 12, 6, C.grape); b.hline(2, 13, 10, C.orchid);
  } else {
    b.rect(1, 0, 14, 14, C.slate);
    b.rect(2, 0, 12, 13, C.grape);
    for (let y = 2; y < 12; y += 3) b.hline(2, 13, y, C.plum);
    b.line(2, 4, 8, 12, C.orchid);
    b.rect(1, 13, 14, 2, C.night);
    b.rect(1, 14, 2, 2, C.slate); b.rect(13, 14, 2, 2, C.slate);
  }
  b.outline(C.ink);
  return b;
}

function overlayDesk(part: 'l' | 'r'): PixBuf {
  const b = tile();
  // desk surface rows 7..11, front panel 12..15
  b.rect(0, 7, 16, 4, C.umber); b.hline(0, 15, 7, C.rust);
  b.rect(0, 11, 16, 4, C.night); b.hline(0, 15, 11, C.ink);
  if (part === 'l') {
    b.rect(0, 11, 2, 5, C.umber);
    // monitor
    b.rect(2, 0, 11, 7, C.ink);
    b.rect(3, 1, 9, 5, C.abyss);
    for (let y = 2; y < 6; y++) for (let x = 4; x < 11; x++) if (hash2(x, y, 3) < 0.45) b.set(x, y, y === 2 ? C.cyan : C.teal);
    b.hline(4, 9, 2, C.ice);
    b.rect(6, 7, 3, 1, C.slate);
    // keyboard
    b.rect(3, 8, 9, 2, C.slate); for (let x = 4; x < 11; x += 2) b.set(x, 8, C.steel);
  } else {
    b.rect(14, 11, 2, 5, C.umber);
    // lamp + mug + parts
    b.vline(10, 2, 7, C.slate); b.line(10, 2, 13, 1, C.slate); b.rect(12, 1, 3, 2, C.steel); b.set(13, 3, C.amber);
    for (let y = 4; y < 8; y++) for (let x = 11; x < 16; x++) if ((x + y) % 2 === 0) b.setIfEmpty(x, y, C.sodium);
    b.rect(3, 4, 3, 3, C.pale); b.set(6, 5, C.pale); b.set(4, 4, C.rust);
    b.rect(7, 6, 2, 1, C.acid); b.set(2, 6, C.magenta);
  }
  b.outline(C.ink);
  return b;
}

function crateOverlay(): PixBuf {
  const b = tile();
  b.rect(2, 4, 12, 11, C.teal); b.rect(2, 4, 12, 3, C.cyan); b.hline(2, 13, 4, C.ice);
  for (let x = 4; x < 13; x += 3) b.rect(x, 9, 2, 4, C.abyss);
  b.hline(2, 13, 14, C.abyss);
  b.outline(C.ink);
  return b;
}

function windowCity(b: PixBuf): void {
  wallFace(b, 60);
  b.rect(1, 1, 14, 11, C.ink);
  // night sky gradient + skyline silhouettes with lit windows + neon
  for (let y = 2; y < 11; y++) for (let x = 2; x < 14; x++) b.set(x, y, y < 4 ? C.plum : y < 7 ? C.grape : C.orchid);
  const sky = [5, 3, 6, 4, 2, 5, 7, 3, 4, 6, 3, 5];
  for (let x = 2; x < 14; x++) for (let y = sky[x - 2] + 2; y < 11; y++) b.set(x, y, C.night);
  for (let x = 2; x < 14; x++) for (let y = 4; y < 11; y++) if (b.get(x, y) === C.night && hash2(x, y, 61) < 0.18) b.set(x, y, hash2(x, y, 62) < 0.5 ? C.amber : C.cyan);
  b.set(9, 5, C.magenta); b.set(9, 6, C.magenta);
  rainStreaks(b, 63, C.fog, [2, 2, 12, 9], 5);
  b.vline(7, 2, 10, C.slate); b.hline(2, 13, 6, C.slate);
  b.hline(0, 15, 12, C.steel); b.hline(0, 15, 13, C.slate);
}

function doorTile(b: PixBuf): void {
  wallFace(b, 70);
  b.rect(3, 1, 10, 15, C.ink);
  b.rect(4, 2, 8, 14, C.slate);
  for (let y = 3; y < 16; y += 3) b.hline(4, 11, y, C.steel);
  b.rect(12, 7, 2, 3, C.night); b.set(12, 8, C.acid);
}

function poster(b: PixBuf, kind: 'idol' | 'halcyon'): void {
  wallFace(b, kind === 'idol' ? 80 : 81);
  if (kind === 'idol') {
    b.rect(3, 0, 10, 12, C.plum); b.strokeRect(3, 0, 10, 12, C.magenta);
    b.ellipse(8, 4, 2.5, 2.5, C.rose); b.rect(6, 2, 5, 2, C.orchid);
    b.poly([[5, 11], [6, 7], [10, 7], [11, 11]], C.magenta);
    b.set(4, 1, C.cyan); b.set(11, 10, C.cyan);
    b.set(12, 0, 0); b.set(12, 1, C.slate);
  } else {
    b.rect(3, 0, 10, 12, C.pale); b.strokeRect(3, 0, 10, 12, C.fog);
    b.ring(8, 5, 3, C.amber); b.set(8, 5, C.amber);
    b.hline(5, 10, 9, C.slate); b.hline(5, 9, 10, C.steel);
    // torn corner + graffiti cross
    b.set(12, 11, C.slate); b.set(11, 11, C.slate); b.line(4, 1, 11, 9, C.magenta);
  }
}

/** Seamless rug pattern (tiles in any rectangle). */
function rug(b: PixBuf): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = Math.abs((x % 8) - 3.5), dy = Math.abs((y % 8) - 3.5);
    let c: number = C.maroon;
    if (Math.abs(dx + dy - 4) < 0.6) c = C.red;
    else if (dx + dy < 1.6) c = C.orchid;
    else if ((x + y) % 2 === 0 && hash2(x, y, 91) < 0.15) c = C.plum;
    b.set(x, y, c);
  }
}

export function buildHideout(): SheetSpec {
  const t = new TileSetBuilder('tiles_hideout', 'Tiles: Hideout');
  { const b = tile(); planks(b, 1); t.add('floor_0', b); }
  { const b = tile(); planks(b, 2); b.line(5, 5, 9, 6, C.ink); t.add('floor_1', b); }
  { const b = tile(); concrete(b, 3); t.add('floor_concrete', b); }
  { const b = tile(); rug(b); t.add('rug', b); }
  { const b = tile(); planks(b, 4); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 8, y - 8); if (d < 7 && (x + y * 3) % 4 === 0) b.set(x, y, d < 4 ? C.sodium : C.rust); } t.add('floor_lit', b); }
  t.newRow();
  t.add('bed_top', overlayBed('top'));
  t.add('bed_bottom', overlayBed('bottom'));
  t.add('desk_l', overlayDesk('l'));
  t.add('desk_r', overlayDesk('r'));
  t.add('crate', crateOverlay());
  { const b = tile(); windowCity(b); t.add('window_city', b); }
  { const b = tile(); doorTile(b); t.add('door', b); }
  { const b = tile(); poster(b, 'idol'); t.add('poster_idol', b); }
  { const b = tile(); poster(b, 'halcyon'); t.add('poster_halcyon', b); }
  addWallSet(t, {
    top: (b, s) => wallTop(b, s),
    face: (b, s) => wallFace(b, s),
    rimLight: C.indigo, rimDark: C.ink, faceEdge: C.indigo,
    floorShadow: (b) => { planks(b, 5); shadowTop(b, { [C.umber]: C.ink, [C.plum]: C.ink, [C.rust]: C.umber, [C.grape]: C.plum }, 4); },
  });
  return t.build({
    overlays: ['bed_top', 'bed_bottom', 'desk_l', 'desk_r', 'crate'],
    multiTile: { bed: [['bed_top'], ['bed_bottom']], desk: [['desk_l', 'desk_r']] },
    note: 'window_city, door, poster_* replace wall_face_* cells. Furniture overlays go on an upper layer over floor tiles.',
  });
}
