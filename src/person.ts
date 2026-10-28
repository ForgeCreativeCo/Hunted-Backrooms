import * as THREE from 'three';
import { Wanderer } from './game';
import { hashString, RNG } from './rng';
import * as T from './textures';

// A procedural, articulated human. Model faces +z, its left is +x.
// Joint rotation.x > 0 swings a hanging limb backwards; < 0 swings it forwards.

const SKIN = [0xf1c7a5, 0xe0ac87, 0xc68a62, 0x9a6545, 0x6e4630];
const HAIR = [0x2a1d14, 0x4a3020, 0x7a5532, 0x111111, 0xb08a58, 0x5c5048];

interface Outfit {
  shirt: number;
  sleeve: 'long' | 'short';
  pants: number;
  shoes: number;
  extra: 'tie' | 'hood' | 'backpack' | 'lanyard';
}

const OUTFITS: Record<'panicker' | 'mapper', Outfit[]> = {
  panicker: [
    { shirt: 0xdfe5ea, sleeve: 'long', pants: 0x2c2f38, shoes: 0x1a1512, extra: 'tie' },
    { shirt: 0x5d6168, sleeve: 'long', pants: 0x34465e, shoes: 0xd8d6d0, extra: 'hood' },
    { shirt: 0x8a2f2f, sleeve: 'short', pants: 0x3d3a33, shoes: 0x2a2420, extra: 'lanyard' },
    { shirt: 0xb5c6d8, sleeve: 'short', pants: 0x6b5c45, shoes: 0x3b2a1e, extra: 'lanyard' },
  ],
  mapper: [
    { shirt: 0x55603f, sleeve: 'long', pants: 0x8a7a5a, shoes: 0x4a3a28, extra: 'backpack' },
    { shirt: 0x7a5236, sleeve: 'long', pants: 0x404650, shoes: 0x2b2b2b, extra: 'backpack' },
  ],
};

type Joint = 'hipsY' | 'hipsYaw' | 'spineX' | 'spineZ' | 'chestYaw' | 'neckX' | 'headY' | 'headX'
  | 'lShX' | 'lShZ' | 'rShX' | 'rShZ' | 'lElX' | 'rElX' | 'lHipX' | 'rHipX' | 'lHipZ' | 'rHipZ' | 'lKnX' | 'rKnX' | 'breath';

const JOINTS: Joint[] = ['hipsY', 'hipsYaw', 'spineX', 'spineZ', 'chestYaw', 'neckX', 'headY', 'headX',
  'lShX', 'lShZ', 'rShX', 'rShZ', 'lElX', 'rElX', 'lHipX', 'rHipX', 'lHipZ', 'rHipZ', 'lKnX', 'rKnX', 'breath'];

const HIP_H = 0.93;
let shadowTex: THREE.Texture | null = null;

export class Person {
  root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private lSh = new THREE.Group();
  private rSh = new THREE.Group();
  private lEl = new THREE.Group();
  private rEl = new THREE.Group();
  private lHip = new THREE.Group();
  private rHip = new THREE.Group();
  private lKn = new THREE.Group();
  private rKn = new THREE.Group();
  private shadow: THREE.Mesh;
  private pose: Record<Joint, number>;
  private phase = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private seed: number;
  /** Ambient light reaching this person: 0 in a blacked-out circuit. */
  bright = { value: 1 };

  constructor(w: Wanderer) {
    this.seed = hashString(w.name);
    const rng = new RNG(this.seed);
    const outfit = rng.pick(OUTFITS[w.kind]);
    const skin = this.mat(rng.pick(SKIN), 0.65);
    const hairM = this.mat(rng.pick(HAIR), 0.9);
    const shirt = this.mat(outfit.shirt, 0.85);
    const pants = this.mat(outfit.pants, 0.9);
    const shoes = this.mat(outfit.shoes, 0.6);
    const height = rng.range(0.94, 1.06);
    const build = rng.range(0.92, 1.12);
    this.root.scale.set(build, height, build);

    this.pose = Object.fromEntries(JOINTS.map((j) => [j, 0])) as Record<Joint, number>;
    this.pose.hipsY = HIP_H;

    // Hips and pelvis.
    this.root.add(this.hips);
    this.hips.position.y = HIP_H;
    this.hips.add(this.part(new THREE.SphereGeometry(1, 16, 12), pants, [0, -0.02, 0], [0.17, 0.12, 0.11]));

    // Torso.
    this.hips.add(this.spine);
    this.spine.position.y = 0.06;
    const torso = this.part(new THREE.CapsuleGeometry(0.15, 0.26, 6, 16), shirt, [0, 0.2, 0], [1.2, 1, 0.72]);
    this.spine.add(torso);
    this.spine.add(this.chest);
    this.chest.position.y = 0.38;
    // Shoulders/upper chest volume.
    this.chest.add(this.part(new THREE.SphereGeometry(1, 16, 12), shirt, [0, -0.02, -0.005], [0.21, 0.09, 0.12]));

    // Neck and head.
    this.chest.add(this.neck);
    this.neck.position.y = 0.04;
    this.neck.add(this.part(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 10), skin, [0, 0.04, 0]));
    this.neck.add(this.head);
    this.head.position.y = 0.17;
    this.head.add(this.part(new THREE.SphereGeometry(1, 20, 16), skin, [0, 0, 0.005], [0.093, 0.118, 0.105]));
    // Jaw, nose, ears: just enough to read which way they're facing.
    this.head.add(this.part(new THREE.SphereGeometry(1, 12, 10), skin, [0, -0.06, 0.03], [0.07, 0.05, 0.07]));
    this.head.add(this.part(new THREE.ConeGeometry(0.016, 0.04, 6), skin, [0, -0.005, 0.105], [1, 1, 1], [Math.PI / 2, 0, 0]));
    for (const s of [-1, 1]) {
      this.head.add(this.part(new THREE.SphereGeometry(1, 8, 6), skin, [s * 0.092, -0.005, 0], [0.012, 0.028, 0.02]));
      // Eye sockets: dark hollows, unsettling in the grain.
      this.head.add(this.part(new THREE.SphereGeometry(1, 8, 6), this.mat(0x1a1310, 0.4), [s * 0.033, 0.012, 0.094], [0.016, 0.01, 0.008]));
    }
    // Hair cap.
    const hairStyle = rng.int(3);
    const hair = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, hairStyle === 2 ? Math.PI * 0.62 : Math.PI * 0.5);
    this.head.add(this.part(hair, hairM, [0, 0.012, -0.008], [0.1, 0.125, 0.112]));
    if (hairStyle === 1) this.head.add(this.part(new THREE.SphereGeometry(1, 12, 10), hairM, [0, -0.01, -0.06], [0.085, 0.12, 0.06]));

    // Arms.
    const sleeveLower = outfit.sleeve === 'long' ? shirt : skin;
    for (const [sh, el, s] of [[this.lSh, this.lEl, 1], [this.rSh, this.rEl, -1]] as const) {
      this.chest.add(sh);
      sh.position.set(s * 0.2, -0.03, 0);
      sh.add(this.part(new THREE.SphereGeometry(0.058, 12, 10), shirt, [0, 0, 0]));
      sh.add(this.part(new THREE.CapsuleGeometry(0.05, 0.2, 4, 10), outfit.sleeve === 'long' ? shirt : (s ? shirt : shirt), [0, -0.14, 0]));
      sh.add(el);
      el.position.y = -0.29;
      el.add(this.part(new THREE.CapsuleGeometry(0.042, 0.19, 4, 10), sleeveLower, [0, -0.12, 0]));
      el.add(this.part(new THREE.SphereGeometry(1, 10, 8), skin, [0, -0.28, 0.01], [0.038, 0.06, 0.025]));
    }
    // Legs.
    for (const [hp, kn, s] of [[this.lHip, this.lKn, 1], [this.rHip, this.rKn, -1]] as const) {
      this.hips.add(hp);
      hp.position.set(s * 0.095, -0.04, 0);
      hp.add(this.part(new THREE.CapsuleGeometry(0.072, 0.3, 4, 12), pants, [0, -0.21, 0]));
      hp.add(kn);
      kn.position.y = -0.44;
      kn.add(this.part(new THREE.CapsuleGeometry(0.058, 0.32, 4, 12), pants, [0, -0.2, 0]));
      kn.add(this.part(new THREE.BoxGeometry(0.095, 0.07, 0.25), shoes, [0, -0.43, 0.045]));
    }

    // Outfit extras.
    if (outfit.extra === 'tie') {
      this.chest.add(this.part(new THREE.BoxGeometry(0.05, 0.3, 0.01), this.mat(rng.pick([0x7a1f2b, 0x1f2f5a, 0x2f2f2f]), 0.6), [0, -0.18, 0.115], [1, 1, 1], [0.12, 0, 0]));
    } else if (outfit.extra === 'hood') {
      this.chest.add(this.part(new THREE.TorusGeometry(0.1, 0.04, 8, 16), shirt, [0, 0.02, -0.05], [1, 1, 1], [Math.PI / 2.4, 0, 0]));
    } else if (outfit.extra === 'backpack') {
      this.spine.add(this.part(new THREE.BoxGeometry(0.3, 0.4, 0.15), this.mat(0x2d3a2a, 0.8), [0, 0.22, -0.17]));
      // A stick of chalk in the right hand.
      this.rEl.add(this.part(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), this.mat(0xf2f2ea, 0.9), [0, -0.33, 0.03], [1, 1, 1], [0.4, 0, 0]));
    } else {
      this.chest.add(this.part(new THREE.BoxGeometry(0.06, 0.08, 0.005), this.mat(0xeeeeee, 0.5), [0.03, -0.24, 0.115]));
    }

    shadowTex ??= T.blobShadow();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    this.shadow.position.y = 0.012;
    this.shadow.renderOrder = 1;
  }

  private mat(color: number, roughness: number) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    // Ambient only reaches lit circuits; in a blackout only nearby light does.
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBright = this.bright;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBright;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= uBright;');
    };
    m.customProgramCacheKey = () => 'person';
    return m;
  }

  private part(geo: THREE.BufferGeometry, mat: THREE.Material, pos: number[], scale = [1, 1, 1], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    return m;
  }

  addTo(scene: THREE.Object3D) {
    scene.add(this.root, this.shadow);
  }

  removeFrom(scene: THREE.Object3D) {
    scene.remove(this.root, this.shadow);
  }

  update(w: Wanderer, dt: number, t: number, bright: number) {
    this.bright.value = 0.04 + 0.96 * bright;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * bright;

    // Advance the gait by distance actually covered.
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(w.x - this.lastX, w.z - this.lastZ);
    this.lastX = w.x;
    this.lastZ = w.z;
    const speed = dt > 0 ? moved / dt : 0;
    const running = speed > 2.6;
    this.phase += moved * ((Math.PI * 2) / (running ? 2.3 : 1.35));

    const p = this.target(w, t, speed, running);
    const k = 1 - Math.exp(-12 * dt);
    for (const j of JOINTS) this.pose[j] += (p[j] - this.pose[j]) * k;
    this.apply();

    this.root.position.set(w.x, 0, w.z);
    this.root.rotation.y = Math.PI / 2 - w.heading;
    this.shadow.position.x = w.x;
    this.shadow.position.z = w.z;
  }

  private target(w: Wanderer, t: number, speed: number, running: boolean): Record<Joint, number> {
    const p = Object.fromEntries(JOINTS.map((j) => [j, 0])) as Record<Joint, number>;
    const id = (this.seed % 100) / 10;
    const ph = this.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const amp = running ? 1 : Math.min(1, speed / 1.4) * 0.6;
    const moving = speed > 0.15;
    p.hipsY = HIP_H;
    p.breath = Math.sin(t * (w.fear > 50 ? 5 : 2.2) + id) * (w.fear > 50 ? 0.03 : 0.015);
    // Arms hang slightly out and bent at rest.
    p.lShZ = 0.08;
    p.rShZ = -0.08;
    p.lElX = p.rElX = -0.15;

    if (moving) {
      p.lHipX = -s * amp * 0.75;
      p.rHipX = s * amp * 0.75;
      p.lKnX = amp * (0.15 + 1.1 * Math.max(0, Math.sin(ph - 1.2)));
      p.rKnX = amp * (0.15 + 1.1 * Math.max(0, Math.sin(ph + Math.PI - 1.2)));
      p.lShX = s * amp * 0.6;
      p.rShX = -s * amp * 0.6;
      p.lElX = p.rElX = -(0.2 + (running ? 1.2 : 0.25));
      p.hipsY = HIP_H - 0.025 * amp + Math.abs(c) * 0.035 * amp;
      p.hipsYaw = s * 0.1 * amp;
      p.chestYaw = -s * 0.16 * amp;
      p.spineX = running ? 0.28 : 0.04;
      p.spineZ = c * 0.03 * amp;
      p.headX = running ? -0.2 : 0;
    }

    switch (w.state) {
      case 'alert':
        p.headY = Math.sin(t * 1.3 + id) * 0.9;
        p.headX = -0.05;
        p.lElX = p.rElX = -0.5;
        break;
      case 'confused':
        // Hand to the head, looking around.
        p.headY = Math.sin(t * 2.1 + id) * 1.0;
        p.rShX = -2.3;
        p.rShZ = -0.5;
        p.rElX = -2.1;
        break;
      case 'chalk':
        // Bending down to draw at the junction.
        p.hipsY = HIP_H - 0.12;
        p.spineX = 0.95;
        p.lHipX = -0.5;
        p.rHipX = -0.5;
        p.lKnX = p.rKnX = 0.75;
        p.rShX = -1.0 + Math.sin(t * 13) * 0.08;
        p.rShZ = -0.1 + Math.sin(t * 9) * 0.12;
        p.rElX = -0.3;
        p.lShX = -0.3;
        p.neckX = 0.3;
        break;
      case 'hide':
        // Crouched, arms around the knees.
        p.hipsY = 0.42;
        p.spineX = 0.6;
        p.lHipX = p.rHipX = -1.95;
        p.lHipZ = 0.12;
        p.rHipZ = -0.12;
        p.lKnX = p.rKnX = 2.35;
        p.lShX = p.rShX = -0.9;
        p.lShZ = -0.25;
        p.rShZ = 0.25;
        p.lElX = p.rElX = -1.2;
        p.neckX = 0.45;
        break;
      case 'panic':
        // Running blind, arms up.
        p.lShX = -2.4 + Math.sin(t * 9) * 0.4;
        p.rShX = -2.4 + Math.cos(t * 9) * 0.4;
        p.lShZ = 0.35;
        p.rShZ = -0.35;
        p.lElX = p.rElX = -1.3;
        break;
      case 'flee':
        // Glancing back over the shoulder.
        p.headY = Math.sin(t * 1.7 + id) > 0.6 ? 1.3 : 0;
        break;
      default:
        if (!moving) p.headY = Math.sin(t * 0.5 + id) * 0.4;
    }

    if (w.exhausted && moving && w.state !== 'panic') {
      p.spineX = 0.45; // doubled over, gasping
      p.neckX = -0.3;
    }
    if (w.fear > 70) {
      // Trembling.
      const tr = (w.fear - 70) / 30;
      p.chestYaw += Math.sin(t * 37 + id) * 0.03 * tr;
      p.headX += Math.sin(t * 43) * 0.04 * tr;
      p.lShZ += Math.sin(t * 31) * 0.04 * tr;
      p.rShZ += Math.sin(t * 29) * 0.04 * tr;
    }
    return p;
  }

  private apply() {
    const q = this.pose;
    this.hips.position.y = q.hipsY;
    this.hips.rotation.y = q.hipsYaw;
    this.spine.rotation.set(q.spineX, 0, q.spineZ);
    this.chest.rotation.y = q.chestYaw;
    this.chest.scale.set(1 + q.breath, 1 + q.breath * 0.5, 1 + q.breath * 1.5);
    this.neck.rotation.x = q.neckX;
    this.head.rotation.set(q.headX, q.headY, 0);
    this.lSh.rotation.set(q.lShX, 0, q.lShZ);
    this.rSh.rotation.set(q.rShX, 0, q.rShZ);
    this.lEl.rotation.x = q.lElX;
    this.rEl.rotation.x = q.rElX;
    this.lHip.rotation.set(q.lHipX, 0, q.lHipZ);
    this.rHip.rotation.set(q.rHipX, 0, q.rHipZ);
    this.lKn.rotation.x = q.lKnX;
    this.rKn.rotation.x = q.rKnX;
  }
}
