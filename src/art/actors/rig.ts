/**
 * Humanoid battle rig (48x48 side view, facing right; enemies are mirrored afterwards).
 *
 * A character = materials + a hand-drawn head grid + body-shape functions. Each frame is a
 * set of joint positions (a Pose). Parts are drawn back-to-front as capsules/polygons, each
 * cel-shaded on its own (so overlapping limbs separate), then the whole sprite gets a 1px
 * ink outline. New characters only need new joints/materials/head; animation comes free.
 */
import { C } from '../palette';
import { grid, Legend } from '../core/grid';
import { Mask, PixBuf, Pt, shadeInto } from '../core/pixbuf';

export const BT = 48;
export const BATTLE_FRAMES = ['idle1', 'idle2', 'attack', 'hurt'] as const;
export type BattleFrame = (typeof BATTLE_FRAMES)[number];

export interface Mat {
  ramp: readonly number[];
  /** Index of the base colour in the ramp. */
  base: number;
}

export function mat(ramp: readonly number[], base: number): Mat {
  return { ramp, base };
}

/** Darker version of a material (for limbs on the far side). */
export function far(m: Mat): Mat {
  return { ramp: m.ramp, base: Math.max(1, m.base - 1) };
}

export interface Pose {
  /** Top-left of the head grid. */
  head: Pt;
  neck: Pt;
  hip: Pt;
  shF: Pt; elF: Pt; haF: Pt;
  shB: Pt; elB: Pt; haB: Pt;
  hiF: Pt; knF: Pt; ftF: Pt;
  hiB: Pt; knB: Pt; ftB: Pt;
}

export type PoseKey = keyof Pose;

export interface HumanoidSpec {
  id: string;
  head: { grid: string; legend: Legend; hurt?: Legend; attack?: Legend };
  skin: Mat;
  torso: Mat;
  /** Torso polygon from joints. */
  torsoShape: (p: Pose) => Pt[];
  armF: { upper: Mat; fore: Mat; hand: Mat; r?: [number, number] };
  armB: { upper: Mat; fore: Mat; hand: Mat; r?: [number, number] };
  legs: { thigh: Mat; shin: Mat; boot: Mat; r?: [number, number] };
  /** Optional coat/skirt drawn over the legs. */
  coat?: { mat: Mat; shape: (p: Pose) => Pt[] };
  /** Optional belt line. */
  belt?: number;
  poses: Record<BattleFrame, Pose>;
  /** Drawn between back limbs and torso (e.g. backpack, rifle on back). */
  behind?: (b: PixBuf, p: Pose, f: BattleFrame) => void;
  /** Drawn after the front arm (weapons, glows, visor). */
  front?: (b: PixBuf, p: Pose, f: BattleFrame) => void;
  /** Drawn between torso and head (scarves, collars). */
  overTorso?: (b: PixBuf, p: Pose, f: BattleFrame) => void;
  /** Draw the front arm before the head (e.g. arm hanging behind a big head). */
  armBeforeHead?: boolean;
  /** Drawn after the outline (glows, muzzle flashes, sparks: things that must not be outlined). */
  post?: (b: PixBuf, p: Pose, f: BattleFrame) => void;
}

/** Shade one part into dst. */
export function part(dst: PixBuf, m: Mat, draw: (b: PixBuf) => void, opts: { innerLine?: boolean; light?: Pt; rim?: number } = {}): void {
  const mask = new Mask(dst.w, dst.h).draw(draw);
  shadeInto(dst, mask, { ramp: m.ramp, base: m.base, innerLine: opts.innerLine ?? true, light: opts.light, rim: opts.rim });
}

export function boot(dst: PixBuf, m: Mat, ft: Pt, len = 4): void {
  const [x, y] = ft;
  part(dst, m, (b) => b.poly([[x - 2, y - 3], [x + 1, y - 3], [x + len, y - 1], [x + len, y + 1], [x - 2, y + 1]], 1));
}

function limb(dst: PixBuf, a: Pt, b: Pt, r: number, m: Mat, inner = true): void {
  part(dst, m, (buf) => buf.capsule(a[0], a[1], b[0], b[1], r, 1), { innerLine: inner });
}

/** Render one frame of a humanoid. */
export function drawHumanoid(s: HumanoidSpec, f: BattleFrame): PixBuf {
  const p = s.poses[f];
  const b = new PixBuf(BT, BT);
  const [ru, rf] = s.armB.r ?? [1.8, 1.5];
  const [rt, rs] = s.legs.r ?? [2.3, 1.9];
  // back arm
  limb(b, p.shB, p.elB, ru, s.armB.upper, false);
  limb(b, p.elB, p.haB, rf, s.armB.fore, false);
  part(b, s.armB.hand, (x) => x.circle(p.haB[0] + 0.5, p.haB[1] + 0.5, 1.6, 1), { innerLine: false });
  // back leg
  limb(b, p.hiB, p.knB, rt, far(s.legs.thigh));
  limb(b, p.knB, p.ftB, rs, far(s.legs.shin));
  boot(b, far(s.legs.boot), p.ftB);
  s.behind?.(b, p, f);
  // front leg
  limb(b, p.hiF, p.knF, rt, s.legs.thigh);
  limb(b, p.knF, p.ftF, rs, s.legs.shin);
  boot(b, s.legs.boot, p.ftF);
  // torso and coat
  if (s.coat) part(b, s.coat.mat, (x) => x.poly(s.coat!.shape(p), 1));
  part(b, s.torso, (x) => x.poly(s.torsoShape(p), 1));
  if (s.belt !== undefined) {
    const y = p.hip[1] - 1;
    for (let x = 0; x < BT; x++) if (b.get(x, y) && b.get(x, y - 6) && Math.abs(x - p.hip[0]) < 6) b.set(x, y, s.belt);
  }
  s.overTorso?.(b, p, f);
  const drawArm = () => {
    const [ruF, rfF] = s.armF.r ?? [1.8, 1.5];
    limb(b, p.shF, p.elF, ruF, s.armF.upper);
    limb(b, p.elF, p.haF, rfF, s.armF.fore);
    part(b, s.armF.hand, (x) => x.circle(p.haF[0] + 0.5, p.haF[1] + 0.5, 1.6, 1));
  };
  if (s.armBeforeHead) drawArm();
  // head
  const lg = f === 'hurt' && s.head.hurt ? { ...s.head.legend, ...s.head.hurt } : f === 'attack' && s.head.attack ? { ...s.head.legend, ...s.head.attack } : s.head.legend;
  b.blit(grid(s.head.grid, lg, `${s.id}/head`), p.head[0], p.head[1]);
  if (!s.armBeforeHead) drawArm();
  s.front?.(b, p, f);
  b.outline(C.ink);
  s.post?.(b, p, f);
  return b;
}

// ---------------------------------------------------------------------------
// Pose helpers
// ---------------------------------------------------------------------------

const UPPER: PoseKey[] = ['head', 'neck', 'shF', 'elF', 'haF', 'shB', 'elB', 'haB'];

export function clonePose(p: Pose): Pose {
  const o = {} as Pose;
  for (const k of Object.keys(p) as PoseKey[]) o[k] = [p[k][0], p[k][1]];
  return o;
}

/** Move a set of joints. */
export function moved(p: Pose, keys: PoseKey[], dx: number, dy: number): Pose {
  const o = clonePose(p);
  for (const k of keys) { o[k][0] += dx; o[k][1] += dy; }
  return o;
}

/** Breathing frame: upper body sinks 1px, hands a little less. */
export function breathe(p: Pose): Pose {
  return moved(moved(p, ['head', 'neck', 'shF', 'shB', 'elF', 'elB'], 0, 1), [], 0, 0);
}

/** Generic hurt pose: recoil backwards, head snaps back, arms fly up. */
export function hurtFrom(p: Pose): Pose {
  let o = moved(p, UPPER, -3, 1);
  o = moved(o, ['head'], -1, 0);
  o = moved(o, ['hip', 'hiF', 'hiB'], -1, 0);
  o.elF = [o.shF[0] + 1, o.shF[1] + 4];
  o.haF = [o.shF[0] + 4, o.shF[1] + 1];
  o.elB = [o.shB[0] - 3, o.shB[1] + 3];
  o.haB = [o.shB[0] - 5, o.shB[1] + 0];
  o.knF = [o.knF[0] - 1, o.knF[1]];
  return o;
}

/** Override specific joints. */
export function withJ(p: Pose, over: Partial<Pose>): Pose {
  const o = clonePose(p);
  for (const k of Object.keys(over) as PoseKey[]) o[k] = [over[k]![0], over[k]![1]];
  return o;
}

/** Standard slim torso shape. `w` widens the chest. */
export function torsoSlim(w = 0): (p: Pose) => Pt[] {
  return (p) => {
    const { shB, shF, hip } = p;
    return [
      [shB[0] - 2, shB[1] - 1.5], [shF[0] + 1.5 + w, shF[1] - 1.5], [shF[0] + 2.5 + w, shF[1] + 3],
      [hip[0] + 3.5, hip[1] - 3], [hip[0] + 3.5, hip[1] + 2.5], [hip[0] - 3.5, hip[1] + 2.5],
      [hip[0] - 4, hip[1] - 3], [shB[0] - 3, shB[1] + 3],
    ];
  };
}

/** A straight line weapon (blade, pipe, baton). Draws ink edge + body + highlight. */
export function bladeLine(b: PixBuf, from: Pt, to: Pt, body: number, light: number, edge: number = C.ink): void {
  const [x0, y0] = from, [x1, y1] = to;
  b.line(x0, y0 + 1, x1, y1 + 1, edge);
  b.line(x0, y0, x1, y1, body);
  b.line(x0, y0 - 1, x1, y1 - 1, light);
}

/** Stamp a small grid with its anchor (ax, ay) at point p. */
export function stamp(b: PixBuf, src: string, lg: Legend, p: Pt, anchor: Pt, flipX = false): void {
  const g = grid(src, lg, 'stamp');
  b.blit(flipX ? g.flipX() : g, Math.round(p[0] - (flipX ? g.w - 1 - anchor[0] : anchor[0])), Math.round(p[1] - anchor[1]));
}

/** Small additive-looking glow: a dithered halo of `c` around a point (only on empty pixels). */
export function halo(b: PixBuf, cx: number, cy: number, r: number, c: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && ((x + y) & 1) === 0) b.setIfEmpty(x, y, c);
    }
  }
}
