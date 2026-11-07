/** All bosses. A boss whose module exports `null` is not in the rotation yet. */
import type { BossId } from '../loadout';
import { gearjawDef } from './gearjawDef';
import { luxDef } from './lux';
import { octohydraDef } from './octohydra';
import { kadeDef } from './kade';
import { vesperDef } from './vesper';
import { kairoDef } from './kairo';
import { foldDef } from './fold';
import { wrenDef } from './wren';
import type { BossDef } from './registry';

export type { BossDef } from './registry';

export const BOSS_DEFS: Partial<Record<BossId, BossDef>> = {};
for (const d of [gearjawDef, luxDef, octohydraDef, kadeDef, vesperDef, kairoDef, foldDef, wrenDef]) if (d) BOSS_DEFS[d.id] = d;

export function availableBosses(): BossId[] {
  return Object.keys(BOSS_DEFS) as BossId[];
}
