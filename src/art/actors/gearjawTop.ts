/**
 * GEARJAW in-fight sprite, 3/4 top-down view (replaces the old side-view battler in gearjaw.ts).
 * 96x96 frames, drawn facing right (the boss code flips them), origin (0.5, 1) placed at
 * (x, y + 11): the ground point is frame (48, 85).
 *   gearjaw           armoured: rust hazard plates over the chest and the front glacis
 *   gearjaw_stripped  plates torn off: glowing engine core, pistons, loose cables
 * Frames: idle1, idle2 (1px bob + exhaust flicker), attack (boom raised, hook swung forward),
 * hurt (recoil, boom droops, sparks).
 *
 * Points the gameplay code relies on (frame coordinates, facing right):
 *   hook origin   (87, 41)   hook block hangs here on idle frames (hookOrigin = x + 39, y - 44)
 *   rear engine   (18, 23)   glowing grille on the engine tower (weak-point glow at x - 30, y - 62)
 *   stack tops    (14..25, 3..8)   smoke is emitted around (22, 5..9)
 *   core          (45, 50)   exposed engine core when stripped (glow at x - 3, y - 35)
 *   head top      row ~2     stagger stars circle at row 1
 */
import { C, RAMP } from '../palette';
import { PixBuf, type Pt } from '../core/pixbuf';
import { hash2 } from '../core/rng';
import { mat, part } from './rig';
import { BATTLE_FRAMES, type BattleFrame } from './rig';

const S = 96;

const IRON = mat(RAMP.cool, 3);
const IRON_D = mat(RAMP.cool, 2);
const IRON_L = mat(RAMP.cool, 4);
const ARMOR = mat(RAMP.rust, 3);
const ARMOR_D = mat(RAMP.rust, 2);
const SKIN = mat(RAMP.skin, 2);
const MOHAWK = mat(RAMP.red, 2);
const LEATHER = mat([C.ink, C.umber, C.skinX, C.skinD], 2);
const CHROME = mat(RAMP.chrome, 3);
const BOOM = mat(RAMP.rust, 4);

/** Fill a polygon with a hazard stripe (ink / amber diagonal bands) inside an existing shape. */
function hazard(b: PixBuf, pts: Pt[]): void {
  const m = new PixBuf(S, S);
  m.poly(pts, 1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!m.get(x, y) || !b.get(x, y)) continue;
    b.set(x, y, ((x - y) >> 2) % 2 === 0 ? C.ink : C.amber);
  }
}

/** Worn paint: small clusters a step darker (not single-pixel noise). */
function wear(b: PixBuf, seed: number, x0: number, y0: number, w: number, h: number, from: number[], to: number): void {
  for (let cy = y0; cy < y0 + h; cy += 3) for (let cx = x0; cx < x0 + w; cx += 5) {
    if (hash2(cx, cy, seed) > 0.22) continue;
    const ox = Math.floor(hash2(cx, cy, seed + 1) * 3);
    for (let k = 0; k < 2; k++) { const x = cx + ox + k, y = cy; if (from.includes(b.get(x, y))) b.set(x, y, to); }
  }
}

/** Lattice boom between two points: two chords with zig-zag braces. */
function boom(b: PixBuf, a: Pt, t: Pt): void {
  const dx = t[0] - a[0], dy = t[1] - a[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const w0 = 3.4, w1 = 1.8;
  const A1: Pt = [a[0] + nx * w0, a[1] + ny * w0], B1: Pt = [t[0] + nx * w1, t[1] + ny * w1];
  const A2: Pt = [a[0] - nx * w0, a[1] - ny * w0], B2: Pt = [t[0] - nx * w1, t[1] - ny * w1];
  part(b, BOOM, (x) => {
    x.capsule(A1[0], A1[1], B1[0], B1[1], 1.2, 1);
    x.capsule(A2[0], A2[1], B2[0], B2[1], 1.2, 1);
    const n = Math.max(3, Math.floor(len / 5));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const p: Pt = i % 2 ? [A1[0] + (B1[0] - A1[0]) * t0, A1[1] + (B1[1] - A1[1]) * t0] : [A2[0] + (B2[0] - A2[0]) * t0, A2[1] + (B2[1] - A2[1]) * t0];
      const q: Pt = i % 2 ? [A2[0] + (B2[0] - A2[0]) * t1, A2[1] + (B2[1] - A2[1]) * t1] : [A1[0] + (B1[0] - A1[0]) * t1, A1[1] + (B1[1] - A1[1]) * t1];
      x.line(p[0], p[1], q[0], q[1], 1);
    }
  }, { innerLine: false });
  // pulley at the tip
  part(b, IRON_L, (x) => x.circle(t[0] + 0.5, t[1] + 0.5, 2.6, 1));
  b.set(Math.round(t[0]), Math.round(t[1]), C.ink);
}

/** Hook block + curved hook hanging from `top` (the hook origin). */
function hook(b: PixBuf, top: Pt, swing: number): void {
  const [hx, hy] = top;
  part(b, IRON_L, (x) => x.rect(hx - 3, hy - 2, 7, 5, 1));
  b.hline(hx - 2, hx + 2, hy, C.orange);
  const cx = hx + swing, cy = hy + 10;
  part(b, CHROME, (x) => {
    for (let a = -Math.PI / 2; a <= Math.PI * 1.1; a += 0.05) x.circle(cx + Math.cos(a) * 4.5, cy + Math.sin(a) * 4.5, 1.5, 1);
    x.capsule(hx, hy + 3, cx, cy - 4.5, 1.5, 1);
  });
  b.set(Math.round(cx - 4), Math.round(cy - 3), C.white);
}

function drawGearjaw(f: BattleFrame, stripped: boolean): PixBuf {
  const b = new PixBuf(S, S);
  const bob = f === 'idle2' ? 1 : 0;
  const ux = f === 'hurt' ? -3 : f === 'attack' ? 1 : 0;
  const uy = bob + (f === 'hurt' ? 1 : 0);
  const U = (x: number, y: number): Pt => [x + ux, y + uy];
  const P = (pts: Pt[]): Pt[] => pts.map(([x, y]) => U(x, y));

  // ---------------------------------------------------------------- far tread (behind the hull; both ends show)
  part(b, IRON_D, (x) => x.poly([[10, 58], [84, 55], [92, 61], [90, 70], [12, 72], [5, 66]], 1));
  part(b, IRON, (x) => x.poly([[10, 58], [84, 55], [88, 58], [8, 61]], 1), { innerLine: false });
  for (const cx of [9, 88]) { part(b, IRON_L, (x) => x.circle(cx + 0.5, 65.5, 3.2, 1)); b.set(cx, 65, C.night); }

  // ---------------------------------------------------------------- rear engine tower + stacks
  part(b, IRON_D, (x) => x.poly(P([[8, 22], [30, 20], [32, 56], [10, 58]]), 1));
  part(b, IRON, (x) => x.poly(P([[8, 22], [14, 16], [34, 15], [30, 20]]), 1), { innerLine: false });
  // stacks (top rims glow; flicker on idle2)
  for (const [sx, top] of [[12, 3], [21, 6]] as const) {
    part(b, IRON_L, (x) => { const p = U(sx, top); x.rect(p[0], p[1], 5, 19 - top + 3, 1); });
    const p = U(sx, top);
    b.hline(p[0], p[0] + 4, p[1], C.ink);
    b.hline(p[0], p[0] + 4, p[1] + 1, f === 'idle2' ? C.sodium : C.orange);
    b.hline(p[0] + 1, p[0] + 3, p[1] + 2, C.rust);
    for (const y of [9, 14]) if (p[1] + y - top < p[1] + 19 - top) b.hline(p[0], p[0] + 4, p[1] + y - top + 3, C.navy);
  }
  // engine grille (the rear weak point) on the tower face
  {
    const [gx, gy] = U(12, 21);
    b.rect(gx, gy, 14, 9, C.ink);
    for (let y = 0; y < 9; y++) {
      if (y % 2 === 0) continue;
      const c = y === 3 || y === 5 ? (stripped ? C.amber : C.sodium) : C.orange;
      b.hline(gx + 1, gx + 12, gy + y, c);
    }
    b.set(gx + 6, gy + 3, C.white);
    // exhaust pipe feeding the stacks
    const [px, py] = U(26, 32);
    b.rect(px, py, 4, 3, C.slate); b.hline(px, px + 3, py, C.steel);
  }
  // vents down the tower
  for (const y of [36, 42, 48]) { const p = U(12, y); b.hline(p[0], p[0] + 15, p[1], C.night); b.hline(p[0], p[0] + 15, p[1] + 1, C.indigo); }

  // ---------------------------------------------------------------- hull (iron frame)
  const deck: Pt[] = P([[22, 44], [72, 40], [80, 46], [26, 50]]);
  const flank: Pt[] = P([[18, 50], [80, 46], [84, 60], [80, 74], [20, 76], [16, 62]]);
  part(b, IRON, (x) => x.poly(flank, 1));
  part(b, IRON_L, (x) => x.poly(deck, 1), { innerLine: false });
  // rivets along the flank edge
  for (let i = 0; i < 9; i++) { const p = U(22 + i * 7, 73 - (i % 2)); b.set(p[0], p[1], C.fog); }
  wear(b, 3, 18, 50, 66, 26, [C.indigo, C.slate], C.navy);

  // ---------------------------------------------------------------- chest: plates (P1) or exposed engine (P2)
  const chest: Pt[] = P([[26, 50], [66, 46], [72, 54], [68, 68], [30, 70], [24, 60]]);
  const glacis: Pt[] = P([[72, 46], [80, 46], [86, 58], [82, 72], [70, 70], [74, 56]]);
  if (!stripped) {
    part(b, ARMOR, (x) => x.poly(chest, 1));
    part(b, ARMOR_D, (x) => x.poly(glacis, 1));
    hazard(b, P([[24, 63], [70, 61], [69, 66], [26, 68]]));
    hazard(b, P([[72, 64], [84, 64], [82, 70], [71, 69]]));
    // seams, rivets, gang tag
    const s0 = U(47, 47), s1 = U(48, 60);
    b.line(s0[0], s0[1], s1[0], s1[1], C.rust);
    for (const [x, y] of [[29, 53], [42, 51], [54, 50], [64, 50], [30, 60], [66, 59], [76, 52], [80, 60]] as Pt[]) { const p = U(x, y); b.set(p[0], p[1], C.amber); }
    wear(b, 9, 26, 47, 46, 14, [C.orange, C.sodium], C.rust);
    for (let i = 0; i < 3; i++) { const p = U(55 + i * 3, 52); b.line(p[0], p[1], p[0] + 2, p[1] + 5, C.magenta); }
  } else {
    part(b, mat(RAMP.cool, 1), (x) => x.poly(chest, 1));
    part(b, IRON_D, (x) => x.poly(glacis, 1));
    // pistons either side of the core
    for (const px of [30, 61]) part(b, CHROME, (x) => { const p = U(px, 50); x.rect(p[0], p[1], 4, 16, 1); });
    // engine core: concentric glow with a grille
    const core = U(45, 50);
    part(b, ARMOR_D, (x) => x.circle(core[0] + 0.5, core[1] + 6.5, 11, 1));
    b.circle(core[0] + 0.5, core[1] + 6.5, 9, C.orange);
    b.circle(core[0] + 0.5, core[1] + 6.5, 7, C.sodium);
    b.circle(core[0] + 0.5, core[1] + 6.5, 4.5, C.amber);
    b.circle(core[0] + 0.5, core[1] + 6.5, 2, C.white);
    for (let y = core[1] - 4; y <= core[1] + 16; y += 3) b.hline(core[0] - 10, core[0] + 10, y, C.ink);
    b.vline(core[0], core[1] - 4, core[1] + 17, C.ink);
    // torn plate stubs
    part(b, ARMOR, (x) => x.poly(P([[24, 50], [34, 48], [31, 55], [23, 58]]), 1));
    part(b, ARMOR, (x) => x.poly(P([[66, 46], [76, 46], [73, 53], [64, 52]]), 1));
    part(b, ARMOR_D, (x) => x.poly(P([[78, 62], [85, 60], [83, 70], [78, 68]]), 1));
  }

  // ---------------------------------------------------------------- near tread (front, fixed to the ground)
  part(b, IRON_D, (x) => x.poly([[14, 74], [80, 72], [88, 80], [84, 90], [16, 92], [8, 84]], 1));
  part(b, IRON_L, (x) => x.poly([[14, 74], [80, 72], [84, 76], [12, 78]], 1), { innerLine: false });
  for (let x = 16; x <= 80; x += 4) { b.set(x, 75, C.indigo); b.set(x + 1, 76, C.indigo); }
  for (let i = 0; i < 6; i++) {
    const cx = 20 + i * 12, cy = 84;
    part(b, IRON_L, (x) => x.circle(cx + 0.5, cy + 0.5, 4, 1));
    b.circle(cx + 0.5, cy + 0.5, 1.6, C.night);
    b.set(cx, cy, C.slate);
  }
  for (let x = 12; x <= 84; x += 3) b.set(x, 91, C.slate);
  // hazard stripe on the tread guard front
  hazard(b, [[80, 73], [86, 78], [84, 82], [79, 79]]);

  // ---------------------------------------------------------------- pilot torso, arms on the levers, harness
  // control levers on the deck
  for (const [lx, ly] of [[26, 38], [72, 36]] as const) {
    const p = U(lx, ly);
    b.line(p[0], p[1], p[0], p[1] + 8, C.slate);
    part(b, mat(RAMP.red, 2), (x) => x.circle(p[0] + 0.5, p[1] - 0.5, 2.2, 1));
  }
  const torso: Pt[] = P([[30, 36], [36, 28], [42, 26], [54, 26], [60, 28], [66, 36], [63, 46], [33, 47]]);
  part(b, SKIN, (x) => x.poly(torso, 1));
  // arms reaching down to the levers (far arm first)
  part(b, SKIN, (x) => { const a = U(33, 32), c = U(27, 38); x.capsule(a[0], a[1], c[0], c[1], 3.4, 1); x.circle(c[0] + 0.5, c[1] + 0.5, 3, 1); });
  part(b, SKIN, (x) => { const a = U(63, 31), c = U(71, 36); x.capsule(a[0], a[1], c[0], c[1], 3.6, 1); x.circle(c[0] + 0.5, c[1] + 0.5, 3.2, 1); });
  // deltoids
  part(b, SKIN, (x) => { const a = U(35, 31), c = U(61, 30); x.circle(a[0] + 0.5, a[1] + 0.5, 4.5, 1); x.circle(c[0] + 0.5, c[1] + 0.5, 4.8, 1); });
  // pec split, lit shoulder
  { const a = U(48, 31), c = U(48, 40); b.line(a[0], a[1], c[0], c[1], C.skinD); }
  { const a = U(38, 38), c = U(47, 41); b.line(a[0], a[1], c[0], c[1], C.skinD); const d = U(49, 41), e = U(58, 38); b.line(d[0], d[1], e[0], e[1], C.skinD); }
  { const a = U(59, 27), c = U(63, 28); b.line(a[0], a[1], c[0], c[1], C.skinL); }
  // X harness with a steel ring
  part(b, LEATHER, (x) => { const a = U(37, 28), c = U(58, 45), d = U(59, 28), e = U(38, 45); x.capsule(a[0], a[1], c[0], c[1], 1.3, 1); x.capsule(d[0], d[1], e[0], e[1], 1.3, 1); });
  part(b, CHROME, (x) => { const r = U(48, 36); x.circle(r[0] + 0.5, r[1] + 0.5, 2.2, 1); });
  // collar ring where flesh meets machine
  part(b, IRON_L, (x) => x.poly(P([[30, 43], [66, 41], [67, 47], [30, 49]]), 1));
  for (let i = 0; i < 7; i++) { const p = U(32 + i * 5, 46 - Math.floor(i / 4)); b.set(p[0], p[1], C.ink); }

  // ---------------------------------------------------------------- crane: hub, ram, boom, cable, hook
  const hub = U(70, 44);
  const tip: Pt = f === 'attack' ? [91, 10] : f === 'hurt' ? U(83, 18) : U(88, 14);
  const hookTop: Pt = f === 'attack' ? [93, 32] : f === 'hurt' ? [tip[0] - 3, tip[1] + 25] : [87, 41 + bob];
  // hydraulic ram from the hull to the boom
  const r0 = U(64, 58), r1: Pt = [hub[0] + (tip[0] - hub[0]) * 0.32, hub[1] + (tip[1] - hub[1]) * 0.32];
  part(b, CHROME, (x) => x.capsule(r0[0], r0[1], r1[0], r1[1], 1.6, 1));
  boom(b, hub, tip);
  b.line(tip[0], tip[1] + 2, hookTop[0], hookTop[1] - 2, C.slate);
  hook(b, hookTop, f === 'attack' ? -3 : f === 'hurt' ? 2 : 0);
  part(b, stripped ? IRON_L : ARMOR, (x) => x.circle(hub[0] + 0.5, hub[1] + 0.5, 6.5, 1));
  part(b, IRON_L, (x) => x.circle(hub[0] + 0.5, hub[1] + 0.5, 2.5, 1));

  // ---------------------------------------------------------------- pilot head (3/4 facing right)
  const [hx, hy] = U(48, 14 + (f === 'hurt' ? 1 : 0));
  // thick neck into the traps
  part(b, SKIN, (x) => x.poly([[hx - 8, hy + 6], [hx + 8, hy + 6], [hx + 11, hy + 13], [hx - 11, hy + 13]], 1));
  part(b, SKIN, (x) => { x.ellipse(hx, hy, 10, 10, 1); x.rect(hx - 9, hy + 2, 19, 7, 1); });
  // ear on the back of the head
  part(b, SKIN, (x) => x.ellipse(hx - 6, hy + 3, 1.8, 2.6, 1));
  b.set(hx - 6, hy + 3, C.skinX);
  // goggle strap + lenses (near lens bigger, far lens at the front edge)
  b.line(hx - 9, hy - 1, hx + 9, hy - 2, C.ink);
  b.line(hx - 9, hy, hx + 1, hy - 1, C.umber);
  const angry = stripped || f === 'attack';
  const lensC = f === 'hurt' ? C.orange : angry ? C.red : C.sodium;
  const lensL = f === 'hurt' ? C.sodium : angry ? C.rose : C.amber;
  for (const [lx, lr] of [[hx + 2, 2.8], [hx + 7.5, 2.2]] as const) {
    b.circle(lx, hy, lr + 1, C.slate);
    b.circle(lx, hy, lr, lensC);
    b.circle(lx - 0.6, hy - 0.6, lr - 1, lensL);
    b.set(Math.round(lx - 1), Math.round(hy - 1), C.white);
  }
  // heavy brow
  b.line(hx - 1, hy - 4, hx + 9, hy - 4, C.skinX);
  // geared steel jaw (drops open on attack / when stripped)
  const drop = f === 'attack' ? 2 : stripped ? 1 : 0;
  if (drop) { b.rect(hx - 4, hy + 5, 14, drop + 1, C.maroon); b.hline(hx - 3, hx + 9, hy + 5, C.ink); }
  part(b, IRON_L, (x) => x.poly([[hx - 6, hy + 5 + drop], [hx + 10, hy + 4 + drop], [hx + 10, hy + 9 + drop], [hx + 5, hy + 12 + drop], [hx - 4, hy + 12 + drop]], 1));
  for (let x = hx - 4; x <= hx + 9; x += 2) { b.set(x, hy + 5 + drop, C.white); b.set(x, hy + 6 + drop, C.pale); }
  b.hline(hx - 4, hx + 9, hy + 7 + drop, C.ink);
  b.circle(hx - 5, hy + 7 + drop, 1.8, C.fog); b.set(hx - 5, hy + 7 + drop, C.ink);
  if (drop) for (let x = hx - 3; x <= hx + 8; x += 2) b.set(x, hy + 4, C.pale);
  // mohawk ridge sweeping back
  part(b, MOHAWK, (x) => {
    for (const [px, py, dx, dy] of [[hx + 4, hy - 8, 3, -7], [hx, hy - 9, 1, -8], [hx - 4, hy - 8, -2, -7], [hx - 7, hy - 5, -6, -5]] as const) {
      x.poly([[px - 2.5, py + 2], [px + 2.5, py + 2], [px + dx, py + dy]], 1);
    }
    x.capsule(hx - 7, hy - 5, hx + 4, hy - 8, 2, 1);
  });

  b.outline(C.ink);

  // ---------------------------------------------------------------- post-outline effects (not outlined)
  // exhaust puffs above the stacks
  const flick = f === 'idle2' ? 1 : 0;
  for (const [sx, top] of [[12, 3], [21, 6]] as const) {
    const p = U(sx + 2, top);
    b.setIfEmpty(p[0], p[1] - 1, flick ? C.sodium : C.orange);
    b.setIfEmpty(p[0] + 1, p[1] - 2 - flick, C.amber);
    b.setIfEmpty(p[0] - 1, p[1] - 2 + flick, C.slate);
  }
  if (stripped) {
    // loose sparking cables from the open chest
    const c0 = U(33, 52), c1 = U(60, 52);
    b.line(c0[0], c0[1], c0[0] - 5, c0[1] + 10, C.magenta);
    b.line(c1[0], c1[1], c1[0] + 5, c1[1] + 11, C.cyan);
    const sp = f === 'idle2' ? 1 : 0;
    b.setIfEmpty(c0[0] - 6, c0[1] + 11 + sp, C.white); b.setIfEmpty(c0[0] - 7, c0[1] + 10 - sp, C.ice);
    b.set(c1[0] + 6, c1[1] + 12 - sp, C.white); b.set(c1[0] + 7, c1[1] + 11 + sp, C.amber);
  }
  if (f === 'attack') {
    // swing motion lines behind the hook
    for (let i = 0; i < 4; i++) { b.setIfEmpty(88 - i * 3, 46 + i, C.pale); b.setIfEmpty(89 - i * 3, 50 + i, C.fog); }
  }
  if (f === 'hurt') {
    for (let i = 0; i < 12; i++) {
      const a = hash2(i, 77) * Math.PI * 2, r = 8 + hash2(i, 78) * 12;
      const x = Math.round(48 + Math.cos(a) * r), y = Math.round(42 + Math.sin(a) * r * 0.8);
      b.setIfEmpty(x, y, i % 2 ? C.amber : C.white);
      b.setIfEmpty(x + 1, y, i % 2 ? C.sodium : C.ice);
    }
  }
  return b;
}

export function buildGearjawTopFrames(): { id: string; frames: { name: string; buf: PixBuf }[] }[] {
  return [
    { id: 'gearjaw', frames: BATTLE_FRAMES.map((f) => ({ name: f, buf: drawGearjaw(f, false) })) },
    { id: 'gearjaw_stripped', frames: BATTLE_FRAMES.map((f) => ({ name: f, buf: drawGearjaw(f, true) })) },
  ];
}
