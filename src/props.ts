import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Prop } from './level';

// Furniture and debris, built from simple shapes. Every part is baked into one
// merged geometry per material, so hundreds of props cost a handful of draw calls.

export type PropMat = 'wood' | 'laminate' | 'metal' | 'fabric' | 'plastic' | 'mattress' | 'skin' | 'paper' | 'dark' | 'screen' | 'shade';

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
