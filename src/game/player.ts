/**
 * The player: movement, health, i-frames, perfect dodge and the four cyberware slots + weapon.
 * Cyberware and weapons are small classes that the player calls every step.
 */
import { COL, P, type Gfx } from '../engine/gfx';
import type { InputState } from '../engine/input';
import { angleTo, clamp, dist, norm } from '../engine/math';
import type { Body } from './body';
import { makeArm, makeCore, makeHead, makeLegs, type Arm, type CoreWare, type HeadWare, type Legs } from './cyber';
import { effectiveMaxHp, type Loadout } from './loadout';
import { makeWeapon, type Weapon } from './weapons';
import type { HitPlayerOpts, PlayerHitResult, World } from './world';

type Dir = 'down' | 'left' | 'right' | 'up';

export class Player {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  readonly r = 5;
  /** Hurt circle: (x, y - 9), radius 4. Small on purpose. */
  readonly hz = 11;
  readonly hr = 4;
  hp: number;
  maxHp: number;
  shield = 0;
  shieldMax = 0;
  /** Post-hit invulnerability (seconds). */
  invuln = 0;
  /** Dash / ability invulnerability (seconds) — touching an attack during it can be a perfect dodge. */
  iframes = 0;
  /** realTime when the current dash started (perfect-dodge window). */
  dashStart = -10;
  perfectUsed = true;
  airborne = false;
  /** Height above the ground for drawing (leap). */
  z = 0;
  aim = 0;
  dir: Dir = 'down';
  private walkT = 0;
  moving = false;
  hurtT = 0;
  /** Forced movement (yanked by a hook, grapple zip, iaido): velocity and remaining time. */
  forced: { vx: number; vy: number; t: number; iframes: boolean; solids: boolean } | null = null;
  /** Prop carried by the grapple arm. */
  held: Body | null = null;

  // stat multipliers, recomputed each step
  dmgMul = 1;
  fireRateMul = 1;
  moveMul = 1;
  /** Per-step movement multiplier set by weapons (arc firing, iaido charge). */
  slow = 1;
  weakMul = 1.3;
  teleMul = 1;
  homing = 0;
  rangeMul = 1;
  overclockT = 0;
  lastHurtAt = -100;
  /** Hub: hits still land but never drop below 1 heart. */
  immortal = false;
  private lastGhost = -1;
  /** Seconds left that a cyberware verb is disabled (Kade's lockdown). */
  locked: { legs: number; arm: number } = { legs: 0, arm: 0 };
  /** Short input buffers so presses during forced movement / hitstop are not lost. */
  private dashBuf = 0;
  private armBuf = 0;

  readonly weapon: Weapon;
  readonly legs: Legs;
  readonly arm: Arm;
  readonly core: CoreWare;
  readonly head: HeadWare;

  constructor(public loadout: Loadout, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.maxHp = effectiveMaxHp(loadout);
    this.hp = Math.min(loadout.hp, this.maxHp);
    this.weapon = makeWeapon(loadout.weapon, loadout.mods);
    this.legs = makeLegs(loadout.cyber.legs);
    this.arm = makeArm(loadout.cyber.arm);
    this.core = makeCore(loadout.cyber.core);
    this.head = makeHead(loadout.cyber.head);
    this.core.init(this);
    this.head.init(this);
  }

  get hx(): number { return this.x; }
  get hy(): number { return this.y - this.hz; }
  /** Weapon hand position. */
  get handX(): number { return this.x + Math.cos(this.aim) * 3; }
  get handY(): number { return this.y - 9 - this.z + Math.sin(this.aim) * 1.5; }

  overlapsHurt(x: number, y: number, r: number): boolean {
    const dx = x - this.x, dy = y - (this.y - this.hz - this.z * 0.5);
    const rr = r + this.hr;
    return dx * dx + dy * dy <= rr * rr;
  }

  update(w: World, inp: InputState, dt: number): void {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.overclockT > 0) this.overclockT -= dt;
    if (this.locked.legs > 0) this.locked.legs -= dt;
    if (this.locked.arm > 0) this.locked.arm -= dt;
    if (inp.dashPressed) this.dashBuf = 0.15;
    else if (this.dashBuf > 0) this.dashBuf -= dt;
    if (inp.armPressed) this.armBuf = 0.15;
    else if (this.armBuf > 0) this.armBuf -= dt;
    const fighting = w.state === 'fight';
    if (!fighting) this.weapon.dispose();

    // stats
    this.dmgMul = this.core.id === 'core_debt' ? 1.4 : 1;
    this.fireRateMul = this.overclockT > 0 ? 1.4 : 1;
    this.moveMul = this.overclockT > 0 ? 1.2 : 1;
    this.core.update(w, this, dt);
    this.head.update(w, this, dt);

    this.aim = angleTo(this.x, this.y - 9, inp.ax, inp.ay);
    const ca = Math.cos(this.aim), sa = Math.sin(this.aim);
    this.dir = Math.abs(ca) > 0.6 ? (ca > 0 ? 'right' : 'left') : sa > 0 ? 'down' : 'up';

    if (this.forced) {
      const f = this.forced;
      f.t -= dt;
      if (f.iframes) this.iframes = Math.max(this.iframes, 0.05);
      w.moveCircle(this, f.vx * dt, f.vy * dt, { solids: f.solids });
      if (f.t <= 0) this.forced = null;
      this.moving = true;
    } else {
      const legsIn = this.locked.legs > 0 ? { ...inp, dashPressed: false } : this.dashBuf > 0 && !inp.dashPressed ? { ...inp, dashPressed: true } : inp;
      const controlled = fighting && this.legs.update(w, this, legsIn, dt);
      this.dashBuf = 0;
      if (!controlled) {
        const speed = 118 * this.moveMul * this.slow;
        const tx = (fighting ? inp.mx : 0) * speed, ty = (fighting ? inp.my : 0) * speed;
        const k = Math.min(1, dt * 18);
        this.vx += (tx - this.vx) * k;
        this.vy += (ty - this.vy) * k;
        w.moveCircle(this, this.vx * dt, this.vy * dt);
      }
      this.moving = Math.hypot(this.vx, this.vy) > 10;
    }
    this.slow = 1;
    if (this.moving) this.walkT += dt;

    if (fighting) {
      const canFire = !this.forced && this.legs.allowsFire;
      this.weapon.update(w, this, inp, dt, canFire);
      const armIn = this.armBuf > 0 && !inp.armPressed ? { ...inp, armPressed: true } : inp;
      const armOk = !this.forced && this.locked.arm <= 0;
      this.arm.update(w, this, armIn, dt, armOk);
      if (armOk) this.armBuf = 0;
      this.updateHeld(w, dt);
      this.interact(w, inp);
    }
  }

  private updateHeld(_w: World, dt: number): void {
    const h = this.held;
    if (!h) return;
    if (h.dead) { this.held = null; return; }
    const tx = this.x + Math.cos(this.aim) * 14, ty = this.y + Math.sin(this.aim) * 9 + 2;
    h.x += (tx - h.x) * Math.min(1, dt * 20);
    h.y += (ty - h.y) * Math.min(1, dt * 20);
    h.vx = h.vy = 0;
  }

  private interact(w: World, inp: InputState): void {
    let best: Body | null = null, bd = 30;
    for (const b of w.bodies) {
      if (!b.interactable || b.dead) continue;
      const d = dist(this.x, this.y, b.x, b.y) - b.r;
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      w.prompt = `E  ${best.interactLabel || '互动'}`;
      if (inp.interactPressed) best.onInteract?.(w);
    }
  }

  /** Disable the dash (legs) or Q (arm) for `s` seconds. */
  lockSlot(slot: 'legs' | 'arm', s: number): void {
    this.locked[slot] = Math.max(this.locked[slot], s);
  }

  /** Start a dash-like invulnerability window (perfect dodge can trigger during the first 0.2s). */
  beginDodge(w: World, iframes: number): void {
    this.iframes = Math.max(this.iframes, iframes);
    this.dashStart = w.realTime;
    this.perfectUsed = false;
  }

  hurt(w: World, dmg: number, o: HitPlayerOpts): PlayerHitResult {
    if (o.low && this.airborne) return 'ignored';
    // after the boss is beaten nothing can hurt the player any more
    if (w.boss?.dying) return 'ignored';
    if (this.iframes > 0) {
      if (o.perfectable !== false && !this.perfectUsed && w.realTime - this.dashStart <= 0.22) this.perfectDodge(w);
      return 'dodged';
    }
    if (this.invuln > 0 || this.hp <= 0) return 'ignored';
    this.lastHurtAt = w.time;
    this.core.onHurt(w, this);
    w.stats.hitsTaken++;
    if (o.knock && (o.dx !== undefined || o.dy !== undefined)) {
      const [nx, ny] = norm(o.dx ?? 0, o.dy ?? 0);
      this.forced = { vx: nx * o.knock, vy: ny * o.knock, t: 0.12, iframes: false, solids: true };
    }
    if (this.shield > 0) {
      this.shield--;
      this.invuln = 0.8;
      w.sfx('shield');
      w.fx.ring(this.x, this.y - 9, 4, 18, P.cyan, 0.3);
      w.fx.label(this.x, this.y - 18, '护盾', COL.player);
      return 'hit';
    }
    this.hp = Math.max(this.immortal ? 1 : 0, this.hp - dmg);
    this.invuln = 1.0;
    this.hurtT = 0.3;
    w.hitstop = Math.max(w.hitstop, 0.07);
    w.fx.shake(4, 0.2);
    w.fx.flash(P.red, 0.25, 0.15);
    w.fx.burst(this.x, this.y - 9, 10, P.red, 90, 0.35, 2);
    w.sfx('hurt');
    if (this.hp <= 0) {
      w.fx.explosion(this.x, this.y - 8, 20);
      w.slowmo(0.3, 0.8);
    }
    return 'hit';
  }

  perfectDodge(w: World): void {
    this.perfectUsed = true;
    w.stats.perfectDodges++;
    w.slowmo(0.35, 0.16);
    this.legs.refund();
    this.arm.reduceCd(1);
    this.weapon.onPerfectDodge?.(w, this);
    this.core.onPerfectDodge(w, this);
    this.head.onPerfectDodge(w, this);
    w.fx.label(this.x, this.y - 22, '完美闪避', COL.player, 0.8);
    w.fx.ring(this.x, this.y - 9, 6, 26, P.ice, 0.3);
    w.sfx('perfect');
  }

  heal(n: number): void { this.hp = clamp(this.hp + n, 0, this.maxHp); }

  draw(g: Gfx, w: World): void {
    if (this.hp <= 0 && w.state !== 'fight') return;
    // shadow
    g.ellipse(this.x, this.y, 6, 2.5, P.ink, 0.5, 'floor');
    // ground marker: the player is always findable in busy fights (aim direction notch)
    if (w.state === 'fight') {
      g.ellipse(this.x, this.y + 0.5, 9, 4, COL.player, 0.12, 'floor');
      const ax = Math.cos(this.aim), ay = Math.sin(this.aim);
      g.line(this.x + ax * 7, this.y + 0.5 + ay * 3, this.x + ax * 11, this.y + 0.5 + ay * 5, 2, COL.player, 0.55, 'floor');
    }
    const blink = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0;
    const frames = ['walkA', 'idle', 'walkB', 'idle'];
    const fr = this.moving ? frames[Math.floor(this.walkT * 9) % 4] : 'idle';
    const frame = `${this.dir}_${fr}`;
    const y = this.y - this.z;
    const legs = this.legs.drawScale();
    const opts = {
      depth: this.y, alpha: blink ? 0.35 : 1, sy: legs,
      fill: this.hurtT > 0.2 ? P.white : undefined,
    };
    const weaponBehind = this.dir === 'up';
    if (weaponBehind) this.weapon.draw(g, w, this, this.y - 0.2);
    g.img('pc_echo', frame, this.x, y, opts);
    if (!weaponBehind) this.weapon.draw(g, w, this, this.y + 0.2);
    this.legs.draw(g, w, this);
    this.arm.draw(g, w, this);
    if (this.iframes > 0 && !this.forced && w.realTime - this.lastGhost >= 1 / 30) {
      this.lastGhost = w.realTime;
      w.fx.ghost('pc_echo', frame, this.x, y, { tint: P.cyan, alpha: 0.5, sy: legs }, 0.18);
    }
    if (this.overclockT > 0) g.circle(this.x, this.y - 13, 12, P.magenta, 0.15, 'light');
    if (this.shield > 0) g.ring(this.x, this.y - 14, 12, 1, P.cyan, 0.45 + 0.2 * Math.sin(w.realTime * 6), 'top');
  }
}
