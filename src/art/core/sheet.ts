/**
 * Sheets: a set of equally sized frames rendered into one canvas.
 * A sheet becomes one Phaser texture whose frames are addressable both by index (0..n-1)
 * and by name (e.g. 'down_idle').
 */
import { PALETTE_RGB, PALETTE_U32 } from '../palette';
import { PixBuf } from './pixbuf';

export interface FrameSpec {
  name: string;
  buf: PixBuf;
}

export interface AnimSpec {
  /** Global animation key, e.g. 'echo_walk_down'. */
  key: string;
  /** Frame indices (numbers) into the sheet. */
  frames: number[];
  frameRate: number;
  /** -1 = loop forever, 0 = play once. */
  repeat: number;
  yoyo?: boolean;
}

export interface SheetSpec {
  /** Phaser texture key. */
  key: string;
  /** Preview grouping, e.g. 'Overworld characters'. */
  group: string;
  frameW: number;
  frameH: number;
  /** Columns in the rendered canvas (tilesets: 8). Default: min(frames, 16). */
  columns?: number;
  frames: FrameSpec[];
  anims?: AnimSpec[];
  /** Free-form documentation for the client (tile tables, nine-slice insets, origins...). */
  meta?: Record<string, unknown>;
}

export interface FrameRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BuiltSheet {
  spec: SheetSpec;
  canvas: HTMLCanvasElement;
  columns: number;
  rects: FrameRect[];
}

/** Render a sheet spec into a canvas. */
export function renderSheet(spec: SheetSpec): BuiltSheet {
  const n = spec.frames.length;
  const columns = Math.max(1, Math.min(n, spec.columns ?? 16));
  const rows = Math.ceil(n / columns);
  const W = columns * spec.frameW, H = rows * spec.frameH;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  const rects: FrameRect[] = [];
  spec.frames.forEach((f, i) => {
    const fx = (i % columns) * spec.frameW, fy = Math.floor(i / columns) * spec.frameH;
    rects.push({ name: f.name, x: fx, y: fy, w: spec.frameW, h: spec.frameH });
    const b = f.buf;
    if (b.w !== spec.frameW || b.h !== spec.frameH) {
      throw new Error(`[art] ${spec.key}/${f.name}: frame is ${b.w}x${b.h}, sheet expects ${spec.frameW}x${spec.frameH}`);
    }
    for (let y = 0; y < b.h; y++) {
      const row = (fy + y) * W + fx;
      for (let x = 0; x < b.w; x++) {
        const c = b.px[y * b.w + x];
        if (!c) continue;
        if (b.alpha) {
          const a = b.alpha[y * b.w + x];
          const [r, g, bl] = PALETTE_RGB[c];
          out[row + x] = ((a << 24) | (bl << 16) | (g << 8) | r) >>> 0;
        } else {
          out[row + x] = PALETTE_U32[c];
        }
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return { spec, canvas, columns, rects };
}
