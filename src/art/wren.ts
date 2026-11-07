/**
 * Wren + dive cafe art (palette indices only).
 *   wren         32x48   idle1, idle2, walk1, walk2, cast, shoot, hurt (3/4 view facing right,
 *                        origin bottom centre, ground row 44). Black undercut with a cyan streak,
 *                        cyan AR monocle, chest rig with 6 cyan data cartridges, sleeveless long
 *                        black coat with magenta lining and cyan seams, cyber arm in front, stylus.
 *   wren_net     32x48   the same frames + whip as a wireframe code avatar
 *   dive_dev     32x48   pod_empty, pod_full, pod_jack, wpod_empty, wpod_full, node, port, rack
 *                        (ground row 44)
 *   dive_fx      16x16   arrow_r/l/u/d, arrow_red_r/l/u/d (data stream chevrons)
 *   dive_win     48x32   win_a, win_b (AR pop-up window; b = about to slam shut)
 *   bg_divecafe  960x540 real (frame 0), net, net_ghost, real_ghost (ghosts are transparent
 *                        overlays drawn at low alpha over the other layer)
 */
import { C, RAMP } from './palette';
import { PixBuf, type Pt } from './core/pixbuf';
import { hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { mat, part } from './actors/rig';
import {
  BAR, BOOTHS, DIVE_BOUNDS, DIVE_MAP, NET_WALLS, PODS, PORT_SLOTS, RACKS, STREAMS, WREN_POD,
} from '../game/arenas/divecafe';

const HAIR = mat([C.ink, C.night, C.navy, C.indigo], 1);
const SKIN = mat([C.skinWarm05, C.skinWarm07, C.skinWarm09, C.skinWarm10], 2);
const COAT = mat([C.ink, C.night, C.navy, C.indigo], 1);
const PANTS = mat([C.ink, C.night, C.navy], 1);
const RIG = mat([C.ink, C.navy, C.slate, C.steel], 1);
const CHROME = mat(RAMP.chrome, 2);
const BOOT = mat([C.ink, C.night, C.navy], 1);

// ------------------------------------------------------------------ Wren (32x48, ground row 44)
type WFrame = 'idle1' | 'idle2' | 'walk1' | 'walk2' | 'cast' | 'shoot' | 'hurt';
interface WPose {
  ux: number; uy: number;
  /** Feet: back, front. */
  bf: Pt; ff: Pt;
  /** Coat hem corners: back, front. */
  hb: Pt; hf: Pt;
  /** Stylus hand (back arm) and the stylus tip. */
  sh: Pt; tip: Pt;
  /** Cyber hand (front arm). */
  ch: Pt;
  mood: 'normal' | 'hurt' | 'cast';
}

const WPOSES: Record<WFrame, WPose> = {
  idle1: { ux: 0, uy: 0, bf: [13, 44], ff: [19, 44], hb: [8, 41], hf: [24, 41], sh: [11, 22], tip: [8, 13], ch: [22, 31], mood: 'normal' },
  idle2: { ux: 0, uy: 1, bf: [13, 44], ff: [19, 44], hb: [8, 42], hf: [24, 42], sh: [11, 23], tip: [8, 14], ch: [22, 32], mood: 'normal' },
  walk1: { ux: 1, uy: 0, bf: [11, 44], ff: [21, 43], hb: [6, 40], hf: [25, 41], sh: [12, 23], tip: [9, 15], ch: [22, 30], mood: 'normal' },
  walk2: { ux: 1, uy: 1, bf: [15, 43], ff: [17, 44], hb: [7, 41], hf: [24, 40], sh: [11, 24], tip: [8, 16], ch: [21, 32], mood: 'normal' },
  cast: { ux: 0, uy: 0, bf: [12, 44], ff: [20, 44], hb: [6, 40], hf: [25, 40], sh: [13, 12], tip: [17, 3], ch: [27, 23], mood: 'cast' },
  shoot: { ux: 1, uy: 0, bf: [11, 44], ff: [21, 44], hb: [6, 40], hf: [26, 40], sh: [25, 19], tip: [31, 18], ch: [21, 29], mood: 'cast' },
  hurt: { ux: -2, uy: 2, bf: [12, 44], ff: [19, 44], hb: [7, 42], hf: [22, 42], sh: [9, 28], tip: [5, 24], ch: [18, 32], mood: 'hurt' },
};

function wrenFrame(pp: WPose): PixBuf {
  const b = new PixBuf(32, 48);
  const ux = pp.ux, uy = pp.uy;
  const shB: Pt = [12 + ux, 18 + uy], shF: Pt = [20 + ux, 18 + uy];
  const hip: Pt = [16 + ux, 30 + uy];
  // boots with cyan soles, legs
  for (const f of [pp.bf, pp.ff]) {
    part(b, PANTS, (x) => x.capsule(hip[0] + (f[0] < hip[0] ? -2 : 2), hip[1], f[0], f[1] - 3, 2, 1));
    part(b, BOOT, (x) => { x.rect(f[0] - 2, f[1] - 4, 5, 4, 1); x.rect(f[0] - 2, f[1] - 1, 6, 1, 1); }, { innerLine: false });
    b.hline(f[0] - 2, f[0] + 3, f[1], C.teal);
    b.set(f[0] + 2, f[1], C.cyan);
  }
  // back of the coat (magenta lining shows inside)
  part(b, mat([C.plum, C.grape, C.orchid, C.magenta], 2), (x) => x.poly([[shB[0] - 1, shB[1] + 3], [shF[0], shF[1] + 3], [pp.hf[0] - 2, pp.hf[1] - 1], [pp.hb[0] + 1, pp.hb[1] - 1]], 1), { innerLine: false });
  // legs in front of the lining
  for (const f of [pp.bf, pp.ff]) part(b, PANTS, (x) => x.capsule(hip[0] + (f[0] < hip[0] ? -2 : 2), hip[1] + 1, f[0], f[1] - 4, 2, 1));
  // stylus arm (back, skin, fingerless glove)
  part(b, SKIN, (x) => x.capsule(shB[0], shB[1] + 1, pp.sh[0], pp.sh[1], 1.6, 1));
  part(b, BOOT, (x) => x.circle(pp.sh[0] + 0.5, pp.sh[1] + 0.5, 1.6, 1), { innerLine: false });
  b.line(pp.sh[0], pp.sh[1], pp.tip[0], pp.tip[1], C.steel);
  b.set(pp.tip[0], pp.tip[1], C.ice);
  // long sleeveless coat: two front panels open over the rig
  part(b, COAT, (x) => {
    x.poly([[shB[0] - 2, shB[1]], [hip[0] - 1, shB[1] + 2], [hip[0] - 2, 33 + uy], [pp.hb[0] + 3, pp.hb[1]], [pp.hb[0], pp.hb[1]], [shB[0] - 3, 26 + uy]], 1);
    x.poly([[shF[0] + 2, shF[1]], [hip[0] + 2, shF[1] + 2], [hip[0] + 3, 33 + uy], [pp.hf[0] - 3, pp.hf[1]], [pp.hf[0], pp.hf[1]], [shF[0] + 3, 26 + uy]], 1);
  }, { light: [-1, -1] });
  // cyan seams down the panel edges, magenta lining on the hems
  b.line(shF[0] + 3, 25 + uy, pp.hf[0] - 1, pp.hf[1] - 1, C.cyan);
  b.line(shB[0] - 3, 25 + uy, pp.hb[0] + 1, pp.hb[1] - 1, C.teal);
  b.hline(pp.hb[0], pp.hb[0] + 3, pp.hb[1], C.magenta);
  b.hline(pp.hf[0] - 3, pp.hf[0], pp.hf[1], C.magenta);
  // chest rig with 6 cartridges (2 rows x 3)
  part(b, RIG, (x) => x.rect(shB[0] + 1, shB[1] + 1, 8, 9, 1));
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const cx = shB[0] + 2 + c * 2 + (c > 0 ? c - 1 : 0) - (c === 2 ? 1 : 0), cy = shB[1] + 2 + r * 4;
    b.set(cx, cy, C.cyan); b.set(cx, cy + 1, C.teal); b.set(cx + 1, cy, C.ice);
  }
  b.hline(shB[0] + 1, shB[0] + 8, hip[1] - 1, C.ink);
  b.set(hip[0], hip[1] - 1, C.steel);
  // high collar with magenta inside
  part(b, COAT, (x) => x.poly([[shB[0] - 1, shB[1] - 3], [shF[0] + 1, shF[1] - 4], [shF[0] + 2, shF[1] + 1], [shB[0] - 2, shB[1] + 1]], 1));
  b.hline(shB[0], shF[0], shF[1] - 3, C.magenta);
  // head: face toward the right
  const hx = 16 + ux, hy = 10 + uy;
  part(b, SKIN, (x) => x.ellipse(hx + 1, hy + 1, 3.6, 4.2, 1));
  // black undercut: shaved back of the head, long top swept forward over the brow
  part(b, HAIR, (x) => {
    x.ellipse(hx - 1, hy - 3, 4.6, 2.8, 1);
    x.poly([[hx - 5, hy - 3], [hx - 2, hy - 3], [hx - 2, hy + 2], [hx - 4, hy + 1]], 1);
    x.poly([[hx - 1, hy - 6], [hx + 5, hy - 5], [hx + 6, hy - 2], [hx + 4, hy - 2], [hx + 2, hy - 1], [hx, hy - 2]], 1);
  });
  b.set(hx - 3, hy + 1, C.skinWarm06); b.set(hx - 2, hy + 2, C.skinWarm06); // shaved side
  b.line(hx - 1, hy - 5, hx + 5, hy - 3, C.cyan); // cyan streak
  b.set(hx + 6, hy - 2, C.teal);
  // eye + AR monocle on the front eye, its band runs back to the ear
  const ey = hy + (pp.mood === 'hurt' ? 1 : 0);
  if (pp.mood === 'hurt') { b.hline(hx + 2, hx + 4, ey, C.ink); b.set(hx + 5, ey - 1, C.teal); }
  else {
    b.hline(hx - 1, hx, ey - 1, C.teal);
    b.rect(hx + 3, ey - 1, 2, 2, pp.mood === 'cast' ? C.ice : C.cyan);
    b.set(hx + 4, ey - 1, C.ice);
    b.set(hx + 3, ey, C.ink);
  }
  b.set(hx + 4, hy + 3, C.skinWarm05); // mouth
  b.set(hx + 1, hy + 4, C.skinWarm06); // jaw shadow
  // cyber arm (front): chrome with a cyan line and glowing knuckles
  part(b, CHROME, (x) => x.capsule(shF[0] + 1, shF[1] + 1, pp.ch[0], pp.ch[1], 1.8, 1));
  b.line(shF[0] + 1, shF[1] + 2, Math.round((shF[0] + pp.ch[0]) / 2), Math.round((shF[1] + pp.ch[1]) / 2), C.cyan);
  part(b, mat([C.ink, C.slate, C.steel], 1), (x) => x.circle(pp.ch[0] + 0.5, pp.ch[1] + 0.5, 1.6, 1), { innerLine: false });
  b.set(pp.ch[0] + 1, pp.ch[1], pp.mood === 'cast' ? C.ice : C.cyan);
  if (pp.mood === 'hurt') b.line(12 + ux, 31, 15 + ux, 34, C.ink);
  b.outline(C.ink);
  return b;
}

/** Wireframe code look: cyan edges, dark scanlined fill, lights stay bright. */
function netify(src: PixBuf): PixBuf {
  const b = new PixBuf(src.w, src.h);
  const op = (x: number, y: number) => src.get(x, y) !== 0;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const c = src.get(x, y);
    if (!c) continue;
    const edge = !op(x - 1, y) || !op(x + 1, y) || !op(x, y - 1) || !op(x, y + 1);
    const light = c === C.cyan || c === C.ice || c === C.teal || c === C.magenta;
    if (edge) b.set(x, y, (x + y) % 5 === 0 ? C.ice : C.cyan);
    else if (light) b.set(x, y, c === C.magenta ? C.acid : C.ice);
    else if (c === C.ink) b.set(x, y, C.teal);
    else b.set(x, y, y % 2 ? C.abyss : C.ink);
  }
  return b;
}

function whipFrame(): PixBuf {
  const b = netify(wrenFrame(WPOSES.shoot));
  // code whip: a segmented arc out of the cyber hand
  const pts: Pt[] = [[22, 28], [26, 31], [29, 35], [30, 40], [28, 44]];
  for (let i = 1; i < pts.length; i++) b.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], i % 2 ? C.acid : C.ice);
  return b;
}

// ------------------------------------------------------------------ devices (32x48, ground row 44)
function pod(kind: 'empty' | 'full' | 'jack', wren: boolean): PixBuf {
  const b = new PixBuf(32, 48);
  const accent = wren ? C.magenta : C.cyan, accentD = wren ? C.grape : C.teal;
  // base plate
  part(b, mat([C.ink, C.navy, C.slate, C.steel], 2), (x) => x.ellipse(16, 41, 12, 4, 1));
  // reclining shell
  part(b, mat([C.ink, C.night, C.navy, C.indigo, C.slate], 3), (x) => x.poly([[5, 40], [5, 22], [9, 12], [16, 9], [23, 12], [27, 22], [27, 40]], 1));
  // glass canopy
  b.poly([[8, 24], [10, 15], [16, 12], [22, 15], [24, 24], [24, 34], [8, 34]], C.abyss);
  for (let y = 14; y < 34; y += 2) b.hline(9, 23, y, y % 4 ? C.abyss : C.night);
  if (kind !== 'empty') {
    // someone slumped inside
    if (wren) {
      b.ellipse(16, 20, 4, 4, C.skinWarm07);
      b.ellipse(15, 18, 5, 3, C.ink); b.line(13, 17, 19, 19, C.cyan);
      b.rect(11, 24, 10, 9, C.ink); b.rect(13, 25, 6, 3, C.navy);
      b.set(14, 26, C.cyan); b.set(16, 26, C.cyan); b.set(18, 26, C.cyan);
      b.line(11, 32, 21, 32, C.magenta);
    } else {
      b.ellipse(16, 20, 4, 4, C.skinL);
      b.ellipse(16, 18, 4, 2.5, C.night);
      b.rect(11, 24, 10, 9, C.teal); b.rect(13, 25, 6, 6, C.abyss);
    }
    b.hline(10, 22, 15, C.teal);
  }
  // glass edge + light strip
  b.line(8, 24, 10, 15, accentD); b.line(10, 15, 16, 12, accentD); b.line(16, 12, 22, 15, accent); b.line(22, 15, 24, 24, accent);
  const strip = kind === 'jack' ? C.red : accent;
  b.vline(6, 24, 38, strip); b.vline(26, 24, 38, kind === 'jack' ? C.rose : accentD);
  b.rect(10, 36, 12, 3, C.ink); b.hline(11, 20, 37, kind === 'empty' ? C.slate : strip);
  // cable to the floor
  b.line(27, 30, 30, 41, kind === 'jack' ? C.red : C.slate);
  if (kind === 'jack') { b.set(30, 41, C.white); b.set(29, 39, C.amber); b.set(31, 40, C.rose); }
  b.outline(C.ink);
  return b;
}

function node(): PixBuf {
  const b = new PixBuf(32, 48);
  // wireframe hex pad + up arrow
  const pts: Pt[] = [[4, 40], [10, 35], [22, 35], [28, 40], [22, 45], [10, 45]];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; b.line(a[0], a[1], c[0], c[1], C.acid); }
  b.line(9, 40, 23, 40, C.lime);
  for (let y = 18; y < 38; y += 2) b.hline(14, 18, y, y % 4 ? C.lime : C.moss);
  b.line(16, 10, 10, 17, C.acid); b.line(16, 10, 22, 17, C.acid); b.vline(16, 10, 36, C.acid);
  b.set(16, 10, C.white);
  return b;
}

function port(): PixBuf {
  const b = new PixBuf(32, 48);
  part(b, mat([C.ink, C.night, C.abyss, C.teal], 2), (x) => x.ellipse(16, 42, 11, 4, 1));
  part(b, mat([C.ink, C.night, C.navy, C.abyss, C.teal], 3), (x) => x.poly([[9, 41], [8, 22], [12, 14], [20, 14], [24, 22], [23, 41]], 1));
  // red eye core in a cyan frame
  b.rect(11, 21, 10, 10, C.ink);
  b.strokeRect(11, 21, 10, 10, C.cyan);
  b.rect(13, 23, 6, 6, C.maroon); b.rect(14, 24, 4, 4, C.red); b.set(15, 25, C.rose); b.set(16, 25, C.white);
  for (let y = 33; y < 40; y += 2) b.hline(11, 20, y, C.teal);
  b.line(12, 14, 16, 8, C.cyan); b.line(20, 14, 16, 8, C.cyan); b.set(16, 8, C.ice);
  b.outline(C.ink);
  return b;
}

function rack(): PixBuf {
  const b = new PixBuf(32, 48);
  part(b, mat([C.ink, C.night, C.navy, C.slate, C.steel], 3), (x) => x.rect(5, 8, 22, 36, 1));
  for (let y = 11; y < 41; y += 5) {
    b.rect(7, y, 18, 3, C.night); b.hline(8, 20, y + 1, C.navy);
    b.set(22, y + 1, (y / 5) % 2 ? C.cyan : C.acid); b.set(23, y + 1, C.teal);
  }
  b.vline(26, 9, 43, C.cyan);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ fx
function arrow(dir: 'r' | 'l' | 'u' | 'd', red: boolean): PixBuf {
  const b = new PixBuf(16, 16);
  const hi = red ? C.rose : C.ice, mid = red ? C.red : C.cyan, lo = red ? C.maroon : C.teal;
  // chevron pointing right, rotated
  for (let k = 0; k < 2; k++) {
    const ox = 2 + k * 6;
    for (let i = 0; i < 6; i++) {
      b.set(ox + i, 2 + i, k ? hi : mid); b.set(ox + i, 13 - i, k ? hi : mid);
      b.set(ox + i - 1, 2 + i, lo); b.set(ox + i - 1, 13 - i, lo);
    }
    b.set(ox + 6, 8, k ? hi : mid); b.set(ox + 6, 7, k ? hi : mid);
  }
  if (dir === 'r') return b;
  const out = new PixBuf(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const c = b.get(x, y);
    if (!c) continue;
    if (dir === 'l') out.set(15 - x, y, c);
    else if (dir === 'd') out.set(y, x, c);
    else out.set(y, 15 - x, c);
  }
  return out;
}

function arWindow(closing: boolean): PixBuf {
  const b = new PixBuf(48, 32);
  const edge = closing ? C.magenta : C.cyan, bar = closing ? C.grape : C.teal;
  for (let y = 5; y < 31; y++) for (let x = 1; x < 47; x++) if ((x + y) % 2 === 0) b.set(x, y, C.abyss);
  b.strokeRect(0, 0, 48, 32, edge);
  b.rect(1, 1, 46, 5, bar);
  b.hline(3, 20, 3, closing ? C.rose : C.ice);
  // close button
  b.rect(40, 1, 7, 5, closing ? C.red : C.abyss);
  b.line(42, 2, 44, 4, C.white); b.line(44, 2, 42, 4, C.white);
  // text lines + a bar graph
  for (let i = 0; i < 4; i++) b.hline(4, 4 + 10 + ((i * 7) % 18), 10 + i * 4, i % 2 ? C.teal : C.cyan);
  for (let i = 0; i < 5; i++) b.rect(32 + i * 3, 26 - i * 2 - (i % 2) * 2, 2, 4 + i * 2 + (i % 2) * 2, closing ? C.rose : C.ice);
  // corner brackets
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [47, 0, -1, 1], [0, 31, 1, -1], [47, 31, -1, -1]] as const) {
    b.hline(Math.min(x, x + sx * 4), Math.max(x, x + sx * 4), y, C.white);
    b.vline(x, Math.min(y, y + sy * 4), Math.max(y, y + sy * 4), C.white);
  }
  return b;
}

// ------------------------------------------------------------------ backgrounds (960x540)
const W = DIVE_MAP.w, H = DIVE_MAP.h, BD = DIVE_BOUNDS;

function realBg(): PixBuf {
  const b = new PixBuf(W, H).fill(C.ink);
  // back wall band above the floor: dark panels with neon strips, posters and monitors
  b.rect(0, 0, W, BD.y, C.night);
  for (let x = 0; x < W; x += 48) { b.rect(x, 4, 46, BD.y - 10, C.navy); b.hline(x, x + 45, 4, C.indigo); }
  b.hline(0, W - 1, BD.y - 6, C.magenta); b.hline(0, W - 1, BD.y - 5, C.grape);
  for (let x = 40; x < W - 40; x += 120) {
    const c = (x / 120) % 2 ? C.cyan : C.magenta;
    b.rect(x, 12, 30, 22, C.ink); b.strokeRect(x, 12, 30, 22, c);
    for (let i = 0; i < 3; i++) b.hline(x + 4, x + 18 + i * 3, 17 + i * 5, i % 2 ? C.teal : c);
  }
  // floor: dark tiles, worn, cables
  for (let y = BD.y; y < BD.y + BD.h; y += 32) for (let x = BD.x; x < BD.x + BD.w; x += 32) {
    const alt = ((x - BD.x) / 32 + (y - BD.y) / 32) % 2;
    b.rect(x, y, 32, 32, alt ? C.midnight04 : C.midnight06);
    b.hline(x, x + 31, y, C.midnight08);
    b.vline(x, y, y + 31, C.midnight08);
    if (hash2(x, y, 3) < 0.25) b.rect(x + 6 + Math.floor(hash2(x, y, 4) * 14), y + 8 + Math.floor(hash2(x, y, 5) * 14), 6, 2, C.midnight03);
  }
  for (let y = BD.y; y < BD.y + BD.h; y++) for (let x = BD.x; x < BD.x + BD.w; x++) {
    if (hash2(x, y, 9) < 0.012) b.set(x, y, C.midnight10);
  }
  // floor cables between pods and racks
  const cable = (pts: Pt[], c: number) => { for (let i = 1; i < pts.length; i++) { b.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c); b.line(pts[i - 1][0], pts[i - 1][1] + 1, pts[i][0], pts[i][1] + 1, C.ink); } };
  cable([[PODS[0].x + 14, PODS[0].y + 4], [200, 150], [RACKS[0].x - 6, RACKS[0].y]], C.grape);
  cable([[PODS[1].x - 14, PODS[1].y + 4], [760, 150], [RACKS[1].x + 6, RACKS[1].y]], C.teal);
  cable([[PODS[2].x + 14, PODS[2].y], [200, 440], [RACKS[0].x - 4, RACKS[0].y + 4]], C.teal);
  cable([[PODS[3].x - 14, PODS[3].y], [760, 440], [RACKS[1].x + 4, RACKS[1].y + 4]], C.grape);
  cable([[WREN_POD.x + 14, WREN_POD.y + 2], [560, 120], [RACKS[1].x - 4, RACKS[1].y - 4]], C.magenta);
  // booths: sofa backs + tables with a glowing monitor
  for (const r of BOOTHS) {
    b.rect(r.x, r.y - 14, r.w, 16, C.plum); b.hline(r.x, r.x + r.w - 1, r.y - 14, C.grape);
    for (let x = r.x + 6; x < r.x + r.w - 4; x += 18) b.vline(x, r.y - 12, r.y + 1, C.grape);
    b.rect(r.x, r.y + 2, r.w, r.h - 2, C.night); b.hline(r.x, r.x + r.w - 1, r.y + 2, C.slate);
    for (let x = r.x + 10; x < r.x + r.w - 20; x += 36) {
      b.rect(x, r.y - 6, 16, 10, C.ink); b.rect(x + 1, r.y - 5, 14, 7, C.abyss);
      b.hline(x + 2, x + 9, r.y - 3, C.cyan); b.hline(x + 2, x + 6, r.y - 1, C.teal);
      b.rect(x + 7, r.y + 4, 2, 3, C.slate);
    }
    b.rect(r.x, r.y + r.h, r.w, 4, C.ink);
    b.hline(r.x, r.x + r.w - 1, r.y + r.h - 1, C.magenta);
  }
  // bar counter: dark wood top, amber under-light, bottles
  {
    const r = BAR;
    b.rect(r.x, r.y - 6, r.w, 10, C.umber); b.hline(r.x, r.x + r.w - 1, r.y - 6, C.rust);
    b.rect(r.x, r.y + 4, r.w, r.h - 4, C.night);
    b.hline(r.x, r.x + r.w - 1, r.y + r.h - 1, C.sodium);
    for (let x = r.x + 8; x < r.x + r.w - 8; x += 14) {
      const c = [C.acid, C.cyan, C.magenta, C.amber][(x / 14) % 4 | 0];
      b.rect(x, r.y - 14, 3, 8, C.ink); b.vline(x + 1, r.y - 13, r.y - 8, c);
    }
    b.rect(r.x, r.y + r.h, r.w, 4, C.ink);
  }
  // pod pads and Wren's pod pad
  for (const p of [...PODS, WREN_POD]) {
    b.ellipse(p.x, p.y + 2, 18, 7, C.midnight09);
    b.ellipse(p.x, p.y + 2, 15, 5, C.midnight05);
  }
  // port sockets are a net thing; in reality the floor shows faint maintenance hatches there
  for (const s of PORT_SLOTS) { b.strokeRect(s.x - 8, s.y - 4, 16, 8, C.midnight10); }
  // map frame
  b.rect(BD.x - 4, BD.y, 4, BD.h, C.navy); b.rect(BD.x + BD.w, BD.y, 4, BD.h, C.navy);
  b.rect(BD.x - 4, BD.y + BD.h, BD.w + 8, 4, C.navy);
  b.vline(BD.x - 1, BD.y, BD.y + BD.h, C.magenta); b.vline(BD.x + BD.w, BD.y, BD.y + BD.h, C.magenta);
  return b;
}

function netWall(b: PixBuf, r: { x: number; y: number; w: number; h: number }, solid: boolean): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const hatch = (x + y) % 6 === 0;
    if (solid) b.set(x, y, hatch ? C.teal : C.abyss);
    else if (hatch) b.set(x, y, C.teal);
  }
  b.strokeRect(r.x, r.y, r.w, r.h, C.cyan);
  b.hline(r.x, r.x + r.w - 1, r.y, C.ice);
  // node studs at the ends
  for (const [x, y] of [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]]) {
    b.rect(x - 1, y - 1, 3, 3, C.ice);
  }
}

function netBg(ghost: boolean): PixBuf {
  const b = new PixBuf(W, H);
  if (!ghost) {
    b.fill(C.midnight01);
    for (let y = 0; y < H; y += 4) b.hline(0, W - 1, y, C.ink);
    // grid
    for (let x = BD.x; x <= BD.x + BD.w; x += 32) for (let y = BD.y; y < BD.y + BD.h; y++) if (y % 2 === 0) b.set(x, y, (x - BD.x) % 128 === 0 ? C.teal : C.abyss);
    for (let y = BD.y; y <= BD.y + BD.h; y += 32) for (let x = BD.x; x < BD.x + BD.w; x++) if (x % 2 === 0) b.set(x, y, (y - BD.y) % 128 === 0 ? C.teal : C.abyss);
    // data specks
    for (let i = 0; i < 900; i++) {
      const x = BD.x + Math.floor(hash2(i, 1, 21) * BD.w), y = BD.y + Math.floor(hash2(i, 2, 21) * BD.h);
      b.set(x, y, hash2(i, 3, 21) < 0.2 ? C.acid : C.teal);
    }
    // outside the bounds: dense dark code columns
    for (let x = 0; x < W; x += 6) for (let y = 0; y < H; y += 5) {
      if (x >= BD.x && x < BD.x + BD.w && y >= BD.y && y < BD.y + BD.h) continue;
      if (hash2(x, y, 7) < 0.4) b.hline(x, x + 2, y, hash2(x, y, 8) < 0.1 ? C.teal : C.abyss);
    }
    // node pads, port sockets
    for (const p of PODS) { b.ellipse(p.x, p.y + 2, 18, 7, C.moss); b.ellipse(p.x, p.y + 2, 16, 5, C.midnight01); }
    for (const s of PORT_SLOTS) {
      for (let a = 0; a < 6; a++) {
        const a0 = (a * Math.PI) / 3, a1 = ((a + 1) * Math.PI) / 3;
        b.line(s.x + Math.cos(a0) * 14, s.y + Math.sin(a0) * 6, s.x + Math.cos(a1) * 14, s.y + Math.sin(a1) * 6, C.abyss);
      }
    }
  }
  // the bounds frame
  b.strokeRect(BD.x - 1, BD.y - 1, BD.w + 2, BD.h + 2, ghost ? C.teal : C.cyan);
  for (const r of NET_WALLS) netWall(b, r, !ghost);
  // stream beds (the arrows are drawn at runtime)
  for (const s of STREAMS) {
    const r = s.r;
    b.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, ghost ? C.abyss : C.teal);
    if (!ghost) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if ((x * 3 + y * 5) % 11 === 0) b.set(x, y, C.abyss);
  }
  return b;
}

/** Furniture silhouettes only, for drawing reality faintly over the net. */
function realGhost(): PixBuf {
  const b = new PixBuf(W, H);
  for (const r of BOOTHS) { b.rect(r.x, r.y - 14, r.w, r.h + 14, C.grape); b.strokeRect(r.x, r.y - 14, r.w, r.h + 14, C.orchid); }
  b.rect(BAR.x, BAR.y - 6, BAR.w, BAR.h + 6, C.rust); b.strokeRect(BAR.x, BAR.y - 6, BAR.w, BAR.h + 6, C.sodium);
  for (const r of RACKS) { b.rect(r.x - 11, r.y - 34, 22, 36, C.slate); b.strokeRect(r.x - 11, r.y - 34, 22, 36, C.fog); }
  return b;
}

export function buildWrenArt(): SheetSpec[] {
  const frames = (Object.keys(WPOSES) as WFrame[]).map((name) => ({ name, buf: wrenFrame(WPOSES[name]) }));
  return [
    { key: 'wren', group: 'Bosses', frameW: 32, frameH: 48, frames },
    { key: 'wren_net', group: 'Bosses', frameW: 32, frameH: 48, frames: [...frames.map((f) => ({ name: f.name, buf: netify(f.buf) })), { name: 'whip', buf: whipFrame() }] },
    { key: 'dive_dev', group: 'Devices', frameW: 32, frameH: 48, frames: [
      { name: 'pod_empty', buf: pod('empty', false) }, { name: 'pod_full', buf: pod('full', false) }, { name: 'pod_jack', buf: pod('jack', false) },
      { name: 'wpod_empty', buf: pod('empty', true) }, { name: 'wpod_full', buf: pod('full', true) },
      { name: 'node', buf: node() }, { name: 'port', buf: port() }, { name: 'rack', buf: rack() },
    ] },
    { key: 'dive_fx', group: 'Devices', frameW: 16, frameH: 16, frames: (['r', 'l', 'u', 'd'] as const).flatMap((d) => [
      { name: `arrow_${d}`, buf: arrow(d, false) }, { name: `arrow_red_${d}`, buf: arrow(d, true) }]) },
    { key: 'dive_win', group: 'Devices', frameW: 48, frameH: 32, frames: [{ name: 'win_a', buf: arWindow(false) }, { name: 'win_b', buf: arWindow(true) }] },
    { key: 'bg_divecafe', group: 'Arenas', frameW: W, frameH: H, columns: 2, frames: [
      { name: 'real', buf: realBg() }, { name: 'net', buf: netBg(false) },
      { name: 'net_ghost', buf: netBg(true) }, { name: 'real_ghost', buf: realGhost() },
    ] },
  ];
}


