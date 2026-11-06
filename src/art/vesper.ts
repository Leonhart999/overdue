/**
 * Vesper + ring-line train roof art (palette indices only).
 *   vesper          32x44   idle1, idle2, aim, fire, kick, hurt, leap, crouch (3/4 view facing right,
 *                           origin bottom centre, ground row 42; platinum bob, red visor, long dark
 *                           coat with red piping, long rifle. aim/fire have no rifle: it is drawn
 *                           rotated at runtime from `vesper_rifle`)
 *   vesper_rifle    34x8    rifle, fire (pivot at x 8, the shoulder)
 *   vesper_fx       16x16   mine_a, mine_b, smoke
 *   vesper_portrait 64x64   vesper
 *   train_cover     40x40   ac, ac_dent, ac_broken, crate, crate_dent, crate_broken (footprint bottom row 36)
 *   train_dev       24x32   box, box_live, box_off, panto (ground row 28)
 *   train_gantry    48xH    beam (overhead truss across the train, posts beyond the roof edges)
 *   train_car       car     car_a, car_b, rear, loco (roof + far lip + visible side; top-left origin)
 *   train_gap       30xH    gap (coupler walkway, the drops are transparent), nose (locomotive front)
 *   train_track     64xH    track (ballast + sleepers seen through gaps / behind detached cars)
 *   train_strip_top 128xH   city, tunnel; train_strip_bot 128xH city, tunnel (seamless tiles)
 *   bg_train        map     dark base under the scrolling strips
 */
import { C, RAMP } from './palette';
import { PixBuf, type Pt } from './core/pixbuf';
import { bayer, hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { mat, part } from './actors/rig';
import { CAR_SPRITE, STRIP, STRIP_H, TRAIN } from '../game/arenas/train';

const COAT = mat(RAMP.cool, 2);
const COAT_D = mat(RAMP.cool, 1);
const HAIR = mat(RAMP.white, 3);
const SKIN = mat(RAMP.skin, 3);
const BOOT = mat(RAMP.cool, 1);
const GUN = mat(RAMP.chrome, 1);
const STEEL = mat(RAMP.chrome, 2);

// ------------------------------------------------------------------ Vesper (32x44, ground row 42)
type VFrame = 'idle1' | 'idle2' | 'aim' | 'fire' | 'kick' | 'hurt' | 'leap' | 'crouch';
interface VPose {
  /** Upper body shift. */
  ux: number; uy: number;
  /** Feet (back, front). */
  bf: Pt; ff: Pt;
  /** Coat hem: back corner, front corner. */
  hb: Pt; hf: Pt;
  /** Hands (back, front). */
  bh: Pt; fh: Pt;
  /** Rifle held in the sprite: stock -> muzzle. null = drawn at runtime / none. */
  rifle: [Pt, Pt] | null;
  /** Kick: front leg out of the coat to this foot. */
  kick?: Pt;
  mood: 'normal' | 'hurt';
}

const VPOSES: Record<VFrame, VPose> = {
  idle1: { ux: 0, uy: 0, bf: [13, 42], ff: [19, 42], hb: [9, 39], hf: [23, 39], bh: [12, 30], fh: [21, 28], rifle: [[11, 33], [30, 15]], mood: 'normal' },
  idle2: { ux: 0, uy: 1, bf: [13, 42], ff: [19, 42], hb: [9, 39], hf: [23, 39], bh: [12, 31], fh: [21, 29], rifle: [[11, 34], [30, 16]], mood: 'normal' },
  aim: { ux: 1, uy: 1, bf: [11, 42], ff: [21, 42], hb: [8, 39], hf: [24, 39], bh: [22, 21], fh: [26, 20], rifle: null, mood: 'normal' },
  fire: { ux: -1, uy: 1, bf: [11, 42], ff: [21, 42], hb: [7, 39], hf: [23, 39], bh: [20, 21], fh: [24, 20], rifle: null, mood: 'normal' },
  kick: { ux: -2, uy: 0, bf: [12, 42], ff: [12, 42], hb: [7, 38], hf: [20, 34], bh: [8, 27], fh: [14, 22], rifle: [[5, 30], [20, 12]], kick: [29, 31], mood: 'normal' },
  hurt: { ux: -2, uy: 2, bf: [12, 42], ff: [19, 42], hb: [8, 39], hf: [22, 39], bh: [9, 32], fh: [16, 32], rifle: [[8, 36], [27, 30]], mood: 'hurt' },
  leap: { ux: 0, uy: 6, bf: [12, 40], ff: [21, 39], hb: [7, 37], hf: [25, 36], bh: [10, 33], fh: [22, 32], rifle: [[7, 31], [29, 24]], mood: 'normal' },
  crouch: { ux: 0, uy: 7, bf: [11, 42], ff: [21, 42], hb: [6, 41], hf: [26, 41], bh: [12, 36], fh: [22, 35], rifle: [[8, 38], [30, 33]], mood: 'normal' },
};

function vesperFrame(pp: VPose): PixBuf {
  const b = new PixBuf(32, 44);
  const ux = pp.ux, uy = pp.uy;
  const shB: Pt = [12 + ux, 17 + uy], shF: Pt = [20 + ux, 17 + uy];
  // boots under the coat
  for (const f of [pp.bf, pp.ff]) {
    part(b, BOOT, (x) => { x.rect(f[0] - 2, f[1] - 4, 4, 4, 1); x.rect(f[0] - 2, f[1] - 1, 6, 1, 1); });
  }
  // back arm
  part(b, COAT_D, (x) => x.capsule(shB[0], shB[1] + 1, pp.bh[0], pp.bh[1], 2, 1));
  // kick leg comes out of the coat
  if (pp.kick) {
    part(b, mat(RAMP.cool, 1), (x) => x.capsule(17 + ux, 28, pp.kick![0] - 2, pp.kick![1], 2.2, 1));
    part(b, BOOT, (x) => x.poly([[pp.kick![0] - 4, pp.kick![1] - 3], [pp.kick![0] + 2, pp.kick![1] - 2], [pp.kick![0] + 2, pp.kick![1] + 2], [pp.kick![0] - 4, pp.kick![1] + 2]], 1));
  }
  // long coat: shoulders to the hem
  part(b, COAT, (x) => x.poly([[shB[0] - 1, shB[1]], [shF[0] + 1, shF[1]], [shF[0] + 2, 26 + uy * 0.6], [pp.hf[0], pp.hf[1]], [pp.hb[0], pp.hb[1]], [shB[0] - 2, 26 + uy * 0.6]], 1));
  // coat split + red piping down the front edge, belt
  b.line(shF[0], shF[1] + 3, pp.hf[0] - 1, pp.hf[1] - 1, C.maroon);
  b.line(shF[0] + 1, shF[1] + 3, pp.hf[0], pp.hf[1] - 1, C.red);
  b.hline(shB[0] - 1, shF[0] + 1, 25 + uy, C.night);
  b.set(shF[0] - 1, 25 + uy, C.steel);
  // tall collar
  part(b, COAT, (x) => x.poly([[shB[0] + 1, shB[1] - 3], [shF[0] - 1, shF[1] - 3], [shF[0], shF[1] + 1], [shB[0], shB[1] + 1]], 1));
  b.hline(shB[0] + 2, shF[0] - 1, shF[1] - 3, C.red);
  // head: face toward the right, platinum bob cut level at the jaw
  const hx = 17 + ux, hy = 10 + uy;
  part(b, SKIN, (x) => x.ellipse(hx + 1, hy, 4, 4.5, 1));
  part(b, HAIR, (x) => {
    x.ellipse(hx - 1, hy - 2, 5, 4.2, 1);
    x.poly([[hx - 6, hy - 2], [hx - 2, hy - 2], [hx - 1, hy + 4], [hx - 6, hy + 4]], 1);
    x.poly([[hx - 1, hy - 6], [hx + 5, hy - 4], [hx + 4, hy - 1], [hx, hy - 2]], 1);
  });
  b.line(hx - 4, hy - 5, hx + 1, hy - 6, C.white);
  // red visor band across the eyes, ear module
  const vy = hy + (pp.mood === 'hurt' ? 0 : -1);
  b.hline(hx, hx + 5, vy, C.red);
  b.hline(hx + 1, hx + 5, vy + 1, C.maroon);
  b.set(hx + 4, vy, C.rose);
  b.set(hx - 1, vy, C.slate); b.set(hx - 1, vy + 1, C.slate);
  if (pp.mood === 'hurt') { b.set(hx + 2, vy + 1, C.ink); b.set(hx + 4, vy, C.ink); }
  b.set(hx + 3, hy + 3, C.skinD);
  // rifle held in the sprite
  if (pp.rifle) {
    const [s, m] = pp.rifle;
    part(b, GUN, (x) => x.capsule(s[0], s[1], s[0] + (m[0] - s[0]) * 0.35, s[1] + (m[1] - s[1]) * 0.35, 1.8, 1));
    b.line(s[0] + (m[0] - s[0]) * 0.35, s[1] + (m[1] - s[1]) * 0.35, m[0], m[1], C.slate);
    const sx = s[0] + (m[0] - s[0]) * 0.3, sy = s[1] + (m[1] - s[1]) * 0.3 - 2;
    b.line(sx, sy, sx + (m[0] - s[0]) * 0.18, sy + (m[1] - s[1]) * 0.18, C.navy);
    b.set(Math.round(sx + (m[0] - s[0]) * 0.18), Math.round(sy + (m[1] - s[1]) * 0.18), C.red);
  }
  // front arm + glove
  part(b, COAT, (x) => x.capsule(shF[0], shF[1] + 1, pp.fh[0], pp.fh[1], 2, 1));
  part(b, BOOT, (x) => x.circle(pp.fh[0] + 0.5, pp.fh[1] + 0.5, 1.6, 1), { innerLine: false });
  if (pp.mood === 'hurt') b.line(11 + ux, 30, 15 + ux, 33, C.ink);
  b.outline(C.ink);
  return b;
}

function rifle(fire: boolean): PixBuf {
  const b = new PixBuf(34, 8);
  // stock + body (grip at x 8), long barrel, scope with a red lens, muzzle brake
  part(b, GUN, (x) => { x.poly([[1, 3], [9, 3], [11, 4], [11, 6], [3, 6], [1, 5]], 1); x.rect(10, 3, 9, 3, 1); });
  b.hline(19, 30, 4, C.slate); b.hline(19, 30, 5, C.night);
  part(b, STEEL, (x) => x.rect(30, 3, 3, 3, 1), { innerLine: false });
  part(b, GUN, (x) => x.rect(12, 1, 7, 2, 1), { innerLine: false });
  b.set(18, 1, C.red); b.set(18, 2, C.rose);
  b.set(8, 6, C.red);
  if (fire) { b.set(33, 4, C.white); b.set(33, 5, C.amber); }
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ fx (16x16)
function mine(on: boolean): PixBuf {
  const b = new PixBuf(16, 16);
  part(b, GUN, (x) => x.ellipse(8, 11, 5.5, 3, 1));
  b.hline(4, 12, 12, C.night);
  b.rect(7, 9, 3, 2, on ? C.red : C.maroon);
  if (on) b.set(8, 9, C.rose);
  b.set(3, 11, C.amber); b.set(13, 11, C.amber);
  b.outline(C.ink);
  return b;
}

function smokePuff(): PixBuf {
  const b = new PixBuf(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 7.5) continue;
    if (d > 6 && bayer(x, y) > 8) continue;
    b.set(x, y, d < 3 && y < 8 ? C.fog : d < 5 ? C.steel : C.slate);
  }
  return b;
}

// ------------------------------------------------------------------ portrait (64x64)
function portrait(): PixBuf {
  const b = new PixBuf(64, 64);
  b.rect(2, 2, 60, 60, C.night);
  // speed streaks behind
  for (let i = 0; i < 18; i++) {
    const y = 6 + Math.floor(hash2(i, 1, 201) * 52), x = 3 + Math.floor(hash2(i, 2, 201) * 30), l = 6 + Math.floor(hash2(i, 3, 201) * 20);
    b.hline(x, Math.min(60, x + l), y, i % 3 ? C.navy : C.indigo);
  }
  b.strokeRect(2, 2, 60, 60, C.red);
  b.strokeRect(3, 3, 58, 58, C.maroon);
  // coat shoulders and tall collar
  part(b, COAT, (x) => x.poly([[6, 64], [12, 50], [26, 44], [42, 44], [54, 50], [60, 64]], 1));
  part(b, COAT, (x) => x.poly([[22, 40], [42, 40], [44, 52], [20, 52]], 1));
  b.line(22, 40, 26, 52, C.red); b.line(42, 40, 38, 52, C.red);
  // rifle barrel over the near shoulder
  part(b, GUN, (x) => x.capsule(46, 62, 60, 8, 1.6, 1));
  // face
  part(b, SKIN, (x) => { x.ellipse(32, 30, 11, 13, 1); x.rect(27, 38, 10, 5, 1); });
  // platinum bob: crown, sides cut level at the jaw, fringe across the forehead
  part(b, HAIR, (x) => {
    x.ellipse(32, 22, 15, 12, 1);
    x.rect(17, 22, 7, 20, 1);
    x.rect(40, 22, 7, 20, 1);
    x.poly([[18, 22], [30, 18], [44, 20], [46, 26], [36, 24], [24, 27], [18, 28]], 1);
  });
  b.line(22, 14, 30, 11, C.white); b.line(23, 15, 31, 12, C.white);
  // visor band
  b.rect(21, 28, 23, 5, C.red);
  b.hline(22, 43, 28, C.rose);
  b.hline(21, 44, 32, C.maroon);
  b.set(25, 29, C.white); b.set(26, 29, C.white);
  part(b, STEEL, (x) => x.ellipse(45, 31, 2.5, 3.5, 1));
  // nose shadow and a thin straight mouth
  b.set(32, 35, C.skinM); b.set(32, 36, C.skinD);
  b.hline(29, 35, 39, C.skinD);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ cover (40x40, footprint bottom row 36)
const CB = 36;
function cover(kind: 'ac' | 'crate', state: 0 | 1 | 2): PixBuf {
  const b = new PixBuf(40, 40);
  const fw = kind === 'ac' ? 34 : 24, fh = kind === 'ac' ? 18 : 20;
  const H = kind === 'ac' ? 10 : 14;
  const x0 = 20 - fw / 2, x1 = x0 + fw;
  if (state === 2) {
    // flat rubble on the footprint
    for (let y = CB - fh + 4; y <= CB; y++) for (let x = x0; x < x1; x++) {
      const h = hash2(x, y, kind === 'ac' ? 211 : 213);
      if (h < 0.45) continue;
      b.set(x, y, h < 0.6 ? C.slate : h < 0.8 ? C.steel : h < 0.9 ? (kind === 'ac' ? C.fog : C.rust) : C.ink);
    }
    b.outline(C.ink);
    return b;
  }
  const top0 = CB - fh - H + 1, front0 = CB - H + 1;
  if (kind === 'ac') {
    // roof AC unit: steel housing, fan grilles on top, vents on the front
    part(b, mat(RAMP.chrome, 3), (x) => x.rect(x0, top0, fw, fh, 1));
    part(b, mat(RAMP.chrome, 1), (x) => x.rect(x0, front0, fw, H, 1));
    for (const cx of [x0 + 9, x1 - 9]) { b.circle(cx, top0 + fh / 2, 6, C.slate); b.circle(cx, top0 + fh / 2, 5, C.night); b.line(cx - 4, top0 + fh / 2, cx + 4, top0 + fh / 2, C.steel); b.line(cx, top0 + fh / 2 - 4, cx, top0 + fh / 2 + 4, C.steel); }
    for (let x = x0 + 3; x < x1 - 2; x += 3) b.vline(x, front0 + 2, CB - 2, C.night);
    b.hline(x0, x1 - 1, front0, C.fog);
  } else {
    // cargo crate: rust-orange steel box with ribs and a hazard band
    part(b, mat(RAMP.rust, 3), (x) => x.rect(x0, top0, fw, fh, 1));
    part(b, mat(RAMP.rust, 2), (x) => x.rect(x0, front0, fw, H, 1));
    for (let x = x0 + 3; x < x1 - 1; x += 4) b.vline(x, front0 + 1, CB - 1, C.umber);
    for (let x = x0 + 2; x < x1 - 2; x++) b.set(x, front0 + 3, ((x >> 1) & 1) ? C.amber : C.ink);
    b.strokeRect(x0 + 2, top0 + 2, fw - 4, fh - 4, C.rust);
    b.line(x0 + 2, top0 + 2, x1 - 3, top0 + fh - 3, C.rust);
  }
  if (state === 1) {
    for (const [x, y] of [[x0 + 5, front0 + 3], [x1 - 7, top0 + 4], [x0 + fw / 2, front0 + 6], [x0 + 8, top0 + 8]] as Pt[]) {
      b.set(x, y, C.ink); b.set(x + 1, y, C.ink); b.set(x, y + 1, C.ink); b.set(x - 1, y - 1, C.white);
    }
    b.line(x0 + 3, top0 + 1, x0 + 8, top0 + 5, C.ink);
  }
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ devices (24x32, ground row 28)
const DG = 28;
function box(mode: 'on' | 'live' | 'off'): PixBuf {
  const b = new PixBuf(24, 32);
  part(b, mat(RAMP.chrome, 2), (x) => { x.rect(5, 12, 14, 9, 1); x.rect(5, 21, 14, DG - 21, 1); });
  b.hline(5, 18, 21, C.fog);
  // lightning mark
  const c = mode === 'off' ? C.slate : mode === 'live' ? C.ice : C.amber;
  b.line(13, 14, 10, 18, c); b.line(10, 18, 14, 18, c); b.line(14, 18, 11, 22, c);
  b.set(12, 23, c);
  // insulator stack + cable up to the catenary
  part(b, mat(RAMP.white, 1), (x) => x.rect(11, 5, 3, 7, 1), { innerLine: false });
  b.hline(10, 14, 7, C.steel); b.hline(10, 14, 10, C.steel);
  b.vline(12, 1, 4, mode === 'live' ? C.ice : C.fog);
  b.rect(4, DG - 1, 16, 2, C.navy);
  b.set(17, 24, mode === 'off' ? C.maroon : mode === 'live' ? C.white : C.lime);
  b.outline(C.ink);
  return b;
}

function panto(): PixBuf {
  const b = new PixBuf(24, 32);
  // base plate, folded scissor arms up to the contact bar
  part(b, mat(RAMP.chrome, 1), (x) => x.rect(6, DG - 3, 12, 3, 1));
  b.line(8, DG - 3, 15, 15, C.steel); b.line(16, DG - 3, 9, 15, C.steel);
  b.line(15, 15, 10, 6, C.fog); b.line(9, 15, 14, 6, C.fog);
  b.hline(5, 18, 5, C.pale); b.hline(5, 18, 6, C.slate);
  b.set(12, 15, C.amber);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ gantry (overhead truss)
const GANTRY_H = TRAIN.bounds.h + TRAIN.lip + TRAIN.side + 20 + 52;
function gantry(): PixBuf {
  const W = 48, H = GANTRY_H;
  const b = new PixBuf(W, H);
  // two lattice girders across the train, posts at both ends beyond the roof
  for (let y = 10; y < H - 12; y++) {
    b.set(14, y, C.slate); b.set(15, y, C.steel); b.set(32, y, C.slate); b.set(33, y, C.steel);
    const k = y % 14;
    b.set(16 + k, y, C.slate);
    if (k < 14) b.set(31 - k, y, C.navy);
  }
  for (let y = 10; y < H - 12; y += 14) b.hline(14, 33, y, C.steel);
  // warning stripes on the lower edge of the beam
  for (let y = 10; y < H - 12; y++) if (((y >> 2) & 1) === 0) { b.set(13, y, C.amber); b.set(34, y, C.amber); } else { b.set(13, y, C.ink); b.set(34, y, C.ink); }
  // posts
  part(b, mat(RAMP.chrome, 2), (x) => { x.rect(10, 0, 28, 10, 1); x.rect(10, H - 12, 28, 12, 1); });
  b.rect(20, 3, 8, 3, C.red); b.rect(20, H - 8, 8, 3, C.red);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ train cars
const CW = CAR_SPRITE.w, CH = CAR_SPRITE.h, LIP = TRAIN.lip, RH = TRAIN.bounds.h, SIDE = TRAIN.side;
/** Paint one car: far lip, roof panels with seams, step-down hazard stripes at the ends, side with windows. */
function carSprite(kind: 'car_a' | 'car_b' | 'rear' | 'loco'): PixBuf {
  const b = new PixBuf(CW, CH);
  const seed = kind === 'car_b' ? 307 : kind === 'loco' ? 311 : 303;
  // far roof lip (rounded edge seen from above)
  for (let y = 0; y < LIP; y++) for (let x = 0; x < CW; x++) b.set(x, y, y < 2 ? C.slate : y < 5 ? C.steel : C.fog);
  // roof
  for (let y = LIP; y < LIP + RH; y++) for (let x = 0; x < CW; x++) {
    const ry = y - LIP;
    let c: number = C.steel;
    if (hash2(x >> 2, y >> 1, seed) < 0.08) c = C.slate;
    if (ry < 3 || ry > RH - 4) c = C.fog;
    // panel seams across the car and two long ribs
    if ((x % 46) === 0) c = C.slate;
    if (ry === 34 || ry === RH - 35) c = C.slate;
    if (ry === 35 || ry === RH - 34) c = C.fog;
    b.set(x, y, c);
  }
  // centre walkway grating along the car
  const cy0 = LIP + Math.round(RH / 2) - 12, cy1 = LIP + Math.round(RH / 2) + 12;
  for (let y = cy0; y < cy1; y++) for (let x = 6; x < CW - 6; x++) b.set(x, y, (x + y) % 3 === 0 ? C.slate : (y === cy0 || y === cy1 - 1) ? C.indigo : C.steel);
  // roof hatches and vents
  for (let i = 0; i < 5; i++) {
    const hx = 30 + Math.floor(hash2(i, 1, seed) * (CW - 70)), hy = LIP + (i % 2 ? RH - 30 : 18) + Math.floor(hash2(i, 2, seed) * 8);
    b.rect(hx, hy, 14, 8, C.slate); b.strokeRect(hx, hy, 14, 8, C.indigo); b.hline(hx + 2, hx + 11, hy + 3, C.indigo); b.hline(hx + 2, hx + 11, hy + 5, C.indigo);
  }
  // hazard stripes at the car ends (step down into the gap)
  const ends = kind === 'rear' ? [CW - 8] : kind === 'loco' ? [0] : [0, CW - 8];
  for (const ex of ends) for (let y = LIP + 30; y < LIP + RH - 30; y++) for (let x = ex; x < ex + 8; x++) b.set(x, y, ((x + y) >> 2) % 2 ? C.amber : C.ink);
  if (kind === 'rear') for (let y = LIP; y < LIP + RH; y++) { b.set(0, y, C.slate); b.set(1, y, C.fog); }
  // corner lamp housings
  for (const x of [4, CW - 8]) for (const y of [LIP + 3, LIP + RH - 7]) { b.rect(x, y, 4, 4, C.maroon); b.set(x + 1, y + 1, C.red); }
  // the car side: dark band with lit windows, Halcyon red stripe, skirt
  for (let y = LIP + RH; y < CH; y++) for (let x = 0; x < CW; x++) {
    const sy = y - LIP - RH;
    let c: number = sy === 0 ? C.pale : sy < 3 ? C.fog : sy < SIDE - 6 ? C.indigo : sy < SIDE - 4 ? C.red : sy < SIDE ? C.navy : C.ink;
    if (sy >= 6 && sy < SIDE - 9 && x % 22 > 3 && x % 22 < 18 && x > 6 && x < CW - 6) c = (x % 22) < 6 ? C.amber : hash2(x >> 3, sy, seed) < 0.2 ? C.pale : C.sodium;
    if (sy >= 6 && sy < SIDE - 9 && x % 22 === 3) c = C.navy;
    b.set(x, y, c);
  }
  if (kind === 'loco') {
    // driver's cab glass at the front of the roof
    for (let y = LIP + 40; y < LIP + RH - 40; y++) for (let x = CW - 34; x < CW; x++) {
      const t = (x - (CW - 34)) / 34;
      b.set(x, y, t > 0.85 ? C.ice : (x + y) % 7 === 0 ? C.teal : C.abyss);
    }
    b.vline(CW - 35, LIP + 40, LIP + RH - 41, C.fog);
  }
  return b;
}

function gapSprite(kind: 'gap' | 'nose'): PixBuf {
  const b = new PixBuf(CAR_SPRITE.gapW, CH);
  const W = CAR_SPRITE.gapW;
  if (kind === 'gap') {
    // coupler bellows walkway (lower, darker), drops left transparent so the track shows
    const g0 = TRAIN.gaps[0];
    const y0 = LIP + (g0.walkY0 - TRAIN.bounds.y), y1 = LIP + (g0.walkY1 - TRAIN.bounds.y);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) b.set(x, y, x % 4 === 0 ? C.night : x % 4 === 2 ? C.indigo : C.navy);
    for (let x = 0; x < W; x++) { b.set(x, y0, C.ink); b.set(x, y1 - 1, C.ink); }
    // coupler bar under it, visible at the drops
    for (let y = y1; y < y1 + 6; y++) for (let x = 6; x < W - 6; x++) b.set(x, y, y === y1 + 5 ? C.ink : C.slate);
    for (let y = y0 - 6; y < y0; y++) for (let x = 6; x < W - 6; x++) b.set(x, y, y === y0 - 6 ? C.ink : C.slate);
    // shade where the cars' ends overhang
    for (let y = y0; y < y1; y++) { b.set(0, y, C.ink); b.set(W - 1, y, C.ink); }
  } else {
    // locomotive nose: tapered front, headlights
    for (let y = 0; y < CH; y++) for (let x = 0; x < W; x++) {
      const mid = LIP + RH / 2, half = RH / 2 + LIP;
      const lim = half * (1 - (x / W) ** 2 * 0.55);
      if (Math.abs(y - mid) > lim && y < LIP + RH) continue;
      if (y >= LIP + RH && x > W * (1 - (y - LIP - RH) / SIDE) + 4) continue;
      let c: number = y < LIP + RH ? (Math.abs(y - mid) > lim - 3 ? C.fog : C.steel) : C.indigo;
      if (y >= LIP + RH + SIDE - 6 && y < LIP + RH + SIDE - 4) c = C.red;
      b.set(x, y, c);
    }
    for (const y of [LIP + RH / 2 - 40, LIP + RH / 2 + 40]) { b.rect(W - 9, y - 3, 4, 6, C.amber); b.set(W - 8, y - 1, C.white); }
  }
  return b;
}

/** Tiles seamlessly in x: every hash uses x modulo the tile width. */
function trackTile(): PixBuf {
  const W = STRIP.trackW, H = STRIP_H.track;
  const b = new PixBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c: number = hash2(x % W, y >> 1, 401) < 0.3 ? C.night : C.ink;
    // motion-smeared sleepers
    if (x % 32 < 7) c = x % 32 < 2 ? C.navy : C.night;
    // guideway rails (run along the train)
    const ry = y % 48;
    if (ry === 20 || ry === 21) c = C.slate;
    if (ry === 22) c = C.steel;
    b.set(x, y, c);
  }
  return b;
}

function stripTile(where: 'top' | 'bot', tunnel: boolean): PixBuf {
  const W = STRIP.cityW, H = where === 'top' ? STRIP_H.top : STRIP_H.bot;
  const b = new PixBuf(W, H);
  const seed = where === 'top' ? 501 : 503;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // distance from the train (the edge of the strip next to the train)
    const d = where === 'top' ? H - 1 - y : y;
    let c: number;
    if (tunnel) {
      c = d < 4 ? C.ink : (y >> 3) % 2 ? C.night : C.ink;
      if (d >= 6 && x % 64 < 3) c = C.navy;
      // lamp passing every tile, smeared along x
      if (d >= 10 && d < 13 && x % W < 22) c = x % W < 4 ? C.amber : C.sodium;
    } else {
      c = d < 3 ? C.ink : d < 8 ? C.night : C.navy;
      // motion-blurred city lights: long horizontal streaks
      const row = y >> 1;
      const h = hash2(row, Math.floor(x / 24) % (W / 24), seed);
      if (d > 8 && h < 0.22) c = h < 0.05 ? C.magenta : h < 0.1 ? C.cyan : h < 0.16 ? C.sodium : C.indigo;
      if (d > 8 && bayer(x, y) < 2 && c === C.navy) c = C.night;
      // guideway parapet next to the train
      if (d >= 3 && d < 5) c = x % 16 < 2 ? C.slate : C.indigo;
    }
    b.set(x, y, c);
  }
  return b;
}

function trainBg(): PixBuf {
  const b = new PixBuf(TRAIN.size.w, TRAIN.size.h);
  b.fill(C.ink);
  for (let y = 0; y < b.h; y += 3) b.hline(0, b.w - 1, y, C.night);
  return b;
}

export function buildVesperArt(): SheetSpec[] {
  return [
    { key: 'vesper', group: 'Vesper', frameW: 32, frameH: 44, columns: 8, frames: (Object.keys(VPOSES) as VFrame[]).map((k) => ({ name: k, buf: vesperFrame(VPOSES[k]) })) },
    { key: 'vesper_rifle', group: 'Vesper', frameW: 34, frameH: 8, columns: 2, frames: [{ name: 'rifle', buf: rifle(false) }, { name: 'fire', buf: rifle(true) }] },
    { key: 'vesper_fx', group: 'Vesper', frameW: 16, frameH: 16, columns: 3, frames: [{ name: 'mine_a', buf: mine(true) }, { name: 'mine_b', buf: mine(false) }, { name: 'smoke', buf: smokePuff() }] },
    { key: 'vesper_portrait', group: 'Portraits (64x64)', frameW: 64, frameH: 64, frames: [{ name: 'vesper', buf: portrait() }] },
    {
      key: 'train_cover', group: 'Vesper', frameW: 40, frameH: 40, columns: 6, frames: [
        { name: 'ac', buf: cover('ac', 0) }, { name: 'ac_dent', buf: cover('ac', 1) }, { name: 'ac_broken', buf: cover('ac', 2) },
        { name: 'crate', buf: cover('crate', 0) }, { name: 'crate_dent', buf: cover('crate', 1) }, { name: 'crate_broken', buf: cover('crate', 2) },
      ],
    },
    { key: 'train_dev', group: 'Vesper', frameW: 24, frameH: 32, columns: 4, frames: [{ name: 'box', buf: box('on') }, { name: 'box_live', buf: box('live') }, { name: 'box_off', buf: box('off') }, { name: 'panto', buf: panto() }] },
    { key: 'train_gantry', group: 'Vesper', frameW: 48, frameH: GANTRY_H, frames: [{ name: 'beam', buf: gantry() }] },
    { key: 'train_car', group: 'Vesper', frameW: CW, frameH: CH, columns: 2, frames: (['car_a', 'car_b', 'rear', 'loco'] as const).map((k) => ({ name: k, buf: carSprite(k) })) },
    { key: 'train_gap', group: 'Vesper', frameW: CAR_SPRITE.gapW, frameH: CH, columns: 2, frames: [{ name: 'gap', buf: gapSprite('gap') }, { name: 'nose', buf: gapSprite('nose') }] },
    { key: 'train_track', group: 'Vesper', frameW: STRIP.trackW, frameH: STRIP_H.track, frames: [{ name: 'track', buf: trackTile() }] },
    { key: 'train_strip_top', group: 'Vesper', frameW: STRIP.cityW, frameH: STRIP_H.top, columns: 2, frames: [{ name: 'city', buf: stripTile('top', false) }, { name: 'tunnel', buf: stripTile('top', true) }] },
    { key: 'train_strip_bot', group: 'Vesper', frameW: STRIP.cityW, frameH: STRIP_H.bot, columns: 2, frames: [{ name: 'city', buf: stripTile('bot', false) }, { name: 'tunnel', buf: stripTile('bot', true) }] },
    { key: 'bg_train', group: 'Arenas', frameW: TRAIN.size.w, frameH: TRAIN.size.h, frames: [{ name: 'bg', buf: trainBg() }] },
  ];
}
