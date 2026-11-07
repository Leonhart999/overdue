/** The archive's independent actor clocks and visible, simulation-driven time instruments. */
import { KAIRO_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { clamp } from '../../engine/math';
import type { TimeRates, World } from '../world';
import { ARCHIVE_LAYOUT } from './archiveLayout';

export type TimeMode = 'normal' | 'haste' | 'slow';
export const HASTE_RATE = 2.2;
const RATES: Record<TimeMode, TimeRates> = {
  normal: { player: 1, boss: 1 }, haste: { player: 1, boss: HASTE_RATE }, slow: { player: 0.55, boss: 1 },
};
const FIELD_DURATION = 9;
const TAU = Math.PI * 2;

export class ArchiveTime {
  mode: TimeMode = 'normal';
  charging: Exclude<TimeMode, 'normal'> | null = null;
  remaining = 0;
  cooldown = 0.1;
  private chargeLength = 1;
  private skyTime = 10;
  private clockTime = 0;
  private lampTime = 0;
  private chargeTime = 0;
  private readonly lamps: { x: number; y: number; horizontal: boolean }[] = [];

  constructor() {
    // Clockwise circuit: top -> right -> bottom -> left. Each lamp retains its place in time.
    const width = 576, height = 222, perimeter = 2 * (width + height);
    for (let i = 0; i < 60; i++) {
      const t = i * perimeter / 60;
      this.lamps.push(t < width ? { x: 32 + t, y: 110, horizontal: true }
        : t < width + height ? { x: 608, y: 110 + t - width, horizontal: false }
        : t < 2 * width + height ? { x: 608 - (t - width - height), y: 332, horizontal: true }
        : { x: 32, y: 332 - (t - 2 * width - height), horizontal: false });
    }
  }

  get rates(): TimeRates { return RATES[this.mode]; }
  get ready(): boolean { return this.mode === 'normal' && !this.charging && this.cooldown <= 0; }
  get label(): string { return this.charging ? T.synchronizing : this.mode === 'haste' ? T.haste : this.mode === 'slow' ? T.slow : ''; }
  get color(): number { return (this.charging ?? this.mode) === 'haste' ? P.amber : P.ice; }

  begin(mode: Exclude<TimeMode, 'normal'>, windup: number): boolean {
    if (!this.ready) return false;
    this.charging = mode; this.chargeLength = Math.max(1.2, windup);
    this.chargeTime = this.chargeLength;
    return true;
  }

  restore(cooldown = 7): void {
    this.mode = 'normal'; this.charging = null; this.remaining = 0; this.chargeTime = 0;
    this.cooldown = Math.max(this.cooldown, cooldown);
  }

  update(w: World, dt: number): void {
    const boss = w.boss;
    if (w.state !== 'fight' || boss?.dying || boss?.staggered || boss?.inTransition) {
      // Do not spend the opening cooldown while the entrance runs.
      this.restore(w.state === 'intro' ? this.cooldown : 7);
      if (w.state === 'lost' || w.state === 'won') return;
    } else if (this.charging) {
      this.chargeTime = Math.max(0, this.chargeTime - dt);
      if (this.chargeTime <= 0) {
        this.mode = this.charging; this.charging = null; this.remaining = FIELD_DURATION;
        w.fx.ring(320, 198, 12, 300, this.color, 0.65, 2);
        w.sfx(this.mode === 'haste' ? 'phase' : 'emp', 0.7);
      }
    } else if (this.mode !== 'normal') {
      this.remaining -= dt;
      if (this.remaining <= 0) this.restore();
    } else this.cooldown = Math.max(0, this.cooldown - dt);

    const haste = this.mode === 'haste', slow = this.mode === 'slow';
    this.skyTime = (this.skyTime + dt * (haste ? 32 : slow ? 0.03 : 1)) % 72;
    this.clockTime = (this.clockTime + dt * (haste ? 36 : slow ? 0 : 1)) % 43200;
    this.lampTime = (this.lampTime + dt * (haste ? 12 : slow ? 0.12 : 1)) % 10;
  }

  drawFloor(g: Gfx): void {
    const floor = ARCHIVE_LAYOUT.bounds;
    const phase = this.skyTime / 72, elevation = Math.sin(phase * TAU);
    const day = clamp(elevation * 2 + 0.15, 0, 1), dusk = Math.max(0, 1 - Math.abs(elevation) * 5);
    // Light changes underneath every hazard and actor; warning colours are never covered.
    g.rect(floor.x, floor.y, floor.w, floor.h, P.navy, (1 - day) * 0.22, 'floor');
    g.rect(floor.x, floor.y, floor.w, floor.h, P.amber, day * 0.08, 'floor');
    for (let i = 0; i < 3; i++) {
      const x = 148 + i * 122, drift = (phase * 2 % 1 - 0.5) * 120;
      g.poly([x, floor.y, x + 72, floor.y, x + 116 + drift, 329, x + drift, 329], P.amber, day * 0.09, 'floor');
    }

    // Panoramic window: sky, sun/moon, stars and a silhouetted skyline.
    g.rect(128, 57, 384, 43, P.ink, 1, 'floor');
    g.rect(132, 60, 376, 36, P.night, 1, 'floor');
    g.rect(132, 60, 376, 36, P.teal, day * 0.9, 'floor');
    g.rect(132, 80, 376, 16, P.sodium, dusk * 0.8, 'floor');
    for (let i = 0; i < 19; i++) {
      const x = 139 + (i * 71 % 360), y = 63 + (i * 11 % 19);
      g.rect(x, y, 1, 1, P.pale, (1 - day) * 0.8, 'floor');
    }
    const celestial = (cycle: number, moon: boolean): void => {
      if (cycle >= 0.5) return;
      const x = 139 + cycle * 2 * 360, y = 88 - Math.sin(cycle * TAU) * 22;
      g.circle(x, y, moon ? 5 : 7, moon ? P.ice : P.amber, 1, 'floor');
      if (moon) g.circle(x + 3, y - 2, 4, P.night, 1, 'floor');
    };
    celestial(phase, false); celestial((phase + 0.5) % 1, true);
    for (let i = 0; i < 24; i++) {
      const x = 133 + i * 16, h = 6 + (i * 13 % 15);
      g.rect(x, 97 - h, 13, h, P.navy, 1, 'floor');
      for (let row = 0; row < Math.floor(h / 5); row++) {
        g.rect(x + 3, 100 - h + row * 5, 2, 2, P.amber, (1 - day) * (i % 3 ? 0.9 : 0.25), 'floor');
        g.rect(x + 8, 100 - h + row * 5, 2, 2, P.ice, (1 - day) * 0.55, 'floor');
      }
    }
    for (const x of [128, 254, 382, 508]) g.rect(x, 57, 4, 43, P.steel, 1, 'floor');
    g.line(128, 99, 512, 99, 2, P.fog, 0.8, 'floor');
    if (this.mode !== 'normal') {
      g.rect(244, 102, 152, 2, P.slate, 0.8, 'floor');
      g.rect(244, 102, 152 * clamp(this.remaining / FIELD_DURATION, 0, 1), 2, this.color, 0.9, 'floor');
    }

    this.dial(g, 320, 198, 94, 0, true);
    this.dial(g, 62, 190, 19, 10800);
    this.dial(g, 578, 190, 19, 21600);
    const head = this.lampTime * 6;
    for (let i = 0; i < this.lamps.length; i++) {
      const lamp = this.lamps[i], behind = (head - i + 60) % 60;
      const strength = behind < 4 ? 1 - behind / 4 : 0;
      const color = this.mode === 'normal' && !this.charging ? P.teal : this.color;
      const w = lamp.horizontal ? 8 : 3, h = lamp.horizontal ? 3 : 8;
      g.rect(Math.round(lamp.x - w / 2) - 1, Math.round(lamp.y - h / 2) - 1, w + 2, h + 2, P.ink, 1, 'floor');
      g.rect(Math.round(lamp.x - w / 2), Math.round(lamp.y - h / 2), w, h, strength > 0 ? color : P.slate, strength > 0 ? 0.3 + strength * 0.7 : 0.5, 'floor');
      if (strength > 0.1) g.circle(lamp.x, lamp.y, 8, color, strength * 0.17, 'light');
    }
  }

  private dial(g: Gfx, x: number, y: number, r: number, offset: number, large = false): void {
    const color = this.mode === 'normal' ? P.fog : this.color;
    g.ring(x, y, r, large ? 1 : 2, color, large ? 0.35 : 0.8, 'floor');
    if (!large) g.circle(x, y, r - 2, P.night, 0.8, 'floor');
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12 - Math.PI / 2;
      g.line(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4), x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1), 1, color, 0.6, 'floor');
    }
    for (const [period, length, width] of [[43200, r * 0.44, 3], [3600, r * 0.68, 2], [60, r * 0.93, 1]]) {
      const a = (this.clockTime + offset) / period * TAU - Math.PI / 2;
      g.line(x, y, x + Math.cos(a) * length, y + Math.sin(a) * length, width, color, large ? 0.45 : 0.95, 'floor');
    }
    g.circle(x, y, large ? 4 : 2, color, 0.8, 'floor');
  }

  drawTop(g: Gfx, w: World): void {
    if (this.charging) {
      const p = 1 - this.chargeTime / this.chargeLength;
      g.ring(320, 198, 108 + (1 - p) * 30, 2, this.color, 0.5, 'top');
      g.sector(320, 198, 111, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, p * TAU), this.color, 0.7, 'top', 108);
      g.crisp(this.charging === 'haste' ? T.haste : T.slow, 320, 111, { color: this.color, align: 'center', layer: 'top' });
    }
    if (this.mode === 'slow') {
      const p = w.player;
      g.ellipse(p.x, p.y + 1, 13, 5, P.ice, 0.18, 'floor');
      g.ring(p.x, p.y - 13, 19, 1, P.ice, 0.3, 'top');
      g.line(p.x, p.y - 13, p.x, p.y - 24, 1, P.ice, 0.6, 'top');
      g.line(p.x, p.y - 13, p.x + 7, p.y - 13, 1, P.ice, 0.6, 'top');
    }
  }
}
