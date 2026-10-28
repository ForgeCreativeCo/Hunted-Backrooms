import * as THREE from 'three';

// The monster as the humans see it: too tall, too thin, wet-black, with pale
// pinprick eyes. It twitches, and now and then it isn't quite there.
// Model faces +z; joint rotation.x > 0 swings a hanging limb backwards.

export class Creature {
  root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private lSh = new THREE.Group();
  private rSh = new THREE.Group();
  private lEl = new THREE.Group();
  private rEl = new THREE.Group();
  private lHip = new THREE.Group();
  private rHip = new THREE.Group();
  private lKn = new THREE.Group();
  private rKn = new THREE.Group();
  private phase = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private twitch = 0;
  private twitchHead = new THREE.Euler();
  private glitchT = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.55, metalness: 0.05 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) });
    const part = (geo: THREE.BufferGeometry, parent: THREE.Object3D, pos: number[], scale = [1, 1, 1], mat: THREE.Material = skin) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      m.scale.set(scale[0], scale[1], scale[2]);
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    this.body.position.y = 1.32;
    // Pelvis, a long narrow torso and a hunched upper back.
    part(new THREE.SphereGeometry(1, 12, 10), this.body, [0, 0, 0], [0.14, 0.1, 0.1]);
    part(new THREE.CapsuleGeometry(0.11, 0.6, 6, 12), this.body, [0, 0.42, -0.02], [1.05, 1, 0.7]);
    part(new THREE.SphereGeometry(1, 12, 10), this.body, [0, 0.78, -0.06], [0.2, 0.12, 0.13]);
    // Ribs showing through.
    for (let i = 0; i < 4; i++) part(new THREE.TorusGeometry(0.1, 0.008, 4, 16, Math.PI), this.body, [0, 0.36 + i * 0.07, 0.04], [1.05, 0.5, 0.8]);

    // Neck juts forward; small, elongated head.
    this.body.add(this.head);
    this.head.position.set(0, 0.95, 0.06);
    part(new THREE.CylinderGeometry(0.035, 0.05, 0.2, 8), this.head, [0, -0.08, -0.02]);
    part(new THREE.SphereGeometry(1, 16, 12), this.head, [0, 0.08, 0.02], [0.085, 0.15, 0.1]);
    for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.011, 8, 6), this.head, [s * 0.03, 0.1, 0.105], [1, 1, 1], eyeMat);
    // A mouth that is a little too wide.
    part(new THREE.BoxGeometry(0.09, 0.006, 0.01), this.head, [0, 0.01, 0.11], [1, 1, 1], new THREE.MeshBasicMaterial({ color: 0x000000 }));

    // Arms that reach past the knees.
    for (const [sh, el, s] of [[this.lSh, this.lEl, 1], [this.rSh, this.rEl, -1]] as const) {
      this.body.add(sh);
      sh.position.set(s * 0.19, 0.76, 0.03);
      part(new THREE.SphereGeometry(0.055, 10, 8), sh, [0, 0, 0]);
      part(new THREE.CylinderGeometry(0.042, 0.03, 0.5, 8), sh, [0, -0.25, 0]);
      part(new THREE.SphereGeometry(0.034, 8, 6), sh, [0, -0.5, 0]);
      sh.add(el);
      el.position.y = -0.5;
      part(new THREE.CylinderGeometry(0.032, 0.02, 0.48, 8), el, [0, -0.24, 0]);
      part(new THREE.SphereGeometry(1, 8, 6), el, [0, -0.5, 0.005], [0.03, 0.05, 0.018]);
      // Long fingers.
      for (let f = 0; f < 4; f++) {
        part(new THREE.CapsuleGeometry(0.008, 0.16, 2, 4), el, [(f - 1.5) * 0.017, -0.58, 0.01]);
      }
    }
    // Legs.
    for (const [hp, kn, s] of [[this.lHip, this.lKn, 1], [this.rHip, this.rKn, -1]] as const) {
      this.body.add(hp);
      hp.position.set(s * 0.09, -0.04, 0);
      part(new THREE.SphereGeometry(0.065, 10, 8), hp, [0, 0, 0]);
      part(new THREE.CylinderGeometry(0.06, 0.038, 0.64, 8), hp, [0, -0.32, 0]);
      part(new THREE.SphereGeometry(0.042, 8, 6), hp, [0, -0.64, 0]);
      hp.add(kn);
      kn.position.y = -0.64;
      part(new THREE.CylinderGeometry(0.04, 0.026, 0.62, 8), kn, [0, -0.31, 0]);
      part(new THREE.SphereGeometry(1, 8, 6), kn, [0, -0.63, 0.06], [0.04, 0.025, 0.13]);
    }
  }

  update(x: number, z: number, yaw: number, dt: number, t: number) {
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    const speed = dt > 0 ? moved / dt : 0;
    this.phase += moved * ((Math.PI * 2) / 2.2);
    const amp = Math.min(1, speed / 2.5);
    const s = Math.sin(this.phase);

    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw + Math.PI; // monster forward is -z in its own frame

    // A loping, hunched gait.
    this.body.rotation.x = 0.35 + amp * 0.15;
    this.body.position.y = 1.32 - amp * 0.05 + Math.abs(Math.cos(this.phase)) * 0.05 * amp;
    this.lHip.rotation.x = -s * 0.7 * amp - 0.3;
    this.rHip.rotation.x = s * 0.7 * amp - 0.3;
    this.lKn.rotation.x = 0.4 + Math.max(0, Math.sin(this.phase - 1.2)) * 0.9 * amp;
    this.rKn.rotation.x = 0.4 + Math.max(0, Math.sin(this.phase + Math.PI - 1.2)) * 0.9 * amp;
    this.lSh.rotation.set(-0.3 + s * 0.4 * amp, 0, 0.1);
    this.rSh.rotation.set(-0.3 - s * 0.4 * amp, 0, -0.1);
    this.lEl.rotation.x = -0.25 - amp * 0.3;
    this.rEl.rotation.x = -0.25 - amp * 0.3;

    // Twitches: the head snaps to a new angle every so often.
    this.twitch -= dt;
    if (this.twitch <= 0) {
      this.twitch = 0.4 + Math.random() * 1.6;
      this.twitchHead.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 1.2);
    }
    this.head.rotation.x += (this.twitchHead.x - 0.35 - this.head.rotation.x) * Math.min(1, dt * 30);
    this.head.rotation.y += (this.twitchHead.y - this.head.rotation.y) * Math.min(1, dt * 30);
    this.head.rotation.z += (this.twitchHead.z - this.head.rotation.z) * Math.min(1, dt * 30);
    this.lEl.rotation.z = Math.sin(t * 31) * 0.02;
    this.rEl.rotation.z = Math.cos(t * 29) * 0.02;

    // And sometimes it skips a frame of existing.
    this.glitchT -= dt;
    if (this.glitchT <= 0) this.glitchT = Math.random() < 0.02 ? 0.06 : 0;
    this.root.visible = this.glitchT <= 0;
  }
}
