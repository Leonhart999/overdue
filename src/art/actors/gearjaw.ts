/**
 * GEARJAW boss (96x96, drawn facing right then mirrored): a gang boss fused into a scrap
 * crane-mech. Red mohawk, goggles, a geared steel jaw; crane boom with a hook as the main
 * weapon, a hydraulic claw behind, twin exhaust stacks.
 *   gearjaw           armoured phase (hazard plates over the chest)
 *   gearjaw_stripped  armour torn off: exposed glowing engine, loose cables, angrier pilot
 */
import { C, RAMP } from '../palette';
import { grid } from '../core/grid';
import { PixBuf, Pt } from '../core/pixbuf';
import { hash2 } from '../core/rng';
import { BATTLE_FRAMES, BattleFrame, mat, part } from './rig';

const S = 96;

const PILOT_HEAD = `
......RRR.......
....RRrrrR......
...RrrrrrrR.....
..zRrrrrrrRS....
.zSSRRRRRRSSS...
zSSSSSSSSSSSSS..
zSSSSSSSSSSSSS..
zSSSSSkkkkkkkS..
zSSSSSkYYYkSSSS.
zsSSSSkYyYkSSSSS
.zsSSSSkkkSSSSS.
.zsMMMMMMMMMMMM.
..MmwmwmwmwmwmM.
..MmmmmmmmmmmmM.
...MmGmmGmmGmM..
....M.M.M.M.M...`;

function headLegend(angry: boolean, hurt: boolean) {
  return {
    '.': 0, R: C.maroon, r: C.red, S: C.skinM, s: C.skinD, z: C.skinX, k: C.ink,
    Y: hurt ? C.orange : angry ? C.red : C.amber, y: hurt ? C.sodium : angry ? C.rose : C.white,
    M: C.slate, m: C.steel, w: C.pale, G: C.fog,
  };
}

function thickLine(b: PixBuf, a: Pt, c: Pt, r: number, col: number): void {
  b.capsule(a[0], a[1], c[0], c[1], r, col);
}

/** Crane boom: two chords with a zig-zag lattice between them. */
function boom(b: PixBuf, from: Pt, to: Pt): void {
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len; // normal
  const w = 3;
  const a1: Pt = [from[0] + nx * w, from[1] + ny * w], b1: Pt = [to[0] + nx * 1.5, to[1] + ny * 1.5];
  const a2: Pt = [from[0] - nx * w, from[1] - ny * w], b2: Pt = [to[0] - nx * 1.5, to[1] - ny * 1.5];
  part(b, mat(RAMP.rust, 4), (x) => {
    thickLine(x, a1, b1, 1.1, 1);
    thickLine(x, a2, b2, 1.1, 1);
    const n = Math.floor(len / 5);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const p0: Pt = i % 2 ? [a1[0] + (b1[0] - a1[0]) * t0, a1[1] + (b1[1] - a1[1]) * t0] : [a2[0] + (b2[0] - a2[0]) * t0, a2[1] + (b2[1] - a2[1]) * t0];
      const p1: Pt = i % 2 ? [a2[0] + (b2[0] - a2[0]) * t1, a2[1] + (b2[1] - a2[1]) * t1] : [a1[0] + (b1[0] - a1[0]) * t1, a1[1] + (b1[1] - a1[1]) * t1];
      x.line(p0[0], p0[1], p1[0], p1[1], 1);
    }
  }, { innerLine: false });
}

function hook(b: PixBuf, top: Pt, swing: number): void {
  const [hx, hy] = top;
  // block
  part(b, mat(RAMP.cool, 4), (x) => x.rect(hx - 3, hy, 7, 5, 1));
  b.hline(hx - 2, hx + 2, hy + 2, C.orange);
  // curved hook
  const cx = hx + swing, cy = hy + 11;
  part(b, mat(RAMP.chrome, 3), (x) => {
    for (let a = -Math.PI / 2; a <= Math.PI * 1.15; a += 0.05) {
      x.capsule(cx + Math.cos(a) * 4.5, cy + Math.sin(a) * 4.5, cx + Math.cos(a) * 4.5, cy + Math.sin(a) * 4.5, 1.4, 1);
    }
    x.capsule(hx, hy + 5, cx, cy - 4.5, 1.4, 1);
  });
  // barb tip
  b.set(Math.round(cx - 4), Math.round(cy - 3), C.white);
}

function grime(b: PixBuf, seed: number, x0: number, y0: number, w: number, h: number, density = 0.08): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (!b.get(x - 1, y) || !b.get(x + 1, y) || !b.get(x, y - 1) || !b.get(x, y + 1)) continue;
    const r = hash2(x, y, seed);
    if (r < density) b.set(x, y, C.rust);
    else if (r < density * 1.4) b.set(x, y, C.umber);
  }
}

function drawGearjaw(f: BattleFrame, stripped: boolean): PixBuf {
  const b = new PixBuf(S, S);
  const bob = f === 'idle2' ? 1 : 0;
  const ux = f === 'hurt' ? -3 : f === 'attack' ? 2 : 0;
  const uy = bob + (f === 'hurt' ? 1 : 0);
  const U = (x: number, y: number): Pt => [x + ux, y + uy];

  // --- back claw arm (far side)
  const bs = U(22, 50), be = U(9, 60), bc = U(12, 73);
  part(b, mat(RAMP.cool, 3), (x) => x.capsule(bs[0], bs[1], be[0], be[1], 3, 1));
  part(b, mat(RAMP.cool, 3), (x) => x.capsule(be[0], be[1], bc[0], bc[1], 2.4, 1));
  part(b, mat(RAMP.cool, 2), (x) => x.poly([[bc[0] - 5, bc[1]], [bc[0] + 5, bc[1]], [bc[0] + 6, bc[1] + 7], [bc[0] + 2, bc[1] + 4], [bc[0] - 2, bc[1] + 4], [bc[0] - 6, bc[1] + 7]], 1));

  // --- exhaust stacks (behind hull)
  part(b, mat(RAMP.cool, 3), (x) => { x.rect(17 + ux, 14 + uy, 5, 26, 1); x.rect(24 + ux, 18 + uy, 5, 22, 1); });
  b.hline(17 + ux, 21 + ux, 14 + uy, C.ink); b.hline(24 + ux, 28 + ux, 18 + uy, C.ink);

  // --- treads and lower chassis (do not move with the upper body)
  part(b, mat(RAMP.cool, 1), (x) => x.poly([[12, 79], [78, 79], [82, 85], [77, 91], [14, 91], [9, 85]], 1));
  for (let i = 0; i < 7; i++) part(b, mat(RAMP.cool, 4), (x) => x.circle(17.5 + i * 10, 85.5, 3.5, 1));
  for (let i = 0; i < 7; i++) b.set(17 + i * 10, 85, C.ink);
  for (let x = 12; x <= 78; x += 3) b.set(x, 79, C.slate);
  part(b, mat(RAMP.cool, 3), (x) => x.poly([[20, 64 + uy], [70, 62 + uy], [72, 79], [18, 79]], 1));
  for (let y = 72; y <= 77; y++) for (let x = 20; x <= 70; x++) if (((x + y) >> 2) % 2 === 0) b.setIfOpaque(x, y, C.ink); else b.setIfOpaque(x, y, C.sodium);
  b.hline(20, 70, 71, C.slate); b.hline(19, 71, 78, C.slate);

  // --- hull
  const hull: Pt[] = [U(16, 36), U(62, 30), U(76, 40), U(74, 66), U(18, 68), U(12, 52)];
  part(b, mat(RAMP.cool, 4), (x) => x.poly(hull, 1));
  grime(b, 4, 12, 30, 66, 40, 0.045);
  // rivets along the hull edge
  for (let i = 0; i < 8; i++) { const p = U(18 + i * 7, 63 - (i % 2)); b.set(p[0], p[1], C.fog); }

  // --- pilot torso emerging from the hull top
  const pt: Pt[] = [U(36, 22), U(52, 20), U(57, 28), U(56, 36), U(35, 37), U(33, 28)];
  part(b, mat(RAMP.skin, 2), (x) => x.poly(pt, 1));
  // harness straps + chest cables into the hull
  const s0 = U(38, 22), s1 = U(54, 35);
  b.line(s0[0], s0[1], s1[0], s1[1], C.ink);
  const s2 = U(52, 21), s3 = U(40, 35);
  b.line(s2[0], s2[1], s3[0], s3[1], C.night);
  for (const cx of [37, 42, 47]) { const c0 = U(cx, 33), c1 = U(cx - 3, 40); b.line(c0[0], c0[1], c1[0], c1[1], C.slate); }
  // collar ring where flesh meets machine
  part(b, mat(RAMP.cool, 5), (x) => x.poly([U(31, 34), U(59, 32), U(60, 37), U(31, 39)], 1));
  for (let i = 0; i < 6; i++) { const p = U(33 + i * 5, 36 - Math.floor(i / 3)); b.set(p[0], p[1], C.ink); }

  // --- chest: armour plates or exposed engine
  const chest: Pt[] = [U(28, 40), U(60, 37), U(68, 46), U(64, 61), U(30, 63), U(24, 51)];
  if (!stripped) {
    part(b, mat(RAMP.rust, 3), (x) => x.poly(chest, 1));
    // hazard band + plate seams + rivets
    // clean hazard band along the lower plate
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const lx = x - ux, ly = y - uy;
      if (ly < 55 || ly > 58) continue;
      const c = b.get(x, y);
      if (c !== C.orange && c !== C.sodium && c !== C.rust) continue;
      b.set(x, y, ((lx + ly) >> 1) % 2 === 0 ? C.ink : C.amber);
    }
    const sm0 = U(46, 39), sm1 = U(46, 62);
    b.line(sm0[0], sm0[1], sm1[0], sm1[1], C.rust);
    for (const [x, y] of [[31, 43], [42, 42], [50, 41], [61, 42], [31, 59], [44, 60], [58, 59]] as Pt[]) { const p = U(x, y); b.set(p[0], p[1], C.amber); }
    grime(b, 9, 24, 37, 46, 17, 0.035);
    // gang tag: three claw marks
    for (let i = 0; i < 3; i++) { const p = U(52 + i * 3, 44); b.line(p[0], p[1], p[0] + 2, p[1] + 5, C.magenta); }
  } else {
    part(b, mat(RAMP.cool, 1), (x) => x.poly(chest, 1));
    // pistons
    for (const px of [31, 60]) part(b, mat(RAMP.chrome, 3), (x) => { const p = U(px, 42); x.rect(p[0] - 1, p[1], 4, 17, 1); });
    // engine core: concentric glow with a grille
    const core = U(45, 50);
    part(b, mat(RAMP.rust, 2), (x) => x.circle(core[0] + 0.5, core[1] + 0.5, 9, 1));
    b.circle(core[0] + 0.5, core[1] + 0.5, 7, C.orange);
    b.circle(core[0] + 0.5, core[1] + 0.5, 5, C.sodium);
    b.circle(core[0] + 0.5, core[1] + 0.5, 3, C.amber);
    b.circle(core[0] + 0.5, core[1] + 0.5, 1.5, C.white);
    for (let y = core[1] - 8; y <= core[1] + 8; y += 3) b.hline(core[0] - 9, core[0] + 9, y, C.ink);
    b.vline(core[0], core[1] - 9, core[1] + 9, C.ink);
    // torn plate stubs
    part(b, mat(RAMP.rust, 3), (x) => x.poly([U(28, 40), U(36, 39), U(33, 45), U(27, 47)], 1));
    part(b, mat(RAMP.rust, 3), (x) => x.poly([U(60, 37), U(68, 46), U(63, 47), U(58, 42)], 1));
  }

  // --- crane shoulder hub + boom + cable + hook
  const hub = U(71, 43);
  const tip: Pt = f === 'attack' ? [93, 34] : f === 'hurt' ? U(82, 17) : U(87, 15);
  boom(b, hub, tip);
  const hookTop: Pt = f === 'attack' ? [91, 50] : f === 'hurt' ? [tip[0] - 4, tip[1] + 25] : [tip[0], tip[1] + 26];
  b.line(tip[0], tip[1], hookTop[0], hookTop[1], C.slate);
  hook(b, hookTop, f === 'attack' ? -3 : f === 'hurt' ? 2 : 0);
  part(b, stripped ? mat(RAMP.cool, 4) : mat(RAMP.rust, 3), (x) => x.circle(hub[0] + 0.5, hub[1] + 0.5, 6.5, 1));
  part(b, mat(RAMP.cool, 5), (x) => x.circle(hub[0] + 0.5, hub[1] + 0.5, 2.5, 1));
  // hydraulic ram from hull to boom
  const r0 = U(64, 56), r1: Pt = [hub[0] + (tip[0] - hub[0]) * 0.3, hub[1] + (tip[1] - hub[1]) * 0.3];
  part(b, mat(RAMP.chrome, 3), (x) => x.capsule(r0[0], r0[1], r1[0], r1[1], 1.5, 1));

  // --- pilot head
  const hp = U(40, 5 + (f === 'hurt' ? 1 : 0));
  b.blit(grid(PILOT_HEAD, headLegend(stripped || f === 'attack', f === 'hurt'), 'gearjaw/head'), hp[0] + (f === 'hurt' ? -1 : 0), hp[1]);
  if (f === 'attack') {
    // jaw opens: shift the gear jaw down by 2px
    b.shiftRegion(hp[0] + 2, hp[1] + 12, 13, 4, 0, 2);
    b.hline(hp[0] + 3, hp[0] + 13, hp[1] + 12, C.maroon);
    b.hline(hp[0] + 3, hp[0] + 13, hp[1] + 13, C.ink);
  }

  b.outline(C.ink);

  // --- post-outline glows
  const flame = f === 'idle2' ? 1 : 0;
  for (const [sx, sy] of [[19, 13], [26, 17]] as Pt[]) {
    const p = U(sx, sy);
    b.setIfEmpty(p[0], p[1] - 1, flame ? C.sodium : C.orange);
    b.setIfEmpty(p[0] + 1, p[1] - 2 - flame, C.amber);
    b.setIfEmpty(p[0] - 1, p[1] - 3 + flame, C.slate);
    b.setIfEmpty(p[0] + 1, p[1] - 5, C.slate);
  }
  if (stripped) {
    const core = U(45, 50);
    // glow spill on the dark cavity
    for (let y = core[1] - 12; y <= core[1] + 12; y++) for (let x = core[0] - 14; x <= core[0] + 14; x++) {
      const d = Math.hypot(x - core[0], y - core[1]);
      if (d > 9 && d < 13 && b.get(x, y) === C.night && ((x + y) & 1) === 0) b.set(x, y, C.rust);
    }
    // loose sparking cables
    const c0 = U(35, 43), c1 = U(52, 44);
    b.line(c0[0], c0[1], c0[0] - 6, c0[1] + 9, C.magenta);
    b.line(c1[0], c1[1], c1[0] + 6, c1[1] + 11, C.cyan);
    const sp = f === 'idle2' ? 1 : 0;
    b.setIfEmpty(c0[0] - 7, c0[1] + 10 + sp, C.white); b.setIfEmpty(c0[0] - 8, c0[1] + 9 - sp, C.ice);
    b.setIfEmpty(c1[0] + 7, c1[1] + 12 - sp, C.white); b.setIfEmpty(c1[0] + 8, c1[1] + 11 + sp, C.amber);
  }
  if (f === 'attack') {
    // swing motion lines behind the hook
    for (let i = 0; i < 4; i++) b.setIfEmpty(83 - i * 3, 58 + i, C.pale), b.setIfEmpty(84 - i * 3, 63 + i, C.fog);
  }
  if (f === 'hurt') {
    for (let i = 0; i < 10; i++) {
      const a = hash2(i, 77) * Math.PI * 2, r = 6 + hash2(i, 78) * 10;
      b.setIfEmpty(Math.round(50 + Math.cos(a) * r), Math.round(48 + Math.sin(a) * r), i % 2 ? C.amber : C.white);
    }
  }
  return b;
}

export function buildBossFrames(): { id: string; frames: { name: string; buf: PixBuf }[] }[] {
  return [
    { id: 'gearjaw', frames: BATTLE_FRAMES.map((f) => ({ name: f, buf: drawGearjaw(f, false) })) },
    { id: 'gearjaw_stripped', frames: BATTLE_FRAMES.map((f) => ({ name: f, buf: drawGearjaw(f, true) })) },
  ];
}
