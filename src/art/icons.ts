/**
 * Cyberware, weapon-mod and reward icons: one sheet `ico`, 24x24 frames, transparent background,
 * 1px ink outline. Frame names are the ids in `src/game/loadout.ts` (CyberId, ModId) plus
 * `maxhp` and `loan`.
 *
 * Each icon shows the mechanic, not just the body part. Colour code by slot: the part itself is
 * chrome/neutral, the mechanic is drawn in the slot colour (legs cyan, arm amber, core magenta/red,
 * head acid green). Weapon mods use the weapon's colours (riveter steel + amber, arc cyan,
 * breacher rust/fire, blade ice/white). Light comes from the upper left.
 */
import { C } from './palette';
import { Mask, PixBuf, shadeInto, type Pt } from './core/pixbuf';
import type { SheetSpec } from './core/sheet';

export const ICON = 24;
const S = ICON;

const CHROME = [C.ink, C.slate, C.steel, C.fog, C.pale, C.white] as const;
const DARK = [C.ink, C.night, C.navy, C.indigo, C.slate, C.steel] as const;
const CYAN = [C.ink, C.abyss, C.teal, C.cyan, C.ice] as const;
const AMBER = [C.umber, C.rust, C.orange, C.sodium, C.amber] as const;
const RED = [C.ink, C.maroon, C.red, C.rose] as const;
const MAG = [C.ink, C.plum, C.grape, C.magenta, C.rose] as const;
const GREEN = [C.ink, C.moss, C.lime, C.acid] as const;
const PAPER = [C.slate, C.steel, C.fog, C.pale, C.white] as const;

/** Cel-shade a shape (light from the upper left; dark seam where it overlaps earlier shapes). */
function sh(b: PixBuf, ramp: readonly number[], base: number, draw: (m: PixBuf) => void, inner = true): Mask {
  const m = new Mask(S, S).draw(draw);
  shadeInto(b, m, { ramp, base, light: [-1, -1], innerLine: inner });
  return m;
}

function icon(draw: (b: PixBuf) => void, post?: (b: PixBuf) => void): PixBuf {
  const b = new PixBuf(S, S);
  draw(b);
  b.outline(C.ink);
  post?.(b);
  return b;
}

/** Pixel line helper that accepts points. */
const ln = (b: PixBuf, a: Pt, c: Pt, col: number) => b.line(a[0], a[1], c[0], c[1], col);

// ------------------------------------------------------------------ legs (chrome leg, cyan mechanic)

/** Side-view chrome mech leg facing right: thigh, knee joint with a cyan light, shin, boot. */
function leg(b: PixBuf, hip: Pt, knee: Pt, ankle: Pt, boot: Pt[]): void {
  sh(b, CHROME, 3, (m) => m.capsule(hip[0], hip[1], knee[0], knee[1], 3.3, 1));
  sh(b, CHROME, 3, (m) => m.capsule(knee[0], knee[1], ankle[0], ankle[1], 2.8, 1));
  sh(b, DARK, 4, (m) => m.poly(boot, 1));
  sh(b, DARK, 3, (m) => m.circle(knee[0], knee[1], 2.2, 1));
  b.set(Math.round(knee[0]), Math.round(knee[1]), C.cyan);
}

const STAND_BOOT: Pt[] = [[7, 16], [13, 16], [19, 18.5], [19.5, 21.5], [7, 21.5]];

function legsStock(): PixBuf {
  return icon((b) => {
    leg(b, [10, 2], [14, 9.5], [11, 16.5], STAND_BOOT);
    b.line(13, 4, 15, 8, C.white);
    // plain dash: short cyan streaks behind the leg
    for (const [y, x0, x1] of [[8, 1, 5], [12, 2, 7], [16, 1, 4]] as const) { b.hline(x0, x1, y, C.teal); b.set(x1, y, C.cyan); }
  });
}

function legsLeap(): PixBuf {
  return icon((b) => {
    // jump arc with an arrowhead, from the foot up and over to the right
    for (let t = 0; t <= 0.9; t += 0.02) {
      const x = 8 + t * 14, y = 18 - Math.sin(t * Math.PI) * 16;
      b.set(Math.round(x), Math.round(y), C.cyan); b.set(Math.round(x), Math.round(y) + 1, C.teal);
    }
    b.line(21, 13, 22, 17, C.ice); b.line(19, 15, 22, 17, C.ice);
    // crouched piston leg on the left: knee folded forward, shin is a cylinder with a lit rod
    sh(b, CHROME, 3, (m) => m.capsule(3, 6, 9, 11, 3.2, 1));
    sh(b, DARK, 4, (m) => m.capsule(9, 11, 5, 17, 2.9, 1));
    sh(b, CHROME, 4, (m) => m.capsule(8, 12, 6, 15.5, 1, 1), false);
    b.set(7, 13, C.cyan); b.set(6, 15, C.cyan);
    sh(b, DARK, 3, (m) => m.circle(9, 11, 2.2, 1));
    b.set(9, 11, C.cyan);
    sh(b, DARK, 4, (m) => m.poly([[1.5, 16], [7, 16], [12, 18.5], [12.5, 21.5], [1.5, 21.5]], 1));
  });
}

function legsBlink(): PixBuf {
  return icon((b) => {
    // ghost afterimage (flat teal, lit edge) behind and to the left
    const ghost = new PixBuf(S, S);
    ghost.capsule(4, 2, 8, 9.5, 3.3, 1); ghost.capsule(8, 9.5, 5, 16.5, 2.8, 1);
    ghost.poly([[1, 16], [7, 16], [13, 18.5], [13.5, 21.5], [1, 21.5]], 1);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (ghost.get(x, y)) b.set(x, y, y % 2 ? C.teal : C.abyss);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (ghost.get(x, y) && (!ghost.get(x - 1, y) || !ghost.get(x, y - 1))) b.set(x, y, C.cyan);
    leg(b, [13, 2], [17, 9.5], [14, 16.5], [[10, 16], [16, 16], [21, 18.5], [21.5, 21.5], [10, 21.5]]);
    b.line(16, 4, 18, 8, C.white);
    b.set(11, 3, C.ice); b.set(10, 2, C.cyan);
  });
}

function legsSlide(): PixBuf {
  return icon((b) => {
    // speed lines behind
    for (const [y, x0, x1] of [[5, 1, 6], [9, 2, 8], [13, 1, 5]] as const) { b.hline(x0, x1, y, C.teal); b.set(x1, y, C.cyan); }
    // ground line under the slide
    b.hline(1, 22, 21, C.teal);
    // leg thrown forward low: thigh slants down, shin almost flat, sole facing forward
    sh(b, CHROME, 3, (m) => m.capsule(6, 10, 12, 15, 3.3, 1));
    sh(b, CHROME, 3, (m) => m.capsule(12, 15, 17, 16, 2.8, 1));
    sh(b, DARK, 4, (m) => m.poly([[16, 10.5], [20, 11], [21.5, 19.5], [16.5, 19.5]], 1));
    sh(b, DARK, 3, (m) => m.circle(12, 15, 2.2, 1));
    b.set(12, 15, C.cyan);
    b.line(8, 9, 11, 12, C.white);
    // sparks off the sole
    b.set(14, 20, C.ice); b.set(11, 19, C.cyan); b.set(9, 20, C.cyan);
  });
}

// ------------------------------------------------------------------ arm (chrome forearm, amber mechanic)

function armShove(): PixBuf {
  return icon((b) => {
    // shock cone in front of the palm (two amber wave fronts)
    for (const [r, c] of [[5, C.amber], [8.5, C.orange]] as const) {
      for (let a = -0.85; a <= 0.85; a += 0.04) b.set(Math.round(14 + Math.cos(a) * r), Math.round(11 + Math.sin(a) * r * 1.25), c);
    }
    // forearm from the lower left, open palm facing right with fingers up
    sh(b, CHROME, 3, (m) => m.capsule(2, 21, 8, 16, 3.2, 1));
    sh(b, CHROME, 3, (m) => { m.rect(7, 8, 6, 9, 1); m.capsule(7, 14, 4, 10, 1.4, 1); });
    for (let k = 0; k < 4; k++) sh(b, CHROME, 3, (m) => m.capsule(7.5 + k * 1.6, 8, 7.5 + k * 1.6, 3 + Math.abs(k - 1.5), 0.9, 1));
    b.vline(12, 9, 16, C.steel);
    b.set(4, 18, C.amber); b.set(5, 17, C.sodium);
    // a soft bullet breaking on the wave
    b.set(22, 4, C.rose); b.set(21, 5, C.magenta); b.set(22, 18, C.rose);
  });
}

function armGrapple(): PixBuf {
  return icon((b) => {
    // cable from the wrist launcher curving up to the claw
    for (let t = 0; t <= 1; t += 0.03) {
      const x = 5 + t * 9, y = 18 - t * 8 - Math.sin(t * Math.PI) * 4;
      b.set(Math.round(x), Math.round(y), C.night); b.set(Math.round(x), Math.round(y) + 1, C.orange);
    }
    // launcher on the forearm
    sh(b, CHROME, 3, (m) => m.capsule(1, 22, 5, 18, 2.8, 1));
    sh(b, DARK, 4, (m) => m.rect(3, 16, 5, 4, 1));
    b.hline(4, 6, 17, C.sodium);
    // claw: hub + three thick hooked prongs opening up-right
    sh(b, CHROME, 3, (m) => { m.capsule(15, 9, 20, 2, 1.5, 1); m.capsule(20, 2, 22, 4, 1.1, 1); });
    sh(b, CHROME, 3, (m) => { m.capsule(15, 9, 22, 11, 1.5, 1); m.capsule(22, 11, 21, 14, 1.1, 1); });
    sh(b, CHROME, 3, (m) => { m.capsule(15, 9, 14, 2, 1.4, 1); m.capsule(14, 2, 16, 1, 1, 1); });
    sh(b, DARK, 4, (m) => m.circle(15, 9, 3, 1));
    b.set(15, 9, C.amber); b.set(14, 8, C.sodium);
    b.set(22, 4, C.amber); b.set(21, 14, C.amber); b.set(16, 1, C.amber);
  });
}

function armFist(): PixBuf {
  return icon((b) => {
    // impact lines
    for (const [a, r0, r1] of [[-0.8, 8, 11], [0, 9, 12], [0.8, 8, 11]] as const) ln(b, [14 + Math.cos(a) * r0, 11 + Math.sin(a) * r0], [14 + Math.cos(a) * r1, 11 + Math.sin(a) * r1], C.sodium);
    // hydraulic forearm with pistons
    sh(b, DARK, 4, (m) => m.capsule(1, 18, 7, 14, 3.5, 1));
    sh(b, CHROME, 4, (m) => { m.capsule(2, 21, 8, 17, 1, 1); m.capsule(1, 15, 7, 11, 1, 1); }, false);
    b.set(4, 19, C.amber); b.set(3, 13, C.amber);
    // big fist: knuckle block with four fingers, thumb across
    sh(b, CHROME, 3, (m) => m.poly([[7, 6], [17, 5], [19, 8], [19, 17], [16, 19], [7, 18]], 1));
    for (const y of [8, 11, 14]) b.hline(13, 18, y, C.steel);
    sh(b, CHROME, 4, (m) => m.capsule(8, 15, 13, 15, 1.8, 1));
    b.vline(13, 6, 17, C.slate);
    b.set(15, 6, C.white); b.set(16, 6, C.white); b.set(8, 7, C.white);
  });
}

function armJack(): PixBuf {
  return icon((b) => {
    // forearm diagonal with a panel line
    sh(b, CHROME, 3, (m) => m.capsule(1, 22, 10, 13, 3.6, 1));
    b.line(3, 18, 8, 13, C.steel);
    // wrist port glowing amber
    sh(b, DARK, 3, (m) => m.circle(10, 13, 3, 1));
    b.set(10, 13, C.amber); b.set(9, 13, C.sodium); b.set(10, 12, C.sodium);
    // cable to a data plug
    for (let t = 0; t <= 1; t += 0.04) b.set(Math.round(12 + t * 4), Math.round(11 - t * 3 - Math.sin(t * Math.PI) * 2), C.orange);
    sh(b, AMBER, 3, (m) => m.poly([[15, 4], [20, 2], [22, 7], [17, 9]], 1), false);
    b.line(20, 2, 22, 0, C.sodium); b.line(22, 4, 23, 3, C.sodium);
    b.set(17, 4, C.white);
    // data bits
    for (const [x, y] of [[13, 3], [11, 6], [21, 12], [18, 13]] as Pt[]) b.set(x, y, C.sodium);
  });
}

// ------------------------------------------------------------------ core (magenta / red)

function socket(round: boolean): PixBuf {
  return icon((b) => {
    if (round) {
      sh(b, DARK, 2, (m) => m.circle(12, 12, 9, 1));
      b.ring(12, 12, 6.5, C.night, 2);
      b.circle(12, 12, 4.5, C.ink);
      for (const a of [0, 1.57, 3.14, 4.71]) b.set(Math.round(12 + Math.cos(a) * 8), Math.round(12 + Math.sin(a) * 8), C.slate);
    } else {
      sh(b, DARK, 2, (m) => m.rect(3, 4, 18, 16, 1));
      b.rect(6, 7, 12, 10, C.ink);
      for (let x = 7; x <= 16; x += 3) { b.set(x, 7, C.navy); b.set(x, 16, C.navy); }
      b.set(4, 5, C.slate); b.set(19, 5, C.slate);
    }
  });
}

function hexPts(cx: number, cy: number, r: number): Pt[] {
  return [0, 1, 2, 3, 4, 5].map((k) => [cx + Math.cos((k / 6) * Math.PI * 2 + Math.PI / 6) * r, cy + Math.sin((k / 6) * Math.PI * 2 + Math.PI / 6) * r] as Pt);
}

function corePlating(): PixBuf {
  return icon((b) => {
    sh(b, MAG, 3, (m) => m.poly(hexPts(12, 12, 10.5), 1), false);
    sh(b, CHROME, 3, (m) => m.poly(hexPts(12, 12, 8), 1), false);
    // inner hex cells + rivets
    b.line(12, 6, 12, 18, C.steel); b.line(7, 9, 17, 15, C.steel); b.line(17, 9, 7, 15, C.steel);
    for (const [x, y] of hexPts(12, 12, 6)) b.set(Math.round(x), Math.round(y), C.white);
    b.set(8, 7, C.white); b.set(9, 6, C.white);
    // regen pip
    b.rect(11, 11, 2, 2, C.rose);
  });
}

function coreCapacitor(): PixBuf {
  return icon((b) => {
    // spine: stacked vertebrae with discs
    for (let k = 0; k < 5; k++) {
      const y = 3 + k * 4;
      sh(b, CHROME, 3, (m) => { m.rect(9, y, 6, 3, 1); m.rect(7, y + 1, 10, 1, 1); });
      b.hline(10, 13, y + 3, C.magenta);
    }
    // EMP sparks arcing out on both sides
    const zig = (pts: Pt[]) => { for (let i = 1; i < pts.length; i++) ln(b, pts[i - 1], pts[i], C.magenta); b.set(pts[pts.length - 1][0], pts[pts.length - 1][1], C.white); };
    zig([[6, 8], [4, 6], [5, 4], [2, 2]]);
    zig([[18, 13], [20, 11], [19, 9], [22, 7]]);
    zig([[6, 17], [3, 18], [4, 20], [1, 21]]);
    b.set(20, 18, C.rose); b.set(21, 19, C.magenta);
  });
}

/** Heart shape (two circles + a point). */
function heart(m: PixBuf, cx: number, cy: number, r: number): void {
  m.circle(cx - r * 0.55, cy - r * 0.2, r * 0.62, 1);
  m.circle(cx + r * 0.55, cy - r * 0.2, r * 0.62, 1);
  m.poly([[cx - r * 1.12, cy], [cx + r * 1.12, cy], [cx, cy + r * 1.05]], 1);
}

function coreDebt(): PixBuf {
  return icon((b) => {
    // heart-shaped chip: pins on the sides, circuit traces
    for (const y of [7, 10, 13]) { b.hline(1, 4, y, C.sodium); b.hline(18, 21, y, C.sodium); }
    sh(b, RED, 2, (m) => heart(m, 11, 10, 8.5), false);
    b.line(7, 7, 10, 10, C.maroon); b.line(10, 10, 10, 15, C.maroon); b.line(15, 7, 12, 10, C.maroon);
    b.rect(9, 9, 3, 3, C.ink); b.set(10, 10, C.rose);
    b.set(6, 5, C.rose); b.set(7, 5, C.rose);
    // gold coin over the lower right
    sh(b, AMBER, 3, (m) => m.circle(17, 17, 5, 1), false);
    b.ring(17, 17, 3.2, C.orange, 1);
    b.vline(17, 15, 19, C.rust); b.set(15, 15, C.white);
  });
}

function coreOverclock(): PixBuf {
  return icon((b) => {
    sh(b, MAG, 3, (m) => heart(m, 10, 10, 8), false);
    b.set(6, 5, C.white); b.set(5, 6, C.rose);
    // speed arrow through the heart, with motion lines
    b.hline(1, 4, 16, C.rose); b.hline(2, 5, 19, C.rose);
    sh(b, PAPER, 3, (m) => m.poly([[6, 10], [15, 10], [15, 7], [22, 12], [15, 17], [15, 14], [6, 14]], 1), false);
    b.hline(7, 14, 11, C.white);
  });
}

// ------------------------------------------------------------------ head (acid green)

function headOptics(): PixBuf {
  return icon((b) => {
    // visor band with a lens
    sh(b, DARK, 4, (m) => m.poly([[1, 8], [23, 8], [22, 16], [2, 16]], 1));
    sh(b, GREEN, 2, (m) => m.poly([[4, 10], [20, 10], [19, 14], [5, 14]], 1), false);
    b.hline(5, 18, 10, C.acid);
    // crosshair reticle over the lens
    b.ring(12, 12, 6, C.acid, 1);
    b.vline(12, 3, 7, C.acid); b.vline(12, 17, 21, C.acid); b.hline(3, 5, 12, C.white); b.hline(19, 21, 12, C.white);
    b.set(12, 12, C.white);
  });
}

function headReflex(): PixBuf {
  return icon((b) => {
    // eye
    sh(b, PAPER, 3, (m) => m.ellipse(9, 12, 8, 5.5, 1), false);
    b.circle(9, 12, 3.6, C.moss); b.circle(9, 12, 2.6, C.acid); b.circle(9, 12, 1.2, C.ink); b.set(8, 11, C.white);
    b.line(1, 12, 4, 7, C.ink); b.line(17, 12, 14, 7, C.ink);
    // clock face over the corner: slowed time
    sh(b, GREEN, 2, (m) => m.circle(17, 16, 5.5, 1), false);
    b.circle(17, 16, 4, C.night);
    b.vline(17, 13, 16, C.acid); b.hline(17, 19, 16, C.acid); b.set(17, 16, C.white);
    for (const [x, y] of [[17, 12], [21, 16], [17, 20], [13, 16]] as Pt[]) b.set(x, y, C.lime);
  });
}

function headBallistic(): PixBuf {
  return icon((b) => {
    // eye on the left
    sh(b, PAPER, 3, (m) => m.ellipse(7, 16, 6.5, 4.6, 1), false);
    b.circle(7, 16, 3, C.moss); b.circle(7, 16, 2.2, C.acid); b.circle(7, 16, 1, C.ink); b.set(6, 15, C.white);
    // curved homing trail to a bullet at the upper right
    for (let t = 0; t <= 1; t += 0.03) {
      const x = 10 + t * 9, y = 12 - t * 7 + Math.sin(t * Math.PI) * -4;
      if (Math.floor(t * 12) % 3 !== 2) b.set(Math.round(x), Math.round(y), t > 0.55 ? C.acid : C.lime);
    }
    sh(b, AMBER, 3, (m) => m.capsule(18.5, 4.5, 21.5, 2.5, 1.8, 1), false);
    b.set(22, 2, C.white);
    // target tick on the trail end
    b.set(21, 7, C.acid); b.set(22, 8, C.acid);
  });
}

// ------------------------------------------------------------------ weapon mods

function nail(b: PixBuf, a: Pt, c: Pt): void {
  sh(b, CHROME, 3, (m) => { m.capsule(a[0], a[1], c[0], c[1], 1.1, 1); m.capsule(a[0] - 1, a[1] + 1, a[0] + 1, a[1] - 1, 1.6, 1); });
}

function riveterBarbed(): PixBuf {
  return icon((b) => {
    // big nail, point down-right, with amber barbs hooking back
    sh(b, CHROME, 3, (m) => { m.capsule(4, 4, 18, 18, 1.8, 1); m.capsule(2, 6, 6, 2, 2.2, 1); m.poly([[16, 16], [21, 21], [19, 15]], 1); });
    for (const k of [7, 11, 15]) {
      sh(b, AMBER, 3, (m) => { m.poly([[k + 0.5, k + 0.5], [k - 4, k + 1.5], [k - 1, k - 1]], 1); m.poly([[k + 0.5, k + 0.5], [k + 1.5, k - 4], [k - 1, k - 1]], 1); }, false);
    }
    // bleed ticks
    b.set(19, 22, C.red); b.set(21, 22, C.red); b.set(22, 20, C.rose);
  });
}

function riveterMagnet(): PixBuf {
  return icon((b) => {
    // horseshoe magnet on the right
    sh(b, RED, 2, (m) => { m.ring(15, 11, 6.5, 1, 4); }, false);
    b.rect(8, 4, 8, 15, 0);
    sh(b, RED, 2, (m) => { m.rect(13, 4, 3, 4, 1); m.rect(13, 15, 3, 4, 1); m.ring(15, 11, 6.5, 1, 4); m.rect(8, 4, 8, 15, 0); }, false);
    b.rect(13, 4, 3, 4, C.red); b.rect(13, 15, 3, 4, C.red);
    b.rect(10, 4, 3, 4, C.pale); b.rect(10, 15, 3, 4, C.pale);
    // nails flying in from the left with amber motion lines
    nail(b, [2, 9], [7, 10]);
    nail(b, [2, 15], [7, 14]);
    b.hline(1, 4, 12, C.sodium); b.hline(3, 6, 6, C.sodium); b.hline(2, 5, 18, C.sodium);
  });
}

function arcMine(): PixBuf {
  return icon((b) => {
    // pulse rings
    b.ring(12, 14, 10.5, C.teal, 1);
    // mine disc with spikes
    sh(b, DARK, 4, (m) => { m.ellipse(12, 15, 8, 5, 1); for (const x of [5, 12, 19]) m.capsule(x, 15, x, 9, 1, 1); });
    b.set(5, 8, C.ice); b.set(12, 8, C.ice); b.set(19, 8, C.ice);
    sh(b, CYAN, 3, (m) => m.circle(12, 15, 3.2, 1), false);
    b.set(11, 14, C.white);
    // standby blink
    b.hline(9, 15, 19, C.cyan);
  });
}

function arcWeb(): PixBuf {
  return icon((b) => {
    const nodes: Pt[] = [[4, 5], [19, 4], [12, 12], [4, 19], [20, 19]];
    const bolt = (a: Pt, c: Pt) => {
      const mx = (a[0] + c[0]) / 2 + (c[1] - a[1]) * 0.15, my = (a[1] + c[1]) / 2 - (c[0] - a[0]) * 0.15;
      ln(b, a, [mx, my], C.cyan); ln(b, [mx, my], c, C.cyan);
    };
    for (const [i, j] of [[0, 2], [1, 2], [3, 2], [4, 2], [0, 1], [3, 4], [0, 3], [1, 4]] as const) bolt(nodes[i], nodes[j]);
    for (const [x, y] of nodes) { sh(b, CHROME, 3, (m) => m.circle(x, y, 2.2, 1), false); b.set(x, y, C.ice); }
    b.circle(12, 12, 1.5, C.white);
  });
}

function riveterBlast(): PixBuf {
  return icon((b) => {
    // Four embedded nails around an explosive core.
    sh(b, AMBER, 2, (m) => m.poly([[12, 2], [14, 7], [21, 5], [18, 11], [22, 16], [15, 16], [12, 22], [9, 16], [2, 17], [6, 11], [3, 5], [9, 7]], 1), false);
    for (const [a, c] of [
      [[4, 4], [10, 10]], [[20, 4], [14, 10]],
      [[4, 20], [10, 14]], [[20, 20], [14, 14]],
    ] as [Pt, Pt][]) nail(b, a, c);
    sh(b, RED, 2, (m) => m.circle(12, 12, 3.2, 1), false);
    b.set(11, 11, C.amber); b.set(12, 11, C.white);
  });
}

function arcAftershock(): PixBuf {
  return icon((b) => {
    // A spent orb above concentric floor pulses, with a descending bolt.
    b.ring(12, 16, 10, C.teal, 1);
    b.ring(12, 16, 6, C.cyan, 1);
    b.ellipse(12, 16, 3, 2, C.abyss);
    sh(b, CYAN, 2, (m) => m.circle(12, 5, 3.2, 1), false);
    b.set(11, 4, C.white);
    b.line(13, 8, 10, 12, C.ice);
    b.line(10, 12, 14, 12, C.ice);
    b.line(14, 12, 11, 17, C.white);
    b.set(3, 15, C.ice); b.set(20, 17, C.ice);
  });
}

function shell(b: PixBuf, x: number, y: number, angle: number): void {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  sh(b, RED, 2, (m) => m.capsule(x, y, x + dx * 9, y + dy * 9, 2.6, 1), false);
  sh(b, AMBER, 3, (m) => m.capsule(x - dx * 1, y - dy * 1, x + dx * 2, y + dy * 2, 2.9, 1), false);
}

function breacherDragon(): PixBuf {
  return icon((b) => {
    // flame burst out of the shell mouth
    const flame = new PixBuf(S, S);
    flame.ellipse(15, 9, 7, 6, 1); flame.poly([[10, 11], [19, 2], [23, 6], [21, 14]], 1); flame.ellipse(18, 5, 4, 3, 1);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!flame.get(x, y)) continue;
      const d = Math.hypot(x - 12, y - 12);
      b.set(x, y, d < 5 ? C.amber : d < 8 ? C.sodium : d < 10 ? C.orange : C.rust);
    }
    b.set(17, 3, C.white); b.set(14, 7, C.white);
    shell(b, 3, 20, -Math.PI / 4);
  });
}

function breacherRecoil(): PixBuf {
  return icon((b) => {
    // muzzle blast at the right
    for (const [x, y, c] of [[20, 7, C.amber], [21, 8, C.sodium], [22, 6, C.orange], [21, 5, C.sodium], [19, 9, C.orange]] as const) b.set(x, y, c);
    sh(b, DARK, 4, (m) => m.poly([[8, 6], [19, 6], [19, 9], [8, 9]], 1));
    sh(b, AMBER, 2, (m) => m.poly([[4, 8], [9, 7], [10, 11], [5, 12]], 1));
    // big recoil arrow pointing back (down-left)
    sh(b, PAPER, 3, (m) => m.poly([[20, 13], [12, 13], [12, 10], [3, 16], [12, 22], [12, 19], [20, 19]], 1), false);
    b.hline(13, 19, 14, C.white);
    b.set(22, 15, C.orange); b.set(22, 18, C.orange);
  });
}

function breacherOverload(): PixBuf {
  return icon((b) => {
    // An overfilled shell with a dense fifteen-pellet fan.
    shell(b, 4, 20, -Math.PI / 4);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const x = 10 + col * 2, y = 3 + row * 3;
        b.set(x, y, row === 0 ? C.amber : C.sodium);
        b.set(x, y + 1, C.rust);
      }
    }
    b.line(4, 9, 2, 5, C.orange);
    b.line(15, 18, 21, 15, C.orange);
    b.line(16, 21, 22, 20, C.sodium);
    b.set(7, 2, C.white);
  });
}

function bladeShape(b: PixBuf, a: Pt, c: Pt): void {
  sh(b, CHROME, 4, (m) => m.capsule(a[0], a[1], c[0], c[1], 1.4, 1), false);
  ln(b, [a[0] + 1, a[1]], [c[0] + 1, c[1]], C.ice);
  sh(b, DARK, 4, (m) => m.capsule(a[0] - 1.5, a[1] + 1.5, a[0] + 1.5, a[1] - 1.5, 1.2, 1), false);
  sh(b, DARK, 3, (m) => m.capsule(a[0], a[1], a[0] - 3, a[1] + 3, 1.3, 1), false);
}

function bladeReturn(): PixBuf {
  return icon((b) => {
    bladeShape(b, [5, 19], [19, 5]);
    // bullet bouncing back along a curved arrow to the upper left
    for (let t = 0; t <= 1; t += 0.06) {
      const ang = Math.PI * 0.15 + t * Math.PI * 0.9;
      b.set(Math.round(13 - Math.cos(ang) * 8), Math.round(13 - Math.sin(ang) * 8), C.rose);
    }
    b.set(20, 13, C.rose); b.set(20, 12, C.rose); b.set(21, 12, C.rose);
    sh(b, RED, 2, (m) => m.circle(5, 6, 2.4, 1), false);
    b.set(4, 5, C.white);
    b.line(2, 9, 4, 10, C.magenta);
  });
}

function bladeAfterimage(): PixBuf {
  return icon((b) => {
    // ghost slash (delayed second cut): dithered ice line offset behind
    for (let k = 0; k <= 14; k++) { const x = 3 + k, y = 15 - k; if (k % 2 === 0) { b.set(x, y, C.teal); b.set(x + 1, y + 1, C.cyan); } }
    bladeShape(b, [7, 21], [21, 7]);
    // slash arcs
    b.line(14, 2, 21, 2, C.ice); b.line(2, 14, 2, 20, C.ice);
    b.set(22, 3, C.white); b.set(1, 21, C.white);
  });
}

function bladeFlow(): PixBuf {
  return icon((b) => {
    // An infinity-shaped current around the blade, matching the ice/white mod family.
    let last: Pt = [12, 12];
    for (let t = 0.08; t <= Math.PI * 2 + 0.08; t += 0.08) {
      const next: Pt = [12 + Math.sin(t) * 9, 12 + Math.sin(t * 2) * 5];
      ln(b, last, next, C.teal);
      last = next;
    }
    b.line(3, 10, 7, 7, C.cyan);
    b.line(17, 17, 21, 14, C.cyan);
    bladeShape(b, [7, 20], [18, 3]);
    b.set(19, 3, C.white);
    b.set(20, 5, C.ice);
  });
}

// ------------------------------------------------------------------ extras

function maxHp(): PixBuf {
  return icon((b) => {
    sh(b, RED, 2, (m) => heart(m, 10, 11, 8.5), false);
    b.set(6, 6, C.white); b.set(5, 7, C.rose); b.set(7, 6, C.rose);
    // +1 badge
    b.rect(15, 14, 8, 8, C.ink);
    b.hline(16, 19, 18, C.white); b.vline(17.5, 16, 20, C.white);
    b.vline(21, 15, 20, C.white); b.set(20, 16, C.white);
  });
}

function loan(): PixBuf {
  return icon((b) => {
    // contract sheet with a folded corner and text lines
    sh(b, PAPER, 3, (m) => m.poly([[3, 2], [15, 2], [19, 6], [19, 22], [3, 22]], 1), false);
    b.line(15, 2, 15, 6, C.steel); b.line(15, 6, 19, 6, C.steel);
    for (const [y, x1] of [[6, 12], [9, 16], [12, 16], [15, 12]] as const) b.hline(5, x1, y, C.slate);
    // red stamp over the lower right
    b.ring(16, 17, 5.5, C.red, 2);
    b.circle(16, 17, 2.5, C.red);
    b.set(15, 16, C.rose);
  });
}

// ------------------------------------------------------------------ registry

export function buildIconArt(): SheetSpec[] {
  const frames: { name: string; buf: PixBuf }[] = [
    { name: 'legs_stock', buf: legsStock() },
    { name: 'legs_leap', buf: legsLeap() },
    { name: 'legs_blink', buf: legsBlink() },
    { name: 'legs_slide', buf: legsSlide() },
    { name: 'arm_shove', buf: armShove() },
    { name: 'arm_grapple', buf: armGrapple() },
    { name: 'arm_fist', buf: armFist() },
    { name: 'arm_jack', buf: armJack() },
    { name: 'core_none', buf: socket(true) },
    { name: 'core_plating', buf: corePlating() },
    { name: 'core_capacitor', buf: coreCapacitor() },
    { name: 'core_debt', buf: coreDebt() },
    { name: 'core_overclock', buf: coreOverclock() },
    { name: 'head_none', buf: socket(false) },
    { name: 'head_optics', buf: headOptics() },
    { name: 'head_reflex', buf: headReflex() },
    { name: 'head_ballistic', buf: headBallistic() },
    { name: 'riveter_barbed', buf: riveterBarbed() },
    { name: 'riveter_magnet', buf: riveterMagnet() },
    { name: 'arc_mine', buf: arcMine() },
    { name: 'arc_web', buf: arcWeb() },
    { name: 'breacher_dragon', buf: breacherDragon() },
    { name: 'breacher_recoil', buf: breacherRecoil() },
    { name: 'blade_return', buf: bladeReturn() },
    { name: 'blade_afterimage', buf: bladeAfterimage() },
    { name: 'maxhp', buf: maxHp() },
    { name: 'loan', buf: loan() },
    { name: 'blade_flow', buf: bladeFlow() },
    { name: 'breacher_overload', buf: breacherOverload() },
    { name: 'riveter_blast', buf: riveterBlast() },
    { name: 'arc_aftershock', buf: arcAftershock() },
  ];
  return [{ key: 'ico', group: 'Icons', frameW: S, frameH: S, columns: 9, frames, meta: { note: 'Frame names = CyberId / ModId, plus maxhp and loan.' } }];
}

