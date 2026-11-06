/**
 * Madame Lux + Neon Bazaar club art (palette indices only).
 *   lux           40x56  idle1, idle2, cast, kiss, hurt  (3/4 view facing right, origin bottom centre;
 *                        floating hologram idol: magenta bob, white sequin gown, cyan boa, no feet)
 *   lux_dev       32x48  breaker_on/off, projector_on/off, mirror_0..3, dj_on/off (ground point at
 *                        row 38, drawn at y + 10). Mirror k = plane at k * 45 deg (y foreshortened x0.5).
 *   lux_portrait  64x64  'lux'
 *   bg_club       1280x360 the whole scrolling club: bar zone (parquet, counter, booths, back bar),
 *                        dance floor (stage strip, turntable base), glass partition, VIP carpet and
 *                        couches, walls from `clubMask`, neon signs.
 */
import { C, RAMP } from './palette';
import { PixBuf, type Pt } from './core/pixbuf';
import { hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { mat, part } from './actors/rig';
import { BOOTH_COLS, clubMask, COUCHES, COUNTER, GLASS, glassSpans, MAP, MARKS, NEON, STAGE_STRIP, TABLE, VIP_START, WEST_END, type LowCover } from '../game/arenas/club';
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

function djConsole(on: boolean): PixBuf {
  return deviceFrame((b) => {
    // desk: top surface + front panel
    b.rect(2, 22, 28, 8, C.slate);
    b.hline(2, 29, 22, C.fog);
    b.rect(2, 30, 28, G - 30, C.navy);
    b.hline(2, 29, 30, C.ink);
    for (let x = 4; x < 29; x += 6) b.vline(x, 31, G - 1, C.night);
    // two platters and the mixer
    for (const cx of [9, 23]) { b.ellipse(cx, 26, 5, 2.5, C.ink); b.ellipse(cx, 26, 4, 1.8, on ? C.grape : C.night); b.set(cx, 26, C.fog); }
    b.rect(14, 23, 4, 5, C.ink);
    b.set(15, 24, on ? C.acid : C.red); b.set(16, 26, on ? C.amber : C.slate);
    // neon trim on the front
    b.hline(3, 28, 34, on ? C.magenta : C.grape);
    b.hline(3, 28, 35, on ? C.rose : C.plum);
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

// ------------------------------------------------------------------ background (1280x360)
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
  V: ['x..x', 'x..x', 'x..x', 'x..x', '.xx.', '.xx.'],
  I: ['xxx.', '.x..', '.x..', '.x..', '.x..', 'xxx.'],
  P: ['xxx.', 'x..x', 'x..x', 'xxx.', 'x...', 'x...'],
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

function couch(b: PixBuf, c: LowCover): void {
  const { x, y, w, h, top } = c;
  // backrest, then the seat in front of it
  b.rect(x, y - top, w, top - 2, C.grape);
  b.hline(x, x + w - 1, y - top, C.orchid);
  for (let i = x + 6; i < x + w - 2; i += 12) b.vline(i, y - top + 2, y - 4, C.plum);
  b.rect(x, y - 2, w, h + 2, C.orchid);
  b.hline(x, x + w - 1, y - 2, C.pale);
  for (let i = x + 4; i < x + w - 2; i += 8) b.set(i, y + 2, C.grape);
  b.hline(x, x + w - 1, y + h - 1, C.grape);
  b.strokeRect(x - 1, y - top - 1, w + 2, top + h + 2, C.ink);
  for (let i = x; i < x + w; i++) if (i % 2 === 0) b.set(i, y + h + 1, C.ink);
}

function club(): PixBuf {
  const W = MAP.w, H = MAP.h;
  const b = new PixBuf(W, H);
  // ---- floors: bar parquet (west), lacquer tiles (dance floor), VIP carpet
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const h = hash2(x, y, 31);
    let c: number = C.night;
    if (x < WEST_END) {
      const row = y >> 3, joint = (x + row * 37) % 48;
      c = row % 2 ? C.umber : C.night;
      if (h < 0.05) c = C.umber;
      if (y % 8 === 0 || joint === 0) c = C.ink;
    } else if (x >= VIP_START) {
      const u = (x + y) % 24, v = (x - y + 960) % 24;
      c = C.plum;
      if (u === 0 || v === 0) c = C.grape;
      else if (h < 0.04) c = C.maroon;
    } else {
      const tx = x >> 5, ty = y >> 5;
      if ((tx + ty) % 2 && h < 0.18) c = C.navy;
      else if (h < 0.015) c = C.indigo;
      else if (h < 0.02) c = C.plum;
      if (x % 32 === 0 || y % 32 === 0) c = C.ink;
      else if (x % 32 === 1 || y % 32 === 1) c = (tx + ty) % 2 ? C.navy : C.night;
    }
    b.set(x, y, c);
  }
  // brass trim between the bar and the dance floor
  for (let y = 48; y < 336; y++) { b.set(WEST_END, y, y % 4 ? C.rust : C.sodium); b.set(WEST_END + 1, y, C.ink); }
  // reflections of the top-wall neon on the floor (vertical streaks)
  for (const n of NEON) {
    if (n.y > 100 || n.x < WEST_END || n.x >= VIP_START) continue;
    const col = n.c === P.cyan ? C.teal : C.grape;
    for (let y = 52; y < 120; y++) for (let x = n.x - 18; x <= n.x + 18; x++) {
      if (hash2(x, y, 41) < 0.12 * (1 - (y - 52) / 70) && b.get(x, y) !== C.ink) b.set(x, y, col);
    }
  }
  // ---- stage strip with a lip of bulbs
  const S = STAGE_STRIP;
  b.rect(S.x, S.y, S.w, S.h, C.plum);
  for (let y = S.y; y < S.y + S.h; y++) for (let x = S.x; x < S.x + S.w; x++) if (hash2(x, y, 51) < 0.05) b.set(x, y, C.grape);
  b.hline(S.x, S.x + S.w - 1, S.y + S.h, C.ink);
  b.hline(S.x, S.x + S.w - 1, S.y + S.h - 1, C.grape);
  for (let x = S.x + 4; x < S.x + S.w; x += 8) { b.set(x, S.y + S.h - 2, C.amber); b.set(x + 1, S.y + S.h - 2, C.sodium); }
  // laser marks: 5-point stars
  for (const [mx, my] of MARKS) {
    const pts: Pt[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4 : 9;
      pts.push([mx + Math.cos(a) * r, my + Math.sin(a) * r * 0.7]);
    }
    for (let i = 0; i < 10; i++) b.line(pts[i][0], pts[i][1], pts[(i + 1) % 10][0], pts[(i + 1) % 10][1], C.sodium);
  }
  // ---- turntable base (the rotating sector lines are drawn at runtime)
  const T = TABLE;
  b.circle(T.x, T.y + 2, T.r + 4, C.ink);
  b.circle(T.x, T.y, T.r + 3, C.steel);
  b.circle(T.x, T.y, T.r + 1, C.ink);
  for (let i = 2; i >= 0; i--) b.circle(T.x, T.y, T.rings[i + 1] - 1, i % 2 ? C.navy : C.night);
  for (const r of [T.rings[1], T.rings[2]]) b.ring(T.x, T.y, r, C.slate);
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; b.set(Math.round(T.x + Math.cos(a) * (T.r + 2)), Math.round(T.y + Math.sin(a) * (T.r + 2)), C.amber); }
  b.circle(T.x, T.y, 5, C.slate); b.circle(T.x, T.y, 2, C.fog);

  // ---- walls from the shared mask
  const cols = W / 16, rows = H / 16;
  const wall = (c: number, r: number) => c < 0 || r < 0 || c >= cols || r >= rows || clubMask(c, r);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!wall(c, r)) continue;
    const x0 = c * 16, y0 = r * 16;
    const face = !wall(c, r + 1);
    for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
      let col: number = C.ink;
      if (face) {
        col = C.plum;
        if (x % 20 === 0) col = C.grape;
        if (y === y0) col = C.grape;
        if (y === y0 + 15) col = C.ink;
      } else if (hash2(x, y, 61) < 0.06) col = C.night;
      b.set(x, y, col);
    }
  }
  // truss band along the top
  b.hline(0, W - 1, 22, C.slate); b.hline(0, W - 1, 28, C.slate);
  for (let x = 0; x < W; x += 8) b.line(x, 22, x + 6, 28, C.navy);
  for (let x = 40; x < W; x += 64) { b.rect(x, 24, 8, 6, C.steel); b.rect(x + 2, 29, 4, 2, C.amber); }
  // back bar on the west wall face: shelves with bottles and a mirror strip
  const wf = 80;
  for (let x = 16; x < WEST_END; x++) {
    const c = x >> 4;
    if (BOOTH_COLS.some(([a, z]) => c >= a && c <= z)) continue;
    for (let y = wf; y < wf + 15; y++) b.set(x, y, y < wf + 6 ? (hash2(x, y, 3) < 0.3 ? C.slate : C.indigo) : C.umber);
    b.set(x, wf + 6, C.sodium);
    b.set(x, wf + 14, C.ink);
    const hb = hash2(x >> 2, 9, 81);
    if (x % 4 < 2 && hb < 0.7) {
      const bc = [C.teal, C.lime, C.maroon, C.amber, C.orchid][Math.floor(hash2(x >> 2, 3, 81) * 5)];
      const bh = 3 + Math.floor(hb * 4);
      for (let y = wf + 13 - bh; y <= wf + 13; y++) b.set(x, y, bc);
      b.set(x, wf + 12 - bh, C.pale);
    }
  }
  // booths: velvet floor, a curved bench at the back, side walls
  for (const [a, z] of BOOTH_COLS) {
    const x0 = a * 16, x1 = (z + 1) * 16;
    for (let y = 48; y < 96; y++) for (let x = x0; x < x1; x++) b.set(x, y, (x + y) % 6 === 0 ? C.grape : C.plum);
    b.rect(x0 + 2, 48, x1 - x0 - 4, 8, C.maroon);
    b.hline(x0 + 2, x1 - 3, 48, C.rose);
    b.rect(x0 + 2, 48, 6, 30, C.maroon); b.rect(x1 - 8, 48, 6, 30, C.maroon);
    b.vline(x0 + 2, 48, 77, C.rose); b.vline(x1 - 3, 48, 77, C.rose);
    b.hline(x0 + 2, x1 - 3, 56, C.ink);
    for (const x of [x0, x0 + 1, x1 - 1, x1 - 2]) b.vline(x, 48, 95, C.ink);
    b.vline(x0 + 1, 48, 95, C.slate); b.vline(x1 - 2, 48, 95, C.slate);
  }
  // contact shadow under every wall face
  for (let x = 16; x < W - 16; x++) {
    let y = 47;
    while (y < H && wall(x >> 4, y >> 4)) y++;
    for (let k = 0; k < 4; k++) if (k < 2 || (x + y + k) % 2 === 0) b.set(x, y + k, C.ink);
  }
  // side walls with speaker stacks
  for (const sx of [0, W - 16]) {
    b.rect(sx, 32, 16, H - 32, C.ink);
    for (let y = 60; y < 330; y += 34) {
      b.rect(sx + 2, y, 12, 30, C.navy);
      b.strokeRect(sx + 2, y, 12, 30, C.slate);
      b.circle(sx + 8, y + 9, 3.5, C.night); b.ring(sx + 8, y + 9, 3.5, C.steel);
      b.circle(sx + 8, y + 21, 4.5, C.night); b.ring(sx + 8, y + 21, 4.5, C.steel);
      b.set(sx + 8, y + 21, C.slate);
    }
  }
  // bottom: front rail
  b.rect(0, 336, W, 24, C.night);
  b.hline(0, W - 1, 336, C.ink); b.hline(0, W - 1, 337, C.grape); b.hline(0, W - 1, 338, C.magenta);
  for (let x = 0; x < W; x += 24) b.rect(x, 340, 3, 20, C.navy);

  // ---- the bar counter (low cover): top surface above its footprint, front panel on it
  const K = COUNTER, ky = K.y - K.top;
  b.rect(K.x - 1, ky - 1, K.w + 2, K.top + K.h + 2, C.ink);
  b.rect(K.x, ky, K.w, K.top, C.rust);
  b.hline(K.x, K.x + K.w - 1, ky, C.orange);
  for (let x = K.x; x < K.x + K.w; x++) for (let y = ky + 1; y < K.y - 1; y++) if (hash2(x, y, 71) < 0.12) b.set(x, y, C.umber);
  b.hline(K.x, K.x + K.w - 1, K.y - 1, C.sodium);
  b.rect(K.x, K.y, K.w, K.h, C.umber);
  for (let x = K.x + 8; x < K.x + K.w - 4; x += 34) b.strokeRect(x, K.y + 2, 26, K.h - 4, C.rust);
  b.hline(K.x, K.x + K.w - 1, K.y + K.h - 1, C.magenta);
  for (let x = K.x; x < K.x + K.w; x++) if (x % 2 === 0) b.set(x, K.y + K.h + 1, C.ink);
  // ---- couches (low cover)
  for (const c of COUCHES) couch(b, c);
  // ---- glass partition: dithered pane, bright edges, the top edge 16 px above the footprint
  const GH = 16;
  for (const [y0, y1] of glassSpans()) {
    for (let y = Math.max(32, y0 - GH); y < y1; y++) for (let x = GLASS.x; x < GLASS.x + GLASS.w; x++) {
      if ((x + y) % 2 === 0) b.set(x, y, C.teal);
      else if ((x + y) % 7 === 0) b.set(x, y, C.ice);
    }
    for (let y = Math.max(32, y0 - GH); y < y1; y++) { b.set(GLASS.x, y, C.cyan); b.set(GLASS.x + GLASS.w - 1, y, C.ice); }
    if (y0 - GH >= 32) b.hline(GLASS.x, GLASS.x + GLASS.w - 1, y0 - GH, C.ice);
    b.hline(GLASS.x - 1, GLASS.x + GLASS.w, y1 - 1, C.ink);
    for (let y = y0 + 6; y < y1 - 12; y += 22) b.line(GLASS.x + 1, y + 4, GLASS.x + GLASS.w - 2, y, C.white);
  }
  // doorway thresholds
  for (const [d0, d1] of GLASS.doors) for (let y = d0; y < d1; y += 3) { b.set(GLASS.x + 1, y, C.sodium); b.set(GLASS.x + GLASS.w - 2, y, C.sodium); }

  // ---- neon signs
  const heart = (cx: number, cy: number) => {
    const hp: Pt[] = [];
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      hp.push([cx + 0.6 * 16 * Math.sin(t) ** 3, cy - 0.45 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
    }
    neonPoly(b, hp, C.rose, C.magenta);
  };
  heart(470, 38);
  heart(810, 38);
  neonText(b, 'LUX', 612, 34, 2, C.white, C.rose);
  b.hline(606, 674, 47, C.magenta);
  neonText(b, 'VIP', 1044, 32, 2, C.ice, C.cyan);
  b.hline(1038, 1106, 47, C.cyan);
  // cocktail glass over the back bar
  const gx = 200, gy = 54;
  neonPoly(b, [[gx - 12, gy], [gx + 12, gy], [gx, gy + 10]], C.ice, C.cyan);
  neonLine(b, gx, gy + 10, gx, gy + 15, C.ice, C.cyan);
  neonLine(b, gx - 6, gy + 16, gx + 6, gy + 16, C.ice, C.cyan);
  b.set(gx + 6, gy + 2, C.acid); b.set(gx + 7, gy + 1, C.acid);
  // side neon strips
  for (let y = 196; y < 246; y++) { b.set(7, y, C.ice); b.set(8, y, C.cyan); b.set(W - 9, y, C.rose); b.set(W - 8, y, C.magenta); }
  return b;
}

export function buildLuxArt(): SheetSpec[] {
  return [
    {
      key: 'lux', group: 'Bosses', frameW: 40, frameH: 56, columns: 5,
      frames: (['idle1', 'idle2', 'cast', 'kiss', 'hurt'] as const).map((n) => ({ name: n, buf: luxFrame(POSES[n]) })),
    },
    {
      key: 'lux_dev', group: 'Props', frameW: 32, frameH: 48, columns: 10,
      frames: [
        { name: 'breaker_on', buf: breaker(true) },
        { name: 'breaker_off', buf: breaker(false) },
        { name: 'projector_on', buf: projector(true) },
        { name: 'projector_off', buf: projector(false) },
        ...[0, 1, 2, 3].map((k) => ({ name: `mirror_${k}`, buf: mirror(k) })),
        { name: 'dj_on', buf: djConsole(true) },
        { name: 'dj_off', buf: djConsole(false) },
      ],
    },
    { key: 'lux_portrait', group: 'Portraits (64x64)', frameW: 64, frameH: 64, frames: [{ name: 'lux', buf: portrait() }] },
    { key: 'bg_club', group: 'Arenas', frameW: MAP.w, frameH: MAP.h, frames: [{ name: 'bg', buf: club() }] },
  ];
}
