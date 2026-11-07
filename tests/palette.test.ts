import { describe, expect, it } from 'vitest';
import { C, PALETTE, PALETTE_RGB, PALETTE_U32, RAMP_EXTENDED } from '../src/art/palette';
import { PixBuf } from '../src/art/core/pixbuf';
import { P } from '../src/engine/gfx';

// Existing sprites and stored index data depend on these exact entries and positions.
const LEGACY = [
  ['clear', '#000000'], ['ink', '#0b0a12'], ['night', '#161528'], ['navy', '#22213f'],
  ['indigo', '#2f2d58'], ['slate', '#444474'], ['steel', '#63679a'], ['fog', '#9097c0'],
  ['pale', '#ccd2ea'], ['white', '#f5f6ff'], ['plum', '#2c1833'], ['grape', '#4d2560'],
  ['orchid', '#8e3d92'], ['magenta', '#ff2a8f'], ['rose', '#ff9bd2'], ['abyss', '#0d3442'],
  ['teal', '#157f99'], ['cyan', '#2de2f5'], ['ice', '#c0f8ff'], ['moss', '#1b4429'],
  ['lime', '#46a52b'], ['acid', '#a8ff3c'], ['maroon', '#651427'], ['red', '#e62a3e'],
  ['umber', '#3b2119'], ['rust', '#8c3f1d'], ['orange', '#e07a1f'], ['sodium', '#ffab38'],
  ['amber', '#ffe27a'], ['skinL', '#f3c7a3'], ['skinM', '#d08d68'], ['skinD', '#91543f'], ['skinX', '#55302a'],
] as const;

describe('8-bit art palette', () => {
  it('fills all 256 slots with unique names and colors', () => {
    expect(PALETTE).toHaveLength(256);
    expect(new Set(PALETTE.map(p => p.name)).size).toBe(256);
    expect(new Set(PALETTE.map(p => p.hex.toLowerCase())).size).toBe(256);
    expect(Object.keys(C)).toHaveLength(256);
    for (const name of Object.keys(C) as (keyof typeof C)[]) {
      const index = C[name];
      expect(PALETTE[index].name).toBe(name);
      expect(P[name]).toBe(parseInt(PALETTE[index].hex.slice(1), 16));
    }
  });

  it('keeps every original index and color unchanged', () => {
    for (const [index, [name, hex]] of LEGACY.entries()) {
      expect(C[name]).toBe(index);
      expect(PALETTE[index]).toMatchObject({ name, hex });
    }
  });

  it('retains opaque index 255 through pixel writes and copies', () => {
    const pixels = new PixBuf(16, 16);
    for (let i = 0; i < 256; i++) pixels.set(i % 16, Math.floor(i / 16), i);
    expect(Array.from(pixels.px)).toEqual(Array.from({ length: 256 }, (_, i) => i));
    const copied = new PixBuf(16, 16);
    copied.blit(pixels, 0, 0);
    expect(copied.get(15, 15)).toBe(255);
    expect(copied.clone().get(15, 15)).toBe(255);
  });

  it('packs every opaque entry as RGBA with an opaque alpha byte', () => {
    expect(PALETTE_U32).toHaveLength(256);
    expect(PALETTE_U32[0]).toBe(0);
    for (let i = 1; i <= 255; i++) {
      const packed = PALETTE_U32[i];
      expect(packed >>> 24).toBe(255);
      expect([packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255]).toEqual(PALETTE_RGB[i]);
    }
  });

  it('provides ordered dark-to-light material ramps covering all new colors', () => {
    const used = new Set<number>();
    for (const ramp of Object.values(RAMP_EXTENDED)) {
      let previous = -1;
      for (const index of ramp) {
        const [r, g, b] = PALETTE_RGB[index];
        const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        expect(light).toBeGreaterThan(previous);
        previous = light;
        used.add(index);
      }
    }
    expect([...used].sort((a, b) => a - b)).toEqual(Array.from({ length: 223 }, (_, i) => i + 33));
  });
});
