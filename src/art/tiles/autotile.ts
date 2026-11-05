/**
 * Wall autotile resolver (pure, no Phaser). Implements the rule documented in tiles/common.ts
 * and docs/ART_STYLE.md so the client can call it directly:
 *
 *   const r = autotileWalls(w, h, (x, y) => map[y][x] === '#');
 *   r.wall[y][x]   -> 'wall_top_5' | 'wall_face_3' | null      (wall layer)
 *   r.shadow[y][x] -> true where the ground tile should be 'floor_shadow'
 */
export interface AutotileResult {
  wall: (string | null)[][];
  shadow: boolean[][];
}

/**
 * @param faceHeight how many wall rows above a floor are drawn as faces (1 = classic; 2 = two-storey
 *        facades in Rustport). Stacked faces repeat the face tile; swap in window/door tiles freely.
 */
export function autotileWalls(w: number, h: number, isWall: (x: number, y: number) => boolean, faceHeight = 1): AutotileResult {
  const wallAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? true : isWall(x, y));
  const faceAt = (x: number, y: number) => {
    if (!wallAt(x, y)) return false;
    for (let k = 1; k <= faceHeight; k++) {
      const yy = y + k;
      if (yy >= h) return false;
      if (!wallAt(x, yy)) return true;
    }
    return false;
  };
  const topAt = (x: number, y: number) => wallAt(x, y) && !faceAt(x, y);
  const wall: (string | null)[][] = [];
  const shadow: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    wall.push([]);
    shadow.push([]);
    for (let x = 0; x < w; x++) {
      if (!wallAt(x, y)) {
        wall[y].push(null);
        shadow[y].push(y > 0 && faceAt(x, y - 1));
        continue;
      }
      shadow[y].push(false);
      if (faceAt(x, y)) {
        const m = (faceAt(x + 1, y) ? 0 : 1) | (faceAt(x - 1, y) ? 0 : 2);
        wall[y].push(`wall_face_${m}`);
      } else {
        const m = (topAt(x, y - 1) ? 0 : 1) | (topAt(x + 1, y) ? 0 : 2) | (topAt(x, y + 1) ? 0 : 4) | (topAt(x - 1, y) ? 0 : 8);
        wall[y].push(`wall_top_${m}`);
      }
    }
  }
  return { wall, shadow };
}
