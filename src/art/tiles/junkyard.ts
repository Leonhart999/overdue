/**
 * Junkyard dungeon tileset `tiles_junkyard` (gig maps, Gearjaw's scrapyard). Uses the shared
 * wall autotile: scrap-heap tops and crushed-car-cube faces.
 */
import { C } from '../palette';
import { PixBuf } from '../core/pixbuf';
import { hash2 } from '../core/rng';
import { SheetSpec } from '../core/sheet';
import { addWallSet, noise, shadowTop, tile, TileSetBuilder } from './common';

function dirt(b: PixBuf, seed: number): void {
  noise(b, C.night, [[C.plum, 0.1], [C.navy, 0.1], [C.umber, 0.08], [C.slate, 0.015], [C.rust, 0.01]], seed);
}

function plate(b: PixBuf, seed: number): void {
  noise(b, C.navy, [[C.indigo, 0.12], [C.umber, 0.05]], seed);
  b.strokeRect(0, 0, 16, 16, C.night);
  b.hline(1, 14, 1, C.slate);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { b.set(x, y, C.fog); b.set(x, y + 1, C.ink); }
  for (let y = 4; y < 12; y += 3) for (let x = 4; x < 12; x += 3) { b.set(x, y, C.slate); b.set(x + 1, y + 1, C.slate); }
}

function scrapTop(b: PixBuf, seed: number): void {
  // jumble of rusty and steel chunks seen from above
  noise(b, C.night, [[C.umber, 0.3], [C.rust, 0.1], [C.slate, 0.14], [C.navy, 0.15], [C.steel, 0.02]], seed);
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(hash2(i, seed, 1) * 12), y = Math.floor(hash2(i, seed, 2) * 12);
    const w = 3 + Math.floor(hash2(i, seed, 3) * 3);
    const c = hash2(i, seed, 4) < 0.5 ? C.slate : C.rust;
    b.rect(x, y, w, 2, c); b.hline(x, x + w - 1, y, c === C.slate ? C.steel : C.orange); b.hline(x, x + w - 1, y + 2, C.ink);
  }
}

function scrapFace(b: PixBuf, seed: number): void {
  // stacked crushed car cubes: 2 rows of blocks, offset like bricks
  for (let row = 0; row < 2; row++) {
    const y0 = row * 8, off = row ? 4 : (seed % 3) * 2;
    for (let bx = -1; bx < 3; bx++) {
      const x0 = bx * 8 + off;
      const t = hash2(bx, row, seed);
      const ramp = t < 0.35 ? [C.umber, C.rust, C.orange] : t < 0.7 ? [C.night, C.slate, C.steel] : [C.plum, C.grape, C.orchid];
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) {
        if (x < 0 || x > 15) continue;
        let c: number = (y - y0) % 3 === 0 ? ramp[0] : hash2(x, y, seed) < 0.2 ? ramp[0] : ramp[1];
        if (y === y0 + 1) c = ramp[2];
        if (x === x0 || y === y0) c = C.ink;
        b.set(x, y, c);
      }
    }
  }
  b.hline(0, 15, 15, C.ink);
}

function scrapPile(big: boolean): PixBuf {
  const b = tile();
  const pts: [number, number][] = big ? [[0, 15], [2, 8], [5, 4], [8, 1], [11, 3], [14, 7], [15, 15]] : [[2, 15], [4, 10], [7, 7], [10, 8], [13, 15]];
  b.poly(pts, C.rust);
  noise(b, C.rust, [[C.umber, 0.3], [C.slate, 0.2], [C.steel, 0.08], [C.orange, 0.05]], big ? 21 : 22, [0, 0, 16, 16]);
  const mask = tile(); mask.poly(pts, 1);
  for (let i = 0; i < 256; i++) if (!mask.px[i]) b.px[i] = 0;
  // a few recognisable bits: a wheel, a pipe, a monitor
  b.ring(big ? 5 : 7, big ? 11 : 12, 2.5, C.ink); b.set(big ? 5 : 7, big ? 11 : 12, C.steel);
  b.line(big ? 8 : 9, big ? 4 : 9, big ? 13 : 12, big ? 9 : 12, C.fog);
  if (big) { b.rect(9, 10, 4, 3, C.night); b.set(10, 11, C.cyan); }
  b.outline(C.ink);
  return b;
}

function tires(): PixBuf {
  const b = tile();
  for (const [x, y] of [[5, 11], [11, 11], [8, 6]] as [number, number][]) {
    b.ellipse(x, y, 4, 2.6, C.ink); b.ellipse(x, y, 2.6, 1.4, C.night); b.ellipse(x, y - 0.6, 3.6, 2.2, C.slate); b.ellipse(x, y, 1.8, 1, C.ink);
  }
  b.outline(C.ink);
  return b;
}

function oil(b: PixBuf): void {
  dirt(b, 31);
  b.ellipse(8, 8.5, 7, 5, C.ink);
  // iridescent sheen
  for (let x = 3; x < 13; x++) { b.set(x, 6 + (x % 2), x < 6 ? C.grape : x < 9 ? C.abyss : C.moss); }
  for (let x = 5; x < 11; x++) if (x % 2) b.set(x, 10, C.plum);
  b.set(5, 5, C.slate);
}

function chest(open: boolean): PixBuf {
  const b = tile();
  // military footlocker, 3/4 view
  b.rect(1, 7, 14, 8, C.moss); b.hline(1, 14, 7, C.lime);
  b.rect(1, 13, 14, 2, C.night);
  for (const x of [3, 12]) b.vline(x, 7, 14, C.slate);
  if (!open) {
    b.rect(1, 3, 14, 4, C.lime); b.hline(1, 14, 3, C.acid); b.hline(1, 14, 6, C.moss);
    b.rect(7, 6, 2, 3, C.slate); b.set(7, 7, C.red); b.set(8, 7, C.red);
  } else {
    b.rect(1, 0, 14, 3, C.moss); b.hline(1, 14, 0, C.lime);
    b.rect(2, 4, 12, 4, C.ink);
    b.set(5, 5, C.amber); b.set(6, 4, C.sodium); b.set(9, 5, C.cyan); b.set(10, 6, C.acid); b.set(7, 6, C.amber);
    b.rect(7, 8, 2, 2, C.slate); b.set(7, 9, C.acid); b.set(8, 9, C.acid);
  }
  b.outline(C.ink);
  if (open) { b.setIfEmpty(5, 2, C.amber); b.setIfEmpty(10, 1, C.amber); b.setIfEmpty(8, 0, C.white); }
  return b;
}

function terminal(unlocked: boolean): PixBuf {
  const b = tile();
  b.rect(3, 1, 10, 15, C.slate);
  b.rect(4, 2, 8, 7, C.ink);
  const scr = unlocked ? C.acid : C.red, dim = unlocked ? C.moss : C.maroon;
  for (let y = 3; y < 8; y++) for (let x = 5; x < 11; x++) b.set(x, y, y % 2 ? dim : scr);
  if (unlocked) { b.set(6, 5, C.white); b.set(7, 6, C.white); b.set(8, 5, C.white); b.set(9, 4, C.white); }
  else { b.rect(7, 4, 2, 3, C.pale); b.set(7, 3, C.pale); b.set(8, 3, C.pale); }
  b.rect(4, 10, 8, 2, C.steel); for (let x = 5; x < 11; x += 2) b.set(x, 10, C.fog);
  b.rect(5, 13, 6, 3, C.night);
  b.hline(3, 12, 1, C.steel);
  b.outline(C.ink);
  for (let x = 4; x < 12; x += 2) b.setIfEmpty(x, 0, dim);
  return b;
}

function hatch(): PixBuf {
  const b = tile();
  dirt(b, 41);
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) if (((x + y) >> 1) % 2 === 0) b.set(x, y, C.sodium); else b.set(x, y, C.ink);
  b.rect(3, 3, 10, 10, C.slate); b.strokeRect(3, 3, 10, 10, C.ink);
  b.hline(4, 11, 4, C.steel);
  // arrow down in acid
  b.vline(8, 5, 10, C.acid); b.vline(7, 5, 10, C.acid);
  b.hline(5, 10, 9, C.acid); b.hline(6, 9, 10, C.acid); b.hline(7, 8, 11, C.acid);
  return b;
}

/** Boss gate 2x2 (32x32 split in 4). */
function bossGate(open: boolean): PixBuf[] {
  const g = new PixBuf(32, 32);
  g.rect(0, 0, 32, 32, C.slate);
  g.rect(0, 0, 32, 4, C.steel); g.hline(0, 31, 0, C.fog);
  g.rect(0, 0, 4, 32, C.steel); g.rect(28, 0, 4, 32, C.steel);
  for (let y = 4; y < 32; y++) for (const x of [0, 1, 2, 3, 28, 29, 30, 31]) if (((x + y) >> 1) % 2 === 0) g.set(x, y, C.sodium); else g.set(x, y, C.ink);
  if (!open) {
    g.rect(4, 4, 24, 28, C.rust);
    for (let y = 6; y < 32; y += 4) g.hline(4, 27, y, C.umber);
    g.vline(15, 4, 31, C.ink); g.vline(16, 4, 31, C.umber);
    // gear emblem + jaw
    g.circle(16, 16, 7, C.ink); g.circle(16, 16, 6, C.orange); g.circle(16, 16, 3, C.ink);
    for (let a = 0; a < 8; a++) { const x = Math.round(16 + Math.cos(a * Math.PI / 4) * 8), y = Math.round(16 + Math.sin(a * Math.PI / 4) * 8); g.rect(x - 1, y - 1, 2, 2, C.orange); }
    for (let x = 12; x < 21; x += 2) g.set(x, 17, C.white);
    g.set(9, 26, C.red); g.set(22, 26, C.red);
  } else {
    g.rect(4, 4, 24, 28, C.ink);
    for (let y = 8; y < 32; y++) for (let x = 6; x < 26; x++) if (hash2(x, y, 3) < 0.04) g.set(x, y, C.rust);
    for (let y = 26; y < 32; y++) for (let x = 6; x < 26; x++) if ((x + y) % 3 === 0) g.set(x, y, C.orange);
    g.rect(4, 4, 24, 3, C.rust); g.hline(4, 27, 7, C.umber);
  }
  return [g.crop(0, 0, 16, 16), g.crop(16, 0, 16, 16), g.crop(0, 16, 16, 16), g.crop(16, 16, 16, 16)];
}

export function buildJunkyard(): SheetSpec {
  const t = new TileSetBuilder('tiles_junkyard', 'Tiles: Junkyard');
  for (let i = 0; i < 4; i++) {
    const b = tile(); dirt(b, i + 1);
    if (i === 1) { b.set(4, 5, C.steel); b.set(5, 5, C.fog); b.set(11, 10, C.rust); b.set(12, 10, C.orange); }
    if (i === 2) { b.line(2, 12, 7, 10, C.ink); b.line(7, 10, 12, 12, C.ink); }
    if (i === 3) { for (let x = 0; x < 16; x++) b.set(x, 7 + (x % 3 === 0 ? 1 : 0), C.umber); }
    t.add(`floor_${i}`, b);
  }
  { const b = tile(); plate(b, 11); t.add('floor_plate', b); }
  { const b = tile(); oil(b); t.add('oil', b); }
  t.add('hatch', hatch());
  t.newRow();
  t.add('scrap_small', scrapPile(false));
  t.add('scrap_big', scrapPile(true));
  t.add('tires', tires());
  t.add('chest_closed', chest(false));
  t.add('chest_open', chest(true));
  t.add('terminal_locked', terminal(false));
  t.add('terminal_unlocked', terminal(true));
  t.newRow();
  const [a, bb, c, d] = bossGate(false);
  t.add('gate_tl', a); t.add('gate_tr', bb); t.add('gate_bl', c); t.add('gate_br', d);
  const [a2, b2, c2, d2] = bossGate(true);
  t.add('gate_open_tl', a2); t.add('gate_open_tr', b2); t.add('gate_open_bl', c2); t.add('gate_open_br', d2);
  addWallSet(t, {
    top: (b, s) => scrapTop(b, s),
    face: (b, s) => scrapFace(b, s),
    rimLight: C.rust, rimDark: C.ink, faceEdge: C.night,
    floorShadow: (b) => { dirt(b, 51); shadowTop(b, { [C.night]: C.ink, [C.plum]: C.ink, [C.navy]: C.night, [C.umber]: C.night }, 5); },
  });
  return t.build({
    overlays: ['scrap_small', 'scrap_big', 'tires', 'chest_closed', 'chest_open', 'terminal_locked', 'terminal_unlocked'],
    multiTile: {
      boss_gate: [['gate_tl', 'gate_tr'], ['gate_bl', 'gate_br']],
      boss_gate_open: [['gate_open_tl', 'gate_open_tr'], ['gate_open_bl', 'gate_open_br']],
    },
    note: 'Floor: floor_0..3 (pick by hash), floor_plate, oil, hatch (exit). Boss gate sits in a wall-face row (2 tiles wide, 2 tall).',
  });
}
