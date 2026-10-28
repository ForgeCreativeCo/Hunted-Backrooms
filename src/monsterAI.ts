import { CFG } from './config';
import { Game, Pulse, Wanderer } from './game';

// The monster when nobody is playing it: solo nights where you're a human.
// It wanders the level, listens for footsteps and breathing, chases whatever it
// sees, kills the lights on people it's stalking and moves walls behind them.
// A flashlight held on it long enough drives it back into the dark.

type AIState = 'roam' | 'listen' | 'chase' | 'search' | 'recoil';

const SPEED: Record<AIState, number> = { roam: 0.55, listen: 0.75, chase: 0.9, search: 0.65, recoil: 1 };

export class MonsterAI {
  state: AIState = 'roam';
  private stateT = 0;
  private goal = -1;
  private path: number[] = [];
  private pathKey = '';
  private target: Wanderer | null = null;
  private lastX = 0;
  private lastZ = 0;
  private heard = new WeakSet<Pulse>();
  private beamT = 0;
  private stuckT = 0;
  private progX = 0;
  private progZ = 0;
  private blackoutT = 30;
  private shiftT = 40;
  /** Seconds it stays still: at dusk, so the player can get their bearings, and after it feeds. */
  private waitT = 20;

  constructor(private g: Game) {}

  update(dt: number) {
    const g = this.g;
    const L = g.level;
    const m = g.monster;
    if (this.waitT > 0) {
      this.waitT -= dt;
      m.moving = false;
      return;
    }
    this.stateT += dt;
    this.blackoutT -= dt;
    this.shiftT -= dt;

    // A light held on it: it gives up and backs off into the dark.
    this.beamT = g.inAnyBeam(m.x, m.z) ? this.beamT + dt : Math.max(0, this.beamT - dt * 2);
    if (this.beamT > 1 && this.state !== 'recoil') this.recoil();

    // Sight beats sound.
    const seen = this.state === 'recoil' ? null : this.spot();
    if (seen) {
      this.target = seen;
      this.lastX = seen.x;
      this.lastZ = seen.z;
      if (this.state !== 'chase') this.setState('chase');
    } else {
      const p = this.state === 'chase' || this.state === 'recoil' ? null : this.listen();
      if (p) {
        this.lastX = p.x;
        this.lastZ = p.z;
        this.setState('listen');
        this.goTo(L.cellAt(p.x, p.z));
      }
    }

    switch (this.state) {
      case 'chase':
        if (!seen) {
          // Lost them: go where they were last seen.
          this.setState('search');
          this.goTo(L.cellAt(this.lastX, this.lastZ));
        }
        break;
      case 'listen':
      case 'search':
        if (this.arrived()) {
          if (this.stateT < 8) this.goTo(this.nearbyCell(L.cellAt(m.x, m.z), 1, 3));
          else this.roam();
        }
        break;
      case 'recoil':
        if (this.arrived() || this.stateT > 6) { this.beamT = 0; this.roam(); }
        break;
      default:
        if (this.goal < 0 || this.arrived() || this.stateT > 40) this.roam();
    }

    this.useAbilities();

    // Move.
    if (this.state === 'chase' && this.target) {
      const t = this.target;
      if (L.los(m.x, m.z, t.x, t.z)) this.step(t.x - m.x, t.z - m.z, dt);
      else this.followPath(L.cellAt(t.x, t.z), dt);
      const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
      const w = g.catchable(fx, fz);
      if (w) {
        g.catch(w);
        this.waitT = 12; // it stays to feed
        this.roam();
      }
    } else {
      this.followPath(this.goal, dt);
    }

    // Stuck on furniture or a door: try somewhere else.
    if (Math.hypot(m.x - this.progX, m.z - this.progZ) > 0.6) {
      this.progX = m.x;
      this.progZ = m.z;
      this.stuckT = 0;
    } else if ((this.stuckT += dt) > 2.5) {
      this.stuckT = 0;
      this.goTo(this.nearbyCell(L.cellAt(m.x, m.z), 1, 2));
    }
  }

  private setState(s: AIState) {
    this.state = s;
    this.stateT = 0;
    if (s !== 'chase') this.target = null;
  }

  private goTo(cell: number) {
    this.goal = cell;
    this.pathKey = '';
  }

  private arrived() {
    const m = this.g.monster;
    return this.goal < 0 || this.g.level.cellAt(m.x, m.z) === this.goal;
  }

  /** Someone it can see: close by in any direction, or in front of it if they're lit. */
  private spot(): Wanderer | null {
    const g = this.g;
    const m = g.monster;
    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    let best: Wanderer | null = null, bestD = Infinity;
    for (const w of g.wanderers) {
      if (!w.active) continue;
      const dx = w.x - m.x, dz = w.z - m.z;
      const d = Math.hypot(dx, dz);
      const lit = g.isLit(w.cell) || w.flash;
      const range = d < 3 ? 3 : lit ? 20 : 4.5;
      if (d > range || d >= bestD) continue;
      if (d > 3.5 && (dx * fx + dz * fz) / d < 0.3) continue;
      if (!g.level.los(m.x, m.z, w.x, w.z)) continue;
      best = w;
      bestD = d;
    }
    return best;
  }

  /** The newest footstep or breath close enough to hear. */
  private listen(): Pulse | null {
    const m = this.g.monster;
    let best: Pulse | null = null;
    for (const p of this.g.pulses) {
      if (this.heard.has(p)) continue;
      this.heard.add(p);
      if (p.fear === 0) continue; // a door moving, not a person
      if (Math.hypot(p.x - m.x, p.z - m.z) < p.maxR * 3.6) best = p;
    }
    return best;
  }

  private roam() {
    const g = this.g;
    const L = g.level;
    this.setState('roam');
    const here = L.cellAt(g.monster.x, g.monster.z);
    // Hungry: it drifts toward wherever people are more often than not.
    const prey = g.wanderers.filter((w) => w.active);
    if (prey.length && g.rng.chance(0.35)) {
      this.goTo(this.nearbyCell(g.rng.pick(prey).cell, 3, 7));
    } else {
      this.goTo(this.nearbyCell(here, 4, 10));
    }
  }

  private recoil() {
    const g = this.g;
    const L = g.level;
    const m = g.monster;
    this.setState('recoil');
    const holder = g.wanderers.find((w) => g.inBeamOf(w, m.x, m.z));
    const here = L.cellAt(m.x, m.z);
    if (!holder) return this.goTo(this.nearbyCell(here, 3, 6));
    const fromLight = L.bfs([holder.cell]);
    const fromMe = L.bfs([here]);
    const opts: number[] = [];
    for (let c = 0; c < L.cells; c++) {
      if (fromMe[c] >= 2 && fromMe[c] <= 7 && fromLight[c] >= fromLight[here] + 3) opts.push(c);
    }
    this.goTo(opts.length ? g.rng.pick(opts) : this.nearbyCell(here, 3, 6));
    g.events.sound('roar', m.x, m.z, 0.6);
  }

  /** A random cell between lo and hi steps from c. */
  private nearbyCell(c: number, lo: number, hi: number): number {
    const g = this.g;
    const dist = g.level.bfs([c]);
    const opts: number[] = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] >= lo && dist[i] <= hi) opts.push(i);
    return opts.length ? g.rng.pick(opts) : c;
  }

  private followPath(goal: number, dt: number) {
    const g = this.g;
    const L = g.level;
    const m = g.monster;
    if (goal < 0) { m.moving = false; return; }
    const here = L.cellAt(m.x, m.z);
    const key = `${here}:${goal}:${L.version}`;
    if (key !== this.pathKey) {
      this.pathKey = key;
      this.path = L.path(here, goal) ?? [];
    }
    const next = this.path[0];
    if (next === undefined) {
      const p = L.center(goal);
      if (Math.hypot(p.x - m.x, p.z - m.z) > 0.3) this.step(p.x - m.x, p.z - m.z, dt);
      else m.moving = false;
      return;
    }
    const p = L.center(next);
    this.step(p.x - m.x, p.z - m.z, dt);
  }

  private step(vx: number, vz: number, dt: number) {
    const m = this.g.monster;
    // Turn toward where it's going rather than snapping.
    const want = Math.atan2(-vx, -vz);
    let d = want - m.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    m.yaw += Math.max(-6 * dt, Math.min(6 * dt, d));
    this.g.moveMonster(vx, vz, dt, SPEED[this.state]);
  }

  private useAbilities() {
    const g = this.g;
    const L = g.level;
    const m = g.monster;
    // Stalking someone in the light: kill it.
    if (this.blackoutT <= 0 && (this.state === 'listen' || this.state === 'search' || this.state === 'chase') && g.dread >= CFG.BLACKOUT_COST) {
      const near = g.wanderers.find((w) => w.active && g.isLit(w.cell) && Math.hypot(w.x - m.x, w.z - m.z) < 18);
      if (near && !g.tryBlackout(L.circuit[near.cell])) this.blackoutT = 35 + g.rng.range(0, 25);
      else this.blackoutT = 3;
    }
    // Rearrange the rooms around someone while they aren't looking.
    if (this.shiftT <= 0) {
      this.shiftT = 4;
      if (g.dread < CFG.SHIFT_COST + 10) return;
      const prey = g.wanderers.filter((w) => w.active);
      if (!prey.length) return;
      const near = L.bfs([g.rng.pick(prey).cell]);
      for (let i = 0; i < 12; i++) {
        const c = g.rng.int(L.cells);
        if (near[c] < 1 || near[c] > 4) continue;
        if (!g.tryShift(L.edgeOf(c, g.rng.int(4)))) {
          this.shiftT = 25 + g.rng.range(0, 25);
          break;
        }
      }
    }
  }
}
