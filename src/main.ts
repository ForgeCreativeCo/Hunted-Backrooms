import './style.css';
import { Sound } from './audio';
import { CFG } from './config';
import { Game, GameEvents } from './game';
import { Lobby, StartMsg } from './lobby';
import { Net } from './net/client';
import { applySnapshot, NetEvent, Role } from './net/protocol';
import { randomSeed } from './rng';
import { Aim, SenseView } from './sense';
import { World3D } from './world3d';

const $ = (id: string) => document.getElementById(id)!;

const params = new URLSearchParams(location.search);
const urlSeed = params.get('seed');

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
  if (who) {
    const b = document.createElement('b');
    b.textContent = `${who}:`;
    line.append(b, ` “${text}”`);
  } else {
    line.textContent = text;
  }
  box.appendChild(line);
  while (box.children.length > 4) box.firstChild!.remove();
  setTimeout(() => { line.style.opacity = '0'; }, 4500);
  setTimeout(() => line.remove(), 5200);
}

// ---- Sessions ----
// A session is one night: solo (this page runs the game) or online (the server
// runs it and this page mirrors it). Online you're either the monster or a human.

interface Session {
  net: Net | null;
  game: Game;
  world: World3D;
  sense: SenseView;
  sound: Sound;
  role: Role;
  slot: number;
  seed: string;
  spectating: boolean;
  placed: boolean;
  sendT: number;
  /** Human players this night; they hold the first wanderer slots. */
  humans: number;
  off: (() => void) | null;
}

let huntCanvas = $('hunt') as HTMLCanvasElement;
const senseCanvas = $('sense') as HTMLCanvasElement;
let S: Session;

function makeSession(seed: string, role: Role, slot: number, net: Net | null, players?: string[]): Session {
  const events: GameEvents = {
    sound: (k, x, z, l, who) => S?.sound.play(k, x, z, l, who),
    caption: (text, w) => caption(text, w ? w.name : ''),
    toast,
  };
  const game = new Game(seed, events, { players });
  const world = new World3D(game, huntCanvas);
  const sense = new SenseView(senseCanvas, game);
  const sound = new Sound(game, world.camera, world.scene);
  world.onNightVision = (on) => sound.nightVision(on);
  if (role === 'human') world.viewer = { role: 'human', slot };
  const s: Session = { net, game, world, sense, sound, role, slot, seed, spectating: false, placed: role !== 'human', sendT: 0, humans: players?.length ?? 0, off: null };
  if (import.meta.env.DEV) Object.assign(window, { hum: s });
  return s;
}

function endSession() {
  S.off?.();
  S.sound.dispose();
  S.world.dispose();
  // A fresh canvas for the next renderer.
  const fresh = huntCanvas.cloneNode() as HTMLCanvasElement;
  huntCanvas.replaceWith(fresh);
  huntCanvas = fresh;
}

const self = () => (S.role === 'human' ? S.game.wanderers[S.slot] : null);

S = makeSession(urlSeed || randomSeed(), 'monster', -1, null);
$('seedline').textContent = `Solo night · seed ${S.seed}`;
$('quota').textContent = String(CFG.QUOTA);

// ---- Modes and views ----

type Mode = 'title' | 'menu' | 'playing' | 'paused' | 'catching' | 'over';
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

function setRoleClass(r: 'monster' | 'human' | 'spectator') {
  document.body.classList.remove('role-monster', 'role-human', 'role-spectator');
  document.body.classList.add(`role-${r}`);
}

function beginPlay() {
  $('title').hidden = true;
  $('end').hidden = true;
  $('hud').hidden = false;
  $('spectate').hidden = true;
  setRoleClass(S.role);
  S.sound.resume();
  mode = 'playing';
  setView('hunt');
}

function startSolo() {
  if (!urlSeed) history.replaceState(null, '', `?seed=${encodeURIComponent(S.seed)}`);
  beginPlay();
}

function startOnline(msg: StartMsg) {
  endSession();
  S = makeSession(msg.seed, msg.role, msg.slot, lobby.net, msg.players);
  const net = lobby.net;
  S.off = net.on((m) => {
    const g = S.game;
    switch (m.t) {
      case 'snap': {
        applySnapshot(g, m.s, S);
        const me = self();
        const a = m.s.w[S.slot];
        if (me && !S.placed && a && a[8] & 1) {
          // Our spawn point, chosen by the server.
          me.x = a[0];
          me.z = a[1];
          me.cell = g.level.cellAt(me.x, me.z);
          S.world.look.yaw = Math.atan2(-Math.cos(a[2]), -Math.sin(a[2]));
          S.placed = true;
        }
        for (const e of m.ev) netEvent(e);
        break;
      }
      case 'correct': {
        const body = self() ?? g.monster;
        body.x = m.x;
        body.z = m.z;
        break;
      }
      case 'actErr':
        act(m.msg);
        break;
      case 'caught':
        showCatch(`+${m.pts} fear`);
        break;
      case 'end':
        g.result = m.result;
        showEnd(m.reason);
        break;
    }
  });
  net.onClose = () => {
    lobby.lost();
    if (mode === 'over' || !S.net) return;
    const ws = S.game.wanderers;
    S.game.result = {
      score: S.game.score, quota: CFG.QUOTA, stars: 0, reason: 'empty',
      caught: ws.filter((w) => w.caught).length, escaped: ws.filter((w) => w.escaped).length,
    };
    showEnd('Lost connection to the game server');
  };
  beginPlay();
}

/** Something the server's game raised this tick. */
function netEvent(e: NetEvent) {
  const g = S.game;
  const who = (id: number) => (id >= 0 ? g.wanderers[id] : undefined);
  switch (e[0]) {
    case 's':
      S.sound.play(e[1], e[2], e[3], e[4], who(e[5]));
      break;
    case 'c': {
      // The monster hears every voice; a human only hears people nearby.
      const w = who(e[2]);
      const me = self();
      if (me && w && Math.hypot(w.x - me.x, w.z - me.z) > 14) break;
      caption(e[1], w ? w.name : '');
      break;
    }
    case 't':
      toast(e[1]);
      break;
    case 'p': {
      g.pulses.push({ x: e[1], z: e[2], maxR: e[3], age: 0, life: 1.1, fear: e[4] });
      const w = who(e[5]);
      if (w) {
        w.lastHeardT = g.t;
        w.heardX = e[1];
        w.heardZ = e[2];
      }
      break;
    }
  }
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
  if (!locked && mode === 'playing' && view === 'hunt' && !switchingView && !S.spectating) pause();
  switchingView = false;
});

/** Caught or escaped: watch the rest of the night from above. */
function spectate(how: 'taken' | 'escaped') {
  S.spectating = true;
  setRoleClass('spectator');
  if (how === 'taken') showCatch('TAKEN');
  $('spectate').hidden = false;
  $('spectate').textContent = how === 'taken'
    ? 'You were taken. Watching the rest of the night.'
    : 'You escaped. Watching the rest of the night.';
  setView('sense');
}

function forward() {
  return { x: -Math.sin(S.game.monster.yaw), z: -Math.cos(S.game.monster.yaw) };
}

// ---- Actions ----

function act(err: string | null, ok?: string) {
  if (err) { toast(err); S.sound.ui('deny'); }
  else if (ok) toast(ok);
}

function huntShiftEdge(): number {
  const m = S.game.monster;
  const f = forward();
  const hits = S.game.level.rayEdges(m.x, m.z, f.x, f.z, 7);
  const wall = hits.find((h) => h.wall);
  if (wall) return wall.key;
  const gap = hits.find((h) => !h.wall && h.t > 1);
  return gap ? gap.key : -1;
}

function blackout(circuit: number) {
  if (S.net) S.net.send({ t: 'act', a: 'blackout', circuit });
  else act(S.game.tryBlackout(circuit), 'The lights die');
}

function shift(key: number) {
  if (S.net) S.net.send({ t: 'act', a: 'shift', key });
  else act(S.game.tryShift(key), 'The building moves');
}

function simple(a: 'seep' | 'erase' | 'redraw') {
  if (S.net) return S.net.send({ t: 'act', a });
  const g = S.game;
  if (a === 'seep') act(g.trySeep());
  else if (a === 'erase') act(g.eraseChalk(), 'Chalk erased');
  else act(g.redrawChalk(), 'Arrow redrawn');
}

function useAbility(which: 'blackout' | 'shift') {
  if (view === 'sense') {
    aim = aim === which ? 'none' : which;
    S.sound.ui('select');
    return;
  }
  const m = S.game.monster;
  if (which === 'blackout') blackout(S.game.level.circuit[S.game.level.cellAt(m.x, m.z)]);
  else shift(huntShiftEdge());
}

function senseClick(px: number, py: number) {
  const p = S.sense.toWorld(px, py);
  if (aim === 'blackout') blackout(S.sense.pickCircuit(p.x, p.z));
  else if (aim === 'shift') shift(S.sense.pickEdge(p.x, p.z));
  aim = 'none';
}

function showCatch(text: string) {
  mode = 'catching';
  catchT = 1.6;
  $('catch').hidden = false;
  $('catchpts').textContent = text;
}

function tryCatch() {
  const f = forward();
  if (S.net) return S.net.send({ t: 'act', a: 'catch', fx: f.x, fz: f.z });
  const w = S.game.catchable(f.x, f.z);
  if (w) showCatch(`+${S.game.catch(w)} fear`);
}

// ---- Input ----

window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && mode !== 'menu') e.preventDefault();
  if (mode !== 'playing' || e.repeat) return;
  keys.add(e.code);
  if (S.spectating) return;
  if (S.role === 'human') {
    const me = self()!;
    switch (e.code) {
      case 'KeyF': S.net?.send({ t: 'act', a: 'flash' }); break;
      case 'KeyE': S.net?.send({ t: 'act', a: 'chalk' }); break;
      case 'KeyC': me.crouch = !me.crouch; break;
    }
    return;
  }
  switch (e.code) {
    case 'Tab': setView(view === 'hunt' ? 'sense' : 'hunt'); break;
    case 'Digit1': useAbility('blackout'); break;
    case 'Digit2': useAbility('shift'); break;
    case 'KeyQ': simple('seep'); break;
    case 'KeyE': simple('erase'); break;
    case 'KeyR': simple('redraw'); break;
    case 'Escape': aim = 'none'; break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === huntCanvas && mode === 'playing') {
    const look = S.role === 'human' ? S.world.look : S.game.monster;
    look.yaw -= e.movementX * 0.0022;
    look.pitch = Math.max(-1.3, Math.min(1.3, look.pitch - e.movementY * 0.0022));
  }
  S.sense.mouse = { x: e.clientX, y: e.clientY };
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, .overlay:not(#pause)')) return;
  if (mode === 'paused') return resume();
  if (mode !== 'playing' || S.spectating) return;
  if (view === 'sense') return senseClick(e.clientX, e.clientY);
  if (document.pointerLockElement !== huntCanvas) lock();
  if (S.role === 'monster') tryCatch();
});
$('pause').addEventListener('mousedown', () => { if (mode === 'paused') resume(); });

window.addEventListener('resize', () => {
  S.world.resize();
  S.sense.resize();
});

// Menus.
const lobby = new Lobby(startOnline, () => { mode = 'title'; $('title').hidden = false; });
$('solo').addEventListener('click', startSolo);
$('multi').addEventListener('click', () => {
  mode = 'menu';
  $('title').hidden = true;
  lobby.openMenu();
});
$('replay').addEventListener('click', () => { location.search = `?seed=${encodeURIComponent(S.seed)}`; });
$('newnight').addEventListener('click', () => { location.search = `?seed=${encodeURIComponent(randomSeed())}`; });
$('tolobby').addEventListener('click', () => {
  $('end').hidden = true;
  $('hud').hidden = true;
  senseCanvas.hidden = true;
  mode = 'menu';
  lobby.showLobby();
});

// ---- HUD ----

function clockText(t: number) {
  const minutes = Math.floor((t / CFG.NIGHT_SECONDS) * 360);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h === 0 ? 12 : h}:${String(m).padStart(2, '0')} AM`;
}

function bar(id: string, v: number) {
  const el = $(id) as HTMLElement;
  el.style.width = `${Math.max(0, Math.min(100, v))}%`;
  el.classList.toggle('low', v < 20);
}

function updateHud() {
  const g = S.game;
  $('clock').textContent = clockText(g.t);
  $('sub').textContent = S.net ? `Online · ${S.role === 'monster' ? 'you are the monster' : 'you are human'}` : `Night 1 · Level 0 · seed ${S.seed}`;
  const stars = CFG.STARS.filter((s) => g.score >= s).length;
  $('stars').textContent = S.role === 'monster' ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  const me = self();

  if (me) {
    $('score').textContent = `IT HAS FED ${g.score} / ${CFG.QUOTA}`;
    $('roster').innerHTML = '';
    for (const w of g.wanderers.slice(0, S.humans)) {
      const line = document.createElement('div');
      line.textContent = `${w.name}${w === me ? ' (you)' : ''} · ${w.caught ? 'taken' : w.escaped ? 'escaped' : 'out there'}`;
      $('roster').appendChild(line);
    }
    $('seen').classList.remove('on');
    bar('stamfill', me.stamina);
    bar('battfill', me.battery);
    $('hk-flash').classList.toggle('ready', me.battery > 0);
    $('prompt').textContent = me.exhausted ? 'Out of breath' : '';
    return;
  }

  $('score').textContent = `FEAR ${g.score} / ${CFG.QUOTA}`;
  $('roster').innerHTML = '';
  for (const w of g.wanderers) {
    const line = document.createElement('div');
    line.textContent = `${w.name} · ${w.caught ? 'caught' : w.escaped ? 'escaped' : !w.entered ? `arrives ${clockText(w.enterAt)}` : 'somewhere'}`;
    $('roster').appendChild(line);
  }
  $('seen').classList.toggle('on', g.monster.seen);
  bar('dreadfill', g.dread);
  ($('dreadfill') as HTMLElement).classList.remove('low');
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
    if (g.inAnyBeam(m.x, m.z)) prompt = 'A light is on you';
    else if (w) prompt = `CLICK — take ${w.name} · fear ${Math.round(w.fear)}`;
    else if (g.chalkInReach() >= 0) prompt = 'E erase · R redraw the chalk arrow';
    $('prompt').textContent = prompt;
  }
}

function showEnd(reason?: string) {
  const r = S.game.result!;
  mode = 'over';
  document.exitPointerLock();
  $('catch').hidden = true;
  const fed = r.score >= r.quota;
  const me = self();
  const online = !!S.net;
  $('endtitle').textContent = me
    ? me.escaped ? 'You escaped' : me.caught ? 'You were taken' : fed ? 'It fed' : 'You survived'
    : fed ? 'Fed' : 'Hungry';
  $('endsummary').textContent = `${reason ? `${reason}. ` : r.reason === 'dawn' ? 'Dawn came. ' : 'The level is empty. '}` +
    `${me ? 'The thing' : 'You'} harvested ${r.score} fear of ${r.quota} needed · caught ${r.caught} · escaped ${r.escaped}.` +
    (online ? (fed ? ' The monster wins.' : ' The humans win.') : fed ? '' : ' Replay the night.');
  $('endstars').textContent = me ? '' : '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  $('replay').hidden = online;
  $('newnight').hidden = online;
  $('tolobby').hidden = !online;
  $('end').hidden = false;
}

// ---- Loop ----

let last = performance.now();
let hudT = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const g = S.game;
  const me = self();

  if (mode === 'playing' && !S.spectating) {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (me) {
      // A human: move relative to where you look.
      const yaw = S.world.look.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      me.heading = Math.atan2(fz, fx);
      me.pitch = S.world.look.pitch;
      me.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (S.placed) g.moveHuman(me, fx * f - fz * r, fz * f + fx * r, dt);
    } else {
      let vx: number, vz: number;
      if (view === 'hunt') {
        const fw = forward();
        vx = fw.x * f - fw.z * r;
        vz = fw.z * f + fw.x * r;
      } else {
        vx = r;
        vz = -f;
        if (f || r) g.monster.yaw = Math.atan2(-vx, -vz);
      }
      g.moveMonster(vx, vz, dt);
    }
    if (!S.net) {
      g.update(dt);
      if (g.over) showEnd();
    }
  } else if (mode === 'catching') {
    catchT -= dt;
    if (catchT <= 0) {
      $('catch').hidden = true;
      mode = 'playing';
      if (!S.net && g.over) showEnd();
    }
  }

  if (S.net && mode !== 'over') {
    // Online: the server runs the night; we send where we are 20 times a second.
    for (const p of g.pulses) p.age += dt;
    g.pulses = g.pulses.filter((p) => p.age < p.life);
    S.sendT -= dt;
    if (S.sendT <= 0 && !S.spectating && S.placed) {
      S.sendT = 0.05;
      if (me) S.net.send({ t: 'pos', x: me.x, z: me.z, yaw: S.world.look.yaw, pitch: S.world.look.pitch, sprint: me.sprint, crouch: me.crouch });
      else S.net.send({ t: 'pos', x: g.monster.x, z: g.monster.z, yaw: g.monster.yaw, pitch: g.monster.pitch });
    }
    if (me && !S.spectating && me.entered && (me.caught || me.escaped)) spectate(me.caught ? 'taken' : 'escaped');
    if (me && !S.spectating) S.sound.heartbeat(Math.max(0, (me.fear - 25) / 75));
  }

  S.world.update(t, mode === 'catching' && S.role === 'monster' ? 1 : g.monster.seen && S.role === 'monster' ? 0.25 : 0);
  S.sound.update((i) => S.world.circuitLevel(i, t));
  if (view === 'hunt' || mode === 'title' || mode === 'menu') S.world.render();
  else {
    S.world.updateListener();
    S.sense.draw(t, aim, (i) => S.world.circuitLevel(i, t), S.spectating);
  }

  hudT -= dt;
  if (hudT <= 0 && mode !== 'title' && mode !== 'menu') { hudT = 0.1; updateHud(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
