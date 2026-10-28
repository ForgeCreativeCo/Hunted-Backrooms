// HUM game server: serves the built client, runs lobbies, and runs one
// authoritative Game per room. Clients move themselves; the server checks
// their moves, runs the AI and the rules, and streams snapshots back.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { CFG } from '../src/config';
import { Game } from '../src/game';
import { ClientMsg, encodeSnapshot, LobbyPlayer, NetEvent, Role, RoomInfo, ServerMsg } from '../src/net/protocol';
import { randomSeed } from '../src/rng';

// --port wins (the dev script uses it, since tools often set PORT for the client); hosts set PORT.
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT) || 8787;
const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const TICK_HZ = 30;
const MAX_PLAYERS = 1 + CFG.MAX_HUMANS;
const ROOM_COUNT = 6;

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  role: Role | null;
  ready: boolean;
  room: Room | null;
  slot: number;
  lastPosAt: number;
}

interface Room {
  id: number;
  name: string;
  clients: Client[];
  hostId: string;
  game: Game | null;
  events: NetEvent[];
  timer: ReturnType<typeof setInterval> | null;
  lastTick: number;
  wallsSent: number;
}

// Six permanent rooms. An empty room just resets; it's never removed.
const rooms: Room[] = Array.from({ length: ROOM_COUNT }, (_, i) => ({
  id: i + 1, name: `Room ${i + 1}`, clients: [], hostId: '', game: null, events: [], timer: null, lastTick: 0, wallsSent: 0,
}));
const clients = new Set<Client>();
let nextId = 1;

// ---- Static files ----

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = join(DIST, rel || 'index.html');
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    try {
      res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(await readFile(join(DIST, 'index.html')));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Build the client first: npm run build');
    }
  }
});

// ---- Lobby ----

function send(c: Client, msg: ServerMsg) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function roomList(): RoomInfo[] {
  return rooms.map((r) => ({
    id: r.id, name: r.name, players: r.clients.length, max: MAX_PLAYERS,
    playing: !!r.game, monster: r.clients.some((c) => c.role === 'monster'),
  }));
}

/** Everyone browsing the menu sees the rooms fill and empty live. */
function broadcastRooms() {
  const rooms = roomList();
  for (const c of clients) if (!c.room) send(c, { t: 'rooms', rooms });
}

function cleanName(name: unknown, room: Room | null) {
  let n = String(name ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 16) || 'Player';
  const taken = new Set(room?.clients.map((c) => c.name) ?? []);
  const base = n;
  for (let i = 2; taken.has(n); i++) n = `${base} ${i}`;
  return n;
}

function sendLobby(room: Room) {
  const players: LobbyPlayer[] = room.clients.map((c) => ({
    id: c.id, name: c.name, role: c.role, ready: c.ready, host: c.id === room.hostId,
  }));
  for (const c of room.clients) send(c, { t: 'lobby', room: room.id, name: room.name, you: c.id, players });
  broadcastRooms();
}

function leaveRoom(c: Client) {
  const room = c.room;
  if (!room) return;
  room.clients = room.clients.filter((o) => o !== c);
  c.room = null;
  c.role = null;
  c.ready = false;
  const g = room.game;
  if (g) {
    if (c.slot === -1) endGame(room, 'The monster left the game');
    else if (g.wanderers[c.slot]) g.releasePlayer(g.wanderers[c.slot]); // an AI takes over
  }
  if (!room.clients.length) {
    if (room.timer) clearInterval(room.timer);
    room.timer = null;
    room.game = null;
    room.hostId = '';
    broadcastRooms();
    return;
  }
  if (room.hostId === c.id) room.hostId = room.clients[0].id;
  sendLobby(room);
}

function lobbyMsg(c: Client, msg: ClientMsg) {
  switch (msg.t) {
    case 'rooms':
      send(c, { t: 'rooms', rooms: roomList() });
      return;
    case 'join': {
      const room = rooms.find((r) => r.id === Number(msg.room));
      if (!room) return send(c, { t: 'error', msg: 'No such room' });
      if (room === c.room) return;
      if (room.game) return send(c, { t: 'error', msg: `A night is already under way in ${room.name}` });
      if (room.clients.length >= MAX_PLAYERS) return send(c, { t: 'error', msg: `${room.name} is full` });
      leaveRoom(c);
      c.name = cleanName(msg.name, room);
      if (!room.clients.length) room.hostId = c.id;
      room.clients.push(c);
      c.room = room;
      sendLobby(room);
      return;
    }
    case 'leave':
      leaveRoom(c);
      return;
  }
  const room = c.room;
  if (!room || room.game) return;
  switch (msg.t) {
    case 'role': {
      if (msg.role === 'monster' && room.clients.some((o) => o !== c && o.role === 'monster')) {
        return send(c, { t: 'error', msg: 'Someone is already the monster' });
      }
      if (msg.role === 'human' && room.clients.filter((o) => o !== c && o.role === 'human').length >= CFG.MAX_HUMANS) {
        return send(c, { t: 'error', msg: `Only ${CFG.MAX_HUMANS} humans per night` });
      }
      c.role = msg.role === 'monster' ? 'monster' : 'human';
      c.ready = false;
      sendLobby(room);
      return;
    }
    case 'ready':
      if (!c.role) return send(c, { t: 'error', msg: 'Pick a side first' });
      c.ready = !!msg.ready;
      sendLobby(room);
      return;
    case 'start': {
      if (c.id !== room.hostId) return send(c, { t: 'error', msg: 'Only the host can start' });
      if (room.clients.filter((o) => o.role === 'monster').length !== 1) return send(c, { t: 'error', msg: 'Someone has to be the monster' });
      if (room.clients.some((o) => !o.role || !o.ready)) return send(c, { t: 'error', msg: 'Everyone needs to pick a side and ready up' });
      startGame(room);
      return;
    }
  }
}

// ---- Game ----

const r2 = (v: number) => Math.round(v * 100) / 100;

function startGame(room: Room) {
  const humans = room.clients.filter((c) => c.role === 'human');
  const players = humans.map((c) => c.name);
  const seed = randomSeed();
  room.events = [];
  const game = new Game(seed, {
    sound: (k, x, z, l, who) => room.events.push(['s', k, r2(x), r2(z), r2(l), who ? who.id : -1]),
    caption: (text, who) => room.events.push(['c', text, who ? who.id : -1]),
    toast: (text) => room.events.push(['t', text]),
    pulse: (p, who) => room.events.push(['p', r2(p.x), r2(p.z), r2(p.maxR), Math.round(p.fear), who.id]),
  }, { players });
  room.game = game;
  room.wallsSent = 0;
  for (const c of room.clients) {
    c.slot = c.role === 'human' ? humans.indexOf(c) : -1;
    c.lastPosAt = 0;
    send(c, { t: 'start', seed, role: c.role!, slot: c.slot, players });
  }
  room.lastTick = performance.now();
  room.timer = setInterval(() => tick(room), 1000 / TICK_HZ);
  broadcastRooms();
  console.log(`[${room.name}] night started: seed ${seed}, ${humans.length} human player(s)`);
}

function tick(room: Room) {
  const g = room.game;
  if (!g) return;
  const now = performance.now();
  const dt = Math.min(0.1, (now - room.lastTick) / 1000);
  room.lastTick = now;
  g.update(dt);
  const s = encodeSnapshot(g, room.wallsSent);
  room.wallsSent = g.level.version;
  const forHumans = room.events.filter((e) => !(e[0] === 't' && e[1].startsWith('Seen')));
  for (const c of room.clients) send(c, { t: 'snap', s, ev: c.role === 'monster' ? room.events : forHumans });
  room.events.length = 0;
  if (g.over) endGame(room);
}

function endGame(room: Room, reason?: string) {
  const g = room.game;
  if (!g) return;
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.game = null;
  const result = g.result ?? {
    score: g.score, quota: CFG.QUOTA, stars: 0, reason: 'empty' as const,
    caught: g.wanderers.filter((w) => w.caught).length, escaped: g.wanderers.filter((w) => w.escaped).length,
  };
  for (const c of room.clients) {
    c.ready = false;
    send(c, { t: 'end', result, reason });
  }
  sendLobby(room);
  console.log(`[${room.name}] night ended: ${result.score}/${result.quota} fear${reason ? ` (${reason})` : ''}`);
}

function gameMsg(c: Client, msg: ClientMsg) {
  const room = c.room;
  const g = room?.game;
  if (!room || !g) return;
  if (msg.t === 'pos') {
    const now = performance.now();
    const elapsed = c.lastPosAt ? Math.min(0.5, (now - c.lastPosAt) / 1000) : 0.5;
    c.lastPosAt = now;
    const x = Number(msg.x), z = Number(msg.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (c.role === 'monster') {
      const m = g.monster;
      const d = Math.hypot(x - m.x, z - m.z);
      // Allow some slack for jitter; anything faster is snapped back.
      if (d > CFG.MONSTER_SPEED * 1.3 * elapsed + 0.4) return send(c, { t: 'correct', x: m.x, z: m.z });
      m.moving = d > 0.005;
      m.x = x;
      m.z = z;
      if (m.seepT <= 0) g.collide();
      m.yaw = Number(msg.yaw) || 0;
      m.pitch = Number(msg.pitch) || 0;
    } else {
      const w = g.wanderers[c.slot];
      if (!w || !w.active || !w.player) return;
      const d = Math.hypot(x - w.x, z - w.z);
      if (d > CFG.SPRINT * 1.3 * elapsed + 0.4) return send(c, { t: 'correct', x: w.x, z: w.z });
      w.moving = d > 0.005;
      w.x = x;
      w.z = z;
      g.collideBody(w, CFG.HUMAN_RADIUS);
      const yaw = Number(msg.yaw) || 0;
      w.heading = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
      w.pitch = Number(msg.pitch) || 0;
      w.sprint = !!msg.sprint;
      w.crouch = !!msg.crouch;
    }
    return;
  }
  if (msg.t !== 'act') return;
  let err: string | null = null;
  if (c.role === 'monster') {
    switch (msg.a) {
      case 'blackout': err = g.tryBlackout(Number(msg.circuit)); break;
      case 'shift': err = g.tryShift(Number(msg.key)); break;
      case 'seep': err = g.trySeep(); break;
      case 'erase': err = g.eraseChalk(); break;
      case 'redraw': err = g.redrawChalk(); break;
      case 'catch': {
        const fl = Math.hypot(msg.fx, msg.fz) || 1;
        const w = g.catchable(msg.fx / fl, msg.fz / fl);
        if (w) send(c, { t: 'caught', name: w.name, pts: g.catch(w) });
        break;
      }
    }
  } else {
    const w = g.wanderers[c.slot];
    if (!w || !w.active) return;
    if (msg.a === 'flash') err = g.toggleFlash(w);
    else if (msg.a === 'chalk') err = g.drawChalk(w);
  }
  if (err) send(c, { t: 'actErr', msg: err });
}

// ---- Sockets ----

const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws) => {
  const c: Client = { id: String(nextId++), ws, name: 'Player', role: null, ready: false, room: null, slot: -1, lastPosAt: 0 };
  clients.add(c);
  send(c, { t: 'rooms', rooms: roomList() });
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'pos' || msg.t === 'act') gameMsg(c, msg);
    else lobbyMsg(c, msg);
  });
  ws.on('close', () => {
    clients.delete(c);
    leaveRoom(c);
  });
});

http.listen(PORT, () => console.log(`HUM server on http://localhost:${PORT} (websocket at /ws)`));
