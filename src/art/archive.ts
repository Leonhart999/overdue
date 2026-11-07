/** Archive wall elevation and floor share the exact playable outline used by collision. */
import { ARCHIVE_LAYOUT } from '../game/arenas/archiveLayout';
import { C } from './palette';
import { PixBuf } from './core/pixbuf';

export function buildArchiveBackground(): PixBuf {
  const b = new PixBuf(640, 360).fill(C.night);
  const floor = ARCHIVE_LAYOUT.bounds, wall = ARCHIVE_LAYOUT.rearWall, window = ARCHIVE_LAYOUT.window;
  const right = floor.x + floor.w, bottom = floor.y + floor.h;
  // Ground tiles stop at the wall's foot, including partial tiles on the lower edge.
  b.rect(floor.x, floor.y, floor.w, floor.h, C.navy);
  for (let row = 0, y = floor.y; y < bottom; row++, y += 24) {
    for (let col = 0, x = floor.x; x < right; col++, x += 24) {
      b.rect(x, y, Math.min(23, right - x), Math.min(23, bottom - y), (row + col) % 2 ? C.navy : C.indigo);
      b.set(x + 2, y + 2, C.slate);
    }
  }
  b.ring(320, 198, 94, C.teal).ring(320, 198, 75, C.slate);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    b.line(320 + Math.cos(a) * 89, 198 + Math.sin(a) * 89, 320 + Math.cos(a) * 94, 198 + Math.sin(a) * 94, C.fog);
  }
  b.line(96, 112, 320, 198, C.teal).line(544, 112, 320, 198, C.teal);
  // Rear wall: vertical service panels, lintel and a continuous raised sill.
  b.rect(wall.x, wall.y, wall.w, wall.h, C.steelCool02);
  b.rect(wall.x, wall.y, wall.w, 8, C.steelCool05);
  b.hline(wall.x, wall.x + wall.w - 1, wall.y, C.steelCool08);
  b.hline(wall.x, wall.x + wall.w - 1, wall.y + 7, C.ink);
  for (let x = floor.x; x < right; x += 24) {
    b.rect(x + 1, 50, 21, 48, C.steelCool03);
    b.vline(x + 2, 51, 97, C.steelCool05);
    b.vline(x + 22, 50, 98, C.ink);
    b.rect(x + 5, 54, 2, 2, C.steelCool07);
    b.rect(x + 5, 92, 2, 2, C.steelCool02);
  }
  for (const x of [32, 80, 528, 576]) {
    b.rect(x - 1, 58, 36, 33, C.ink).rect(x + 1, 60, 32, 28, C.steelCool05);
    for (let j = 0; j < 3; j++) {
      b.rect(x + 4, 63 + j * 7, 24, 4, C.steelCool01);
      b.hline(x + 4, x + 26, 63 + j * 7, C.steelCool03);
      b.set(x + 29, 64 + j * 7, C.cyan);
    }
  }
  b.rect(window.x - 3, window.y - 3, window.w + 6, window.h + 4, C.steelCool06);
  b.rect(window.x, window.y, window.w, window.h, C.ink);
  b.rect(window.x + 4, window.y + 4, window.w - 8, window.h - 8, C.night);
  b.rect(wall.x, floor.y - 4, wall.w, 2, C.ink);
  b.hline(wall.x, wall.x + wall.w - 1, floor.y - 2, C.steelCool08);
  b.hline(wall.x, wall.x + wall.w - 1, floor.y - 1, C.steelCool03);
  // Side-wall feet and front lip meet the same collision rectangle.
  b.rect(8, wall.y, floor.x - 8, bottom - wall.y, C.ink);
  b.rect(16, floor.y, floor.x - 16, floor.h, C.steelCool03);
  b.vline(floor.x - 1, floor.y, bottom - 1, C.steelCool07);
  b.rect(right, wall.y, 16, bottom - wall.y, C.ink);
  b.rect(right, floor.y, 8, floor.h, C.steelCool03);
  b.vline(right, floor.y, bottom - 1, C.steelCool07);
  b.rect(16, bottom, 608, 20, C.steelCool02);
  b.hline(16, 623, bottom, C.steelCool07);
  b.hline(16, 623, bottom + 3, C.ink);
  return b;
}
