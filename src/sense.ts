import { CFG } from './config';
import { Game } from './game';

export type Aim = 'none' | 'blackout' | 'shift';

/** Top-down sense view: a dark map revealed by sound. */
export class SenseView {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  mouse: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private game: Game) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = this.game.level;
    const mw = L.W * L.CS, mh = L.H * L.CS;
    const padX = 40, padTop = 70, padBottom = 120;
    this.scale = Math.min((window.innerWidth - padX * 2) / mw, (window.innerHeight - padTop - padBottom) / mh);
    this.ox = (window.innerWidth - mw * this.scale) / 2;
    this.oy = padTop + (window.innerHeight - padTop - padBottom - mh * this.scale) / 2;
  }

  toWorld(px: number, py: number) {
    return { x: (px - this.ox) / this.scale, z: (py - this.oy) / this.scale };
  }

  private sx(x: number) { return this.ox + x * this.scale; }
  private sy(z: number) { return this.oy + z * this.scale; }

  /** Nearest edge to a world point, within reach of the cursor. */
  pickEdge(wx: number, wz: number): number {
    const L = this.game.level;
    if (wx < 0 || wz < 0 || wx >= L.W * L.CS || wz >= L.H * L.CS) return -1;
    const c = L.cellAt(wx, wz);
    const fx = wx / L.CS - L.cx(c), fz = wz / L.CS - L.cy(c);
    const d = [fz, 1 - fx, 1 - fz, fx];
    let best = 0;
    for (let i = 1; i < 4; i++) if (d[i] < d[best]) best = i;
    return d[best] < 0.3 ? L.edgeOf(c, best) : -1;
  }

  pickCircuit(wx: number, wz: number): number {
    const L = this.game.level;
    if (wx < 0 || wz < 0 || wx >= L.W * L.CS || wz >= L.H * L.CS) return -1;
    return L.circuit[L.cellAt(wx, wz)];
  }

  /** spectate: a caught or escaped human watching; shows everyone where they really are. */
  draw(t: number, aim: Aim, circuitLevel: (i: number) => number, spectate = false) {
    const g = this.game;
    const L = g.level;
    const ctx = this.ctx;
    const CS = L.CS, s = this.scale;
    ctx.fillStyle = '#040404';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const hover = this.mouse ? this.toWorld(this.mouse.x, this.mouse.y) : null;
    const hoverCircuit = aim === 'blackout' && hover ? this.pickCircuit(hover.x, hover.z) : -1;

    // Cells: faint warm where lit, cold where dark.
    for (let c = 0; c < L.cells; c++) {
      const lvl = circuitLevel(L.circuit[c]);
      ctx.fillStyle = lvl > 0.5 ? 'rgba(190,165,80,0.10)' : 'rgba(40,60,110,0.10)';
      if (L.circuit[c] === hoverCircuit) ctx.fillStyle = g.blackout[hoverCircuit] > 0 || L.dead[hoverCircuit] ? 'rgba(120,120,120,0.18)' : 'rgba(255,70,50,0.22)';
      ctx.fillRect(this.sx(L.cx(c) * CS) + 1, this.sy(L.cy(c) * CS) + 1, CS * s - 2, CS * s - 2);
    }

    // Walls.
    ctx.strokeStyle = 'rgba(215,190,120,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < L.edgeCount; k++) {
      if (!L.isWall(k)) continue;
      const e = L.edgeSegment(k);
      ctx.moveTo(this.sx(e.x1), this.sy(e.z1));
      ctx.lineTo(this.sx(e.x2), this.sy(e.z2));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(215,190,120,0.5)';
    for (const p of L.pillars) ctx.fillRect(this.sx(p.x) - 3, this.sy(p.z) - 3, 6, 6);

    // Furniture, faintly.
    ctx.strokeStyle = 'rgba(170,160,140,0.28)';
    ctx.lineWidth = 1;
    for (const b of L.solids) ctx.strokeRect(this.sx(b.x0), this.sy(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
    // The Pitfalls' holes, as black as they are.
    ctx.fillStyle = '#000';
    for (const { hole: b } of L.pits) ctx.fillRect(this.sx(b.x0), this.sy(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);

    // Doors: doorways in brown, doors to nowhere as small ticks, portals in violet with their links.
    for (const d of L.doors) {
      const ax = d.mx - d.tx * d.w / 2, az = d.mz - d.tz * d.w / 2;
      const bx = d.mx + d.tx * d.w / 2, bz = d.mz + d.tz * d.w / 2;
      const inset = d.kind === 'swing' ? 0 : 0.25;
      ctx.lineWidth = 4;
      ctx.strokeStyle = d.kind === 'swing' ? (d.open ? 'rgba(170,120,70,0.45)' : '#b0784a')
        : d.kind === 'portal' ? '#b07cff' : d.open ? 'rgba(150,150,150,0.4)' : 'rgba(170,170,170,0.8)';
      ctx.setLineDash(d.open && d.kind === 'swing' ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(this.sx(ax + d.nx * inset), this.sy(az + d.nz * inset));
      ctx.lineTo(this.sx(bx + d.nx * inset), this.sy(bz + d.nz * inset));
      ctx.stroke();
      ctx.setLineDash([]);
      if (d.kind === 'portal' && d.link > d.id) {
        const p = L.doors[d.link];
        ctx.strokeStyle = 'rgba(176,124,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(this.sx(d.mx), this.sy(d.mz));
        ctx.lineTo(this.sx(p.mx), this.sy(p.mz));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Exits.
    for (const e of L.exits) {
      const k = L.edgeOf(e.cell, e.dir);
      const seg = L.edgeSegment(k);
      ctx.strokeStyle = '#4dff6e';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(this.sx(seg.x1), this.sy(seg.z1));
      ctx.lineTo(this.sx(seg.x2), this.sy(seg.z2));
      ctx.stroke();
      const p = L.center(e.cell);
      ctx.fillStyle = '#4dff6e';
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('EXIT', this.sx(p.x), this.sy(p.z) + 3);
    }

    // Chalk marks glow.
    ctx.save();
    ctx.shadowColor = '#cfe8ff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#eaf4ff';
    ctx.lineWidth = 2;
    for (const [cell, mark] of g.chalk) {
      const p = L.center(cell);
      const dx = [0, 1, 0, -1][mark.dir], dz = [-1, 0, 1, 0][mark.dir];
      const x = this.sx(p.x), y = this.sy(p.z), r = CS * s * 0.3;
      ctx.beginPath();
      ctx.moveTo(x - dx * r, y - dz * r);
      ctx.lineTo(x + dx * r, y + dz * r);
      ctx.lineTo(x + dx * r * 0.4 - dz * r * 0.5, y + dz * r * 0.4 + dx * r * 0.5);
      ctx.moveTo(x + dx * r, y + dz * r);
      ctx.lineTo(x + dx * r * 0.4 + dz * r * 0.5, y + dz * r * 0.4 - dx * r * 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Sound pulses.
    for (const p of g.pulses) {
      const k = p.age / p.life;
      const r = 4 + p.maxR * s * k;
      const red = Math.round(255), gb = Math.round(255 - p.fear * 2.1);
      ctx.strokeStyle = `rgba(${red},${gb},${gb},${(1 - k) * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.sx(p.x), this.sy(p.z), r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Wanderers, as last heard.
    ctx.textAlign = 'center';
    for (const w of g.wanderers) {
      if (!w.active) continue;
      const since = spectate ? 0 : g.t - w.lastHeardT;
      const x = this.sx(spectate ? w.x : w.heardX), y = this.sy(spectate ? w.z : w.heardZ);
      const a = Math.max(0.15, 1 - since / 4);
      if (since > 4) {
        ctx.fillStyle = 'rgba(200,200,200,0.35)';
        ctx.font = '600 12px ui-monospace, monospace';
        ctx.fillText('?', x, y + 4);
        continue;
      }
      const gb = Math.round(255 - w.fear * 2.1);
      ctx.fillStyle = `rgba(255,${gb},${gb},${a})`;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      // Fear ring: the arc fills as fear rises.
      ctx.strokeStyle = `rgba(255,${gb},${gb},${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 10, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * w.fear) / 100);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(230,230,230,${a * 0.9})`;
      ctx.font = '11px ui-monospace, monospace';
      const tag = w.state === 'hide' ? ' · hiding' : w.state === 'panic' ? ' · PANIC' : w.state === 'escape' ? ' · → exit' : '';
      if (spectate && w.flash) {
        // Their flashlight beam.
        ctx.fillStyle = 'rgba(255,230,150,0.12)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, 10 * s, w.heading - 0.37, w.heading + 0.37);
        ctx.fill();
      }
      ctx.fillText(`${w.name} ${Math.round(w.fear)}${tag}`, x, y - 15);
      if (w.sees) {
        ctx.strokeStyle = 'rgba(255,60,60,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(this.sx(g.monster.x), this.sy(g.monster.z));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // The monster.
    const m = g.monster;
    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    const mx = this.sx(m.x), my = this.sy(m.z);
    ctx.fillStyle = m.seepT > 0 ? '#b07cff' : '#ff3b3b';
    ctx.beginPath();
    ctx.moveTo(mx + fx * 11, my + fz * 11);
    ctx.lineTo(mx - fx * 6 - fz * 7, my - fz * 6 + fx * 7);
    ctx.lineTo(mx - fx * 6 + fz * 7, my - fz * 6 - fx * 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,59,59,${0.25 + 0.15 * Math.sin(t * 4)})`;
    ctx.beginPath();
    ctx.arc(mx, my, CFG.CATCH_REACH * s, 0, Math.PI * 2);
    ctx.stroke();

    // Aiming.
    if (aim === 'shift' && hover) {
      const key = this.pickEdge(hover.x, hover.z);
      if (key >= 0) {
        const err = g.shiftCheck(key);
        const seg = L.edgeSegment(key);
        ctx.strokeStyle = err ? '#ff4040' : '#7dffb0';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(this.sx(seg.x1), this.sy(seg.z1));
        ctx.lineTo(this.sx(seg.x2), this.sy(seg.z2));
        ctx.stroke();
        this.tooltip(err ?? (L.isWall(key) ? `Open this wall · ${CFG.SHIFT_COST} dread` : `Wall off this gap · ${CFG.SHIFT_COST} dread`), !err);
      }
    } else if (aim === 'blackout' && hoverCircuit >= 0) {
      const err = g.blackout[hoverCircuit] > 0 || L.dead[hoverCircuit] ? 'Already dark' : g.dread < CFG.BLACKOUT_COST ? 'Not enough dread' : null;
      this.tooltip(err ?? `Blackout this circuit · ${CFG.BLACKOUT_COST} dread`, !err);
    }
  }

  private tooltip(text: string, ok: boolean) {
    if (!this.mouse) return;
    const ctx = this.ctx;
    ctx.font = '12px ui-monospace, monospace';
    const w = ctx.measureText(text).width + 14;
    const x = Math.min(this.mouse.x + 14, window.innerWidth - w - 4), y = this.mouse.y + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, 22);
    ctx.strokeStyle = ok ? '#7dffb0' : '#ff4040';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 21);
    ctx.fillStyle = ok ? '#c8ffe0' : '#ffb0b0';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 7, y + 15);
  }
}
