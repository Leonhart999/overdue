/** Small UI kit for menu scenes (Phaser objects). Fight HUD uses Gfx instead (scenes/hud.ts). */
import Phaser from 'phaser';
import { audio } from '../engine/audio';
import { P } from '../engine/gfx';

export const W = 640;
export const H = 360;
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export function text(scene: Phaser.Scene, x: number, y: number, str: string, o: { color?: number; scale?: number; align?: 'left' | 'center' | 'right'; wrap?: number; alpha?: number; stroke?: boolean } = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, str, {
    fontFamily: 'FusionPixel', fontSize: '12px', color: hex(o.color ?? P.pale),
    wordWrap: o.wrap ? { width: o.wrap / (o.scale ?? 1), useAdvancedWrap: true } : undefined,
    lineSpacing: 2,
  });
  t.setResolution(1);
  if (o.stroke) t.setStroke(hex(P.ink), 3);
  t.setScale(o.scale ?? 1);
  t.setOrigin(o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0, 0);
  t.setAlpha(o.alpha ?? 1);
  return t;
}

/** Cut-corner panel. */
export function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, edge: number = P.slate, fill: number = P.night, fillA = 0.92): void {
  const c = 5;
  const pts = [
    { x: x + c, y }, { x: x + w, y }, { x: x + w, y: y + h - c }, { x: x + w - c, y: y + h }, { x, y: y + h }, { x, y: y + c },
  ];
  g.fillStyle(fill, fillA).fillPoints(pts, true);
  g.lineStyle(1, edge, 1).strokePoints(pts, true, true);
}

export interface MenuItem {
  x: number;
  y: number;
  w: number;
  h: number;
  onSelect: () => void;
  onFocus?: () => void;
  disabled?: boolean;
}

/**
 * Keyboard + mouse navigation over rectangular items.
 * Arrow keys / WASD move focus (by geometry), Enter/Space/E selects, mouse hover focuses, click selects.
 */
export class Menu {
  focus = 0;
  private items: MenuItem[] = [];
  private locked = false;

  constructor(private scene: Phaser.Scene, private onChange: () => void) {
    const kb = scene.input.keyboard!;
    kb.on('keydown', (ev: KeyboardEvent) => {
      if (this.locked || !this.items.length) return;
      audio.unlock();
      const c = ev.code;
      if (c === 'ArrowUp' || c === 'KeyW') this.move(0, -1);
      else if (c === 'ArrowDown' || c === 'KeyS') this.move(0, 1);
      else if (c === 'ArrowLeft' || c === 'KeyA') this.move(-1, 0);
      else if (c === 'ArrowRight' || c === 'KeyD') this.move(1, 0);
      else if (c === 'Enter' || c === 'Space' || c === 'KeyE') this.select();
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const i = this.hit(p.x, p.y);
      if (i >= 0 && i !== this.focus) this.setFocus(i);
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock();
      if (this.locked || !p.leftButtonDown()) return;
      const i = this.hit(p.x, p.y);
      if (i >= 0) { this.setFocus(i); this.select(); }
    });
  }

  set(items: MenuItem[], focus = 0): void {
    this.items = items;
    this.focus = Math.min(focus, items.length - 1);
    this.items[this.focus]?.onFocus?.();
    this.onChange();
  }

  lock(v: boolean): void { this.locked = v; }

  private hit(px: number, py: number): number {
    const cam = this.scene.cameras.main;
    const x = (px - cam.x) / cam.zoom, y = (py - cam.y) / cam.zoom;
    return this.items.findIndex((it) => !it.disabled && x >= it.x && y >= it.y && x < it.x + it.w && y < it.y + it.h);
  }

  setFocus(i: number): void {
    this.focus = i;
    this.items[i]?.onFocus?.();
    audio.sfx('ui');
    this.onChange();
  }

  private move(dx: number, dy: number): void {
    const cur = this.items[this.focus];
    if (!cur) return;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = -1, bd = Infinity;
    this.items.forEach((it, i) => {
      if (i === this.focus || it.disabled) return;
      const ix = it.x + it.w / 2 - cx, iy = it.y + it.h / 2 - cy;
      const along = ix * dx + iy * dy;
      if (along <= 0) return;
      const off = Math.abs(ix * dy) + Math.abs(iy * dx);
      const d = along + off * 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) this.setFocus(best);
  }

  private select(): void {
    const it = this.items[this.focus];
    if (!it || it.disabled) return;
    audio.sfx('uiConfirm');
    it.onSelect();
  }
}

/** Fade the camera out, then start another scene. */
export function goto(scene: Phaser.Scene, key: string, data?: object, ms = 220): void {
  scene.cameras.main.fadeOut(ms, 5, 4, 10);
  scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => scene.scene.start(key, data));
}
