import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Prop } from './level';

// Furniture and debris, built from simple shapes. Every part is baked into one
// merged geometry per material, so hundreds of props cost a handful of draw calls.

export type PropMat = 'wood' | 'laminate' | 'metal' | 'fabric' | 'plastic' | 'mattress' | 'skin' | 'paper' | 'dark' | 'screen' | 'shade'
  | 'sidingBlue' | 'sidingGrey' | 'sidingRed' | 'white' | 'roof' | 'glass' | 'red' | 'cardboard' | 'rust';

const SIDING: PropMat[] = ['sidingBlue', 'sidingGrey', 'sidingRed'];

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

class Builder {
  parts = new Map<PropMat, THREE.BufferGeometry[]>();
  /** Current prop's world transform; parts are placed relative to it. */
  base = new THREE.Matrix4();

  add(mat: PropMat, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    tmpE.set(rx, ry, rz);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    geo.applyMatrix4(tmpM.premultiply(this.base));
    const list = this.parts.get(mat) ?? [];
    list.push(geo);
    this.parts.set(mat, list);
  }

  box(mat: PropMat, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.add(mat, new THREE.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz);
  }

  cyl(mat: PropMat, r0: number, r1: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, open = false) {
    this.add(mat, new THREE.CylinderGeometry(r0, r1, h, 10, 1, open), x, y, z, rx, ry, rz);
  }

  ball(mat: PropMat, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    this.add(mat, new THREE.SphereGeometry(1, 12, 9), x, y, z, 0, 0, 0, sx, sy, sz);
  }
}

function chair(b: Builder) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box('metal', 0.04, 0.03, 0.3, Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15, 0, a, 0);
    b.ball('dark', Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29, 0.03, 0.03, 0.03);
  }
  b.cyl('metal', 0.025, 0.025, 0.34, 0, 0.25, 0);
  b.box('fabric', 0.48, 0.08, 0.46, 0, 0.45, 0);
  b.box('metal', 0.04, 0.26, 0.03, 0, 0.56, -0.22);
  b.box('fabric', 0.44, 0.5, 0.07, 0, 0.8, -0.23, -0.1);
}

function crt(b: Builder, y: number) {
  b.box('plastic', 0.42, 0.36, 0.38, 0, y + 0.18, 0);
  b.box('plastic', 0.3, 0.27, 0.2, 0, y + 0.17, -0.27);
  b.box('screen', 0.33, 0.26, 0.012, 0, y + 0.19, 0.192);
}

function desk(b: Builder, v: number) {
  b.box(v === 2 ? 'wood' : 'laminate', 1.4, 0.04, 0.72, 0, 0.74, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', 0.04, 0.72, 0.04, sx * 0.66, 0.36, sz * 0.32);
  if (v !== 2) b.box('laminate', 1.3, 0.4, 0.02, 0, 0.5, -0.33);
  if (v === 1) crt(b, 0.76);
  if (v === 2) {
    // Places set for two. Nobody is coming.
    for (const sx of [-1, 1]) {
      b.cyl('paper', 0.13, 0.11, 0.015, sx * 0.45, 0.768, 0);
      b.box('metal', 0.015, 0.004, 0.18, sx * 0.45 - 0.17, 0.762, 0);
      b.box('metal', 0.015, 0.004, 0.18, sx * 0.45 + 0.17, 0.762, 0);
      b.cyl('paper', 0.035, 0.03, 0.12, sx * 0.3, 0.82, -0.18);
    }
  }
}

function cabinet(b: Builder) {
  b.box('metal', 0.45, 1.3, 0.6, 0, 0.65, 0);
  for (let i = 0; i < 4; i++) {
    b.box('dark', 0.4, 0.27, 0.012, 0, 0.18 + i * 0.31, 0.302);
    b.box('metal', 0.12, 0.025, 0.03, 0, 0.26 + i * 0.31, 0.315);
  }
}

function mattress(b: Builder) {
  // Standing on end, leaning back against the wall.
  b.box('mattress', 0.95, 1.9, 0.18, 0, 0.94, 0, -0.14);
}

function lamp(b: Builder) {
  b.cyl('dark', 0.15, 0.16, 0.03, 0, 0.015, 0);
  b.cyl('metal', 0.012, 0.012, 1.45, 0, 0.75, 0);
  // Still lit, whether or not the power is.
  b.cyl('shade', 0.12, 0.2, 0.28, 0, 1.52, 0, 0, 0, 0, true);
}

function phone(b: Builder) {
  b.box('dark', 0.2, 0.07, 0.22, 0, 0.035, 0);
  b.box('dark', 0.23, 0.05, 0.06, 0, 0.09, 0.02, 0, 0, 0.08);
  b.cyl('dark', 0.006, 0.006, 0.6, 0.25, 0.006, 0.1, 0, 0.5, Math.PI / 2);
}

function mannequin(b: Builder) {
  for (const s of [-1, 1]) {
    b.cyl('skin', 0.065, 0.045, 0.86, s * 0.09, 0.43, 0);
    b.cyl('skin', 0.045, 0.035, 0.66, s * 0.185, 1.11, 0.02, 0, 0, s * 0.015);
  }
  b.ball('skin', 0, 0.9, 0, 0.17, 0.11, 0.11);
  b.add('skin', new THREE.CylinderGeometry(0.15, 0.13, 0.56, 12), 0, 1.18, 0, 0, 0, 0, 1, 1, 0.7);
  b.ball('skin', 0, 1.45, 0, 0.21, 0.07, 0.1);
  b.cyl('skin', 0.04, 0.045, 0.1, 0, 1.53, 0);
  // No face, and the head tilted just slightly too far.
  b.add('skin', new THREE.SphereGeometry(1, 12, 9), 0.02, 1.665, 0.01, 0.08, 0, 0.32, 0.095, 0.125, 0.11);
}

function stairs(b: Builder, ceil: number) {
  // Nine steps along the wall, rising until they go straight through the ceiling.
  const n = 9, run = 0.28, rise = (ceil + 0.4) / n;
  for (let i = 0; i < n; i++) {
    const h = (i + 1) * rise;
    b.box('wood', run, h, 0.95, -1.26 + i * run + run / 2, h / 2, 0);
    b.box('fabric', run + 0.002, 0.01, 0.8, -1.26 + i * run + run / 2, h + 0.005, 0);
  }
}

function speaker(b: Builder) {
  // An old PA horn on a rod, built hanging down from the ceiling (+y is down).
  b.box('metal', 0.2, 0.02, 0.2, 0, 0.01, 0);
  b.cyl('metal', 0.014, 0.014, 0.36, 0, 0.19, 0);
  // Horn axis pointing outwards and down, 60° from the rod.
  const tilt = Math.PI / 3, ay = Math.cos(tilt), az = Math.sin(tilt);
  const dy = 0.42;
  b.cyl('dark', 0.075, 0.075, 0.14, 0, dy - ay * 0.04, -az * 0.04, tilt);
  b.cyl('metal', 0.25, 0.065, 0.38, 0, dy + ay * 0.22, az * 0.22, tilt, 0, 0, true);
  b.cyl('dark', 0.06, 0.06, 0.01, 0, dy + ay * 0.04, az * 0.04, tilt);
}

/**
 * A one-storey house front, built against a wall: local z = 0 is the wall and
 * +z the street. Only 0.85 m deep, like a film set, but its roof reaches out
 * over the pavement so it reads as a whole house. v: siding colour (0..2), and
 * bit 4 mirrors it (garage on the other side).
 */
function house(b: Builder, v: number) {
  const W = 5.3, H = 2.9, D = 0.85;
  const siding = SIDING[(v & 3) % 3];
  const m = v & 4 ? -1 : 1;
  b.box(siding, W, H, D, 0, H / 2, D / 2);
  // Gable wall behind the roof slope, so there's no gap to see through.
  b.box(siding, W, 0.9, 0.3, 0, H + 0.45, 0.15);
  // Roof: one long slope from high at the wall to the eaves over the pavement.
  const run = 1.65, rise = 1.15, len = Math.hypot(run, rise);
  b.box('roof', W + 0.5, 0.09, len, 0, H + rise / 2 + 0.05, run / 2, Math.atan2(rise, run));
  b.box('white', W + 0.5, 0.2, 0.05, 0, H - 0.02, run + 0.01); // fascia
  for (const s of [-1, 1]) b.box('white', 0.1, H, 0.06, s * (W / 2 - 0.05), H / 2, D + 0.01); // corner boards
  // Garage: a white sectional door with a row of small windows.
  const gx = -m * 1.15;
  b.box('white', 2.7, 2.25, 0.05, gx, 1.125, D + 0.02);
  for (let i = 1; i < 4; i++) b.box('roof', 2.66, 0.02, 0.01, gx, i * 0.56, D + 0.05);
  for (let i = 0; i < 4; i++) b.box('glass', 0.5, 0.2, 0.01, gx - 0.96 + i * 0.64, 1.86, D + 0.05);
  b.box('white', 2.95, 0.12, 0.08, gx, 2.31, D + 0.03);
  // Front door with a step, and a window beside it.
  const dx = m * 1.05;
  b.box('white', 1.06, 2.2, 0.06, dx, 1.1, D + 0.01);
  b.box('dark', 0.9, 2.05, 0.04, dx, 1.05, D + 0.04);
  b.box('metal', 0.05, 0.05, 0.05, dx + m * 0.34, 1.0, D + 0.08);
  b.box('laminate', 1.2, 0.12, 0.35, dx, 0.06, D + 0.17);
  const wx = m * 2.0;
  b.box('white', 0.8, 1.1, 0.06, wx, 1.55, D + 0.01);
  b.box('glass', 0.66, 0.96, 0.04, wx, 1.55, D + 0.04);
  b.box('white', 0.66, 0.04, 0.05, wx, 1.55, D + 0.06);
  // A light by the door that's never on.
  b.box('dark', 0.1, 0.18, 0.08, dx - m * 0.62, 1.85, D + 0.05);
}

/**
 * The house you can walk through: the full two cells wide, its front door
 * standing open on a short, narrow hall that runs straight to the back door in
 * the wall behind. Bit 16 of v puts the door on local +x (else -x), half a cell
 * from the centre, so it lines up with that wall's doorway.
 */
function houseThrough(b: Builder, v: number) {
  const W = 6, H = 2.9, D = 0.85, DH = 2.2, half = 0.5;
  const siding = SIDING[(v & 3) % 3];
  const s = v & 16 ? 1 : -1;
  const dx = s * 1.5;
  // The body in three pieces around the doorway.
  const left = dx - half + W / 2, right = W / 2 - (dx + half);
  b.box(siding, left, H, D, -W / 2 + left / 2, H / 2, D / 2);
  b.box(siding, right, H, D, W / 2 - right / 2, H / 2, D / 2);
  b.box(siding, half * 2, H - DH, D, dx, DH + (H - DH) / 2, D / 2);
  b.box(siding, W, 0.9, 0.3, 0, H + 0.45, 0.15);
  const run = 1.65, rise = 1.15, len = Math.hypot(run, rise);
  b.box('roof', W + 0.3, 0.09, len, 0, H + rise / 2 + 0.05, run / 2, Math.atan2(rise, run));
  b.box('white', W + 0.3, 0.2, 0.05, 0, H - 0.02, run + 0.01);
  for (const e of [-1, 1]) b.box('white', 0.1, H, 0.06, e * (W / 2 - 0.05), H / 2, D + 0.01);
  // The hall inside: faded wallpaper, a stained ceiling, worn carpet.
  for (const e of [-1, 1]) b.box('mattress', 0.02, DH, D + 0.08, dx + e * (half - 0.01), DH / 2, D / 2 - 0.04);
  b.box('paper', half * 2, 0.02, D + 0.08, dx, DH - 0.01, D / 2 - 0.04);
  b.box('fabric', half * 2, 0.01, D + 0.08, dx, 0.005, D / 2 - 0.04);
  // The front door frame, its door gone. A doormat says nothing.
  for (const e of [-1, 1]) b.box('white', 0.08, DH + 0.06, 0.08, dx + e * (half + 0.04), (DH + 0.06) / 2, D + 0.01);
  b.box('white', half * 2 + 0.16, 0.08, 0.08, dx, DH + 0.04, D + 0.01);
  b.box('laminate', 1.2, 0.12, 0.35, dx, 0.06, D + 0.17);
  b.box('fabric', 0.7, 0.012, 0.25, dx, 0.126, D + 0.17);
  // Garage on the other side, a window between.
  const gx = -s * 1.35;
  b.box('white', 2.7, 2.25, 0.05, gx, 1.125, D + 0.02);
  for (let i = 1; i < 4; i++) b.box('roof', 2.66, 0.02, 0.01, gx, i * 0.56, D + 0.05);
  for (let i = 0; i < 4; i++) b.box('glass', 0.5, 0.2, 0.01, gx - 0.96 + i * 0.64, 1.86, D + 0.05);
  b.box('white', 2.95, 0.12, 0.08, gx, 2.31, D + 0.03);
  const wx = s * 0.5;
  b.box('white', 0.7, 1.1, 0.06, wx, 1.55, D + 0.01);
  b.box('glass', 0.56, 0.96, 0.04, wx, 1.55, D + 0.04);
  b.box('dark', 0.1, 0.18, 0.08, dx + s * 0.65, 1.85, D + 0.05);
}

/** A white picket fence `len` metres long, centred on the origin, running along x. */
function fence(b: Builder, len: number) {
  for (const y of [0.3, 0.75]) b.box('white', len, 0.06, 0.03, 0, y, -0.02);
  const n = Math.max(1, Math.round(len / 0.13));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    b.box('white', 0.08, 0.95, 0.02, x, 0.475, 0.01);
    b.box('white', 0.057, 0.057, 0.02, x, 0.95, 0.01, 0, 0, Math.PI / 4);
  }
}

function mailbox(b: Builder) {
  b.box('wood', 0.08, 1.05, 0.08, 0, 0.525, 0);
  b.box('wood', 0.14, 0.04, 0.4, 0, 1.06, 0.05);
  b.box('metal', 0.18, 0.15, 0.42, 0, 1.15, 0.05);
  b.cyl('metal', 0.09, 0.09, 0.42, 0, 1.22, 0.05, Math.PI / 2);
  b.box('red', 0.02, 0.16, 0.03, 0.1, 1.3, -0.06); // the flag, up: there's mail
}

function fan(b: Builder) {
  // Hanging from the ceiling (+y is down): a long rod, a motor, five wide blades.
  b.cyl('metal', 0.02, 0.02, 1.0, 0, 0.5, 0);
  b.cyl('dark', 0.16, 0.2, 0.18, 0, 1.08, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box('dark', 0.2, 0.015, 1.35, Math.sin(a) * 0.82, 1.12, Math.cos(a) * 0.82, 0.06, a, 0);
  }
}

function stopSign(b: Builder) {
  b.box('metal', 0.05, 2.2, 0.05, 0, 1.1, 0);
  b.add('white', new THREE.CylinderGeometry(0.33, 0.33, 0.02, 8), 0, 2.3, 0.04, Math.PI / 2, Math.PI / 8, 0);
  b.add('red', new THREE.CylinderGeometry(0.3, 0.3, 0.02, 8), 0, 2.3, 0.05, Math.PI / 2, Math.PI / 8, 0);
}

function crate(b: Builder) {
  // An open wooden crate, its lid leaning against the wall behind it.
  b.box('wood', 0.6, 0.04, 0.55, 0, 0.02, 0);
  for (const s of [-1, 1]) {
    b.box('wood', 0.6, 0.42, 0.03, 0, 0.25, s * 0.26);
    b.box('wood', 0.03, 0.42, 0.55, s * 0.285, 0.25, 0);
    // Corner battens.
    b.box('wood', 0.05, 0.44, 0.05, s * 0.29, 0.24, 0.265);
    b.box('wood', 0.05, 0.44, 0.05, s * 0.29, 0.24, -0.265);
  }
  // Straw packing, and a stencilled stripe on the front.
  b.box('cardboard', 0.54, 0.02, 0.49, 0, 0.36, 0);
  b.box('dark', 0.34, 0.06, 0.005, 0, 0.32, 0.278);
  b.box('wood', 0.62, 0.56, 0.025, 0, 0.6, -0.34, -0.14);
}

function cardboardBox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, ry: number) {
  b.box('cardboard', w, h, d, x, y + h / 2, z, 0, ry);
  // Packing tape across the top.
  b.box('plastic', w + 0.004, 0.004, 0.06, x, y + h + 0.002, z, 0, ry);
}

function pallet(b: Builder, layers: number) {
  // A wooden pallet: three runners and a slatted deck, with boxes stacked on it.
  for (const z of [-0.45, 0, 0.45]) b.box('wood', 1.2, 0.1, 0.1, 0, 0.05, z);
  for (let i = 0; i < 7; i++) b.box('wood', 0.12, 0.022, 1.0, -0.54 + i * 0.18, 0.111, 0);
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < 4; i++) {
      const j = Math.sin((l * 4 + i) * 12.9898) * 0.5;
      cardboardBox(b, 0.56, 0.4, 0.46, (i % 2 ? 0.29 : -0.29) + j * 0.03, 0.122 + l * 0.4, (i < 2 ? -0.24 : 0.24) + j * 0.02, j * 0.12);
    }
  }
}

function boxes(b: Builder, n: number) {
  // A careless tower of boxes, and one that fell off.
  for (let i = 0; i < n; i++) {
    const j = Math.sin(i * 78.233) * 0.5;
    cardboardBox(b, 0.75 - i * 0.04, 0.5, 0.62 - i * 0.03, j * 0.08, i * 0.5, j * 0.06, j * 0.5);
  }
  cardboardBox(b, 0.5, 0.36, 0.42, 0.7, 0, 0.35, 0.6);
}

function pipes(b: Builder, v: number) {
  // Runs along the wall (local x), held off it by brackets.
  const runs: [number, number, PropMat][] = [[0.32, 0.11, 'rust'], [1.72, 0.05, 'metal'], [2.08, 0.08, 'rust']];
  runs.forEach(([y, r, mat], i) => {
    if (!(v & (1 << i))) return;
    b.cyl(mat, r, r, 3.04, 0, y, r + 0.02, 0, 0, Math.PI / 2);
    for (const x of [-1, 1]) b.box('dark', 0.04, r * 2.4, r + 0.04, x, y, (r + 0.04) / 2);
  });
}

function valve(b: Builder) {
  // A stub of pipe out of the wall, a valve wheel, and a nozzle the steam comes out of.
  b.cyl('rust', 0.08, 0.08, 0.36, 0, 1.3, 0.18, Math.PI / 2);
  b.cyl('rust', 0.11, 0.11, 0.06, 0, 1.3, 0.38, Math.PI / 2);
  b.cyl('metal', 0.03, 0.03, 0.22, 0, 1.47, 0.18);
  b.add('red', new THREE.TorusGeometry(0.1, 0.014, 6, 16), 0, 1.58, 0.18, Math.PI / 2);
}

export function buildProps(props: Prop[]): Map<PropMat, THREE.BufferGeometry> {
  const b = new Builder();
  const flip = new THREE.Matrix4().makeRotationX(Math.PI);
  for (const p of props) {
    tmpE.set(0, p.ry, 0);
    b.base.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE), tmpS.set(1, 1, 1));
    if (p.ceil) b.base.multiply(flip);
    if (p.rx || p.rz) {
      // Knocked over: tip about the base, then lift so it lies on the floor.
      const lift = p.type === 'chair' ? 0.27 : p.type === 'cabinet' ? 0.23 : 0;
      const shift = p.type === 'cabinet' ? 0.65 : 0;
      b.base.multiply(tmpM.makeTranslation(shift, lift, 0));
      b.base.multiply(tmpM.makeRotationFromEuler(tmpE.set(p.rx, 0, p.rz)));
    }
    switch (p.type) {
      case 'chair': chair(b); break;
      case 'desk': desk(b, p.v); break;
      case 'cabinet': cabinet(b); break;
      case 'crt': crt(b, 0); break;
      case 'mattress': mattress(b); break;
      case 'lamp': lamp(b); break;
      case 'phone': phone(b); break;
      case 'mannequin':
        b.base.multiply(tmpM.makeScale(1, 1.13, 1)); // a little too tall
        mannequin(b);
        break;
      case 'stairs': stairs(b, p.v / 10); break;
      case 'paper': b.box('paper', 0.21, 0.002, 0.297, 0, 0, 0); break;
      case 'speaker': speaker(b); break;
      case 'house': if (p.v & 8) houseThrough(b, p.v); else house(b, p.v); break;
      case 'fence': fence(b, p.v / 100); break;
      case 'mailbox': mailbox(b); break;
      case 'fan': fan(b); break;
      case 'stop': stopSign(b); break;
      case 'crate': crate(b); break;
      case 'pallet': pallet(b, p.v); break;
      case 'boxes': boxes(b, p.v); break;
      case 'pipes': pipes(b, p.v); break;
      case 'valve': valve(b); break;
    }
  }
  const out = new Map<PropMat, THREE.BufferGeometry>();
  for (const [mat, geos] of b.parts) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) out.set(mat, merged);
  }
  return out;
}
