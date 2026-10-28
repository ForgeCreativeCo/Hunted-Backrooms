import './style.css';
import { Sound } from './audio';
import { CFG } from './config';
import { Game, GameEvents } from './game';
import { randomSeed } from './rng';
import { Aim, SenseView } from './sense';
import { World3D } from './world3d';

const $ = (id: string) => document.getElementById(id)!;

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || randomSeed();
if (!params.get('seed')) history.replaceState(null, '', `?seed=${encodeURIComponent(seed)}`);

// ---- HUD helpers ----

let toastTimer = 0;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), 2200);
}

function caption(text: string, who: string) {
  const box = $('captions');
  const line = document.createElement('div');
  line.innerHTML = who ? `<b>${who}:</b> “${text}”` : text;
  box.appendChild(line);
  while (box.children.length > 4) box.firstChild!.remove();
  setTimeout(() => { line.style.opacity = '0'; }, 4500);
  setTimeout(() => line.remove(), 5200);
}

let sound: Sound | null = null;
const events: GameEvents = {
  sound: (k, x, z, l) => sound?.play(k, x, z, l),
  caption: (text, w) => caption(text, w ? w.name : ''),
  toast,
};

const game = new Game(seed, events);
const huntCanvas = $('hunt') as HTMLCanvasElement;
const senseCanvas = $('sense') as HTMLCanvasElement;
const world = new World3D(game, huntCanvas);
const sense = new SenseView(senseCanvas, game);
sound = new Sound(game, world.camera, world.scene);

if (import.meta.env.DEV) Object.assign(window, { hum: { game, world, sense, sound } });

$('seedline').textContent = `Night 1 · seed ${seed}`;
$('quota').textContent = String(CFG.QUOTA);

// ---- Modes and views ----

type Mode = 'title' | 'playing' | 'paused' | 'catching' | 'over';
let mode: Mode = 'title';
let view: 'hunt' | 'sense' = 'hunt';
let aim: Aim = 'none';
let catchT = 0;
let switchingView = false;
const keys = new Set<string>();

function lock() {
  // Can be refused (embedded frames, too soon after Esc); clicking again retries.
  const p = huntCanvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
  p?.catch?.(() => {});
}

function start() {
  $('title').hidden = true;
  $('hud').hidden = false;
  sound?.resume();
  mode = 'playing';
  lock();
}

function setView(v: 'hunt' | 'sense') {
  view = v;
  aim = 'none';
  senseCanvas.hidden = v !== 'sense';
  $('crosshair').hidden = v !== 'hunt';
  $('prompt').hidden = v !== 'hunt';
  $('viewname').textContent = v === 'hunt' ? 'Sense view' : 'Hunt view';
  if (v === 'sense') {
    switchingView = true;
    document.exitPointerLock();
  } else {
    lock();
  }
}

function pause() {
  mode = 'paused';
  $('pause').hidden = false;
  keys.clear();
}

function resume() {
  $('pause').hidden = true;
  mode = 'playing';
  if (view === 'hunt') lock();
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === huntCanvas;
  if (!locked && mode === 'playing' && view === 'hunt' && !switchingView) pause();
  switchingView = false;
});

function forward() {
  return { x: -Math.sin(game.monster.yaw), z: -Math.cos(game.monster.yaw) };
}

// ---- Abilities ----

function act(err: string | null, ok?: string) {
  if (err) { toast(err); sound?.ui('deny'); }
  else if (ok) toast(ok);
}

function huntShiftEdge(): number {
  const m = game.monster;
  const f = forward();
  const hits = game.level.rayEdges(m.x, m.z, f.x, f.z, 7);
  const wall = hits.find((h) => h.wall);
  if (wall) return wall.key;
  const gap = hits.find((h) => !h.wall && h.t > 1);
  return gap ? gap.key : -1;
}

function useAbility(which: 'blackout' | 'shift') {
  if (view === 'sense') {
    aim = aim === which ? 'none' : which;
    sound?.ui('select');
    return;
  }
  const m = game.monster;
  if (which === 'blackout') {
    act(game.tryBlackout(game.level.circuit[game.level.cellAt(m.x, m.z)]), 'The lights die');
  } else {
    act(game.tryShift(huntShiftEdge()), 'The building moves');
  }
}

function senseClick(px: number, py: number) {
  const p = sense.toWorld(px, py);
  if (aim === 'blackout') {
    const err = game.tryBlackout(sense.pickCircuit(p.x, p.z));
    act(err, 'The lights die');
    if (!err) aim = 'none';
  } else if (aim === 'shift') {
    const err = game.tryShift(sense.pickEdge(p.x, p.z));
    act(err, 'The building moves');
    if (!err) aim = 'none';
  }
}

function tryCatch() {
  const f = forward();
  const w = game.catchable(f.x, f.z);
  if (!w) return;
  const pts = game.catch(w);
  mode = 'catching';
  catchT = 1.6;
  $('catch').hidden = false;
  $('catchpts').textContent = `+${pts} fear`;
}

// ---- Input ----

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (mode !== 'playing') return;
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'Tab': setView(view === 'hunt' ? 'sense' : 'hunt'); break;
    case 'Digit1': useAbility('blackout'); break;
    case 'Digit2': useAbility('shift'); break;
    case 'KeyQ': act(game.trySeep()); break;
    case 'KeyE': act(game.eraseChalk(), 'Chalk erased'); break;
    case 'KeyR': act(game.redrawChalk(), 'Arrow redrawn'); break;
    case 'Escape': aim = 'none'; break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === huntCanvas && mode === 'playing') {
    const m = game.monster;
    m.yaw -= e.movementX * 0.0022;
    m.pitch = Math.max(-1.3, Math.min(1.3, m.pitch - e.movementY * 0.0022));
  }
  sense.mouse = { x: e.clientX, y: e.clientY };
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).tagName === 'BUTTON') return;
  if (mode === 'title') return start();
  if (mode === 'paused') return resume();
  if (mode !== 'playing') return;
  if (view === 'sense') return senseClick(e.clientX, e.clientY);
  if (document.pointerLockElement !== huntCanvas) lock();
  tryCatch();
});

window.addEventListener('resize', () => {
  world.resize();
  sense.resize();
});

$('replay').addEventListener('click', () => { location.search = `?seed=${encodeURIComponent(seed)}`; });
$('newnight').addEventListener('click', () => { location.search = `?seed=${encodeURIComponent(randomSeed())}`; });

// ---- HUD ----

function clockText(t: number) {
  const minutes = Math.floor((t / CFG.NIGHT_SECONDS) * 360);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h === 0 ? 12 : h}:${String(m).padStart(2, '0')} AM`;
}

function updateHud() {
  const g = game;
  $('clock').textContent = clockText(g.t);
  $('sub').textContent = `Night 1 · Level 0 · seed ${seed}`;
  $('score').textContent = `FEAR ${g.score} / ${CFG.QUOTA}`;
  const stars = CFG.STARS.filter((s) => g.score >= s).length;
  $('stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('roster').innerHTML = g.wanderers.map((w) => {
    const s = w.caught ? 'caught' : w.escaped ? 'escaped' : !w.entered ? `arrives ${clockText(w.enterAt)}` : 'somewhere';
    return `${w.name} · ${s}`;
  }).join('<br>');
  $('seen').classList.toggle('on', g.monster.seen);
  ($('dreadfill') as HTMLElement).style.width = `${g.dread}%`;
  $('dreadnum').textContent = String(Math.floor(g.dread));
  $('ab-blackout').classList.toggle('ready', g.dread >= CFG.BLACKOUT_COST);
  $('ab-shift').classList.toggle('ready', g.dread >= CFG.SHIFT_COST);
  $('ab-blackout').classList.toggle('aiming', aim === 'blackout');
  $('ab-shift').classList.toggle('aiming', aim === 'shift');
  const m = g.monster;
  $('ab-seep').classList.toggle('ready', m.seepT > 0 || m.seepCD <= 0);
  $('ab-seep').querySelector('i')!.textContent = m.seepT > 0 ? `${m.seepT.toFixed(1)}s` : m.seepCD > 0 ? `${m.seepCD.toFixed(0)}s` : 'free';

  if (view === 'hunt') {
    const f = forward();
    const w = g.catchable(f.x, f.z);
    $('crosshair').classList.toggle('catch', !!w);
    let prompt = '';
    if (w) prompt = `CLICK — take ${w.name} · fear ${Math.round(w.fear)}`;
    else if (g.chalkInReach() >= 0) prompt = 'E erase · R redraw the chalk arrow';
    $('prompt').textContent = prompt;
  }
}

function showEnd() {
  const r = game.result!;
  mode = 'over';
  document.exitPointerLock();
  const fed = r.score >= r.quota;
  $('endtitle').textContent = fed ? 'Fed' : 'Hungry';
  $('endsummary').textContent =
    `${r.reason === 'dawn' ? 'Dawn came.' : 'The level is empty.'} Harvested ${r.score} fear of ${r.quota} needed · ` +
    `caught ${r.caught} · escaped ${r.escaped}.` + (fed ? '' : ' Replay the night.');
  $('endstars').textContent = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  $('end').hidden = false;
}

// ---- Loop ----

let last = performance.now();
let hudT = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  if (mode === 'playing') {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let vx: number, vz: number;
    if (view === 'hunt') {
      const fw = forward();
      vx = fw.x * f + -fw.z * r;
      vz = fw.z * f + fw.x * r;
    } else {
      vx = r;
      vz = -f;
      if (f || r) game.monster.yaw = Math.atan2(-vx, -vz);
    }
    game.moveMonster(vx, vz, dt);
    game.update(dt);
    if (game.over) showEnd();
  } else if (mode === 'catching') {
    catchT -= dt;
    if (catchT <= 0) {
      $('catch').hidden = true;
      mode = 'playing';
      if (game.over) showEnd();
    }
  }

  world.update(t, mode === 'catching' ? 1 : game.monster.seen ? 0.25 : 0);
  sound?.update((i) => world.circuitLevel(i, t));
  if (view === 'hunt' || mode === 'title') world.render();
  else {
    world.updateListener();
    sense.draw(t, aim, (i) => world.circuitLevel(i, t));
  }

  hudT -= dt;
  if (hudT <= 0 && mode !== 'title') { hudT = 0.1; updateHud(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
