/** Kairo and Fold: indexed, code-generated sprites, devices, arenas and standees. */
import { C } from './palette';
import { buildArchiveBackground } from './archive';
import { buildKairoCombatFrame, buildKairoStandee } from './actors/kairo';
import { Mask, PixBuf, shadeInto } from './core/pixbuf';
import type { FrameSpec, SheetSpec } from './core/sheet';

const metal = [C.ink, C.navy, C.slate, C.steel, C.fog, C.pale, C.white];
const cloth = [C.ink, C.night, C.navy, C.indigo, C.slate];
const ivory = [C.ink, C.slate, C.steel, C.fog, C.pale, C.white];
const brass = [C.umber, C.rust, C.orange, C.sodium, C.amber];
function part(b: PixBuf, ramp: number[], base: number, draw: (m: PixBuf) => void): void {
  const mask = new Mask(b.w, b.h).draw(draw);
  shadeInto(b, mask, { ramp, base, light: [-1, -1], innerLine: true });
}

function fold(frame: string, broken: boolean): PixBuf {
  const b = new PixBuf(64, 80), dy = frame === 'idle2' ? 1 : frame === 'hurt' ? 3 : 0;
  // Backpack gantry, oversize compass arm and orange measuring rail.
  part(b, metal, 2, m => m.poly([[8, 22], [17, 10], [47, 10], [53, 22], [47, 48], [11, 48]], 1));
  b.rect(15, 12, 30, 4, C.orange); b.line(16, 14, 43, 14, C.amber);
  for (let i = 0; i < 5; i++) b.rect(17 + i * 6, 15, 2, i % 2 ? 3 : 5, C.ink);
  part(b, metal, 3, m => { m.capsule(24, 50, 20, 72, 5, 1); m.capsule(39, 50, 44, 72, 5, 1); });
  part(b, cloth, 3, m => m.poly([[19, 28 + dy], [42, 27 + dy], [48, 60], [34, 65], [25, 59], [13, 61]], 1));
  part(b, brass, 2, m => m.poly([[19, 28 + dy], [40, 28 + dy], [43, 44], [22, 47], [15, 38]], 1));
  b.line(24, 30 + dy, 27, 43, C.amber); b.line(39, 30 + dy, 41, 42, C.sodium);
  part(b, metal, 4, m => m.capsule(43, 33 + dy, frame === 'attack' ? 58 : 53, 49 + dy, 5, 1));
  const ex = frame === 'attack' ? 59 : 53;
  b.line(ex, 44 + dy, ex - 8, 61, C.fog); b.line(ex, 44 + dy, ex + 2, 61, C.pale);
  b.line(ex - 8, 61, ex - 8, 65, C.orange); b.line(ex + 2, 61, ex + 2, 65, C.orange);
  part(b, metal, 3, m => m.capsule(17, 33 + dy, 10, 49, 5, 1));
  b.rect(3, 47, 18, 10, C.abyss); b.rect(5, 49, 14, 6, C.teal); b.line(7, 53, 12, 50, C.cyan);
  part(b, ivory, 3, m => m.ellipse(32, 22 + dy, 9, 11, 1));
  part(b, brass, 3, m => m.poly([[21, 20 + dy], [24, 9 + dy], [38, 7 + dy], [45, 18 + dy], [43, 22 + dy]], 1));
  b.line(26, 25 + dy, 42, 23 + dy, broken ? C.magenta : C.ice);
  b.set(38, 24 + dy, C.white); b.line(31, 31 + dy, 37, 30 + dy, C.slate);
  b.rect(13, 71, 14, 4, C.navy); b.rect(39, 71, 14, 4, C.navy);
  if (broken) { b.line(29, 36, 35, 44, C.ink); b.line(30, 37, 36, 45, C.cyan); b.set(15, 18, C.red); }
  b.outline(C.ink);
  return b;
}

function device(kind: string, live: boolean): PixBuf {
  const b = new PixBuf(32, 44);
  part(b, metal, 2, m => m.poly([[5, 14], [26, 12], [29, 36], [24, 41], [3, 39]], 1));
  b.rect(6, 17, 18, 15, C.ink); b.rect(7, 18, 16, 12, C.navy);
  const col = live ? C.amber : C.slate;
  if (kind === 'record') {
    b.ring(15, 23, 6, C.teal, 2); b.line(15, 23, 15, 19, C.ice); b.line(15, 23, 19, 25, C.cyan);
    b.rect(8, 35, 14, 2, col);
  } else if (kind === 'coolant') {
    b.rect(10, 4, 12, 22, C.teal); b.rect(12, 5, 5, 19, C.ice);
    b.ring(21, 13, 6, C.steel, 2); b.line(17, 9, 25, 17, col); b.line(25, 9, 17, 17, col);
  } else if (kind === 'rack') {
    for (let y = 4; y < 35; y += 7) { b.rect(5, y, 22, 5, C.slate); b.rect(7, y + 1, 15, 2, C.navy); b.set(24, y + 1, C.cyan); }
  } else if (kind === 'brake') {
    b.circle(15, 23, 6, C.maroon); b.circle(15, 22, 4, live ? C.red : C.slate);
    b.line(8, 34, 24, 34, C.orange);
  } else if (kind === 'route') {
    b.line(9, 26, 14, 19, C.ice); b.line(14, 19, 21, 25, C.cyan); b.line(14, 19, 14, 27, C.cyan);
    b.set(9, 26, col); b.set(21, 25, col);
  } else if (kind === 'press') {
    b.rect(9, 18, 13, 3, col); b.vline(15, 20, 25, C.fog); b.rect(7, 26, 18, 4, C.orange);
  } else {
    b.poly([[11, 18], [21, 24], [11, 29]], col); b.rect(8, 34, 16, 3, col);
  }
  b.outline(C.ink);
  return b;
}

function foundryBackground(): PixBuf {
  // Layout matches arenas/foundry.ts: rooms at x 88/512, y 112/376 (280x168), hub 368..512 x 280..376.
  const w = 880, h = 608;
  const b = new PixBuf(w, h).fill(C.night);
  b.rect(16, 48, w - 32, h - 64, C.umber);
  for (let y = 56; y < h - 24; y += 24) for (let x = 24; x < w - 24; x += 24) {
    b.rect(x, y, 23, 23, (x + y) % 48 ? C.night : C.navy);
    b.set(x + 2, y + 2, C.slate);
  }
  b.rect(16, 40, w - 32, 16, C.slate); b.hline(16, w - 17, 55, C.fog);
  for (let x = 40; x < w - 40; x += 48) { b.rect(x, 43, 20, 6, C.navy); b.rect(x + 2, 44, 16, 2, C.steel); }
  b.rect(8, 40, 8, h - 48, C.ink); b.rect(w - 16, 40, 8, h - 48, C.ink);
  // horizontal rails for the two rows (the rooms close the vertical corridor along them)
  for (const ry of [112, 376]) for (const dy of [40, 128]) {
    const y = ry + dy;
    for (let x = 92; x < 790; x += 12) b.rect(x, y - 3, 4, 8, C.umber);
    b.hline(88, 791, y, C.steel); b.hline(88, 791, y + 1, C.fog); b.hline(88, 791, y + 2, C.ink);
  }
  // vertical rails for the two columns (they close the horizontal corridor)
  for (const cx of [88, 512]) for (const dx of [60, 220]) {
    const x = cx + dx;
    for (let y = 116; y < 542; y += 12) b.rect(x - 3, y, 8, 4, C.umber);
    b.vline(x, 112, 543, C.steel); b.vline(x + 1, 112, 543, C.fog); b.vline(x + 2, 112, 543, C.ink);
  }
  // hazard stripes where the rooms meet when a corridor closes
  for (const ry of [112, 376]) for (let y = ry; y < ry + 168; y += 8) {
    b.rect(436, y, 8, 4, C.sodium); b.rect(436, y + 4, 8, 4, C.ink);
  }
  for (const cx of [88, 512]) for (let x = cx; x < cx + 280; x += 8) {
    b.rect(x, 324, 4, 8, C.sodium); b.rect(x + 4, 324, 4, 8, C.ink);
  }
  // hub: press plate
  b.rect(372, 284, 136, 88, C.slate); b.rect(376, 288, 128, 80, C.navy);
  for (let y = 288; y < 368; y++) for (let x = 376; x < 504; x++) if ((x + y) % 12 === 0) b.set(x, y, C.indigo);
  for (let x = 372; x < 508; x += 8) { b.rect(x, 284, 4, 3, C.amber); b.rect(x + 4, 369, 4, 3, C.amber); }
  for (let y = 284; y < 372; y += 8) { b.rect(372, y, 3, 4, C.amber); b.rect(505, y + 4, 3, 4, C.amber); }
  // device pads: brake (top margin) and press console (bottom margin)
  for (const [x, y] of [[440, 84], [440, 566]]) { b.circle(x, y, 13, C.slate); b.ring(x, y, 13, C.amber, 1); }
  return b;
}

function room(index: number): PixBuf {
  const b = new PixBuf(280, 168).fill(C.ink);
  b.rect(2, 2, 276, 164, C.slate); b.rect(6, 6, 268, 156, C.navy);
  for (let y = 22; y < 158; y += 16) for (let x = 8; x < 272; x += 16) {
    b.rect(x, y, 15, 15, (x + y) % 32 ? C.indigo : C.navy); b.set(x + 2, y + 2, C.slate);
  }
  // back wall in two panels with a doorway (collision: x 12..110 and 170..268, y 10..20)
  for (const x0 of [12, 170]) {
    b.rect(x0, 10, 98, 10, C.steel); b.hline(x0, x0 + 97, 10, C.pale); b.hline(x0, x0 + 97, 19, C.slate);
    for (let x = x0 + 6; x < x0 + 96; x += 14) b.set(x, 15, C.ink);
  }
  for (let x = 112; x < 168; x += 8) { b.rect(x, 12, 4, 6, C.amber); b.rect(x + 4, 12, 4, 6, C.ink); }
  for (let x = 8; x < 272; x += 16) { b.rect(x, 158, 8, 4, C.orange); b.rect(x + 8, 158, 8, 4, C.ink); }
  const col = [C.cyan, C.amber, C.acid, C.magenta][index];
  b.rect(2, 26, 4, 116, col); b.rect(274, 26, 4, 116, col);
  // rail wheels on every edge
  for (const [x, y] of [[0, 34], [0, 126], [272, 34], [272, 126]]) { b.rect(x, y, 8, 8, C.ink); b.rect(x + 2, y + 2, 4, 4, C.steel); }
  b.rect(22, 29, 30, 15, C.ink);
  for (let i = 0; i <= index; i++) b.rect(26 + i * 6, 33, 3, 7, col);
  return b;
}

function foldStandee(broken: boolean): PixBuf {
  const b = new PixBuf(112, 144);
  for (const x of [8, 97]) { b.rect(x, 9, 7, 123, C.slate); b.vline(x, 9, 131, C.steel); }
  b.rect(8, 10, 96, 7, C.rust); b.line(10, 16, 100, 16, C.orange);
  for (let y = 24; y < 125; y += 22) { b.line(13, y, 99, y + 22, C.navy); b.line(99, y, 13, y + 22, C.navy); }
  part(b, cloth, 3, m => m.poly([[31, 68], [75, 62], [96, 91], [105, 144], [16, 144], [18, 98]], 1));
  part(b, brass, 3, m => m.poly([[37, 69], [68, 65], [78, 100], [64, 123], [33, 112], [26, 88]], 1));
  part(b, metal, 3, m => m.capsule(75, 84, 88, 122, 11, 1));
  b.line(95, 92, 101, 140, C.orange); b.line(33, 114, 28, 143, C.orange);
  part(b, ivory, 3, m => m.ellipse(52, 48, 17, 23, 1));
  part(b, brass, 3, m => m.poly([[30, 42], [34, 25], [60, 20], [74, 36], [75, 43], [31, 48]], 1));
  b.line(36, 27, 59, 23, C.amber); b.line(34, 50, 62, 46, C.ice); b.set(38, 49, C.white);
  part(b, metal, 4, m => m.capsule(86, 108, 72, 65, 5, 1));
  b.line(72, 65, 58, 97, C.fog); b.line(72, 65, 93, 97, C.pale);
  b.rect(36, 118, 39, 20, C.abyss); b.rect(39, 121, 33, 14, C.teal);
  b.line(43, 131, 51, 125, C.cyan); b.line(51, 125, 65, 131, C.ice);
  b.line(40, 62, 48, 63, C.slate); b.line(38, 52, 35, 57, C.steel);
  if (broken) { b.line(46, 79, 63, 101, C.ink); b.line(47, 80, 64, 102, C.orange); b.set(61, 99, C.white); b.line(37, 45, 44, 51, C.ink); }
  b.outline(C.ink);
  return b;
}

export function buildExpansionStandeeFrames(): FrameSpec[] {
  return [{ name: 'kairo', buf: buildKairoStandee(false) }, { name: 'kairo_p2', buf: buildKairoStandee(true) },
    { name: 'fold', buf: foldStandee(false) }, { name: 'fold_p2', buf: foldStandee(true) }];
}

export function buildExpansionArt(): SheetSpec[] {
  const out: SheetSpec[] = [];
  for (const id of ['kairo', 'fold'] as const) for (const broken of [false, true]) {
    out.push({ key: id + (broken ? '_broken' : ''), group: 'Bosses', frameW: id === 'kairo' ? 48 : 64, frameH: id === 'kairo' ? 64 : 80,
      frames: ['idle1', 'idle2', 'attack', 'hurt'].map(name => ({ name, buf: id === 'kairo' ? buildKairoCombatFrame(name, broken) : fold(name, broken) })) });
  }
  out.push({ key: 'archive_dev', group: 'Devices', frameW: 32, frameH: 44,
    frames: ['record', 'breaker', 'coolant', 'rack', 'route', 'brake', 'press', 'gate'].flatMap(kind => [false, true].map(live => ({ name: kind + (live ? '_on' : '_off'), buf: device(kind, live) }))) });
  out.push({ key: 'bg_archive', group: 'Arenas', frameW: 640, frameH: 360, frames: [{ name: '0', buf: buildArchiveBackground() }] });
  out.push({ key: 'bg_foundry', group: 'Arenas', frameW: 880, frameH: 608, frames: [{ name: '0', buf: foundryBackground() }] });
  out.push({ key: 'fold_room', group: 'Arenas', frameW: 280, frameH: 168, frames: [0, 1, 2, 3].map(i => ({ name: String(i), buf: room(i) })) });
  return out;
}
