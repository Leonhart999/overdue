/** Extra boss/arena art modules. Each boss developer owns one file and returns its sheets. */
import type { SheetSpec } from './core/sheet';
import { buildCoverArt } from './cover';
import { buildLuxArt } from './lux';
import { buildOctohydraArt } from './octohydra';
import { buildKadeArt } from './kade';
import { buildVesperArt } from './vesper';

export function buildBossArt(): SheetSpec[] {
  return [...buildLuxArt(), ...buildOctohydraArt(), ...buildKadeArt(), ...buildVesperArt(), ...buildCoverArt()];
}
