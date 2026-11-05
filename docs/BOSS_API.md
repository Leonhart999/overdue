# Building a boss

Reference implementation: `src/game/bosses/gearjaw.ts` + `src/game/arenas/scrapyard.ts` + `src/game/bosses/gearjawDef.ts`. Read them first.

## Files a boss owns

| File | Contents |
|---|---|
| `src/game/bosses/<id>.ts` | Boss class, its helper objects, and `export const <id>Def: BossDef` (replace the `null` placeholder) |
| `src/game/arenas/<arena>.ts` | `Arena` object + arena devices (Body subclasses / world objects) |
| `src/art/<id>.ts` | `build<Id>Art(): SheetSpec[]` — boss sprites, arena background (640x360), device sprites |

`src/game/bosses/index.ts` and `src/art/bossArt.ts` already import these modules; nothing else needs registering.

## World model

- 640x360, fixed 60 Hz steps. `(x, y)` is the ground point; hurt circles sit at `(x, y - hz)` radius `hr`.
- `World` holds `bodies` (props, boss parts), `bullets`, `hazards`, `zones` (oil/water/acid floor), `cables` (cuttable by the blade), `objects` (anything with `update/draw/drawTop`).
- Arena `bounds` is the playable rectangle; `World` adds boundary walls around it. Extra wall rects can be pushed into `w.walls` in `setup`.
- Query helpers: `w.target()` (player or decoy), `w.raycast`, `w.rayWall`, `w.bodiesInCircle`, `w.moveCircle`, `w.explode`, `w.clearBullets`, `w.hitPlayer`, `w.damage`.

## Boss class

Extend `Boss` (`src/game/boss.ts`):

```ts
class Lux extends Boss {
  readonly id = 'lux' as const; readonly name = '卢克丝夫人';
  constructor(w: World, tier: number) { super(w, tier, x, y, BASE_HP); this.thresholds = [0.65, 0.3]; this.addPart(new BossPart(this, x, y, r, hz, hr)); }
  *brain(w) { for (;;) { ...pick attack...; yield* this.someAttack(); } }
  *transition(w, phase) { ... }   // optional, runs once per phase change
  think(w, dt) { ... }            // optional per-step movement/timers (runs while staggered too)
  modHit(w, part, h) { return { mul, tag } } // optional armour / weak points / immunity
  draw(g, w) { ... }
}
```

- Scripts are generators; `yield` = one step. Use `this.wait(s)` and always scale wind-ups with `this.tele(s)` (tier, optics, loans).
- Telegraphs: `this.hazard(shape, warn, active, setup)`. Shapes: circle, ring, rect, line, sector. Set `low = true` for ground attacks (jumpable), `hitsPlayer = false` for visual-only lanes. Warnings are cancelled automatically on stagger/death.
- Bullets: `this.shoot / fan / ring` (soft by default; `{ soft: false }` for hard bolts). Tier speed is applied.
- Poise: player hits and environment add poise; at `poiseMax` the boss is staggered 3 s (`onStagger`, `onStaggerEnd`). Environment interactions should deal big poise.
- Multi-part bosses (heads): give each `BossPart` its own `dmgMul`, `invulnerable` or override `hurt`. Parts are bodies: set `targetable`, `solid`, `r/hz/hr`.
- `this.status` is shown under the HP bar (e.g. `断颈 3/8`).

## Rules for fun bosses

1. Every attack has a readable wind-up (red telegraph or a clear animation + sound) and a recovery window.
2. At least 3 arena interactions, and the boss itself uses or is affected by them.
3. Each phase adds something new, not just faster.
4. Damage to the player is 1 heart (2 for big committed attacks). Never unavoidable.
5. Reward the four weapons differently: something conductive for the arc, something pushable for the shotgun, bullets worth deflecting for the blade, surfaces/props for nails.

## Art

- Use `PixBuf` drawing and `grid()` strings with palette indices only; add a 1px ink outline (`buf.outline()`).
- Boss sprite: 3/4 top-down, origin bottom centre. Sheet frames are addressed by name.
- Arena background: 640x360 `PixBuf`, walls baked in. The HUD covers the top ~34 px, so keep `bounds.y >= 48`.
- Glows go on the `light` layer at runtime (`g.circle(..., 'light')`), not into the sprite.

## Testing

- `npm run typecheck`, `npm test` (add your boss to the sim test loop in `tests/sim.test.ts` — the lead will merge).
- Browser: `npm run dev`, open `/?boss=<id>&weapon=blade&god` and play; add `&bot` for the autopilot.
- Headless: see `tools/cdp.mjs` header (`--boss <id>`), screenshots in `screenshots/cdp/`.
