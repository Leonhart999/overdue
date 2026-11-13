import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/engine/input';
import { BOSS_DEFS } from '../src/game/bosses';
import { NullGfx } from '../src/engine/gfx';
import { Bot } from '../src/game/bot';
import { newLoadout, WEAPONS, type WeaponId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { World } from '../src/game/world';
import { foundryOf } from '../src/game/arenas/foundry';

/** Same as simFight in sim.test.ts (copied so this file does not pull in every other sim). */
function simFight(boss: keyof typeof BOSS_DEFS, weapon: WeaponId, opts: { seed?: number; seconds?: number; god?: boolean; tier?: number } = {}) {
  const def = BOSS_DEFS[boss]!;
  const w = new World(def.arena, opts.tier ?? 1, opts.seed ?? 1);
  w.player = new Player(newLoadout(weapon), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  if (opts.god) { w.player.maxHp = 999; w.player.hp = 999; }
  def.arena.setup(w);
  w.boss = def.make(w, opts.tier ?? 1);
  w.state = 'fight';
  const inp = emptyInput(), bot = new Bot(), g = new NullGfx();
  let i = 0;
  for (; i < (opts.seconds ?? 240) * 60 && w.state === 'fight'; i++) {
    bot.update(w, inp, 1 / 60);
    w.step(1 / 60, inp);
    if (i % 30 === 0) w.draw(g);
  }
  return { w, seconds: i / 60 };
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Idle player at spawn (god mode): how often does Fold actually land something? */
function idleHits(seed: number, seconds = 40, tier = 1): number {
  const def = BOSS_DEFS.fold!;
  const w = new World(def.arena, tier, seed);
  w.player = new Player(newLoadout('blade'), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  w.player.maxHp = w.player.hp = 999;
  def.arena.setup(w);
  w.boss = def.make(w, tier);
  w.state = 'fight';
  const inp = emptyInput();
  for (let i = 0; i < seconds * 60; i++) w.step(1 / 60, inp);
  return w.stats.hitsTaken;
}

function overlapsWall(w: World, x: number, y: number, r: number): boolean {
  return w.walls.some(q => {
    const cx = Math.max(q.x, Math.min(x, q.x + q.w)), cy = Math.max(q.y, Math.min(y, q.y + q.h));
    return (x - cx) ** 2 + (y - cy) ** 2 < (r - 3) ** 2;
  });
}

function setup(seed = 1, weapon: WeaponId = 'blade') {
  const def = BOSS_DEFS.fold!;
  const w = new World(def.arena, 1, seed);
  w.player = new Player(newLoadout(weapon), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  w.player.maxHp = w.player.hp = 999;
  def.arena.setup(w);
  w.boss = def.make(w, 1);
  w.state = 'fight';
  return { w, st: foundryOf(w)!, boss: w.boss, inp: emptyInput() };
}

describe('fold', () => {
  it('reaches an idle player at spawn', () => {
    expect(idleHits(1)).toBeGreaterThanOrEqual(8);
  });

  it('never leaves the player or Fold inside a wall, and the rooms always come back', () => {
    const bad: string[] = [];
    for (const weapon of WEAPONS) {
      const { w, st, boss, inp } = setup(weapon === 'arc' ? 2 : 1, weapon);
      const bot = new Bot();
      let squeezes = 0, wasBusy = false;
      for (let i = 0; i < 80 * 60 && w.state === 'fight'; i++) {
        bot.update(w, inp, 1 / 60); w.step(1 / 60, inp);
        const part = boss.parts[0];
        // (a player pressed between Fold's solid body and a wall overlaps it by a few px: engine-wide, not a wedge)
        const pressed = Math.hypot(part.x - w.player.x, part.y - w.player.y) < part.r + w.player.r + 2;
        if (!pressed && overlapsWall(w, w.player.x, w.player.y, w.player.r)) bad.push(`${weapon} ${i} player`);
        if (!st.airborne && !boss.dying && overlapsWall(w, part.x, part.y, part.r)) bad.push(`${weapon} ${i} fold`);
        if (st.busy && !wasBusy) squeezes++;
        wasBusy = st.busy;
        if (!st.busy && st.rooms.some(r => r.x !== r.baseX || r.y !== r.baseY)) bad.push(`${weapon} ${i} rooms`);
      }
      if (!squeezes) bad.push(`${weapon} no squeeze`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 60000);

  it('a console squeeze crushes and staggers Fold standing in the corridor; the player in it is hit', () => {
    const { w, st, boss, inp } = setup();
    for (let i = 0; i < 10; i++) w.step(1 / 60, inp);
    const g = st.bandRect(0), part = boss.parts[0];
    boss.setScript(null);
    part.x = boss.x = g.x + g.w / 2; part.y = boss.y = g.y + 60;
    w.player.x = g.x + g.w / 2; w.player.y = g.y + 120;
    const hp = boss.hp;
    expect(st.startSqueeze(w, [0], 'env', 0.5)).toBe(true);
    for (let i = 0; i < 60 && !boss.staggered; i++) { (boss as unknown as { script: unknown }).script = (function* () { for (;;) yield; })(); w.step(1 / 60, inp); }
    expect(boss.staggered).toBe(true);
    expect(boss.hp).toBeLessThan(hp - 200);
    expect(w.stats.hitsTaken).toBe(1);
    for (let i = 0; i < 4 * 60; i++) w.step(1 / 60, inp);
    expect(st.busy).toBe(false);
  });

  it('carries a beam and its collision wall together throughout a squeeze', () => {
    const { w, st, boss, inp } = setup();
    boss.setScript((function* () { for (;;) yield; })());
    const room = st.rooms[0];
    st.dropBeam(w, room.x + 140, room.y + 110, true, 10);
    const beam = st.beams[0], startX = beam.x;
    expect(st.startSqueeze(w, [0], 'env', 0.5)).toBe(true);
    for (let i = 0; i < 55; i++) {
      w.step(1 / 60, inp);
      expect(beam.wall.x).toBe(beam.x - 56);
      expect(beam.wall.y).toBe(beam.y - 6);
    }
    expect(beam.dead).toBe(false);
    expect(beam.x).toBeGreaterThan(startX + 30);
  });

  it.each(['won', 'lost'] as const)('reopens the rooms after a fight is %s', state => {
    const { w, st, boss, inp } = setup();
    boss.setScript((function* () { for (;;) yield; })());
    expect(st.startSqueeze(w, [0], 'env', 0.5)).toBe(true);
    for (let i = 0; i < 55; i++) w.step(1 / 60, inp);
    expect(st.rooms[0].x).not.toBe(st.rooms[0].baseX);
    w.state = state;
    for (let i = 0; i < 60; i++) st.update(w, 1 / 60);
    expect(st.busy).toBe(false);
    expect(st.rooms.every(r => r.x === r.baseX && r.y === r.baseY)).toBe(true);
  });

  it('the brake drops Fold off the crane and the hop finally puts him on free ground', () => {
    const { w, st, boss, inp } = setup();
    let caught = false;
    for (let i = 0; i < 60 * 60 && !caught; i++) {
      w.step(1 / 60, inp);
      if (st.airborne) { expect(st.brake(w)).toBe(true); caught = boss.staggered; }
    }
    expect(caught).toBe(true);
    w.step(1 / 60, inp);
    expect(st.airborne).toBe(false);
    expect(boss.parts[0].solid).toBe(true);
    expect(overlapsWall(w, boss.parts[0].x, boss.parts[0].y, boss.parts[0].r)).toBe(false);
  });
});

// FOLD=1 npx vitest run tests/fold.test.ts
describe.runIf(env.FOLD)('fold tuning', () => {
  it('god and mortal bots', () => {
    const tier = Number(env.FOLD_TIER ?? 1);
    console.log(`T${tier} idle hits/40s`, [1, 2, 3].map(s => idleHits(s, 40, tier)).join(' '));
    const id = (env.FOLD_BOSS ?? 'fold') as keyof typeof BOSS_DEFS;
    for (const weapon of WEAPONS) {
      const g = simFight(id, weapon, { god: true, seconds: 300, tier });
      const out: string[] = [];
      let wins = 0, hits = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const { w, seconds } = simFight(id, weapon, { seed, seconds: 300, tier });
        if (w.state === 'won') wins++;
        hits += w.stats.hitsTaken;
        out.push(`${w.state === 'won' ? 'W' : 'L'}${seconds.toFixed(0)}s/h${w.stats.hitsTaken}`);
      }
      console.log(`T${tier}`, weapon.padEnd(8), `god ${g.seconds.toFixed(0)}s h${g.w.stats.hitsTaken} st${g.w.stats.staggers} env${Math.round(g.w.stats.envDamage)}`, `| mortal ${wins}/5 avgHits ${(hits / 5).toFixed(1)} |`, out.join(' '));
    }
  }, 600000);
});

// FOLD_DBG=1: which attacks land on the mortal bot
describe.runIf(env.FOLD_DBG)('fold debug', () => {
  it('hits by attack', () => {
    const picks: Record<string, number> = {}, hits: Record<string, number> = {}, dodges: Record<string, number> = {};
    for (const weapon of WEAPONS) for (const seed of [1, 2, 3]) {
      const def = BOSS_DEFS.fold!;
      const w = new World(def.arena, 1, seed);
      w.player = new Player(newLoadout(weapon), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
      w.player.maxHp = w.player.hp = 999;
      def.arena.setup(w);
      const boss = def.make(w, 1) as unknown as { lastPick: string };
      w.boss = boss as never;
      w.state = 'fight';
      const hurt = w.player.hurt.bind(w.player);
      w.player.hurt = (ww, dmg, o) => { const r = hurt(ww, dmg, o); const k = `${boss.lastPick}/${o.kind ?? ''}`; if (r === 'hit') hits[k] = (hits[k] ?? 0) + 1; if (r === 'dodged') dodges[k] = (dodges[k] ?? 0) + 1; return r; };
      const inp = emptyInput(), bot = new Bot();
      let last = '';
      for (let i = 0; i < 60 * 60 && w.state === 'fight'; i++) {
        bot.update(w, inp, 1 / 60); w.step(1 / 60, inp);
        if (boss.lastPick !== last) { last = boss.lastPick; picks[last] = (picks[last] ?? 0) + 1; }
      }
    }
    console.log('picks', JSON.stringify(picks)); console.log('hits', JSON.stringify(hits)); console.log('dodges', JSON.stringify(dodges));
  }, 600000);
});
