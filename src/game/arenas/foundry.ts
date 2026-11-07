/** Sliding construction rooms carry their occupants and props; service corridors always remain open. */
import { FOLD_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { clamp, dist, type Rect } from '../../engine/math';
import { Body } from '../body';
import { Hazard } from '../hazard';
import { Barrel, Pillar } from '../props';
import type { Cable, Hit } from '../types';
import type { Arena, World } from '../world';

export interface RailRoom {
  id: number; x: number; y: number; baseX: number; baseY: number;
  tx: number; ty: number; warn: number; moving: boolean; wall: Rect;
}
const states = new WeakMap<World, FoundryState>();
export const foundryOf = (w: World): FoundryState | undefined => states.get(w);
const inside = (p: { x: number; y: number }, r: RailRoom) => p.x >= r.x && p.x <= r.x + 280 && p.y >= r.y && p.y <= r.y + 168;

class FoundryDevice extends Body {
  cd = 0;
  private hits = 0;
  private shock = 0;
  private shockAt = -9;
  constructor(readonly st: FoundryState, readonly mode: 'route' | 'brake' | 'press' | 'gate', x: number, y: number, private room = -1) {
    super(); this.x = x; this.y = y; this.r = 9; this.hz = 12; this.hr = 12; this.mass = 0;
    this.solid = true; this.conductive = true; this.hackable = true; this.interactable = true; this.grapple = 'anchor';
    this.interactLabel = T[mode];
  }
  update(w: World, dt: number): void { this.cd = Math.max(0, this.cd - dt); this.flash = Math.max(0, this.flash - dt); if (w.time - this.shockAt > 0.06 || this.cd > 0) this.shock = 0; }
  private use(w: World): void {
    if (this.cd > 0 || w.state !== 'fight' || w.boss?.dying) return;
    if (this.mode === 'route') {
      if (!this.st.requestShift(w, true, this.room)) return;
      this.cd = 7;
    } else if (this.mode === 'brake') {
      const moving = this.st.busy;
      this.st.freezeT = 3.5; this.cd = 12;
      if (this.st.ramming || moving && w.boss && this.st.rooms.some(r => inside(w.boss!, r) && (r.moving || r.warn >= 0))) {
        this.st.hitBoss(w, 60, 130, 'rail_brake');
      }
      w.fx.ring(this.x, this.y - 12, 8, 70, P.ice, 0.4, 2); w.sfx('crash', 0.6);
    } else if (this.mode === 'press') {
      if (this.st.pressT > 0) return;
      this.cd = 12; this.st.pressT = 1.25;
      const shape = { k: 'rect' as const, x: 384, y: 278, w: 112, h: 92 };
      const h = new Hazard(shape, 1.1, 0.16);
      h.team = 'env'; h.marker = true; h.dmg = 1;
      h.onActivate = () => {
        for (const b of w.bodies) {
          if (b.dead || b.x < shape.x - b.r || b.x > shape.x + shape.w + b.r || b.y < shape.y - b.r || b.y > shape.y + shape.h + b.r) continue;
          if (b.team === 'enemy') w.damage(b, { dmg: 300, kind: 'crush', x: b.hx, y: b.hy, from: 'env', src: 'assembly_press', poise: 999, armorBreak: 1 });
          else if (b.mass > 0) w.damage(b, { dmg: 30, kind: 'crush', x: b.hx, y: b.hy, from: 'env', src: 'assembly_press' });
        }
        w.fx.debris(440, 324, 16, [P.steel, P.sodium], 120); w.fx.shake(5, 0.2); w.sfx('crush');
      };
      w.addHazard(h); w.sfx('siren', 0.7);
    } else {
      if (this.st.gateT > 0 || this.st.gateWarn > 0) this.st.openGate();
      else this.st.gateWarn = 1.0;
      this.cd = 2;
    }
    this.hits = this.shock = 0; this.flash = 0.1; w.sfx('lever', 0.6);
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player' || this.cd > 0 || h.quiet || h.kind === 'fire') return 0;
    this.hits++; this.flash = 0.06;
    if (h.src === 'slug' || h.kind === 'impact' || h.kind === 'blast' || this.hits >= 4) this.use(w);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    if (this.cd > 0) return;
    this.shockAt = w.time; this.shock += dt;
    if (this.shock >= 0.5) this.use(w);
  }
  onHack(w: World): void { this.use(w); }
  onEmp(w: World): void { this.use(w); }
  onInteract(w: World): void { this.use(w); }
  draw(g: Gfx): void {
    g.ellipse(this.x, this.y, 12, 5, P.ink, 0.45);
    g.img('archive_dev', this.mode + (this.cd <= 0 ? '_on' : '_off'), this.x, this.y + 4, { fill: this.flash > 0 ? P.white : undefined });
    if (this.cd <= 0) g.circle(this.x, this.y - 17, 13, this.mode === 'brake' ? P.red : P.amber, 0.15, 'light');
    else g.crisp(`${Math.ceil(this.cd)}`, this.x, this.y - 38, { align: 'center', color: P.steel, layer: 'top' });
  }
}

export class FoundryState {
  rooms: RailRoom[] = [];
  phase = 0;
  freezeT = 0;
  ramming = false;
  attackLock = false;
  pressT = 0;
  gateT = 0;
  gateWarn = 0;
  private gate: Rect = { x: -2000, y: 286, w: 12, h: 76 };
  private cable: Cable | null = null;
  private axis = false;
  private centerRaised = false;

  get busy(): boolean { return this.rooms.some(r => r.moving || r.warn >= 0); }
  constructor(w: World) {
    for (const [i, xy] of [[56, 96], [488, 96], [56, 352], [488, 352]].entries()) {
      const [x, y] = xy;
      const wall = { x: x + 12, y: y + 10, w: 256, h: 10 };
      this.rooms.push({ id: i, x, y, baseX: x, baseY: y, tx: x, ty: y, warn: -1, moving: false, wall });
      w.walls.push(wall);
    }
    w.walls.push(this.gate);
  }
  requestShift(w: World, player: boolean, preferred = -1): boolean {
    if (this.busy || this.freezeT > 0 || this.attackLock || w.boss?.dying) return false;
    this.axis = !this.axis;
    const nearest = [...this.rooms].sort((a, b) => dist(a.x + 140, a.y + 90, w.player.x, w.player.y) - dist(b.x + 140, b.y + 90, w.player.x, w.player.y));
    const list = player ? [this.rooms[preferred] ?? nearest[0]] : nearest.slice(0, this.phase === 0 ? 1 : this.phase === 1 ? 2 : 4);
    for (const r of list) {
      if (this.phase === 0 || this.axis) r.tx = r.x <= r.baseX ? r.baseX + 32 : r.baseX - 32;
      else r.ty = r.y <= r.baseY ? r.baseY + 16 : r.baseY - 16;
      r.warn = 1.4; r.moving = false;
    }
    w.sfx('siren', 0.55); return true;
  }
  hitBoss(w: World, dmg: number, poise: number, src: string): void {
    const b = w.boss?.parts.find(b => !b.dead);
    if (b) w.damage(b, { dmg, poise, kind: 'impact', x: b.hx, y: b.hy, from: 'env', src });
  }
  openGate(): void { this.gate.x = -2000; this.gateT = this.gateWarn = 0; if (this.cable) this.cable.dead = true; this.cable = null; }

  update(w: World, dt: number): void {
    if (w.state !== 'fight' || w.boss?.dying) {
      this.attackLock = this.ramming = false;
      if (w.boss?.dying) { this.openGate(); for (const r of this.rooms) { r.moving = false; r.warn = -1; } }
      return;
    }
    this.phase = w.boss?.phase ?? 0;
    this.freezeT = Math.max(0, this.freezeT - dt);
    this.pressT = Math.max(0, this.pressT - dt);
    if (this.phase >= 2 && !this.centerRaised) {
      this.centerRaised = true;
      w.fx.ring(440, 324, 12, 80, P.amber, 0.5, 2); w.sfx('land', 0.7);
    }
    let layoutChanged = false;
    if (this.gateWarn > 0) {
      this.gateWarn -= dt;
      if (this.gateWarn <= 0) {
        this.gate.x = 434; this.gateT = 6; layoutChanged = true;
        this.cable = { x1: 424, y1: 278, x2: 456, y2: 370, onCut: () => this.openGate() };
        w.cables.push(this.cable); w.sfx('crash', 0.5);
      }
    } else if (this.gateT > 0) { this.gateT -= dt; if (this.gateT <= 0) this.openGate(); }
    if (this.freezeT <= 0) for (const r of this.rooms) {
      if (r.warn >= 0) { r.warn -= dt; if (r.warn < 0) r.moving = true; }
      if (!r.moving) continue;
      const [dx, dy] = [clamp(r.tx - r.x, -44 * dt, 44 * dt), clamp(r.ty - r.y, -32 * dt, 32 * dt)];
      const passengers = w.bodies.filter(b => !b.dead && inside(b, r));
      const playerOn = !w.player.airborne && inside(w.player, r);
      const area = { x: r.x, y: r.y, w: 280, h: 168 };
      w.player.weapon.carryFloor(area, dx, dy);
      for (const b of w.bullets) if (!b.dead && b.floorBound && inside(b, r)) { b.x += dx; b.y += dy; }
      layoutChanged = true;
      if (playerOn) { w.player.x += dx; w.player.y += dy; }
      for (const b of passengers) { b.x += dx; b.y += dy; }
      r.x += dx; r.y += dy; r.wall.x = r.x + 12; r.wall.y = r.y + 10;
      if (dist(r.x, r.y, r.tx, r.ty) < 0.01) { r.moving = false; w.sfx('land', 0.35); }
    }
    // Resolve a wall sweeping into someone who was outside the room, without inflicting damage.
    if (!layoutChanged) return;
    w.moveCircle(w.player, 0, 0, { solids: false });
    for (const b of w.bodies) if (!b.dead && (b.mass > 0 || b.team === 'enemy')) {
      w.moveCircle(b, 0, 0, { ignore: b, solids: b.team !== 'enemy' });
    }
    const part = w.boss?.parts[0];
    if (part && w.boss) { w.boss.x = part.x; w.boss.y = part.y; }
  }

  drawFloor(g: Gfx): void {
    for (const r of this.rooms) {
      g.img('fold_room', String(r.id), r.x, r.y, { layer: 'floor', ox: 0, oy: 0 });
      g.crisp(T.rooms[r.id], r.x + 140, r.y + 30, { align: 'center', color: P.fog, layer: 'floor' });
      if (r.warn >= 0 || r.moving) {
        const c = this.freezeT > 0 ? P.ice : P.amber;
        g.strokeRect(r.tx, r.ty, 280, 168, 2, c, 0.7, 'floor');
        const x = r.x + 140, y = r.y + 100, dx = r.tx - r.x, dy = r.ty - r.y;
        g.line(x, y, x + dx, y + dy, 3, c, 0.6, 'floor');
        g.ring(x + dx, y + dy, 7, 2, c, 0.8, 'floor');
      }
    }
    if (this.centerRaised) {
      g.rect(360, 274, 160, 100, P.slate, 0.8, 'floor'); g.strokeRect(360, 274, 160, 100, 2, P.amber, 0.7, 'floor');
      for (let x = 372; x < 512; x += 16) g.line(x, 280, x, 368, 1, P.steel, 0.4, 'floor');
    }
    if (this.gateWarn > 0 || this.gateT > 0) {
      g.rect(434, 282, 12, 84, this.gateWarn > 0 ? P.red : P.steel, 0.65, 'top');
      g.line(424, 278, 456, 370, 2, P.amber, 0.8, 'top');
    }
  }
  drawTop(g: Gfx): void {
    if (this.pressT > 0) {
      g.strokeRect(380, 274, 120, 100, 1, P.rose, 0.8, 'top');
      const z = this.pressT > 0.15 ? 60 * (this.pressT - 0.15) / 1.1 : 0;
      g.rect(386, 276 - z, 108, 18, P.slate, 0.85, 'top'); g.line(386, 294 - z, 494, 294 - z, 3, P.orange, 0.9, 'top');
    }
    if (this.freezeT > 0) g.crisp(`${T.stopped} ${this.freezeT.toFixed(1)}`, 440, 255, { color: P.ice, align: 'center', layer: 'top' });
  }
}

export const foundry: Arena = {
  id: 'foundry', bg: 'bg_foundry', size: { w: 880, h: 608 }, bounds: { x: 24, y: 56, w: 832, h: 528 },
  playerSpawn: { x: 196, y: 470 },
  setup(w) {
    const st = new FoundryState(w); states.set(w, st); w.objects.push(st);
    for (const r of st.rooms) {
      w.add(new FoundryDevice(st, 'route', r.x + 52, r.y + 118, r.id));
      w.add(new Barrel(r.x + 218, r.y + 112));
      w.add(new Pillar(r.x + 188, r.y + 68));
    }
    w.add(new FoundryDevice(st, 'brake', 440, 184));
    w.add(new FoundryDevice(st, 'press', 440, 488));
    w.add(new FoundryDevice(st, 'gate', 390, 324));
  },
  drawFloor(g, w) { foundryOf(w)?.drawFloor(g); },
  botHint(w) {
    const st = foundryOf(w);
    if (st && st.gateT > 0 && Math.abs(w.player.x - 440) < 50 && Math.abs(w.player.y - 324) < 50) {
      return { x: w.player.x < 440 ? 380 : 500, y: w.player.y < 324 ? 252 : 396, jump: false };
    }
    return null;
  },
};
