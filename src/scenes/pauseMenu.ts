/**
 * Pause menu shared by the fight and the hub: resume, settings (screen shake, damage numbers,
 * music and sound volume) and one exit action. Settings persist in meta (localStorage).
 */
import type Phaser from 'phaser';
import { audio } from '../engine/audio';
import { P, type Gfx } from '../engine/gfx';
import type { Fx } from '../game/fx';
import { saveMeta } from '../game/run';
import { session } from './session';
import { H, W } from '../ui/ui';

export interface Settings {
  shake: boolean;
  numbers: boolean;
  /** 0..4 steps */
  music: number;
  sfx: number;
}

export function settings(): Settings {
  const m = session.meta;
  if (!m.settings) m.settings = { shake: true, numbers: true, music: 3, sfx: 4 };
  return m.settings;
}

/** Apply settings to audio and an Fx instance (call when a scene starts and after changes). */
export function applySettings(fx?: Fx): void {
  const s = settings();
  audio.musicScale = s.music / 3;
  audio.setSfxVolume(s.sfx / 4);
  if (fx) {
    fx.shakeScale = s.shake ? 1 : 0;
    fx.showNumbers = s.numbers;
  }
}

type Row = { label: () => string; act?: (dir: number) => void; exit?: boolean };

export class PauseMenu {
  open = false;
  private focus = 0;
  private keys: string[] = [];
  private rows: Row[];

  constructor(scene: Phaser.Scene, private exitLabel: string, private onResume: () => void, private onExit: () => void, private fx?: Fx) {
    scene.input.keyboard!.on('keydown', (ev: KeyboardEvent) => { if (this.open && !ev.repeat) this.keys.push(ev.code); });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.open) this.keys.push(p.rightButtonDown() ? 'MouseRight' : 'MouseLeft'); });
    const bar = (n: number) => '■'.repeat(n) + '□'.repeat(4 - n);
    const s = settings();
    const save = () => { applySettings(this.fx); saveMeta(session.meta); };
    this.rows = [
      { label: () => '继续', act: () => this.close() },
      { label: () => `屏幕震动  ${s.shake ? '开' : '关'}`, act: () => { s.shake = !s.shake; save(); } },
      { label: () => `伤害数字  ${s.numbers ? '开' : '关'}`, act: () => { s.numbers = !s.numbers; save(); } },
      { label: () => `音乐  ${bar(s.music)}`, act: (d) => { s.music = (s.music + (d || 1) + 5) % 5; save(); } },
      { label: () => `音效  ${bar(s.sfx)}`, act: (d) => { s.sfx = (s.sfx + (d || 1) + 5) % 5; save(); audio.sfx('ui'); } },
      { label: () => this.exitLabel, exit: true },
    ];
  }

  show(): void { this.open = true; this.focus = 0; this.keys = []; audio.setMusicVolume(0.1); audio.loop('arc', false); }

  close(): void { this.open = false; this.onResume(); }

  /** Process queued input; `my` is the cursor y in screen space (hover selects a row). */
  update(my: number): void {
    const top = 150;
    for (let i = 0; i < this.rows.length; i++) if (my > top + i * 20 - 2 && my < top + i * 20 + 16) this.focus = i;
    const keys = this.keys;
    this.keys = [];
    for (const k of keys) {
      const row = this.rows[this.focus];
      if (k === 'ArrowUp' || k === 'KeyW') { this.focus = (this.focus + this.rows.length - 1) % this.rows.length; audio.sfx('ui'); }
      else if (k === 'ArrowDown' || k === 'KeyS') { this.focus = (this.focus + 1) % this.rows.length; audio.sfx('ui'); }
      else if (k === 'ArrowLeft' || k === 'KeyA' || k === 'MouseRight') row.act?.(-1);
      else if (k === 'ArrowRight' || k === 'KeyD') row.act?.(1);
      else if (k === 'Enter' || k === 'Space' || k === 'KeyE' || k === 'MouseLeft') {
        audio.sfx('uiConfirm');
        if (row.exit) { this.open = false; this.onExit(); return; }
        row.act?.(0);
        if (!this.open) return;
      } else if (k === 'Escape' || k === 'KeyP') { this.close(); return; }
    }
  }

  draw(g: Gfx, footer?: string): void {
    g.rect(0, 0, W, H, P.ink, 0.72, 'ui');
    g.text('暂停', W / 2, 112, { layer: 'ui', align: 'center', scale: 2, color: P.white });
    this.rows.forEach((r, i) => {
      const f = i === this.focus;
      g.text((f ? '> ' : '  ') + r.label(), W / 2, 150 + i * 20, { layer: 'ui', align: 'center', color: f ? P.cyan : r.exit ? P.rose : P.fog });
    });
    g.text('上下选择 · 左右调整 · Enter 确认 · Esc 继续', W / 2, 286, { layer: 'ui', align: 'center', color: P.slate });
    if (footer) g.text(footer, W / 2, 330, { layer: 'ui', align: 'center', color: P.slate });
  }
}
