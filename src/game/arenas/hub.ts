/**
 * Hub (据点): the room between runs. Same engine as a fight, without a boss.
 * Stations call back into the HubScene through `HubHooks`.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { dist } from '../../engine/math';
import { WEAPON_TEXT } from '../../data/text';
import { Body } from '../body';
import { Bullet } from '../bullet';
import { Zone } from '../hazard';
import { WEAPONS, type WeaponId } from '../loadout';
import { Barrel, Lever, Pillar } from '../props';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

export interface HubHooks {
  current(): WeaponId;
  swapWeapon(id: WeaponId): void;
  openBench(): void;
  openRecords(): void;
  openSim(): void;
  depart(): void;
}

/** Generic station: an interactable body drawn from the `hub` sheet. */
class Station extends Body {
  constructor(x: number, y: number, r: number, public frame: string, label: string, private act: (w: World) => void, solid = true) {
    super();
    this.x = x; this.y = y; this.r = r; this.hz = 10; this.hr = r;
    this.mass = 0;
    this.solid = solid;
    this.targetable = false;
    this.interactable = true;
    this.interactLabel = label;
  }
  onInteract(w: World): void { w.sfx('uiConfirm'); this.act(w); }
  draw(g: Gfx, _w?: World): void {
    g.ellipse(this.x, this.y, this.r + 2, 4, P.ink, 0.45, 'floor');
    g.img('hub', this.frame, this.x, this.y + 3);
  }
}

class WeaponRack extends Station {
  constructor(x: number, y: number, readonly weapon: WeaponId, private hooks: HubHooks) {
    super(x, y, 7, 'rack', `拿起 ${WEAPON_TEXT[weapon].name}`, () => hooks.swapWeapon(weapon));
  }
  draw(g: Gfx, w: World): void {
    super.draw(g);
    const held = this.hooks.current() === this.weapon;
    if (!held) g.img('wpn', this.weapon, this.x, this.y - 16, { ox: 0.5, oy: 0.5, depth: this.y + 4, rot: -Math.PI / 2 });
    const near = dist(w.player.x, w.player.y, this.x, this.y) < 40;
    g.text(WEAPON_TEXT[this.weapon].name, this.x, this.y + 4, { color: held ? COL.player : near ? P.pale : P.slate, align: 'center' });
  }
}

/** Training dummy: shows DPS and a poise bar, staggers like a boss. */
class Dummy extends Body {
  private log: { t: number; d: number }[] = [];
  poise = 0;
  private lastHit = -9;
  staggerT = 0;
  private hitT = 0;
  private wob = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.team = 'enemy';
    this.r = 10; this.hz = 18; this.hr = 12;
    this.mass = 0;
    this.solid = true;
    this.conductive = true;
  }
  update(w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.jamT > 0) this.jamT -= dt;
    this.wob *= Math.exp(-6 * dt);
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0) this.poise = 0;
    } else if (w.time - this.lastHit > 2) this.poise = Math.max(0, this.poise - 25 * dt);
    this.log = this.log.filter((e) => w.time - e.t < 3);
  }
  hurt(w: World, h: Hit): number {
    const dmg = h.dmg * (this.staggerT > 0 ? 1.5 : 1);
    this.log.push({ t: w.time, d: dmg });
    this.lastHit = w.time;
    if (!h.quiet) {
      this.flash = 0.05;
      this.hitT = 0.15;
      this.wob = Math.min(4, this.wob + 1.5);
      w.fx.number(this.id * 10, h.x, h.y, dmg, h.from === 'env' ? P.amber : this.staggerT > 0 ? P.rose : P.white, dmg >= 60);
      w.sfx('bossHit');
    }
    if (this.staggerT <= 0 && h.poise) {
      this.poise += h.poise;
      if (this.poise >= 100) {
        this.poise = 100;
        this.staggerT = 3;
        w.fx.label(this.x, this.y - 40, '瘫痪', P.amber, 1.2);
        w.sfx('stagger');
      }
    }
    return dmg;
  }
  private jamT = 0;
  /** Jack arm on the dummy: no boss to slow, so it just shows the hack running. */
  onHack(w: World): void { this.jamT = 4; w.fx.label(this.x, this.y - 40, '干扰 4 秒', P.acid, 1); }

  private dps(w: World): number {
    if (!this.log.length) return 0;
    const span = Math.max(1, Math.min(3, w.time - this.log[0].t));
    return this.log.reduce((s, e) => s + e.d, 0) / span;
  }
  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y, 12, 4, P.ink, 0.5, 'floor');
    const rot = Math.sin(w.time * 30) * this.wob * 0.03;
    g.img('hub', this.hitT > 0 ? 'dummy_hit' : 'dummy', this.x, this.y + 3, { rot, fill: this.flash > 0 ? P.pale : undefined });
    const d = this.dps(w);
    const by = this.y - 48;
    g.rect(this.x - 20, by, 40, 3, P.ink, 1, 'top');
    g.rect(this.x - 20, by, 40 * (this.staggerT > 0 ? this.staggerT / 3 : this.poise / 100), 3, this.staggerT > 0 ? P.white : P.amber, 1, 'top');
    g.text(d > 0 ? `每秒 ${Math.round(d)}` : '训练假人', this.x, by - 14, { color: d > 0 ? P.white : P.slate, align: 'center' });
  }
}

/** Practice turret: alternates soft fans and hard bolts while the player is on the range. */
class Turret extends Body {
  on = false;
  private t = 1;
  private n = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.r = 8; this.hz = 12; this.hr = 9;
    this.mass = 0;
    this.solid = true;
    this.targetable = false;
    this.interactable = true;
    this.hackable = true;
    this.interactLabel = '开启练习炮台';
  }
  onInteract(w: World): void {
    this.on = !this.on;
    this.interactLabel = this.on ? '关闭练习炮台' : '开启练习炮台';
    this.t = 0.8;
    w.sfx(this.on ? 'telegraph' : 'click');
  }
  onHack(w: World): void { this.onInteract(w); }
  update(w: World, dt: number): void {
    if (!this.on || w.player.x < 340) return;
    this.t -= dt;
    if (this.t > 0) return;
    const mx = this.x - 14, my = this.y - 12;
    const p = w.player;
    const a = Math.atan2(p.y - 9 - my, p.x - mx);
    const k = this.n++ % 3;
    if (k < 2) {
      for (let i = -2; i <= 2; i++) this.fire(w, mx, my, a + i * 0.22, 125, true);
      this.t = 1.3;
    } else {
      for (let i = 0; i < 3; i++) this.fire(w, mx - i * 8 * Math.cos(a), my - i * 8 * Math.sin(a), a, 230, false);
      this.t = 1.6;
    }
    w.sfx('spray', 0.6);
  }
  private fire(w: World, x: number, y: number, a: number, sp: number, soft: boolean): void {
    const b = new Bullet(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 'enemy');
    b.soft = soft;
    b.frame = soft ? 'orb_o' : 'bolt';
    b.rotates = !soft;
    b.r = soft ? 3 : 2.5;
    b.glow = 5;
    b.glowColor = soft ? COL.soft : COL.hard;
    b.life = 3;
    w.addBullet(b);
  }
  hurt(): number { return 0; }
  draw(g: Gfx, w: World): void {
    g.img('hub', this.on ? 'turret' : 'turret_off', this.x, this.y + 6);
    if (this.on) g.circle(this.x - 1, this.y - 12, 6, P.red, 0.25 + 0.15 * Math.sin(w.realTime * 6), 'light');
  }
}

/** Restores the player's hearts 2 s after the last hit; the player cannot die in the hub. */
class Medic {
  dead = false;
  update(w: World): void {
    const p = w.player;
    p.immortal = true;
    if (p.hp < p.maxHp && w.time - p.lastHurtAt > 2) { p.hp = p.maxHp; w.sfx('heal'); w.fx.ring(p.x, p.y - 9, 4, 16, P.acid, 0.3); }
  }
}

export function makeHubArena(hooks: HubHooks): Arena {
  return {
    id: 'hub',
    bg: 'bg_hub',
    bounds: { x: 16, y: 48, w: 608, h: 288 },
    playerSpawn: { x: 200, y: 200 },
    setup(w: World) {
      WEAPONS.forEach((id, i) => w.add(new WeaponRack(56 + i * 58, 80, id, hooks)));
      w.add(new Station(110, 296, 20, 'bench', '改装义体', () => hooks.openBench()));
      w.add(new Station(196, 300, 10, 'terminal', '查看战绩', () => hooks.openRecords()));
      w.add(new Station(372, 310, 10, 'terminal', '头目模拟器', () => hooks.openSim()));
      w.add(new Station(320, 60, 18, 'elevator', '出发', () => hooks.depart(), false));
      w.add(new Dummy(510, 196));
      w.add(new Pillar(420, 140));
      w.add(new Pillar(420, 256));
      w.add(new Turret(612, 236));
      w.addZone(new Zone('oil', { k: 'circle', x: 470, y: 300, r: 16 }));
      w.add(new Barrel(560, 120));
      w.add(new Lever(612, 120, (ww) => {
        const n = ww.bodies.filter((b) => b instanceof Barrel).length;
        if (n >= 3) { ww.fx.label(560, 110, '最多 3 个', P.fog, 0.8); return false; }
        const [x, y] = [560 + ww.rng.range(-20, 20), 140 + ww.rng.range(-10, 30)];
        ww.add(new Barrel(x, y));
        ww.fx.smoke(x, y, 6, P.slate, 4, 10);
        ww.sfx('land', 0.6);
        return true;
      }, -1));
      w.objects.push(new Medic());
    },
    drawFloor(g: Gfx, w: World) {
      // station labels
      const lab = (s: string, x: number, y: number, c: number = P.slate) => g.text(s, x, y, { color: c, align: 'center' });
      lab('义体台', 110, 304);
      lab('战绩', 196, 304);
      lab('模拟器', 372, 314, P.acid);
      lab('出发', 320, 64, COL.interact);
      lab('训练场', 480, 52);
      // lamp glows
      for (const [x, y, c] of [[110, 270, P.sodium], [196, 278, P.acid], [320, 40, P.red], [126, 60, P.sodium]] as [number, number, number][]) {
        g.circle(x, y, 34, c, 0.06 + 0.015 * Math.sin(w.realTime * 2 + x), 'light');
      }
    },
  };
}
