import { CFG } from './config';
import { RNG } from './rng';
import { LEVEL0, type LevelDef } from './levels';

// Directions: 0 = north (-z), 1 = east (+x), 2 = south (+z), 3 = west (-x).
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const OPP = [2, 3, 0, 1];

export interface Exit {
  cell: number;
  dir: number; // which border side the door is on
}

export type DoorKind = 'swing' | 'fake' | 'portal';
export type FakeVariant = 'brick' | 'void' | 'double' | 'high' | 'tiny';

/**
 * A door. Swing doors sit in doorways on open edges and block until pushed open.
 * Fake doors and portals hang on walls: fake ones open onto nothing, portals
 * open onto their partner somewhere else in the level.
 */
export interface Door {
  id: number;
  kind: DoorKind;
  key: number;
  /** The cell it's seen from (a swing door can be pushed from either side). */
  cell: number;
  /** Unit normal pointing into `cell`, the edge midpoint, and the unit tangent along the edge. */
  nx: number;
  nz: number;
  mx: number;
  mz: number;
  tx: number;
  tz: number;
  w: number;
  h: number;
  y0: number;
  variant: FakeVariant | null;
  /** A freestanding door in an open room: no wall around it. */
  free: boolean;
  /** Portal partner's id, or -1. */
  link: number;
  /** 0 closed; 1 or -1 open, swung towards +n or -n. */
  open: number;
  openT: number;
  /** If set, the only way it ever swings (1 or -1); 0 swings away from whoever pushes it. */
  swing: number;
}

export type PropType = 'chair' | 'desk' | 'cabinet' | 'crt' | 'mattress' | 'lamp' | 'phone' | 'mannequin' | 'stairs' | 'paper' | 'speaker' | 'house' | 'fence' | 'mailbox' | 'fan' | 'stop'
  | 'crate' | 'pallet' | 'boxes';

/** What a supply crate holds. */
export type SupplyKind = 'battery' | 'chalk' | 'water';

/** A supply crate against a wall, and what's sitting in it (until someone takes it). */
export interface Supply {
  id: number;
  kind: SupplyKind;
  /** The crate's centre, and the cell it's in. */
  x: number;
  z: number;
  cell: number;
  /** Which way the crate faces (its open side, into the room). */
  ry: number;
}

/** A puddle on the floor: a circle that splashes underfoot. */
export interface Puddle {
  x: number;
  z: number;
  r: number;
}

/** A piece of furniture or debris. Front is local +z; `ceil` props hang upside down from the ceiling. */
export interface Prop {
  type: PropType;
  x: number;
  z: number;
  y: number;
  ry: number;
  rx: number;
  rz: number;
  ceil: boolean;
  cell: number;
  /** Variant flags per type (e.g. a desk with a monitor). */
  v: number;
}

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * What a stretch of Level 0 is like. Most of it is bare: the same wallpaper,
 * carpet and lights for ever. Furniture gathers in a few pockets; one region
 * has no power at all; one has holes in its darker carpet; one room is red;
 * and one stretch gives way to the Poolrooms: white tile, ankle-deep water,
 * and light that comes from nowhere. Somewhere there is a street: a row of
 * houses on either side of a road, built indoors under the office ceiling.
 */
export enum Zone { Bare, Furnished, Dark, Pitfalls, Manila, Pool, Street }

/** The Street's hall, in world units: the road runs along x when `alongX`, else along z. */
export interface Street {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  alongX: boolean;
}

/** The floor shader cuts this many holes at most. */
export const MAX_PITS = 48;
/** The floor shader draws this many puddles at most. */
export const MAX_PUDDLES = 32;

/**
 * The level is a grid of cells. Walls are edges between cells, stored as one
 * flat key space: horizontal edges first (north side of each cell, plus the
 * south border), then vertical edges (west side of each cell, plus the east border).
 */
export class Level {
  readonly W = CFG.W;
  readonly H = CFG.H;
  readonly CS = CFG.CS;
  readonly HC = CFG.W * (CFG.H + 1);
  readonly edgeCount = CFG.W * (CFG.H + 1) + (CFG.W + 1) * CFG.H;
  readonly cells = CFG.W * CFG.H;

  walls: Uint8Array;
  circuit: Int16Array;
  circuitCount = 0;
  circuitCells: number[][] = [];
  circuitCenter: { x: number; z: number }[] = [];
  panel: Uint8Array;
  zone: Uint8Array;
  /** Circuits that never had power: their lights are dead all night. */
  dead: Uint8Array = new Uint8Array(0);
  /** Holes in the floor of the Pitfalls: `hole` is what's drawn, `solid` what stops a body (a little inside it, so you can stand at the lip). */
  pits: { hole: Box; solid: Box }[] = [];
  /** Puddles on the floor (Level 1's leaks). */
  puddles: Puddle[] = [];
  /** Supply crates (Level 1). */
  supplies: Supply[] = [];
  /** The Street's hall, or null if no place for it fit. */
  street: Street | null = null;
  /** The Street's hall in cells. */
  private streetCells: { x: number; y: number; w: number; h: number } | null = null;
  /**
   * The house you can walk through: its side (d), the first of its two wall
   * edges along that side (i), which of them its back door is on (j), that
   * edge's key, and the maze cell the back door opens into.
   */
  streetBack: { d: number; i: number; j: number; key: number; outer: number } | null = null;
  exits: Exit[] = [];
  exitCells = new Set<number>();
  spawnCell = 0;
  monsterCell = 0;
  pillars: { x: number; z: number }[] = [];
  /** Ceiling height per cell: some rooms are cramped, some go up and up. */
  ceil: Float32Array;
  doors: Door[] = [];
  doorOnEdge = new Map<number, Door>();
  props: Prop[] = [];
  /** Where the PA music plays from: over the middle of the map, at ceiling height. */
  pa = { x: 0, z: 0, y: 2.3 };
  /** Furniture collision boxes, and which cells each one touches. */
  solids: Box[] = [];
  solidsInCell = new Map<number, number[]>();
  /** Cells with a door on one of their edges (kept clear of crates and puddles). */
  private doorCells = new Uint8Array(0);
  /** Bumped whenever a wall changes, so cached paths know to re-plan. */
  version = 0;

  /** Built from its seed, to the description of the level it is (Level 0 unless told otherwise). */
  constructor(readonly seed: string, readonly def: LevelDef = LEVEL0) {
    this.walls = new Uint8Array(this.edgeCount).fill(1);
    this.circuit = new Int16Array(this.cells);
    this.panel = new Uint8Array(this.cells);
    this.ceil = new Float32Array(this.cells).fill(CFG.WALL_H);
    this.zone = new Uint8Array(this.cells);
    this.generate(new RNG(seed), new RNG(seed + ':zones'));
    this.furnish(new RNG(seed + ':furnish'));
    this.placeSupplies(new RNG(seed + ':supplies'));
    this.placePuddles(new RNG(seed + ':puddles'));
  }

  // ---- Cells and edges ----

  cx(c: number) { return c % this.W; }
  cy(c: number) { return (c / this.W) | 0; }
  cell(x: number, y: number) { return y * this.W + x; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  cellAt(wx: number, wz: number): number {
    const x = Math.min(this.W - 1, Math.max(0, Math.floor(wx / this.CS)));
    const y = Math.min(this.H - 1, Math.max(0, Math.floor(wz / this.CS)));
    return this.cell(x, y);
  }

  center(c: number) {
    return { x: (this.cx(c) + 0.5) * this.CS, z: (this.cy(c) + 0.5) * this.CS };
  }

  edgeOf(c: number, dir: number): number {
    const x = this.cx(c), y = this.cy(c);
    switch (dir) {
      case 0: return y * this.W + x;
      case 2: return (y + 1) * this.W + x;
      case 3: return this.HC + y * (this.W + 1) + x;
      default: return this.HC + y * (this.W + 1) + x + 1;
    }
  }

  /** The two cells either side of an edge; -1 for outside the level. */
  edgeCells(key: number): [number, number] {
    if (key < this.HC) {
      const x = key % this.W, y = (key / this.W) | 0;
      return [y > 0 ? this.cell(x, y - 1) : -1, y < this.H ? this.cell(x, y) : -1];
    }
    const i = key - this.HC;
    const x = i % (this.W + 1), y = (i / (this.W + 1)) | 0;
    return [x > 0 ? this.cell(x - 1, y) : -1, x < this.W ? this.cell(x, y) : -1];
  }

  isBorder(key: number) {
    const [a, b] = this.edgeCells(key);
    return a < 0 || b < 0;
  }

  /** World-space segment of an edge, as x1,z1 → x2,z2. */
  edgeSegment(key: number) {
    const CS = this.CS;
    if (key < this.HC) {
      const x = key % this.W, y = (key / this.W) | 0;
      return { x1: x * CS, z1: y * CS, x2: (x + 1) * CS, z2: y * CS, horizontal: true };
    }
    const i = key - this.HC;
    const x = i % (this.W + 1), y = (i / (this.W + 1)) | 0;
    return { x1: x * CS, z1: y * CS, x2: x * CS, z2: (y + 1) * CS, horizontal: false };
  }

  isWall(key: number) { return this.walls[key] === 1; }

  /** Is this spot in water: the Poolrooms, or a puddle? */
  wet(wx: number, wz: number) {
    if (this.zone[this.cellAt(wx, wz)] === Zone.Pool) return true;
    for (const p of this.puddles) if ((wx - p.x) ** 2 + (wz - p.z) ** 2 < p.r * p.r) return true;
    return false;
  }

  open(c: number, dir: number) { return this.walls[this.edgeOf(c, dir)] === 0; }

  neighbor(c: number, dir: number): number {
    const x = this.cx(c) + DX[dir], y = this.cy(c) + DY[dir];
    return this.inBounds(x, y) ? this.cell(x, y) : -1;
  }

  openDirs(c: number): number[] {
    const out: number[] = [];
    for (let d = 0; d < 4; d++) if (this.open(c, d)) out.push(d);
    return out;
  }

  mask(c: number): number {
    let m = 0;
    for (let d = 0; d < 4; d++) if (this.open(c, d)) m |= 1 << d;
    return m;
  }

  dirBetween(a: number, b: number): number {
    for (let d = 0; d < 4; d++) if (this.neighbor(a, d) === b) return d;
    return -1;
  }

  setWall(key: number, wall: boolean) {
    this.walls[key] = wall ? 1 : 0;
    this.version++;
  }

  // ---- Search ----

  /** Breadth-first distances (in cells) from any of the sources. -1 = unreachable. */
  bfs(sources: number[]): Int32Array {
    const dist = new Int32Array(this.cells).fill(-1);
    const queue = new Int32Array(this.cells);
    let head = 0, tail = 0;
    for (const s of sources) { dist[s] = 0; queue[tail++] = s; }
    while (head < tail) {
      const c = queue[head++];
      for (let d = 0; d < 4; d++) {
        if (!this.open(c, d)) continue;
        const n = this.neighbor(c, d);
        if (n >= 0 && dist[n] < 0) { dist[n] = dist[c] + 1; queue[tail++] = n; }
      }
    }
    return dist;
  }

  /** Shortest path from → to, excluding `from`. Null when unreachable. */
  path(from: number, to: number): number[] | null {
    if (from === to) return [];
    const dist = this.bfs([to]);
    if (dist[from] < 0) return null;
    const out: number[] = [];
    let c = from;
    while (c !== to) {
      let best = -1;
      for (let d = 0; d < 4; d++) {
        if (!this.open(c, d)) continue;
        const n = this.neighbor(c, d);
        if (n >= 0 && dist[n] === dist[c] - 1) { best = n; break; }
      }
      if (best < 0) return null;
      out.push(best);
      c = best;
    }
    return out;
  }

  connected(): boolean {
    const dist = this.bfs([0]);
    for (let i = 0; i < dist.length; i++) if (dist[i] < 0) return false;
    return true;
  }

  /** Grid line-of-sight between two world points, blocked by walls and closed doorway doors. */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    for (const hit of this.rayEdges(ax, az, bx - ax, bz - az, 1)) {
      if (hit.wall) return false;
      const d = this.doorOnEdge.get(hit.key);
      if (d && d.kind === 'swing' && !d.free && d.open === 0) return false;
    }
    return true;
  }

  /** Height of the tallest cell either side of an edge. */
  edgeTop(key: number) {
    const [a, b] = this.edgeCells(key);
    return Math.max(a >= 0 ? this.ceil[a] : 0, b >= 0 ? this.ceil[b] : 0);
  }

  /** Solid boxes along an edge: a whole wall, or the frame (and closed door) of a doorway. */
  edgeSolids(key: number, out: Box[]) {
    const t = 0.08;
    const s = this.edgeSegment(key);
    const box = (a0: number, a1: number) => {
      // a0..a1 are distances along the edge from its start.
      if (s.horizontal) out.push({ x0: s.x1 + a0, z0: s.z1 - t, x1: s.x1 + a1, z1: s.z1 + t });
      else out.push({ x0: s.x1 - t, z0: s.z1 + a0, x1: s.x1 + t, z1: s.z1 + a1 });
    };
    if (this.walls[key]) { box(-t, this.CS + t); return; }
    const d = this.doorOnEdge.get(key);
    if (!d || d.kind !== 'swing') return;
    const half = this.CS / 2, gap = d.w / 2;
    if (!d.free) { box(-t, half - gap); box(half + gap, this.CS + t); }
    if (d.open === 0) box(half - gap, half + gap);
  }

  /**
   * Edges crossed by a ray from (ax, az) along (dx, dz) * maxT, in order.
   * Grid traversal (Amanatides & Woo).
   */
  rayEdges(ax: number, az: number, dx: number, dz: number, maxT: number) {
    const CS = this.CS;
    const out: { key: number; wall: boolean; t: number }[] = [];
    let cx = Math.floor(ax / CS), cy = Math.floor(az / CS);
    if (!this.inBounds(cx, cy)) return out;
    const stepX = Math.sign(dx), stepY = Math.sign(dz);
    const tDeltaX = dx !== 0 ? CS / Math.abs(dx) : Infinity;
    const tDeltaY = dz !== 0 ? CS / Math.abs(dz) : Infinity;
    let tMaxX = dx > 0 ? ((cx + 1) * CS - ax) / dx : dx < 0 ? (cx * CS - ax) / dx : Infinity;
    let tMaxY = dz > 0 ? ((cy + 1) * CS - az) / dz : dz < 0 ? (cy * CS - az) / dz : Infinity;
    for (let guard = 0; guard < 200; guard++) {
      let dir: number, t: number;
      if (tMaxX < tMaxY) { t = tMaxX; dir = stepX > 0 ? 1 : 3; }
      else { t = tMaxY; dir = stepY > 0 ? 2 : 0; }
      if (t > maxT) break;
      const c = this.cell(cx, cy);
      const key = this.edgeOf(c, dir);
      const wall = this.walls[key] === 1;
      out.push({ key, wall, t });
      if (wall && this.isBorder(key)) break;
      if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; }
      else { cy += stepY; tMaxY += tDeltaY; }
      if (!this.inBounds(cx, cy)) break;
    }
    return out;
  }

  // ---- Generation ----

  private generate(rng: RNG, zr: RNG) {
    const { W, H } = this;
    const carved: { x: number; y: number; w: number; h: number }[] = [];

    // 1. A perfect maze, so everything starts connected.
    const seen = new Uint8Array(this.cells);
    const stack = [rng.int(this.cells)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1];
      const dirs = rng.shuffle([0, 1, 2, 3]).filter((d) => {
        const n = this.neighbor(c, d);
        return n >= 0 && !seen[n];
      });
      if (!dirs.length) { stack.pop(); continue; }
      const d = dirs[0];
      const n = this.neighbor(c, d);
      this.walls[this.edgeOf(c, d)] = 0;
      seen[n] = 1;
      stack.push(n);
    }

    // 2. Carve open rooms of odd sizes: ordinary rooms, endless one-cell halls,
    // huge open halls and closets. Each gets its own ceiling height, so some are
    // cramped and some rise much further than the building around them could allow.
    // A warehouse is mostly huge, tall concrete halls joined by wide aisles.
    const warehouse = this.def.gen.rooms === 'warehouse';
    if (warehouse) this.carveWarehouse(rng);
    const rooms = warehouse ? 0 : 16;
    for (let i = 0; i < rooms; i++) {
      const shape = rng.next();
      let rw: number, rh: number;
      if (shape < 0.18) { rw = rng.int(7, 14); rh = 1; } // long hall
      else if (shape < 0.3) { rw = 1; rh = rng.int(7, 14); }
      else if (shape < 0.4) { rw = rng.int(6, 10); rh = rng.int(6, 9); } // huge hall
      else if (shape < 0.5) { rw = 1; rh = 1; } // closet
      else { rw = rng.int(2, 6); rh = rng.int(2, 5); }
      const rx = rng.int(0, W - rw), ry = rng.int(0, H - rh);
      const hr = rng.next();
      const height = hr < 0.14 ? 2.3 : hr < 0.32 ? rng.range(4.2, 8.5) : CFG.WALL_H;
      if (rw > 1 && rh > 1 && rw <= 6 && rh <= 5) carved.push({ x: rx, y: ry, w: rw, h: rh });
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const c = this.cell(x, y);
          this.ceil[c] = height;
          if (x < rx + rw - 1) this.walls[this.edgeOf(c, 1)] = 0;
          if (y < ry + rh - 1) this.walls[this.edgeOf(c, 2)] = 0;
        }
      }
    }

    // 3. Knock out some walls so there are loops, but keep plenty of dead ends.
    for (let k = 0; k < this.edgeCount; k++) {
      if (this.walls[k] && !this.isBorder(k) && rng.chance(warehouse ? 0.3 : 0.22)) this.walls[k] = 0;
    }

    // 3b. The Manila Room: one ordinary room, walled in again with as few ways in
    // as still keep the level connected, and red where everything else is yellow.
    if (carved.length && this.def.gen.manila) {
      const r = zr.pick(carved);
      const boundary: number[] = [];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const c = this.cell(x, y);
          this.zone[c] = Zone.Manila;
          this.ceil[c] = CFG.WALL_H;
          for (let d = 0; d < 4; d++) {
            const n = this.neighbor(c, d);
            if (n < 0) continue;
            const nx = this.cx(n), ny = this.cy(n);
            const inside = nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h;
            if (!inside && !this.walls[this.edgeOf(c, d)]) boundary.push(this.edgeOf(c, d));
          }
        }
      }
      for (const k of boundary) this.walls[k] = 1;
      for (const k of zr.shuffle(boundary)) {
        if (this.connected()) break;
        this.walls[k] = 0;
      }
    }

    // 3c. The Street: one long, tall hall with a road down the middle and houses
    // along both sides. Walled in again, with the road leading in at either end.
    if (this.def.gen.street) this.placeStreet(new RNG(this.seed + ':street'));

    // 4. Pillars at grid corners where all four meeting edges are open (never in the road).
    for (let vy = 1; vy < H; vy++) {
      for (let vx = 1; vx < W; vx++) {
        const a = this.cell(vx - 1, vy - 1), b = this.cell(vx, vy);
        if (this.zone[a] === Zone.Street || this.zone[b] === Zone.Street) continue;
        const open = this.open(a, 1) && this.open(a, 2) && this.open(b, 0) && this.open(b, 3);
        // A warehouse's halls stand on rows of concrete columns.
        if (open && rng.chance(warehouse ? 0.7 : 0.3)) this.pillars.push({ x: vx * this.CS, z: vy * this.CS });
      }
    }

    // 5. Light circuits: Voronoi regions around spread-out seed cells.
    const seeds: number[] = [rng.int(this.cells)];
    while (seeds.length < CFG.CIRCUITS) {
      let best = 0, bestD = -1;
      for (let c = 0; c < this.cells; c++) {
        let md = Infinity;
        for (const s of seeds) md = Math.min(md, Math.hypot(this.cx(c) - this.cx(s), this.cy(c) - this.cy(s)));
        md += rng.next() * 1.5;
        if (md > bestD) { bestD = md; best = c; }
      }
      seeds.push(best);
    }
    this.circuitCount = seeds.length;
    this.circuitCells = seeds.map(() => []);
    for (let c = 0; c < this.cells; c++) {
      let best = 0, bestD = Infinity;
      seeds.forEach((s, i) => {
        const d = Math.hypot(this.cx(c) - this.cx(s), this.cy(c) - this.cy(s));
        if (d < bestD) { bestD = d; best = i; }
      });
      this.circuit[c] = best;
      this.circuitCells[best].push(c);
    }
    this.circuitCenter = this.circuitCells.map((cells) => {
      let x = 0, z = 0;
      for (const c of cells) { const p = this.center(c); x += p.x; z += p.z; }
      return { x: x / cells.length, z: z / cells.length };
    });
    for (let c = 0; c < this.cells; c++) {
      // The Street is lit end to end, like a sound stage.
      // A warehouse's lamps hang further apart, with dim stretches between.
      const lamp = warehouse ? (this.cx(c) + this.cy(c)) % 2 === 0 && rng.chance(0.7) : (this.cx(c) + this.cy(c)) % 2 === 0 || rng.chance(0.2);
      this.panel[c] = lamp || this.zone[c] === Zone.Street ? 1 : 0;
    }

    // 6. Exits on the border, far apart (never behind the Street's houses).
    const borderCell = () => {
      for (;;) {
        const side = rng.int(4);
        const t = rng.int(1, (side % 2 === 0 ? W : H) - 1);
        const x = side === 1 ? W - 1 : side === 3 ? 0 : t;
        const y = side === 0 ? 0 : side === 2 ? H - 1 : t;
        if (this.zone[this.cell(x, y)] !== Zone.Street) return { cell: this.cell(x, y), dir: side };
      }
    };
    this.exits.push(borderCell());
    while (this.exits.length < CFG.EXITS) {
      let best = borderCell(), bestD = -1;
      for (let i = 0; i < 40; i++) {
        const e = borderCell();
        const d = Math.min(...this.exits.map((x) =>
          Math.hypot(this.cx(e.cell) - this.cx(x.cell), this.cy(e.cell) - this.cy(x.cell))));
        if (d > bestD) { bestD = d; best = e; }
      }
      this.exits.push(best);
    }
    for (const e of this.exits) this.exitCells.add(e.cell);

    // 7. Wanderers noclip in as far from every exit as possible.
    const fromExits = this.bfs([...this.exitCells]);
    let spawn = 0, spawnD = -1;
    for (let c = 0; c < this.cells; c++) {
      const d = fromExits[c] + rng.next();
      if (d > spawnD) { spawnD = d; spawn = c; }
    }
    this.spawnCell = spawn;

    // 8. The monster starts a short walk away from them.
    const fromSpawn = this.bfs([spawn]);
    const candidates: number[] = [];
    for (let c = 0; c < this.cells; c++) if (fromSpawn[c] >= 8 && fromSpawn[c] <= 13) candidates.push(c);
    this.monsterCell = candidates.length ? rng.pick(candidates) : (spawn + this.cells / 2) % this.cells;

    // 9. Zones, a circuit at a time. Nobody noclips into the dark or the pits.
    this.dead = new Uint8Array(this.circuitCount);
    const circuits = zr.shuffle(Array.from({ length: this.circuitCount }, (_, i) => i))
      .filter((i) => i !== this.circuit[spawn]);
    // Which kinds of region this level has, from its description.
    const gen = this.def.gen;
    const allPool = gen.pool === 'all';
    const kinds: Zone[] = [];
    for (let k = 0; k < gen.dark; k++) kinds.push(Zone.Dark);
    if (gen.pitfalls) kinds.push(Zone.Pitfalls);
    for (let k = 0; k < gen.furnished; k++) kinds.push(Zone.Furnished);
    if (gen.pool === 'region') kinds.push(Zone.Pool);
    const make = (c: number, z: Zone) => {
      if (this.zone[c] === Zone.Manila || this.zone[c] === Zone.Street) return;
      this.zone[c] = z;
      // The Poolrooms have no light fittings: the light is just there. Their
      // rooms run tall, never cramped.
      if (z === Zone.Pool) {
        this.panel[c] = 0;
        this.ceil[c] = Math.max(this.ceil[c], 3.4);
      }
    };
    kinds.forEach((z, j) => {
      const i = circuits[j];
      if (i === undefined) return;
      if (z === Zone.Dark) this.dead[i] = 1;
      // Where the whole level is the Poolrooms, a dead circuit is still tile and water, just unlit.
      for (const c of this.circuitCells[i]) make(c, allPool && z === Zone.Dark ? Zone.Pool : z);
    });
    if (allPool) for (let c = 0; c < this.cells; c++) if (this.zone[c] === Zone.Bare) make(c, Zone.Pool);
    // No power anywhere: every light in the level is dead, where people arrive too.
    if (gen.power === 'none') this.dead.fill(1);
  }

  /**
   * A warehouse: every room is tall, and most of the floor is a few huge halls
   * and the wide aisles between them, with the maze left only in the gaps.
   */
  private carveWarehouse(rng: RNG) {
    const { W, H } = this;
    for (let c = 0; c < this.cells; c++) this.ceil[c] = rng.chance(0.5) ? 3.6 : 4.2;
    const halls = 11;
    for (let i = 0; i < halls; i++) {
      const aisle = rng.chance(0.3);
      const along = rng.chance(0.5);
      const rw = aisle ? (along ? rng.int(9, 18) : 2) : rng.int(4, 10);
      const rh = aisle ? (along ? 2 : rng.int(9, 18)) : rng.int(4, 9);
      const rx = rng.int(0, W - rw + 1), ry = rng.int(0, H - rh + 1);
      const height = aisle ? rng.range(4.2, 5.5) : rng.range(5.5, 8);
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const c = this.cell(x, y);
          this.ceil[c] = Math.max(this.ceil[c], height);
          if (x < rx + rw - 1) this.walls[this.edgeOf(c, 1)] = 0;
          if (y < ry + rh - 1) this.walls[this.edgeOf(c, 2)] = 0;
        }
      }
    }
  }

  /**
   * Find room for the Street (four cells wide, ten to fifteen long, clear of the
   * Manila Room), open it up under one tall ceiling, then wall it in again. The
   * way in is the road itself at either end; a side door is knocked through only
   * if the level would otherwise be cut in two.
   */
  private placeStreet(rng: RNG) {
    const { W, H } = this;
    const WIDE = 4;
    for (let tries = 0; tries < 60; tries++) {
      const along = rng.int(10, 16);
      const alongX = rng.chance(0.5);
      const w = alongX ? along : WIDE, h = alongX ? WIDE : along;
      if (w > W || h > H) continue;
      // Never against the edge of the map at either end, so the road always leads somewhere both ways.
      if ((alongX ? W - w : H - h) < 2) continue;
      const x = alongX ? rng.int(1, W - w) : rng.int(0, W - w + 1), y = alongX ? rng.int(0, H - h + 1) : rng.int(1, H - h);
      let clear = true;
      for (let yy = y - 1; yy <= y + h && clear; yy++) {
        for (let xx = x - 1; xx <= x + w && clear; xx++) {
          if (this.inBounds(xx, yy) && this.zone[this.cell(xx, yy)] === Zone.Manila) clear = false;
        }
      }
      if (!clear) continue;

      const inside = (xx: number, yy: number) => xx >= x && xx < x + w && yy >= y && yy < y + h;
      const ends: number[] = [], sides: number[] = [];
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const c = this.cell(xx, yy);
          this.zone[c] = Zone.Street;
          this.ceil[c] = 6.5;
          for (let d = 0; d < 4; d++) {
            const k = this.edgeOf(c, d);
            const nx = xx + DX[d], ny = yy + DY[d];
            if (inside(nx, ny)) { this.walls[k] = 0; continue; }
            this.walls[k] = 1;
            if (!this.inBounds(nx, ny)) continue;
            // An end wall is across the road; a side wall runs along it.
            const end = alongX ? d === 1 || d === 3 : d === 0 || d === 2;
            (end ? ends : sides).push(k);
          }
        }
      }
      // The road comes in through the middle of each end.
      const middle = ends.filter((k) => {
        const s = this.edgeSegment(k);
        const t = alongX ? s.z1 / this.CS - y : s.x1 / this.CS - x;
        return t === 1 || t === 2;
      });
      const byEnd = new Map<number, number[]>();
      for (const k of middle) {
        const s = this.edgeSegment(k);
        const key = alongX ? s.x1 : s.z1;
        byEnd.set(key, [...(byEnd.get(key) ?? []), k]);
      }
      for (const ks of byEnd.values()) this.walls[rng.pick(ks)] = 0;
      // If that cut part of the level off, open just enough wall to reach it again:
      // each time, one wall whose far side can't currently be reached.
      const order = [...rng.shuffle(ends), ...rng.shuffle(sides)];
      const hall = this.cell(x, y);
      for (;;) {
        const dist = this.bfs([hall]);
        if (!dist.includes(-1)) break;
        const k = order.find((e) => this.walls[e] && this.edgeCells(e).some((c) => c >= 0 && dist[c] < 0));
        if (k === undefined) break;
        this.walls[k] = 0;
      }
      const CS = this.CS;
      this.streetCells = { x, y, w, h };
      this.street = { x0: x * CS, z0: y * CS, x1: (x + w) * CS, z1: (y + h) * CS, alongX };

      // One house, different every night, has a way through: in at its front
      // door, along its hall, and out of a back door into the maze behind.
      const n = alongX ? w : h;
      const options: { d: number; i: number; j: number; key: number; outer: number }[] = [];
      for (const d of alongX ? [0, 2] : [1, 3]) {
        for (let i = 0; i + 1 < n; i++) {
          const ki = this.edgeOf(this.streetSide(d, i), d), kj = this.edgeOf(this.streetSide(d, i + 1), d);
          if (!this.walls[ki] || !this.walls[kj]) continue;
          for (const j of [i, i + 1]) {
            const outer = this.neighbor(this.streetSide(d, j), d);
            if (outer < 0 || this.zone[outer] === Zone.Manila || this.zone[outer] === Zone.Street) continue;
            options.push({ d, i, j, key: this.edgeOf(this.streetSide(d, j), d), outer });
          }
        }
      }
      if (options.length) {
        const o = rng.pick(options);
        this.walls[o.key] = 0;
        this.streetBack = o;
      }
      return;
    }
  }

  /**
   * The Street's houses: façades against both long walls, with picket fences
   * between them, mailboxes at the kerb, a stop sign, fans turning slowly far
   * overhead, and one figure standing in the road.
   */
  /** The Street's cell i along its side whose walls face direction d. */
  private streetSide(d: number, i: number) {
    const sc = this.streetCells!, alongX = sc.w > sc.h;
    return alongX
      ? this.cell(sc.x + i, d === 0 ? sc.y : sc.y + sc.h - 1)
      : this.cell(d === 3 ? sc.x : sc.x + sc.w - 1, sc.y + i);
  }

  private furnishStreet(rng: RNG, prop: (p: Partial<Prop> & { type: PropType; x: number; z: number }) => Prop) {
    const sc = this.streetCells, st = this.street;
    if (!sc || !st) return;
    const CS = this.CS;
    const n = st.alongX ? sc.w : sc.h;
    const back = this.streetBack;
    // One long side at a time: d is the outward direction of its walls.
    const sides = st.alongX ? [0, 2] : [1, 3];
    for (const d of sides) {
      const nx = -DX[d], nz = -DY[d]; // into the hall
      const ry = Math.atan2(nx, nz);
      const cellAt = (i: number) => this.streetSide(d, i);
      const walled = (i: number) => {
        const k = this.edgeOf(cellAt(i), d);
        if (back && k === back.key) return true; // the way-through house's back door
        // A door hung on the far side of the wall is the maze's business, not the house's.
        return this.walls[k] === 1;
      };
      // The wall line, and a point on it a distance a along from the street's start.
      const c0 = this.center(cellAt(0));
      const wx = c0.x - nx * CS / 2, wz = c0.z - nz * CS / 2;
      const at = (a: number, out: number) => ({ x: (st.alongX ? st.x0 + a : wx) + nx * out, z: (st.alongX ? wz : st.z0 + a) + nz * out });
      const solid = (a0: number, a1: number, o0: number, o1: number) => {
        const p = at(a0, o0), q = at(a1, o1);
        this.addSolid({ x0: Math.min(p.x, q.x), z0: Math.min(p.z, q.z), x1: Math.max(p.x, q.x), z1: Math.max(p.z, q.z) });
      };
      let i = 0;
      while (i < n) {
        if (!walled(i)) { i++; continue; }
        const throughHere = !!back && back.d === d && back.i === i;
        // Leave the way-through house its two walls, whatever the houses before it took.
        const span = throughHere ? 2 : back && back.d === d && back.i === i + 1 ? 1 : i + 1 < n && walled(i + 1) ? 2 : 1;
        const a0 = i * CS, a1 = (i + span) * CS;
        if (throughHere) {
          // Its door lines up with the opening behind it, half a cell either side of centre.
          const mid = (a0 + a1) / 2, doorA = (back!.j + 0.5) * CS;
          const sgn = st.alongX ? nz : -nx; // local +x, measured along the road
          const v = rng.int(3) | 8 | (sgn * (doorA - mid) > 0 ? 16 : 0);
          prop({ type: 'house', ...at(mid, 0.08), ry, v });
          // Solid either side of its hall, open down the middle.
          solid(a0, doorA - 0.5, 0, 0.93);
          solid(doorA + 0.5, a1, 0, 0.93);
          const ma = mid + (doorA > mid ? -0.4 : 0.4);
          prop({ type: 'mailbox', ...at(ma, 2.25), ry: ry + Math.PI });
          solid(ma - 0.08, ma + 0.08, 2.17, 2.33);
        } else if (span === 2) {
          // A house two cells wide, with a strip of fence either side of it.
          const v = rng.int(3) | (rng.chance(0.5) ? 4 : 0);
          const p = at((a0 + a1) / 2, 0.08);
          prop({ type: 'house', ...p, ry, v });
          solid(a0 + 0.35, a1 - 0.35, 0, 0.88);
          for (const [f0, f1] of [[a0, a0 + 0.35], [a1 - 0.35, a1]]) {
            const f = at((f0 + f1) / 2, 0.8);
            prop({ type: 'fence', ...f, ry, v: Math.round((f1 - f0) * 100) });
          }
          solid(a0, a1, 0.72, 0.88);
          // Its mailbox at the kerb, between the driveway and the path.
          const ma = (a0 + a1) / 2 + ((v & 4) ? -0.4 : 0.4);
          prop({ type: 'mailbox', ...at(ma, 2.25), ry: ry + Math.PI });
          solid(ma - 0.08, ma + 0.08, 2.17, 2.33);
        } else {
          // A gap with only a fence in it.
          const f = at((a0 + a1) / 2, 0.8);
          prop({ type: 'fence', ...f, ry, v: Math.round((a1 - a0) * 100) });
          solid(a0, a1, 0.72, 0.88);
        }
        i += span;
      }
    }
    // Ceiling fans down the middle, over the road.
    const mid = st.alongX ? (st.z0 + st.z1) / 2 : (st.x0 + st.x1) / 2;
    const len = st.alongX ? st.x1 - st.x0 : st.z1 - st.z0;
    for (let a = CS; a < len; a += CS * 2) {
      const x = st.alongX ? st.x0 + a : mid, z = st.alongX ? mid : st.z0 + a;
      prop({ type: 'fan', x, z, y: 6.5, ry: rng.range(0, Math.PI * 2), ceil: true });
    }
    // A stop sign on the pavement near one end.
    const end = rng.chance(0.5) ? CS * 0.5 : len - CS * 0.5;
    const side = rng.chance(0.5) ? 1 : -1;
    const sx = st.alongX ? st.x0 + end : mid + side * 3.75, sz = st.alongX ? mid + side * 3.75 : st.z0 + end;
    // It faces into the street, at whoever is walking towards that end.
    prop({ type: 'stop', x: sx, z: sz, ry: st.alongX ? (end < len / 2 ? Math.PI / 2 : -Math.PI / 2) : (end < len / 2 ? 0 : Math.PI) });
    this.addSolid({ x0: sx - 0.06, z0: sz - 0.06, x1: sx + 0.06, z1: sz + 0.06 });
    // Someone standing in the middle of the road, far down it, facing back up.
    const fa = Math.round((rng.chance(0.5) ? 0.75 : 0.25) * len / CS) * CS;
    const fx = st.alongX ? st.x0 + fa : mid, fz = st.alongX ? mid : st.z0 + fa;
    prop({ type: 'mannequin', x: fx, z: fz, ry: st.alongX ? (fa > len / 2 ? -Math.PI / 2 : Math.PI / 2) : (fa > len / 2 ? Math.PI : 0) });
    this.addSolid({ x0: fx - 0.2, z0: fz - 0.2, x1: fx + 0.2, z1: fz + 0.2 });
  }

  // ---- Doors and debris ----

  private makeDoor(kind: DoorKind, key: number, cell: number, opts: Partial<Door> = {}): Door {
    const s = this.edgeSegment(key);
    const [, b] = this.edgeCells(key);
    const toward = cell === b ? 1 : -1;
    const d: Door = {
      id: this.doors.length, kind, key, cell,
      nx: s.horizontal ? 0 : toward, nz: s.horizontal ? toward : 0,
      mx: (s.x1 + s.x2) / 2, mz: (s.z1 + s.z2) / 2,
      tx: s.horizontal ? 1 : 0, tz: s.horizontal ? 0 : 1,
      w: 0.95, h: 2.05, y0: 0, variant: null, free: false, link: -1, open: 0, openT: 0, swing: 0,
      ...opts,
    };
    this.doors.push(d);
    this.doorOnEdge.set(key, d);
    return d;
  }

  private addSolid(b: Box) {
    const i = this.solids.length;
    this.solids.push(b);
    const x0 = Math.floor(b.x0 / this.CS), x1 = Math.floor(b.x1 / this.CS);
    const y0 = Math.floor(b.z0 / this.CS), y1 = Math.floor(b.z1 / this.CS);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.inBounds(x, y)) continue;
        const c = this.cell(x, y);
        const list = this.solidsInCell.get(c) ?? [];
        list.push(i);
        this.solidsInCell.set(c, list);
      }
    }
  }

  /** Walls touching a grid vertex (not counting `except`). */
  private vertexWalls(vx: number, vy: number, except: number) {
    const { W, H } = this;
    let n = 0;
    const check = (k: number) => { if (k !== except && this.walls[k]) n++; };
    if (vx > 0 && vy <= H) check(vy * W + vx - 1);
    if (vx < W && vy <= H) check(vy * W + vx);
    if (vy > 0) check(this.HC + (vy - 1) * (W + 1) + vx);
    if (vy < H) check(this.HC + vy * (W + 1) + vx);
    return n;
  }

  private furnish(rng: RNG) {
    const { W, H, CS } = this;
    const exitEdges = new Set(this.exits.map((e) => this.edgeOf(e.cell, e.dir)));
    const doorCell = new Uint8Array(this.cells);
    this.doorCells = doorCell;

    // The way-through house's back door, out into the maze. It only ever swings
    // outwards: inwards, it would hit the walls of the house's narrow hall.
    const back = this.streetBack;
    if (back) {
      this.makeDoor('swing', back.key, back.outer, { swing: 1 });
      for (const c of this.edgeCells(back.key)) doorCell[c] = 1;
    }

    // Doorway doors on open edges flanked by walls, so they read as doorways.
    const swing: number[] = [];
    for (let k = 0; k < this.edgeCount; k++) {
      if (this.walls[k] || this.isBorder(k)) continue;
      const [a, b] = this.edgeCells(k);
      if (this.exitCells.has(a) || this.exitCells.has(b)) continue;
      const s = this.edgeSegment(k);
      const vx = Math.round(s.x1 / CS), vy = Math.round(s.z1 / CS);
      const [v2x, v2y] = s.horizontal ? [vx + 1, vy] : [vx, vy + 1];
      if (this.vertexWalls(vx, vy, k) && this.vertexWalls(v2x, v2y, k)) swing.push(k);
    }
    let placed = 0;
    for (const k of rng.shuffle(swing)) {
      if (placed >= 16) break;
      const [a, b] = this.edgeCells(k);
      if (doorCell[a] || doorCell[b]) continue;
      this.makeDoor('swing', k, a);
      doorCell[a] = doorCell[b] = 1;
      placed++;
    }

    // Freestanding doors in the middle of open rooms: a frame and a door, and nothing around them.
    const free: number[] = [];
    for (let k = 0; k < this.edgeCount; k++) {
      if (this.walls[k] || this.isBorder(k) || this.doorOnEdge.has(k) || this.edgeCells(k).some((c) => this.zone[c] === Zone.Street)) continue;
      const s = this.edgeSegment(k);
      const vx = Math.round(s.x1 / CS), vy = Math.round(s.z1 / CS);
      const [v2x, v2y] = s.horizontal ? [vx + 1, vy] : [vx, vy + 1];
      if (!this.vertexWalls(vx, vy, k) && !this.vertexWalls(v2x, v2y, k)) free.push(k);
    }
    placed = 0;
    for (const k of rng.shuffle(free)) {
      if (placed >= 4) break;
      const [a, b] = this.edgeCells(k);
      if (doorCell[a] || doorCell[b]) continue;
      this.makeDoor('swing', k, a, { free: true });
      doorCell[a] = doorCell[b] = 1;
      placed++;
    }

    // Doors hung on walls. Most lead nowhere; a few pairs lead somewhere else entirely.
    const wallSides: [number, number][] = [];
    for (let k = 0; k < this.edgeCount; k++) {
      if (!this.walls[k] || exitEdges.has(k)) continue;
      for (const c of this.edgeCells(k)) if (c >= 0 && !this.exitCells.has(c) && this.zone[c] !== Zone.Street) wallSides.push([k, c]);
    }
    rng.shuffle(wallSides);
    const takeSide = () => {
      while (wallSides.length) {
        const [k, c] = wallSides.pop()!;
        if (this.doorOnEdge.has(k) || doorCell[c]) continue;
        doorCell[c] = 1;
        return [k, c] as const;
      }
      return null;
    };
    for (let i = 0; i < 3; i++) {
      const a = takeSide();
      if (!a) break;
      const pa = this.makeDoor('portal', a[0], a[1], { h: 2.25 });
      // Partner: a far-away wall.
      let best = -1, bestD = -1;
      for (let j = Math.max(0, wallSides.length - 60); j < wallSides.length; j++) {
        const [k, c] = wallSides[j];
        if (this.doorOnEdge.has(k) || doorCell[c]) continue;
        const d = Math.hypot(this.cx(c) - this.cx(a[1]), this.cy(c) - this.cy(a[1]));
        if (d > bestD) { bestD = d; best = j; }
      }
      if (best < 0) break;
      const [k, c] = wallSides.splice(best, 1)[0];
      doorCell[c] = 1;
      const pb = this.makeDoor('portal', k, c, { h: 2.25 });
      pa.link = pb.id;
      pb.link = pa.id;
    }
    const variants: FakeVariant[] = ['brick', 'brick', 'void', 'void', 'double', 'high', 'tiny'];
    for (let i = 0; i < 16; i++) {
      const a = takeSide();
      if (!a) break;
      const variant = rng.pick(variants);
      this.makeDoor('fake', a[0], a[1], {
        variant,
        w: variant === 'tiny' ? 0.5 : 0.95,
        h: variant === 'tiny' ? 0.95 : 2.05,
        y0: variant === 'high' ? rng.range(1.4, 2.2) : 0,
      });
    }

    // Holes in the floor of the Pitfalls, each tucked into a corner of its cell so
    // the straight walk between cell centres always stays clear.
    const pitCell = new Uint8Array(this.cells);
    for (let c = 0; c < this.cells; c++) {
      if (this.pits.length >= MAX_PITS) break;
      if (this.zone[c] !== Zone.Pitfalls || doorCell[c] || this.exitCells.has(c) || c === this.spawnCell || !rng.chance(0.45)) continue;
      const sx = rng.chance(0.5) ? 1 : -1, sz = rng.chance(0.5) ? 1 : -1;
      const w = rng.range(0.75, 1.05), d = rng.range(0.75, 1.05);
      const p = this.center(c);
      if (this.pillars.some((q) => q.x === p.x + sx * CS / 2 && q.z === p.z + sz * CS / 2)) continue;
      const ex = p.x + sx * (CS / 2 - 0.1), ez = p.z + sz * (CS / 2 - 0.1); // the corner, just off the walls
      const hole = { x0: Math.min(ex, ex - sx * w), z0: Math.min(ez, ez - sz * d), x1: Math.max(ex, ex - sx * w), z1: Math.max(ez, ez - sz * d) };
      const lip = 0.12;
      const solid = { x0: hole.x0 + lip, z0: hole.z0 + lip, x1: hole.x1 - lip, z1: hole.z1 - lip };
      this.pits.push({ hole, solid });
      this.addSolid(solid);
      pitCell[c] = 1;
    }

    // Debris and furniture: thick in the furnished pockets, a rare thing anywhere else.
    const office = this.def.gen.rooms === 'office';
    const density = (c: number) => {
      const z = this.zone[c];
      if (!office) return 0;
      return z === Zone.Furnished ? 1 : z === Zone.Manila || z === Zone.Pool || z === Zone.Street || pitCell[c] ? 0 : 0.12;
    };
    const prop =(p: Partial<Prop> & { type: PropType; x: number; z: number }) => {
      const full: Prop = { y: 0, ry: 0, rx: 0, rz: 0, ceil: false, cell: this.cellAt(p.x, p.z), v: 0, ...p };
      this.props.push(full);
      return full;
    };
    const solidAt = (x: number, z: number, hx: number, hz: number, ry: number) => {
      const swap = Math.abs(Math.sin(ry)) > 0.7;
      const ax = swap ? hz : hx, az = swap ? hx : hz;
      this.addSolid({ x0: x - ax, z0: z - az, x1: x + ax, z1: z + az });
    };
    // The Street first, so its houses claim their walls before any stray furniture can.
    this.furnishStreet(new RNG(this.seed + ':street-props'), prop);
    const order = rng.shuffle(Array.from({ length: this.cells }, (_, i) => i));
    for (const c of order) {
      if (this.exitCells.has(c)) continue;
      const cx = (this.cx(c) + 0.5) * CS, cz = (this.cy(c) + 0.5) * CS;
      const wallDirs = [0, 1, 2, 3].filter((d) => !this.open(c, d) && !this.doorOnEdge.has(this.edgeOf(c, d)));
      const k = density(c);

      // Something against a wall.
      if (wallDirs.length && rng.chance(0.24 * k)) {
        const d = rng.pick(wallDirs);
        const nx = -DX[d], nz = -DY[d]; // into the cell
        const tx = Math.abs(nz), tz = Math.abs(nx);
        const along = rng.range(-0.7, 0.7);
        const face = Math.atan2(nx, nz) + rng.range(-0.15, 0.15);
        const at = (depth: number) => ({ x: cx - nx * (CS / 2 - 0.08 - depth / 2) + tx * along, z: cz - nz * (CS / 2 - 0.08 - depth / 2) + tz * along });
        const r = rng.next();
        if (r < 0.24) {
          // Office chair: upright, facing the wall, or knocked over.
          const p = at(0.6);
          const state = rng.int(3);
          prop({ type: 'chair', ...p, ry: state === 1 ? face + Math.PI : face, rx: state === 2 ? Math.PI / 2 : 0, v: state });
          solidAt(p.x, p.z, 0.3, 0.3, face);
        } else if (r < 0.38) {
          const p = at(0.6);
          const tipped = rng.chance(0.25);
          prop({ type: 'cabinet', ...p, ry: face, rz: tipped ? Math.PI / 2 : 0, v: tipped ? 1 : 0 });
          solidAt(p.x, p.z, tipped ? 0.65 : 0.25, 0.3, face);
        } else if (r < 0.52) {
          const p = at(0.75);
          prop({ type: 'desk', ...p, ry: face, v: rng.chance(0.6) ? 1 : 0 });
          solidAt(p.x, p.z, 0.72, 0.38, face);
        } else if (r < 0.62) {
          // A CRT on the floor, usually facing the wall, screen still glowing.
          const p = at(0.45);
          prop({ type: 'crt', ...p, ry: rng.chance(0.6) ? face + Math.PI : face });
          solidAt(p.x, p.z, 0.22, 0.22, face);
        } else if (r < 0.71) {
          const p = at(0.35);
          prop({ type: 'mattress', ...p, ry: face });
          solidAt(p.x, p.z, 0.5, 0.2, face);
        } else if (r < 0.77) {
          const p = at(0.3);
          prop({ type: 'lamp', ...p, ry: face });
          solidAt(p.x, p.z, 0.15, 0.15, 0);
        } else if (r < 0.86) {
          const p = at(0.3);
          prop({ type: 'phone', ...p, ry: face + rng.range(-1, 1) });
        } else if (r < 0.94) {
          // A mannequin with its face to the wall.
          const p = at(0.4);
          prop({ type: 'mannequin', ...p, ry: face + Math.PI + rng.range(-0.2, 0.2) });
          solidAt(p.x, p.z, 0.2, 0.2, 0);
        } else {
          // Stairs along the wall that climb straight into the ceiling.
          const p = at(1.0);
          const sx = cx - nx * (CS / 2 - 0.58), sz = cz - nz * (CS / 2 - 0.58);
          prop({ type: 'stairs', x: sx, z: sz, ry: face, v: Math.round(this.ceil[c] * 10) });
          solidAt(sx, sz, 1.3, 0.5, face);
          void p;
        }
      }

      // Furniture stuck to the ceiling, upside down.
      if (rng.chance(0.05 * k)) {
        prop({
          type: rng.chance(0.6) ? 'chair' : 'desk', x: cx + rng.range(-0.8, 0.8), z: cz + rng.range(-0.8, 0.8),
          y: this.ceil[c], ry: rng.range(0, Math.PI * 2), ceil: true,
        });
      }

      // Paper everywhere.
      if (rng.chance(0.3 * (k ? Math.max(k, 0.25) : 0))) {
        for (let i = rng.int(1, 5); i > 0; i--) {
          prop({ type: 'paper', x: cx + rng.range(-1.3, 1.3), z: cz + rng.range(-1.3, 1.3), ry: rng.range(0, Math.PI * 2), y: 0.004 + i * 0.001 });
        }
      }
    }

    if (!office) this.furnishWarehouse(rng, prop, solidAt, doorCell);

    // Arrangements in open rooms, centred on grid corners so the walkways stay clear.
    for (let vy = 1; vy < H; vy++) {
      for (let vx = 1; vx < W; vx++) {
        if (this.vertexWalls(vx, vy, -1)) continue;
        const cells = [this.cell(vx - 1, vy - 1), this.cell(vx, vy - 1), this.cell(vx - 1, vy), this.cell(vx, vy)];
        if (cells.some((c) => this.exitCells.has(c) || doorCell[c] || this.zone[c] !== Zone.Furnished)) continue;
        const x = vx * CS, z = vy * CS;
        if (this.pillars.some((p) => p.x === x && p.z === z)) continue;
        const ch = Math.min(...cells.map((c) => this.ceil[c]));
        const r = rng.next();
        if (r < 0.035) {
          // A circle of chairs facing each other around nothing.
          const n = rng.int(5, 8), r0 = 0.85, a0 = rng.range(0, 6.28);
          for (let i = 0; i < n; i++) {
            const a = a0 + (i / n) * Math.PI * 2;
            const px = x + Math.cos(a) * r0, pz = z + Math.sin(a) * r0;
            prop({ type: 'chair', x: px, z: pz, ry: Math.atan2(x - px, z - pz) });
          }
          this.addSolid({ x0: x - 1.15, z0: z - 1.15, x1: x + 1.15, z1: z + 1.15 });
        } else if (r < 0.055) {
          // Chairs stacked up into the ceiling.
          for (let i = 0, y = 0; y < ch + 0.4; i++, y += 0.55) {
            prop({ type: 'chair', x: x + rng.range(-0.12, 0.12), z: z + rng.range(-0.12, 0.12), y, ry: rng.range(0, 6.28), rx: rng.range(-0.15, 0.15) });
          }
          this.addSolid({ x0: x - 0.35, z0: z - 0.35, x1: x + 0.35, z1: z + 0.35 });
        } else if (r < 0.07) {
          // A mannequin standing in the open, facing somewhere.
          prop({ type: 'mannequin', x, z, ry: rng.int(4) * (Math.PI / 2) + rng.range(-0.3, 0.3) });
          this.addSolid({ x0: x - 0.2, z0: z - 0.2, x1: x + 0.2, z1: z + 0.2 });
        } else if (r < 0.085) {
          // A dinner table for nobody.
          prop({ type: 'desk', x, z, ry: rng.int(2) * (Math.PI / 2), v: 2 });
          for (const s of [-1, 1]) prop({ type: 'chair', x: x + s * 0.95, z, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
          this.addSolid({ x0: x - 1.25, z0: z - 0.45, x1: x + 1.25, z1: z + 0.45 });
        }
      }
    }

    // Desks fused halfway through walls.
    let fused = 0;
    for (let k = 0; k < this.edgeCount && fused < 5; k++) {
      if (!this.walls[k] || this.isBorder(k) || this.doorOnEdge.has(k) || this.edgeCells(k).some((c) => this.zone[c] === Zone.Street) || !rng.chance(0.03)) continue;
      const s = this.edgeSegment(k);
      const x = (s.x1 + s.x2) / 2, z = (s.z1 + s.z2) / 2;
      const along = rng.range(-0.6, 0.6);
      const px = x + (s.horizontal ? along : 0), pz = z + (s.horizontal ? 0 : along);
      prop({ type: 'desk', x: px, z: pz, ry: s.horizontal ? Math.PI / 2 : 0, v: 0 });
      solidAt(px, pz, 0.72, 0.38, s.horizontal ? Math.PI / 2 : 0);
      fused++;
    }

    // The PA speaker the music comes from, hanging over the middle of the map.
    const pc = this.cell(W >> 1, H >> 1);
    this.pa = { ...this.center(pc), y: this.ceil[pc] };
    prop({ type: 'speaker', x: this.pa.x, z: this.pa.z, y: this.pa.y, ry: rng.range(0, Math.PI * 2), ceil: true });
  }

  /**
   * A warehouse's clutter: pallets against the walls, some stacked with boxes,
   * and the odd tower of boxes out in the halls.
   */
  private furnishWarehouse(
    rng: RNG,
    prop: (p: Partial<Prop> & { type: PropType; x: number; z: number }) => Prop,
    solidAt: (x: number, z: number, hx: number, hz: number, ry: number) => void,
    doorCell: Uint8Array,
  ) {
    const CS = this.CS;
    for (let c = 0; c < this.cells; c++) {
      if (this.exitCells.has(c) || doorCell[c] || c === this.spawnCell || !rng.chance(0.2)) continue;
      const wallDirs = [0, 1, 2, 3].filter((d) => !this.open(c, d) && !this.doorOnEdge.has(this.edgeOf(c, d)));
      if (!wallDirs.length) continue;
      const d = rng.pick(wallDirs);
      const nx = -DX[d], nz = -DY[d];
      const p = this.center(c);
      const along = rng.range(-0.6, 0.6);
      const x = p.x - nx * (CS / 2 - 0.62) + Math.abs(nz) * along, z = p.z - nz * (CS / 2 - 0.62) + Math.abs(nx) * along;
      const ry = Math.atan2(nx, nz) + rng.range(-0.08, 0.08);
      // v: how many layers of boxes are on it (0 to 3).
      const v = rng.int(4);
      prop({ type: 'pallet', x, z, ry, v });
      solidAt(x, z, 0.62, 0.52, ry);
    }
    for (let vy = 1; vy < this.H; vy++) {
      for (let vx = 1; vx < this.W; vx++) {
        if (this.vertexWalls(vx, vy, -1) || !rng.chance(0.05)) continue;
        const cells = [this.cell(vx - 1, vy - 1), this.cell(vx, vy - 1), this.cell(vx - 1, vy), this.cell(vx, vy)];
        if (cells.some((c) => this.exitCells.has(c) || doorCell[c] || c === this.spawnCell)) continue;
        const x = vx * CS, z = vy * CS;
        if (this.pillars.some((q) => q.x === x && q.z === z)) continue;
        prop({ type: 'boxes', x, z, ry: rng.range(0, Math.PI * 2), v: rng.int(2, 5) });
        this.addSolid({ x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6 });
      }
    }
  }

  /**
   * Supply crates against walls, spread out across the level and away from
   * where people arrive: batteries, chalk and almond water, in turn.
   */
  private placeSupplies(rng: RNG) {
    const n = this.def.gen.supplies;
    if (!n) return;
    const CS = this.CS;
    const fromSpawn = this.bfs([this.spawnCell]);
    const options: { c: number; d: number }[] = [];
    for (let c = 0; c < this.cells; c++) {
      if (this.exitCells.has(c) || this.doorCells[c] || fromSpawn[c] < 3) continue;
      if ((this.solidsInCell.get(c) ?? []).length) continue;
      for (let d = 0; d < 4; d++) {
        if (!this.open(c, d) && !this.doorOnEdge.has(this.edgeOf(c, d))) options.push({ c, d });
      }
    }
    const order: SupplyKind[] = ['battery', 'chalk', 'water'];
    const kinds = rng.shuffle(Array.from({ length: n }, (_, i) => order[i % 3]));
    const used: number[] = [];
    for (const kind of kinds) {
      // The spot furthest from every crate so far, out of a handful of tries.
      let best: { c: number; d: number } | null = null, bestD = -1;
      for (let t = 0; t < 30 && options.length; t++) {
        const o = rng.pick(options);
        if (used.includes(o.c)) continue;
        const d = used.length ? Math.min(...used.map((u) => Math.hypot(this.cx(u) - this.cx(o.c), this.cy(u) - this.cy(o.c)))) : 99;
        if (d > bestD) { bestD = d; best = o; }
      }
      if (!best) break;
      used.push(best.c);
      const nx = -DX[best.d], nz = -DY[best.d];
      const p = this.center(best.c);
      const x = p.x - nx * (CS / 2 - 0.4), z = p.z - nz * (CS / 2 - 0.4);
      const ry = Math.atan2(nx, nz);
      this.supplies.push({ id: this.supplies.length, kind, x, z, cell: best.c, ry });
      this.props.push({ type: 'crate', x, z, y: 0, ry, rx: 0, rz: 0, ceil: false, cell: best.c, v: 0 });
      this.addSolid({ x0: x - 0.32, z0: z - 0.32, x1: x + 0.32, z1: z + 0.32 });
    }
  }

  /** Puddles where the roof leaks, never in a doorway. */
  private placePuddles(rng: RNG) {
    const n = Math.min(MAX_PUDDLES, this.def.gen.puddles);
    for (let i = 0, tries = 0; i < n && tries < n * 10; tries++) {
      const c = rng.int(this.cells);
      if (this.exitCells.has(c) || this.doorCells[c] || this.zone[c] === Zone.Pool) continue;
      const p = this.center(c);
      const x = p.x + rng.range(-0.7, 0.7), z = p.z + rng.range(-0.7, 0.7);
      if (this.puddles.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 1)) continue;
      this.puddles.push({ x, z, r: rng.range(0.55, 1.25) });
      i++;
    }
  }

  /** Where a body comes out of a portal door. */
  portalExit(d: Door, r: number) {
    return { x: d.mx + d.nx * (r + 0.45), z: d.mz + d.nz * (r + 0.45) };
  }

  /** Could a jump from (ax, az) to (bx, bz) be someone stepping through an open portal? */
  portalJump(ax: number, az: number, bx: number, bz: number): Door | null {
    for (const d of this.doors) {
      if (d.kind !== 'portal' || d.link < 0) continue;
      const p = this.doors[d.link];
      if (Math.hypot(ax - d.mx, az - d.mz) > 1.6) continue;
      if (Math.hypot(bx - p.mx, bz - p.mz) > 1.6) continue;
      return d;
    }
    return null;
  }
}
