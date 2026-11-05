/** OVERDUE entry: Phaser config and scene list. */
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { HubScene } from './scenes/HubScene';
import { FightScene } from './scenes/FightScene';
import { RewardScene } from './scenes/RewardScene';
import { ResultScene } from './scenes/ResultScene';
import { CoverScene } from './scenes/CoverScene';
import { session } from './scenes/session';
import { audio } from './engine/audio';
import { H, W } from './ui/ui';

// Headless screenshots run under virtual time where requestAnimationFrame barely ticks:
// drive the loop with setTimeout there.
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#0b0a12',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { keyboard: true, mouse: true, touch: false },
  disableContextMenu: true,
  fps: session.dev.shot ? { target: 60, forceSetTimeOut: true } : undefined,
  scene: [BootScene, TitleScene, HubScene, FightScene, RewardScene, ResultScene, CoverScene],
});

window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__od = { game, session };
