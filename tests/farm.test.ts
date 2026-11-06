/** Octohydra's scrolling server shaft: levels, gate, per-level conduits, the P2 flood and the P3 chase. */
import { describe, expect, it } from 'vitest';
import { buildOctohydraArt } from '../src/art/octohydra';
import { emptyInput } from '../src/engine/input';
import { BOSS_DEFS } from '../src/game/bosses';
import { newLoadout, type BossId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { ConduitBox, FARM, farmOf, levelOf } from '../src/game/arenas/serverfarm';
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

type PhaseBoss = { goPhase(w: World, phase: number): void; phase: number; x: number; y: number };
const goPhase = (w: World, phase: number) => (w.boss as unknown as PhaseBoss).goPhase(w, phase);

describe('octohydra server shaft', () => {
  it('is a tall scrolling map with a matching background', () => {
    const { w } = fight('octohydra');
    expect(w.scrolls).toBe(true);
    expect(w.size).toEqual({ w: 640, h: 1072 });
    const bg = buildOctohydraArt().find((s) => s.key === 'bg_serverfarm')!;
    expect([bg.frameW, bg.frameH]).toEqual([640, 1072]);
    expect([bg.frames[0].buf.w, bg.frames[0].buf.h]).toEqual([640, 1072]);
    // spawn at the bottom, camera on the bottom screen
    expect(levelOf(w.player.y)).toBe(0);
    w.updateCamera(0, true);
    expect(w.camY).toBe(1072 - 360);
    expect(w.onScreen(w.player.x, w.player.y, 20)).toBe(true);
  });

  it('bulkheads split the levels; ramps through the gaps; the sluice gate shuts L1 in P1', () => {
    const { w } = fight('octohydra');
    expect(w.pointInWall(100, 712)).toBe(true); // L1/L2 bulkhead
    expect(w.pointInWall(320, 376)).toBe(true); // L2/L3 bulkhead (centre)
    expect(w.pointInWall(96, 376)).toBe(false); // left stairs L2 -> L3
    expect(w.pointInWall(544, 376)).toBe(false); // right stairs
    expect(w.pointInWall(320, 712)).toBe(true); // the gate
    expect(w.pointInWall(100, 64)).toBe(true); // alcove cheek
    expect(w.pointInWall(320, 64)).toBe(false); // the alcove itself
    // every head spot is in water on the level it belongs to
    const grid = farmOf(w)!;
    for (const [x, y] of FARM.spots) expect(grid.pools[levelOf(y)].inWater(x, y)).toBe(true);
    expect(FARM.spots.map(([, y]) => levelOf(y))).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
  });

  it('a conduit electrifies only its own level', () => {
    const { w, run } = fight('octohydra');
    const grid = farmOf(w)!;
    const box = w.bodies.find((b): b is ConduitBox => b instanceof ConduitBox && b.level === 1)!;
    expect(box.fire(w)).toBe(true);
    run(1.4);
    expect(grid.pools[1].live).toBe(true);
    expect(grid.pools[1].water.every((z) => z.electrified > 0)).toBe(true);
    expect(grid.pools[0].water.some((z) => z.electrified > 0)).toBe(false);
    expect(grid.pools[2].water.some((z) => z.electrified > 0)).toBe(false);
    // the other level's box is still ready
    const l1 = w.bodies.find((b): b is ConduitBox => b instanceof ConduitBox && b.level === 0)!;
    expect(l1.ready).toBe(true);
  });

  it('P2 opens the gate and floods L1 deep: one heart and back on L2', () => {
    const { w, run } = fight('octohydra');
    const grid = farmOf(w)!;
    goPhase(w, 1);
    run(0.1);
    expect(grid.gateOpen).toBe(true);
    expect(w.pointInWall(320, 712)).toBe(false);
    // the warning gives time: nothing deep yet
    expect(grid.isDeep(320, 1040)).toBe(false);
    run(6.5);
    expect(grid.flood).toBe('deep');
    const p = w.player;
    p.x = 100; p.y = 900; p.invuln = 0; p.iframes = 0;
    const hp = p.hp;
    run(0.1);
    expect(p.hp).toBe(hp - 1);
    expect(levelOf(p.y)).toBe(1);
    expect(grid.inWater(p.x, p.y)).toBe(false);
    // still invulnerable: no second heart from the same fall
    p.y = 900;
    run(0.1);
    expect(p.hp).toBe(hp - 1);
  });

  it('P3 opens the drain, drains L3, recedes the flood and the core chases down the shaft', () => {
    const { w, run } = fight('octohydra');
    const grid = farmOf(w)!;
    goPhase(w, 1);
    run(7);
    const core = w.boss as unknown as PhaseBoss;
    expect(levelOf(core.y)).toBe(2);
    goPhase(w, 2);
    run(0.5);
    expect(grid.drain).toBe('warn');
    expect(grid.inDrain(320, 240)).toBe(false);
    run(1.2);
    expect(grid.drain).toBe('open');
    expect(grid.inDrain(320, 240)).toBe(true);
    run(3);
    expect(grid.flood).toBe('shallow');
    expect(grid.isDeep(100, 900)).toBe(false);
    // the player waits on L1; the core has to come down two levels
    const p = w.player;
    p.x = 320; p.y = 960;
    let lowest = core.y;
    for (let i = 0; i < 40 * 60; i++) {
      p.x = 320; p.y = 960; p.hp = 99;
      w.step(1 / 60, emptyInput());
      lowest = Math.max(lowest, core.y);
      if (levelOf(core.y) === 0) break;
    }
    expect(levelOf(lowest)).toBe(0);
    // by now L3 has run dry
    expect(grid.pools[2].water.every((z) => z.dead)).toBe(true);
    expect(grid.trigger(w, 2, 'boss')).toBe(false);
  });

  it('the core takes conduit damage in L2 water', () => {
    const { w, run } = fight('octohydra');
    goPhase(w, 1);
    run(7);
    goPhase(w, 2);
    run(3);
    const b = w.boss!;
    const box = w.bodies.find((o): o is ConduitBox => o instanceof ConduitBox && o.level === 1)!;
    const hp = b.hp;
    box.fire(w);
    for (let i = 0; i < 3 * 60; i++) {
      b.x = 320; b.y = 600; b.parts[0].x = b.x; b.parts[0].y = b.y;
      w.step(1 / 60, emptyInput());
    }
    expect(b.hp).toBeLessThan(hp - 200);
  });
});
