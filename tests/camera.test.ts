/** Scrolling-map camera: follows the player, clamps to the map, stays put on single-screen arenas. */
import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/engine/input';
import { newLoadout } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { World, type Arena } from '../src/game/world';
import { scrapyard } from '../src/game/arenas/scrapyard';

const big: Arena = {
  id: 'test_big',
  bg: 'none',
  size: { w: 1600, h: 720 },
  bounds: { x: 16, y: 48, w: 1568, h: 648 },
  playerSpawn: { x: 100, y: 600 },
  setup() {},
};

function world(arena: Arena) {
  const w = new World(arena, 1, 1);
  w.player = new Player(newLoadout('arc'), arena.playerSpawn.x, arena.playerSpawn.y);
  w.input = emptyInput();
  w.updateCamera(0, true);
  return w;
}

describe('camera', () => {
  it('single-screen arenas never scroll', () => {
    const w = world(scrapyard);
    expect(w.scrolls).toBe(false);
    w.player.x = 600; w.player.y = 320;
    for (let i = 0; i < 60; i++) w.updateCamera(1 / 60);
    expect([w.camX, w.camY]).toEqual([0, 0]);
  });

  it('snaps to the player at start, clamped to the map edge', () => {
    const w = world(big);
    expect(w.scrolls).toBe(true);
    expect(w.camX).toBe(0); // player at x 100: left edge
    expect(w.camY).toBe(720 - 360); // player at y 600: bottom edge
    expect(w.onScreen(w.player.x, w.player.y)).toBe(true);
  });

  it('follows the player smoothly and keeps the player on screen', () => {
    const w = world(big);
    // cursor parked at the screen centre: no lookahead
    const step = () => { w.input.ax = w.camX + 320; w.input.ay = w.camY + 180; w.updateCamera(1 / 60); };
    w.player.x = 800; w.player.y = 360;
    step();
    expect(w.camX).toBeGreaterThan(0);
    expect(w.camX).toBeLessThan(800 - 320); // not there yet: smoothing
    for (let i = 0; i < 120; i++) step();
    expect(Math.abs(w.camX - (800 - 320))).toBeLessThanOrEqual(2);
    expect(w.onScreen(w.player.x, w.player.y, 40)).toBe(true);
    w.player.x = 1590;
    for (let i = 0; i < 120; i++) step();
    expect(w.camX).toBe(1600 - 640);
  });

  it('an arena camera override wins', () => {
    const w = world({ ...big, camera: () => ({ x: 1000, y: 200 }) });
    expect([w.camX, w.camY]).toEqual([1000 - 320, 20]);
  });

  it('labels stay inside the view', () => {
    const w = world(big);
    w.player.x = 1200; w.player.y = 400;
    w.updateCamera(0, true);
    w.fx.label(10, 10, 'x');
    const l = (w.fx as unknown as { labels: { x: number; y: number }[] }).labels[0];
    expect(l.x).toBeGreaterThanOrEqual(w.camX);
    expect(l.y).toBeGreaterThanOrEqual(w.camY);
  });
});
