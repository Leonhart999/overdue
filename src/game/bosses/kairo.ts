/** Kairo steals movement history, archives a safe past position and lends out a cuttable clock hand. */
import { KAIRO_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { angleTo, dist, norm } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart } from '../boss';
import { archive, archiveOf } from '../arenas/archive';
import { replayMemory, type MemoryPattern, type TracePoint } from '../arenas/archiveMemory';
import type { World } from '../world';
import type { BossDef } from './registry';

export class Kairo extends Boss {
  readonly id = 'kairo' as const;
  readonly name = T.name;
  readonly body: BossPart;
  private moveX = 0;
  private moveY = 0;
  private face = 0;
  private pose = 'idle1';
  private recording: TracePoint[] | null = null;
  private lesson: 'trace' | 'shutter' | null = 'trace';
  private nextTime: 'haste' | 'slow' = 'haste';
  private history: { x: number; y: number; t: number }[] = [];
  private sampleT = 0;
  private lastPick = '';
  private rewindCd = 6;
  private intro = false;
  private introProgress = 0;

  constructor(w: World, tier: number) {
    super(w, tier, 320, 128, 2200);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, this.x, this.y, 13, 20, 16));
    this.body.conductive = true;
  }

  think(w: World, dt: number): void {
    if (w.state !== 'fight') { this.stop(); archiveOf(w)?.clearHostile(); }
    if (!this.staggered && !this.inTransition && (this.moveX || this.moveY)) {
      w.moveCircle(this.body, this.moveX * dt, this.moveY * dt, { ignore: this.body });
    }
    this.x = this.body.x; this.y = this.body.y;
    this.face = angleTo(this.x, this.y - 20, w.target().hx, w.target().hy);
    this.rewindCd = Math.max(0, this.rewindCd - dt);
    this.sampleT -= dt;
    if (this.sampleT <= 0) { this.sampleT = 0.15; this.history.push({ x: this.x, y: this.y, t: this.clock }); }
    while (this.history.length && this.history[0].t < this.clock - 4) this.history.shift();
    const st = archiveOf(w);
    this.status = [st?.time.label, st?.rush?.label || (st?.stored ? T.stored : `${T.replay} ${st?.pending.filter(e => !e.dead).length ?? 0}/2`)].filter(Boolean).join(' · ');
  }

  private stop(): void { this.moveX = this.moveY = 0; this.pose = 'idle1'; this.recording = null; }
  onStagger(w: World): void { this.stop(); archiveOf(w)?.clearHostile(); archiveOf(w)?.time.restore(); }
  onDeath(w: World): void { this.stop(); archiveOf(w)?.clearHostile(); archiveOf(w)?.time.restore(); }

  *entrance(w: World): Script {
    this.intro = true;
    const start = this.clock;
    try {
      w.sfx('charge', 0.8);
      while (this.clock - start < 2.4) {
        this.introProgress = (this.clock - start) / 2.4;
        yield;
      }
      w.fx.ring(this.x, this.y - 20, 8, 72, P.ice, 0.4, 2); w.sfx('emp');
    } finally {
      this.intro = false; this.introProgress = 0; this.stop(); this.invuln = false;
      this.x = this.body.x = 320; this.y = this.body.y = 128;
    }
  }

  *transition(w: World, phase: number): Script {
    this.stop(); archiveOf(w)?.clearHostile(); archiveOf(w)?.time.restore(); this.invuln = true;
    this.nextTime = phase === 1 ? 'slow' : 'haste';
    this.lesson = phase === 1 ? 'shutter' : 'trace';
    try {
      w.fx.label(this.x, this.y - 62, phase === 1 ? T.phase2 : T.phase3, P.ice, 1.2);
      w.fx.ring(this.x, this.y - 20, 10, 90, P.cyan, 0.5, 3);
      yield* this.wait(0.75);
    } finally { this.invuln = false; this.stop(); }
  }

  *brain(w: World): Script {
    yield* this.wait(0.5);
    for (;;) {
      const st = archiveOf(w);
      // Give a return-to-the-past challenge an unobstructed beat of its own.
      if (st?.busy) {
        if (st.shutterPending) yield* this.wait(0.2);
        else if (this.phase >= 1 && this.rewindCd <= 0) yield* this.rewind();
        else yield* this.approach(this.tele(0.3));
        continue;
      }
      if (st?.time.mode === 'haste') {
        if (st.time.remaining > 1.2 && st.pauseT <= 0) yield* this.hastePursuit();
        else yield* this.approach(this.tele(0.2));
        continue;
      }
      if (st?.time.ready && st.pauseT <= 0) { yield* this.shiftTime(); continue; }
      yield* this.approach(this.tele(0.45));
      const choices = this.phase === 0 ? ['trace', 'hand'] : ['trace', 'hand', 'shutter'];
      const choice = this.lesson ?? w.rng.pick(choices.filter(c => c !== this.lastPick));
      this.lesson = null; this.lastPick = choice;
      if (choice === 'trace') yield* this.stealFootsteps();
      else if (choice === 'shutter') yield* this.archiveShutter();
      else yield* this.borrowedHand();
      yield* this.wait(this.tele(0.65));
    }
  }

  private steer(): void {
    const t = this.w.target(), d = dist(this.x, this.y, t.x, t.y);
    const [nx, ny] = norm(t.x - this.x, t.y - this.y);
    const toward = d > 145 ? 1 : d < 76 ? -0.5 : 0;
    // Keep moving through a cast: acceleration changes his physical presence as well as timers.
    this.moveX = nx * toward * 88 - ny * 42;
    this.moveY = ny * toward * 88 + nx * 42;
    const b = this.w.bounds;
    if (this.x < b.x + 28 && this.moveX < 0 || this.x > b.x + b.w - 28 && this.moveX > 0) this.moveX *= -1;
    if (this.y < b.y + 28 && this.moveY < 0 || this.y > b.y + b.h - 28 && this.moveY > 0) this.moveY *= -1;
  }

  private *approach(seconds: number): Script {
    const end = this.clock + seconds;
    try { while (this.clock < end) { this.steer(); yield; } }
    finally { this.moveX = this.moveY = 0; }
  }

  private *shiftTime(): Script {
    const st = archiveOf(this.w), mode = this.phase === 0 ? 'haste' : this.nextTime;
    if (!st?.time.begin(mode, this.tele(1.3))) return;
    this.stop(); this.pose = 'attack'; this.w.sfx('charge', 0.8);
    let activated = false;
    try {
      while (st.time.charging) yield;
      activated = st.time.mode === mode;
      if (activated) this.nextTime = mode === 'haste' ? 'slow' : 'haste';
    } finally {
      if (!activated) st.time.restore();
      this.stop();
    }
  }

  private *hastePursuit(): Script {
    const st = archiveOf(this.w);
    if (!st || st.time.mode !== 'haste') return;
    const rush = st.startRush(this.phase, this.pace);
    try {
      while (!rush.dead) {
        if (rush.recovering) { this.moveX = this.moveY = 0; this.pose = 'hurt'; }
        else { this.steer(); this.pose = 'attack'; }
        yield;
      }
    } finally { rush.cancel(); this.stop(); }
  }

  private point(): TracePoint {
    const p = this.w.player;
    return { x: p.x, y: p.y - 4, z: p.z, frame: `${p.dir}_idle` };
  }

  private *playMemory(pattern: MemoryPattern, warn: number): Script {
    const st = archiveOf(this.w);
    if (!st) return;
    const c = st.cast(pattern, warn);
    this.pose = 'attack';
    try {
      while (!c.dead) {
        if (pattern.kind !== 'shutter') this.steer();
        yield;
      }
      if (c.completed) st.record(replayMemory(pattern, this.phase));
    } finally { c.cancel(); this.moveX = this.moveY = 0; this.pose = 'idle1'; }
  }

  private *stealFootsteps(): Script {
    const w = this.w, path: TracePoint[] = [this.point()];
    const start = this.clock, duration = this.tele(1.8);
    this.recording = path; this.pose = 'attack';
    let next = start + 0.06;
    w.sfx('charge', 0.5);
    try {
      while (this.clock - start < duration) {
        this.steer();
        if (this.clock >= next) {
          const p = this.point(), last = path[path.length - 1];
          p.cut = dist(last.x, last.y, p.x, p.y) > 40;
          path.push(p); next = this.clock + 0.06;
        }
        yield;
      }
      const end = this.point(), last = path[path.length - 1];
      end.cut = dist(last.x, last.y, end.x, end.y) > 40; path.push(end);
    } finally { this.recording = null; this.moveX = this.moveY = 0; this.pose = 'idle1'; }
    const p: MemoryPattern = { kind: 'trace', x: path[0].x, y: path[0].y, path,
      duration: Math.max(1.5, duration), copies: this.phase >= 2 ? 2 : 1 };
    yield* this.playMemory(p, this.tele(1.05));
  }

  private *archiveShutter(): Script {
    const w = this.w, st = archiveOf(w), p = w.player;
    const old = st?.pastPlayer() ?? { x: p.x, y: p.y - 4, distance: 0 };
    const pattern: MemoryPattern = { kind: 'shutter', x: old.x, y: old.y, r: 52 };
    const rates = st?.time.rates ?? { player: 1, boss: 1 };
    // Return along the distance actually travelled, including detours around racks. The same
    // warning remains reachable in a slow field and keeps its real duration during haste.
    const journey = Math.max(0, old.distance - 32) / (118 * Math.min(1, p.moveMul) * rates.player) + 0.8;
    const warn = Math.max(this.tele(2.4), Math.max(1.8, journey) * rates.boss);
    w.sfx('telegraph');
    yield* this.playMemory(pattern, warn);
  }

  private *borrowedHand(): Script {
    const x = 320, y = 198, span = Math.PI * 1.25;
    const target = angleTo(x, y, this.w.target().hx, this.w.target().hy);
    const pattern: MemoryPattern = { kind: 'hand', x, y, r: 132, a: target - span / 2, sweep: span, duration: 2.7 };
    this.w.sfx('charge', 0.7);
    yield* this.playMemory(pattern, this.tele(1.15));
  }

  private *rewind(): Script {
    const w = this.w;
    const at = this.history.find(p => p.t >= this.clock - 3) ?? { x: this.x, y: this.y };
    const [x, y] = w.clampToBounds(at.x, at.y, 24);
    this.rewindCd = 7;
    const warn = this.tele(1.0);
    this.hazard({ k: 'circle', x, y: y - 4, r: 24 }, warn, 0.12, h => { h.hitsPlayer = false; h.color = P.cyan; h.marker = true; });
    try {
      this.pose = 'hurt'; w.sfx('charge', 0.5); yield* this.wait(warn);
      this.invuln = true;
      w.fx.ghost('kairo', 'idle1', this.x, this.y + 6, { flipX: Math.cos(this.face) < 0, tint: P.cyan, alpha: 0.6 }, 0.3);
      this.body.x = x; this.body.y = y; w.moveCircle(this.body, 0, 0, { ignore: this.body });
      this.x = this.body.x; this.y = this.body.y;
      w.fx.ring(x, y - 20, 4, 35, P.cyan, 0.25, 2); w.sfx('blink');
      yield* this.wait(0.15);
    } finally { this.invuln = false; this.pose = 'idle1'; }
    yield* this.wait(this.tele(0.7));
  }

  draw(g: Gfx): void {
    g.ellipse(this.x, this.y + 1, 17, 7, P.ink, 0.5);
    const frame = this.body.flash > 0 || this.staggered ? 'hurt' : this.pose === 'idle1' ? (Math.floor(this.clock * 4) % 2 ? 'idle2' : 'idle1') : this.pose;
    if (this.intro) {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 - this.introProgress * Math.PI * 2;
        const r = 52 * (1 - this.introProgress);
        g.img('kairo', 'idle1', this.x + Math.cos(a) * r, this.y + 6 + Math.sin(a) * r * 0.5,
          { alpha: 0.25 + this.introProgress * 0.15, tint: P.cyan, flipX: true });
      }
    }
    if (archiveOf(this.w)?.time.mode === 'haste' && !this.staggered) {
      const count = Math.min(4, this.history.length);
      for (let i = 0; i < count; i++) {
        const q = this.history[this.history.length - count + i];
        if (dist(q.x, q.y, this.x, this.y) < 3) continue;
        g.img(this.phase >= 1 ? 'kairo_broken' : 'kairo', frame, q.x, q.y + 6,
          { flipX: Math.cos(this.face) < 0, tint: P.amber, alpha: 0.07 + i * 0.045 });
      }
    }
    g.img(this.phase >= 1 ? 'kairo_broken' : 'kairo', frame, this.x, this.y + 6,
      { flipX: Math.cos(this.face) < 0, alpha: this.intro ? this.introProgress : 1, fill: this.body.flash > 0 ? P.white : undefined });
    g.circle(this.x, this.y - 35, 12, this.phase >= 2 ? P.magenta : P.cyan, 0.14, 'light');
    if (this.recording) {
      for (let i = 1; i < this.recording.length; i++) {
        const a = this.recording[i - 1], b = this.recording[i];
        if (!b.cut) g.line(a.x, a.y, b.x, b.y, 1, P.cyan, 0.7, 'top');
        if (i % 3 === 0) g.img('pc_echo', b.frame, b.x, b.y + 4 - b.z, { layer: 'top', tint: P.cyan, alpha: 0.18 });
      }
      g.crisp(T.recording, this.x, this.y - 72, { color: P.cyan, layer: 'top', align: 'center' });
      g.circle(this.w.player.x, this.w.player.y - 9, 8 + Math.sin(this.clock * 8), P.cyan, 0.1, 'light');
    }
    if (this.staggered) g.ring(this.x, this.y - 60, 11, 2, P.amber, 0.8, 'top');
  }
}

export const kairoDef: BossDef = {
  id: 'kairo', arena: archive, spawn: { x: 320, y: 128 }, make: (w, tier) => new Kairo(w, tier),
  drop: 'head_reflex', hint: T.hint, portrait: { key: 'standee', frame: 'kairo' },
  music: { bpm: 120, kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    bass: [0, null, 7, null, 0, null, 3, null, 0, null, 10, null, 7, null, 3, null],
    lead: [12, null, null, 19, null, null, 15, null, 12, null, 10, null, null, null, 7, null],
    root: 38, chords: [0, 0, 3, 7], wave: 'triangle' },
};
