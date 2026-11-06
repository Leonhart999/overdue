/** Madame Lux's wide club: zones, low cover, glass, turntable, breakers, DJ console, her relocation. */
import { describe, expect, it } from 'vitest';
import { buildLuxArt } from '../src/art/lux';
import { emptyInput } from '../src/engine/input';
import { BOSS_DEFS } from '../src/game/bosses';
import { newLoadout, type BossId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { Bullet } from '../src/game/bullet';
import { COUNTER, findStage, GLASS_X, MAP, TABLE, traceBeam, Turntable, zoneOf, type ClubStage } from '../src/game/arenas/club';
import { World } from '../src/game/world';

function fight(boss: BossId, seed = 1) {
  const def = BOSS_DEFS[boss]!;
  const w = new World(def.arena, 1, seed);
  w.player = new Player(newLoadout('arc'), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  w.player.maxHp = w.player.hp = 99;
  def.arena.setup(w);
  w.boss = def.make(w, 1);
  w.state = 'fight';
  const inp = emptyInput();
  const run = (s: number, each?: () => void) => { for (let i = 0; i < s * 60; i++) { w.step(1 / 60, inp); each?.(); } };
  run(0.5);
  return { w, run, st: findStage(w) as ClubStage };
}

type LuxView = { x: number; y: number; phase: number; vulnMul: number; offT: number; clones: { live: boolean; zone: string; x: number }[]; laser: { warn: boolean; a0: number; path: { pts: [number, number][] } } | null };
const lux = (w: World) => w.boss as unknown as LuxView;
const polar = (x: number, y: number) => Math.atan2(y - TABLE.y, x - TABLE.x);
const onLattice = (a: number) => Math.abs(a / (Math.PI / 4) - Math.round(a / (Math.PI / 4))) < 1e-6;
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

describe('club layout', () => {
  it('is a 1280x360 scrolling map with a background of that size', () => {
    const { w } = fight('lux');
    expect(w.scrolls).toBe(true);
    expect(w.size).toEqual(MAP);
    const bg = buildLuxArt().find((s) => s.key === 'bg_club')!;
    expect([bg.frameW, bg.frameH, bg.frames[0].buf.w, bg.frames[0].buf.h]).toEqual([1280, 360, 1280, 360]);
  });

  it('walls: west back wall with two booths, glass with two doorways; the counter is not a wall', () => {
    const { w } = fight('lux');
    expect(w.pointInWall(200, 70)).toBe(true); // back bar wall
    expect(w.pointInWall(120, 70)).toBe(false); // booth A
    expect(w.pointInWall(280, 70)).toBe(false); // booth B
    expect(w.pointInWall(200, 100)).toBe(false); // behind the bar
    expect(w.pointInWall(GLASS_X, 80)).toBe(true);
    expect(w.pointInWall(GLASS_X, 200)).toBe(true);
    expect(w.pointInWall(GLASS_X, 320)).toBe(true);
    expect(w.pointInWall(GLASS_X, 136)).toBe(false); // doorway 1
    expect(w.pointInWall(GLASS_X, 256)).toBe(false); // doorway 2
    expect(w.pointInWall(200, COUNTER.y + 4)).toBe(false);
    expect(w.pointInWall(640, 220)).toBe(false);
    expect([zoneOf(200), zoneOf(640), zoneOf(1000)]).toEqual(['west', 'centre', 'vip']);
  });

  it('counter: blocks walking and her soft bullets, leap legs pass over it, bottles break', () => {
    const { w, run, st } = fight('lux');
    const p = w.player;
    p.invuln = 99;
    p.x = 200; p.y = COUNTER.y + 6;
    run(1 / 60);
    expect(p.y < COUNTER.y - p.r + 0.01 || p.y > COUNTER.y + COUNTER.h + p.r - 0.01).toBe(true);
    p.x = 200; p.y = COUNTER.y + 6; p.airborne = true;
    run(1 / 60);
    expect(p.y).toBeCloseTo(COUNTER.y + 6, 3);
    p.airborne = false;
    p.x = 200; p.y = 300;
    const soft = w.addBullet(new Bullet(150, COUNTER.y - 2, 0, 0, 'enemy'));
    const hard = w.addBullet(new Bullet(250, COUNTER.y - 2, 0, 0, 'enemy'));
    hard.soft = false;
    run(1 / 60);
    expect(soft.dead).toBe(true);
    expect(hard.dead).toBe(false);
    const b0 = st.bottles[3];
    w.addBullet(new Bullet(b0.x, COUNTER.y - COUNTER.top - 4, 0, 0, 'player'));
    run(1 / 60);
    expect(b0.broken).toBe(true);
  });
});

describe('turntable', () => {
  it('P1 is still; from P2 it turns and carries a grounded player (not an airborne one)', () => {
    const { w, run, st } = fight('lux');
    const p = w.player;
    p.invuln = 99;
    const t = st.table;
    const a0 = t.angle;
    run(1);
    expect(t.angle).toBeCloseTo(a0, 6);
    lux(w).phase = 1;
    p.x = TABLE.x + 50; p.y = TABLE.y;
    run(1 / 60);
    const rel = polar(p.x, p.y) - t.angle;
    const before = t.angle;
    run(1.5);
    expect(t.angle - before).toBeGreaterThan(0.2);
    expect(Math.abs(angDiff(polar(p.x, p.y) - t.angle, rel))).toBeLessThan(0.02);
    expect(Math.hypot(p.x - TABLE.x, p.y - TABLE.y)).toBeCloseTo(50, 0);
    // airborne: left behind
    p.airborne = true;
    const [x, y] = [p.x, p.y];
    run(0.5);
    p.airborne = false;
    if (Math.abs(t.delta) > 0) expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(0.5);
  });

  it('a laser hold locks it on a multiple of 45 deg with every mirror on the lattice; it stays put while held', () => {
    const { w, run, st } = fight('lux');
    lux(w).phase = 1;
    const t = st.table;
    run(0.9);
    expect(onLattice(t.angle)).toBe(false);
    t.holds++;
    run(1.5);
    expect(t.locked).toBe(true);
    expect(onLattice(t.angle)).toBe(true);
    for (const m of st.mirrors) expect(onLattice(m.plane)).toBe(true);
    const held = t.angle;
    run(1);
    expect(t.angle).toBe(held);
    t.holds--;
    // released (on its own, without the boss's own laser holds): it turns again
    const free = new Turntable();
    free.base = 0.35;
    free.holds = 1;
    for (let i = 0; i < 30; i++) free.step(1 / 60, false);
    expect(free.locked).toBe(true);
    free.holds = 0;
    free.step(1 / 60, false);
    expect(free.delta).toBeGreaterThan(0);
  });

  it('her laser telegraph is the real traced beam, fired with the turntable locked', () => {
    const { w, run, st } = fight('lux', 3);
    lux(w).phase = 1;
    w.player.invuln = 99;
    let seen = 0;
    run(40, () => {
      const L = lux(w).laser;
      if (!L || !L.warn) return;
      seen++;
      expect(st.table.locked).toBe(true);
      expect(onLattice(st.table.angle)).toBe(true);
      const real = traceBeam(w, st.mirrors, lux(w).x, lux(w).y, L.a0);
      expect(real.pts).toEqual(L.path.pts);
    });
    expect(seen).toBeGreaterThan(30);
  });
});

describe('glass partition', () => {
  it('a head-on laser passes, a slanted one reflects, a doorway is open', () => {
    const { w, st } = fight('lux');
    const pass = traceBeam(w, st.mirrors, 800, 200, 0);
    expect(pass.glassPasses.length).toBe(1);
    expect(pass.glassBounces.length).toBe(0);
    expect(pass.pts.length).toBe(2);
    expect(pass.pts[1][0]).toBeGreaterThan(1200);
    const slant = traceBeam(w, st.mirrors, 820, 160, Math.PI / 4);
    expect(slant.glassBounces.length).toBe(1);
    expect(slant.pts[1][0]).toBeCloseTo(GLASS_X, 3);
    expect(slant.pts[2][0]).toBeLessThan(GLASS_X); // came back into the dance floor
    const door = traceBeam(w, st.mirrors, 800, 136, 0);
    expect(door.glassPasses.length + door.glassBounces.length).toBe(0);
    expect(door.pts[1][0]).toBeGreaterThan(1200);
  });

  it('blocks bullets', () => {
    const { w, run } = fight('lux');
    const b = w.addBullet(new Bullet(GLASS_X - 8, 200, 300, 0, 'enemy'));
    run(0.1);
    expect(b.dead).toBe(true);
  });
});

describe('club devices', () => {
  it('either breaker blacks out the whole club: clones gone, turntable stopped, x1.5', () => {
    const { w, run, st } = fight('lux');
    lux(w).phase = 1;
    run(3);
    expect(lux(w).clones.filter((c) => c.live).length).toBeGreaterThan(0);
    const east = st.breakers[1];
    expect(east.x).toBeGreaterThan(1000);
    w.player.x = 300; w.player.y = 300; // far from it: the blackout is global anyway
    east.onInteract!(w);
    run(0.3);
    expect(st.dark).toBe(true);
    expect(lux(w).clones.filter((c) => c.live).length).toBe(0);
    expect(lux(w).vulnMul).toBe(1.5);
    const a = st.table.angle;
    run(1);
    if (!st.table.holds) expect(st.table.angle).toBe(a);
    // shared cooldown: the other breaker does nothing
    run(4);
    expect(st.dark).toBe(false);
    expect(st.trip(w, st.breakers[0])).toBe(false);
  });

  it('DJ console: spins a still turntable for 6 s, reverses a turning one, 12 s cooldown', () => {
    const { w, run, st } = fight('lux');
    const t = st.table, dj = st.dj!;
    w.player.invuln = 99;
    dj.onInteract!(w);
    run(1);
    expect(t.delta).toBeGreaterThan(0);
    expect(st.scratch(w)).toBe(false);
    run(5.5);
    expect(t.delta).toBe(0);
    run(6);
    lux(w).phase = 1;
    run(0.2);
    if (!t.holds) expect(t.delta).toBeGreaterThan(0);
    expect(st.scratch(w)).toBe(true);
    run(0.5);
    if (!t.holds) expect(t.delta).toBeLessThan(0);
  });

  it('projectors per phase: P1 runs one per side zone, so the two clones are in different zones', () => {
    const { w, run, st } = fight('lux');
    run(3);
    expect(st.projectors.filter((p) => p.active).map((p) => p.zone)).toEqual(['west', 'vip']);
    const zones = lux(w).clones.filter((c) => c.live).map((c) => c.zone).sort();
    expect(zones).toEqual(['vip', 'west']);
    lux(w).phase = 1;
    run(0.1);
    expect(st.projectors.filter((p) => p.active).length).toBe(3);
    lux(w).phase = 2;
    run(0.1);
    expect(st.projectors.filter((p) => p.active).length).toBe(4);
  });

  it('Lux off screen for more than 4 s comes back next to the player', () => {
    const { w, run } = fight('lux');
    const p = w.player;
    p.invuln = 99;
    p.x = 60; p.y = 300;
    run(0.5);
    const L = lux(w) as unknown as { x: number; y: number; body: { x: number; y: number } };
    L.x = L.body.x = 1200; L.y = L.body.y = 200;
    let back = -1;
    run(9, () => { p.x = 60; p.y = 300; if (back < 0 && w.stateT > 0 && w.onScreen(L.x, L.y - 30) && lux(w).offT === 0) back = w.time; });
    expect(back).toBeGreaterThan(0);
    expect(Math.abs(L.x - p.x)).toBeLessThan(640);
  });
});
