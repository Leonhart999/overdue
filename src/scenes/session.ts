/** Global session: the current run, meta progress and dev flags from the URL. */
import type { CyberId, Slot } from '../game/loadout';
import { loadMeta, type Meta, type RunState } from '../game/run';

const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const session: {
  run: RunState | null;
  meta: Meta;
  /** Practice cyberware chosen on the hub bench (hub only). */
  hubCyber: Partial<Record<Slot, CyberId>>;
  dev: {
    boss: string | null;
    hub: boolean;
    weapon: string | null;
    tier: number;
    cyber: string[];
    mods: string[];
    bot: boolean;
    god: boolean;
    seed: number | null;
    shot: boolean;
    /** Stop after this many seconds of fighting (bot tests). */
    limit: number;
  };
} = {
  run: null,
  meta: loadMeta(),
  hubCyber: {},
  dev: {
    boss: q.get('boss'),
    hub: q.has('hub'),
    weapon: q.get('weapon'),
    tier: Number(q.get('tier') ?? 1),
    cyber: (q.get('cyber') ?? '').split(',').filter(Boolean),
    mods: (q.get('mods') ?? '').split(',').filter(Boolean),
    bot: q.has('bot'),
    god: q.has('god'),
    seed: q.has('seed') ? Number(q.get('seed')) : null,
    shot: q.has('shot'),
    limit: Number(q.get('limit') ?? 0),
  },
};
