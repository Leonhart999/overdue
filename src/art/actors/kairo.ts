/** Kairo: an aged clockmaker rebuilt around an exposed pendulum, never a visor soldier. */
import { C } from '../palette';
import { Mask, PixBuf, shadeInto, type Pt } from '../core/pixbuf';

const gold = [C.ink, C.bronze02, C.bronze04, C.bronze06, C.bronze08, C.bronze10, C.bronze12];
const bone = [C.ink, C.steelWarm03, C.steelWarm05, C.steelWarm07, C.steelWarm09, C.steelWarm11, C.steelWarm12];
const blue = [C.ink, C.midnight02, C.midnight04, C.midnight06, C.midnight08, C.midnight10, C.midnight12];
const skin = [C.skinWarm01, C.skinWarm03, C.skinWarm05, C.skinWarm07, C.skinWarm09, C.skinWarm11, C.skinWarm12];
const silver = [C.ink, C.steelCool03, C.steelCool05, C.steelCool07, C.steelCool09, C.steelCool11, C.steelCool12];

function part(b: PixBuf, ramp: readonly number[], base: number, draw: (m: PixBuf) => void, rim?: number): void {
  shadeInto(b, new Mask(b.w, b.h).draw(draw), { ramp, base, light: [-1, -1], deepShadow: true, innerLine: true, rim });
}

/** A partial dial, with a deliberately open contour instead of the old circular halo. */
function arc(b: PixBuf, x: number, y: number, rx: number, ry: number, start: number, end: number, color: number): void {
  let previous: Pt | undefined;
  for (let a = start; a <= end; a += 0.025) {
    const p: Pt = [Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry)];
    if (previous) b.line(previous[0], previous[1], p[0], p[1], color);
    previous = p;
  }
}

function gear(b: PixBuf, x: number, y: number, r: number, color: number): void {
  b.circle(x, y, r, C.ink).ring(x, y, r - 1, color, 2);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    b.line(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2), x + Math.cos(a) * (r + 1), y + Math.sin(a) * (r + 1), color);
  }
  b.circle(x, y, 2, C.abyss).set(x - 1, y - 1, C.ice);
}

export function buildKairoStandee(broken: boolean): PixBuf {
  const b = new PixBuf(112, 144);
  const glow = broken ? C.ice : C.cyan;
  // The tall, offset escapement frame is the character's metronome silhouette.
  part(b, gold, 2, m => m.poly([[72, 5], [89, 12], [104, 104], [95, 139], [88, 132], [96, 104], [82, 19], [74, 17]], 1));
  b.line(77, 8, 85, 14, C.bronze10).line(88, 23, 102, 103, C.bronze08);
  for (let i = 0; i < 13; i++) {
    const y = 24 + i * 6, x = 89 + Math.floor(i * 1.05);
    b.line(x - (i % 3 === 0 ? 4 : 2), y, x, y, i % 3 === 0 ? C.bronze11 : C.bronze05);
  }
  arc(b, 58, 55, 44, 43, 3.5, 5.05, C.bronze04);
  arc(b, 58, 55, 46, 45, 3.7, 5.05, C.bronze08);
  for (let i = 0; i < 8; i++) {
    const a = 3.6 + i * 0.2;
    b.line(58 + Math.cos(a) * 41, 55 + Math.sin(a) * 40, 58 + Math.cos(a) * 46, 55 + Math.sin(a) * 45, i % 2 ? C.bronze06 : C.bronze11);
  }
  // A sun disc and a dark crescent show the two clock domains without extra lettering.
  b.circle(26, 19, 5, C.bronze04).circle(25, 18, 3, C.bronze11);
  b.circle(96, 49, 6, C.steelCool06).circle(98, 47, 5, C.ink);
  // Long tails form an hourglass waist. Ivory ages; midnight fabric stays pristine.
  part(b, blue, 3, m => m.poly([[53, 64], [73, 62], [86, 74], [79, 103], [99, 144], [69, 144], [59, 119], [47, 144], [26, 144], [39, 103], [33, 80]], 1), C.teal);
  part(b, bone, 4, m => m.poly([[42, 68], [53, 72], [47, 103], [52, 118], [38, 144], [23, 144], [37, 101], [30, 84]], 1));
  b.poly([[37, 106], [42, 107], [30, 144], [25, 144]], C.steelWarm07);
  b.poly([[75, 99], [80, 112], [94, 144], [84, 144]], C.midnight06);
  b.line(75, 108, 91, 142, C.bronze07).line(48, 120, 40, 143, C.bronze10);
  b.line(32, 136, 34, 130, C.steelWarm12).line(35, 124, 39, 112, C.steelWarm10);
  for (let y = 122; y < 142; y += 4) b.line(74 + (y - 122) / 3, y, 77 + (y - 122) / 3, y - 1, C.bronze06);
  // Narrow exposed neck, heavy asymmetric collars and an astrolabe shoulder.
  part(b, silver, 3, m => m.poly([[47, 53], [62, 52], [62, 72], [49, 77], [44, 67]], 1));
  for (let y = 60; y <= 69; y += 3) b.line(47, y, 59, y - 2, C.bronze08);
  part(b, bone, 5, m => m.poly([[29, 61], [42, 66], [50, 81], [40, 93], [34, 80]], 1));
  b.line(31, 65, 40, 71, C.steelWarm12).line(39, 74, 45, 82, C.bronze10);
  part(b, blue, 4, m => m.poly([[64, 56], [78, 50], [77, 69], [68, 85], [60, 78]], 1), C.teal);
  b.line(76, 53, 75, 68, C.bronze09).line(74, 70, 66, 81, C.bronze07);
  part(b, gold, 3, m => m.poly([[76, 68], [90, 75], [91, 87], [77, 85], [70, 76]], 1));
  arc(b, 78, 78, 13, 10, 3.4, 6.5, C.bronze11);
  b.line(78, 69, 78, 81, C.bronze09).circle(78, 77, 2, C.cyan);
  // Hollow torso: the illuminated object is a swinging weight, not a wristwatch.
  part(b, gold, 3, m => m.poly([[49, 78], [64, 77], [73, 92], [66, 113], [48, 117], [39, 96]], 1));
  b.poly([[50, 81], [62, 80], [68, 93], [62, 111], [49, 113], [44, 96]], C.ink);
  b.line(48, 86, 46, 97, C.bronze09).line(66, 91, 62, 107, C.bronze06);
  gear(b, 56, 84, 5, C.bronze10);
  const px = broken ? 64 : 55, py = broken ? 100 : 103;
  b.line(56, 85, px, py, C.bronze09).line(57, 87, px + 1, py, C.steelWarm12);
  b.poly([[px, py - 5], [px + 6, py], [px, py + 7], [px - 6, py]], C.bronze08);
  b.poly([[px, py - 3], [px + 3, py], [px, py + 4], [px - 3, py]], glow).set(px, py, C.white);
  b.line(48, 114, 62, 111, C.bronze11);
  // Far arm hangs behind the gesture; cloth is deliberately slim, not armoured.
  part(b, blue, 3, m => m.poly([[83, 85], [90, 89], [92, 111], [83, 126], [77, 120], [83, 107]], 1), C.teal);
  b.line(89, 95, 89, 109, C.midnight09).line(88, 113, 82, 122, C.bronze08);
  // Raised left hand pinches the sweep of a physical second hand.
  part(b, bone, 4, m => m.poly([[32, 80], [39, 89], [29, 103], [19, 88], [13, 76], [21, 72]], 1));
  b.line(22, 83, 30, 96, C.steelWarm11).line(28, 92, 32, 97, C.bronze08);
  part(b, gold, 4, m => m.poly([[12, 68], [23, 67], [25, 78], [16, 81], [10, 74]], 1));
  b.line(12, 70, 23, 69, C.bronze12);
  part(b, silver, 4, m => { m.capsule(16, 68, 13, 57, 2, 1); m.capsule(20, 67, 23, 58, 2, 1); m.capsule(22, 60, 18, 55, 1, 1); });
  b.line(13, 65, 12, 59, C.steelCool12).line(22, 64, 23, 60, C.steelCool12);
  b.circle(17, 53, 3, C.abyss).ring(17, 53, 3, glow);
  b.line(17, 53, 7, 29, C.bronze09).line(17, 53, 35, 68, C.bronze06);
  b.poly([[7, 25], [10, 33], [7, 31], [5, 33]], C.steelWarm12);
  // Close-up head: angular left-facing profile, swept white hair, no visor or helmet.
  part(b, skin, 4, m => m.poly([[44, 25], [57, 24], [68, 33], [64, 51], [53, 62], [43, 58], [38, 49], [33, 46], [39, 38]], 1));
  b.poly([[42, 35], [46, 33], [48, 45], [44, 52], [46, 57], [41, 54], [38, 46]], C.skinWarm10);
  b.line(39, 40, 36, 46, C.skinWarm12).line(36, 47, 40, 48, C.skinWarm05);
  b.poly([[49, 43], [51, 35], [57, 35], [55, 47], [49, 52]], C.skinWarm06);
  b.line(41, 53, 49, 53, C.skinWarm03).line(43, 55, 48, 55, C.skinWarm11);
  b.line(43, 58, 49, 60, C.skinWarm05);
  // Age lines sit below a single human eye; the other half is an exposed escapement.
  b.line(39, 36, 46, 35, C.steelWarm04).line(40, 40, 47, 39, C.skinWarm02);
  b.line(41, 41, 46, 40, C.steelWarm12).set(43, 40, C.abyss); b.set(43, 39, C.amber);
  b.line(39, 43, 42, 44, C.skinWarm06).line(46, 43, 48, 42, C.skinWarm05);
  b.line(48, 47, 50, 50, C.skinWarm04).line(47, 33, 51, 31, C.skinWarm06);
  part(b, silver, 3, m => m.poly([[56, 29], [67, 31], [71, 39], [65, 53], [55, 58], [53, 48], [56, 43], [53, 36]], 1), C.teal);
  b.line(57, 34, 55, 40, C.bronze09).line(57, 47, 56, 53, C.bronze08);
  gear(b, 62, 40, 6, C.bronze09);
  b.circle(61, 40, 3, C.abyss).line(61, 37, 61, 40, glow).line(61, 40, 64, 41, C.ice).set(60, 39, C.white);
  b.poly([[61, 48], [65, 47], [61, 53], [58, 54]], C.steelCool09);
  for (let i = 0; i < 3; i++) b.line(65 + i, 35 + i * 2, 69, 35 + i * 2, C.bronze04);
  // White, combed-back hair follows the long skull rather than the old round head.
  part(b, bone, 5, m => m.poly([[37, 33], [37, 25], [44, 18], [55, 16], [67, 20], [78, 16], [74, 25], [81, 24], [74, 32], [66, 32], [56, 26], [46, 27]], 1));
  b.line(43, 23, 55, 20, C.steelWarm12).line(55, 20, 69, 24, C.steelWarm12);
  b.line(48, 24, 59, 22, C.steelWarm09).line(61, 23, 73, 25, C.steelWarm09);
  b.line(39, 29, 44, 25, C.white).line(68, 28, 74, 27, C.steelWarm07);
  b.line(65, 31, 68, 33, C.bronze09);
  // Frost-white hair and aged ivory versus blue chrome; transformed form loses cohesion.
  if (broken) {
    b.poly([[44, 76], [48, 83], [43, 92], [45, 97], [41, 101], [39, 92]], C.ink);
    b.line(46, 81, 43, 89, C.cyan);
    b.line(59, 30, 59, 34, C.ink).line(59, 33, 54, 38, C.ink);
    b.poly([[69, 43], [75, 40], [77, 46], [72, 51]], C.steelCool07);
    b.line(72, 44, 75, 42, C.ice);
    b.poly([[67, 105], [71, 108], [68, 116], [65, 112]], C.bronze09);
    b.poly([[47, 118], [50, 120], [45, 127], [43, 125]], C.steelWarm10);
    b.line(70, 90, 74, 85, C.cyan).line(74, 85, 74, 81, C.ice);
    for (const [x, y] of [[52, 99], [51, 95], [54, 92], [58, 90], [76, 108], [80, 101], [84, 96]]) {
      b.set(x, y, C.ice); b.set(x + 1, y - 2, C.cyan);
    }
    // Displaced clock slices and reversed particles, all fixed pixels and deterministic.
    b.line(93, 33, 102, 32, C.cyan).line(95, 35, 105, 34, C.teal);
    b.line(85, 123, 101, 120, C.teal).line(89, 124, 104, 121, C.cyan);
    b.set(68, 59, C.ice); b.set(71, 56, C.cyan);
  }
  b.outline(C.ink);
  return b;
}

/** Matching 48x64 fight silhouette; same frame ids and foot anchor as the old sheet. */
export function buildKairoCombatFrame(frame: string, broken: boolean): PixBuf {
  const b = new PixBuf(48, 64), dy = frame === 'idle2' ? 1 : frame === 'hurt' ? 2 : 0;
  const y = 17 + dy, attack = frame === 'attack', glow = broken ? C.ice : C.cyan;
  b.poly([[34, 4], [39, 7], [44, 45], [40, 55], [38, 53], [41, 44], [36, 10], [33, 8]], C.bronze04);
  b.line(35, 5, 38, 8, C.bronze10).line(39, 13, 43, 44, C.bronze08);
  for (let j = 0; j < 7; j++) b.line(39 + Math.floor(j / 2), 15 + j * 4, 37 + Math.floor(j / 2), 15 + j * 4, C.bronze10);
  part(b, blue, 3, m => m.poly([[19, y + 10], [30, y + 8], [36, 37], [30, 45], [39, 57], [28, 57], [25, 47], [20, 58], [10, 57], [17, 40], [14, 30]], 1), C.teal);
  part(b, bone, 4, m => m.poly([[18, y + 10], [23, y + 13], [20, 40], [23, 45], [16, 57], [10, 57], [16, 39], [13, 31]], 1));
  b.line(31, 44, 36, 54, C.bronze08).line(20, 43, 16, 54, C.bronze09);
  b.rect(11, 57, 8, 3, C.steelCool03).rect(28, 57, 8, 3, C.steelCool03);
  part(b, silver, 3, m => m.rect(22, y + 6, 5, 8, 1));
  part(b, bone, 4, m => m.poly([[14, y + 8], [21, y + 12], [23, y + 18], [16, y + 19]], 1));
  part(b, blue, 4, m => m.poly([[27, y + 6], [33, y + 4], [33, y + 16], [27, y + 18]], 1), C.teal);
  b.poly([[22, y + 15], [28, y + 15], [31, y + 25], [26, y + 31], [19, y + 27]], C.bronze07);
  b.poly([[23, y + 17], [27, y + 17], [28, y + 25], [25, y + 29], [21, y + 26]], C.ink);
  b.line(25, y + 18, broken ? 28 : 24, y + 25, C.bronze11);
  const px = broken ? 28 : 24;
  b.poly([[px, y + 23], [px + 2, y + 26], [px, y + 29], [px - 2, y + 26]], glow).set(px, y + 26, C.white);
  // Long nose, one human eye, a mechanical temple and white swept-back hair.
  part(b, skin, 4, m => m.poly([[19, y - 6], [28, y - 6], [31, y], [27, y + 8], [21, y + 10], [17, y + 5], [14, y + 2], [18, y - 2]], 1));
  b.line(17, y + 1, 21, y, C.skinWarm03).set(19, y + 1, C.amber);
  b.line(19, y + 6, 23, y + 6, C.skinWarm04);
  part(b, silver, 3, m => m.poly([[26, y - 4], [31, y - 2], [30, y + 5], [25, y + 8], [25, y + 2]], 1));
  b.circle(28, y + 1, 3, C.bronze07).circle(28, y + 1, 2, C.abyss).set(27, y, glow);
  part(b, bone, 5, m => m.poly([[16, y - 2], [17, y - 7], [23, y - 11], [30, y - 9], [36, y - 10], [33, y - 5], [36, y - 5], [32, y - 1], [27, y - 4], [22, y - 5]], 1));
  b.line(21, y - 8, 28, y - 7, C.steelWarm12).line(28, y - 7, 32, y - 5, C.steelWarm09);
  const hx = attack ? 6 : 9, hy = attack ? y + 10 : y + 16;
  part(b, bone, 4, m => m.capsule(15, y + 17, hx + 2, hy + 4, 3, 1));
  b.line(hx, hy + 2, hx, hy - 3, C.steelCool11).line(hx + 3, hy + 2, hx + 4, hy - 3, C.steelCool09);
  b.line(hx + 1, hy - 3, hx - 3, hy - (attack ? 17 : 13), C.bronze10);
  b.set(hx - 3, hy - (attack ? 17 : 13), C.ice);
  if (broken) { b.line(18, 47, 15, 53, C.ink); b.set(33, y + 5, C.cyan); b.set(31, y + 10, C.ice); }
  // Combat frames face right; the standee faces left on the versus card.
  return b.outline(C.ink).flipX();
}
