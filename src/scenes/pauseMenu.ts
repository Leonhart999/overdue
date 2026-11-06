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
import { UI } from '../data/text';
import { cells, cellsWidth, dim, focusRow, header, hints, hintStrip, panel, parseControls, txt, type Hint } from '../ui/kit';

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

type Row = {
  label: string;
  /** Right-hand value: a toggle or a 0..4 level. */
  value?: () => { on: boolean } | { level: number };
  act?: (dir: number) => void;
  exit?: boolean;
};

// layout (screen space)
const PW = 256, PX = (W - PW) / 2, PY = 88;
const ROW_H = 18, ROWS_Y = PY + 40;
const HINTS: Hint[] = [
  { keys: ['↑↓'], label: '选择' },
  { keys: ['←→'], label: '调整' },
  { keys: ['Enter'], label: '确认' },
  { keys: ['Esc'], label: '继续' },
];

export class PauseMenu {
  open = false;
  private focus = 0;
  private keys: string[] = [];
  private rows: Row[];
  private controls: Hint[] | null = null;
  private controlsSrc = '';

  constructor(scene: Phaser.Scene, private exitLabel: string, private onResume: () => void, private onExit: () => void, private fx?: Fx) {
    scene.input.keyboard!.on('keydown', (ev: KeyboardEvent) => { if (this.open && !ev.repeat) this.keys.push(ev.code); });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.open) this.keys.push(p.rightButtonDown() ? 'MouseRight' : 'MouseLeft'); });
    const s = settings();
    const save = () => { applySettings(this.fx); saveMeta(session.meta); };
    this.rows = [
      { label: '继续', act: () => this.close() },
      { label: '屏幕震动', value: () => ({ on: s.shake }), act: () => { s.shake = !s.shake; save(); } },
      { label: '伤害数字', value: () => ({ on: s.numbers }), act: () => { s.numbers = !s.numbers; save(); } },
      { label: '音乐', value: () => ({ level: s.music }), act: (d) => { s.music = (s.music + (d || 1) + 5) % 5; save(); } },
      { label: '音效', value: () => ({ level: s.sfx }), act: (d) => { s.sfx = (s.sfx + (d || 1) + 5) % 5; save(); audio.sfx('ui'); } },
      { label: this.exitLabel, exit: true },
    ];
  }

  private rowY(i: number): number { return ROWS_Y + i * ROW_H + (this.rows[i].exit ? 6 : 0); }

  private get panelH(): number { return this.rowY(this.rows.length - 1) + ROW_H - PY + 32; }

  show(): void { this.open = true; this.focus = 0; this.keys = []; audio.setMusicVolume(0.1); audio.loop('arc', false); }

  close(): void { this.open = false; this.onResume(); }

  /** Process queued input; `my` is the cursor y in screen space (hover selects a row). */
  update(my: number): void {
    for (let i = 0; i < this.rows.length; i++) if (my >= this.rowY(i) && my < this.rowY(i) + ROW_H) this.focus = i;
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

  /** Draw over everything (layer 'over'). `footer` is a controls line shown as key caps at the bottom. */
  draw(g: Gfx, footer?: string): void {
    const L = 'over' as const;
    dim(g, 0.78, L);
    const ph = this.panelH;
    panel(g, PX, PY, PW, ph, { layer: L, accent: P.cyan, alpha: 1 });
    header(g, PX, PY, PW, UI.pause, 'PAUSED', P.cyan, { layer: L });
    this.rows.forEach((r, i) => {
      const y = this.rowY(i);
      const f = i === this.focus;
      if (r.exit) g.rect(PX + 8, y - 4, PW - 16, 1, P.navy, 1, L);
      if (f) focusRow(g, PX + 6, y, PW - 12, ROW_H, r.exit ? P.rose : P.cyan, L);
      txt(g, r.label, PX + 20, y + 3, { layer: L, color: f ? P.white : r.exit ? P.rose : P.pale });
      const v = r.value?.();
      const rx = PX + PW - 16;
      if (v && 'on' in v) {
        const on = v.on;
        // two-state switch: 关 | 开, the active side lit
        const wOn = 20, wOff = 20, sx = rx - wOn - wOff;
        g.rect(sx - 1, y + 1, wOn + wOff + 2, 16, P.ink, 1, L);
        g.rect(on ? sx + wOff : sx, y + 2, on ? wOn : wOff, 14, on ? P.cyan : P.slate, 1, L);
        txt(g, UI.off, sx + wOff / 2, y + 3, { layer: L, align: 'center', color: on ? P.slate : P.white });
        txt(g, UI.on, sx + wOff + wOn / 2, y + 3, { layer: L, align: 'center', color: on ? P.ink : P.slate });
      } else if (v && 'level' in v) {
        cells(g, rx - cellsWidth(4), y + 5, 4, v.level, f ? P.cyan : P.fog, { layer: L });
      }
    });
    const fy = PY + ph - 22;
    g.rect(PX + 8, fy - 4, PW - 16, 1, P.navy, 1, L);
    hints(g, HINTS, W / 2, fy, { layer: L, align: 'center', gap: 10 });
    if (footer) {
      if (footer !== this.controlsSrc) { this.controlsSrc = footer; this.controls = parseControls(footer); }
      hintStrip(g, this.controls!, H - 26, { layer: L, alpha: 1 });
    }
  }
}
