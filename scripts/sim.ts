// Headless night simulation for tuning: `npm run sim`.
// The monster stands still (or wanders toward prey with --chase), and we log
// how long wanderers take to find an exit and how scared they get.
import { CFG } from '../src/config';
import { Game } from '../src/game';

const chase = process.argv.includes('--chase');
const nights = 20;
const dt = 1 / 30;
const escapeTimes: number[] = [];
let escaped = 0, total = 0, caught = 0, peakFearSum = 0;

for (let n = 0; n < nights; n++) {
  const events = { sound() {}, caption() {}, toast() {} };
  const g = new Game(`sim-${n}`, events);
  const peak = new Map<number, number>();
  while (!g.over) {
    if (chase) {
      const target = g.wanderers.find((w) => w.active);
      if (target) {
        const path = g.level.path(g.level.cellAt(g.monster.x, g.monster.z), target.cell) ?? [];
        const next = path[0];
        if (next !== undefined) {
          const p = g.level.center(next);
          g.moveMonster(p.x - g.monster.x, p.z - g.monster.z, dt);
        } else {
          g.moveMonster(target.x - g.monster.x, target.z - g.monster.z, dt);
        }
        const fx = target.x - g.monster.x, fz = target.z - g.monster.z, fl = Math.hypot(fx, fz) || 1;
        const c = g.catchable(fx / fl, fz / fl);
        if (c) g.catch(c);
      }
    }
    for (const w of g.wanderers) {
      const wasActive = w.active;
      peak.set(w.id, Math.max(peak.get(w.id) ?? 0, w.fear));
      void wasActive;
    }
    g.update(dt);
    for (const w of g.wanderers) {
      if (w.escaped && !(w as any)._logged) {
        (w as any)._logged = true;
        escapeTimes.push(g.t - w.enterAt);
      }
    }
  }
  for (const w of g.wanderers) {
    total++;
    if (w.escaped) escaped++;
    if (w.caught) caught++;
    peakFearSum += peak.get(w.id) ?? 0;
  }
  console.log(`night ${n}: escaped ${g.result!.escaped}, caught ${g.result!.caught}, score ${g.result!.score}, ended ${g.result!.reason} at ${g.t.toFixed(0)}s`);
}

escapeTimes.sort((a, b) => a - b);
const med = escapeTimes[Math.floor(escapeTimes.length / 2)] ?? NaN;
console.log(`\n${chase ? 'CHASE' : 'IDLE'} monster over ${nights} nights (${CFG.NIGHT_SECONDS}s each)`);
console.log(`escaped ${escaped}/${total}, caught ${caught}/${total}`);
console.log(`escape time: min ${escapeTimes[0]?.toFixed(0)}s, median ${med.toFixed(0)}s, max ${escapeTimes.at(-1)?.toFixed(0)}s`);
console.log(`avg peak fear ${(peakFearSum / total).toFixed(0)}`);
