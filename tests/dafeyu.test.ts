import { describe, expect, it } from 'vitest';
import { buildDafeyuArt } from '../src/art/actors/dafeyu';
import { DAFEYU_TEXT } from '../src/data/text';
import { emptyInput } from '../src/engine/input';
import { makeHubArena } from '../src/game/arenas/hub';
import { newLoadout } from '../src/game/loadout';
import { Dafeyu } from '../src/game/npcs/dafeyu';
import { Player } from '../src/game/player';
import { World } from '../src/game/world';

describe('Dafeyu hub NPC', () => {
  it('opens only the neural service with E, without changing the loadout or starting a run', () => {
    let opened = 0;
    const unexpected = () => { throw new Error('Opened another hub station'); };
    const arena = makeHubArena({
      current: () => 'riveter', openArmory: unexpected, openBench: unexpected,
      openRecords: unexpected, openSim: unexpected, depart: unexpected,
      openNeural: () => { opened++; },
    });
    const w = new World(arena, 1, 11);
    w.player = new Player(newLoadout('riveter'), 112, 218);
    arena.setup(w);
    w.state = 'fight';
    const before = JSON.stringify(w.player.loadout);
    const inp = emptyInput();
    inp.interactPressed = true;
    w.step(1 / 60, inp);
    expect(opened).toBe(1);
    expect(w.prompt).toContain(DAFEYU_TEXT.interact);
    expect(JSON.stringify(w.player.loadout)).toBe(before);
    const npc = w.bodies.find((body) => body instanceof Dafeyu)!;
    expect(npc).toBeDefined();
    expect(npc.targetable).toBe(false);
    npc.push(500, 500);
    expect([npc.vx, npc.vy]).toEqual([0, 0]);
    expect(npc.hurt(w, { dmg: 999, kind: 'blast', from: 'player', x: npc.x, y: npc.y })).toBe(0);
    expect(npc.dead).toBe(false);
  });

  it('imports both complete silhouettes as transparent indexed frames usable without DOM or image loading', () => {
    const sheets = buildDafeyuArt();
    expect(sheets.map((s) => s.key)).toEqual(['npc_dafeyu', 'portrait_dafeyu']);
    for (const sheet of sheets) {
      const b = sheet.frames[0].buf;
      expect([b.w, b.h]).toEqual([sheet.frameW, sheet.frameH]);
      const opaque = b.px.filter((c) => c !== 0).length;
      expect(opaque).toBeGreaterThan(b.w * b.h * 0.2);
      expect(opaque).toBeLessThan(b.w * b.h * 0.8);
      expect(b.get(0, 0)).toBe(0);
      expect(b.get(b.w - 1, b.h - 1)).toBe(0);
    }
  });
});
