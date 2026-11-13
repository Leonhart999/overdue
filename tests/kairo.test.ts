import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/engine/input';
import { BOSS_DEFS } from '../src/game/bosses';
import { Bot } from '../src/game/bot';
import { newLoadout, WEAPONS, type WeaponId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { World } from '../src/game/world';
import { archiveOf } from '../src/game/arenas/archive';
import { NullGfx } from '../src/engine/gfx';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

function setup(weapon: WeaponId, seed = 1, tier = 1, god = false): World {
  const def = BOSS_DEFS.kairo!;
  const w = new World(def.arena, tier, seed);
  w.player = new Player(newLoadout(weapon), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  if (god) { w.player.maxHp = 999; w.player.hp = 999; }
  def.arena.setup(w);
  w.boss = def.make(w, tier);
  w.state = 'fight';
  return w;
}

function run(weapon: WeaponId, seed: number, tier: number, god: boolean, seconds = 300) {
  const w = setup(weapon, seed, tier, god), inp = emptyInput(), bot = new Bot(), g = new NullGfx();
  let i = 0;
  for (; i < seconds * 60 && w.state === 'fight'; i++) {
    bot.update(w, inp, 1 / 60);
    w.step(1 / 60, inp);
    if (i % 30 === 0) w.draw(g);
  }
  return { w, seconds: i / 60 };
}

describe('kairo', () => {
  it('opens with haste before a memory attack and uses it only once in phase one', () => {
    const w = setup('blade', 1, 1, true), st = archiveOf(w)!, inp = emptyInput();
    let hasteStarts = 0, wasHaste = false, firstHaste = -1;
    for (let i = 0; i < 40 * 60; i++) {
      w.step(1 / 60, inp);
      const haste = st.time.mode === 'haste';
      if (haste && !wasHaste) { hasteStarts++; if (firstHaste < 0) firstHaste = w.time; }
      if (firstHaste < 0) expect(st.casts.length).toBe(0);
      expect(st.time.mode).not.toBe('slow');
      wasHaste = haste;
    }
    expect(firstHaste).toBeGreaterThanOrEqual(1.2);
    expect(firstHaste).toBeLessThan(2.5);
    expect(hasteStarts).toBe(1);
    expect(st.time.mode).toBe('normal');
  });

  it('does not retry the opening haste after its wind-up is interrupted', () => {
    const w = setup('blade', 1, 1, true), st = archiveOf(w)!, inp = emptyInput();
    for (let i = 0; i < 120 && !st.time.charging; i++) w.step(1 / 60, inp);
    expect(st.time.charging).toBe('haste');
    w.boss!.stagger(w, 2);
    for (let i = 0; i < 30 * 60; i++) {
      w.step(1 / 60, inp);
      expect(st.time.mode).toBe('normal');
      expect(st.time.charging).toBeNull();
    }
  });

  it('uses slow fields, never haste, in phase two', () => {
    const w = setup('blade', 1, 1, true), st = archiveOf(w)!, inp = emptyInput();
    w.boss!.phase = 1; w.boss!.beginPhase(w, 1);
    let slow = false;
    for (let i = 0; i < 45 * 60; i++) {
      w.step(1 / 60, inp);
      expect(st.time.mode).not.toBe('haste');
      expect(st.time.charging).not.toBe('haste');
      if (st.time.mode === 'slow') slow = true;
    }
    expect(slow).toBe(true);
  });

  it('starts phase three with haste even if a previous field left a cooldown', () => {
    const w = setup('blade', 1, 1, true), st = archiveOf(w)!, inp = emptyInput();
    st.time.restore(7);
    w.boss!.phase = 2; w.boss!.beginPhase(w, 2);
    for (let i = 0; i < 4 * 60; i++) w.step(1 / 60, inp);
    expect(st.time.mode).toBe('haste');
  });

  it('a stop-watch holds a player who stands inside, then strikes once', () => {
    const w = setup('blade');
    const st = archiveOf(w)!, p = w.player;
    w.boss!.invuln = true;
    const s = st.startStop(p.x, p.y - 4, 46, 0.5);
    const inp = emptyInput();
    const hp = p.hp;
    let held = false;
    for (let i = 0; i < 60 * 1.6 && !s.dead; i++) {
      // stand still until it closes, then try to walk away
      inp.mx = s.warning ? 0 : 1;
      const x = p.x;
      w.step(1 / 60, inp);
      if (!s.warning && !s.dead) { held = held || p.forced !== null; expect(p.x).toBe(x); }
    }
    expect(held).toBe(true);
    expect(p.hp).toBe(hp - 1);
  });

  it.each(['clear', 'stagger', 'phase', 'won', 'lost'] as const)('releases a stopped player on %s before another player update', reason => {
    const w = setup('blade'), st = archiveOf(w)!, p = w.player;
    const s = st.startStop(p.x, p.y - 4, 46, 0.5);
    s.update(w, 0.8);
    expect(p.forced).not.toBeNull();
    if (reason === 'clear') st.clearHostile();
    else {
      if (reason === 'stagger') w.boss!.stagger(w, 2);
      else if (reason === 'phase') { w.boss!.beginPhase(w, 1); w.boss!.update(w, 1 / 60); }
      else w.state = reason;
      s.update(w, 1 / 60);
    }
    expect(s.dead).toBe(true);
    expect(p.forced).toBeNull();
    expect(p.hp).toBe(p.maxHp);
  });

  it('canceling a stop never removes a replacement forced move or strikes later', () => {
    const w = setup('blade'), st = archiveOf(w)!, p = w.player;
    const s = st.startStop(p.x, p.y - 4, 46, 0.5);
    s.update(w, 0.8);
    const replacement = { vx: 0, vy: 0, t: 1, iframes: false, solids: true };
    p.forced = replacement;
    st.clearHostile();
    s.update(w, 1);
    expect(p.forced).toBe(replacement);
    expect(p.hp).toBe(p.maxHp);
  });

  it('coolant always staggers at tier 4', () => {
    const w = setup('blade', 1, 4);
    const dev = w.bodies.find(b => b.interactLabel === '冷却喷流')!;
    w.boss!.x = w.boss!.parts[0].x = dev.x; w.boss!.y = w.boss!.parts[0].y = dev.y + 30;
    dev.onInteract!(w);
    const inp = emptyInput();
    for (let i = 0; i < 60; i++) {
      w.boss!.parts[0].x = dev.x; w.boss!.parts[0].y = dev.y + 30;
      w.step(1 / 60, inp);
    }
    expect(w.stats.staggers).toBe(1);
  });
});

// KAIRO=1 npx vitest run tests/kairo.test.ts   (KAIRO_TIER=4 for the last fight)
describe.runIf(env.KAIRO)('kairo tuning', () => {
  it('god and mortal bots', () => {
    const tier = Number(env.KAIRO_TIER ?? 1);
    let allWins = 0, allHits = 0;
    for (const weapon of WEAPONS) {
      const g = run(weapon, 1, tier, true);
      const out: string[] = [];
      let wins = 0, hits = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const { w, seconds } = run(weapon, seed, tier, false);
        if (w.state === 'won') wins++;
        hits += w.stats.hitsTaken;
        out.push(`${w.state === 'won' ? 'W' : 'L'}${seconds.toFixed(0)}s/${Math.round((1 - w.boss!.hp / w.boss!.maxHp) * 100)}%/h${w.stats.hitsTaken}`);
      }
      allWins += wins; allHits += hits;
      console.log(`T${tier}`, weapon.padEnd(8), `god ${g.seconds.toFixed(0)}s h${g.w.stats.hitsTaken} pd${g.w.stats.perfectDodges} st${g.w.stats.staggers}`,
        `env ${Math.round(g.w.stats.envDamage)} ${JSON.stringify(Object.fromEntries(Object.entries(g.w.stats.damageBySrc).map(([k, v]) => [k, Math.round(v)])))}`,
        `| mortal ${wins}/5 avgHits ${(hits / 5).toFixed(1)} |`, out.join(' '));
    }
    console.log(`T${tier} total wins ${allWins}/20 avg hits ${(allHits / 20).toFixed(2)}`);
  }, 300_000);
});
