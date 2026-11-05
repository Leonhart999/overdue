/**
 * Boss scripts are generators: `yield` hands control back for one fixed step.
 * The clock passed in is read every step, so slow-motion and hacks stretch scripts naturally.
 *
 *   *attack() {
 *     yield* wait(this, 0.6);                // wind-up
 *     ...spawn bullets...
 *     yield* waitUntil(() => hook.done, 3);  // with a safety timeout
 *   }
 */

export type Script = Generator<void, void, void>;

export interface Clocked {
  /** Seconds of (scaled) time this owner has lived. */
  clock: number;
}

export function* wait(owner: Clocked, seconds: number): Script {
  const end = owner.clock + seconds;
  while (owner.clock < end) yield;
}

export function* waitUntil(cond: () => boolean, timeout = Infinity, owner?: Clocked): Script {
  const end = owner ? owner.clock + timeout : Infinity;
  let guard = 0;
  while (!cond()) {
    if (owner && owner.clock >= end) return;
    if (!owner && ++guard > timeout * 60) return;
    yield;
  }
}

/** Run several scripts side by side until all have finished. */
export function* all(...scripts: Script[]): Script {
  const live = [...scripts];
  while (live.length) {
    for (let i = live.length - 1; i >= 0; i--) if (live[i].next().done) live.splice(i, 1);
    if (live.length) yield;
  }
}

/** Repeat `body` every `interval` seconds for `duration` seconds. */
export function* every(owner: Clocked, interval: number, duration: number, body: (i: number) => void): Script {
  const end = owner.clock + duration;
  let next = owner.clock, i = 0;
  while (owner.clock < end) {
    while (owner.clock >= next && owner.clock < end) { body(i++); next += interval; }
    yield;
  }
}
