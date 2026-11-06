/** Arena promises (the hint line shown at fight start) as regression tests. */
import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/engine/input';
import { BOSS_DEFS } from '../src/game/bosses';
import { newLoadout, type BossId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { yardOf } from '../src/game/arenas/scrapyard';
import { CarStack, Lever } from '../src/game/props';
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
  const run = (s: number) => { for (let i = 0; i < s * 60; i++) w.step(1 / 60, inp); };
  run(0.5);
  return { w, run };
}

const byName = (w: World, name: string) => w.bodies.filter((b) => b.constructor.name === name);

describe('arena interactions', () => {
  it('gearjaw: a lever drops the crane load; hitting him staggers and damages him', () => {
    const { w, run } = fight('gearjaw');
    const b = w.boss!;
    const crane = w.objects.find((o) => o.constructor.name === 'Crane') as unknown as { x: number; y: number };
    // park the boss under the crane path and keep him busy standing still
    const lever = w.bodies.find((o) => o instanceof Lever)!;
    lever.onInteract!(w);
    for (let i = 0; i < 60 * 1.2; i++) { b.x = crane.x; b.y = crane.y; b.parts[0].x = b.x; b.parts[0].y = b.y; w.step(1 / 60, emptyInput()); }
    expect(b.hp).toBeLessThan(b.maxHp - 300);
    expect(b.staggered || b.inTransition || b.phase > 0).toBe(true);
    run(0.1);
  });

  it('gearjaw: corner heaps and car stacks are walls; a ram crash knocks a stack down', () => {
    const { w } = fight('gearjaw');
    expect(w.pointInWall(24, 56)).toBe(true); // top-left scrap heap
    expect(w.pointInWall(600, 328)).toBe(true); // bottom-right scrap heap
    const stack = w.bodies.find((b) => b instanceof CarStack) as CarStack;
    expect(w.pointInWall(stack.x, stack.y)).toBe(true);
    const hold = yardOf(w)!.onRamWall(w, stack.x + stack.fw / 2 + 26, stack.y, 26);
    expect(hold).toBe(0);
    expect(stack.dead).toBe(true);
    expect(w.pointInWall(stack.x, stack.y)).toBe(false);
  });

  it('gearjaw: three blasts knock a car stack down', () => {
    const { w } = fight('gearjaw');
    const stack = w.bodies.find((b) => b instanceof CarStack) as CarStack;
    for (let i = 0; i < 3; i++) w.explode(stack.x, stack.y - 20, 30, { enemyDmg: 0, from: 'player', src: 'test' });
    expect(stack.dead).toBe(true);
  });

  it('gearjaw: P3 plates push in; a pinned boss takes the slam', () => {
    const { w, run } = fight('gearjaw');
    const b = w.boss!;
    b.phase = 2;
    run(4);
    const c = yardOf(w)!.compactor;
    expect(c.state).toBe('set');
    expect(w.pointInWall(40, 200)).toBe(true);
    const r = b.parts[0].r;
    expect(c.pin(w, c.face(0) + r, 200, r)).toBe(2);
    b.x = c.face(0) + r; b.y = 200;
    for (const pt of b.parts) { pt.x = b.x; pt.y = b.y; }
    const hp = b.hp;
    const button = w.bodies.find((o) => o.constructor.name === 'PlateButton')!;
    w.damage(button, { dmg: 5, kind: 'bullet', x: button.x, y: button.y, from: 'player', src: 'test' });
    expect(hp - b.hp).toBeGreaterThanOrEqual(300);
    expect(c.ready(0)).toBe(false);
  });

  it('lux: a breaker blacks out the stage and removes the clones', () => {
    const { w, run } = fight('lux');
    run(2);
    const lux = w.boss as unknown as { clones: { live: boolean }[] };
    const breaker = byName(w, 'Breaker')[0];
    breaker.onInteract!(w);
    run(0.3);
    expect(lux.clones.filter((c) => c.live).length).toBe(0);
  });

  it('octohydra: a conduit electrifies the water', () => {
    const { w, run } = fight('octohydra');
    const box = byName(w, 'ConduitBox')[0] as unknown as { fire(w: World): boolean };
    expect(box.fire(w)).toBe(true);
    run(1.5);
    expect(w.zones.some((z) => z.kind === 'water' && z.electrified > 0) || (w.objects.some((o) => (o as { state?: string }).state === 'live'))).toBe(true);
  });

  it('kade: a hacked turret fights for the player', () => {
    const { w, run } = fight('kade');
    const turret = byName(w, 'Turret')[0] as unknown as { onHack(w: World): void; side: string };
    turret.onHack(w);
    expect(turret.side).toBe('player');
    let shots = 0;
    const add = w.addBullet.bind(w);
    w.addBullet = (bl) => { if (bl.src === 'turret' && bl.team === 'player') shots++; return add(bl); };
    run(6);
    expect(shots).toBeGreaterThan(5);
  });
});
