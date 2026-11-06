# OVERDUE UI style guide

Theme: **debt collection paperwork on a cyberdeck**. Every screen is a document Halcyon issues you: notices, contracts, receipts. Clean, dense, readable; neon only where it means something.

## 1. Principles
1. **Crisp pixels only.** Nothing is ever drawn with smoothing. Large text is never a scaled 12 px Phaser text (it blurs): headings use pixel-rendered glyph textures (see §4).
2. **One frame language.** Every panel, card, slot and bar uses the same kit (§3). Colour says what kind of thing it is, not which developer drew it.
3. **Hierarchy by size and contrast, not by boxes.** Title (crisp ×2) → section label (12 px, dim, small caps EN tag) → body (12 px pale) → hint (12 px slate).
4. **Show inputs as key caps**, not words: `[E] 互动`, `[Esc] 继续`, `[空格] 冲刺`, mouse buttons as small mouse icons with the button lit.
5. **The game stays visible.** Overlays dim the world (ink, 70–80 %) and sit on an opaque panel; nothing floats over gameplay without a backing plate.

## 2. Colour roles (palette names from `src/art/palette.ts`)
| Role | Colour | Use |
|---|---|---|
| Base panel | `night` fill, `navy` inner, `ink` outline | every panel |
| Bevel | `slate` top/left 1 px, `ink` bottom/right | panel edge light |
| System / player | `cyan` / `ice` | focus, selection, player info, cyberware legs |
| Danger / Halcyon | `red` / `rose` / `maroon` | boss, contracts, defeat, damage |
| Money / interact | `amber` / `sodium` | prompts, rewards, records, highlights |
| Hack / data | `acid` | simulator, jack, terminals |
| Text | `white` titles, `pale` body, `fog` secondary, `slate` hints |
Accent = a 2 px strip on the panel's left edge or header underline, plus corner brackets. Max one accent colour per panel.

## 3. Kit (`src/art/uiKit.ts` textures + `src/ui/ui.ts` / Gfx helpers)
- **Panel**: 9-slice, cut corner top-left and bottom-right (4 px), 1 px ink outline, 1 px bevel, `night` body with a faint 2 px scanline dither at 8 % on the body. Variants: neutral, focused (cyan edge), danger (red edge).
- **Header strip**: 18 px tall band at the top of a panel: crisp ×2 title on the left, small EN tag (e.g. `CYBERWARE BENCH`, 12 px, `fog`, letter-spaced) and a barcode/serial decoration on the right in the accent colour.
- **Corner brackets**: 6×6 L-shapes in the accent colour at the four corners of focused items.
- **Row / list item**: 1 px divider between rows (`navy`), focused row gets an accent bar (2 px) on the left, a `navy` fill and a `>` chevron.
- **Key caps**: 12×12 (wide keys 20–28 px) rounded rect, `slate` cap with `fog` top highlight and `ink` outline, glyph in `white`. Mouse: 10×14 mouse outline with the pressed button filled in `cyan`.
- **Bars**: 1 px ink frame, `maroon`/`navy` track, fill with a 1 px highlight line on top, segment ticks every N units; damage chip-away (white trail that catches up after 0.4 s) on HP bars.
- **Stamp**: rotated rectangle stamp for big verdicts (清算完成 / 被收回 / 已签), red or amber, slightly distressed.

## 4. Typography
- Font: Fusion Pixel 12 px (CJK + Latin). Body always at ×1.
- Headings: crisp ×2 / ×3 via a glyph texture cache: render the string once into an offscreen canvas at 12 px, threshold alpha (> 50 %) to hard pixels, upload as a texture, draw with integer scale. Cache by (string, colour). Optional 1 px `ink` outline and a 1 px drop shadow baked in.
- Numbers in the HUD can use a small custom 3×5/4×6 pixel digit font for compactness.
- Line breaks: `wrapCjk()` in `src/ui/ui.ts`.

## 5. Screens
- **HUD** (top 34 px band, fight + hub): left module = player plate (hearts as chrome cells with red fill, shield pips, weapon icon + name + ammo/charge bar); centre = boss plate (name in crisp ×2? no: ×1 white on a red-edged name tab, HP bar 260×7 with phase ticks + chip-away, poise strip under it, status text right-aligned); right = 4 cyberware slots (existing icons) with key caps under legs/arm and cooldown sweep. Each module on its own semi-opaque panel so the arena art never fights with it.
- **Interact prompt**: key cap `[E]` + verb on a small amber-edged tag above the player.
- **Pause**: centred panel with header `暂停 / PAUSED`, rows with key-cap hints in the footer; the world dims.
- **Reward**: three **contract cards**: header band coloured by kind (cyberware = slot colour, mod = weapon colour, max HP = red), icon in a socket, name crisp ×2, rule text, footer `替换：…` / `新部位`, signature-drop ribbon. Focused card lifts 2 px with corner brackets. Loan = a red-stamped contract sheet.
- **Result**: a **settlement receipt**: perforated top/bottom edges, monospace-like rows (boss, time, hits, dodges, staggers, env damage), dotted leaders, total line, a big rotated stamp (`清算完成` amber / `被收回` red), Echo standee beside it.
- **Hub overlays** (bench, records, simulator): same panel + header strip; bench rows = slot icon socket + name + ◀▶ chips + rule text; records = two-column ledger; simulator = list + standee preview.
- **Title**: keep the cover; menu becomes a slim panel with key-cap hints.
- **Boss intro / phase card**: keep the layout; title crisp ×2, EN tag letter-spaced, thin red rules.
