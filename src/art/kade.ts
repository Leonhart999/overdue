/**
 * Director Kade + Skyline rooftop helipad art (palette indices only).
 *   kade, kade_broken  48x60  idle1, idle2, aim, bash, hurt, leap  (3/4 view facing right, origin
 *                      bottom centre, ground row 56; heavy Halcyon white/gold exoskeleton, red visor,
 *                      shield emitter on the front gauntlet, power pack on the back. Broken: emitter
 *                      cracked, chipped plates, exposed wiring.)
 *   kade_drone         16x16  a, b (rotor frames)
 *   kade_heli          80x96  body (top-down, nose up, rotor drawn at runtime), wreck
 *   pad_dev            32x48  console, console_alert, console_off, turret, turret_hacked, tank, tank_lit
 *                      (ground row 44)
 *   pad_dev_gun        20x10  gun, gun_hacked (pivot at x 5)
 *   pad_tall           24x64  tower, tower_broken (ground row 60, lamp at row 22)
 *   kade_portrait      64x64  kade
 *   bg_helipad         640x360 rainy roof, H pad, rails with two gaps, city lights below.
 */
import { C, RAMP } from './palette';
import { PixBuf, type Pt } from './core/pixbuf';
import { bayer, hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { mat, part } from './actors/rig';
import { PAD } from '../game/arenas/helipad';

const WHITE = mat(RAMP.white, 3);
const WHITE_D = mat(RAMP.white, 2);
const GOLD = mat(RAMP.rust, 4);
const SUIT = mat(RAMP.cool, 3);
const PACK = mat(RAMP.cool, 4);

// ------------------------------------------------------------------ Kade (48x60, ground row 56)
interface KPose {
  /** Upper body shift. */
  ux: number; uy: number;
  /** Front (shield) arm: elbow, hand. */
  fe: Pt; fh: Pt;
  /** Back arm: elbow, hand. */
  be: Pt; bh: Pt;
  /** Feet. */
  ff: Pt; bf: Pt;
  /** Knees. */
  fk: Pt; bk: Pt;
  mood: 'normal' | 'hurt' | 'aim';
}

const KPOSES: Record<'idle1' | 'idle2' | 'aim' | 'bash' | 'hurt' | 'leap', KPose> = {
  idle1: { ux: 0, uy: 0, fe: [35, 32], fh: [38, 37], be: [13, 32], bh: [13, 38], ff: [31, 55], bf: [17, 55], fk: [30, 47], bk: [18, 47], mood: 'normal' },
  idle2: { ux: 0, uy: 1, fe: [35, 33], fh: [38, 38], be: [13, 33], bh: [13, 39], ff: [31, 55], bf: [17, 55], fk: [30, 48], bk: [18, 48], mood: 'normal' },
  aim: { ux: 1, uy: 0, fe: [37, 28], fh: [43, 27], be: [13, 32], bh: [15, 37], ff: [32, 55], bf: [16, 55], fk: [31, 47], bk: [17, 47], mood: 'aim' },
  bash: { ux: 3, uy: 1, fe: [38, 30], fh: [41, 24], be: [15, 33], bh: [18, 38], ff: [35, 55], bf: [13, 55], fk: [33, 47], bk: [16, 48], mood: 'aim' },
  hurt: { ux: -2, uy: 1, fe: [36, 26], fh: [40, 21], be: [10, 30], bh: [6, 26], ff: [32, 55], bf: [18, 55], fk: [31, 48], bk: [19, 48], mood: 'hurt' },
  leap: { ux: 0, uy: 5, fe: [35, 37], fh: [39, 42], be: [12, 37], bh: [11, 43], ff: [34, 55], bf: [14, 55], fk: [35, 49], bk: [13, 49], mood: 'normal' },
};

function kadeFrame(pp: KPose, broken: boolean): PixBuf {
  const b = new PixBuf(48, 60);
  const ux = pp.ux, uy = pp.uy;
  const hipF: Pt = [28 + ux * 0.4, 40 + uy], hipB: Pt = [20 + ux * 0.4, 40 + uy];
  const shF: Pt = [31 + ux, 25 + uy], shB: Pt = [16 + ux, 25 + uy];
  // back leg (suit thigh, white shin, gold boot)
  part(b, mat(RAMP.cool, 2), (x) => x.capsule(hipB[0], hipB[1], pp.bk[0], pp.bk[1], 3, 1));
  part(b, WHITE_D, (x) => x.capsule(pp.bk[0], pp.bk[1], pp.bf[0], pp.bf[1] - 3, 3.2, 1));
  part(b, mat(RAMP.rust, 3), (x) => x.poly([[pp.bf[0] - 4, pp.bf[1] - 4], [pp.bf[0] + 3, pp.bf[1] - 4], [pp.bf[0] + 5, pp.bf[1]], [pp.bf[0] - 4, pp.bf[1]]], 1));
  // power pack on the back
  part(b, PACK, (x) => { x.rect(7 + ux, 19 + uy, 9, 17, 1); x.rect(8 + ux, 17 + uy, 6, 3, 1); });
  for (let y = 22; y < 34; y += 3) { b.hline(9 + ux, 12 + ux, y + uy, broken ? C.red : C.orange); b.set(10 + ux, y + uy, broken ? C.orange : C.sodium); }
  // back arm
  part(b, mat(RAMP.cool, 2), (x) => x.capsule(shB[0], shB[1], pp.be[0], pp.be[1], 2.6, 1));
  part(b, WHITE_D, (x) => x.capsule(pp.be[0], pp.be[1], pp.bh[0], pp.bh[1], 3.2, 1));
  // front leg
  part(b, SUIT, (x) => x.capsule(hipF[0], hipF[1], pp.fk[0], pp.fk[1], 3.2, 1));
  part(b, WHITE, (x) => x.capsule(pp.fk[0], pp.fk[1], pp.ff[0], pp.ff[1] - 3, 3.4, 1));
  part(b, WHITE, (x) => x.circle(pp.fk[0] + 1, pp.fk[1], 3, 1));
  part(b, GOLD, (x) => x.poly([[pp.ff[0] - 4, pp.ff[1] - 4], [pp.ff[0] + 3, pp.ff[1] - 4], [pp.ff[0] + 6, pp.ff[1]], [pp.ff[0] - 4, pp.ff[1]]], 1));
  // pelvis
  part(b, SUIT, (x) => x.poly([[17 + ux, 35 + uy], [31 + ux, 35 + uy], [30 + ux * 0.5, 42 + uy], [18 + ux * 0.5, 42 + uy]], 1));
  b.hline(18 + ux, 30 + ux, 36 + uy, C.amber);
  // torso: white chest plate, gold trim, dark abdomen
  part(b, SUIT, (x) => x.poly([[19 + ux, 30 + uy], [30 + ux, 30 + uy], [29 + ux, 37 + uy], [19 + ux, 37 + uy]], 1));
  part(b, WHITE, (x) => x.poly([[14 + ux, 22 + uy], [33 + ux, 21 + uy], [34 + ux, 26 + uy], [30 + ux, 32 + uy], [18 + ux, 32 + uy], [14 + ux, 27 + uy]], 1));
  b.line(19 + ux, 31 + uy, 29 + ux, 31 + uy, C.sodium);
  b.line(24 + ux, 22 + uy, 26 + ux, 30 + uy, C.amber);
  // Halcyon mark on the chest (gold ring)
  b.set(28 + ux, 25 + uy, C.amber); b.set(29 + ux, 24 + uy, C.amber); b.set(30 + ux, 25 + uy, C.amber); b.set(29 + ux, 26 + uy, C.amber);
  // head: helmet with a red visor on the facing side
  const hx = 25 + ux, hy = 15 + uy;
  part(b, WHITE, (x) => { x.ellipse(hx, hy, 6.5, 6.5, 1); x.rect(hx - 4, hy + 4, 8, 4, 1); });
  part(b, GOLD, (x) => x.poly([[hx - 5, hy - 5], [hx + 1, hy - 8], [hx + 3, hy - 6], [hx - 3, hy - 3]], 1));
  const vy = hy + (pp.mood === 'hurt' ? 1 : 0);
  b.rect(hx + 1, vy - 1, 6, 3, C.red);
  b.hline(hx + 2, hx + 6, vy - 1, C.rose);
  b.set(hx + 6, vy + 1, C.maroon); b.set(hx + 1, vy + 1, C.maroon);
  if (pp.mood === 'hurt') { b.set(hx + 3, vy, C.maroon); b.set(hx + 5, vy, C.maroon); }
  // pauldrons
  part(b, WHITE_D, (x) => x.ellipse(shB[0], shB[1] - 1, 5, 4.5, 1));
  b.hline(shB[0] - 4, shB[0] + 3, shB[1] + 2, C.sodium);
  // front arm with the shield gauntlet
  part(b, SUIT, (x) => x.capsule(shF[0], shF[1], pp.fe[0], pp.fe[1], 2.8, 1));
  part(b, WHITE, (x) => x.capsule(pp.fe[0], pp.fe[1], pp.fh[0], pp.fh[1], 3.6, 1));
  part(b, WHITE, (x) => x.ellipse(shF[0], shF[1] - 1, 6, 5, 1));
  b.hline(shF[0] - 5, shF[0] + 4, shF[1] + 3, C.amber);
  // emitter disc on the gauntlet
  part(b, GOLD, (x) => x.circle(pp.fh[0] + 0.5, pp.fh[1] + 0.5, 3, 1));
  if (!broken) { b.set(pp.fh[0], pp.fh[1], C.white); b.set(pp.fh[0] + 1, pp.fh[1], C.amber); b.set(pp.fh[0], pp.fh[1] + 1, C.amber); }
  else { b.set(pp.fh[0], pp.fh[1], C.ink); b.set(pp.fh[0] + 1, pp.fh[1] + 1, C.ink); b.set(pp.fh[0] - 1, pp.fh[1] - 1, C.ink); }
  if (broken) {
    // chipped plates and exposed wiring
    for (let y = 10; y < 56; y++) for (let x = 6; x < 46; x++) {
      const c = b.get(x, y);
      if ((c === C.white || c === C.pale) && hash2(x, y, 41) < 0.08) b.set(x, y, C.slate);
      if (c === C.amber && hash2(x, y, 43) < 0.35) b.set(x, y, C.rust);
    }
    b.line(20 + ux, 27 + uy, 23 + ux, 29 + uy, C.red);
    b.line(21 + ux, 26 + uy, 22 + ux, 30 + uy, C.orange);
    b.set(shF[0] + 2, shF[1] - 2, C.ink); b.set(shF[0] + 3, shF[1] - 1, C.ink);
  }
  b.outline(C.ink);
  // visor glint and emitter spark sit outside the outline
  if (!broken) b.set(pp.fh[0] + 3, pp.fh[1] - 2, C.amber);
  else if (pp.mood !== 'hurt') b.set(pp.fh[0] + 3, pp.fh[1] - 3, C.ice);
  return b;
}

function kadeFrames(broken: boolean): { name: string; buf: PixBuf }[] {
  return (Object.keys(KPOSES) as (keyof typeof KPOSES)[]).map((k) => ({ name: k, buf: kadeFrame(KPOSES[k], broken) }));
}

// ------------------------------------------------------------------ drone (16x16)
function drone(f: 0 | 1): PixBuf {
  const b = new PixBuf(16, 16);
  // rotor arms + rotors
  b.line(2, 6, 13, 6, C.slate);
  for (const x of [2, 13]) {
    if (f) b.hline(x - 2, x + 2, 4, C.fog); else { b.set(x - 1, 4, C.fog); b.set(x + 1, 4, C.fog); b.set(x, 3, C.fog); b.set(x, 5, C.fog); }
    b.set(x, 5, C.steel);
  }
  part(b, WHITE, (x) => x.ellipse(8, 9, 5, 3.5, 1));
  part(b, GOLD, (x) => x.rect(4, 10, 8, 1, 1), { innerLine: false });
  b.rect(9, 8, 3, 2, C.red);
  b.set(10, 8, C.rose);
  // sensor stalk underneath
  b.set(8, 13, C.slate); b.set(8, 14, C.red);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ helicopter (80x96, top-down, nose up)
function heli(wreck: boolean): PixBuf {
  const b = new PixBuf(80, 96);
  const cx = 40;
  if (!wreck) {
    // skids
    for (const x of [cx - 15, cx + 15]) { b.vline(x, 26, 58, C.slate); b.vline(x + (x < cx ? -1 : 1), 26, 58, C.steel); }
    b.hline(cx - 15, cx + 15, 32, C.slate); b.hline(cx - 15, cx + 15, 50, C.slate);
    // tail boom
    part(b, WHITE_D, (x) => { x.rect(cx - 3, 54, 6, 30, 1); x.rect(cx - 1, 84, 3, 6, 1); });
    part(b, WHITE, (x) => x.poly([[cx - 9, 84], [cx + 9, 84], [cx + 7, 90], [cx - 7, 90]], 1));
    b.hline(cx - 2, cx + 2, 66, C.red); b.hline(cx - 2, cx + 2, 72, C.red);
    // tail rotor
    b.line(cx + 6, 80, cx + 12, 92, C.fog); b.line(cx + 12, 80, cx + 6, 92, C.fog);
    // fuselage
    part(b, WHITE, (x) => x.ellipse(cx, 38, 13, 22, 1));
    part(b, GOLD, (x) => x.rect(cx - 13, 44, 26, 3, 1), { innerLine: false });
    // cockpit glass at the nose
    part(b, mat(RAMP.teal, 2), (x) => x.ellipse(cx, 24, 9, 8, 1));
    b.hline(cx - 4, cx + 2, 20, C.ice); b.set(cx - 5, 21, C.ice);
    // engine housing + rotor mast
    part(b, mat(RAMP.cool, 4), (x) => x.rect(cx - 6, 36, 12, 10, 1));
    b.circle(cx, 40, 3, C.ink); b.circle(cx, 40, 1.5, C.steel);
    // sliding doors
    b.vline(cx - 12, 32, 46, C.steel); b.vline(cx + 12, 32, 46, C.steel);
  } else {
    // burnt hull broken in two
    part(b, mat(RAMP.cool, 2), (x) => { x.ellipse(cx - 2, 40, 13, 18, 1); x.poly([[cx + 4, 56], [cx + 12, 60], [cx + 18, 84], [cx + 12, 86]], 1); });
    part(b, mat(RAMP.cool, 1), (x) => x.ellipse(cx - 4, 28, 8, 6, 1));
    for (let y = 18; y < 90; y++) for (let x = 8; x < 72; x++) {
      const c = b.get(x, y);
      if (!c) continue;
      const h = hash2(x, y, 51);
      if (h < 0.12) b.set(x, y, C.ink);
      else if (h < 0.16) b.set(x, y, C.slate);
      else if (h < 0.19) b.set(x, y, C.pale);
    }
    // bent rotor blades and skids
    b.line(cx - 34, 30, cx + 6, 46, C.slate); b.line(cx - 6, 70, cx + 30, 18, C.steel);
    b.line(cx - 18, 52, cx - 26, 70, C.slate); b.line(cx + 14, 30, cx + 24, 52, C.slate);
    b.hline(cx - 10, cx - 2, 46, C.rust);
  }
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ devices (32x48, ground row 44)
const GR = 44;
function dev(draw: (b: PixBuf) => void): PixBuf {
  const b = new PixBuf(32, 48);
  draw(b);
  b.outline(C.ink);
  return b;
}

function consoleFrame(mode: 'on' | 'alert' | 'off'): PixBuf {
  return dev((b) => {
    part(b, mat(RAMP.cool, 4), (x) => x.poly([[9, GR], [23, GR], [22, 30], [10, 30]], 1));
    part(b, WHITE, (x) => x.poly([[6, 30], [26, 30], [24, 20], [8, 20]], 1));
    // screen
    const sc = mode === 'off' ? C.navy : mode === 'alert' ? C.red : C.teal;
    b.rect(10, 22, 12, 6, sc);
    if (mode !== 'off') {
      b.hline(11, 17, 23, mode === 'alert' ? C.amber : C.cyan);
      b.hline(11, 14, 25, mode === 'alert' ? C.rose : C.ice);
      // little helicopter glyph
      b.hline(17, 21, 24, mode === 'alert' ? C.white : C.ice); b.set(19, 25, mode === 'alert' ? C.white : C.ice); b.hline(18, 20, 26, mode === 'alert' ? C.white : C.ice);
    }
    // hazard stripes on the pedestal, gold trim, call button
    for (let x = 9; x < 23; x++) for (let y = 38; y < 41; y++) b.set(x, y, ((x + y) >> 1) % 2 ? C.amber : C.ink);
    b.hline(7, 25, 30, C.sodium);
    b.circle(23, 33, 1.6, mode === 'off' ? C.maroon : C.amber);
    b.rect(8, GR - 1, 16, 2, C.navy);
  });
}

function turretFrame(hacked: boolean): PixBuf {
  return dev((b) => {
    // tripod base
    b.line(16, 32, 9, GR, C.slate); b.line(16, 32, 23, GR, C.slate); b.line(16, 32, 16, GR, C.steel);
    part(b, mat(RAMP.cool, 4), (x) => x.ellipse(16, GR - 1, 9, 2.5, 1));
    // housing
    part(b, WHITE, (x) => x.ellipse(16, 28, 8, 7, 1));
    part(b, GOLD, (x) => x.rect(8, 31, 17, 2, 1), { innerLine: false });
    // sensor eye
    const e = hacked ? C.acid : C.red, e2 = hacked ? C.lime : C.maroon;
    b.rect(13, 25, 6, 3, e2); b.rect(14, 25, 4, 2, e); b.set(15, 25, C.white);
  });
}

function tankFrame(lit: boolean): PixBuf {
  return dev((b) => {
    part(b, WHITE, (x) => { x.rect(8, 18, 16, GR - 19, 1); x.ellipse(16, 18, 8, 3, 1); x.ellipse(16, GR - 2, 8, 2.5, 1); });
    // red hazard band + flame symbol
    for (let y = 26; y < 34; y++) for (let x = 8; x < 24; x++) if (b.get(x, y)) b.set(x, y, y === 26 || y === 33 ? C.maroon : C.red);
    b.set(16, 28, C.amber); b.set(15, 29, C.amber); b.set(16, 29, C.white); b.set(17, 30, C.amber); b.set(16, 31, C.amber); b.set(15, 31, C.amber);
    b.hline(9, 23, 37, C.steel);
    // valve on top
    b.rect(14, 13, 4, 3, C.slate); b.hline(12, 19, 12, C.amber);
    if (lit) for (let y = 18; y < GR; y++) for (let x = 8; x < 24; x++) if (b.get(x, y) === C.pale && hash2(x, y, 3) < 0.3) b.set(x, y, C.orange);
  });
}

function gun(hacked: boolean): PixBuf {
  const b = new PixBuf(20, 10);
  b.rect(2, 3, 6, 4, C.pale);
  b.rect(7, 3, 11, 1, C.steel); b.rect(7, 6, 11, 1, C.steel);
  b.rect(7, 4, 10, 2, C.slate);
  b.set(18, 3, hacked ? C.acid : C.red); b.set(18, 6, hacked ? C.acid : C.red);
  b.set(4, 4, hacked ? C.acid : C.red);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ searchlight tower (24x64, ground row 60)
function tower(broken: boolean): PixBuf {
  const b = new PixBuf(24, 64);
  const G = 60;
  // lattice mast
  for (let y = 26; y < G; y++) {
    b.set(9, y, C.slate); b.set(14, y, C.slate);
    if ((y - 26) % 6 === 0) b.hline(9, 14, y, C.steel);
    if ((y - 26) % 6 < 6) { const k = (y - 26) % 6; b.set(9 + k, y, C.steel); }
  }
  b.rect(6, G - 2, 12, 2, C.navy);
  b.hline(7, 16, G - 3, C.amber);
  if (!broken) {
    // lamp housing with a bright lens facing down-forward
    part(b, WHITE, (x) => x.rect(5, 15, 14, 10, 1));
    b.rect(7, 18, 10, 6, C.white);
    b.rect(8, 19, 8, 4, C.amber);
    b.hline(5, 18, 25, C.sodium);
  } else {
    part(b, mat(RAMP.cool, 3), (x) => x.poly([[5, 18], [19, 16], [18, 25], [6, 25]], 1));
    b.rect(8, 20, 8, 3, C.ink);
    b.set(9, 19, C.pale); b.set(13, 21, C.slate); b.set(15, 19, C.pale);
  }
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ portrait (64x64)
function portrait(): PixBuf {
  const b = new PixBuf(64, 64);
  b.rect(2, 2, 60, 60, C.navy);
  for (let y = 4; y < 61; y += 3) b.hline(3, 60, y, C.night);
  // rain streaks in the backdrop
  for (let i = 0; i < 20; i++) { const x = 4 + Math.floor(hash2(i, 1, 61) * 54), y = 4 + Math.floor(hash2(i, 2, 61) * 50); b.set(x, y, C.indigo); b.set(x, y + 1, C.indigo); }
  b.strokeRect(2, 2, 60, 60, C.amber);
  b.strokeRect(3, 3, 58, 58, C.rust);
  // shoulders + chest plate
  part(b, WHITE_D, (x) => x.ellipse(12, 58, 12, 10, 1));
  part(b, WHITE, (x) => x.ellipse(52, 56, 13, 11, 1));
  part(b, WHITE, (x) => x.poly([[16, 64], [20, 48], [44, 48], [48, 64]], 1));
  b.hline(18, 46, 54, C.sodium);
  b.circle(32, 58, 3, C.amber); b.circle(32, 58, 1.5, C.pale);
  // neck seal
  part(b, mat(RAMP.cool, 3), (x) => x.rect(25, 42, 14, 7, 1));
  // helmet
  part(b, WHITE, (x) => { x.ellipse(33, 26, 17, 18, 1); x.rect(18, 30, 30, 13, 1); });
  part(b, GOLD, (x) => x.poly([[18, 13], [32, 6], [38, 8], [24, 18]], 1));
  // visor band
  b.rect(22, 25, 26, 7, C.red);
  b.hline(24, 46, 25, C.rose);
  b.hline(22, 47, 31, C.maroon);
  b.set(41, 27, C.white); b.set(42, 27, C.white); b.set(41, 28, C.rose);
  // jaw vents
  for (let x = 26; x < 42; x += 3) b.vline(x, 36, 40, C.steel);
  b.hline(19, 47, 43, C.amber);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ background (640x360)
function helipadBg(): PixBuf {
  const W = 640, H = 360;
  const b = new PixBuf(W, H);
  const B = PAD.bounds, G = PAD.gap;
  const inside = (x: number, y: number) => x >= B.x && x < B.x + B.w && y >= B.y && y < B.y + B.h;

  // ---- city far below: night sky gradient with window lights
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, W - 1 - x, Math.max(0, H - 1 - y));
    let c: number = d < 14 ? C.ink : C.night;
    if (bayer(x, y) < 3 && d < 22) c = C.ink;
    b.set(x, y, c);
  }
  // building blocks with lit windows (only visible outside the roof)
  for (let i = 0; i < 70; i++) {
    const bx = Math.floor(hash2(i, 1, 71) * W), by = Math.floor(hash2(i, 2, 71) * H);
    const bw = 10 + Math.floor(hash2(i, 3, 71) * 22), bh = 10 + Math.floor(hash2(i, 4, 71) * 24);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      b.set(x, y, (x === bx || y === by) ? C.indigo : C.navy);
      if ((x - bx) % 3 === 1 && (y - by) % 3 === 1) {
        const h = hash2(x, y, 73);
        if (h < 0.22) b.set(x, y, h < 0.08 ? C.sodium : h < 0.13 ? C.cyan : h < 0.16 ? C.magenta : C.amber);
      }
    }
  }

  // ---- parapet band behind the top rail
  for (let y = 0; y < B.y; y++) for (let x = 0; x < W; x++) {
    if (y < 30) continue;
    let c: number = y < 32 ? C.ink : y < 44 ? C.indigo : y < 48 ? C.slate : C.navy;
    if (y >= 32 && y < 44 && x % 48 < 2) c = C.navy;
    b.set(x, y, c);
  }
  // Halcyon gold band on the parapet
  for (let x = 0; x < W; x++) { b.set(x, 36, C.rust); b.set(x, 37, (x >> 2) % 6 === 0 ? C.amber : C.sodium); }

  // ---- roof surface: wet concrete with seams, rain puddles and reflections
  for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
    const h = hash2(x >> 1, y >> 1, 81);
    let c: number = C.navy;
    if (h < 0.18) c = C.indigo;
    else if (h > 0.97) c = C.slate;
    if ((x - B.x) % 40 === 0 || (y - B.y) % 34 === 0) c = C.night;
    b.set(x, y, c);
  }
  // puddles (lighter, with streaky reflections of the city lights)
  for (let i = 0; i < 14; i++) {
    const px = B.x + 20 + Math.floor(hash2(i, 1, 83) * (B.w - 40)), py = B.y + 14 + Math.floor(hash2(i, 2, 83) * (B.h - 28));
    const rx = 10 + hash2(i, 3, 83) * 22, ry = 4 + hash2(i, 4, 83) * 7;
    for (let y = Math.floor(py - ry); y <= py + ry; y++) for (let x = Math.floor(px - rx); x <= px + rx; x++) {
      if (!inside(x, y)) continue;
      const d = ((x - px) / rx) ** 2 + ((y - py) / ry) ** 2;
      if (d > 1) continue;
      let c: number = d > 0.75 ? C.indigo : C.slate;
      if (hash2(x, y >> 1, 85) < 0.06) c = C.steel;
      if (hash2(x >> 1, y, 87) < 0.015) c = hash2(x, y, 88) < 0.5 ? C.magenta : C.cyan;
      b.set(x, y, c);
    }
  }
  // ---- helipad: dark circle, amber edge ring, white H
  const hc = PAD.pad, RX = 92, RY = 66;
  for (let y = hc.y - RY - 2; y <= hc.y + RY + 2; y++) for (let x = hc.x - RX - 2; x <= hc.x + RX + 2; x++) {
    const d = Math.hypot((x - hc.x) / RX, (y - hc.y) / RY);
    if (d > 1.02) continue;
    let c: number = hash2(x >> 1, y >> 1, 91) < 0.15 ? C.indigo : C.navy;
    if (d > 0.93) c = (Math.floor(Math.atan2(y - hc.y, x - hc.x) * 10) & 1) ? C.sodium : C.ink;
    else if (d > 0.89) c = C.night;
    else if (d > 0.84) c = C.slate;
    if (hash2(x, y, 92) < 0.05 && c !== C.night) c = C.night; // worn paint
    b.set(x, y, c);
  }
  // H letter (paint, slightly worn)
  const H_W = 46, H_H = 52, bar = 9;
  for (let y = hc.y - H_H / 2; y < hc.y + H_H / 2; y++) for (let x = hc.x - H_W / 2; x < hc.x + H_W / 2; x++) {
    const lx = x - (hc.x - H_W / 2), ly = y - (hc.y - H_H / 2);
    const on = lx < bar || lx >= H_W - bar || (ly >= H_H / 2 - bar / 2 && ly < H_H / 2 + bar / 2);
    if (!on) continue;
    b.set(x, y, hash2(x, y, 93) < 0.08 ? C.fog : ly === 0 || lx === 0 || lx === H_W - bar ? C.white : C.pale);
  }
  // yellow walkway line from the console to the pad
  for (let y = PAD.console[1] - 12; y > hc.y + RY + 2; y--) if ((y >> 2) % 2 === 0) { b.set(PAD.console[0] - 1, y, C.amber); b.set(PAD.console[0], y, C.amber); }
  // hazard stripes on the floor next to the rail gaps
  for (const side of [0, 1]) {
    const x0 = side ? B.x + B.w - 14 : B.x, x1 = x0 + 14;
    for (let y = G.y0 - 6; y < G.y1 + 6; y++) for (let x = x0; x < x1; x++) b.set(x, y, ((x + y) >> 2) % 2 ? C.amber : C.ink);
  }
  // device pads under turrets / towers / tanks (square plates)
  for (const [x, y] of [...PAD.turrets, ...PAD.towers, ...PAD.tanks]) {
    for (let yy = y - 8; yy < y + 6; yy++) for (let xx = x - 13; xx < x + 13; xx++) {
      if (!inside(xx, yy)) continue;
      b.set(xx, yy, yy === y - 8 || xx === x - 13 || xx === x + 12 || yy === y + 5 ? C.slate : C.indigo);
    }
  }

  // ---- rails: top, bottom and sides (side rails have the gaps)
  const rail = (x: number, y: number, horiz: boolean) => {
    if (horiz) {
      b.set(x, y, C.fog); b.set(x, y + 1, C.steel); b.set(x, y + 2, C.ink);
      if (x % 16 === 0) for (let k = 3; k < 9; k++) b.set(x, y + k, k === 8 ? C.ink : C.slate);
    } else {
      b.set(x, y, C.steel); b.set(x + 1, y, C.fog); b.set(x + 2, y, C.ink);
      if (y % 16 === 0) for (let k = -3; k < 4; k++) b.set(x + k, y, C.slate);
    }
  };
  for (let x = B.x - 6; x < B.x + B.w + 6; x++) { rail(x, B.y - 8, true); }
  // bottom: roof lip then rail
  for (let y = B.y + B.h; y < B.y + B.h + 10; y++) for (let x = B.x - 8; x < B.x + B.w + 8; x++) b.set(x, y, y === B.y + B.h ? C.steel : y < B.y + B.h + 4 ? C.slate : C.indigo);
  for (let x = B.x - 8; x < B.x + B.w + 8; x++) rail(x, B.y + B.h + 2, true);
  for (const side of [0, 1]) {
    const lip0 = side ? B.x + B.w : B.x - 8;
    for (let y = B.y - 6; y < B.y + B.h + 10; y++) {
      const gap = y >= G.y0 && y < G.y1;
      for (let x = lip0; x < lip0 + 8; x++) {
        if (gap) continue;
        b.set(x, y, (side ? x - lip0 : lip0 + 7 - x) === 7 ? C.steel : C.slate);
      }
      if (!gap) rail(side ? B.x + B.w + 2 : B.x - 5, y, false);
    }
    // broken rail stubs at the gap ends, red tips
    for (const y of [G.y0 - 1, G.y1]) {
      const x = side ? B.x + B.w + 2 : B.x - 5;
      for (let k = 0; k < 4; k++) b.set(x + (side ? k : -k) * 0, y + (y === G.y0 - 1 ? -k : k), k === 0 ? C.red : C.steel);
      b.set(x, y, C.red); b.set(x + 1, y, C.red);
    }
    // the drop: the roof edge seen from above at the gap
    for (let y = G.y0; y < G.y1; y++) for (let x = lip0; x < lip0 + 8; x++) b.set(x, y, (x + y) % 3 === 0 ? C.ink : C.night);
  }
  // rail posts' shadows on the roof edge
  for (let x = B.x; x < B.x + B.w; x++) if (bayer(x, B.y) < 8) b.set(x, B.y, C.night);
  return b;
}

export function buildKadeArt(): SheetSpec[] {
  return [
    { key: 'kade', group: 'Kade', frameW: 48, frameH: 60, columns: 6, frames: kadeFrames(false) },
    { key: 'kade_broken', group: 'Kade', frameW: 48, frameH: 60, columns: 6, frames: kadeFrames(true) },
    { key: 'kade_drone', group: 'Kade', frameW: 16, frameH: 16, columns: 2, frames: [{ name: 'a', buf: drone(0) }, { name: 'b', buf: drone(1) }] },
    { key: 'kade_heli', group: 'Kade', frameW: 80, frameH: 96, columns: 2, frames: [{ name: 'body', buf: heli(false) }, { name: 'wreck', buf: heli(true) }] },
    {
      key: 'pad_dev', group: 'Kade', frameW: 32, frameH: 48, columns: 7, frames: [
        { name: 'console', buf: consoleFrame('on') },
        { name: 'console_alert', buf: consoleFrame('alert') },
        { name: 'console_off', buf: consoleFrame('off') },
        { name: 'turret', buf: turretFrame(false) },
        { name: 'turret_hacked', buf: turretFrame(true) },
        { name: 'tank', buf: tankFrame(false) },
        { name: 'tank_lit', buf: tankFrame(true) },
      ],
    },
    { key: 'pad_dev_gun', group: 'Kade', frameW: 20, frameH: 10, columns: 2, frames: [{ name: 'gun', buf: gun(false) }, { name: 'gun_hacked', buf: gun(true) }] },
    { key: 'pad_tall', group: 'Kade', frameW: 24, frameH: 64, columns: 2, frames: [{ name: 'tower', buf: tower(false) }, { name: 'tower_broken', buf: tower(true) }] },
    { key: 'kade_portrait', group: 'Portraits (64x64)', frameW: 64, frameH: 64, frames: [{ name: 'kade', buf: portrait() }] },
    { key: 'bg_helipad', group: 'Arenas', frameW: 640, frameH: 360, frames: [{ name: 'bg', buf: helipadBg() }] },
  ];
}
