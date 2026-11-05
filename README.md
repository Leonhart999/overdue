# OVERDUE 逾期

Top-down boss-rush roguelite. Only boss fights: every arena has things you can use against the boss, every weapon plays differently, and every cyberware part replaces one of your moves. Pixel art and audio are generated in code.

Built from the assets of CHROME DEBT (`D:\AI\projects\chrome-debt`, tag `m1-paused`).

## Play

Double-click `play.bat` (or `npm install` once, then `npm run dev`) and open http://127.0.0.1:5174/.

WASD move · mouse aim · LMB attack · RMB weapon special · Space dash (legs) · Q arm · E interact · Esc pause.

## Develop

- `npm test` — art build + headless bot fights for every boss and weapon
- `npm run typecheck`
- Dev URL: `/?boss=gearjaw&weapon=arc&cyber=legs_leap,arm_fist&bot&god`
- `node tools/cdp.mjs` — headless Edge run with screenshots and console-error check

Docs: `docs/GDD.md` (design, Chinese), `docs/BOSS_API.md` (how to add a boss).

Font: Fusion Pixel 12px, SIL OFL 1.1 (`public/fonts/OFL-fusion-pixel.txt`).
