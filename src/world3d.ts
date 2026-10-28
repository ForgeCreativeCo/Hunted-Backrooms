import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG } from './config';
import { Game, Wanderer } from './game';
import * as T from './textures';

const LIT = new THREE.Color(1, 1, 1);
const DARK = new THREE.Color(0.09, 0.1, 0.14); // the monster sees a little in the dark
const PANEL_ON = new THREE.Color(1.6, 1.55, 1.3);
const PANEL_OFF = new THREE.Color(0.05, 0.05, 0.06);
const FOG_LIT = new THREE.Color(0x2b2613);
const FOG_DARK = new THREE.Color(0x050608);

// Film grain, a slight colour fringe and a vignette: the monster's eyes.
const HuntShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    redden: { value: 0 },
    seep: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float redden;
    uniform float seep;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 + 0.08 * d);
      uv.x += seep * 0.006 * sin(uv.y * 40.0 + time * 6.0);
      float ab = 0.004 + 0.012 * d + seep * 0.01;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;
      col += (rand(uv * 900.0 + fract(time * 7.0)) - 0.5) * 0.09;
      col *= 0.96 + 0.04 * sin(uv.y * 900.0 + time * 12.0);
      col *= 1.0 - d * 1.6;
      col = mix(col, vec3(col.r * 1.3, col.g * 0.4, col.b * 0.4), redden);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class World3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private hunt: ShaderPass;
  private walls: THREE.InstancedMesh;
  private wallKeys: number[] = [];
  private floor: THREE.InstancedMesh;
  private ceil: THREE.InstancedMesh;
  private panels: THREE.InstancedMesh;
  private panelCells: number[] = [];
  private pillars: THREE.InstancedMesh;
  private pillarCells: number[] = [];
  private chalkGroup = new THREE.Group();
  private chalkMeshes = new Map<number, THREE.Group>();
  private chalkGeo = new THREE.PlaneGeometry(1.1, 1.1);
  private chalkMat: THREE.MeshBasicMaterial;
  private people = new Map<number, { g: THREE.Group; body: THREE.Mesh; mat: THREE.MeshLambertMaterial }>();
  private builtVersion = -1;
  private cellBright: Float32Array;
  private flicker: Float32Array;
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(private game: Game, canvas: HTMLCanvasElement) {
    const L = game.level;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 70);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(FOG_LIT.getHex(), 0.055);
    this.scene.background = FOG_LIT.clone();

    this.scene.add(new THREE.HemisphereLight(0xfff3c8, 0x5a4b22, 1.6));
    const dir = new THREE.DirectionalLight(0xfff0c0, 0.7);
    dir.position.set(0.6, 1, 0.3);
    this.scene.add(dir);

    const CS = L.CS, H = CFG.WALL_H;

    // Walls: one instanced box per wall edge.
    const wallTex = T.wallpaper();
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
    this.walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS + 0.16, H, 0.16), wallMat, L.edgeCount);
    this.walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(L.edgeCount * 3).fill(1), 3);
    this.scene.add(this.walls);

    // Floor and ceiling tiles per cell.
    const floorGeo = new THREE.PlaneGeometry(CS, CS);
    floorGeo.rotateX(-Math.PI / 2);
    this.floor = new THREE.InstancedMesh(floorGeo, new THREE.MeshLambertMaterial({ map: T.carpet() }), L.cells);
    const ceilGeo = new THREE.PlaneGeometry(CS, CS);
    ceilGeo.rotateX(Math.PI / 2);
    this.ceil = new THREE.InstancedMesh(ceilGeo, new THREE.MeshBasicMaterial({ map: T.ceiling(), color: 0x9a9070 }), L.cells);
    for (let c = 0; c < L.cells; c++) {
      const p = L.center(c);
      this.tmp.position.set(p.x, 0, p.z);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      this.floor.setMatrixAt(c, this.tmp.matrix);
      this.tmp.position.y = H;
      this.tmp.updateMatrix();
      this.ceil.setMatrixAt(c, this.tmp.matrix);
      this.floor.setColorAt(c, LIT);
      this.ceil.setColorAt(c, LIT);
    }
    this.scene.add(this.floor, this.ceil);

    // Fluorescent panels.
    for (let c = 0; c < L.cells; c++) if (L.panel[c]) this.panelCells.push(c);
    const panelGeo = new THREE.PlaneGeometry(1.3, 0.6);
    panelGeo.rotateX(Math.PI / 2);
    this.panels = new THREE.InstancedMesh(panelGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), this.panelCells.length);
    this.panelCells.forEach((c, i) => {
      const p = L.center(c);
      this.tmp.position.set(p.x, H - 0.01, p.z);
      this.tmp.rotation.set(0, (c % 3) === 0 ? Math.PI / 2 : 0, 0);
      this.tmp.updateMatrix();
      this.panels.setMatrixAt(i, this.tmp.matrix);
      this.panels.setColorAt(i, PANEL_ON);
    });
    this.scene.add(this.panels);

    // Pillars.
    this.pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, H, 0.6), wallMat, Math.max(1, L.pillars.length));
    this.pillars.count = L.pillars.length;
    L.pillars.forEach((p, i) => {
      this.tmp.position.set(p.x, H / 2, p.z);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      this.pillars.setMatrixAt(i, this.tmp.matrix);
      this.pillars.setColorAt(i, LIT);
      this.pillarCells.push(L.cellAt(p.x - 0.1, p.z - 0.1));
    });
    this.scene.add(this.pillars);

    // Exits: a door painted on the border wall, with a glowing sign.
    const signTex = T.exitSign();
    for (const e of L.exits) {
      const p = L.center(e.cell);
      const g = new THREE.Group();
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), new THREE.MeshLambertMaterial({ color: 0x4a3524 }));
      door.position.set(0, 1.05, 0);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.28), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, fog: false }));
      sign.position.set(0, 2.35, 0);
      g.add(door, sign);
      // Place the group against the wall on side e.dir, facing into the cell.
      const off = CS / 2 - 0.1;
      const dx = [0, 1, 0, -1][e.dir], dz = [-1, 0, 1, 0][e.dir];
      g.position.set(p.x + dx * off, 0, p.z + dz * off);
      g.rotation.y = Math.atan2(-dx, -dz);
      this.scene.add(g);
    }

    this.chalkMat = new THREE.MeshBasicMaterial({ map: T.chalkArrow(), transparent: true, depthWrite: false });
    this.scene.add(this.chalkGroup);

    this.cellBright = new Float32Array(L.cells).fill(1);
    this.flicker = new Float32Array(this.panelCells.length).fill(1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.hunt = new ShaderPass(HuntShader);
    this.composer.addPass(this.hunt);
    this.composer.addPass(new OutputPass());

    this.rebuildWalls();
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private rebuildWalls() {
    const L = this.game.level;
    this.wallKeys = [];
    for (let k = 0; k < L.edgeCount; k++) {
      if (!L.isWall(k)) continue;
      const s = L.edgeSegment(k);
      this.tmp.position.set((s.x1 + s.x2) / 2, CFG.WALL_H / 2, (s.z1 + s.z2) / 2);
      this.tmp.rotation.set(0, s.horizontal ? 0 : Math.PI / 2, 0);
      this.tmp.updateMatrix();
      this.walls.setMatrixAt(this.wallKeys.length, this.tmp.matrix);
      this.wallKeys.push(k);
    }
    this.walls.count = this.wallKeys.length;
    this.walls.instanceMatrix.needsUpdate = true;
    this.builtVersion = L.version;
  }

  /** Smoothly flickering brightness per circuit, from the game's blackout timers. */
  circuitLevel(i: number, t: number): number {
    const b = this.game.blackout[i];
    if (b <= 0) return 1;
    const sinceStart = CFG.BLACKOUT_TIME - b;
    if (sinceStart < 0.6) return Math.sin(t * 60 + i) > 0.2 ? 1 : 0; // dying flicker
    if (b < 0.9) return Math.sin(t * 45 + i * 3) > 0 ? 1 : 0; // stuttering back on
    return 0;
  }

  update(t: number, redden: number) {
    const g = this.game;
    const L = g.level;
    if (L.version !== this.builtVersion) this.rebuildWalls();

    const circ = new Float32Array(L.circuitCount);
    for (let i = 0; i < circ.length; i++) circ[i] = this.circuitLevel(i, t);
    for (let c = 0; c < L.cells; c++) {
      const target = circ[L.circuit[c]];
      this.cellBright[c] += (target - this.cellBright[c]) * 0.35;
      this.col.copy(DARK).lerp(LIT, this.cellBright[c]);
      this.floor.setColorAt(c, this.col);
      this.ceil.setColorAt(c, this.col);
    }
    this.wallKeys.forEach((k, i) => {
      const [a, b] = L.edgeCells(k);
      const v = Math.max(a >= 0 ? this.cellBright[a] : 0, b >= 0 ? this.cellBright[b] : 0);
      this.col.copy(DARK).lerp(LIT, v);
      this.walls.setColorAt(i, this.col);
    });
    this.pillarCells.forEach((c, i) => {
      this.col.copy(DARK).lerp(LIT, this.cellBright[c]);
      this.pillars.setColorAt(i, this.col);
    });
    // Panels: on with their circuit, plus the odd tired flicker.
    this.panelCells.forEach((c, i) => {
      if (Math.random() < 0.0015) this.flicker[i] = 0;
      this.flicker[i] = Math.min(1, this.flicker[i] + 0.08);
      const v = this.cellBright[c] * (this.flicker[i] > 0.5 ? 1 : 0.25);
      this.col.copy(PANEL_OFF).lerp(PANEL_ON, v);
      this.panels.setColorAt(i, this.col);
    });
    for (const m of [this.floor, this.ceil, this.walls, this.pillars, this.panels]) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    this.syncChalk();
    this.syncPeople(t);

    // Camera = the monster's eyes.
    const m = g.monster;
    const sway = m.moving ? Math.sin(t * 7) * 0.03 : 0;
    this.camera.position.set(m.x, CFG.EYE_HEIGHT + sway, m.z);
    this.camera.rotation.set(m.pitch, m.yaw, 0);

    const here = this.cellBright[L.cellAt(m.x, m.z)];
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(FOG_DARK).lerp(FOG_LIT, here);
    (this.scene.background as THREE.Color).copy(fog.color);

    this.hunt.uniforms.time.value = t;
    this.hunt.uniforms.redden.value = redden;
    this.hunt.uniforms.seep.value = m.seepT > 0 ? 1 : 0;
  }

  render() {
    this.composer.render();
  }

  /** Keep the audio listener (a child of the camera) current when the 3D view isn't drawn. */
  updateListener() {
    this.scene.updateMatrixWorld();
  }

  private syncChalk() {
    const g = this.game;
    for (const [cell, grp] of this.chalkMeshes) {
      if (!g.chalk.has(cell)) { this.chalkGroup.remove(grp); this.chalkMeshes.delete(cell); }
    }
    for (const [cell, mark] of g.chalk) {
      let grp = this.chalkMeshes.get(cell);
      if (!grp) {
        grp = new THREE.Group();
        const mesh = new THREE.Mesh(this.chalkGeo, this.chalkMat);
        mesh.rotation.x = -Math.PI / 2;
        grp.add(mesh);
        const p = g.level.center(cell);
        grp.position.set(p.x, 0.02, p.z);
        this.chalkGroup.add(grp);
        this.chalkMeshes.set(cell, grp);
      }
      grp.rotation.y = -mark.dir * Math.PI / 2;
    }
  }

  private syncPeople(t: number) {
    const g = this.game;
    for (const w of g.wanderers) {
      let p = this.people.get(w.id);
      if (!w.active) {
        if (p) { this.scene.remove(p.g); this.people.delete(w.id); }
        continue;
      }
      if (!p) p = this.makePerson(w);
      const crouch = w.state === 'hide' ? 0.62 : 1;
      p.g.position.set(w.x, Math.abs(Math.sin(w.walkPhase)) * 0.05, w.z);
      p.g.scale.y += (crouch - p.g.scale.y) * 0.2;
      p.g.rotation.y = -w.heading + Math.PI / 2;
      // Trembling when terrified.
      p.body.rotation.z = w.fear > 70 ? Math.sin(t * 40 + w.id) * 0.03 : 0;
      const b = this.cellBright[w.cell] ?? 1;
      p.mat.color.setScalar(0.02 + 0.05 * b);
    }
  }

  private makePerson(w: Wanderer) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.95, 4, 8), mat);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat);
    head.position.y = 1.62;
    g.add(body, head);
    this.scene.add(g);
    const p = { g, body, mat };
    this.people.set(w.id, p);
    return p;
  }

  isPersonVisible(w: Wanderer) {
    return this.people.has(w.id);
  }
}
