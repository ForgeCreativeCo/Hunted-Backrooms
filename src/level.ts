import { CFG } from './config';
import { RNG } from './rng';

// Directions: 0 = north (-z), 1 = east (+x), 2 = south (+z), 3 = west (-x).
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const OPP = [2, 3, 0, 1];

export interface Exit {
  cell: number;
  dir: number; // which border side the door is on
}

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
  exits: Exit[] = [];
  exitCells = new Set<number>();
  spawnCell = 0;
  monsterCell = 0;
  pillars: { x: number; z: number }[] = [];
  /** Bumped whenever a wall changes, so cached paths know to re-plan. */
  version = 0;

  constructor(seed: string) {
    this.walls = new Uint8Array(this.edgeCount).fill(1);
    this.circuit = new Int16Array(this.cells);
    this.panel = new Uint8Array(this.cells);
    this.generate(new RNG(seed));
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

  /** Grid line-of-sight between two world points, blocked by walls. */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    for (const hit of this.rayEdges(ax, az, bx - ax, bz - az, 1)) if (hit.wall) return false;
    return true;
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

  private generate(rng: RNG) {
    const { W, H } = this;

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

    // 2. Carve open rooms of different sizes.
    const rooms = 14;
    for (let i = 0; i < rooms; i++) {
      const rw = rng.int(2, 7), rh = rng.int(2, 6);
      const rx = rng.int(0, W - rw), ry = rng.int(0, H - rh);
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const c = this.cell(x, y);
          if (x < rx + rw - 1) this.walls[this.edgeOf(c, 1)] = 0;
          if (y < ry + rh - 1) this.walls[this.edgeOf(c, 2)] = 0;
        }
      }
    }

    // 3. Knock out some walls so there are loops, but keep plenty of dead ends.
    for (let k = 0; k < this.edgeCount; k++) {
      if (this.walls[k] && !this.isBorder(k) && rng.chance(0.22)) this.walls[k] = 0;
    }

    // 4. Pillars at grid corners where all four meeting edges are open.
    for (let vy = 1; vy < H; vy++) {
      for (let vx = 1; vx < W; vx++) {
        const a = this.cell(vx - 1, vy - 1), b = this.cell(vx, vy);
        const open = this.open(a, 1) && this.open(a, 2) && this.open(b, 0) && this.open(b, 3);
        if (open && rng.chance(0.3)) this.pillars.push({ x: vx * this.CS, z: vy * this.CS });
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
      this.panel[c] = (this.cx(c) + this.cy(c)) % 2 === 0 || rng.chance(0.2) ? 1 : 0;
    }

    // 6. Exits on the border, far apart.
    const borderCell = () => {
      const side = rng.int(4);
      const t = rng.int(1, (side % 2 === 0 ? W : H) - 1);
      const x = side === 1 ? W - 1 : side === 3 ? 0 : t;
      const y = side === 0 ? 0 : side === 2 ? H - 1 : t;
      return { cell: this.cell(x, y), dir: side };
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
  }
}
