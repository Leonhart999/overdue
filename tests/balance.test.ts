import { describe, it } from 'vitest';
import { WEAPONS } from '../src/game/loadout';
import { availableBosses } from '../src/game/bosses';
import { simFight } from './sim.test';

// Run with BALANCE=1 npx vitest run tests/balance.test.ts
describe.runIf(process.env.BALANCE)('balance (mortal bot)', () => {
  for (const boss of availableBosses()) for (const weapon of WEAPONS) it(`${boss} ${weapon}`, () => {
    const out: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const { w, seconds } = simFight(boss, weapon, { seed, seconds: 300 });
      out.push(`${w.state === 'won' ? 'W' : 'L'}${seconds.toFixed(0)}s/${Math.round((1 - w.boss!.hp / w.boss!.maxHp) * 100)}%/h${w.stats.hitsTaken}`);
    }
    console.log(boss, weapon.padEnd(8), out.join('  '));
  });
});
