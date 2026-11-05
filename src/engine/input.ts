/**
 * Input: a plain snapshot that gameplay reads every fixed step.
 * `*Pressed` / `*Released` are edges since the previous step; the collector clears them after
 * each step consumes them, so no press is lost when a frame runs several steps (or none).
 */

export interface InputState {
  /** Movement axis, already normalised to length <= 1. */
  mx: number;
  my: number;
  /** Aim point in world coordinates. */
  ax: number;
  ay: number;
  fire: boolean;
  firePressed: boolean;
  fireReleased: boolean;
  alt: boolean;
  altPressed: boolean;
  altReleased: boolean;
  dashPressed: boolean;
  arm: boolean;
  armPressed: boolean;
  armReleased: boolean;
  interactPressed: boolean;
  pausePressed: boolean;
}

export function emptyInput(): InputState {
  return {
    mx: 0, my: 0, ax: 320, ay: 180,
    fire: false, firePressed: false, fireReleased: false,
    alt: false, altPressed: false, altReleased: false,
    dashPressed: false, arm: false, armPressed: false, armReleased: false,
    interactPressed: false, pausePressed: false,
  };
}

export function clearEdges(s: InputState): void {
  s.firePressed = s.fireReleased = s.altPressed = s.altReleased = false;
  s.dashPressed = s.armPressed = s.armReleased = s.interactPressed = s.pausePressed = false;
}

