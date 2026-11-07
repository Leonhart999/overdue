import { describe, expect, it } from 'vitest';
import { buildAllSpecs } from '../src/art';
import { NullGfx } from '../src/engine/gfx';
import { emptyInput } from '../src/engine/input';
import { availableBosses, BOSS_DEFS } from '../src/game/bosses';
import { Bot } from '../src/game/bot';
import { newLoadout, WEAPONS, type CyberId, CYBER_SLOT, type WeaponId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { World } from '../src/game/world';

export function simFight(boss: string, weapon: WeaponId, opts: { seed?: number; cyber?: CyberId[]; seconds?: number; god?: boolean; tier?: number } = {}) {
  const def = BOSS_DEFS[boss as keyof typeof BOSS_DEFS]!;
  const w = new World(def.arena, opts.tier ?? 1, opts.seed ?? 1);
  const l = newLoadout(weapon);
  for (const c of opts.cyber ?? []) l.cyber[CYBER_SLOT[c]] = c;
  w.player = new Player(l, def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  if (opts.god) { w.player.maxHp = 999; w.player.hp = 999; }
  def.arena.setup(w);
  w.boss = def.make(w, opts.tier ?? 1);
  w.state = 'fight';
  const inp = emptyInput();
  const bot = new Bot();
  const g = new NullGfx();
  const steps = (opts.seconds ?? 240) * 60;
  let i = 0;
  for (; i < steps && w.state === 'fight'; i++) {
    bot.update(w, inp, 1 / 60);
    w.step(1 / 60, inp);
    if (i % 30 === 0) w.draw(g);
  }
  return { w, seconds: i / 60 };
}

describe('art', () => {
  it('builds every sheet', () => {
    const specs = buildAllSpecs();
    expect(specs.length).toBeGreaterThan(5);
    for (const s of specs) for (const f of s.frames) {
      expect(f.buf.w).toBe(s.frameW);
      expect(f.buf.h).toBe(s.frameH);
    }
  });
});

for (const boss of availableBosses()) describe(`${boss} sim`, () => {
  for (const weapon of WEAPONS) {
    it(`bot with ${weapon} fights without crashing`, () => {
      const { w, seconds } = simFight(boss, weapon, { god: true, seconds: 300 });
      const dealt = Object.values(w.stats.damageBySrc).reduce((a, b) => a + b, 0) + w.stats.envDamage;
      console.log(boss, weapon, `t=${seconds.toFixed(0)}s`, `boss ${Math.round(w.boss!.hp)}/${w.boss!.maxHp}`, `phase ${w.boss!.phase}`,
        `hits ${w.stats.hitsTaken}`, `env ${Math.round(w.stats.envDamage)}`, `staggers ${w.stats.staggers}`, JSON.stringify(Object.fromEntries(Object.entries(w.stats.damageBySrc).map(([k, v]) => [k, Math.round(v)]))));
      expect(dealt).toBeGreaterThan(200);
    });
  }
  it('cyberware variants run', () => {
    for (const cy of [['legs_leap', 'arm_grapple'], ['legs_blink', 'arm_fist', 'core_plating', 'head_reflex'], ['legs_slide', 'arm_jack', 'core_capacitor', 'head_ballistic']] as CyberId[][]) {
      for (const weapon of WEAPONS) simFight(boss, weapon, { god: true, seconds: 60, cyber: cy, seed: 3 });
    }
  });
});

describe('hub', () => {
  it('runs with every weapon and survives the turret', async () => {
    const { makeHubArena } = await import('../src/game/arenas/hub');
    for (const weapon of WEAPONS) {
      let departed = false;
      const arena = makeHubArena({ current: () => weapon, openArmory: () => {}, openBench: () => {}, openRecords: () => {}, openSim: () => {}, openNeural: () => {}, depart: () => { departed = true; } });
      const w = new World(arena, 1, 5);
      w.player = new Player(newLoadout(weapon), 470, 200);
      arena.setup(w);
      w.state = 'fight';
      const turret = w.bodies.find((b) => b.interactLabel === '开启练习炮台')!;
      turret.onInteract!(w);
      const inp = emptyInput();
      inp.ax = 510; inp.ay = 180;
      for (let i = 0; i < 60 * 20; i++) {
        inp.fire = true; inp.firePressed = i % 20 === 0; inp.altPressed = i % 90 === 0; inp.alt = i % 90 < 20;
        w.step(1 / 60, inp);
      }
      expect(w.state).toBe('fight');
      expect(w.player.hp).toBeGreaterThan(0);
      expect(departed).toBe(false);
    }
  });
});

describe('boss scripts', () => {
  it('a phase transition cannot be broken by a cable cut or a stagger (no permanent invulnerability)', async () => {
    const { Gearjaw } = await import('../src/game/bosses/gearjaw');
    const def = BOSS_DEFS.gearjaw!;
    const w = new World(def.arena, 1, 1);
    w.player = new Player(newLoadout('blade'), 320, 300);
    def.arena.setup(w);
    const b = def.make(w, 1) as InstanceType<typeof Gearjaw>;
    w.boss = b;
    w.state = 'fight';
    const inp = emptyInput();
    for (let i = 0; i < 30; i++) w.step(1 / 60, inp);
    b.hp = b.maxHp * 0.61;
    w.damage(b.body, { dmg: b.maxHp * 0.02, kind: 'blast', x: b.x, y: b.y - 30, from: 'player' });
    expect(b.phase).toBe(1);
    w.step(1 / 60, inp);
    expect(b.inTransition).toBe(true);
    b.hookCut(w);
    b.stagger(w);
    b.addPoise(w, 999);
    for (let i = 0; i < 60 * 4; i++) w.step(1 / 60, inp);
    expect(b.invuln).toBe(false);
    expect(b.inTransition).toBe(false);
    const hp = b.hp;
    w.damage(b.body, { dmg: 50, kind: 'blast', x: b.x, y: b.y - 30, from: 'player' });
    expect(b.hp).toBeLessThan(hp);
  });

  it('a phase change during a stagger waits for the stagger to end', () => {
    const def = BOSS_DEFS.gearjaw!;
    const w = new World(def.arena, 1, 2);
    w.player = new Player(newLoadout('arc'), 320, 300);
    def.arena.setup(w);
    const b = def.make(w, 1);
    w.boss = b;
    w.state = 'fight';
    const inp = emptyInput();
    for (let i = 0; i < 30; i++) w.step(1 / 60, inp);
    b.hp = b.maxHp * 0.62;
    w.damage(b.parts[0], { dmg: b.maxHp * 0.05, kind: 'crush', x: b.x, y: b.y - 30, poise: 999, from: 'env' });
    expect(b.staggered).toBe(true);
    for (let i = 0; i < 60; i++) w.step(1 / 60, inp);
    expect(b.staggered).toBe(true);
    for (let i = 0; i < 60 * 3; i++) w.step(1 / 60, inp);
    expect(b.staggered).toBe(false);
  });
});
