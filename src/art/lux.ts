/**
 * Madame Lux + Neon Bazaar club art (palette indices only).
 *   lux           40x56  idle1, idle2, cast, kiss, hurt  (3/4 view facing right, origin bottom centre;
 *                        floating hologram idol: magenta bob, white sequin gown, cyan boa, no feet)
 *   lux_dev       32x48  breaker_on/off, projector_on/off, mirror_0..3 (ground point at row 38,
 *                        drawn at y + 10). Mirror k = plane at k * 45 deg (y foreshortened x0.5).
 *   lux_portrait  64x64  'lux'
 *   bg_club       640x360 club floor, dance floor glass, stage lip, walls with neon signs.
 */
import { C, RAMP } from './palette';
import { PixBuf, type Pt } from './core/pixbuf';
import { hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { mat, part } from './actors/rig';
import { FLOOR, MARKS, NEON } from '../game/arenas/club';
import { P } from '../engine/gfx';

// ------------------------------------------------------------------ Lux sprite
interface LuxPose { fh: Pt; fe: Pt; bh: Pt; be: Pt; dy: number; head: number; mood: 'normal' | 'kiss' | 'hurt' | 'cast' }

const POSES: Record<'idle1' | 'idle2' | 'cast' | 'kiss' | 'hurt', LuxPose> = {
  idle1: { fe: [27, 28], fh: [27, 34], be: [14, 28], bh: [14, 34], dy: 0, head: 0, mood: 'normal' },
  idle2: { fe: [27, 29], fh: [28, 34], be: [14, 29], bh: [13, 34], dy: 1, head: 0, mood: 'normal' },
  cast: { fe: [30, 19], fh: [34, 12], be: [13, 28], bh: [10, 31], dy: 0, head: 0, mood: 'cast' },
  kiss: { fe: [29, 25], fh: [27, 18], be: [14, 28], bh: [13, 34], dy: 0, head: 0, mood: 'kiss' },
  hurt: { fe: [30, 25], fh: [34, 22], be: [11, 25], bh: [7, 22], dy: 1, head: -1, mood: 'hurt' },
};

const WHITE = mat(RAMP.white, 3);
const HAIR = mat(RAMP.purple, 4);
const BODICE = mat(RAMP.purple, 3);
const BOA = mat(RAMP.teal, 3);
const SKIN = mat(RAMP.skin, 2);

function luxFrame(pp: LuxPose): PixBuf {
  const b = new PixBuf(40, 56);
  const dy = pp.dy, hx = pp.head;
  const shF: Pt = [24, 24 + dy], shB: Pt = [16, 24 + dy];
  // back arm (glove from the elbow)
  part(b, mat(RAMP.skin, 1), (x) => x.capsule(shB[0], shB[1], pp.be[0], pp.be[1], 1.3, 1), { innerLine: false });
  part(b, mat(RAMP.white, 2), (x) => x.capsule(pp.be[0], pp.be[1], pp.bh[0], pp.bh[1], 1.3, 1), { innerLine: false });
  // gown
  part(b, WHITE, (x) => x.poly([[16, 31 + dy], [25, 31 + dy], [29, 40], [32, 48], [27, 51], [20, 52], [13, 51], [8, 48], [11, 40]], 1));
  // sequins and a slit of rose lining
  for (let y = 33; y < 51; y++) for (let x = 8; x < 33; x++) {
    if (!b.get(x, y)) continue;
    const h = hash2(x, y, 77);
    if (h < 0.06) b.set(x, y, C.white);
    else if (h < 0.1) b.set(x, y, C.rose);
  }
  b.line(23, 38, 27, 50, C.rose);
  b.line(24, 38, 28, 50, C.magenta);
  // hem trim
  for (let x = 8; x <= 32; x++) for (let y = 47; y <= 52; y++) if (b.get(x, y) && !b.get(x, y + 1)) b.set(x, y, C.cyan);
  // bodice
  part(b, BODICE, (x) => x.poly([[16, 23 + dy], [25, 23 + dy], [24, 32 + dy], [17, 32 + dy]], 1));
  b.hline(17, 24, 31 + dy, C.amber);
  // neck + chest
  part(b, SKIN, (x) => { x.rect(19 + hx, 19 + dy, 3, 4, 1); x.ellipse(21 + hx, 23.5 + dy, 3.5, 1.6, 1); }, { innerLine: false });
  // hair behind
  part(b, HAIR, (x) => { x.ellipse(18.5 + hx, 11 + dy, 9, 8.5, 1); x.ellipse(14.5 + hx, 17 + dy, 5, 5, 1); x.ellipse(25 + hx, 17 + dy, 2.5, 4, 1); });
  // face
  part(b, SKIN, (x) => x.ellipse(22 + hx, 14 + dy, 4.3, 5.3, 1), { innerLine: false });
  // bangs: a heavy swoop over the forehead
  part(b, HAIR, (x) => x.poly([[12 + hx, 7 + dy], [18 + hx, 3 + dy], [25 + hx, 4 + dy], [28 + hx, 8 + dy], [27 + hx, 11 + dy], [23 + hx, 9 + dy], [19 + hx, 11 + dy], [16 + hx, 13 + dy]], 1));
  b.set(19 + hx, 5 + dy, C.rose); b.set(20 + hx, 5 + dy, C.rose); b.set(21 + hx, 4 + dy, C.white);
  // gold star clip
  b.set(14 + hx, 8 + dy, C.amber); b.set(13 + hx, 8 + dy, C.sodium); b.set(15 + hx, 8 + dy, C.sodium); b.set(14 + hx, 7 + dy, C.sodium); b.set(14 + hx, 9 + dy, C.sodium);
  // eye, lips
  const ex = 24 + hx, ey = 13 + dy;
  if (pp.mood === 'hurt') {
    b.set(ex - 1, ey - 1, C.ink); b.set(ex + 1, ey + 1, C.ink); b.set(ex, ey, C.ink); b.set(ex + 1, ey - 1, C.ink); b.set(ex - 1, ey + 1, C.ink);
  } else {
    b.hline(ex - 1, ex + 1, ey - 1, C.ink);
    b.set(ex, ey, C.cyan); b.set(ex + 1, ey, C.ice);
    if (pp.mood === 'cast') b.set(ex, ey + 1, C.cyan);
  }
  const ly = 17 + dy;
  if (pp.mood === 'kiss') { b.set(25 + hx, ly, C.red); b.set(26 + hx, ly, C.red); b.set(25 + hx, ly - 1, C.rose); }
  else if (pp.mood === 'hurt') { b.hline(23 + hx, 25 + hx, ly, C.maroon); }
  else { b.set(24 + hx, ly, C.red); b.set(25 + hx, ly, C.red); b.set(26 + hx, ly - 1, C.maroon); }
  // feather boa across the shoulders, ends dangling
  part(b, BOA, (x) => {
    for (let i = 0; i <= 8; i++) { const t = i / 8; x.circle(12 + t * 17, 23 + dy + Math.sin(t * Math.PI) * -1.5, 2.3, 1); }
    for (let i = 0; i < 5; i++) x.circle(12 - i * 0.3, 25 + dy + i * 2.4, 1.9 - i * 0.15, 1);
    for (let i = 0; i < 4; i++) x.circle(28 + i * 0.2, 25 + dy + i * 2.4, 1.8 - i * 0.15, 1);
  });
  for (let y = 19; y < 38; y++) for (let x = 8; x < 32; x++) if (b.get(x, y) === C.cyan && hash2(x, y, 5) < 0.18) b.set(x, y, C.ice);
  // front arm
  part(b, SKIN, (x) => x.capsule(shF[0], shF[1], pp.fe[0], pp.fe[1], 1.3, 1));
  part(b, WHITE, (x) => { x.capsule(pp.fe[0], pp.fe[1], pp.fh[0], pp.fh[1], 1.3, 1); x.circle(pp.fh[0] + 0.5, pp.fh[1] + 0.5, 1.7, 1); });
  if (pp.mood === 'cast') { b.set(pp.fh[0] + 1, pp.fh[1] - 2, C.amber); }
  b.outline(C.ink);
  // hologram fringe below the hem (not outlined)
  for (let y = 52; y < 56; y++) for (let x = 9; x < 32; x++) {
    const fade = (y - 51) / 5;
    if (hash2(x, y, 9) < 0.55 - fade * 0.4 && (x + y) % 2 === 0) b.set(x, y, hash2(x, y, 10) < 0.5 ? C.rose : C.ice);
  }
  // scanlines across the whole figure
  for (let y = 2; y < 52; y += 4) for (let x = 0; x < 40; x++) {
    const c = b.get(x, y);
    if (c === C.pale) b.set(x, y, C.white);
    else if (c === C.magenta) b.set(x, y, C.rose);
  }
  return b;
}

// ------------------------------------------------------------------ devices (32x48, ground row 38)
const G = 38;

function deviceFrame(draw: (b: PixBuf) => void, outline = true): PixBuf {
  const b = new PixBuf(32, 48);
  draw(b);
  if (outline) b.outline(C.ink);
  return b;
}

function breaker(on: boolean): PixBuf {
  return deviceFrame((b) => {
    // post + box
    b.rect(14, 28, 4, G - 28, C.slate);
    b.rect(15, 28, 1, G - 28, C.steel);
    b.rect(7, 10, 18, 20, C.slate);
    b.rect(8, 11, 16, 18, C.indigo);
    b.hline(8, 23, 11, C.steel);
    b.vline(8, 11, 28, C.steel);
    // hazard stripes
    for (let x = 7; x < 25; x++) for (let y = 26; y < 30; y++) b.set(x, y, ((x + y) >> 1) % 2 ? C.amber : C.ink);
    // lightning symbol
    b.line(15, 13, 12, 18, C.amber); b.line(12, 18, 17, 18, C.amber); b.line(17, 18, 13, 24, C.amber);
    // switch handle on the right side
    b.rect(24, 15, 3, 8, C.navy);
    const top = on ? 10 : 22;
    b.line(25, 19, 28, top, C.fog);
    b.circle(28, top, 1.8, on ? C.amber : C.red);
    // status lamp
    b.set(20, 14, on ? C.acid : C.red); b.set(21, 14, on ? C.acid : C.red);
    // foot plate
    b.rect(10, G - 1, 12, 2, C.navy);
  });
}

function projector(on: boolean): PixBuf {
  return deviceFrame((b) => {
    // tripod legs
    b.line(16, 26, 9, G, C.steel); b.line(16, 26, 23, G, C.steel); b.line(16, 26, 16, G, C.slate);
    // head housing
    part(b, mat(RAMP.cool, 4), (x) => x.rect(9, 13, 14, 12, 1));
    b.hline(9, 22, 13, C.fog);
    b.rect(13, 10, 6, 3, C.slate);
    // lens
    b.circle(16, 19, 4, C.ink);
    b.circle(16, 19, 3, on ? C.teal : C.navy);
    b.circle(16, 19, 1.8, on ? C.cyan : C.night);
    if (on) { b.set(15, 18, C.ice); b.set(16, 18, C.white); }
    else { b.line(14, 17, 18, 21, C.slate); }
    // magenta stripe brand
    b.hline(10, 12, 23, C.magenta); b.hline(20, 22, 23, C.magenta);
  });
}

function mirror(k: number): PixBuf {
  return deviceFrame((b) => {
    const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a) * 0.5;
    const HALF = 11, H = 22;
    // base disc
    b.ellipse(16, G, 10, 3.5, C.slate);
    b.ellipse(16, G - 0.5, 8, 2.5, C.steel);
    // panel: a column per footprint step
    const n = 46;
    for (let i = 0; i <= n; i++) {
      const u = -HALF + (2 * HALF * i) / n;
      const x = Math.round(16 + u * c), yb = Math.round(G - 2 + u * s);
      for (let y = yb - H; y <= yb; y++) {
        const t = (y - (yb - H)) / H;
        let col: number = t < 0.25 ? C.ice : t < 0.7 ? C.pale : C.fog;
        if (Math.abs((x - 16) + (y - (G - 14)) * 0.8) < 1.5) col = C.white;
        if (y === yb - H || y === yb) col = C.amber;
        b.set(x, y, col);
      }
    }
    // edge-on frames get a frame line so they read as a thin blade
    if (k === 2) { for (let y = G - 2 - HALF * 0.5 - H; y <= G - 2 + HALF * 0.5; y++) b.set(17, Math.round(y), C.steel); }
  });
}

// ------------------------------------------------------------------ portrait (64x64)
function portrait(): PixBuf {
  const b = new PixBuf(64, 64);
  // backdrop panel
  b.rect(2, 2, 60, 60, C.plum);
  for (let y = 3; y < 61; y += 3) b.hline(3, 60, y, C.night);
  b.strokeRect(2, 2, 60, 60, C.magenta);
  b.strokeRect(3, 3, 58, 58, C.grape);
  // hair back
  part(b, HAIR, (x) => { x.ellipse(29, 24, 21, 19, 1); x.ellipse(18, 38, 11, 12, 1); x.ellipse(44, 38, 6, 10, 1); });
  // gown + boa
  part(b, WHITE, (x) => x.poly([[14, 64], [20, 52], [44, 52], [52, 64]], 1));
  part(b, BOA, (x) => { for (let i = 0; i <= 10; i++) x.circle(12 + i * 4, 52 - Math.sin((i / 10) * Math.PI) * 3, 4.2, 1); });
  for (let y = 44; y < 60; y++) for (let x = 6; x < 60; x++) if (b.get(x, y) === C.cyan && hash2(x, y, 6) < 0.2) b.set(x, y, C.ice);
  // neck + face
  part(b, SKIN, (x) => { x.rect(30, 38, 8, 9, 1); }, { innerLine: false });
  part(b, SKIN, (x) => { x.ellipse(35, 29, 10.5, 13, 1); x.poly([[27, 34], [33, 43], [39, 43], [45, 31]], 1); }, { innerLine: false });
  // bangs
  part(b, HAIR, (x) => x.poly([[10, 18], [22, 7], [38, 6], [49, 13], [47, 22], [40, 17], [33, 21], [26, 19], [20, 28], [14, 31]], 1));
  for (const [x, y] of [[26, 10], [27, 10], [28, 9], [33, 9], [34, 8]] as Pt[]) b.set(x, y, C.rose);
  // eyes: near eye cyan hologram iris, far eye smaller
  b.hline(32, 38, 26, C.ink); b.hline(33, 37, 25, C.ink);
  b.rect(33, 27, 4, 2, C.white); b.rect(34, 27, 2, 2, C.cyan); b.set(35, 27, C.ice);
  b.hline(41, 44, 26, C.ink); b.rect(42, 27, 2, 2, C.cyan);
  b.set(38, 24, C.grape); b.set(39, 23, C.grape);
  // beauty mark, cheek, lips
  b.set(31, 34, C.ink);
  b.set(43, 32, C.rose); b.set(44, 32, C.rose);
  b.hline(36, 41, 37, C.red); b.hline(37, 40, 38, C.maroon); b.set(38, 36, C.red); b.set(40, 36, C.red);
  // star clip
  b.set(16, 17, C.amber); b.hline(14, 18, 17, C.sodium); b.vline(16, 15, 19, C.sodium); b.set(16, 17, C.white);
  b.outline(C.ink);
  // scanlines
  for (let y = 4; y < 60; y += 4) for (let x = 4; x < 60; x++) { const c = b.get(x, y); if (c === C.magenta) b.set(x, y, C.rose); }
  return b;
}

// ------------------------------------------------------------------ background (640x360)
function neonLine(b: PixBuf, x0: number, y0: number, x1: number, y1: number, core: number, edge: number): void {
  b.line(x0, y0 + 1, x1, y1 + 1, edge);
  b.line(x0, y0, x1, y1, core);
}

function neonPoly(b: PixBuf, pts: Pt[], core: number, edge: number, closed = true): void {
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    neonLine(b, a[0], a[1], c[0], c[1], core, edge);
  }
}

const GLYPHS: Record<string, string[]> = {
  L: ['x...', 'x...', 'x...', 'x...', 'x...', 'xxxx'],
  U: ['x..x', 'x..x', 'x..x', 'x..x', 'x..x', '.xx.'],
  X: ['x..x', 'x..x', '.xx.', '.xx.', 'x..x', 'x..x'],
};

function neonText(b: PixBuf, text: string, x: number, y: number, s: number, core: number, edge: number): void {
  let cx = x;
  for (const ch of text) {
    const gl = GLYPHS[ch];
    gl.forEach((row, ry) => [...row].forEach((v, rx) => {
      if (v !== 'x') return;
      b.rect(cx + rx * s, y + ry * s + 1, s, s, edge);
      b.rect(cx + rx * s, y + ry * s, s, s, core);
    }));
    cx += 5 * s;
  }
}

function club(): PixBuf {
  const b = new PixBuf(640, 360);
  // floor: dark lacquered tiles with neon reflections
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
    const tx = x >> 5, ty = y >> 5;
    let c: number = C.night;
    const h = hash2(x, y, 31);
    if ((tx + ty) % 2 && h < 0.18) c = C.navy;
    else if (h < 0.015) c = C.indigo;
    else if (h < 0.02) c = C.plum;
    if (x % 32 === 0 || y % 32 === 0) c = C.ink;
    else if (x % 32 === 1 || y % 32 === 1) c = (tx + ty) % 2 ? C.navy : C.night;
    b.set(x, y, c);
  }
  // reflections of the wall neon on the floor (vertical streaks)
  for (const n of NEON) {
    if (n.y > 100) continue;
    const col = n.c === P.cyan ? C.teal : C.grape;
    for (let y = 52; y < 120; y++) for (let x = n.x - 18; x <= n.x + 18; x++) {
      if (hash2(x, y, 41) < 0.12 * (1 - (y - 52) / 70) && x % 32 && y % 32) b.set(x, y, col);
    }
  }
  // stage runway at the top with a lip of bulbs
  b.rect(80, 76, 480, 46, C.plum);
  for (let y = 76; y < 122; y++) for (let x = 80; x < 560; x++) if (hash2(x, y, 51) < 0.05) b.set(x, y, C.grape);
  b.hline(80, 559, 121, C.ink);
  b.hline(80, 559, 120, C.grape);
  for (let x = 84; x < 560; x += 8) { b.set(x, 119, C.amber); b.set(x + 1, 119, C.sodium); }
  // laser marks: 5-point stars
  for (const [mx, my] of MARKS) {
    const pts: Pt[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4 : 9;
      pts.push([mx + Math.cos(a) * r, my + Math.sin(a) * r * 0.7]);
    }
    for (let i = 0; i < 10; i++) b.line(pts[i][0], pts[i][1], pts[(i + 1) % 10][0], pts[(i + 1) % 10][1], C.sodium);
  }
  // dance floor glass
  const F = FLOOR;
  b.rect(F.x - 3, F.y - 3, F.cols * F.cw + 6, F.rows * F.ch + 6, C.steel);
  b.rect(F.x - 2, F.y - 2, F.cols * F.cw + 4, F.rows * F.ch + 4, C.ink);
  for (let r = 0; r < F.rows; r++) for (let c = 0; c < F.cols; c++) {
    const x = F.x + c * F.cw, y = F.y + r * F.ch;
    b.rect(x + 1, y + 1, F.cw - 2, F.ch - 2, (c + r) % 2 ? C.navy : C.indigo);
    b.hline(x + 1, x + F.cw - 2, y + 1, C.slate);
    b.vline(x + 1, y + 1, y + F.ch - 2, C.slate);
    b.hline(x + 2, x + F.cw - 2, y + F.ch - 2, C.night);
    for (let i = 0; i < 4; i++) b.set(x + 4 + i * 6, y + 4 + ((i * 5) % (F.ch - 8)), (c + r) % 2 ? C.abyss : C.grape);
  }
  for (let x = F.x - 3; x < F.x + F.cols * F.cw + 3; x += 6) { b.set(x, F.y - 3, C.amber); b.set(x, F.y + F.rows * F.ch + 2, C.amber); }

  // ---- walls
  // top: truss band (0..31) + wall face (32..47)
  b.rect(0, 0, 640, 32, C.ink);
  for (let x = 0; x < 640; x++) for (let y = 0; y < 32; y++) if (hash2(x, y, 61) < 0.06) b.set(x, y, C.night);
  b.hline(0, 639, 22, C.slate); b.hline(0, 639, 28, C.slate);
  for (let x = 0; x < 640; x += 8) b.line(x, 22, x + 6, 28, C.navy);
  for (let x = 40; x < 640; x += 64) { b.rect(x, 24, 8, 6, C.steel); b.rect(x + 2, 29, 4, 2, C.amber); }
  b.rect(0, 32, 640, 16, C.plum);
  for (let x = 0; x < 640; x += 20) b.vline(x, 32, 47, C.grape);
  b.hline(0, 639, 32, C.grape); b.hline(0, 639, 47, C.ink);
  // floor contact shadow
  for (let y = 48; y < 52; y++) for (let x = 16; x < 624; x++) if (y < 50 || (x + y) % 2 === 0) b.set(x, y, C.ink);
  // side walls with speaker stacks
  for (const sx of [0, 624]) {
    b.rect(sx, 32, 16, 328, C.ink);
    for (let y = 60; y < 330; y += 34) {
      b.rect(sx + 2, y, 12, 30, C.navy);
      b.strokeRect(sx + 2, y, 12, 30, C.slate);
      b.circle(sx + 8, y + 9, 3.5, C.night); b.ring(sx + 8, y + 9, 3.5, C.steel);
      b.circle(sx + 8, y + 21, 4.5, C.night); b.ring(sx + 8, y + 21, 4.5, C.steel);
      b.set(sx + 8, y + 21, C.slate);
    }
  }
  // bottom: bar counter
  b.rect(0, 336, 640, 24, C.umber);
  b.hline(0, 639, 336, C.ink); b.hline(0, 639, 337, C.sodium); b.hline(0, 639, 338, C.rust);
  for (let x = 0; x < 640; x++) for (let y = 340; y < 360; y++) if (hash2(x, y, 71) < 0.08) b.set(x, y, C.rust);
  for (let i = 0; i < 40; i++) {
    const x = 24 + Math.floor(hash2(i, 1, 81) * 590), h = 4 + Math.floor(hash2(i, 2, 81) * 5);
    const col = [C.teal, C.lime, C.maroon, C.amber, C.orchid][Math.floor(hash2(i, 3, 81) * 5)];
    b.rect(x, 346 - h, 2, h, col); b.set(x, 345 - h, C.pale); b.set(x, 346 - h, C.white);
  }
  // ---- neon signs
  // heart
  const hp: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    hp.push([120 + 0.6 * 16 * Math.sin(t) ** 3, 38 - 0.45 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  neonPoly(b, hp, C.rose, C.magenta);
  // LUX
  neonText(b, 'LUX', 292, 34, 2, C.white, C.rose);
  b.hline(286, 354, 47, C.magenta);
  // cocktail glass
  neonPoly(b, [[508, 30], [532, 30], [520, 40]], C.ice, C.cyan);
  neonLine(b, 520, 40, 520, 45, C.ice, C.cyan);
  neonLine(b, 514, 46, 526, 46, C.ice, C.cyan);
  b.set(526, 32, C.acid); b.set(527, 31, C.acid);
  // side neon strips
  for (let y = 172; y < 222; y++) { b.set(7, y, C.ice); b.set(8, y, C.cyan); b.set(631, y, C.rose); b.set(632, y, C.magenta); }
  return b;
}

export function buildLuxArt(): SheetSpec[] {
  return [
    {
      key: 'lux', group: 'Bosses', frameW: 40, frameH: 56, columns: 5,
      frames: (['idle1', 'idle2', 'cast', 'kiss', 'hurt'] as const).map((n) => ({ name: n, buf: luxFrame(POSES[n]) })),
    },
    {
      key: 'lux_dev', group: 'Props', frameW: 32, frameH: 48, columns: 8,
      frames: [
        { name: 'breaker_on', buf: breaker(true) },
        { name: 'breaker_off', buf: breaker(false) },
        { name: 'projector_on', buf: projector(true) },
        { name: 'projector_off', buf: projector(false) },
        ...[0, 1, 2, 3].map((k) => ({ name: `mirror_${k}`, buf: mirror(k) })),
      ],
    },
    { key: 'lux_portrait', group: 'Portraits (64x64)', frameW: 64, frameH: 64, frames: [{ name: 'lux', buf: portrait() }] },
    { key: 'bg_club', group: 'Arenas', frameW: 640, frameH: 360, frames: [{ name: 'bg', buf: club() }] },
  ];
}
