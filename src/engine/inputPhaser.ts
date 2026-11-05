/** Keyboard + mouse input collector (Phaser). */
import Phaser from 'phaser';
import { emptyInput } from './input';

/** Keyboard + mouse collector bound to a scene. */
export class KeyboardMouseInput {
  readonly state = emptyInput();
  private keys: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      w: K.W, a: K.A, s: K.S, d: K.D, up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      space: K.SPACE, shift: K.SHIFT, q: K.Q, e: K.E, f: K.F, esc: K.ESC, p: K.P,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    scene.input.mouse?.disableContextMenu();
    const st = this.state;
    kb.on('keydown', (ev: KeyboardEvent) => {
      const c = ev.code;
      if (c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight') st.dashPressed = true;
      if (c === 'KeyQ') { if (!st.arm) st.armPressed = true; st.arm = true; }
      if (c === 'KeyE' || c === 'KeyF') st.interactPressed = true;
      if (c === 'Escape' || c === 'KeyP') st.pausePressed = true;
    });
    kb.on('keyup', (ev: KeyboardEvent) => {
      if (ev.code === 'KeyQ') { st.arm = false; st.armReleased = true; }
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) { if (!st.alt) st.altPressed = true; st.alt = true; }
      if (p.leftButtonDown()) { if (!st.fire) st.firePressed = true; st.fire = true; }
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (st.alt && !p.rightButtonDown()) { st.alt = false; st.altReleased = true; }
      if (st.fire && !p.leftButtonDown()) { st.fire = false; st.fireReleased = true; }
    };
    scene.input.on('pointerup', up);
    // released while the cursor is outside the canvas: Phaser only sends pointerupoutside
    scene.input.on('pointerupoutside', up);
    // Losing focus must not leave buttons stuck down.
    scene.game.events.on(Phaser.Core.Events.BLUR, () => {
      if (st.fire) st.fireReleased = true;
      if (st.alt) st.altReleased = true;
      if (st.arm) st.armReleased = true;
      st.fire = st.alt = st.arm = false;
    });
  }

  /** Refresh held axes and the aim point (call once per rendered frame). */
  poll(cam: Phaser.Cameras.Scene2D.Camera): void {
    const k = this.keys, st = this.state;
    let x = 0, y = 0;
    if (k.a.isDown || k.left.isDown) x -= 1;
    if (k.d.isDown || k.right.isDown) x += 1;
    if (k.w.isDown || k.up.isDown) y -= 1;
    if (k.s.isDown || k.down.isDown) y += 1;
    const l = Math.hypot(x, y);
    st.mx = l ? x / l : 0;
    st.my = l ? y / l : 0;
    const p = this.scene.input.activePointer;
    const wp = cam.getWorldPoint(p.x, p.y);
    st.ax = wp.x;
    st.ay = wp.y;
  }
}
