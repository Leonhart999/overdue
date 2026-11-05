/**
 * DIRECTOR KADE — Halcyon security chief in a heavy exoskeleton with a front energy shield and
 * escort drones, on the Skyline rooftop helipad.
 *
 * Shield (P1-P2): blocks player bullets, beams and melee from the front 100 deg. A blade slash on it
 * bounces off (0.3 s recoil). Behind him (rear 120 deg) hits are weak points (x1.3). Arc chained
 * from a drone / turret / barrel counts as coming from that node's side. Bullets he fired that the
 * blade deflects pass through. Recalling nails stuck in the shield, or a slug / charged fist on it,
 * knocks it aside for 1 s. A slide goes under it. It drops while staggered and after a leap slam.
 *
 * P1 (100-65%) : shield bash (lane, stops on walls / devices, sets off tanks and barrels), suppressing
 *                fire (sector telegraph, soft orbs + hard bolts), drone ring (drones circle the player,
 *                red lines lock, then bolts). 2 escort drones, re-deployed 8 s after loss.
 * P2 (65-30%)  : lockdown scan every 20 s (red scan on the player; at the end one cyberware slot is
 *                locked 6 s; cancelled by standing in the downdraft, by hacked-turret fire hitting
 *                him, or by a stagger). Leap slam (landing circle 1 heart, low shockwave ring).
 * P3 (30-0%)   : shield broken, faster. Calls helicopter strafing runs (two red lanes); the console
 *                crashes the helicopter onto him. At 10% HP: clearance countdown 12 s, then a
 *                bombardment (2 hearts) everywhere except under the hovering helicopter. A stagger
 *                cancels the countdown; it restarts later.
 *
 * Every turn: hacked turrets get a telegraphed reset (interrupted by 70 damage or a stagger).
 * Searchlight lock-on makes his next attack keep tracking (lanes, sectors, landing circle, lines).
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleDiff, angleTo, clamp, dist, norm, turnToward } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Body } from '../body';
import { Boss, BossPart, type HitTag } from '../boss';
import type { Hazard } from '../hazard';
import { helipad, PAD, padOf, Turret, type PadState } from '../arenas/helipad';
import type { Hit } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

type Anim = 'idle' | 'aim' | 'bash' | 'hurt' | 'leap';

const BASE_HP = 3300;
/** Chest height of the exoskeleton above its ground point. */
const CHEST = 24;
const SHIELD_HALF = (50 * Math.PI) / 180;
const REAR_HALF = (60 * Math.PI) / 180;
const FAN_SPREAD = 0.9;
const DRONE_SLOTS = 2;
const DRONE_RESPAWN = 8;

/** Hit sources that ignore the shield direction. */
const UNBLOCKED = new Set(['deflect', 'overload', 'rip', 'barbed', 'land', 'slide', 'fire']);

// =====================================================================================
// Escort drone
// =====================================================================================
export class KadeDrone extends Body {
  hp: number;
  mode: 'escort' | 'ring' = 'escort';
  /** Ring attack: where the script wants it. */
  goal: { x: number; y: number } | null = null;
  private orbitA: number;
  private shotT: number;
  private aim: Hazard | null = null;
  private aimA = 0;
  private bob = 0;
  constructor(private kade: Kade, x: number, y: number, public slot: number) {
    super();
    this.x = x; this.y = y;
    this.r = 6; this.hz = 20; this.hr = 7;
    this.team = 'enemy';
    this.mass = 1;
    this.friction = 3;
    this.solid = false;
    this.conductive = true;
    this.hp = Math.round(36 * ([1, 1.2, 1.4][kade.tier - 1] ?? 1.4));
    this.orbitA = slot * Math.PI;
    this.shotT = 2 + slot * 1.3;
  }

  hurt(w: World, h: Hit): number {
    if (h.from === 'enemy' || this.dead) return 0;
    const d = Math.min(this.hp, h.dmg);
    this.hp -= h.dmg;
    if (!h.quiet) { this.flash = 0.06; w.fx.number(this.id * 10, h.x, h.y, d, P.fog); w.sfx('bossHit', 0.5, 1.4); }
    if (this.hp <= 0) this.destroy(w, false);
    return d;
  }

  destroy(w: World, fell: boolean): void {
    if (this.dead) return;
    this.dead = true;
    if (this.aim) this.aim.dead = true;
    if (fell) {
      w.fx.label(this.x, this.y - 30, '无人机坠毁', P.amber, 1);
      w.fx.smoke(this.x, this.y - 10, 4, P.slate, 4, 30);
    } else {
      w.fx.explosion(this.x, this.y - this.hz, 12);
      w.fx.debris(this.x, this.y - this.hz, 8, [P.white, P.pale, P.amber, P.red], 140);
    }
    w.sfx('explosion', 0.5, 1.4);
    this.kade.droneLost(this);
  }

  update(w: World, dt: number): void {
    if (this.dead) return;
    const k = this.kade;
    if (k.jamT > 0) dt *= 0.7;
    this.bob += dt;
    if (this.flash > 0) this.flash -= dt;
    let gx: number, gy: number;
    if (this.mode === 'ring' && this.goal) { gx = this.goal.x; gy = this.goal.y; }
    else {
      this.orbitA += dt * 0.9;
      gx = k.x + Math.cos(this.orbitA) * 46;
      gy = k.y + Math.sin(this.orbitA) * 32;
    }
    // steer toward the goal; knockback velocity decays through the steering
    const [dx, dy] = [gx - this.x, gy - this.y];
    const want = this.mode === 'ring' ? 260 : 140;
    const dl = Math.hypot(dx, dy) || 1;
    const sp = Math.min(want, dl * 4);
    const rate = Math.min(1, dt * (this.mode === 'ring' ? 6 : 2.5));
    this.vx += ((dx / dl) * sp - this.vx) * rate;
    this.vy += ((dy / dl) * sp - this.vy) * rate;
    w.moveCircle(this, this.vx * dt, this.vy * dt, { solids: false });
    const b = w.bounds;
    if (this.x < b.x - 2 || this.x > b.x + b.w + 2) { this.destroy(w, true); return; }
    // escort: a single aimed soft orb now and then, with a short red line first
    if (this.mode !== 'escort' || k.staggered || k.inTransition || k.dying || w.state !== 'fight') {
      if (this.aim && this.aim.warning) this.aim.dead = true;
      this.aim = null;
      return;
    }
    this.shotT -= dt;
    const warn = k.tele(0.5);
    if (!this.aim && this.shotT <= warn) {
      this.aimA = k.aimFrom(this.x, this.y - this.hz);
      this.aim = k.hazard({ k: 'line', x1: this.x, y1: this.y - this.hz, x2: this.x, y2: this.y, w: 10 }, warn, 0, (h) => { h.hitsPlayer = false; });
    }
    if (this.aim) {
      const h = this.aim;
      if (h.shape.k === 'line') {
        if (h.t < h.warn * 0.6) this.aimA = k.aimFrom(this.x, this.y - this.hz);
        h.shape.x1 = this.x; h.shape.y1 = this.y - this.hz;
        h.shape.x2 = this.x + Math.cos(this.aimA) * 120; h.shape.y2 = this.y - this.hz + Math.sin(this.aimA) * 120;
      }
      if (h.dead && h.warning) { this.aim = null; this.shotT = 1.5; }
    }
    if (this.shotT <= 0) {
      if (this.aim) k.shoot(this.x, this.y - this.hz, this.aimA, 140, { life: 3 });
      w.sfx('nail', 0.4, 1.5);
      this.aim = null;
      this.shotT = k.tele(3.2) + w.rng.range(0, 1);
    }
  }

  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y, 6, 2.5, P.ink, 0.4, 'floor');
    const y = this.y - 14 + Math.sin(this.bob * 5) * 1.5;
    g.img('kade_drone', Math.floor(w.realTime * 20) % 2 ? 'a' : 'b', this.x, y, { depth: this.y, fill: this.flash > 0 ? P.white : undefined, flipX: this.vx < 0 });
    g.circle(this.x, y - 6, 4, P.red, 0.4, 'light');
  }
}

// =====================================================================================
// Kade
// =====================================================================================
export class Kade extends Boss {
  readonly id = 'kade' as const;
  readonly name = '凯德主管';
  readonly body: BossPart;
  /** Facing angle (shield direction), radians. */
  face = Math.PI / 2;
  private flip = false;
  private dt = 1 / 60;
  private anim: Anim = 'idle';
  private animClock = 0;
  private moveX = 0;
  private moveY = 0;
  private tracking = true;
  shieldOffT = 0;
  private shieldNails = 0;
  /** Shotgun pellets on the shield build pressure; full pressure knocks the shield aside. */
  private shieldPressure = 0;
  private shieldHitT = 0;
  private recoilCd = 0;
  private yankLabelT = 0;
  drones: (KadeDrone | null)[] = [];
  private droneT: number[] = [];
  private scanT = 999;
  private scanHaz: Hazard | null = null;
  private scanTurretHit = false;
  /** Clearance countdown (s left), -1 when not running. */
  clearT = -1;
  private clearCd = 0;
  private sirenT = 0;
  private lastPick = '';
  private airborne = false;
  private z = 0;
  private landAt: { x: number; y: number } | null = null;
  private resetTarget: Turret | null = null;
  private resetProg = 0;
  private resetDmg = 0;
  private resetCd = 0;
  private strafeCd = 6;
  private prevHp: number;
  private charging = false;

  constructor(w: World, tier: number, x: number, y: number) {
    super(w, tier, x, y, BASE_HP);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, x, y, 14, CHEST, 15));
    this.prevHp = this.hp;
    for (let i = 0; i < DRONE_SLOTS; i++) { this.drones.push(null); this.droneT.push(0); this.deploy(i); }
    this.updateStatus();
  }

  get r(): number { return this.body.r; }
  private get pad(): PadState | undefined { return padOf(this.w); }
  get shieldBroken(): boolean { return this.phase >= 2; }
  get shieldUp(): boolean { return !this.shieldBroken && this.shieldOffT <= 0 && !this.staggered && !this.airborne && !this.dying; }
  /** P3 speeds every wind-up and recovery up. */
  private t(s: number): number { return this.tele(s) * (this.phase >= 2 ? 0.82 : 1); }

  // ------------------------------------------------------------------ drones
  private deploy(slot: number): void {
    const bx = this.x - Math.cos(this.face) * 16, by = this.y - Math.sin(this.face) * 10;
    const d = new KadeDrone(this, bx, by, slot);
    this.drones[slot] = this.w.add(d);
  }

  droneLost(d: KadeDrone): void {
    if (this.drones[d.slot] === d) { this.drones[d.slot] = null; this.droneT[d.slot] = DRONE_RESPAWN; }
  }

  private liveDrones(): KadeDrone[] { return this.drones.filter((d): d is KadeDrone => !!d && !d.dead); }

  // ------------------------------------------------------------------ hits
  /** Ground-ish point the hit came from. */
  private hitSource(w: World, h: Hit): [number, number] {
    if (h.src === 'arc') {
      const nodes = (w.player.weapon as unknown as { nodes?: Body[] }).nodes;
      const i = nodes ? nodes.indexOf(this.body) : -1;
      if (nodes && i > 0) return [nodes[i - 1].hx, nodes[i - 1].hy];
      return [w.player.x, w.player.y - 9];
    }
    if (h.dx !== undefined && h.dy !== undefined && (h.dx || h.dy)) return [h.x - h.dx * 40, h.y - h.dy * 40];
    return [w.player.x, w.player.y - 9];
  }

  modHit(w: World, _part: BossPart, h: Hit): { mul: number; tag: HitTag } {
    if (h.from !== 'player') return { mul: 1, tag: 'normal' };
    const src = h.src ?? '';
    if (src === 'turret' && this.scanHaz && this.scanHaz.warning) this.scanTurretHit = true;
    if (src === 'rip' && this.shieldNails > 0) {
      this.shieldNails--;
      if (!this.shieldBroken && !this.staggered) {
        if (this.shieldOffT <= 0.1 && this.yankLabelT <= 0) { w.fx.label(this.x, this.y - 56, '盾被拽开', P.amber, 0.9); this.yankLabelT = 0.8; }
        this.shieldOffT = Math.max(this.shieldOffT, 1);
      }
      return { mul: 1, tag: 'normal' };
    }
    if (UNBLOCKED.has(src) || h.kind === 'blast' || h.kind === 'fire') return { mul: 1, tag: 'normal' };
    const [sx, sy] = this.hitSource(w, h);
    const off = Math.abs(angleDiff(this.face, angleTo(this.x, this.body.hy, sx, sy)));
    if (this.shieldUp && off <= SHIELD_HALF) {
      this.shieldHitT = 0.08;
      if (src === 'nail') this.shieldNails++;
      if (src === 'pellet') {
        this.shieldPressure += 1;
        if (this.shieldPressure >= 13) {
          // two close blasts in a row blow the shield open
          this.shieldPressure = 0;
          this.shieldOffT = Math.max(this.shieldOffT, 1.2);
          w.fx.label(this.x, this.y - 56, '盾被轰开', P.amber, 0.9);
          w.sfx('armor', 1, 0.7);
        }
      }
      if (h.poise) this.addPoise(w, h.poise * 0.4);
      if (h.armorBreak) {
        this.shieldOffT = Math.max(this.shieldOffT, 1);
        w.fx.label(this.x, this.y - 56, '盾被打偏', P.amber, 0.9);
      }
      if (h.kind === 'melee' && this.recoilCd <= 0) {
        // the blade bounces off: short recoil
        const p = w.player;
        const [nx, ny] = norm(p.x - this.x, p.y - this.y);
        p.forced = { vx: nx * 90, vy: ny * 90, t: 0.3, iframes: false, solids: true };
        this.recoilCd = 0.5;
        w.fx.label(p.x, p.y - 20, '弹开', P.fog, 0.6);
        w.sfx('deflect', 0.8, 0.7);
      }
      w.fx.sparks(h.x, h.y, 3, P.amber, 80);
      return { mul: 0, tag: 'immune' };
    }
    if (off >= Math.PI - REAR_HALF) return { mul: 1, tag: 'weak' };
    return { mul: 1, tag: 'normal' };
  }

  onStagger(w: World): void {
    this.charging = false;
    this.anim = 'hurt';
    this.moveX = this.moveY = 0;
    if (this.clearT >= 0) {
      this.clearT = -1;
      this.clearCd = 14;
      const pad = this.pad;
      if (pad) { pad.consoleLocked = false; pad.heli.forced = 0; }
      w.fx.label(320, 80, '清场被打断', P.amber, 1.4);
    }
  }
  onStaggerEnd(): void { this.anim = 'idle'; this.tracking = true; }
  onDeath(): void {
    this.clearT = -1;
    this.status = '';
    const pad = this.pad;
    if (pad) { pad.consoleLocked = false; pad.heli.forced = 0; }
    for (const d of this.liveDrones()) d.destroy(this.w, false);
  }

  // ------------------------------------------------------------------ per-step
  think(w: World, dt: number): void {
    this.dt = dt;
    this.animClock += dt;
    if (this.shieldOffT > 0) this.shieldOffT -= dt;
    if (this.shieldPressure > 0) this.shieldPressure = Math.max(0, this.shieldPressure - 5 * dt);
    if (this.shieldHitT > 0) this.shieldHitT -= dt;
    if (this.recoilCd > 0) this.recoilCd -= dt;
    if (this.yankLabelT > 0) this.yankLabelT -= dt;
    if (this.strafeCd > 0) this.strafeCd -= dt;
    if (this.resetCd > 0) this.resetCd -= dt;
    if (this.body.nails === 0) this.shieldNails = 0;
    const lost = this.prevHp - this.hp;
    this.prevHp = this.hp;
    if (this.resetTarget && lost > 0) this.resetDmg += lost;

    const t = w.target();
    if (this.tracking && !this.staggered && !this.airborne) {
      const rate = [1.8, 2.2, 2.8][this.phase] ?? 2.8;
      this.face = turnToward(this.face, angleTo(this.x, this.y, t.x, t.y), rate * dt);
    }
    const c = Math.cos(this.face);
    if (c < -0.15) this.flip = true; else if (c > 0.15) this.flip = false;
    if (!this.staggered && (this.moveX || this.moveY)) {
      w.moveCircle(this, this.moveX * dt, this.moveY * dt, { ignore: this.body });
      this.keepInside();
    }
    // keep the player out of the hull
    const p = w.player;
    if (!this.airborne && !p.airborne && dist(p.x, p.y, this.x, this.y) < this.body.r + p.r) {
      const [nx, ny] = norm(p.x - this.x, p.y - this.y);
      p.x = this.x + nx * (this.body.r + p.r);
      p.y = this.y + ny * (this.body.r + p.r);
    }
    // drones re-deploy
    if (!this.dying) for (let i = 0; i < DRONE_SLOTS; i++) {
      if (this.drones[i]) continue;
      this.droneT[i] -= dt;
      if (this.droneT[i] <= 0 && !this.staggered && !this.airborne) { this.deploy(i); w.fx.label(this.x, this.y - 56, '无人机出动', P.fog, 0.8); w.sfx('click'); }
    }
    this.updateScan(w, dt);
    this.updateClearance(w, dt);
    if (this.phase >= 2 && w.rng.chance(dt * 8)) w.fx.sparks(this.x + w.rng.range(-8, 8), this.y - CHEST, 1, w.rng.pick([P.amber, P.white, P.cyan]), 60);
    this.updateStatus();
  }

  private keepInside(): void {
    [this.x, this.y] = this.w.clampToBounds(this.x, this.y, this.body.r + 1);
    this.body.x = this.x; this.body.y = this.y;
  }

  private updateStatus(): void {
    if (this.clearT >= 0) { this.status = `全面清场 ${Math.ceil(this.clearT)}s`; return; }
    let s = `无人机 ${this.liveDrones().length}/${DRONE_SLOTS}`;
    if (this.phase >= 1 && this.scanT <= 20) s += this.scanHaz ? ' · 扫描中' : ` · 扫描 ${Math.max(0, Math.ceil(this.scanT))}s`;
    this.status = s;
  }

  // ------------------------------------------------------------------ lockdown scan (P2+)
  private updateScan(w: World, dt: number): void {
    if (this.scanHaz) {
      const h = this.scanHaz;
      if (h.dead) {
        if (h.warning) w.fx.label(w.player.x, w.player.y - 24, '扫描中断', P.amber, 0.9);
        this.scanHaz = null;
      }
      return;
    }
    if (this.phase < 1 || this.dying || this.inTransition || this.staggered || this.clearT >= 0 || w.state !== 'fight') return;
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 20;
    this.scanTurretHit = false;
    const p = w.player;
    w.fx.label(p.x, p.y - 24, '封锁扫描', COL.danger, 1);
    w.sfx('siren', 0.6, 1.3);
    this.scanHaz = this.hazard({ k: 'circle', x: p.x, y: p.y, r: 14 }, this.tele(2.6), 0, (h) => {
      h.hitsPlayer = false;
      h.onTick = (ww, hh) => { if (hh.shape.k === 'circle') { hh.shape.x = ww.player.x; hh.shape.y = ww.player.y; } };
      h.onActivate = (ww) => this.resolveScan(ww);
    });
  }

  private resolveScan(w: World): void {
    const p = w.player;
    const pad = this.pad;
    if (pad && pad.inDowndraft(p.x, p.y)) { w.fx.label(p.x, p.y - 24, '扫描被气流干扰', P.pale, 1.1); w.sfx('pop'); return; }
    if (this.scanTurretHit) { w.fx.label(p.x, p.y - 24, '扫描被炮台打断', P.acid, 1.1); w.sfx('pop'); return; }
    const slot = w.rng.chance(0.5) ? 'legs' : 'arm';
    p.lockSlot(slot, 6);
    w.fx.label(p.x, p.y - 24, slot === 'legs' ? '腿部被封锁 6s' : '手臂被封锁 6s', COL.danger, 1.4);
    w.fx.ring(p.x, p.y - 9, 4, 24, P.red, 0.35, 2);
    w.sfx('emp');
  }

  // ------------------------------------------------------------------ clearance (P3, <= 10%)
  private updateClearance(w: World, dt: number): void {
    const pad = this.pad;
    if (this.clearT < 0) {
      if (this.clearCd > 0 && !this.staggered) this.clearCd -= dt;
      if (this.phase >= 2 && this.hp <= this.maxHp * 0.1 && this.clearCd <= 0 && !this.staggered && !this.inTransition && !this.dying && w.state === 'fight') {
        this.clearT = 12;
        this.sirenT = 0;
        w.fx.label(320, 80, '全面清场：12 秒后全场轰炸', COL.danger, 2);
        w.fx.label(320, 96, '打断他，或站到直升机下面', P.pale, 2);
        if (pad) {
          pad.consoleLocked = true;
          const s = PAD.spots.reduce((a, b) => (dist(a[0], a[1], this.x, this.y) > dist(b[0], b[1], this.x, this.y) ? a : b));
          pad.heli.forceHover(s[0], s[1], 13.5);
        }
      }
      return;
    }
    if (this.dying) { this.clearT = -1; return; }
    this.clearT -= dt;
    this.sirenT -= dt;
    if (this.sirenT <= 0) { w.sfx('siren', 0.7); this.sirenT = this.clearT < 3 ? 0.4 : 1; }
    if (this.clearT <= 0) this.bombard(w);
  }

  private bombard(w: World): void {
    const pad = this.pad;
    const p = w.player;
    this.clearT = -1;
    this.clearCd = 16;
    const safe = pad ? pad.heli.covers(p.x, p.y, 2) : false;
    if (!safe) w.hitPlayer(2, { x: p.x, y: p.y, kind: 'blast' });
    const b = w.bounds;
    for (let i = 0; i < 16; i++) {
      const x = b.x + w.rng.next() * b.w, y = b.y + w.rng.next() * b.h;
      if (pad && pad.heli.covers(x, y, 10)) continue;
      w.fx.explosion(x, y, 18 + w.rng.next() * 10);
    }
    w.fx.shake(10, 0.6);
    w.fx.flash(P.orange, 0.4, 0.3);
    w.sfx('explosion', 1.2, 0.7);
    w.sfx('crush');
    if (pad) { pad.consoleLocked = false; pad.heli.forced = 1.5; }
  }

  // ------------------------------------------------------------------ helpers
  private takeLock(): boolean {
    const pad = this.pad;
    if (!pad || !pad.locked) return false;
    pad.locked = false;
    this.w.fx.label(this.x, this.y - 58, '追踪', COL.danger, 0.9);
    return true;
  }

  private gun(): [number, number] { return [this.x + Math.cos(this.face) * 13, this.y - CHEST + 2 + Math.sin(this.face) * 7]; }

  private hackedTurret(): Turret | null {
    const pad = this.pad;
    return pad?.turrets.find((t) => t.side === 'player' && !t.dead) ?? null;
  }

  private *approach(dur: number): Script {
    const end = this.clock + dur;
    const speed = [46, 54, 70][this.phase] ?? 70;
    const side = this.w.rng.chance(0.5) ? 1 : -1;
    this.tracking = true;
    this.anim = 'idle';
    try {
      while (this.clock < end) {
        const t = this.w.target();
        const d = dist(this.x, this.y, t.x, t.y);
        const [nx, ny] = norm(t.x - this.x, t.y - this.y);
        const k = d > 120 ? 1 : d < 60 ? -0.7 : 0;
        this.moveX = (nx * k - ny * side * 0.5) * speed;
        this.moveY = (ny * k + nx * side * 0.5) * speed;
        yield;
      }
    } finally { this.moveX = this.moveY = 0; }
  }

  // ------------------------------------------------------------------ brain
  *brain(w: World): Script {
    yield* this.wait(0.5);
    for (;;) {
      const ht = this.hackedTurret();
      if (ht && this.resetCd <= 0) { yield* this.resetTurret(ht); continue; }
      yield* this.approach(this.t(this.phase >= 2 ? 0.5 : 0.75) + w.rng.range(0, 0.4));
      const d = this.distToTarget();
      const ph = this.phase;
      const heli = this.pad?.heli;
      const options: [string, number][] = [
        ['bash', d > 70 ? 3 : 1.5],
        ['fan', 2.5],
        ['ring', this.liveDrones().length ? 2 : 0],
        ['leap', ph >= 1 ? (d > 90 ? 2 : 1) : 0],
        ['strafe', ph >= 2 && this.strafeCd <= 0 && heli && heli.state !== 'crash' && heli.forced <= 0 && this.clearT < 0 ? 5 : 0],
      ];
      for (const o of options) if (o[0] === this.lastPick) o[1] *= 0.3;
      const pick = w.rng.weighted(options);
      this.lastPick = pick;
      switch (pick) {
        case 'bash': yield* this.bash(); break;
        case 'fan': yield* this.fanFire(); break;
        case 'ring': yield* this.droneRing(); break;
        case 'leap': yield* this.leap(); break;
        case 'strafe': yield* this.strafeCall(); break;
      }
    }
  }

  *transition(w: World, phase: number): Script {
    this.charging = false;
    this.moveX = this.moveY = 0;
    this.invuln = true;
    this.anim = 'hurt';
    try {
      if (phase === 1) {
        w.fx.label(this.x, this.y - 64, '封锁协议启动', P.red, 1.4);
        w.sfx('siren');
        yield* this.wait(1.0);
      } else {
        w.fx.label(this.x, this.y - 64, '盾破碎', P.amber, 1.4);
        for (let i = 0; i < 3; i++) {
          w.fx.debris(this.x + Math.cos(this.face) * 14, this.y - CHEST, 10, [P.white, P.pale, P.amber, P.sodium], 200);
          w.fx.sparks(this.x, this.y - CHEST, 12, P.amber, 180);
          w.sfx('crash', 0.8, 1.2);
          yield* this.wait(0.3);
        }
        w.fx.shake(6, 0.4);
        this.strafeCd = 2;
        yield* this.wait(0.4);
      }
    } finally {
      // arm the lockdown scan even if this transition was cut short by the next one
      if (this.scanT > 20) this.scanT = phase === 1 ? 3 : 8;
      this.invuln = false;
      this.anim = 'idle';
      this.tracking = true;
    }
    yield* this.wait(0.3);
  }

  // ------------------------------------------------------------------ attacks
  /** Distance along (dx, dy) before Kade's ground circle would leave the roof or hit a device. */
  private laneLength(dx: number, dy: number): number {
    const w = this.w, b = w.bounds, R = this.body.r;
    const res = w.raycast(this.x, this.y, dx, dy, 700, (o) => o.solid && o.team === 'neutral' && o.mass === 0, true);
    let L = res.t;
    if (dx < -1e-3) L = Math.min(L, (this.x - (b.x + R)) / -dx);
    if (dx > 1e-3) L = Math.min(L, (b.x + b.w - R - this.x) / dx);
    if (dy < -1e-3) L = Math.min(L, (this.y - (b.y + R)) / -dy);
    if (dy > 1e-3) L = Math.min(L, (b.y + b.h - R - this.y) / dy);
    return Math.max(0, L);
  }

  private *bash(): Script {
    const w = this.w;
    const lock = this.takeLock();
    this.tracking = false;
    this.anim = 'bash';
    const windup = this.t(0.8);
    let [dx, dy] = this.dirToTarget();
    let L = this.laneLength(dx, dy);
    const W = 2 * (this.body.r + 5 + 2);
    const lane = this.hazard({ k: 'line', x1: this.x, y1: this.y, x2: this.x + dx * L, y2: this.y + dy * L, w: W }, windup, 0, (h) => {
      h.hitsPlayer = false;
      h.onTick = (_w, hh) => {
        if (hh.t < windup * (lock ? 0.88 : 0.5)) {
          [dx, dy] = this.dirToTarget();
          L = this.laneLength(dx, dy);
          this.face = Math.atan2(dy, dx);
          if (hh.shape.k === 'line') { hh.shape.x2 = this.x + dx * L; hh.shape.y2 = this.y + dy * L; }
        }
      };
    });
    this.face = Math.atan2(dy, dx);
    w.sfx('rev', 0.7, 1.2);
    yield* this.wait(windup);
    if (lane.dead && lane.t < windup) return;
    // charge
    this.charging = true;
    const speed = (this.phase >= 2 ? 420 : 360) * this.bulletMul;
    let travelled = 0;
    let hitPlayer = false;
    let crashed: 'wall' | 'device' | null = null;
    const stopAt = Math.max(0, L - 1);
    try {
      for (let guard = 0; guard < 240 && !crashed; guard++) {
        const step = Math.min(speed * this.dt, stopAt - travelled);
        for (const b of w.bodies) {
          if (b.dead || b.team !== 'neutral' || !b.solid) continue;
          if (dist(this.x + dx * step, this.y + dy * step, b.x, b.y) > this.body.r + b.r) continue;
          if (b.mass === 0) { b.onRammed?.(w); crashed = 'device'; break; }
          if (b.onRammed?.(w)) { crashed = 'device'; break; }
          if (!b.dead) b.push(dx * 400 - dy * 200, dy * 400 + dx * 200);
        }
        if (crashed) break;
        w.moveCircle(this, dx * step, dy * step, { ignore: this.body, solids: false });
        this.keepInside();
        travelled += step;
        const p = w.player;
        if (!hitPlayer && dist(p.x, p.y, this.x, this.y) < this.body.r + p.r + 2) {
          const side = Math.sign(-dy * (p.x - this.x) + dx * (p.y - this.y)) || 1;
          if (w.hitPlayer(1, { x: p.x, y: p.y, knock: 280, dx: dx * 0.7 - dy * side * 0.7, dy: dy * 0.7 + dx * side * 0.7 }) === 'hit') hitPlayer = true;
        }
        if (w.rng.chance(0.5)) w.fx.burst(this.x - dx * 14, this.y, 1, P.pale, 40, 0.3, 2);
        if (travelled >= stopAt - 0.5) { crashed = 'wall'; break; }
        yield;
      }
    } finally { this.charging = false; }
    // crash: stuck facing the wall for a moment, back open
    w.fx.shake(5, 0.25);
    w.sfx('crash');
    w.fx.sparks(this.x + dx * 18, this.y - 14, 10, P.amber, 140);
    this.anim = 'hurt';
    yield* this.wait(this.t(crashed === 'device' ? 1.3 : 1.05));
    this.anim = 'idle';
    this.tracking = true;
  }

  private *fanFire(): Script {
    const w = this.w;
    const lock = this.takeLock();
    this.tracking = false;
    this.anim = 'aim';
    let [gx, gy] = this.gun();
    let a = this.aimFrom(gx, gy);
    this.face = a;
    const warn = this.t(0.65);
    const sec = this.hazard({ k: 'sector', x: gx, y: gy, r: 230, a, span: FAN_SPREAD + 0.12 }, warn, 0, (h) => {
      h.hitsPlayer = false;
      h.onTick = (_w, hh) => {
        if (lock && hh.shape.k === 'sector') { [gx, gy] = this.gun(); a = this.aimFrom(gx, gy); this.face = a; hh.shape.a = a; hh.shape.x = gx; hh.shape.y = gy; }
      };
    });
    w.sfx('telegraph', 0.8, 1.1);
    yield* this.wait(warn);
    if (sec.dead && sec.t < warn) return;
    const waves = this.phase >= 2 ? 5 : 4;
    for (let k = 0; k < waves; k++) {
      [gx, gy] = this.gun();
      if (lock) { a = this.aimFrom(gx, gy); this.face = a; }
      const wob = (k % 2 ? 1 : -1) * 0.05;
      if (k % 2 === 0) this.fan(gx, gy, a + wob, 7, FAN_SPREAD, 150);
      else this.fan(gx, gy, a + wob, 6, FAN_SPREAD * 0.85, 230, { soft: false });
      w.sfx('spray', 0.8, 1.2);
      w.fx.sparks(gx, gy, 3, P.amber, 90, a, 0.6);
      yield* this.wait(0.28);
    }
    this.anim = 'idle';
    yield* this.wait(this.t(0.7));
    this.tracking = true;
  }

  private *droneRing(): Script {
    const w = this.w;
    const ds = this.liveDrones();
    if (!ds.length) return;
    const lock = this.takeLock();
    this.anim = 'aim';
    this.tracking = true;
    const circle = this.t(1.5);
    const warn = this.t(0.7);
    let ringA = w.rng.next() * Math.PI * 2;
    const lines = new Map<KadeDrone, Hazard>();
    const aims = new Map<KadeDrone, number>();
    w.sfx('telegraph', 0.7, 1.4);
    try {
      for (const d of ds) d.mode = 'ring';
      const start = this.clock;
      let lockedAt = -1;
      for (;;) {
        const el = this.clock - start;
        if (el >= circle + warn) break;
        const tg = w.target();
        const moving = el < circle + warn * (lock ? 0.85 : 0.5);
        if (moving) ringA += this.dt * ((Math.PI * 2) / (circle + warn));
        else if (lockedAt < 0) lockedAt = el;
        const live = ds.filter((d) => !d.dead);
        if (!live.length) return;
        live.forEach((d, i) => {
          const a = ringA + (i / live.length) * Math.PI * 2;
          if (moving) d.goal = { x: tg.x + Math.cos(a) * 72, y: tg.y + Math.sin(a) * 56 };
          if (el >= circle) {
            if (moving || !aims.has(d)) aims.set(d, angleTo(d.x, d.y - d.hz, tg.hx, tg.hy));
            const aa = aims.get(d)!;
            let h = lines.get(d);
            if (!h) {
              h = this.hazard({ k: 'line', x1: 0, y1: 0, x2: 0, y2: 0, w: 15 }, circle + warn - el, 0, (hh) => { hh.hitsPlayer = false; });
              lines.set(d, h);
            }
            if (h.shape.k === 'line') {
              h.shape.x1 = d.x; h.shape.y1 = d.y - d.hz;
              h.shape.x2 = d.x + Math.cos(aa) * 200; h.shape.y2 = d.y - d.hz + Math.sin(aa) * 200;
            }
          }
        });
        yield;
      }
      // fire along the locked lines
      for (let s = 0; s < 3; s++) {
        for (const d of ds) {
          const h = lines.get(d);
          if (d.dead || !h || (h.dead && h.warning)) continue;
          this.shoot(d.x, d.y - d.hz, aims.get(d)!, 260, { soft: false, life: 1.4 });
        }
        w.sfx('nail', 0.6, 1.2);
        yield* this.wait(0.08);
      }
    } finally {
      for (const d of ds) { d.mode = 'escort'; d.goal = null; }
    }
    this.anim = 'idle';
    yield* this.wait(this.t(0.5));
  }

  private *leap(): Script {
    const w = this.w;
    const lock = this.takeLock();
    this.tracking = false;
    this.anim = 'leap';
    yield* this.wait(this.t(0.4));
    const R = 36, R0 = 30, R1 = 150;
    const warn = this.t(1.05);
    const tg = w.target();
    let [tx, ty] = w.clampToBounds(tg.x, tg.y, this.body.r + 2);
    try {
      this.airborne = true;
      this.body.targetable = false;
      this.body.solid = false;
      this.body.hz = 400;
      this.invuln = true;
      this.landAt = { x: tx, y: ty };
      w.sfx('leap', 1, 0.6);
      w.fx.smoke(this.x, this.y, 6, P.slate, 5, 20);
      const ring = this.hazard({ k: 'ring', x: tx, y: ty, r: R1, w: 2 }, warn, 0, (h) => { h.hitsPlayer = false; });
      const land = this.hazard({ k: 'circle', x: tx, y: ty, r: R }, warn, 0.06, (h) => {
        h.dmg = 1;
        h.onTick = (ww, hh) => {
          if (hh.warning && hh.t < warn * (lock ? 0.9 : 0.5) && hh.shape.k === 'circle') {
            const t2 = ww.target();
            const [cx, cy] = ww.clampToBounds(t2.x, t2.y, this.body.r + 2);
            const k = Math.min(1, this.dt * 5);
            hh.shape.x += (cx - hh.shape.x) * k; hh.shape.y += (cy - hh.shape.y) * k;
            if (ring.shape.k === 'ring') { ring.shape.x = hh.shape.x; ring.shape.y = hh.shape.y; }
            this.landAt = { x: hh.shape.x, y: hh.shape.y };
          }
        };
      });
      const start = this.clock;
      while (this.clock - start < warn) {
        const f = (this.clock - start) / warn;
        this.z = f < 0.25 ? 260 * (f / 0.25) : f > 0.85 ? 260 * (1 - (f - 0.85) / 0.15) : 260;
        yield;
      }
      if (land.shape.k === 'circle') { tx = land.shape.x; ty = land.shape.y; }
      this.x = tx; this.y = ty;
      this.keepInside();
      this.z = 0;
    } finally {
      this.airborne = false;
      this.body.targetable = true;
      this.body.solid = true;
      this.body.hz = CHEST;
      this.invuln = false;
      this.landAt = null;
      this.z = 0;
    }
    // landing shockwave (ground attack, jumpable)
    const dur = 0.6;
    this.hazard({ k: 'ring', x: this.x, y: this.y, r: R0, w: 12 }, 0, dur, (h) => {
      h.low = true;
      h.cancelable = false;
      h.onTick = (ww, hh) => {
        if (hh.shape.k !== 'ring') return;
        hh.shape.r = R0 + (R1 - R0) * clamp(hh.t / dur, 0, 1);
        for (const b of ww.bodies) {
          if (b.dead || b.mass <= 0 || b.team !== 'neutral') continue;
          const d = dist(b.x, b.y, hh.shape.x, hh.shape.y);
          if (Math.abs(d - hh.shape.r) < 8) { const [nx, ny] = norm(b.x - hh.shape.x, b.y - hh.shape.y); b.push(nx * 40, ny * 40); }
        }
      };
    });
    w.sfx('stomp');
    w.sfx('crash', 0.6);
    w.fx.shake(7, 0.35);
    w.fx.smoke(this.x, this.y, 12, P.slate, 6, 10);
    w.fx.debris(this.x, this.y - 4, 12, [P.slate, P.steel, P.fog], 160);
    // shield planted in the floor: front and back open while he recovers
    const rec = this.t(1.25);
    this.shieldOffT = Math.max(this.shieldOffT, rec);
    this.anim = 'hurt';
    yield* this.wait(rec);
    this.anim = 'idle';
    this.tracking = true;
  }

  private *strafeCall(): Script {
    const w = this.w;
    const heli = this.pad?.heli;
    if (!heli || !heli.strafe(2)) return;
    this.strafeCd = 24;
    this.anim = 'aim';
    w.fx.label(this.x, this.y - 58, '直升机强攻', COL.danger, 1.2);
    w.fx.label(PAD.console[0], PAD.console[1] - 34, 'E 让它坠毁', COL.interact, 2.4);
    w.sfx('siren', 0.6, 0.8);
    yield* this.wait(0.5);
    const end = this.clock + 9;
    while (heli.strafing && this.clock < end) {
      // slow walk while the helicopter does the work
      const [nx, ny] = this.dirToTarget();
      const d = this.distToTarget();
      const k = d > 130 ? 1 : d < 70 ? -1 : 0;
      this.moveX = nx * 30 * k; this.moveY = ny * 30 * k;
      this.tracking = true;
      yield;
    }
    this.moveX = this.moveY = 0;
    this.anim = 'idle';
    yield* this.wait(this.t(0.4));
  }

  private *resetTurret(tu: Turret): Script {
    const w = this.w;
    this.tracking = false;
    this.anim = 'aim';
    this.face = angleTo(this.x, this.y, tu.x, tu.y);
    const dur = this.t(1.7);
    this.resetTarget = tu;
    this.resetDmg = 0;
    this.resetProg = 0;
    tu.resetting = true;
    w.fx.label(tu.x, tu.y - 40, '重置炮台', COL.danger, 1);
    w.sfx('charge', 0.7, 0.8);
    let interrupted = false;
    try {
      const start = this.clock;
      while (this.clock - start < dur) {
        this.resetProg = (this.clock - start) / dur;
        if (tu.side === 'enemy' || tu.dead) return;
        if (this.resetDmg >= 70) { interrupted = true; break; }
        yield;
      }
    } finally {
      tu.resetting = false;
      this.resetTarget = null;
      this.tracking = true;
    }
    if (interrupted) {
      w.fx.label(this.x, this.y - 58, '重置被打断', P.amber, 1);
      w.sfx('pop');
      this.addPoise(w, 20);
      this.resetCd = 6;
      this.anim = 'hurt';
      yield* this.wait(this.t(0.7));
      this.anim = 'idle';
      return;
    }
    tu.reset(w, true);
    this.resetCd = 4;
    this.anim = 'idle';
    yield* this.wait(this.t(0.3));
  }

  // ------------------------------------------------------------------ draw
  draw(g: Gfx, w: World): void {
    const pad = this.pad;
    // bombardment warning: everything red except the downdraft circle
    if (this.clearT >= 0 && this.clearT < 3.5 && pad) {
      const b = w.bounds, S = 20;
      const pulse = 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(w.realTime * (this.clearT < 1.5 ? 30 : 14)));
      const h = pad.heli;
      for (let y = b.y; y < b.y + b.h; y += S) for (let x = b.x; x < b.x + b.w; x += S) {
        const cx = x + S / 2, cy = y + S / 2;
        if (h.k > 0 && dist(cx, cy, h.hx, h.hy) < DRAFT_CELL) continue;
        g.rect(x + 1, y + 1, S - 2, S - 2, COL.danger, pulse);
      }
      if (h.k > 0) {
        g.ring(h.hx, h.hy, 66, 2, P.white, 0.6 + 0.3 * Math.sin(w.realTime * 10));
        g.text('安全区', h.hx, h.hy - 8, { layer: 'top', color: P.white, align: 'center' });
      }
    }

    const ax = this.landAt ? this.landAt.x : this.x, ay = this.landAt ? this.landAt.y : this.y;
    const sh = this.airborne ? clamp(1 - this.z / 260, 0.3, 1) : 1;
    g.ellipse(ax, ay + 1, 18 * sh, 7 * sh, P.ink, 0.5, 'floor');
    // floor arc: which side the shield covers
    if (this.shieldUp) g.sector(this.x, this.y, 30, this.face - SHIELD_HALF, this.face + SHIELD_HALF, P.amber, 0.14, 'floor', 20);

    const key = this.shieldBroken ? 'kade_broken' : 'kade';
    let frame: string = this.anim === 'idle' ? (Math.floor(this.animClock * 2.5) % 2 ? 'idle2' : 'idle1') : this.anim;
    if (this.staggered) frame = 'hurt';
    if (this.airborne) frame = 'leap';
    const shakeX = this.charging ? w.rng.range(-1, 1) : 0;
    const flash = this.body.flash > 0;
    if (!this.airborne || this.z < 250) {
      g.img(key, frame, this.x + shakeX, this.y + 4 - this.z, { flipX: this.flip, fill: flash ? P.pale : undefined, depth: this.y });
    }
    const hy = this.y - this.z;
    // visor
    g.circle(this.x + (this.flip ? -4 : 4), hy - 38, 5, P.red, 0.35, 'light');
    // energy shield at chest height
    if (this.shieldUp) {
      const a0 = this.face - SHIELD_HALF, a1 = this.face + SHIELD_HALF;
      const hit = this.shieldHitT > 0;
      g.sector(this.x, hy - CHEST + 4, 24, a0, a1, hit ? P.white : P.pale, hit ? 0.45 : 0.2, 'top', 18);
      g.sector(this.x, hy - CHEST + 4, 24, a0, a1, P.amber, 0.8, 'top', 22.5);
      g.circle(this.x + Math.cos(this.face) * 20, hy - CHEST + 4 + Math.sin(this.face) * 14, 14, P.amber, hit ? 0.3 : 0.14, 'light');
    } else if (!this.shieldBroken && this.shieldOffT > 0 && !this.staggered && !this.airborne) {
      // knocked aside: a flickering arc swung off to the side
      if (Math.floor(w.realTime * 20) % 2 === 0) {
        const fa = this.face + 1.8;
        g.sector(this.x, hy - CHEST + 4, 24, fa - SHIELD_HALF, fa + SHIELD_HALF, P.amber, 0.45, 'top', 22.5);
      }
    }
    if (this.staggered) {
      for (let i = 0; i < 3; i++) {
        const a = this.animClock * 4 + (i * Math.PI * 2) / 3;
        g.img('proj', 'star', this.x + Math.cos(a) * 14, this.y - 58 + Math.sin(a) * 4, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
    }
    // lockdown scan beam from the visor to the player
    if (this.scanHaz && !this.scanHaz.dead && this.scanHaz.warning) {
      const p = w.player;
      const f = this.scanHaz.progress;
      const fl = 0.35 + 0.35 * Math.sin(w.realTime * 25);
      g.line(this.x, hy - 38, p.x, p.y - 9, 1, P.red, fl, 'top');
      const a = w.realTime * 6;
      for (let i = 0; i < 4; i++) {
        const aa = a + (i * Math.PI) / 2;
        g.sector(p.x, p.y - 9, 15, aa, aa + 0.6, P.red, 0.4 + 0.4 * f, 'top', 13);
      }
    }
    // turret reset link
    if (this.resetTarget) {
      const t = this.resetTarget;
      const n = 8;
      for (let i = 0; i < n; i += 2) {
        const u0 = i / n, u1 = (i + 1) / n;
        g.line(this.x + (t.x - this.x) * u0, hy - 30 + (t.y - 16 - hy + 30) * u0, this.x + (t.x - this.x) * u1, hy - 30 + (t.y - 16 - hy + 30) * u1, 1, P.red, 0.8, 'top');
      }
      g.sector(t.x, t.y - 16, 16, -Math.PI / 2, -Math.PI / 2 + this.resetProg * Math.PI * 2, COL.danger, 0.6, 'top', 13);
    }
    // searchlight lock-on: a red reticle on the player until his next attack
    if (pad && pad.locked) {
      const p = w.player, r = 9 + Math.sin(w.realTime * 8);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + w.realTime;
        g.line(p.x + Math.cos(a) * r, p.y - 9 + Math.sin(a) * r, p.x + Math.cos(a) * (r + 4), p.y - 9 + Math.sin(a) * (r + 4), 1, COL.danger, 0.9, 'top');
      }
    }
    // clearance countdown
    if (this.clearT >= 0) {
      g.text(`全面清场 ${Math.ceil(this.clearT)}`, 320, 66, { layer: 'top', color: COL.danger, align: 'center', scale: 1, stroke: true });
    }
  }
}

/** Safe cell test radius (cells whose centre is inside the downdraft stay clear). */
const DRAFT_CELL = 66;

export const kadeDef: BossDef = {
  id: 'kade',
  arena: helipad,
  spawn: PAD.kadeSpawn,
  make: (w, tier) => new Kade(w, tier, PAD.kadeSpawn.x, PAD.kadeSpawn.y),
  drop: 'legs_slide',
  hint: '骇入炮台帮你打 · 直升机气流吹走软弹 · 打碎探照灯 · 绕到盾后面打 · 霰弹连轰能轰开盾',
  portrait: { key: 'kade_portrait', frame: 'kade' },
  music: {
    bpm: 140,
    kick: 'x...x...x...x.x.',
    snare: '....x.......x..x',
    hat: 'x.xxx.xxx.xxx.xx',
    bass: [0, 0, 12, 0, 0, 0, 12, 0, 3, 3, 15, 3, 5, 5, 7, 10],
    lead: [null, null, 12, null, null, null, 15, null, null, null, 17, null, 15, null, 12, null],
    root: 38,
    chords: [0, 0, -2, -4],
    wave: 'sawtooth',
  },
};
