/**
 * Run state: the boss order, the loadout carried between fights, rewards and loans.
 * Pure (no Phaser); the scenes keep one RunState in `session`.
 */
import { Rng } from '../engine/math';
import { availableBosses, BOSS_DEFS } from './bosses';
import {
  CYBER_POOL, CYBER_SLOT, effectiveMaxHp, newLoadout, WEAPON_MODS,
  type BossId, type CyberId, type Loadout, type ModId, type WeaponId,
} from './loadout';

export type Card =
  | { kind: 'cyber'; id: CyberId; signature?: boolean }
  | { kind: 'mod'; id: ModId }
  | { kind: 'maxhp' };

export type LoanId = 'loan_hp' | 'loan_pace' | 'loan_heal';

export interface Loan { id: LoanId; text: string }

export const LOANS: Record<LoanId, Loan> = {
  loan_hp: { id: 'loan_hp', text: '下一个头目生命 +25%' },
  loan_pace: { id: 'loan_pace', text: '下一个头目出招加快 12%' },
  loan_heal: { id: 'loan_heal', text: '这次不修复生命' },
};

export interface FightRecord {
  boss: BossId;
  tier: number;
  time: number;
  hitsTaken: number;
  perfectDodges: number;
  staggers: number;
  envDamage: number;
  won: boolean;
}

export interface RunState {
  seed: number;
  rngState: number;
  order: BossId[];
  /** Index of the next fight in `order`. */
  index: number;
  loadout: Loadout;
  records: FightRecord[];
  /** Loans that apply to the next fight. */
  pendingLoans: LoanId[];
  /** Hearts restored by the last post-fight repair (the "no repair" loan takes them back). */
  lastRepair?: number;
  startedAt: number;
  /** Hub simulator: one fight, no rewards, no records; back to the hub afterwards. */
  practice?: boolean;
}

export function newRun(weapon: WeaponId, seed = (Math.random() * 2 ** 31) | 0): RunState {
  const rng = new Rng(seed);
  const order = rng.shuffle(availableBosses().slice());
  return { seed, rngState: seed ^ 0x5bd1e995, order, index: 0, loadout: newLoadout(weapon), records: [], pendingLoans: [], startedAt: Date.now() };
}

export function currentBoss(run: RunState): BossId | null {
  return run.order[run.index] ?? null;
}

export function isLastFight(run: RunState): boolean {
  return run.index >= run.order.length - 1;
}

function rngFor(run: RunState, salt: number): Rng {
  return new Rng((run.rngState + salt * 7919 + run.index * 104729) | 0);
}

/** Three reward cards after beating `boss`. The boss's signature part is always one of them. */
export function rollRewards(run: RunState, boss: BossId): Card[] {
  const rng = rngFor(run, 1);
  const l = run.loadout;
  const owned = new Set(Object.values(l.cyber));
  const cards: Card[] = [];
  const sig = BOSS_DEFS[boss]?.drop;
  if (sig && !owned.has(sig)) cards.push({ kind: 'cyber', id: sig, signature: true });
  const freeMods = WEAPON_MODS[l.weapon].filter((m) => !l.mods.includes(m));
  const cyberPool = rng.shuffle(CYBER_POOL.filter((c) => !owned.has(c) && c !== sig));
  // prefer slots the player still has stock parts in
  cyberPool.sort((a, b) => Number(l.cyber[CYBER_SLOT[b]].endsWith('stock') || l.cyber[CYBER_SLOT[b]].endsWith('none') || l.cyber[CYBER_SLOT[b]] === 'arm_shove')
    - Number(l.cyber[CYBER_SLOT[a]].endsWith('stock') || l.cyber[CYBER_SLOT[a]].endsWith('none') || l.cyber[CYBER_SLOT[a]] === 'arm_shove'));
  if (freeMods.length && rng.chance(0.75)) cards.push({ kind: 'mod', id: rng.pick(freeMods) });
  while (cards.length < 3 && cyberPool.length) {
    const c = cyberPool.splice(rng.int(0, Math.min(3, cyberPool.length - 1)), 1)[0];
    if (cards.some((k) => k.kind === 'cyber' && CYBER_SLOT[k.id] === CYBER_SLOT[c]) && cyberPool.length > 2) continue;
    cards.push({ kind: 'cyber', id: c });
  }
  if (cards.length < 3) cards.push({ kind: 'maxhp' });
  return cards.slice(0, 3);
}

/** Optional loan: an extra card with a cost. */
export function rollLoan(run: RunState, exclude: Card[]): { loan: Loan; card: Card } | null {
  if (isLastFight(run)) return null;
  const rng = rngFor(run, 2);
  const l = run.loadout;
  const owned = new Set(Object.values(l.cyber));
  const taken = new Set(exclude.map((c) => (c.kind === 'maxhp' ? 'maxhp' : c.id)));
  const pool: Card[] = [
    ...CYBER_POOL.filter((c) => !owned.has(c) && !taken.has(c)).map((id) => ({ kind: 'cyber' as const, id })),
    ...WEAPON_MODS[l.weapon].filter((m) => !l.mods.includes(m) && !taken.has(m)).map((id) => ({ kind: 'mod' as const, id })),
  ];
  if (!pool.length) return null;
  const loan = LOANS[rng.pick(['loan_hp', 'loan_pace', 'loan_heal'] as LoanId[])];
  return { loan, card: rng.pick(pool) };
}

export function applyCard(run: RunState, card: Card): void {
  const l = run.loadout;
  if (card.kind === 'cyber') {
    const before = effectiveMaxHp(l);
    l.cyber[CYBER_SLOT[card.id]] = card.id;
    const after = effectiveMaxHp(l);
    if (after > before) l.hp += after - before;
    l.hp = Math.min(l.hp, after);
  } else if (card.kind === 'mod') {
    if (!l.mods.includes(card.id)) l.mods.push(card.id);
  } else {
    l.maxHp = Math.min(8, l.maxHp + 1);
    l.hp += 1;
  }
}

/** After a won fight: record, repair, advance. */
export function finishFight(run: RunState, rec: FightRecord, hpLeft: number): void {
  run.records.push(rec);
  const skipHeal = run.pendingLoans.includes('loan_heal');
  run.pendingLoans = [];
  const before = Math.min(effectiveMaxHp(run.loadout), hpLeft);
  run.loadout.hp = Math.min(effectiveMaxHp(run.loadout), hpLeft + (skipHeal ? 0 : 2));
  run.lastRepair = run.loadout.hp - before;
  run.index++;
}

/** Tier and modifiers for the next fight. */
export function nextFightParams(run: RunState): { boss: BossId; tier: number; hpMul: number; paceMul: number } | null {
  const boss = currentBoss(run);
  if (!boss) return null;
  return {
    boss,
    tier: run.index + 1,
    hpMul: run.pendingLoans.includes('loan_hp') ? 1.25 : 1,
    paceMul: run.pendingLoans.includes('loan_pace') ? 0.88 : 1,
  };
}

// ------------------------------------------------------------------ meta (localStorage)
export interface Meta {
  runs: number;
  wins: number;
  bossKills: Partial<Record<BossId, number>>;
  bestRun: Partial<Record<WeaponId, number>>;
  muted: boolean;
  lastWeapon?: WeaponId;
  settings?: { shake: boolean; numbers: boolean; music: number; sfx: number };
}

const META_KEY = 'overdue.meta.v1';

export function loadMeta(): Meta {
  const base: Meta = { runs: 0, wins: 0, bossKills: {}, bestRun: {}, muted: false };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return { ...base, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return base;
}

export function saveMeta(m: Meta): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
