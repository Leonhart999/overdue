/**
 * Octohydra + downnet server farm art (palette indices only, drawn in code).
 *   octo_heads     32x32  {spitter,beamer,biter}_{idle,attack,hurt}  (facing right, centre = hurt circle)
 *   octo_parts     24x24  neck, neck_glow, stump, stump_burnt           (origin bottom centre)
 *   octo_core      56x72  shielded, exposed, risen                      (origin bottom centre)
 *   farm_props     32x48  rack, rack_dented, rack_wrecked, conduit, conduit_off
 *   octo_portrait  64x64  portrait
 *   bg_serverfarm  640x360 floor + walls (water layout from FARM in arenas/serverfarm.ts)
 */
import { FARM } from '../game/arenas/serverfarm';
import { C, RAMP } from './palette';
import { PixBuf, type Pt } from './core/pixbuf';
import { bayer, hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { mat, part } from './actors/rig';

type HeadType = 'spitter' | 'beamer' | 'biter';
type Anim = 'idle' | 'attack' | 'hurt';

function frame(w: number, h: number, draw: (b: PixBuf) => void): PixBuf {
  const b = new PixBuf(w, h);
  draw(b);
  return b;
}

// ------------------------------------------------------------------ heads (32x32)
function spitter(a: Anim): PixBuf {
  return frame(32, 32, (b) => {
    const dy = a === 'hurt' ? 2 : 0;
    const swell = a === 'attack' ? 1.5 : 0;
    // back frill spikes
    part(b, mat(RAMP.green, 1), (x) => {
      for (const [sx, sy] of [[7, 9], [10, 6], [14, 5]] as Pt[]) x.poly([[sx - 2, sy + 6 + dy], [sx, sy + dy], [sx + 3, sy + 6 + dy]], 1);
    });
    // throat sacs
    part(b, mat(RAMP.green, 3), (x) => {
      x.ellipse(13, 23 + dy, 4.5 + swell, 3.5 + swell * 0.6, 1);
      x.ellipse(19, 23.5 + dy, 3.5 + swell, 3 + swell * 0.6, 1);
    });
    // bulbous skull + snout
    part(b, mat(RAMP.green, 2), (x) => {
      x.ellipse(14, 15 + dy, 9, 8, 1);
      x.ellipse(22, 17 + dy, 5.5, 4.5, 1);
    }, { rim: C.acid });
    // spots
    for (const [sx, sy] of [[10, 12], [13, 10], [16, 13], [9, 16]] as Pt[]) b.set(sx, sy + dy, C.moss);
    // eye
    if (a === 'hurt') {
      b.set(17, 11 + dy, C.ink); b.set(19, 13 + dy, C.ink); b.set(19, 11 + dy, C.ink); b.set(17, 13 + dy, C.ink); b.set(18, 12 + dy, C.ink);
    } else {
      b.ellipse(18, 12 + dy, 2.2, 2, C.amber);
      b.set(19, 12 + dy, C.ink);
      b.set(17, 11 + dy, C.white);
    }
    // mouth
    if (a === 'attack') {
      b.ellipse(26, 17, 3.2, 3.2, C.ink);
      b.ellipse(26, 17, 2, 2, C.moss);
      b.set(26, 17, C.acid); b.set(25, 20, C.acid); b.set(25, 21, C.acid); b.set(27, 21, C.lime);
    } else {
      b.hline(24, 27, 18 + dy, C.moss);
      b.set(27, 17 + dy, C.ink);
    }
    b.outline(C.ink);
  });
}

function beamer(a: Anim): PixBuf {
  return frame(32, 32, (b) => {
    const dy = a === 'hurt' ? 2 : 0;
    const gap = a === 'attack' ? 2 : 0;
    // dorsal fin
    part(b, mat(RAMP.chrome, 1), (x) => x.poly([[8, 10 + dy], [12, 3 + dy], [16, 9 + dy]], 1));
    // lower jaw plate
    part(b, mat(RAMP.cool, 4), (x) => x.poly([[7, 19 + dy + gap], [26, 19 + dy + gap], [24, 24 + dy + gap], [9, 24 + dy + gap]], 1));
    // hammer skull
    part(b, mat(RAMP.chrome, 2), (x) => x.poly([[4, 13 + dy], [11, 8 + dy], [25, 8 + dy], [29, 13 + dy], [28, 19 + dy], [6, 19 + dy]], 1), { rim: C.fog });
    // panel lines + vents
    b.line(11, 9 + dy, 9, 18 + dy, C.slate);
    for (let i = 0; i < 3; i++) b.hline(13, 17, 15 + i * 1 + dy, a === 'attack' ? C.rose : C.slate);
    // lens
    const lx = 24, ly = 13 + dy;
    b.circle(lx, ly, 4, C.ink);
    if (a === 'hurt') { b.circle(lx, ly, 3, C.maroon); b.line(lx - 2, ly - 2, lx + 2, ly + 2, C.ink); }
    else if (a === 'attack') { b.circle(lx, ly, 3.4, C.rose); b.circle(lx, ly, 2, C.white); }
    else { b.circle(lx, ly, 3, C.maroon); b.circle(lx, ly, 2, C.red); b.set(lx - 1, ly - 1, C.rose); }
    b.outline(C.ink);
  });
}

function biter(a: Anim): PixBuf {
  return frame(32, 32, (b) => {
    const dy = a === 'hurt' ? 2 : 0;
    const open = a === 'attack' ? 4 : 0;
    // lower jaw
    part(b, mat(RAMP.purple, 2), (x) => x.poly([[5, 18 + dy], [12, 18 + dy], [30, 19 + dy + open], [28, 22 + dy + open], [8, 23 + dy]], 1));
    // mouth interior when open
    if (open) part(b, mat(RAMP.red, 1), (x) => x.poly([[12, 17], [29, 13], [29, 18 + open], [12, 19]], 1));
    // upper jaw / skull
    part(b, mat(RAMP.purple, 3), (x) => {
      x.ellipse(11, 14 + dy, 7, 6, 1);
      x.poly([[10, 9 + dy], [30, 14 + dy - open], [30, 17 + dy - open], [10, 19 + dy]], 1);
    }, { rim: C.rose });
    // brow ridge spikes
    part(b, mat(RAMP.purple, 1), (x) => {
      x.poly([[6, 10 + dy], [8, 5 + dy], [11, 9 + dy]], 1);
      x.poly([[11, 9 + dy], [14, 5 + dy], [16, 10 + dy]], 1);
    });
    // teeth
    for (let tx = 15; tx <= 28; tx += 3) {
      const t = (tx - 10) / 20;
      const uy = Math.round(16 + dy - open * t + 1 * t);
      b.set(tx, uy + 1, C.white); b.set(tx, uy + 2, C.pale);
      const ly = Math.round(18 + dy + open * t);
      b.set(tx + 1, ly, C.white); b.set(tx + 1, ly - 1, C.pale);
    }
    // eye
    if (a === 'hurt') { b.set(12, 11 + dy, C.ink); b.set(14, 13 + dy, C.ink); b.set(14, 11 + dy, C.ink); b.set(12, 13 + dy, C.ink); b.set(13, 12 + dy, C.ink); }
    else { b.ellipse(13, 12 + dy, 1.8, 1.5, a === 'attack' ? C.amber : C.sodium); b.set(14, 12 + dy, C.ink); }
    b.outline(C.ink);
  });
}

function headFrames(): { name: string; buf: PixBuf }[] {
  const out: { name: string; buf: PixBuf }[] = [];
  const draw: Record<HeadType, (a: Anim) => PixBuf> = { spitter, beamer, biter };
  for (const t of ['spitter', 'beamer', 'biter'] as HeadType[]) {
    for (const a of ['idle', 'attack', 'hurt'] as Anim[]) out.push({ name: `${t}_${a}`, buf: draw[t](a) });
  }
  return out;
}

// ------------------------------------------------------------------ neck / stumps (24x24)
function neck(glow: boolean): PixBuf {
  return frame(24, 24, (b) => {
    part(b, mat(RAMP.teal, 2), (x) => x.ellipse(12, 19, 4.5, 4, 1), { rim: C.cyan });
    b.hline(9, 15, 20, C.abyss);
    if (glow) { b.set(12, 18, C.acid); b.set(11, 18, C.lime); b.set(13, 18, C.lime); }
    else b.set(11, 17, C.ice);
    b.outline(C.ink);
  });
}

function stump(burnt: boolean): PixBuf {
  return frame(24, 24, (b) => {
    part(b, mat(burnt ? RAMP.cool : RAMP.teal, burnt ? 2 : 2), (x) => x.rect(7, 12, 10, 10, 1), { rim: burnt ? C.slate : C.cyan });
    // cut face
    b.ellipse(12, 12, 5.5, 2.5, burnt ? C.ink : C.maroon);
    b.ellipse(12, 12, 3.5, 1.5, burnt ? C.umber : C.red);
    if (!burnt) {
      // severed cables
      b.line(10, 11, 8, 6, C.slate); b.set(8, 5, C.acid);
      b.line(14, 11, 16, 7, C.slate); b.set(16, 6, C.ice);
      b.line(12, 11, 12, 8, C.steel); b.set(12, 7, C.amber);
    } else {
      for (let i = 0; i < 6; i++) b.set(8 + Math.floor(hash2(i, 3, 41) * 8), 14 + Math.floor(hash2(i, 5, 41) * 7), C.ink);
      b.set(10, 12, C.orange); b.set(14, 12, C.rust);
    }
    b.hline(6, 17, 22, burnt ? C.night : C.abyss);
    b.outline(C.ink);
  });
}

// ------------------------------------------------------------------ core (56x72)
function core(kind: 'shielded' | 'exposed' | 'risen'): PixBuf {
  return frame(56, 72, (b) => {
    const bottom = kind === 'risen' ? 58 : 68;
    const top = bottom - 56;
    if (kind === 'risen') {
      // dangling cable tentacles
      for (const [x0, sw] of [[17, -3], [23, 2], [33, -2], [39, 3]] as Pt[]) {
        part(b, mat(RAMP.teal, 1), (x) => {
          for (let y = bottom - 2; y < 71; y++) {
            const t = (y - bottom) / 13;
            x.capsule(x0 + sw * t, y, x0 + sw * t, y, 1.3, 1);
          }
        });
      }
    }
    // monolith: bevelled slab, slightly narrower at the top
    part(b, mat(RAMP.cool, 2), (x) => x.poly([[14, bottom], [42, bottom], [40, top + 6], [34, top], [22, top], [16, top + 6]], 1), { rim: C.slate });
    // front face plate
    part(b, mat(RAMP.cool, 1), (x) => x.poly([[19, bottom - 3], [37, bottom - 3], [36, top + 8], [20, top + 8]], 1));
    // data lines
    for (let x = 21; x <= 35; x += 2) {
      for (let y = top + 10; y < bottom - 4; y++) {
        const h = hash2(x, y >> 1, 77);
        if (h < 0.22) b.set(x, y, h < 0.07 ? C.acid : C.moss);
      }
    }
    // eye
    const ey = top + 22;
    const eyeR = kind === 'shielded' ? 4 : 5.5;
    b.circle(28, ey, eyeR + 1.5, C.ink);
    b.circle(28, ey, eyeR, C.moss);
    b.circle(28, ey, eyeR - 1.5, C.lime);
    b.circle(28, ey, eyeR - 3, C.acid);
    b.set(27, ey - 1, C.white);
    // cracks once exposed
    if (kind !== 'shielded') {
      b.line(22, top + 12, 25, top + 18, C.acid); b.line(25, top + 18, 23, top + 26, C.lime);
      b.line(34, top + 30, 31, top + 38, C.acid); b.line(31, top + 38, 34, top + 44, C.lime);
    }
    // top antennae / ports
    b.rect(25, top - 3, 2, 3, C.slate); b.rect(30, top - 4, 2, 4, C.slate); b.set(31, top - 5, C.acid); b.set(25, top - 4, C.ice);
    b.outline(C.ink);
    if (kind === 'shielded') {
      // hex shield lattice around the slab (not outlined: reads as energy)
      for (let y = top - 4; y < bottom + 1; y++) {
        for (let x = 6; x < 50; x++) {
          const dx = (x - 28) / 22, dy2 = (y - (top + bottom) / 2) / 36;
          const d = dx * dx + dy2 * dy2;
          if (d > 1) continue;
          const hx = (x + (Math.floor(y / 6) % 2) * 3) % 6, hy = y % 6;
          const edge = d > 0.86 || (hy === 0 && hx < 4) || (hx === 0 && hy > 0);
          if (edge && b.get(x, y) === 0 && bayer(x, y) < (d > 0.86 ? 12 : 5)) b.set(x, y, d > 0.86 ? C.acid : C.lime);
        }
      }
    }
  });
}

// ------------------------------------------------------------------ props (32x48)
function rack(state: 'ok' | 'dented' | 'wrecked'): PixBuf {
  return frame(32, 48, (b) => {
    if (state === 'wrecked') {
      // tipped over, half sunk
      part(b, mat(RAMP.cool, 3), (x) => x.poly([[2, 40], [28, 36], [30, 44], [4, 47]], 1));
      part(b, mat(RAMP.cool, 2), (x) => x.poly([[2, 40], [28, 36], [27, 33], [3, 37]], 1));
      for (let i = 0; i < 6; i++) b.set(6 + i * 4, 41 - Math.floor(i * 0.6), i % 2 ? C.red : C.ink);
      b.line(16, 36, 14, 30, C.slate); b.set(14, 29, C.acid);
      b.hline(0, 31, 47, C.abyss);
      b.outline(C.ink);
      return;
    }
    // top face
    part(b, mat(RAMP.cool, 5), (x) => x.poly([[6, 8], [26, 8], [27, 12], [5, 12]], 1));
    // front face
    part(b, mat(RAMP.cool, 3), (x) => x.rect(5, 12, 22, 34, 1), { rim: C.steel });
    // blades
    for (let i = 0; i < 7; i++) {
      const y = 14 + i * 4;
      b.hline(7, 24, y, C.navy);
      b.hline(7, 24, y + 1, C.slate);
      const led = hash2(i, state === 'dented' ? 9 : 4, 13);
      b.set(22, y + 2, state === 'dented' && led < 0.5 ? C.red : led < 0.6 ? C.acid : C.cyan);
      b.set(20, y + 2, led < 0.3 ? C.lime : C.navy);
    }
    // door handle + vent
    b.vline(9, 20, 30, C.fog);
    b.hline(5, 26, 46, C.ink);
    if (state === 'dented') {
      b.line(12, 18, 17, 26, C.ink); b.line(17, 26, 14, 33, C.ink);
      b.set(15, 24, C.acid); b.set(24, 15, C.amber);
    }
    b.outline(C.ink);
  });
}

function conduit(ready: boolean): PixBuf {
  return frame(32, 48, (b) => {
    // cables into the wall (left side when facing right)
    part(b, mat(RAMP.cool, 2), (x) => {
      x.capsule(0, 30, 8, 30, 1.6, 1);
      x.capsule(0, 36, 8, 36, 1.6, 1);
      x.capsule(0, 24, 8, 27, 1.3, 1);
    });
    // cabinet
    part(b, mat(RAMP.cool, 4), (x) => x.rect(8, 20, 18, 25, 1), { rim: C.fog });
    part(b, mat(RAMP.cool, 6), (x) => x.poly([[9, 17], [25, 17], [26, 20], [8, 20]], 1));
    // hazard stripe
    for (let y = 38; y < 42; y++) for (let x = 9; x < 25; x++) b.set(x, y, ((x + y) >> 1) % 2 ? C.amber : C.ink);
    // lightning plate
    b.rect(12, 23, 8, 8, C.navy);
    b.line(17, 24, 14, 27, ready ? C.amber : C.slate); b.line(14, 27, 17, 27, ready ? C.amber : C.slate); b.line(17, 27, 14, 30, ready ? C.amber : C.slate);
    // breaker lever
    b.rect(21, 24, 3, 9, C.slate);
    if (ready) { b.rect(22, 19, 1, 6, C.fog); b.rect(21, 18, 3, 2, C.red); }
    else { b.rect(22, 31, 1, 6, C.fog); b.rect(21, 36, 3, 2, C.red); }
    // status lamp
    b.circle(12, 34, 1.6, ready ? C.acid : C.red);
    b.hline(8, 25, 45, C.ink);
    b.outline(C.ink);
  });
}

// ------------------------------------------------------------------ portrait (64x64)
function portrait(): PixBuf {
  return frame(64, 64, (b) => {
    // necks from the bottom edge
    part(b, mat(RAMP.teal, 2), (x) => {
      const neckTo = (x0: number, x1: number, y1: number) => {
        for (let t = 0; t <= 1; t += 0.03) {
          const xx = x0 + (x1 - x0) * t + Math.sin(t * 3) * 3, yy = 64 - (64 - y1) * t;
          x.capsule(xx, yy, xx, yy, 4 - t * 1.2, 1);
        }
      };
      neckTo(14, 14, 26);
      neckTo(50, 46, 20);
      neckTo(32, 30, 44);
    }, { rim: C.cyan });
    for (let i = 0; i < 12; i++) b.set(12 + Math.floor(hash2(i, 1, 5) * 40), 40 + Math.floor(hash2(i, 2, 5) * 22), C.acid);
    b.blit(spitter('attack'), -2, 6);
    b.blit(beamer('idle').flipX(), 32, 2);
    b.blit(biter('attack'), 14, 30);
  });
}

// ------------------------------------------------------------------ background (640x360)
function serverfarm(): PixBuf {
  const W = 640, H = 360;
  const b = new PixBuf(W, H);
  const B = FARM.bounds;
  const inBounds = (x: number, y: number) => x >= B.x && x < B.x + B.w && y >= B.y && y < B.y + B.h;
  const dryAt = (x: number, y: number) => FARM.dry.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

  // ---- water
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inBounds(x, y)) continue;
    let c: number = C.abyss;
    const deep = Math.min(x - B.x, B.x + B.w - x, y - B.y) < 10;
    if (deep && bayer(x, y) < 8) c = C.night;
    const h = hash2(x >> 2, y, 3);
    if (h < 0.018 && (x & 3) !== 0) c = C.teal;
    else if (h < 0.022) c = C.moss;
    b.set(x, y, c);
  }
  // submerged cables: from the core to every spot and to the racks / conduits
  const cable = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
    const n = 40;
    let px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t + Math.sin(t * 6 + seed) * 6, y = y0 + (y1 - y0) * t + Math.cos(t * 5 + seed) * 4;
      b.line(px, py, x, y, C.night);
      b.line(px, py + 1, x, y + 1, C.night);
      if (i % 6 === 0) b.set(Math.round(x), Math.round(y), C.moss);
      px = x; py = y;
    }
  };
  const co = FARM.core;
  FARM.spots.forEach(([x, y], i) => cable(co.x, co.y, x, y, i * 1.7));
  FARM.conduits.forEach(([x, y], i) => cable(x, y, co.x + (i ? 20 : -20), co.y + 10, 5 + i));
  // core socket
  for (let y = co.y - 30; y < co.y + 30; y++) for (let x = co.x - 44; x < co.x + 44; x++) {
    const d = Math.hypot((x - co.x) / 40, (y - co.y) / 24);
    if (d < 1 && inBounds(x, y)) b.set(x, y, d > 0.9 ? (bayer(x, y) < 6 ? C.moss : C.night) : d > 0.6 && bayer(x, y) < 8 ? C.night : C.ink);
  }
  // emergence spots: dark whirls with a green rim
  for (const [sx, sy] of FARM.spots) {
    for (let y = sy - 10; y <= sy + 10; y++) for (let x = sx - 16; x <= sx + 16; x++) {
      const d = Math.hypot((x - sx) / 15, (y - sy) / 8);
      if (d > 1) continue;
      const a = Math.atan2(y - sy, x - sx) + d * 3;
      if (d > 0.85) { if (bayer(x, y) < 6) b.set(x, y, C.moss); }
      else if (Math.sin(a * 3) > 0.3) b.set(x, y, C.night);
      else if (d < 0.4) b.set(x, y, C.ink);
    }
  }
  // ripple highlights
  for (let i = 0; i < 260; i++) {
    const x = B.x + Math.floor(hash2(i, 1, 21) * B.w), y = B.y + Math.floor(hash2(i, 2, 21) * B.h);
    if (dryAt(x, y)) continue;
    const l = 2 + Math.floor(hash2(i, 3, 21) * 4);
    for (let k = 0; k < l; k++) if (!dryAt(x + k, y)) b.set(x + k, y, hash2(i, 4, 21) < 0.2 ? C.cyan : C.teal);
  }

  // ---- dry grating
  for (const r of FARM.dry) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      let c: number = C.slate;
      if ((x - r.x) % 4 === 0 || (y - r.y) % 4 === 0) c = C.steel;
      else if ((x - r.x) % 4 === 2 && (y - r.y) % 4 === 2) c = C.navy;
      if (y === r.y) c = C.pale;
      else if (y === r.y + 1) c = C.fog;
      if (x === r.x || x === r.x + r.w - 1) c = y === r.y ? C.pale : C.fog;
      if (y >= r.y + r.h - 3) c = y === r.y + r.h - 1 ? C.ink : C.indigo;
      b.set(x, y, c);
    }
    // shadow cast onto the water below the edge
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y + r.h; y < r.y + r.h + 3; y++) {
      if (!dryAt(x, y) && inBounds(x, y) && (y === r.y + r.h || bayer(x, y) < 8)) b.set(x, y, C.ink);
    }
    // foam on the other edges
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      for (const y of [r.y - 1]) if (!dryAt(x, y) && inBounds(x, y) && hash2(x, y, 8) < 0.5) b.set(x, y, C.teal);
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      for (const x of [r.x - 1, r.x + r.w]) if (!dryAt(x, y) && inBounds(x, y) && hash2(x, y, 9) < 0.5) b.set(x, y, C.teal);
    }
  }
  // hazard stripes on the conduit pads, amber edge dashes on the walkway
  for (const r of FARM.dry.slice(2, 4)) {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y + 2; y < r.y + 5; y++) b.set(x, y, ((x + y) >> 1) % 2 ? C.amber : C.ink);
  }
  const walk = FARM.dry[FARM.dry.length - 1];
  for (let x = walk.x + 4; x < walk.x + walk.w - 4; x++) if ((x >> 3) % 2 === 0) { b.set(x, walk.y + 3, C.amber); }

  // ---- walls
  // back wall: rows of servers
  for (let y = 0; y < B.y; y++) for (let x = 0; x < W; x++) {
    let c: number = y < 4 ? C.ink : C.night;
    if (y >= 6 && y < 34) {
      const col = Math.floor(x / 24), lx = x % 24;
      if (lx === 0 || lx === 23) c = C.ink;
      else if (lx === 1) c = C.slate;
      else {
        c = (y - 6) % 4 === 0 ? C.ink : C.navy;
        if ((y - 6) % 4 === 2 && lx > 16 && lx < 21 && (lx & 1)) {
          const h = hash2(col, y, 31);
          c = h < 0.45 ? C.acid : h < 0.6 ? C.cyan : h < 0.66 ? C.red : C.moss;
        }
      }
    }
    if (y >= 34 && y < 44) c = y === 34 ? C.steel : y < 38 ? C.slate : C.indigo; // wall face
    if (y >= 44) c = y < 46 ? C.ink : C.night; // shadow line onto the water
    b.set(x, y, c);
  }
  // pipes on the back wall
  for (let x = 0; x < W; x++) {
    b.set(x, 38, C.steel); b.set(x, 39, C.fog); b.set(x, 40, C.slate);
    if (x % 40 === 0) { b.set(x, 37, C.ink); b.set(x, 41, C.ink); b.set(x, 38, C.ink); }
  }
  // side walls
  for (let y = B.y - 4; y < H; y++) {
    for (let x = 0; x < B.x; x++) { const lx = x; b.set(x, y, lx === B.x - 1 ? C.ink : lx === B.x - 2 ? C.steel : lx < 3 ? C.ink : (y >> 3) % 6 === 0 ? C.slate : C.navy); }
    for (let x = B.x + B.w; x < W; x++) { const lx = x - B.x - B.w; b.set(x, y, lx === 0 ? C.ink : lx === 1 ? C.steel : lx > 12 ? C.ink : (y >> 3) % 6 === 0 ? C.slate : C.navy); }
  }
  for (const y of [120, 260]) for (let x = 4; x < 12; x++) { b.set(x, y, C.fog); b.set(x + B.x + B.w, y, C.fog); }
  // bottom wall
  for (let y = B.y + B.h; y < H; y++) for (let x = 0; x < W; x++) {
    const ly = y - B.y - B.h;
    b.set(x, y, ly === 0 ? C.steel : ly === 1 ? C.slate : ly < 6 ? C.navy : C.ink);
    if (ly === 3 && x % 32 < 2) b.set(x, y, C.fog);
  }
  return b;
}

export function buildOctohydraArt(): SheetSpec[] {
  return [
    { key: 'octo_heads', group: 'Octohydra', frameW: 32, frameH: 32, columns: 3, frames: headFrames() },
    {
      key: 'octo_parts', group: 'Octohydra', frameW: 24, frameH: 24, columns: 4, frames: [
        { name: 'neck', buf: neck(false) }, { name: 'neck_glow', buf: neck(true) },
        { name: 'stump', buf: stump(false) }, { name: 'stump_burnt', buf: stump(true) },
      ],
    },
    {
      key: 'octo_core', group: 'Octohydra', frameW: 56, frameH: 72, columns: 3, frames: [
        { name: 'shielded', buf: core('shielded') }, { name: 'exposed', buf: core('exposed') }, { name: 'risen', buf: core('risen') },
      ],
    },
    {
      key: 'farm_props', group: 'Octohydra', frameW: 32, frameH: 48, columns: 5, frames: [
        { name: 'rack', buf: rack('ok') }, { name: 'rack_dented', buf: rack('dented') }, { name: 'rack_wrecked', buf: rack('wrecked') },
        { name: 'conduit', buf: conduit(true) }, { name: 'conduit_off', buf: conduit(false) },
      ],
    },
    { key: 'octo_portrait', group: 'Octohydra', frameW: 64, frameH: 64, frames: [{ name: 'portrait', buf: portrait() }] },
    { key: 'bg_serverfarm', group: 'Arenas', frameW: 640, frameH: 360, frames: [{ name: 'bg', buf: serverfarm() }] },
  ];
}
