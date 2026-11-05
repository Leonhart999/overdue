/**
 * Autopilot for smoke tests (?bot=1). Not a good player: it keeps a weapon-specific distance,
 * strafes, dodges telegraphs and bullets, uses specials and the arm on simple timers.
 */
import type { InputState } from '../engine/input';
import { dist, norm, Rng } from '../engine/math';
import { shapeHits } from './types';
import type { World } from './world';

export class Bot {
  private t = 0;
  private strafe = 1;
  private nextFlip = 2;
  private nextArm = 3;
  private altHeld = 0;
  /** Own seeded RNG: bot runs are reproducible and never disturb the world's RNG. */
  private rng = new Rng(77);

  update(w: World, s: InputState, dt: number): void {
    this.t += dt;
    s.firePressed = s.fireReleased = s.altPressed = s.altReleased = false;
    s.dashPressed = s.armPressed = s.armReleased = s.interactPressed = false;
    const p = w.player;
    const boss = w.boss;
    const tgt = w.nearestEnemy(p.x, p.y, 999);
    if (!boss || !tgt) { s.mx = s.my = 0; s.fire = false; return; }
    s.ax = tgt.hx;
    s.ay = tgt.hy;
    const want = { riveter: 130, arc: 80, breacher: 55, blade: 28 }[p.loadout.weapon];
    const d = dist(p.x, p.y, tgt.x, tgt.y);
    const [nx, ny] = norm(tgt.x - p.x, tgt.y - p.y);
    if (this.t > this.nextFlip) { this.strafe *= -1; this.nextFlip = this.t + 1.5 + this.rng.next() * 2; }
    let mx = -ny * this.strafe, my = nx * this.strafe;
    if (d > want + 20) { mx += nx * 1.2; my += ny * 1.2; }
    if (d < want - 15) { mx -= nx * 1.2; my -= ny * 1.2; }
    // flee telegraphs
    let danger = false;
    for (const h of w.hazards) {
      if (h.team === 'player' || !h.hitsPlayer) continue;
      if (shapeHits(h.shape, p.x, p.y - 4, 10)) { danger = true; break; }
    }
    for (const b of w.bullets) {
      if (b.team !== 'enemy') continue;
      const ahead = dist(b.x + b.vx * 0.12, b.y + b.vy * 0.12, p.x, p.y - 9);
      if (ahead < 10) { danger = true; break; }
    }
    if (danger) s.dashPressed = true;
    // stay inside the arena
    const bnd = w.bounds;
    if (p.x < bnd.x + 30) mx += 1;
    if (p.x > bnd.x + bnd.w - 30) mx -= 1;
    if (p.y < bnd.y + 30) my += 1;
    if (p.y > bnd.y + bnd.h - 30) my -= 1;
    [s.mx, s.my] = norm(mx, my);
    const wasFire = s.fire;
    s.fire = d < want + 120;
    if (s.fire && !wasFire) s.firePressed = true;
    if (p.loadout.weapon === 'blade') { s.firePressed = s.fire && Math.floor(this.t * 6) % 2 === 0; }
    // specials
    const hud = p.weapon.hud();
    let alt = false;
    switch (p.loadout.weapon) {
      case 'riveter': alt = (hud.ammo ?? 1) === 0 || Math.floor(this.t * 10) % 40 === 0; break;
      case 'arc': alt = (hud.charge ?? 0) >= 0.99; break;
      case 'breacher': alt = Math.floor(this.t * 10) % 30 === 0; break;
      case 'blade': alt = (hud.special ?? 0) >= 1 && d < 110; break;
    }
    if (p.loadout.weapon === 'blade') {
      if (alt && this.altHeld <= 0) { s.alt = true; s.altPressed = true; this.altHeld = 0.3; }
      else if (this.altHeld > 0) { this.altHeld -= dt; if (this.altHeld <= 0) { s.alt = false; s.altReleased = true; } }
    } else if (alt) { s.altPressed = true; s.alt = true; } else s.alt = false;
    if (this.t > this.nextArm) {
      s.armPressed = true; s.arm = true;
      this.nextArm = this.t + 2 + this.rng.next() * 2;
    } else if (s.arm && this.t > this.nextArm - 1.6) { s.arm = false; s.armReleased = true; }
    // pull a lever when one is near
    s.interactPressed = Math.floor(this.t * 4) % 8 === 0;
  }
}
