import './style.css';
import { Sound } from './audio';
import { CFG } from './config';
import { Game, GameEvents, levelName, PartyMember, rotateYaw } from './game';
import { Lobby, StartMsg } from './lobby';
import { MonsterAI } from './monsterAI';
import { Net } from './net/client';
import { applySnapshot, NetEvent, Role } from './net/protocol';
import { loadLowGfx, saveLowGfx } from './quality';
import { randomSeed } from './rng';
import { Aim, SenseView } from './sense';
import { isTouchDevice, TouchControls } from './touch';
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
  /** Solo as a human: the monster plays itself. */
  ai: MonsterAI | null;
  off: (() => void) | null;
}

// ---- Found footage setting ----

let footage = true;
try { footage = localStorage.getItem('hum-footage') !== '0'; } catch { /* storage blocked */ }
const footageBoxes = [...document.querySelectorAll<HTMLInputElement>('.opt-footage')];
for (const box of footageBoxes) {
  box.checked = footage;
  box.addEventListener('change', () => {
    footage = box.checked;
    for (const b of footageBoxes) b.checked = footage;
    try { localStorage.setItem('hum-footage', footage ? '1' : '0'); } catch { /* storage blocked */ }
    if (S) S.world.footage = footage;
    syncCam();
  });
}

// ---- Low graphics setting (on by default for weak tablets) ----

let lowGfx = loadLowGfx();
const lowGfxBoxes = [...document.querySelectorAll<HTMLInputElement>('.opt-lowgfx')];
for (const box of lowGfxBoxes) {
  box.checked = lowGfx;
  box.addEventListener('change', () => {
    lowGfx = box.checked;
    for (const b of lowGfxBoxes) b.checked = lowGfx;
    saveLowGfx(lowGfx);
    if (S) S.world.setLow(lowGfx);
  });
}

let huntCanvas = $('hunt') as HTMLCanvasElement;
const senseCanvas = $('sense') as HTMLCanvasElement;
let S: Session;

/**
 * A level of a run. `seed` is the run's seed; deeper levels pass their depth
 * and the party that came down from the level above.
 */
function makeSession(seed: string, role: Role, slot: number, net: Net | null, players?: string[], depth = 1, party: PartyMember[] | null = null): Session {
  const events: GameEvents = {
    sound: (k, x, z, l, who) => S?.sound.play(k, x, z, l, who),
    caption: (text, w) => caption(text, w ? w.name : ''),
    toast,
  };
  const game = new Game(seed, events, { players, depth, party: party ?? undefined });
  const world = new World3D(game, huntCanvas, lowGfx);
  const sense = new SenseView(senseCanvas, game);
  const sound = new Sound(game, world.camera, world.scene);
  world.onNightVision = (on) => {
    sound.nightVision(on);
    $('nightshot').hidden = !on;
  };
  world.footage = footage;
  $('nightshot').hidden = true;
  if (role === 'human' && slot >= 0) world.viewer = { role: 'human', slot };
  const s: Session = { net, game, world, sense, sound, role, slot, seed, spectating: false, placed: role !== 'human', sendT: 0, humans: players?.length ?? 0, ai: null, off: null };
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
$('seedline').textContent = `Solo run · seed ${S.seed}`;
$('quota').textContent = String(CFG.QUOTA);

// ---- Modes and views ----

type Mode = 'title' | 'menu' | 'playing' | 'paused' | 'catching' | 'over';
let mode: Mode = 'title';
let view: 'hunt' | 'sense' = 'hunt';
let aim: Aim = 'none';
let catchT = 0;
let switchingView = false;
const keys = new Set<string>();

// Touch: phones and tablets play with on-screen controls instead of pointer lock.
// A touchscreen laptop switches on its first touch and back on its next mouse click.
let touchMode = false;
function setTouchMode(on: boolean) {
  touchMode = on;
  document.body.classList.toggle('touch', on);
}
setTouchMode(isTouchDevice());
window.addEventListener('touchstart', () => { if (!touchMode) setTouchMode(true); }, { capture: true, passive: true });
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && touchMode && !isTouchDevice()) setTouchMode(false);
}, true);
// Phones only let sound start inside a tap, and an online night starts on the host's.
const unlockAudio = () => { if (mode !== 'title' && mode !== 'menu') S.sound.resume(); };
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('touchend', unlockAudio, true);

/** On a phone, go fullscreen and sideways when a game is chosen (needs a tap; not every browser allows it). */
function goFullscreen() {
  if (!touchMode || document.fullscreenElement) return;
  const el = document.documentElement;
  el.requestFullscreen?.({ navigationUI: 'hide' })
    .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}

function lock() {
  if (touchMode) return;
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

// ---- Solo: monster or human ----

let soloAs: Role = 'monster';
try { if (localStorage.getItem('hum-solo-as') === 'human') soloAs = 'human'; } catch { /* storage blocked */ }
function pickSolo(r: Role) {
  soloAs = r;
  document.body.classList.toggle('solo-human', r === 'human');
  document.body.classList.toggle('solo-monster', r === 'monster');
  for (const b of document.querySelectorAll<HTMLButtonElement>('.pick button')) {
    b.classList.toggle('on', b.dataset.as === r);
    b.setAttribute('aria-checked', String(b.dataset.as === r));
  }
  try { localStorage.setItem('hum-solo-as', r); } catch { /* storage blocked */ }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.pick button')) {
  b.addEventListener('click', () => pickSolo(b.dataset.as as Role));
}
pickSolo(soloAs);

function startSolo() {
  if (!urlSeed) history.replaceState(null, '', `?seed=${encodeURIComponent(S.seed)}`);
  if (soloAs === 'human') {
    let name = '';
    try { name = localStorage.getItem('hum-name') ?? ''; } catch { /* storage blocked */ }
    const seed = S.seed;
    endSession();
    S = makeSession(seed, 'human', 0, null, [name || 'You']);
    S.ai = new MonsterAI(S.game);
  }
  beginPlay();
}

let soloReason = '';
/**
 * Solo as a human, the level is over for you once you're out of it. Found an
 * exit: you go down, with whoever got out before you. Taken: the run is over.
 */
function soloOut(me: { caught: boolean }) {
  const g = S.game;
  const r = g.finish('empty');
  if (me.caught) g.result = { ...r, survivors: [] };
  S.spectating = true;
  soloReason = me.caught ? 'It found you' : 'You found an exit';
  if (me.caught) showCatch('TAKEN');
  else showEnd();
}

/** Solo: the survivors of the level just ended arrive in the next one, and so does the monster. */
function goDeeper() {
  const r = S.game.result;
  if (!r || !r.survivors.length || S.net) return;
  const { seed, role } = S;
  const players = r.survivors.filter((p) => p.player).map((p) => p.name);
  endSession();
  S = makeSession(seed, role, role === 'human' ? 0 : -1, null, players, r.depth + 1, r.survivors);
  if (role === 'human') S.ai = new MonsterAI(S.game);
  soloReason = '';
  beginPlay();
  toast(`${levelName(S.game.depth)}`);
}

function startOnline(msg: StartMsg) {
  endSession();
  S = makeSession(msg.seed, msg.role, msg.slot, lobby.net, msg.players, msg.depth, msg.party);
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
        showEnd(m.reason, m.next);
        break;
    }
  });
  net.onClose = () => {
    lobby.lost();
    if (mode === 'over' || !S.net) return;
    S.game.result = { ...S.game.finish('empty'), survivors: [] };
    showEnd('Lost connection to the game server');
  };
  beginPlay();
  // A human who didn't get out of the level above watches the rest of the run.
  if (S.role === 'human' && S.slot < 0) {
    S.spectating = true;
    setRoleClass('spectator');
    $('spectate').hidden = false;
    $('spectate').textContent = `You were lost on the level above. Watching the others on ${levelName(S.game.depth)}.`;
    setView('sense');
  } else toast(levelName(S.game.depth));
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
  document.body.classList.toggle('view-sense', v === 'sense');
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
    ? 'You were taken. Watching the rest of the run.'
    : 'You found an exit. Watching until this level ends; then you go deeper.';
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
  press(e.code);
});

/** One key's action, from the keyboard or a touch button. */
function press(code: string) {
  if (mode !== 'playing' || S.spectating) return;
  if (S.role === 'human') {
    const me = self()!;
    switch (code) {
      case 'KeyF':
        if (S.net) S.net.send({ t: 'act', a: 'flash' });
        else act(S.game.toggleFlash(me));
        break;
      case 'KeyE':
        if (S.net) S.net.send({ t: 'act', a: 'chalk' });
        else act(S.game.drawChalk(me), 'You draw an arrow');
        break;
      case 'KeyC': me.crouch = !me.crouch; break;
    }
    return;
  }
  switch (code) {
    case 'Tab': setView(view === 'hunt' ? 'sense' : 'hunt'); break;
    case 'Digit1': useAbility('blackout'); break;
    case 'Digit2': useAbility('shift'); break;
    case 'KeyQ': simple('seep'); break;
    case 'KeyE': simple('erase'); break;
    case 'KeyR': simple('redraw'); break;
    case 'Escape': aim = 'none'; break;
  }
}
window.addEventListener('keyup', (e) => keys.delete(e.code));

// ---- Touch input ----

const touch = new TouchControls($('touch'), $('stick'), $('knob'));
touch.onLook = (dx, dy) => {
  if (mode !== 'playing' || view !== 'hunt' || S.spectating) return;
  const look = S.role === 'human' ? S.world.look : S.game.monster;
  look.yaw -= dx * 0.0055;
  look.pitch = Math.max(-1.3, Math.min(1.3, look.pitch - dy * 0.0055));
};
touch.onTap = (x, y) => {
  if (mode !== 'playing' || S.spectating) return;
  if (view === 'sense') senseClick(x, y);
  else if (S.role === 'monster') tryCatch();
};
for (const b of document.querySelectorAll<HTMLButtonElement>('#touch [data-key]')) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const k = b.dataset.key!;
    if (k !== 'catch') press(k);
    else if (mode === 'playing' && !S.spectating && view === 'hunt') tryCatch();
  });
}
$('t-pause').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (mode === 'playing') pause();
});
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
  if ((e.target as HTMLElement).closest('button, input, label, .overlay:not(#pause)')) return;
  if (mode === 'paused') return resume();
  if (mode !== 'playing' || S.spectating) return;
  if (view === 'sense') return senseClick(e.clientX, e.clientY);
  if (document.pointerLockElement !== huntCanvas) lock();
  if (S.role === 'monster') tryCatch();
});
$('pause').addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement).closest('label')) return; // the settings toggle
  if (mode === 'paused') resume();
});

window.addEventListener('resize', () => {
  S.world.resize();
  S.sense.resize();
});

// Menus.
const lobby = new Lobby(startOnline, () => { mode = 'title'; $('title').hidden = false; });
$('solo').addEventListener('click', () => { goFullscreen(); startSolo(); });
$('multi').addEventListener('click', () => {
  goFullscreen();
  mode = 'menu';
  $('title').hidden = true;
  lobby.openMenu();
});
$('deeper').addEventListener('click', goDeeper);
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

/** Show the camcorder overlay while looking through the hunt view with the look on. */
let camShown = false;
function syncCam() {
  const show = footage && view === 'hunt' && !S?.spectating && (mode === 'playing' || mode === 'paused' || mode === 'catching');
  if (show === camShown) return;
  camShown = show;
  $('cam').hidden = !show;
  document.body.classList.toggle('footage', show);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function updateCam(t: number) {
  // The tape counter runs with the night; the date stamp was never set right.
  const s = Math.floor(t);
  $('tape').textContent = `SP ${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const d = new Date();
  const [hm, ap] = clockText(t).split(' ');
  $('stamp').innerHTML = `${ap} ${hm}<br>${MONTHS[d.getMonth()]}. ${d.getDate()} 1996`;
}

function bar(id: string, v: number) {
  const el = $(id) as HTMLElement;
  el.style.width = `${Math.max(0, Math.min(100, v))}%`;
  el.classList.toggle('low', v < 20);
}

function updateHud() {
  const g = S.game;
  $('clock').textContent = clockText(g.t);
  if (camShown) updateCam(g.t);
  const lvl = levelName(g.depth);
  $('sub').textContent = S.net ? `Online · ${lvl} · ${S.role === 'monster' ? 'you are the monster' : 'you are human'}` : `${lvl} · seed ${S.seed}`;
  const stars = CFG.STARS.filter((s) => g.score >= s).length;
  $('stars').textContent = S.role === 'monster' ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  const me = self();

  if (me) {
    $('score').textContent = `IT HAS FED ${g.score} / ${CFG.QUOTA}`;
    $('roster').innerHTML = '';
    // Online you know who the other players are; solo, everyone lost in here.
    for (const w of S.net ? g.wanderers.slice(0, S.humans) : g.wanderers.filter((w) => w.entered)) {
      const line = document.createElement('div');
      line.textContent = `${w.name}${w === me ? ' (you)' : ''} · ${w.caught ? 'taken' : w.escaped ? 'escaped' : 'out there'}`;
      $('roster').appendChild(line);
    }
    $('seen').classList.remove('on');
    bar('stamfill', me.stamina);
    bar('battfill', me.battery);
    $('hk-flash').classList.toggle('ready', me.battery > 0);
    $('tb-flash').classList.toggle('on', me.flash);
    $('tb-flash').classList.toggle('dim', me.battery <= 0);
    $('tb-crouch').classList.toggle('on', me.crouch);
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
  if (touchMode) {
    $('tb-blackout').classList.toggle('dim', g.dread < CFG.BLACKOUT_COST);
    $('tb-shift').classList.toggle('dim', g.dread < CFG.SHIFT_COST);
    $('tb-blackout').classList.toggle('on', aim === 'blackout');
    $('tb-shift').classList.toggle('on', aim === 'shift');
    $('tb-seep').classList.toggle('dim', !(m.seepT > 0 || m.seepCD <= 0));
    $('tb-seep').classList.toggle('on', m.seepT > 0);
    $('tb-view').textContent = view === 'hunt' ? 'Map' : 'Eyes';
  }
  if (view === 'hunt') {
    const f = forward();
    const w = g.catchable(f.x, f.z);
    $('crosshair').classList.toggle('catch', !!w);
    $('tb-catch').classList.toggle('on', !!w);
    let prompt = '';
    if (g.inAnyBeam(m.x, m.z)) prompt = 'A light is on you';
    else if (w) prompt = `${touchMode ? 'TAP' : 'CLICK'} — take ${w.name} · fear ${Math.round(w.fear)}`;
    else if (g.chalkInReach() >= 0) prompt = touchMode ? 'Erase or redraw the chalk arrow' : 'E erase · R redraw the chalk arrow';
    $('prompt').textContent = prompt;
  }
}

/**
 * A level is over. If anyone got out, the run goes on: solo, a button takes you
 * down after them; online, the server starts the next level itself (`next`).
 * Nobody out: the run is over, and this says how deep it got.
 */
function showEnd(reason = soloReason, next?: number) {
  const r = S.game.result!;
  mode = 'over';
  document.exitPointerLock();
  $('catch').hidden = true;
  const fed = r.score >= r.quota;
  const me = self();
  const online = !!S.net;
  const goesOn = online ? next !== undefined : r.survivors.length > 0;
  const here = levelName(r.depth);
  const names = r.survivors.map((p) => p.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const tally = `${me ? 'The thing' : 'You'} harvested ${r.score} fear of ${r.quota} · caught ${r.caught} · escaped ${r.escaped}.`;
  if (goesOn) {
    const meDown = !!me && r.survivors.some((p) => p.player && p.name === me.name);
    $('endtitle').textContent = me ? (meDown ? 'Deeper' : 'Left behind') : 'They went deeper';
    $('endsummary').textContent = `${reason ? `${reason}. ` : r.reason === 'dawn' ? 'Dawn came. ' : ''}` +
      `${who} got out of ${here}. ${tally}` +
      (online ? ` ${levelName(next!)} starts in a moment.` : '');
  } else {
    $('endtitle').textContent = me
      ? me.caught ? 'You were taken' : fed ? 'It fed' : 'You were lost'
      : fed ? 'Fed' : 'Hungry';
    $('endsummary').textContent = `${reason ? `${reason}. ` : r.reason === 'dawn' ? 'Dawn came. ' : 'The level is empty. '}` +
      `Nobody got out. The descent ended on ${here}. ${tally}` +
      (online ? (fed ? ' The monster wins.' : ' The humans win.') : '');
  }
  $('endstars').textContent = me || goesOn ? '' : '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  ($('end').querySelector('.questions') as HTMLElement).hidden = !!me || goesOn;
  $('deeper').hidden = online || !goesOn;
  $('replay').hidden = online || goesOn;
  $('newnight').hidden = online || goesOn;
  $('tolobby').hidden = !online || goesOn;
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

  touch.setActive(touchMode && mode === 'playing' && !S.spectating);
  if (mode === 'playing' && !S.spectating) {
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    const f = clamp1((keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + touch.move.y);
    const r = clamp1((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.move.x);
    if (me) {
      // A human: move relative to where you look.
      const yaw = S.world.look.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      me.heading = Math.atan2(fz, fx);
      me.pitch = S.world.look.pitch;
      me.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.sprint;
      if (S.placed) {
        const turn = g.moveHuman(me, fx * f - fz * r, fz * f + fx * r, dt);
        if (turn) S.world.look.yaw = rotateYaw(S.world.look.yaw, turn);
      }
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
      if (me && !S.placed && me.entered) {
        // Look the way you came in facing.
        S.world.look.yaw = Math.atan2(-Math.cos(me.heading), -Math.sin(me.heading));
        S.placed = true;
      }
      S.ai?.update(dt);
      g.update(dt);
      if (me && (me.caught || me.escaped)) soloOut(me);
      else if (g.over) showEnd();
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
  }
  if (me && !S.spectating && mode !== 'over') S.sound.heartbeat(Math.max(0, (me.fear - 25) / 75));

  S.world.update(t, mode === 'catching' && S.role === 'monster' ? 1 : g.monster.seen && S.role === 'monster' ? 0.25 : 0);
  S.sound.update((i) => S.world.circuitLevel(i, t));
  syncCam();
  // A human's camera breaks up as the monster gets close, walls or no walls.
  S.world.interference = me && !S.spectating ? Math.max(0, 1 - Math.hypot(me.x - g.monster.x, me.z - g.monster.z) / 10) : 0;
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

// Installable app and offline solo play. Not in dev, where it would cache Vite's live files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  });
}
