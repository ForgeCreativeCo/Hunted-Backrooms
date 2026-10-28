import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CFG } from './config';
import { Creature } from './creature';
import { Game } from './game';
import type { Door } from './level';
import { Person } from './person';
import { buildProps, PropMat } from './props';
import { hashString } from './rng';
import * as T from './textures';

const PANEL_ON = new THREE.Color(2.4, 2.35, 2.1);
const PANEL_OFF = new THREE.Color(0.03, 0.03, 0.035);
const FOG_LIT = new THREE.Color(0x3a321a);
const FOG_DARK = new THREE.Color(0x040507);
const POOL = 8; // real point lights, moved to the nearest visible fixtures each frame
const POOL_REACH = 18;

// Film grain, a slight colour fringe and a vignette: the monster's eyes.
// In a dark circuit they switch to night vision: whatever light there is,
// amplified into a pale green image.
const HuntShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    redden: { value: 0 },
    seep: { value: 0 },
    nv: { value: 0 },
    nvFlash: { value: 0 },
    fear: { value: 0 },
    lens: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float redden;
    uniform float seep;
    uniform float nv;
    uniform float nvFlash;
    uniform float fear;
    uniform float lens;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 + 0.08 * d * lens);
      uv.x += seep * 0.006 * sin(uv.y * 40.0 + time * 6.0);
      float ab = (0.003 + 0.01 * d) * lens + seep * 0.01 + fear * 0.006 * d;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      if (nv > 0.0) {
        float amp = pow(1.0 - exp(-lum * 6.0), 1.25);
        col = mix(col, vec3(0.5, 0.95, 0.68) * (0.02 + amp * 0.8), nv);
        lum = mix(lum, amp, nv);
      }
      // Grain is stronger in the shadows, like a sensor pushed too far.
      vec3 gtint = mix(vec3(1.0), vec3(0.7, 1.0, 0.8), nv);
      float grain = mix(0.05, 0.02, clamp(lum, 0.0, 1.0)) + nv * 0.07 + nvFlash * 0.5;
      col += (rand(uv * 900.0 + fract(time * 7.0)) - 0.5) * grain * gtint;
      col += nvFlash * 0.25 * vec3(0.6, 1.0, 0.8);
      col *= 0.97 + (0.03 + nv * 0.05) * sin(uv.y * 900.0 + time * 12.0);
      col *= 1.0 - d * (1.5 + nv * 1.2);
      col = mix(col, vec3(col.r * 1.3, col.g * 0.4, col.b * 0.4), redden);
      // Human fear: colour drains, vision tunnels, and the edges pulse with the heartbeat.
      if (fear > 0.0) {
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), fear * 0.55);
        float beat = pow(max(0.0, sin(time * (5.0 + fear * 6.0))), 14.0) * fear;
        col *= 1.0 - d * (fear * 2.2 + beat * 1.8);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

type Surf = 'FLOOR' | 'WALL' | 'CEIL' | 'TRIM' | 'PROP';

/**
 * Light level per cell as a small texture, for meshes that aren't instanced per
 * cell (merged furniture, doors): they look up how lit their spot is.
 */
const cellLight = { tex: { value: null as THREE.Texture | null }, size: { value: new THREE.Vector2(1, 1) } };

/**
 * Standard material patched with per-instance light level (aBright: ambient
 * only reaches lit circuits), contact shadows where floor meets wall (aWalls),
 * and world-space grime so no two stretches of wall look the same.
 */
function surface(kind: Surf, params: THREE.MeshStandardMaterialParameters, grime: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial(params);
  const half = (CFG.CS / 2).toFixed(3), H = CFG.WALL_H.toFixed(3);
  m.defines = { [`SURF_${kind}`]: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grime };
    sh.uniforms.uCellTex = cellLight.tex;
    sh.uniforms.uMapSize = cellLight.size;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aBright;
        attribute float aWalls;
        varying float hBright;
        varying float hWalls;
        varying vec3 hW;
        varying vec3 hL;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        hBright = aBright;
        hWalls = aWalls;
        hL = transformed;
        vec4 hw4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          hw4 = instanceMatrix * hw4;
        #endif
        hW = (modelMatrix * hw4).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrime;
        uniform sampler2D uCellTex;
        uniform vec2 uMapSize;
        varying float hBright;
        varying float hWalls;
        varying vec3 hW;
        varying vec3 hL;
        float hEdge(float d) { return mix(0.42, 1.0, smoothstep(0.0, 0.75, d)); }
        float hAO() {
          int m = int(hWalls + 0.5);
          float ao = 1.0;
          if ((m & 1) != 0) ao *= hEdge(hL.z + ${half});
          if ((m & 2) != 0) ao *= hEdge(${half} - hL.x);
          if ((m & 4) != 0) ao *= hEdge(${half} - hL.z);
          if ((m & 8) != 0) ao *= hEdge(hL.x + ${half});
          return ao;
        }
        float hWet = 0.0;`)
      .replace('#include <map_fragment>', `
        #ifdef SURF_WALL
          // Wallpaper mapped in world space, so walls of any height keep its scale.
          diffuseColor = vec4(diffuse, opacity) * texture2D(map, vec2((hW.x + hW.z) / 3.16, hW.y / 2.7));
        #else
          #include <map_fragment>
        #endif
        #ifdef SURF_PROP
          diffuseColor.rgb *= 0.82 + 0.3 * texture2D(uGrime, hW.xz * 0.4 + hW.y * 0.25).g;
        #endif
        #ifdef SURF_FLOOR
          float n1 = texture2D(uGrime, hW.xz * 0.03).r;
          float n2 = texture2D(uGrime, hW.xz * 0.19).g;
          hWet = smoothstep(0.58, 0.68, n1 * 0.75 + n2 * 0.25);
          diffuseColor.rgb *= (0.8 + 0.4 * n2) * mix(1.0, 0.45, hWet);
          diffuseColor.rgb *= hAO();
        #endif
        #ifdef SURF_WALL
          float along = hW.x + hW.z;
          float st = texture2D(uGrime, vec2(along * 0.06, hW.y * 0.08)).r;
          float streak = texture2D(uGrime, vec2(along * 0.35, 0.5)).b;
          float wy = hW.y;
          float topH = hWalls; // each wall instance carries its own top height
          float low = 1.0 - smoothstep(0.0, 1.3, wy);
          float damp = smoothstep(0.52, 0.8, st) * (0.35 + 0.65 * low);
          float drip = smoothstep(0.68, 0.92, streak) * smoothstep(0.3, 2.4, wy) * 0.45;
          float mottle = texture2D(uGrime, vec2(along * 0.4, hW.y * 0.4)).g;
          diffuseColor.rgb *= 0.9 + 0.2 * mottle;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.44, 0.26), clamp(damp * 0.85 + drip, 0.0, 1.0));
          diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.5, wy)) * mix(0.7, 1.0, smoothstep(0.0, 0.4, topH - wy));
        #endif
        #ifdef SURF_CEIL
          vec2 tile = floor(hW.xz / 0.75);
          float hsh = fract(sin(dot(tile, vec2(12.9898, 78.233))) * 43758.5453);
          float ring = texture2D(uGrime, hW.xz * 0.11).r;
          diffuseColor.rgb *= mix(1.0, 0.9, step(0.65, hsh));
          float stain = step(0.88, hsh) * smoothstep(0.4, 0.62, ring);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.68, 0.55, 0.32), stain);
          diffuseColor.rgb *= mix(0.55, 1.0, hAO());
        #endif
        #ifdef SURF_TRIM
          diffuseColor.rgb *= 0.8 + 0.2 * texture2D(uGrime, vec2((hW.x + hW.z) * 0.3, 0.2)).g;
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, hWet);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #ifdef SURF_PROP
          float gate = texture2D(uCellTex, hW.xz / uMapSize).r;
        #else
          float gate = hBright;
        #endif
        reflectedLight.indirectDiffuse *= gate;
        reflectedLight.indirectSpecular *= gate;`);
  };
  m.customProgramCacheKey = () => `surf-${kind}`;
  return m;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  geo.setAttribute('aBright', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
  geo.setAttribute('aWalls', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  return mesh;
}

export class World3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private hunt: ShaderPass;
  private walls: THREE.InstancedMesh;
  private trim: THREE.InstancedMesh;
  private outlets: THREE.InstancedMesh;
  private wallKeys: number[] = [];
  private trimKeys: number[] = [];
  private cellTex: THREE.DataTexture;
  private doorViews: { d: Door; pivot: THREE.Group; base: number; k: number; cur: number }[] = [];
  private floor: THREE.InstancedMesh;
  private ceil: THREE.InstancedMesh;
  private panels: THREE.InstancedMesh;
  private panelCells: number[] = [];
  private pillars: THREE.InstancedMesh;
  private pillarCells: number[] = [];
  private pool: THREE.PointLight[] = [];
  private darkvision: THREE.PointLight;
  private dust: THREE.Points;
  private dustMat: THREE.PointsMaterial;
  private chalkGroup = new THREE.Group();
  private chalkMeshes = new Map<number, THREE.Mesh>();
  private chalkGeo = new THREE.PlaneGeometry(1.0, 1.0).rotateX(-Math.PI / 2);
  private chalkTex: THREE.Texture;
  private people = new Map<number, Person>();
  private builtVersion = -1;
  private cellBright: Float32Array;
  private flicker: Float32Array;
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();
  private lastT = 0;
  /** 0..1, eased; on while the monster stands in a blacked-out circuit. */
  nightVision = 0;
  private nvOn = false;
  private nvFlash = 0;
  onNightVision: ((on: boolean) => void) | null = null;
  /** Whose eyes we're looking through: the monster, or a human player's slot. */
  viewer: { role: 'monster' } | { role: 'human'; slot: number } = { role: 'monster' };
  /** A human viewer's look direction (their client owns it). */
  look = { yaw: 0, pitch: 0 };
  private eye: number = CFG.HUMAN_EYE;
  private creature = new Creature();
  private spots: THREE.SpotLight[] = [];

  constructor(private game: Game, canvas: HTMLCanvasElement) {
    const L = game.level;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 80);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(FOG_LIT.getHex(), 0.042);
    this.scene.background = FOG_LIT.clone();

    // Ambient bounce off yellow walls and carpet. Gated per surface by circuit.
    this.scene.add(new THREE.HemisphereLight(0xffeab0, 0x9a8048, 0.6));

    const CS = L.CS, H = CFG.WALL_H;
    this.cellTex = new THREE.DataTexture(new Uint8Array(L.W * L.H * 4).fill(255), L.W, L.H);
    this.cellTex.magFilter = this.cellTex.minFilter = THREE.LinearFilter;
    this.cellTex.needsUpdate = true;
    cellLight.tex.value = this.cellTex;
    cellLight.size.value.set(L.W * CS, L.H * CS);
    const grime = T.grime();
    const paper = T.wallpaper(), carpet = T.carpet(), tiles = T.ceiling();

    // Walls: one instanced box per wall edge, with a baseboard and the odd outlet.
    const wallMat = surface('WALL', { map: paper.map, normalMap: paper.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.82 }, grime);
    // Unit boxes, scaled per instance: full walls, doorway jambs, and bulkheads where ceilings change height.
    this.walls = instanced(new THREE.BoxGeometry(1, 1, 0.16), wallMat, L.edgeCount * 3);
    const trimMat = surface('TRIM', { color: 0x8d7650, roughness: 0.55 }, grime);
    this.trim = instanced(new THREE.BoxGeometry(1, 0.12, 0.2), trimMat, L.edgeCount * 2);
    this.outlets = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.075, 0.115, 0.012),
      new THREE.MeshStandardMaterial({ map: T.outlet(), roughness: 0.4 }),
      L.edgeCount,
    );
    this.outlets.frustumCulled = false;
    this.scene.add(this.walls, this.trim, this.outlets);

    // Floor and ceiling tiles per cell.
    const floorMat = surface('FLOOR', { map: carpet.map, normalMap: carpet.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 }, grime);
    this.floor = instanced(new THREE.PlaneGeometry(CS, CS).rotateX(-Math.PI / 2), floorMat, L.cells);
    const ceilMat = surface('CEIL', { map: tiles.map, normalMap: tiles.normal, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.9 }, grime);
    this.ceil = instanced(new THREE.PlaneGeometry(CS, CS).rotateX(Math.PI / 2), ceilMat, L.cells);
    for (let c = 0; c < L.cells; c++) {
      const p = L.center(c);
      this.tmp.position.set(p.x, 0, p.z);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      this.floor.setMatrixAt(c, this.tmp.matrix);
      this.tmp.position.y = L.ceil[c];
      this.tmp.updateMatrix();
      this.ceil.setMatrixAt(c, this.tmp.matrix);
    }
    this.scene.add(this.floor, this.ceil);

    // Fluorescent troffers, glowing enough to bloom.
    for (let c = 0; c < L.cells; c++) if (L.panel[c]) this.panelCells.push(c);
    this.panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), new THREE.MeshBasicMaterial({ map: T.panel() }), this.panelCells.length);
    this.panels.frustumCulled = false;
    this.panelCells.forEach((c, i) => {
      const p = L.center(c);
      this.tmp.position.set(p.x, L.ceil[c] - 0.015, p.z);
      this.tmp.rotation.set(0, (c * 7) % 3 === 0 ? Math.PI / 2 : 0, 0);
      this.tmp.updateMatrix();
      this.panels.setMatrixAt(i, this.tmp.matrix);
      this.panels.setColorAt(i, PANEL_ON);
    });
    this.scene.add(this.panels);
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xfff0cc, 0, 11, 2);
      this.pool.push(l);
      this.scene.add(l);
    }

    // Ceiling details: air vents and the odd missing tile.
    const vents: number[] = [], holes: number[] = [];
    for (let c = 0; c < L.cells; c++) {
      if (L.panel[c]) continue;
      const h = hashString(`ceil${c}`) % 100;
      if (h < 7) vents.push(c);
      else if (h < 11) holes.push(c);
    }
    const ventMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.02, 0.6), new THREE.MeshStandardMaterial({ map: T.vent(), roughness: 0.6, metalness: 0.3 }), Math.max(1, vents.length));
    ventMesh.count = vents.length;
    const holeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 0.01, 0.72), new THREE.MeshBasicMaterial({ color: 0x050403 }), Math.max(1, holes.length));
    holeMesh.count = holes.length;
    vents.forEach((c, i) => {
      const p = L.center(c);
      this.tmp.position.set(p.x + 0.375, L.ceil[c] - 0.012, p.z - 0.375);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      ventMesh.setMatrixAt(i, this.tmp.matrix);
    });
    holes.forEach((c, i) => {
      const p = L.center(c);
      const ox = ((hashString(`hx${c}`) % 4) - 1.5) * 0.75, oz = ((hashString(`hz${c}`) % 4) - 1.5) * 0.75;
      this.tmp.position.set(p.x + ox, L.ceil[c] - 0.006, p.z + oz);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      holeMesh.setMatrixAt(i, this.tmp.matrix);
    });
    ventMesh.frustumCulled = holeMesh.frustumCulled = false;
    this.scene.add(ventMesh, holeMesh);

    // Pillars.
    this.pillars = instanced(new THREE.BoxGeometry(0.6, 1, 0.6), wallMat, Math.max(1, L.pillars.length));
    this.pillars.count = L.pillars.length;
    const pillarTop = this.pillars.geometry.getAttribute('aWalls') as THREE.InstancedBufferAttribute;
    L.pillars.forEach((p, i) => {
      const vx = Math.round(p.x / CS), vy = Math.round(p.z / CS);
      const ph = Math.max(...[[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]]
        .filter(([x, y]) => L.inBounds(x, y)).map(([x, y]) => L.ceil[L.cell(x, y)]));
      this.tmp.position.set(p.x, ph / 2, p.z);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.set(1, ph, 1);
      this.tmp.updateMatrix();
      this.tmp.scale.set(1, 1, 1);
      pillarTop.setX(i, ph);
      this.pillars.setMatrixAt(i, this.tmp.matrix);
      this.pillarCells.push(L.cellAt(p.x - 0.1, p.z - 0.1));
    });
    this.scene.add(this.pillars);

    this.buildExits();
    this.buildDoors(grime);
    this.buildFurniture(grime);

    // The monster sees a little in the dark: a cold, faint light that follows its eyes.
    this.darkvision = new THREE.PointLight(0x6f86c0, 0, 8, 1.6);
    this.camera.add(this.darkvision);

    // Flashlights, one per wanderer slot. Always in the scene (off = 0 intensity)
    // so turning one on doesn't recompile every shader.
    for (let i = 0; i < game.wanderers.length; i++) {
      const spot = new THREE.SpotLight(0xfff2d8, 0, 18, 0.36, 0.55, 1.4);
      this.scene.add(spot, spot.target);
      this.spots.push(spot);
    }
    this.creature.root.visible = false;
    this.scene.add(this.creature.root);

    // Dust hanging in the air.
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = Math.random() * 16 - 8;
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({
      size: 0.018, map: T.dustSprite(), transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0c8,
    });
    this.dust = new THREE.Points(dustGeo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    this.chalkTex = T.chalkArrow();
    this.scene.add(this.chalkGroup);

    this.cellBright = new Float32Array(L.cells).fill(1);
    this.flicker = new Float32Array(this.panelCells.length).fill(1);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.4, 0.5, 1.4));
    this.hunt = new ShaderPass(HuntShader);
    this.composer.addPass(this.hunt);
    this.composer.addPass(new OutputPass());

    this.rebuildWalls();
  }

  private buildExits() {
    const L = this.game.level;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b6458, roughness: 0.45, metalness: 0.55 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d3a34, roughness: 0.5, metalness: 0.6 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0xb0b0aa, roughness: 0.25, metalness: 0.9 });
    const signMat = new THREE.MeshBasicMaterial({ map: T.exitSign(), color: new THREE.Color(2.2, 2.2, 2.2) });
    for (const e of L.exits) {
      const p = L.center(e.cell);
      const g = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        g.add(m);
      };
      add(new THREE.BoxGeometry(1.0, 2.1, 0.05), doorMat, 0, 1.05, 0.02);
      add(new THREE.BoxGeometry(0.08, 2.2, 0.1), frameMat, -0.54, 1.1, 0.03);
      add(new THREE.BoxGeometry(0.08, 2.2, 0.1), frameMat, 0.54, 1.1, 0.03);
      add(new THREE.BoxGeometry(1.16, 0.08, 0.1), frameMat, 0, 2.18, 0.03);
      add(new THREE.BoxGeometry(0.8, 0.05, 0.06), barMat, 0, 1.0, 0.08);
      add(new THREE.BoxGeometry(0.05, 0.4, 0.04), barMat, 0.4, 1.3, 0.06);
      add(new THREE.BoxGeometry(0.62, 0.24, 0.06), signMat, 0, 2.42, 0.04);
      const glow = new THREE.PointLight(0x4dff6e, 2.2, 5, 2);
      glow.position.set(0, 2.3, 0.4);
      g.add(glow);
      // Against the wall on side e.dir, facing into the cell.
      const off = L.CS / 2 - 0.1;
      const dx = [0, 1, 0, -1][e.dir], dz = [-1, 0, 1, 0][e.dir];
      g.position.set(p.x + dx * off, 0, p.z + dz * off);
      g.rotation.y = Math.atan2(-dx, -dz);
      this.scene.add(g);
    }
  }

  private buildFurniture(grime: THREE.Texture) {
    const pm = (p: THREE.MeshStandardMaterialParameters) => surface('PROP', p, grime);
    const mats: Record<PropMat, THREE.Material> = {
      wood: pm({ color: 0x5e4129, roughness: 0.75 }),
      laminate: pm({ color: 0xa39276, roughness: 0.6 }),
      metal: pm({ color: 0x6f706b, roughness: 0.45, metalness: 0.55 }),
      fabric: pm({ color: 0x39414c, roughness: 1 }),
      plastic: pm({ color: 0xc7bf9f, roughness: 0.55 }),
      mattress: pm({ color: 0xb3a47c, roughness: 0.95 }),
      skin: pm({ color: 0xd8cdbd, roughness: 0.32 }),
      paper: pm({ color: 0xe2dccb, roughness: 0.9 }),
      dark: pm({ color: 0x1d1b19, roughness: 0.5 }),
      // Glows whether or not there's power.
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.32, 0.26) }),
      shade: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.35, 0.7), side: THREE.DoubleSide }),
    };
    for (const [mat, geo] of buildProps(this.game.level.props)) {
      const mesh = new THREE.Mesh(geo, mats[mat]);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
  }

  /** Doors: doorway doors in their frames, and doors hung on walls with something (or nothing) behind them. */
  private buildDoors(grime: THREE.Texture) {
    const L = this.game.level;
    const pm = (p: THREE.MeshStandardMaterialParameters) => surface('PROP', p, grime);
    const doorMat = pm({ color: 0x80745e, roughness: 0.6 });
    const frameMat = pm({ color: 0x3f362c, roughness: 0.55 });
    const knobMat = pm({ color: 0xb8b0a0, roughness: 0.3, metalness: 0.8 });
    const brickMat = pm({ map: T.brick(), roughness: 0.9 });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x010101 });
    const box = (parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    for (const d of L.doors) {
      const base = Math.atan2(-d.tz, d.tx); // local +x runs along the edge
      const front = -d.tz * d.nx + d.tx * d.nz; // local +z dotted with the door's normal
      const wall = d.kind !== 'swing';
      const off = wall ? 0.083 : 0;
      const depth = wall ? 0.05 : d.free ? 0.12 : 0.2;

      const frame = new THREE.Group();
      frame.position.set(d.mx, 0, d.mz);
      frame.rotation.y = base;
      for (const s of [-1, 1]) box(frame, frameMat, 0.07, d.h + 0.07, depth, s * (d.w / 2 + 0.035), d.y0 + (d.h + 0.07) / 2, front * off);
      box(frame, frameMat, d.w + 0.14, 0.07, depth, 0, d.y0 + d.h + 0.035, front * off);
      if (wall) {
        // What's behind it.
        const z = front * 0.081;
        if (d.variant === 'brick' || d.variant === 'high') box(frame, brickMat, d.w, d.h, 0.004, 0, d.y0 + d.h / 2, z);
        else if (d.variant === 'double') {
          box(frame, doorMat, d.w - 0.06, d.h - 0.04, 0.03, 0, d.y0 + (d.h - 0.04) / 2, front * 0.09);
          box(frame, knobMat, 0.05, 0.05, 0.05, d.w / 2 - 0.12, d.y0 + 1.0, front * 0.11);
        } else box(frame, voidMat, d.w, d.h, 0.004, 0, d.y0 + d.h / 2, z);
      }
      this.scene.add(frame);

      // The panel swings on a hinge at one end of the opening.
      const pivot = new THREE.Group();
      pivot.position.set(d.mx - d.tx * d.w / 2 + d.nx * off, d.y0, d.mz - d.tz * d.w / 2 + d.nz * off);
      pivot.rotation.y = base;
      const pz = wall ? front * 0.025 : 0;
      box(pivot, doorMat, d.w, d.h, 0.045, d.w / 2, d.h / 2, pz);
      for (const s of [-1, 1]) box(pivot, knobMat, 0.05, 0.05, 0.05, d.w - 0.09, Math.min(1.0, d.h * 0.5), pz + s * 0.035);
      this.scene.add(pivot);
      this.doorViews.push({ d, pivot, base, k: d.nx * d.tz - d.nz * d.tx, cur: 0 });
    }
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private rebuildWalls() {
    const L = this.game.level;
    const CS = L.CS;
    this.wallKeys = [];
    this.trimKeys = [];
    let outlets = 0;
    const tops = this.walls.geometry.getAttribute('aWalls') as THREE.InstancedBufferAttribute;
    // A slab along edge k, from a0 to a1 metres along it and y0 to y1 high.
    const piece = (k: number, a0: number, a1: number, y0: number, y1: number, trim: boolean) => {
      const s = L.edgeSegment(k);
      const mid = (a0 + a1) / 2;
      const x = s.horizontal ? s.x1 + mid : s.x1, z = s.horizontal ? s.z1 : s.z1 + mid;
      this.tmp.rotation.set(0, s.horizontal ? 0 : Math.PI / 2, 0);
      this.tmp.position.set(x, (y0 + y1) / 2, z);
      this.tmp.scale.set(a1 - a0, y1 - y0, 1);
      this.tmp.updateMatrix();
      tops.setX(this.wallKeys.length, y1);
      this.walls.setMatrixAt(this.wallKeys.length, this.tmp.matrix);
      this.wallKeys.push(k);
      if (trim) {
        this.tmp.position.set(x, 0.06, z);
        this.tmp.scale.set(a1 - a0 + 0.04, 1, 1);
        this.tmp.updateMatrix();
        this.trim.setMatrixAt(this.trimKeys.length, this.tmp.matrix);
        this.trimKeys.push(k);
      }
      this.tmp.scale.set(1, 1, 1);
    };
    for (let k = 0; k < L.edgeCount; k++) {
      const top = L.edgeTop(k);
      if (!L.isWall(k)) {
        const [a, b] = L.edgeCells(k);
        if (a < 0 || b < 0) continue;
        const lo = Math.min(L.ceil[a], L.ceil[b]);
        const d = L.doorOnEdge.get(k);
        if (d && d.kind === 'swing' && !d.free) {
          // A doorway: jambs either side and a lintel over the door.
          const half = CS / 2, gap = d.w / 2 + 0.07;
          piece(k, -0.08, half - gap, 0, top, true);
          piece(k, half + gap, CS + 0.08, 0, top, true);
          piece(k, half - gap, half + gap, d.h + 0.07, top, false);
        } else if (top - lo > 0.01) {
          // Where the ceiling steps up, the higher room's wall carries on above the opening.
          piece(k, -0.08, CS + 0.08, lo, top, false);
        }
        continue;
      }
      piece(k, -0.08, CS + 0.08, 0, top, true);
      const s = L.edgeSegment(k);
      const mx = (s.x1 + s.x2) / 2, mz = (s.z1 + s.z2) / 2;
      const ry = s.horizontal ? 0 : Math.PI / 2;
      // An outlet on roughly one wall face in ten, chosen by edge so it never moves.
      const h = hashString(`out${k}`);
      if (h % 10 === 0) {
        const side = (h >> 4) % 2 ? 1 : -1;
        const [a, b] = L.edgeCells(k);
        if ((side > 0 ? b : a) >= 0) {
          const nx = s.horizontal ? 0 : side * 0.085, nz = s.horizontal ? side * 0.085 : 0;
          const along = (((h >> 8) % 100) / 100 - 0.5) * 1.8;
          this.tmp.position.set(mx + nx + (s.horizontal ? along : 0), 0.38, mz + nz + (s.horizontal ? 0 : along));
          this.tmp.rotation.set(0, ry + (side < 0 ? Math.PI : 0), 0);
          this.tmp.updateMatrix();
          this.outlets.setMatrixAt(outlets++, this.tmp.matrix);
        }
      }
    }
    this.walls.count = this.wallKeys.length;
    this.trim.count = this.trimKeys.length;
    this.outlets.count = outlets;
    for (const m of [this.walls, this.trim, this.outlets]) m.instanceMatrix.needsUpdate = true;
    tops.needsUpdate = true;

    // Contact shadows: each floor/ceiling tile knows which of its sides are walled.
    const fw = this.floor.geometry.getAttribute('aWalls') as THREE.InstancedBufferAttribute;
    const cw = this.ceil.geometry.getAttribute('aWalls') as THREE.InstancedBufferAttribute;
    for (let c = 0; c < L.cells; c++) {
      const m = L.mask(c) ^ 15;
      fw.setX(c, m);
      cw.setX(c, m);
    }
    fw.needsUpdate = cw.needsUpdate = true;
    this.builtVersion = L.version;
  }

  /** Flickering brightness per circuit, from the game's blackout timers. */
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
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (L.version !== this.builtVersion) this.rebuildWalls();

    const circ = new Float32Array(L.circuitCount);
    for (let i = 0; i < circ.length; i++) circ[i] = this.circuitLevel(i, t);
    const setB = (mesh: THREE.InstancedMesh, i: number, v: number) =>
      (mesh.geometry.getAttribute('aBright') as THREE.InstancedBufferAttribute).setX(i, v);
    for (let c = 0; c < L.cells; c++) {
      this.cellBright[c] += (circ[L.circuit[c]] - this.cellBright[c]) * 0.35;
      setB(this.floor, c, this.cellBright[c]);
      setB(this.ceil, c, this.cellBright[c]);
    }
    const edgeB = (k: number) => {
      const [a, b] = L.edgeCells(k);
      return Math.max(a >= 0 ? this.cellBright[a] : 0, b >= 0 ? this.cellBright[b] : 0);
    };
    this.wallKeys.forEach((k, i) => setB(this.walls, i, edgeB(k)));
    this.trimKeys.forEach((k, i) => setB(this.trim, i, edgeB(k)));
    const texData = this.cellTex.image.data as Uint8Array;
    for (let c = 0; c < L.cells; c++) texData[c * 4] = Math.round(this.cellBright[c] * 255);
    this.cellTex.needsUpdate = true;

    // Doors swing towards where the game says they are; they slam faster than they open.
    for (const v of this.doorViews) {
      const target = v.d.open * v.k * 1.65;
      const speed = target === 0 ? 5 : 2.4;
      v.cur += Math.max(-speed * dt, Math.min(speed * dt, target - v.cur));
      v.pivot.rotation.y = v.base + v.cur;
    }
    this.pillarCells.forEach((c, i) => setB(this.pillars, i, this.cellBright[c]));
    for (const m of [this.floor, this.ceil, this.walls, this.trim, this.pillars]) {
      m.geometry.getAttribute('aBright').needsUpdate = true;
    }

    // Panels: on with their circuit, plus the odd tired flicker.
    this.panelCells.forEach((c, i) => {
      if (Math.random() < 0.0012) this.flicker[i] = -1.5;
      this.flicker[i] = Math.min(1, this.flicker[i] + 0.06);
      const fl = this.flicker[i] > 0 ? 1 : Math.random() < 0.5 ? 0.15 : 1;
      this.col.copy(PANEL_OFF).lerp(PANEL_ON, this.cellBright[c] * fl);
      this.panels.setColorAt(i, this.col);
    });
    if (this.panels.instanceColor) this.panels.instanceColor.needsUpdate = true;

    const m = g.monster;
    const human = this.viewer.role === 'human' ? g.wanderers[this.viewer.slot] : null;
    if (human) {
      // A human's eyes: lower, bobbing as they walk, ducking when they crouch.
      this.eye += ((human.crouch ? CFG.CROUCH_EYE : CFG.HUMAN_EYE) - this.eye) * Math.min(1, dt * 10);
      const bob = human.moving ? Math.sin(t * (human.sprint ? 13 : 9)) * (human.sprint ? 0.06 : 0.035) : 0;
      this.camera.position.set(human.x, this.eye + bob, human.z);
      this.camera.rotation.set(this.look.pitch, this.look.yaw, 0);
    } else {
      // The monster's eyes.
      const sway = m.moving ? Math.sin(t * 7) * 0.03 : 0;
      this.camera.position.set(m.x, CFG.EYE_HEIGHT + sway, m.z);
      this.camera.rotation.set(m.pitch, m.yaw, 0);
    }
    const vx = this.camera.position.x, vz = this.camera.position.z;
    this.camera.updateMatrixWorld();

    this.placeLights(vx, vz);
    this.placeFlashlights(t);
    this.creature.root.visible = !!human;
    if (human) this.creature.update(m.x, m.z, m.yaw, dt, t);

    const here = this.cellBright[L.cellAt(vx, vz)];
    // Night vision follows the blackout timer, not the flickering light level,
    // so it switches once: after the lights die, and off as they stutter back.
    const b = g.blackout[L.circuit[L.cellAt(m.x, m.z)]];
    const nvTarget = !human && b > 0.9 && b < CFG.BLACKOUT_TIME - 0.5;
    if (nvTarget !== this.nvOn) {
      this.nvOn = nvTarget;
      if (nvTarget) this.nvFlash = 1;
      this.onNightVision?.(nvTarget);
    }
    this.nightVision += ((nvTarget ? 1 : 0) - this.nightVision) * Math.min(1, dt * 5);
    this.nvFlash = Math.max(0, this.nvFlash - dt * 3);
    // Like an infrared illuminator: night vision brings its own light, reaching further.
    // Humans' eyes adjust a little to the dark; the monster sees much more.
    this.darkvision.intensity = human ? 0.35 * (1 - here) : 2.8 * (1 - here) + 0.15 + this.nightVision * 6;
    this.darkvision.distance = human ? 4 : 8 + this.nightVision * 6;
    this.darkvision.color.set(human ? 0x9aa4b8 : 0x6f86c0);

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(FOG_DARK).lerp(FOG_LIT, here);
    fog.density = 0.042 + (1 - here) * 0.03 - this.nightVision * 0.025;
    (this.scene.background as THREE.Color).copy(fog.color);

    // Dust drifts and wraps around the camera.
    const dp = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = dp.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += Math.sin(t * 0.3 + i) * 0.04 * dt;
      arr[i + 1] -= 0.02 * dt;
      arr[i + 2] += Math.cos(t * 0.27 + i) * 0.04 * dt;
      for (let a = 0; a < 3; a++) {
        const center = a === 0 ? vx : a === 1 ? CFG.WALL_H / 2 : vz;
        const half = a === 1 ? CFG.WALL_H / 2 : 6;
        let v = arr[i + a];
        if (v < center - half) v += half * 2;
        else if (v > center + half) v -= half * 2;
        arr[i + a] = v;
      }
    }
    dp.needsUpdate = true;
    this.dustMat.opacity = 0.45 * here + 0.05;
    // Dust follows whoever is looking.
    this.dust.position.set(0, 0, 0);

    this.syncChalk();
    this.syncPeople(dt, t);

    this.hunt.uniforms.time.value = t;
    this.hunt.uniforms.redden.value = redden;
    this.hunt.uniforms.seep.value = m.seepT > 0 ? 1 : 0;
    this.hunt.uniforms.nv.value = this.nightVision;
    this.hunt.uniforms.nvFlash.value = this.nvFlash;
    this.hunt.uniforms.fear.value = human ? Math.max(0, (human.fear - 25) / 75) : 0;
    this.hunt.uniforms.lens.value = human ? 0.4 : 1;
  }

  /** Move the light pool to the nearest lit fixtures the camera can see. */
  private placeLights(cx: number, cz: number) {
    const L = this.game.level;
    const cand: { i: number; d: number }[] = [];
    this.panelCells.forEach((c, i) => {
      if (this.cellBright[c] < 0.05) return;
      const p = L.center(c);
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d < POOL_REACH) cand.push({ i, d });
    });
    cand.sort((a, b) => a.d - b.d);
    const chosen: { i: number; d: number }[] = [];
    let cutoff = POOL_REACH;
    for (const k of cand) {
      const p = L.center(this.panelCells[k.i]);
      if (k.d > L.CS * 1.2 && !L.los(cx, cz, p.x, p.z)) continue;
      if (chosen.length === POOL) { cutoff = k.d; break; }
      chosen.push(k);
    }
    this.pool.forEach((light, j) => {
      const k = chosen[j];
      if (!k) { light.intensity = 0; return; }
      const c = this.panelCells[k.i];
      const p = L.center(c);
      light.position.set(p.x, L.ceil[c] - 0.25, p.z);
      const fl = this.flicker[k.i] > 0 ? 1 : 0.2;
      // Fade out as a fixture nears the cut-off, so lights hand over without popping.
      const fade = Math.min(1, Math.max(0, (cutoff - k.d) / 2.5));
      light.intensity = 5 * this.cellBright[c] * fl * fade;
    });
  }

  /** Point each lit flashlight from its owner's hands along their gaze. */
  private placeFlashlights(t: number) {
    const g = this.game;
    g.wanderers.forEach((w, i) => {
      const spot = this.spots[i];
      if (!spot) return;
      const on = w.active && w.flash;
      // A dying battery flickers.
      const flick = w.battery < 12 && Math.sin(t * 37 + i) > 0.6 ? 0.25 : 1;
      spot.intensity = on ? 32 * flick : 0;
      if (!on) return;
      const self = this.viewer.role === 'human' && this.viewer.slot === i;
      if (self) {
        const dir = new THREE.Vector3(0, -0.04, -1).applyQuaternion(this.camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        spot.position.copy(this.camera.position).addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.25, 0));
        spot.target.position.copy(this.camera.position).addScaledVector(dir, 10);
      } else {
        const fx = Math.cos(w.heading), fz = Math.sin(w.heading);
        const y = w.crouch ? 0.9 : 1.35;
        spot.position.set(w.x + fx * 0.3, y, w.z + fz * 0.3);
        spot.target.position.set(w.x + fx * 10, y - Math.sin(w.pitch) * 10 - 0.5, w.z + fz * 10);
      }
      spot.target.updateMatrixWorld();
    });
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Keep the audio listener (a child of the camera) current when the 3D view isn't drawn. */
  updateListener() {
    this.scene.updateMatrixWorld();
  }

  private syncChalk() {
    const g = this.game;
    for (const [cell, mesh] of this.chalkMeshes) {
      if (!g.chalk.has(cell)) { this.chalkGroup.remove(mesh); this.chalkMeshes.delete(cell); }
    }
    for (const [cell, mark] of g.chalk) {
      let mesh = this.chalkMeshes.get(cell);
      if (!mesh) {
        mesh = new THREE.Mesh(this.chalkGeo, new THREE.MeshStandardMaterial({
          map: this.chalkTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2,
        }));
        const p = g.level.center(cell);
        mesh.position.set(p.x, 0.015, p.z);
        this.chalkGroup.add(mesh);
        this.chalkMeshes.set(cell, mesh);
      }
      mesh.rotation.y = -mark.dir * Math.PI / 2;
      (mesh.material as THREE.MeshStandardMaterial).color.setScalar(0.2 + 0.8 * this.cellBright[cell]);
    }
  }

  private syncPeople(dt: number, t: number) {
    const g = this.game;
    for (const w of g.wanderers) {
      let p = this.people.get(w.id);
      if (!w.active) {
        if (p) { p.removeFrom(this.scene); this.people.delete(w.id); }
        continue;
      }
      if (!p) {
        p = new Person(w);
        p.addTo(this.scene);
        this.people.set(w.id, p);
      }
      // Night vision picks out bodies in the dark a little better than walls.
      p.update(w, dt, t, Math.max(this.cellBright[w.cell] ?? 1, this.nightVision * 0.5));
      p.setVisible(!(this.viewer.role === 'human' && this.viewer.slot === w.id));
    }
  }
}
