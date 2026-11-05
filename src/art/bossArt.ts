/** Extra boss/arena art modules. Each boss developer owns one file and returns its sheets. */
import type { SheetSpec } from './core/sheet';
import { buildLuxArt } from './lux';
import { buildOctohydraArt } from './octohydra';

export function buildBossArt(): SheetSpec[] {
  return [...buildLuxArt(), ...buildOctohydraArt()];
}
