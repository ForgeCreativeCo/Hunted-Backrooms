import { CFG, Kind } from './config';
import { Box, DX, DY, Door, Level, OPP } from './level';
import { RNG } from './rng';

export type WState = 'explore' | 'alert' | 'flee' | 'hide' | 'escape' | 'panic' | 'chalk' | 'confused';

export interface GameEvents {
  sound(
    kind: 'step' | 'scream' | 'blackout' | 'lightsOn' | 'shift' | 'chalk' | 'gasp' | 'catch' | 'roar' | 'escape' | 'breath'
      | 'door' | 'doorShut' | 'phone',
    x: number, z: number, loud: number, who?: Wanderer,
  ): void;
  caption(text: string, who: Wanderer | null): void;
  toast(text: string): void;
  /** A footstep or breath the monster can sense. */
  pulse?(p: Pulse, who: Wanderer): void;
}

export interface GameOptions {
  /** Names of human players. They take the first wanderer slots; AI fills the rest. */
  players?: string[];
}

export interface Pulse {
  x: number;
  z: number;
  maxR: number;
  age: number;
  life: number;
  fear: number;
}

export interface Chalk {
  dir: number;
  by: number;
}

const LINES = {
  enter: ['Where... where am I?', 'This is not my office.', 'Hello? Anyone?', 'I just leaned on a wall and...'],
  seen: ['What is THAT?', 'Oh god. Oh god.', 'Run. RUN.', 'Something is there!'],
  dark: ['The lights—!', 'No no no, not the lights.', 'I can\'t see anything.'],
  chalkGone: ['My arrow... it\'s gone.', 'I marked this. I KNOW I marked this.', 'Someone moved my arrow.'],
  confused: ['Wait. This wasn\'t here.', 'There was a hallway here.', 'The walls moved. Walls don\'t move.'],
  exit: ['An exit! There!', 'EXIT. Thank god.', 'I see a door!'],
  scream: ['Was that... a scream?', 'Somebody\'s hurt!', 'What happened to them?'],
  panic: ['AAAAH!', 'LET ME OUT!', 'I can\'t, I can\'t, I can\'t—'],
  hide: ['Quiet. Be quiet.', 'Don\'t breathe.', 'Please don\'t find me.'],
  silent: ['It\'s so quiet.', 'Why did the humming change?'],
};
const NAMES = ['Dana', 'Eli', 'Rook', 'Ines', 'Theo', 'Mara', 'Sol', 'Jun', 'Ash', 'Bea'];

export class Wanderer {
  x = 0;
  z = 0;
  cell = -1;
  next = -1;
  prev = -1;
  heading = 0;
  state: WState = 'explore';
  stateT = 0;
  stateDur = 0;
  fear = 5;
  stamina = 100;
  exhausted = false;
  entered = false;
  caught = false;
  escaped = false;
  /** Rough memory of how often each cell was visited; fades over time. */
  visits: Float32Array;
  /** Open-wall mask of each cell when last visited, -1 if never. */
  mem: Int8Array;
  /** Chalk the wanderer drew, by cell. Used to notice tampering. */
  drawn = new Map<number, number>();
  pendingNext = -1;
  path: number[] = [];
  pathVersion = -1;
  exitTarget = -1;
  sees = false;
  seenT = -99;
  lastHeardT = -99;
  heardX = 0;
  heardZ = 0;
  stepT = 0;
  breathT = 0;
  breathSndT = 0;
  /** Which recorded voice this wanderer screams with. */
  voice = 0;
  jx = 0;
  jz = 0;
  walkPhase = 0;
  lastSpeed = 0;
  // Human players: position and look come from their client.
  player = false;
  pitch = 0;
  moving = false;
  sprint = false;
  crouch = false;
  flash = false;
  battery = 100;

  constructor(public id: number, public kind: Kind, public name: string, public enterAt: number, cells: number) {
    this.visits = new Float32Array(cells);
    this.mem = new Int8Array(cells).fill(-1);
  }

  get active() { return this.entered && !this.caught && !this.escaped; }
  get label() { return `${this.name} (${this.kind === 'mapper' ? 'Mapper' : 'Panicker'})`; }
}

export class Monster {
  x = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  seepT = 0;
  seepCD = 0;
  seen = false;
  moving = false;
}

export interface NightResult {
  score: number;
  quota: number;
  stars: number;
  caught: number;
  escaped: number;
  reason: 'dawn' | 'empty';
}

export class Game {
  level: Level;
  rng: RNG;
  t = 0;
  dread = CFG.DREAD_START;
  score = 0;
  monster = new Monster();
  wanderers: Wanderer[] = [];
  chalk = new Map<number, Chalk>();
  blackout: Float32Array;
  pulses: Pulse[] = [];
  result: NightResult | null = null;
  private distMonster: Int32Array = new Int32Array(0);
  private distKey = '';
  private decayT = 0;
  private phoneT = 0;
  private solidScratch: Box[] = [];

  constructor(public seed: string, public events: GameEvents, opts: GameOptions = {}) {
    this.level = new Level(seed);
    this.rng = new RNG(seed + ':night');
    this.blackout = new Float32Array(this.level.circuitCount);
    this.phoneT = this.rng.range(45, 90);
    const m = this.level.center(this.level.monsterCell);
    this.monster.x = m.x;
    this.monster.z = m.z;
    // Face the wanderers' spawn.
    const s = this.level.center(this.level.spawnCell);
    this.monster.yaw = Math.atan2(-(s.x - m.x), -(s.z - m.z));

    // Players take the first slots and enter at dusk; AI wanderers fill the rest
    // (always at least three prey) and drift in over the first minute.
    const players = opts.players ?? [];
    const aiKinds: Kind[] = ['panicker', 'mapper', 'panicker', 'mapper'];
    const names = this.rng.shuffle([...NAMES]).filter((n) => !players.includes(n));
    const total = Math.max(3, players.length);
    let ai = 0;
    for (let i = 0; i < total; i++) {
      const isPlayer = i < players.length;
      const kind: Kind = isPlayer ? (i % 2 ? 'mapper' : 'panicker') : aiKinds[ai % aiKinds.length];
      const name = isPlayer ? players[i] : names[ai];
      const w = new Wanderer(i, kind, name, isPlayer ? 0 : CFG.WANDERER_ENTRY[i] ?? i * 25, this.level.cells);
      w.voice = this.rng.int(2);
      w.player = isPlayer;
      if (!isPlayer) ai++;
      this.wanderers.push(w);
    }
  }

  get over() { return this.result !== null; }
  get timeLeft() { return Math.max(0, CFG.NIGHT_SECONDS - this.t); }

  isLit(cell: number) { return this.blackout[this.level.circuit[cell]] <= 0; }

  fearMult(w: Wanderer) { return w.player ? 1 : CFG.FEAR_MULT[w.kind]; }

  addFear(w: Wanderer, amount: number) {
    if (amount > 0) amount *= this.fearMult(w);
    w.fear = Math.max(0, Math.min(100, w.fear + amount));
  }

  private say(w: Wanderer, lines: string[]) {
    if (w.player) return; // real people speak for themselves
    this.events.caption(this.rng.pick(lines), w);
  }

  // ---- Main update ----

  update(dt: number) {
    if (this.over) return;
    this.t += dt;
    const L = this.level;

    // Lights coming back on.
    for (let i = 0; i < this.blackout.length; i++) {
      if (this.blackout[i] > 0) {
        this.blackout[i] -= dt;
        if (this.blackout[i] <= 0) {
          this.blackout[i] = 0;
          const c = L.circuitCenter[i];
          this.events.sound('lightsOn', c.x, c.z, 1);
        }
      }
    }

    // Monster bookkeeping.
    const m = this.monster;
    if (m.seepT > 0) {
      m.seepT -= dt;
      if (m.seepT <= 0) { m.seepT = 0; m.seepCD = CFG.SEEP_COOLDOWN; }
    } else if (m.seepCD > 0) m.seepCD = Math.max(0, m.seepCD - dt);

    const mcell = L.cellAt(m.x, m.z);
    const key = `${mcell}:${L.version}`;
    if (key !== this.distKey) { this.distMonster = L.bfs([mcell]); this.distKey = key; }

    // Memories fade.
    this.decayT += dt;
    if (this.decayT > 5) {
      this.decayT = 0;
      for (const w of this.wanderers) {
        const k = w.kind === 'panicker' ? 0.75 : 0.93;
        for (let i = 0; i < w.visits.length; i++) w.visits[i] *= k;
      }
    }

    m.seen = false;
    let totalFear = 0;
    for (const w of this.wanderers) {
      if (!w.entered && this.t >= w.enterAt) this.enter(w);
      if (!w.active) continue;
      if (w.player) this.updatePlayer(w, dt);
      else this.updateWanderer(w, dt);
      if (w.sees) m.seen = true;
      totalFear += w.fear;
    }
    if ((m.seen || this.inAnyBeam(m.x, m.z)) && m.seepT > 0) {
      m.seepT = 0;
      m.seepCD = CFG.SEEP_COOLDOWN;
      this.events.toast('Seen — the wall rejects you');
    }

    this.dread = Math.min(CFG.DREAD_MAX, this.dread + (CFG.DREAD_BASE + totalFear * CFG.DREAD_PER_FEAR) * dt);
    this.updateDoors(dt);
    this.updatePhone(dt);

    for (const p of this.pulses) p.age += dt;
    this.pulses = this.pulses.filter((p) => p.age < p.life);

    // End of night.
    const allIn = this.wanderers.every((w) => w.entered);
    const anyLeft = this.wanderers.some((w) => w.active);
    if (this.t >= CFG.NIGHT_SECONDS || (allIn && !anyLeft)) {
      const stars = CFG.STARS.filter((s) => this.score >= s).length;
      this.result = {
        score: this.score,
        quota: CFG.QUOTA,
        stars,
        caught: this.wanderers.filter((w) => w.caught).length,
        escaped: this.wanderers.filter((w) => w.escaped).length,
        reason: this.t >= CFG.NIGHT_SECONDS ? 'dawn' : 'empty',
      };
    }
  }

  private enter(w: Wanderer) {
    const L = this.level;
    const near = L.bfs([L.spawnCell]);
    const options: number[] = [];
    for (let c = 0; c < L.cells; c++) if (near[c] >= 0 && near[c] <= 2) options.push(c);
    w.cell = this.rng.pick(options);
    const p = L.center(w.cell);
    w.x = p.x;
    w.z = p.z;
    w.heading = this.rng.range(-Math.PI, Math.PI);
    w.entered = true;
    w.mem[w.cell] = L.mask(w.cell);
    w.visits[w.cell] = 1;
    if (w.player) return;
    this.setState(w, 'alert', 2.5);
    this.say(w, LINES.enter);
  }

  private setState(w: Wanderer, s: WState, dur = 0) {
    w.state = s;
    w.stateT = 0;
    w.stateDur = dur;
  }

  // ---- Perception ----

  canSeePoint(w: Wanderer, px: number, pz: number, litTarget: boolean, coneCos = 0.26): boolean {
    const dx = px - w.x, dz = pz - w.z;
    const d = Math.hypot(dx, dz);
    const range = (litTarget ? CFG.VIEW_LIT : CFG.VIEW_DARK) * this.level.CS;
    if (d > range) return false;
    if (d > 1.0) {
      const facing = (dx * Math.cos(w.heading) + dz * Math.sin(w.heading)) / d;
      if (facing < coneCos) return false;
    }
    return this.level.los(w.x, w.z, px, pz);
  }

  private seesMonster(w: Wanderer) {
    const m = this.monster;
    if (w.state === 'panic' && !w.player) return Math.hypot(m.x - w.x, m.z - w.z) < 2;
    const lit = this.isLit(this.level.cellAt(m.x, m.z)) || this.inBeamOf(w, m.x, m.z);
    return this.canSeePoint(w, m.x, m.z, lit);
  }

  // ---- Flashlights ----

  /** Is this point inside the wanderer's flashlight beam? */
  inBeamOf(w: Wanderer, px: number, pz: number): boolean {
    if (!w.flash || !w.active) return false;
    const dx = px - w.x, dz = pz - w.z;
    const d = Math.hypot(dx, dz);
    if (d > CFG.BEAM_RANGE) return false;
    if (d > 0.5 && (dx * Math.cos(w.heading) + dz * Math.sin(w.heading)) / d < CFG.BEAM_COS) return false;
    return this.level.los(w.x, w.z, px, pz);
  }

  inAnyBeam(px: number, pz: number): boolean {
    return this.wanderers.some((w) => w.flash && this.inBeamOf(w, px, pz));
  }

  /** Is anyone looking at this edge? The space only changes when nobody watches. */
  edgeWatched(key: number): Wanderer | null {
    const L = this.level;
    const seg = L.edgeSegment(key);
    const mx = (seg.x1 + seg.x2) / 2, mz = (seg.z1 + seg.z2) / 2;
    const nx = seg.horizontal ? 0 : 0.4, nz = seg.horizontal ? 0.4 : 0;
    const [a, b] = L.edgeCells(key);
    for (const w of this.wanderers) {
      if (!w.active) continue;
      // Anyone standing in or crossing into the edge's cells notices.
      if (w.cell === a || w.cell === b || w.next === a || w.next === b) return w;
      for (const s of [-1, 1]) {
        const px = mx + nx * s, pz = mz + nz * s;
        const lit = this.isLit(L.cellAt(px, pz));
        if (this.canSeePoint(w, px, pz, lit, 0.1)) return w;
      }
    }
    return null;
  }

  monsterWatched() {
    return this.wanderers.some((w) => w.active && this.seesMonster(w));
  }

  // ---- Human players ----

  /**
   * Players move on their own clients; here they get the same fear, stamina and
   * noise rules as AI wanderers, plus a flashlight battery.
   */
  private updatePlayer(w: Wanderer, dt: number) {
    const L = this.level;
    const m = this.monster;
    w.cell = L.cellAt(w.x, w.z);

    if (L.exitCells.has(w.cell)) {
      w.escaped = true;
      w.flash = false;
      this.events.sound('escape', w.x, w.z, 1);
      this.events.toast(`${w.name} found an exit and escaped`);
      return;
    }

    const saw = w.sees;
    w.sees = this.seesMonster(w);
    const dm = Math.hypot(m.x - w.x, m.z - w.z);
    if (w.sees) {
      if (!saw && this.t - w.seenT > 4) {
        this.addFear(w, dm < 2 * L.CS ? 30 : 15);
        if (dm < 2 * L.CS) {
          this.events.sound('scream', w.x, w.z, 1, w);
          this.events.sound('roar', m.x, m.z, 1);
        }
      }
      this.addFear(w, (dm < 2 * L.CS ? 22 : 9) * dt);
      w.seenT = this.t;
    }
    const lit = this.isLit(w.cell);
    if (!lit && !w.flash) this.addFear(w, 1.5 * dt);
    else if (lit && this.t - w.seenT > 6) w.fear = Math.max(0, w.fear - 0.7 * dt);

    const sprinting = w.sprint && w.moving && !w.exhausted && !w.crouch;
    if (sprinting) w.stamina -= CFG.STAMINA_DRAIN * dt;
    else w.stamina = Math.min(100, w.stamina + CFG.STAMINA_REGEN * dt * (w.moving ? 1 : 1.5));
    if (w.stamina <= 0) { w.stamina = 0; w.exhausted = true; }
    if (w.exhausted && w.stamina >= 40) w.exhausted = false;

    if (w.flash) {
      w.battery = Math.max(0, w.battery - CFG.BATTERY_DRAIN * dt);
      if (w.battery <= 0) w.flash = false;
    }

    // Noise. Crouch-walking is nearly silent; crouching still in the dark, with
    // the light off, they're holding their breath.
    if (w.moving) {
      w.stepT -= dt;
      if (w.stepT <= 0) {
        w.stepT = sprinting ? 0.3 : w.crouch ? 0.8 : 0.55;
        const loud = (sprinting ? 2.2 : w.crouch ? 0.4 : 1) * (1 + w.fear / 150);
        this.emitNoise(w, loud, !w.crouch);
      }
    } else {
      w.breathT -= dt;
      if (w.breathT <= 0) {
        w.breathT = w.fear > 60 ? 1.2 : 2.2;
        if (!(w.crouch && !lit && !w.flash)) this.emitNoise(w, w.crouch ? 0.35 : 0.55, false);
      }
    }
    w.breathSndT -= dt;
    const winded = w.exhausted || (!w.moving && w.fear > 45);
    if (winded && w.breathSndT <= 0 && !(w.crouch && !lit && !w.flash)) {
      w.breathSndT = 3.5;
      this.events.sound('breath', w.x, w.z, w.exhausted ? 1 : 0.7, w);
    }

    // Drives their body's pose for everyone else.
    w.state = w.crouch ? 'hide' : sprinting && this.t - w.seenT < 4 ? 'flee' : 'explore';
  }

  /**
   * Move a player-controlled wanderer, with collision. Runs on their client and is
   * checked by the server. Returns how far their view turned if they went through a portal.
   */
  moveHuman(w: Wanderer, vx: number, vz: number, dt: number): number {
    const L = this.level;
    const len = Math.hypot(vx, vz);
    w.moving = len > 0.01;
    if (!w.moving || !w.active) return 0;
    const sprinting = w.sprint && !w.exhausted && !w.crouch;
    const speed = w.crouch ? CFG.HUMAN_CROUCH : w.exhausted ? CFG.EXHAUSTED : sprinting ? CFG.SPRINT : CFG.HUMAN_WALK;
    w.x += (vx / len) * speed * dt;
    w.z += (vz / len) * speed * dt;
    const r = CFG.HUMAN_RADIUS;
    w.x = Math.max(r, Math.min(L.W * L.CS - r, w.x));
    w.z = Math.max(r, Math.min(L.H * L.CS - r, w.z));
    const turn = this.pushDoors(w, r, vx, vz, true);
    if (turn !== null) {
      w.heading += turn;
      this.addFear(w, 10);
    }
    this.collideBody(w, r);
    return turn ?? 0;
  }

  toggleFlash(w: Wanderer): string | null {
    if (!w.flash && w.battery <= 0) return 'The battery is dead';
    w.flash = !w.flash;
    return null;
  }

  /** Draw an arrow on the floor here, pointing the open way closest to where they face. */
  drawChalk(w: Wanderer): string | null {
    const L = this.level;
    const c = L.cellAt(w.x, w.z);
    const dirs = L.openDirs(c);
    if (!dirs.length) return 'Nowhere to point';
    const fx = Math.cos(w.heading), fz = Math.sin(w.heading);
    let dir = dirs[0], best = -Infinity;
    for (const d of dirs) {
      const dot = DX[d] * fx + DY[d] * fz;
      if (dot > best) { best = dot; dir = d; }
    }
    this.chalk.set(c, { dir, by: w.id });
    this.events.sound('chalk', w.x, w.z, 0.5);
    return null;
  }

  /** A player left mid-night: an AI takes over their body. */
  releasePlayer(w: Wanderer) {
    w.player = false;
    w.flash = false;
    w.crouch = false;
    w.cell = this.level.cellAt(w.x, w.z);
    w.next = -1;
    w.state = 'explore';
  }

  // ---- Wanderer brain ----

  private updateWanderer(w: Wanderer, dt: number) {
    const L = this.level;
    const m = this.monster;
    w.stateT += dt;

    // Sight of the monster.
    const saw = w.sees;
    w.sees = this.seesMonster(w);
    const dm = Math.hypot(m.x - w.x, m.z - w.z);
    if (w.sees) {
      if (!saw && this.t - w.seenT > 4) {
        this.addFear(w, dm < 2 * L.CS ? 30 : 15);
        this.say(w, LINES.seen);
        if (dm < 2 * L.CS) {
          // Face to face: they scream, and you answer.
          this.events.sound('scream', w.x, w.z, 1, w);
          this.events.sound('roar', m.x, m.z, 1);
        } else {
          this.events.sound('gasp', w.x, w.z, 1);
        }
      }
      this.addFear(w, (dm < 2 * L.CS ? 22 : 9) * dt);
      w.seenT = this.t;
      const busy = w.state === 'flee' || w.state === 'panic';
      const escapingFar = w.state === 'escape' && dm > 3 * L.CS;
      if (!busy && !escapingFar) {
        this.setState(w, 'flee');
        w.next = -1;
        w.path = [];
      }
    } else if (dm < CFG.NOTICE_RANGE && w.state !== 'panic' && L.los(w.x, w.z, m.x, m.z) && this.rng.chance(0.8 * dt)) {
      // Something right behind them: they turn around.
      w.heading = Math.atan2(m.z - w.z, m.x - w.x);
      this.addFear(w, 6);
    }

    // The dark and the quiet wear on them; calm returns slowly in the light.
    const lit = this.isLit(w.cell);
    if (!lit) this.addFear(w, 1.5 * dt);
    else if (this.t - w.seenT > 6 && (w.state === 'explore' || w.state === 'escape')) {
      w.fear = Math.max(0, w.fear - 0.7 * dt);
    }

    if (w.fear >= 100 && w.state !== 'panic') {
      this.setState(w, 'panic');
      this.say(w, LINES.panic);
      this.events.sound('scream', w.x, w.z, 0.6, w);
    }

    // State timers.
    switch (w.state) {
      case 'alert':
      case 'confused':
        if (w.stateT >= w.stateDur) {
          if (w.kind === 'panicker' && w.fear > 40 && w.state === 'alert') this.setState(w, 'flee');
          else this.setState(w, w.exitTarget >= 0 ? 'escape' : 'explore');
        }
        break;
      case 'chalk':
        if (w.stateT >= w.stateDur) {
          this.setState(w, 'explore');
          w.next = w.pendingNext;
          w.pendingNext = -1;
        }
        break;
      case 'hide':
        if (dm < 1.3 * L.CS && L.los(w.x, w.z, m.x, m.z) && w.stateT > 0.5) {
          this.addFear(w, 20);
          this.setState(w, 'flee');
        } else if (w.stateT >= w.stateDur) {
          this.setState(w, w.exitTarget >= 0 ? 'escape' : 'explore');
        }
        break;
      case 'flee':
        if (this.t - w.seenT > 6 && w.stateT > 3) this.setState(w, w.exitTarget >= 0 ? 'escape' : 'explore');
        break;
    }

    // Stamina.
    const sprinting = !w.exhausted && (w.state === 'flee' || w.state === 'panic' || (w.state === 'escape' && w.stamina > 30));
    const standing = w.state === 'alert' || w.state === 'confused' || w.state === 'chalk' || w.state === 'hide';
    if (sprinting && !standing) w.stamina -= CFG.STAMINA_DRAIN * dt;
    else w.stamina = Math.min(100, w.stamina + CFG.STAMINA_REGEN * dt * (standing ? 1.5 : 1));
    if (w.stamina <= 0) {
      w.stamina = 0;
      w.exhausted = true;
      if (w.state === 'panic') {
        w.fear = 80;
        this.setState(w, 'hide', 7);
        this.say(w, LINES.hide);
      } else if (w.state === 'flee' && w.fear > 45) {
        this.setState(w, 'hide', this.rng.range(6, 10));
        this.say(w, LINES.hide);
      }
    }
    if (w.exhausted && w.stamina >= 40) w.exhausted = false;

    // Movement.
    let speed = 0;
    if (!standing) {
      if (w.next < 0) {
        w.next = this.decide(w);
        if (w.next >= 0) {
          const door = L.doorOnEdge.get(L.edgeOf(w.cell, L.dirBetween(w.cell, w.next)));
          if (door && door.kind === 'swing' && door.open === 0) {
            this.openDoor(door, L.cellAt(w.x, w.z) === door.cell ? -1 : 1);
          }
        }
      }
      if (w.next >= 0) {
        speed = w.exhausted ? CFG.EXHAUSTED : sprinting ? CFG.SPRINT : CFG.WALK[w.kind] + w.fear * 0.006;
        const p = L.center(w.next);
        const tx = p.x + w.jx, tz = p.z + w.jz;
        const dx = tx - w.x, dz = tz - w.z;
        const d = Math.hypot(dx, dz);
        const step = speed * dt;
        const want = Math.atan2(dz, dx);
        w.heading = turnToward(w.heading, want, 8 * dt);
        if (d <= step) {
          w.x = tx;
          w.z = tz;
          this.arrive(w);
        } else {
          w.x += (dx / d) * step;
          w.z += (dz / d) * step;
        }
      }
    } else if (w.state === 'alert' || w.state === 'confused') {
      // Look around.
      w.heading += Math.sin(this.t * 1.7 + w.id) * dt * 1.2;
    }
    w.lastSpeed = speed;
    w.walkPhase += speed * dt * 2.4;

    // Noise: footsteps and breathing are what the monster senses.
    if (speed > 0) {
      w.stepT -= dt;
      if (w.stepT <= 0) {
        w.stepT = sprinting ? 0.3 : 0.55;
        let loud = (sprinting ? 2.2 : 1) * (w.kind === 'panicker' ? 1.4 : 1) * (1 + w.fear / 150);
        this.emitNoise(w, loud);
      }
    } else {
      w.breathT -= dt;
      if (w.breathT <= 0) {
        w.breathT = w.fear > 60 ? 1.2 : 2.2;
        const holdingBreath = w.state === 'hide' && !lit;
        if (!holdingBreath) this.emitNoise(w, w.state === 'hide' ? 0.35 : 0.55, false);
      }
    }

    // Scared or winded people breathe hard enough to hear up close. Hiding in
    // the dark, they hold it.
    w.breathSndT -= dt;
    const winded = w.exhausted || (standing && (w.fear > 45 || w.state === 'hide'));
    if (winded && w.breathSndT <= 0 && !(w.state === 'hide' && !lit)) {
      w.breathSndT = 3.5;
      this.events.sound('breath', w.x, w.z, w.exhausted ? 1 : 0.7, w);
    }

    // Exits come into view.
    if (w.exitTarget < 0 && Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) {
      for (const e of L.exits) {
        const p = L.center(e.cell);
        if (Math.hypot(p.x - w.x, p.z - w.z) > CFG.EXIT_VIEW * L.CS) continue;
        if (!L.los(w.x, w.z, p.x, p.z)) continue;
        w.exitTarget = e.cell;
        this.say(w, LINES.exit);
        if (w.state === 'explore' || w.state === 'alert') { this.setState(w, 'escape'); w.path = []; }
        break;
      }
    }
  }

  private emitNoise(w: Wanderer, loud: number, audible = true) {
    w.lastHeardT = this.t;
    w.heardX = w.x;
    w.heardZ = w.z;
    const p = { x: w.x, z: w.z, maxR: loud * 2.2, age: 0, life: 1.1, fear: w.fear };
    this.pulses.push(p);
    this.events.pulse?.(p, w);
    if (audible) this.events.sound('step', w.x, w.z, loud);
  }

  private arrive(w: Wanderer) {
    const L = this.level;
    w.prev = w.cell;
    w.cell = w.next;
    w.next = -1;
    w.jx = this.rng.range(-0.5, 0.5);
    w.jz = this.rng.range(-0.5, 0.5);
    w.visits[w.cell] += 1;

    if (L.exitCells.has(w.cell)) {
      w.escaped = true;
      this.events.sound('escape', w.x, w.z, 1);
      this.events.toast(`${w.name} found an exit and escaped`);
      this.events.caption('I\'m out. I\'m OUT.', w);
      return;
    }

    // The walls aren't where they remember them.
    const mask = L.mask(w.cell);
    if (w.mem[w.cell] >= 0 && w.mem[w.cell] !== mask && (w.state === 'explore' || w.state === 'escape')) {
      this.addFear(w, 12);
      this.say(w, LINES.confused);
      this.setState(w, 'confused', 1.8);
      w.path = [];
    }
    w.mem[w.cell] = mask;

    if (w.state !== 'explore' || w.kind !== 'mapper') return;
    const dirs = L.openDirs(w.cell);
    if (dirs.length < 3) return;

    // Mapper at a junction: check the chalk, then mark the way out.
    const mine = w.drawn.get(w.cell);
    const mark = this.chalk.get(w.cell);
    if (mine !== undefined && (!mark || mark.dir !== mine)) {
      if (this.rng.chance(0.7)) {
        this.addFear(w, 18);
        this.say(w, LINES.chalkGone);
        this.setState(w, 'confused', 2.2);
        w.drawn.delete(w.cell);
        return;
      }
      // Didn't notice; trusts whatever is there now.
      if (mark) w.drawn.set(w.cell, mark.dir);
      else w.drawn.delete(w.cell);
    }
    if (w.fear > 75) return; // too scared to stop and draw
    const next = this.chooseExplore(w);
    const dir = L.dirBetween(w.cell, next);
    if (dir < 0) return;
    this.chalk.set(w.cell, { dir, by: w.id });
    w.drawn.set(w.cell, dir);
    w.pendingNext = next;
    this.setState(w, 'chalk', 0.9);
    this.events.sound('chalk', w.x, w.z, 0.5);
  }

  private decide(w: Wanderer): number {
    const L = this.level;
    switch (w.state) {
      case 'flee': return this.chooseFlee(w);
      case 'panic': {
        const dirs = L.openDirs(w.cell);
        const opts = dirs.map((d) => L.neighbor(w.cell, d)).filter((n) => n !== w.prev);
        return this.rng.pick(opts.length ? opts : dirs.map((d) => L.neighbor(w.cell, d)));
      }
      case 'escape': {
        if (w.pathVersion !== L.version || !w.path.length) {
          w.path = L.path(w.cell, w.exitTarget) ?? [];
          w.pathVersion = L.version;
        }
        const n = w.path.shift();
        if (n !== undefined && L.dirBetween(w.cell, n) >= 0 && L.open(w.cell, L.dirBetween(w.cell, n))) return n;
        w.path = [];
        return this.chooseExplore(w);
      }
      default: return this.chooseExplore(w);
    }
  }

  private chooseExplore(w: Wanderer): number {
    const L = this.level;
    const dirs = L.openDirs(w.cell);
    if (!dirs.length) return -1;
    const mark = w.kind === 'mapper' ? this.chalk.get(w.cell) : undefined;
    const backDir = w.prev >= 0 ? L.dirBetween(w.cell, w.prev) : -1;
    const fwdDir = backDir >= 0 ? OPP[backDir] : -1;
    let best = -1, bestS = Infinity;
    for (const d of dirs) {
      const n = L.neighbor(w.cell, d);
      let s = w.visits[n] * 2 + this.rng.next() * 1.2;
      if (d === backDir && dirs.length > 1) s += 6;
      if (d === fwdDir) s -= 0.4;
      // Chalk says "I already went this way".
      if (mark && mark.dir === d) s += 4;
      if (s < bestS) { bestS = s; best = n; }
    }
    return best;
  }

  private chooseFlee(w: Wanderer): number {
    const L = this.level;
    const dirs = L.openDirs(w.cell);
    let best = -1, bestS = -Infinity;
    for (const d of dirs) {
      const n = L.neighbor(w.cell, d);
      let s = this.distMonster[n] + this.rng.next() * 0.6;
      if (n === w.prev) s -= 0.5;
      if (s > bestS) { bestS = s; best = n; }
    }
    // Cornered in a dead end: cower.
    if (best >= 0 && this.distMonster[best] < this.distMonster[w.cell] && this.distMonster[w.cell] <= 2) {
      this.setState(w, 'hide', 4);
      return -1;
    }
    return best;
  }

  // ---- Monster actions ----

  moveMonster(vx: number, vz: number, dt: number, pace = 1) {
    const m = this.monster;
    const L = this.level;
    const len = Math.hypot(vx, vz);
    m.moving = len > 0.01;
    if (!m.moving) return;
    const seeping = m.seepT > 0;
    // A flashlight beam slows the monster to half speed.
    const speed = (seeping ? CFG.SEEP_SPEED : CFG.MONSTER_SPEED) * pace * (this.inAnyBeam(m.x, m.z) ? 0.5 : 1);
    m.x += (vx / len) * speed * dt;
    m.z += (vz / len) * speed * dt;
    const r = CFG.MONSTER_RADIUS;
    m.x = Math.max(r, Math.min(L.W * L.CS - r, m.x));
    m.z = Math.max(r, Math.min(L.H * L.CS - r, m.z));
    if (seeping) return;
    const turn = this.pushDoors(m, r, vx, vz, true);
    if (turn !== null) m.yaw = rotateYaw(m.yaw, turn);
    this.collide();
  }

  /** Push the monster out of walls and pillars. */
  collide() {
    this.collideBody(this.monster, CFG.MONSTER_RADIUS);
  }

  collideBody(m: { x: number; z: number }, r: number) {
    const L = this.level;
    for (let iter = 0; iter < 2; iter++) {
      const c0 = L.cellAt(m.x, m.z);
      const cx = L.cx(c0), cy = L.cy(c0);
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (!L.inBounds(x, y)) continue;
          const c = L.cell(x, y);
          const boxes = this.solidScratch;
          boxes.length = 0;
          for (let d = 0; d < 4; d++) L.edgeSolids(L.edgeOf(c, d), boxes);
          for (const i of L.solidsInCell.get(c) ?? []) boxes.push(L.solids[i]);
          for (const b of boxes) pushOut(m, b.x0, b.z0, b.x1, b.z1, r);
        }
      }
      for (const p of L.pillars) {
        if (Math.abs(p.x - m.x) > 2 || Math.abs(p.z - m.z) > 2) continue;
        pushOut(m, p.x - 0.3, p.z - 0.3, p.x + 0.3, p.z + 0.3, r);
      }
    }
  }

  /** A flashlight on the monster blocks its abilities. */
  private beamBlocks(): string | null {
    return this.inAnyBeam(this.monster.x, this.monster.z) ? 'A light is on you' : null;
  }

  trySeep(): string | null {
    const m = this.monster;
    if (m.seepT > 0) return null;
    const beam = this.beamBlocks();
    if (beam) return beam;
    if (m.seepCD > 0) return `Seep recovering (${m.seepCD.toFixed(0)}s)`;
    if (this.monsterWatched()) return 'Someone is watching you';
    m.seepT = CFG.SEEP_DURATION;
    return null;
  }

  tryBlackout(circuit: number): string | null {
    if (circuit < 0) return 'No circuit there';
    if (this.blackout[circuit] > 0) return 'That circuit is already dark';
    const beam = this.beamBlocks();
    if (beam) return beam;
    if (this.dread < CFG.BLACKOUT_COST) return 'Not enough dread';
    this.dread -= CFG.BLACKOUT_COST;
    this.blackout[circuit] = CFG.BLACKOUT_TIME;
    const c = this.level.circuitCenter[circuit];
    this.events.sound('blackout', c.x, c.z, 1);
    for (const w of this.wanderers) {
      if (!w.active || this.level.circuit[w.cell] !== circuit) continue;
      this.addFear(w, 18);
      this.say(w, LINES.dark);
      if (w.state === 'explore' || w.state === 'escape' || w.state === 'chalk') {
        if (w.kind === 'panicker') { this.setState(w, 'flee'); w.next = -1; }
        else this.setState(w, 'alert', 1.5);
      }
    }
    return null;
  }

  shiftCheck(key: number): string | null {
    const L = this.level;
    if (key < 0) return 'No wall there';
    const beam = this.beamBlocks();
    if (beam) return beam;
    if (L.isBorder(key)) return 'The outer walls don\'t move';
    if (this.dread < CFG.SHIFT_COST) return 'Not enough dread';
    if (L.exits.some((e) => L.edgeOf(e.cell, e.dir) === key)) return 'Not the exit';
    if (L.doorOnEdge.has(key)) return 'Doors stay where they are';
    const w = this.edgeWatched(key);
    if (w) return `${w.name} is watching that wall`;
    if (L.isWall(key)) return null;
    // Closing: must not seal off any part of the level.
    L.walls[key] = 1;
    const ok = L.connected();
    L.walls[key] = 0;
    return ok ? null : 'That would seal off part of the level';
  }

  tryShift(key: number): string | null {
    const err = this.shiftCheck(key);
    if (err) return err;
    const L = this.level;
    this.dread -= CFG.SHIFT_COST;
    L.setWall(key, !L.isWall(key));
    const s = L.edgeSegment(key);
    this.events.sound('shift', (s.x1 + s.x2) / 2, (s.z1 + s.z2) / 2, 1);
    this.collide();
    return null;
  }

  /** Chalk mark within reach of the monster, if any. */
  chalkInReach(): number {
    const L = this.level;
    let best = -1, bestD = 2.6;
    for (const c of this.chalk.keys()) {
      const p = L.center(c);
      const d = Math.hypot(p.x - this.monster.x, p.z - this.monster.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  eraseChalk(): string | null {
    const c = this.chalkInReach();
    if (c < 0) return 'No chalk mark in reach';
    this.chalk.delete(c);
    return null;
  }

  /** Redraw the arrow to point another open way. */
  redrawChalk(): string | null {
    const c = this.chalkInReach();
    if (c < 0) return 'No chalk mark in reach';
    const mark = this.chalk.get(c)!;
    const dirs = this.level.openDirs(c);
    const i = dirs.indexOf(mark.dir);
    mark.dir = dirs[(i + 1) % dirs.length];
    return null;
  }

  // ---- Doors ----

  openDoor(d: Door, sign: number) {
    d.open = sign || 1;
    d.openT = 0;
    this.events.sound('door', d.mx, d.mz, 1);
    // The monster can feel a door move anywhere in its building.
    const p = { x: d.mx, z: d.mz, maxR: 1.6, age: 0, life: 1.1, fear: 0 };
    this.pulses.push(p);
  }

  /**
   * After a body moves by (vx, vz): push open any door it walks into. An open
   * portal it walks into carries it to the partner door; returns how far its
   * facing turned on the way, or null if it didn't go through.
   */
  pushDoors(b: { x: number; z: number }, r: number, vx: number, vz: number, allowPortal: boolean): number | null {
    const L = this.level;
    const c0 = L.cellAt(b.x, b.z);
    const cx = L.cx(c0), cy = L.cy(c0);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (!L.inBounds(x, y)) continue;
        for (let dir = 0; dir < 4; dir++) {
          const d = L.doorOnEdge.get(L.edgeOf(L.cell(x, y), dir));
          if (!d) continue;
          const px = b.x - d.mx, pz = b.z - d.mz;
          if (Math.abs(px * d.tx + pz * d.tz) > d.w / 2) continue;
          const dist = px * d.nx + pz * d.nz; // > 0 on the side it's seen from
          const into = -(vx * d.nx + vz * d.nz);
          if (d.kind === 'swing') {
            if (d.open !== 0 || Math.abs(dist) > r + 0.3 || into * Math.sign(dist || 1) <= 0) continue;
            this.openDoor(d, dist > 0 ? -1 : 1); // swings away from whoever pushed it
            continue;
          }
          if (dist < 0 || dist > r + 0.3 || into <= 0 || d.variant === 'high') continue;
          if (d.open === 0) {
            this.openDoor(d, 1);
          } else if (d.kind === 'portal' && allowPortal && dist < r + 0.14 && d.link >= 0) {
            const p = L.doors[d.link];
            const out = L.portalExit(p, r);
            b.x = out.x;
            b.z = out.z;
            if (p.open === 0) this.openDoor(p, 1);
            p.openT = 0;
            return Math.atan2(p.nz, p.nx) - Math.atan2(-d.nz, -d.nx);
          }
        }
      }
    }
    return null;
  }

  /** Is any wanderer looking at this door? */
  private doorWatched(d: Door) {
    const px = d.mx + d.nx * 0.3, pz = d.mz + d.nz * 0.3;
    return this.wanderers.some((w) => w.active && this.canSeePoint(w, px, pz, this.isLit(this.level.cellAt(px, pz)), 0.1));
  }

  private bodyNear(d: Door, r: number) {
    const near = (x: number, z: number) => Math.hypot(x - d.mx, z - d.mz) < r;
    return near(this.monster.x, this.monster.z) || this.wanderers.some((w) => w.active && near(w.x, w.z));
  }

  /** Doors close themselves when nobody is watching; fake doors sometimes open the same way. */
  private updateDoors(dt: number) {
    for (const d of this.level.doors) {
      if (d.open !== 0) {
        d.openT += dt;
        const limit = d.kind === 'portal' ? 7 : d.kind === 'fake' ? 14 : 28;
        if (d.openT > limit && !this.bodyNear(d, 2.2) && !this.doorWatched(d)) {
          d.open = 0;
          this.events.sound('doorShut', d.mx, d.mz, 1);
          for (const w of this.wanderers) {
            if (!w.active || Math.hypot(w.x - d.mx, w.z - d.mz) > 12) continue;
            this.addFear(w, 4);
          }
        }
      } else if (d.kind === 'fake' && this.rng.chance(0.0015 * dt) && !this.doorWatched(d) && !this.bodyNear(d, 4)) {
        this.openDoor(d, 1);
      }
    }
  }

  /** Every so often, an old phone somewhere starts ringing. */
  private updatePhone(dt: number) {
    this.phoneT -= dt;
    if (this.phoneT > 0) return;
    this.phoneT = this.rng.range(70, 150);
    const phones = this.level.props.filter((p) => p.type === 'phone');
    if (!phones.length) return;
    const p = this.rng.pick(phones);
    this.events.sound('phone', p.x, p.z, 1);
    for (const w of this.wanderers) {
      if (!w.active || Math.hypot(w.x - p.x, w.z - p.z) > 15) continue;
      this.addFear(w, 6);
      if (!w.player && (w.state === 'explore' || w.state === 'escape')) {
        w.heading = Math.atan2(p.z - w.z, p.x - w.x);
        this.setState(w, 'alert', 2);
      }
    }
  }

  /** Wanderer the monster could catch right now, given its facing. */
  catchable(fx: number, fz: number): Wanderer | null {
    const m = this.monster;
    let best: Wanderer | null = null, bestD = CFG.CATCH_REACH;
    for (const w of this.wanderers) {
      if (!w.active) continue;
      const dx = w.x - m.x, dz = w.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if (d > 0.6 && (dx * fx + dz * fz) / d < 0.55) continue;
      if (!this.level.los(m.x, m.z, w.x, w.z)) continue;
      best = w;
      bestD = d;
    }
    return best;
  }

  catch(w: Wanderer): number {
    const pts = Math.max(5, Math.round(w.fear));
    this.score += pts;
    w.caught = true;
    w.flash = false;
    this.events.sound('catch', w.x, w.z, 1);
    this.events.sound('scream', w.x, w.z, 1, w);
    this.events.toast(`${w.name} caught · +${pts} fear`);
    // Everyone nearby hears the scream.
    const r = 12 * this.level.CS;
    for (const o of this.wanderers) {
      if (!o.active) continue;
      const d = Math.hypot(o.x - w.x, o.z - w.z);
      if (d > r) continue;
      this.addFear(o, 10 + 25 * (1 - d / r));
      this.say(o, LINES.scream);
      o.heading = Math.atan2(w.z - o.z, w.x - o.x);
      if (o.state === 'explore' || o.state === 'escape' || o.state === 'chalk') {
        if (o.kind === 'panicker') { this.setState(o, 'flee'); o.next = -1; }
        else this.setState(o, 'alert', 2);
      }
    }
    return pts;
  }
}

/** Turn a camera yaw (forward = (-sin, -cos)) by an angle in the heading convention (atan2(z, x)). */
export function rotateYaw(yaw: number, turn: number) {
  const h = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) + turn;
  return Math.atan2(-Math.cos(h), -Math.sin(h));
}

function turnToward(a: number, b: number, maxStep: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

function pushOut(m: { x: number; z: number }, x0: number, z0: number, x1: number, z1: number, r: number) {
  const nx = Math.max(x0, Math.min(m.x, x1));
  const nz = Math.max(z0, Math.min(m.z, z1));
  const dx = m.x - nx, dz = m.z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    m.x = nx + (dx / d) * r;
    m.z = nz + (dz / d) * r;
  } else {
    // Centre inside the box: push out along the shallowest axis.
    const left = m.x - x0, right = x1 - m.x, top = m.z - z0, bottom = z1 - m.z;
    const min = Math.min(left, right, top, bottom);
    if (min === left) m.x = x0 - r;
    else if (min === right) m.x = x1 + r;
    else if (min === top) m.z = z0 - r;
    else m.z = z1 + r;
  }
}

