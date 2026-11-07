/** Fold: a construction foreman who shifts occupied rooms and commits to punishable charges. */
import { FOLD_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { angleTo, norm } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart, type HitTag } from '../boss';
import { foundry, foundryOf } from '../arenas/foundry';
import { Barrel } from '../props';
import { shapeHits, type Hit, type Shape } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

export class Fold extends Boss {
  readonly id = 'fold' as const;
  readonly name = T.name;
  readonly body: BossPart;
  private moveX = 0;
  private moveY = 0;
  private face = Math.PI;
  private pose = 'idle1';
  private lastPick = '';
  private shiftCd = 3;
  private warning: Shape | null = null;
  private introZ = 0;
  private introSpread = 0;

  constructor(w: World, tier: number) {
    super(w, tier, 628, 214, 2400);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, this.x, this.y, 19, 27, 22));
    this.body.conductive = true;
  }

  think(w: World, dt: number): void {
    if (!this.staggered && !this.inTransition && (this.moveX || this.moveY)) {
      w.moveCircle(this.body, this.moveX * dt, this.moveY * dt, { ignore: this.body });
    }
    this.x = this.body.x; this.y = this.body.y;
    this.face = angleTo(this.x, this.y - 24, w.target().hx, w.target().hy);
    this.shiftCd = Math.max(0, this.shiftCd - dt);
    const st = foundryOf(w);
    this.status = st?.freezeT ? T.stopped : st?.busy ? T.moving : this.phase >= 2 ? T.phase3 : this.phase === 1 ? T.phase2 : '';
  }

  private stop(): void {
    this.moveX = this.moveY = 0; this.pose = 'idle1'; this.warning = null;
    const st = foundryOf(this.w);
    if (st) st.attackLock = st.ramming = false;
  }
  onStagger(): void { this.stop(); }
  onDeath(): void { this.stop(); foundryOf(this.w)?.openGate(); }
  modHit(_w: World, _p: BossPart, h: Hit): { mul: number; tag: HitTag } {
    // Rebounding construction bolts reward a well-timed parry without adding an immunity rule.
    return { mul: h.src === 'deflect' ? 1.5 : 1, tag: 'normal' };
  }

  *entrance(w: World): Script {
    const start = this.clock;
    this.introZ = 70; this.introSpread = 1;
    try {
      w.sfx('siren', 0.6);
      while (this.clock - start < 1.4) {
        const t = (this.clock - start) / 1.4;
        this.introZ = 70 * (1 - t) ** 2; this.introSpread = 1 - t * 0.7;
        yield;
      }
      this.introZ = 0; w.fx.debris(this.x, this.y, 14, [P.steel, P.orange], 100);
      w.fx.ring(this.x, this.y, 5, 65, P.amber, 0.35, 2); w.fx.shake(4, 0.2); w.sfx('land');
      const hold = this.clock;
      while (this.clock - hold < 1) { this.introSpread = 0.3 * (1 - (this.clock - hold)); yield; }
    } finally {
      this.introZ = this.introSpread = 0; this.invuln = false; this.stop();
      this.x = this.body.x = 628; this.y = this.body.y = 214;
    }
  }

  *transition(w: World, phase: number): Script {
    this.stop(); this.invuln = true;
    try {
      w.fx.label(this.x, this.y - 80, phase === 1 ? T.phase2 : T.phase3, P.amber, 1.2);
      w.fx.ring(this.x, this.y - 24, 12, 84, P.orange, 0.5, 2);
      yield* this.wait(0.8);
    } finally { this.invuln = false; this.stop(); this.shiftCd = 0; }
  }

  *brain(w: World): Script {
    yield* this.wait(0.5);
    for (;;) {
      const st = foundryOf(w);
      // Let a player's routing order finish before choosing a fixed attack lane.
      if (st?.busy) { yield* this.wait(0.2); continue; }
      yield* this.approach(this.tele(this.distToTarget() > 260 ? 1.4 : 0.65));
      if (st?.busy) continue;
      const d = this.distToTarget();
      const pick = w.rng.weighted([
        ['shift', this.shiftCd <= 0 && !st?.freezeT && this.lastPick !== 'shift' ? 4 : 0],
        ['charge', d > 85 && d < 380 && this.lastPick !== 'charge' ? 3 : 0.5],
        ['measure', this.lastPick === 'measure' ? 1 : 3],
        ['hammer', d < 150 ? 4 : 1],
        ['cross', this.phase >= 2 && this.lastPick !== 'cross' ? 3 : 0],
      ]);
      this.lastPick = pick;
      if (pick === 'shift') yield* this.shiftRooms();
      else if (pick === 'charge') yield* this.charge();
      else if (pick === 'measure') yield* this.measure();
      else if (pick === 'hammer') yield* this.hammer();
      else yield* this.crossCut();
      yield* this.wait(this.tele(0.75));
    }
  }

  private *approach(seconds: number): Script {
    const end = this.clock + seconds;
    try {
      while (this.clock < end) {
        const t = this.w.target(), [nx, ny] = norm(t.x - this.x, t.y - this.y);
        const d = this.distToTarget();
        const speed = d > 165 ? 82 : d < 65 ? -25 : 0;
        this.moveX = nx * speed - ny * 18; this.moveY = ny * speed + nx * 18;
        yield;
      }
    } finally { this.moveX = this.moveY = 0; }
  }

  private *shiftRooms(): Script {
    const st = foundryOf(this.w);
    if (!st?.requestShift(this.w, false)) { yield* this.wait(0.25); return; }
    this.shiftCd = 7;
    this.pose = 'attack';
    try {
      const end = this.clock + 12;
      while (st.busy && this.clock < end) yield;
      yield* this.wait(this.tele(0.35));
    } finally { this.pose = 'idle1'; }
  }

  private *measure(): Script {
    const w = this.w, st = foundryOf(w);
    const x = this.x, y = this.y - 24, a = this.aimFrom(x, y);
    const length = Math.min(530, w.rayWall(x, y, Math.cos(a), Math.sin(a), 530));
    const shape: Shape = { k: 'line', x1: x, y1: y, x2: x + Math.cos(a) * length, y2: y + Math.sin(a) * length, w: 14 };
    const warn = this.tele(1.0);
    this.warning = shape; this.pose = 'attack'; if (st) st.attackLock = true;
    try {
      this.hazard(shape, warn, 0.02, h => { h.hitsPlayer = false; h.marker = true; });
      w.sfx('telegraph'); yield* this.wait(warn);
      // Bolts are physical projectiles: columns stop them and the blade can reflect them.
      this.shoot(x, y, a, 300, { soft: false, frame: 'bolt', life: length / (300 * this.bulletMul) });
      if (this.phase >= 1) {
        yield* this.wait(this.tele(0.28));
        this.shoot(x, y, a, 300, { soft: false, frame: 'bolt', life: length / (300 * this.bulletMul) });
      }
      w.sfx('shotgun', 0.6); yield* this.wait(this.tele(0.7));
    } finally { this.warning = null; this.pose = 'idle1'; if (st) st.attackLock = false; }
  }

  private *charge(): Script {
    const w = this.w, st = foundryOf(w);
    const a = angleTo(this.x, this.y, w.target().x, w.target().y), nx = Math.cos(a), ny = Math.sin(a);
    const travel = Math.min(340, w.rayWall(this.x, this.y, nx, ny, 340));
    const shape: Shape = { k: 'line', x1: this.x, y1: this.y - 4, x2: this.x + nx * travel, y2: this.y - 4 + ny * travel, w: 64 };
    const warn = this.tele(1.1);
    this.pose = 'attack'; this.warning = shape;
    if (st) st.attackLock = true;
    try {
      this.hazard(shape, warn, 0.02, h => { h.hitsPlayer = false; h.marker = true; });
      w.sfx('charge'); yield* this.wait(warn); this.warning = null;
      if (st) st.ramming = true;
      let last = this.clock, walked = 0, hitPlayer = false;
      const deadline = this.clock + 1.7;
      while (walked < travel && this.clock < deadline) {
        const dt = this.clock - last; last = this.clock;
        const step = Math.min(285 * dt, travel - walked), ox = this.x, oy = this.y;
        const collision = w.moveCircle(this.body, nx * step, ny * step, { ignore: this.body });
        this.x = this.body.x; this.y = this.body.y; walked += step;
        const swept: Shape = { k: 'line', x1: ox, y1: oy - 4, x2: this.x, y2: this.y - 4, w: 42 };
        if (!hitPlayer && shapeHits(swept, w.player.x, w.player.y - 4, 4)) {
          const result = w.hitPlayer(1, { x: this.x, y: this.y, kind: 'impact', knock: 150 });
          if (result !== 'ignored') hitPlayer = true;
        }
        if (collision.wall || collision.body) {
          if (collision.body instanceof Barrel) {
            const barrel = collision.body;
            barrel.light(w, 0.55);
            const h = this.hazard({ k: 'circle', x: barrel.x, y: barrel.y - 6, r: 52 }, Math.max(0.01, barrel.fuse), 0.03, h => {
              h.hitsPlayer = false; h.onTick = () => {
                if (h.shape.k === 'circle') { h.shape.x = barrel.x; h.shape.y = barrel.y - 6; }
              };
            });
            h.owner = null;
          } else collision.body?.onRammed?.(w);
          w.fx.debris(this.x, this.y - 18, 12, [P.steel, P.amber], 100); w.sfx('crash');
          this.stagger(w, 1.8);
          yield; return;
        }
        yield;
      }
      yield* this.wait(this.tele(0.9));
    } finally { this.pose = 'idle1'; this.warning = null; if (st) st.ramming = st.attackLock = false; }
  }

  private *hammer(): Script {
    const w = this.w, st = foundryOf(w);
    if (st) st.attackLock = true;
    this.pose = 'attack';
    try {
      const count = this.phase >= 1 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const t = w.target(), [x, y] = w.clampToBounds(t.x, t.y - 4, 48);
        const shape: Shape = { k: 'circle', x, y, r: 38 };
        const warn = this.tele(i ? 0.8 : 1.1);
        this.warning = shape;
        this.hazard(shape, warn, 0.15, h => { h.low = true; h.marker = true; });
        w.sfx('telegraph'); yield* this.wait(warn);
        w.fx.ring(x, y, 5, 42, P.orange, 0.2, 3); w.fx.shake(2, 0.12); w.sfx('stomp');
        yield* this.wait(0.25);
      }
      yield* this.wait(this.tele(0.6));
    } finally { this.warning = null; this.pose = 'idle1'; if (st) st.attackLock = false; }
  }

  private *crossCut(): Script {
    const w = this.w, st = foundryOf(w);
    this.pose = 'attack'; if (st) st.attackLock = true;
    try {
      // Each axis locks separately. The second warning starts after the first cut ends.
      for (let i = 0; i < 2; i++) {
        const t = w.target(), x = t.x, y = t.y - 4;
        const dx = i ? 0 : 1, dy = i ? 1 : 0;
        const back = w.rayWall(x, y, -dx, -dy, 600), front = w.rayWall(x, y, dx, dy, 600);
        const s: Shape = { k: 'line', x1: x - dx * back, y1: y - dy * back, x2: x + dx * front, y2: y + dy * front, w: 24 };
        const warn = this.tele(0.95); this.warning = s;
        this.hazard(s, warn, 0.16, h => { h.low = true; h.marker = true; });
        w.sfx('charge', 0.7); yield* this.wait(warn);
        w.sfx('laser'); w.fx.shake(2, 0.12); yield* this.wait(0.3);
      }
      yield* this.wait(this.tele(0.85));
    } finally { this.pose = 'idle1'; this.warning = null; if (st) st.attackLock = false; }
  }

  draw(g: Gfx): void {
    g.ellipse(this.x, this.y + 1, 24 - this.introZ * 0.08, 9, P.ink, 0.5);
    const y = this.y + 6 - this.introZ;
    const frame = this.staggered || this.body.flash > 0 ? 'hurt' : this.pose === 'idle1' ? Math.floor(this.clock * 3) % 2 ? 'idle2' : 'idle1' : this.pose;
    g.img(this.phase >= 1 ? 'fold_broken' : 'fold', frame, this.x, y, { flipX: Math.cos(this.face) < 0, fill: this.body.flash > 0 ? P.white : undefined });
    g.circle(this.x + 12, y - 40, 13, P.amber, 0.15, 'light');
    if (this.introSpread > 0) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + this.clock * 0.5, r = 80 * this.introSpread;
      const x = this.x + Math.cos(a) * r, yy = this.y - 30 + Math.sin(a) * r * 0.5;
      g.line(this.x, this.y - 30, x, yy, 3, P.sodium, 0.7, 'top');
      g.ring(x, yy, 6, 1, P.ice, 0.8, 'top');
    }
    const s = this.warning;
    if (s?.k === 'circle') g.ring(s.x, s.y, s.r + 4, 1, P.rose, 0.9, 'top');
    if (s?.k === 'line') g.line(s.x1, s.y1, s.x2, s.y2, s.w + 8, P.rose, 0.07, 'top');
    if (this.staggered) g.ring(this.x, this.y - 78, 12, 2, P.amber, 0.9, 'top');
  }
}

export const foldDef: BossDef = {
  id: 'fold', arena: foundry, spawn: { x: 628, y: 214 }, make: (w, tier) => new Fold(w, tier),
  drop: 'legs_slide', hint: T.hint, portrait: { key: 'standee', frame: 'fold' },
  music: { bpm: 132, kick: 'x..x....x..x....', snare: '....x.......x...', hat: 'x.x.xxx.x.x.xxx.',
    bass: [0, null, 0, 7, null, null, 3, null, 0, null, 10, null, 7, null, 3, null],
    lead: [12, null, 15, null, 19, null, null, null, 12, null, 10, null, 7, null, null, null],
    root: 34, chords: [0, 3, 0, -2], wave: 'sawtooth' },
};
