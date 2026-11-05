/**
 * Body: anything with a position that can collide, be shot, pushed or interacted with.
 * Props, boss parts and summoned adds all extend it. The player is separate (player.ts).
 *
 * Coordinates: (x, y) is the ground point (feet). The hurt circle sits at (x, y - hz) with radius hr;
 * projectiles and attacks test against the hurt circle, movement uses the ground circle (x, y, r).
 */
import type { Gfx } from '../engine/gfx';
import type { Hit, Team } from './types';
import type { World } from './world';

let NEXT_ID = 1;
export const nextId = () => NEXT_ID++;

export abstract class Body {
  readonly id = nextId();
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** Ground collision radius. */
  r = 6;
  /** Hurt circle height above the ground point and radius. */
  hz = 8;
  hr = 6;
  team: Team = 'neutral';
  dead = false;
  /** Others are pushed out of it (pillars, boss bodies). */
  solid = false;
  /** 0 = immovable. Movable bodies are separated from solids and slide with friction. */
  mass = 1;
  /** Exponential velocity damping per second. */
  friction = 5;
  /** Projectiles stop on it (nails stick in it). */
  blocksShots = false;
  /** Can be chained through by the arc caster. */
  conductive = false;
  flammable = false;
  /** Player weapons consider it a target (auto-aim, arc lock, grapple). */
  targetable = true;
  hackable = false;
  interactable = false;
  /** Short Chinese verb shown next to the interact prompt, e.g. '拉下'. */
  interactLabel = '';
  /** Nails currently stuck in this body (riveter). */
  nails = 0;
  /** Grapple behaviour: 'pull' brings the body to the player, 'anchor' pulls the player to it. */
  grapple: 'pull' | 'anchor' | 'none' = 'none';
  /** Hit flash timer (seconds). */
  flash = 0;
  /** World time until which it draws as glyph art (jack arm hack). Visual only. */
  glyphUntil = -1;

  get hx(): number { return this.x; }
  get hy(): number { return this.y - this.hz; }

  update(_w: World, _dt: number): void {}
  draw(_g: Gfx, _w: World): void {}
  /** Apply damage; return damage actually dealt. */
  hurt(_w: World, _h: Hit): number { return 0; }

  push(ix: number, iy: number): void {
    if (this.mass > 0) {
      this.vx += ix / this.mass;
      this.vy += iy / this.mass;
    }
  }

  /** Sustained electricity (arc beam, electrified water). */
  onShock?(w: World, dps: number, dt: number): void;
  /** Overload / EMP burst. */
  onEmp?(w: World): void;
  /** Jack arm hack. */
  onHack?(w: World): void;
  /** Player pressed E next to it. */
  onInteract?(w: World): void;
  /** A charging boss ran into it. Return true if the charge stops here. */
  onRammed?(w: World): boolean;
  /** Fast-moving prop slammed into a boss part or wall. */
  onImpact?(w: World, other: Body | null, speed: number): void;
}

/** Simple movable/solid prop helper: integrates velocity with friction and wall collisions. */
export function integrateProp(w: World, b: Body, dt: number): void {
  if (b.mass <= 0) return;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 0.5) { b.vx = b.vy = 0; return; }
  const res = w.moveCircle(b, b.vx * dt, b.vy * dt, { bounce: 0.45, ignore: b });
  if ((res.wall || res.body) && sp > 170 && b.onImpact) b.onImpact(w, res.body, sp);
  const k = Math.exp(-b.friction * dt);
  b.vx *= k;
  b.vy *= k;
}
