// End-to-end check of the game server with bot clients: `npm run net-test`
// (expects the server on PORT, default 8787).
import { WebSocket } from 'ws';
import type { ServerMsg } from '../src/net/protocol';

const URL = `ws://localhost:${process.env.PORT ?? 8787}/ws`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};

class Bot {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  open: Promise<void>;
  constructor(public label: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(String(d))));
    this.open = new Promise((r) => this.ws.on('open', () => r()));
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  last<T extends ServerMsg['t']>(t: T) {
    return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
}

// ---- Rooms ----

const host = new Bot('host'), a = new Bot('a'), b = new Bot('b'), stranger = new Bot('stranger');
await Promise.all([host.open, a.open, b.open, stranger.open]);
await sleep(100);
const list0 = stranger.last('rooms')?.rooms ?? [];
check(list0.length === 6 && list0.every((r) => r.players === 0 && !r.playing), 'six empty rooms listed on connect');

host.send({ t: 'join', room: 3, name: 'Joe' });
await sleep(150);
const hostLobby = host.last('lobby');
check(hostLobby?.name === 'Room 3' && !!hostLobby.players[0]?.host, 'first into Room 3 becomes its host');
check(stranger.last('rooms')?.rooms[2].players === 1, 'people browsing see Room 3 fill up live');

a.send({ t: 'join', room: 3, name: 'Joe' });
b.send({ t: 'join', room: 3, name: 'Avery' });
stranger.send({ t: 'join', room: 99, name: 'x' });
await sleep(150);
const lobby = host.last('lobby')!;
check(lobby.players.length === 3, 'two more players joined Room 3');
check(lobby.players.some((p) => p.name === 'Joe 2'), 'duplicate name became "Joe 2"');
check(stranger.last('error')?.msg === 'No such room', 'a room that does not exist is refused');

// Fill Room 5 to capacity; the next player is turned away.
const fillers = Array.from({ length: 5 }, (_, i) => new Bot(`f${i}`));
await Promise.all(fillers.map((f) => f.open));
for (const f of fillers) f.send({ t: 'join', room: 5, name: 'Filler' });
await sleep(200);
stranger.send({ t: 'join', room: 5, name: 'x' });
await sleep(150);
check(stranger.last('error')?.msg === 'Room 5 is full', 'a full room turns players away');
for (const f of fillers) f.ws.close();
await sleep(150);
check(stranger.last('rooms')?.rooms[4].players === 0, 'Room 5 empties again when everyone leaves');

// ---- Roles and start ----

host.send({ t: 'role', role: 'monster' });
await sleep(50);
a.send({ t: 'role', role: 'monster' });
await sleep(100);
check(a.last('error')?.msg === 'Someone is already the monster', 'only one monster');
a.send({ t: 'role', role: 'human' });
b.send({ t: 'role', role: 'human' });
await sleep(100);
host.send({ t: 'start' });
await sleep(100);
check(host.last('error')?.msg?.includes('ready') ?? false, 'cannot start until everyone is ready');
for (const p of [host, a, b]) p.send({ t: 'ready', ready: true });
await sleep(100);
a.send({ t: 'start' });
await sleep(100);
check(a.last('error')?.msg === 'Only the host can start', 'only the host can start');
host.send({ t: 'start' });
await sleep(300);

const sa = a.last('start'), sh = host.last('start');
check(!!sa && sa.role === 'human' && sa.slot === 0 && sh?.role === 'monster', 'night started with roles and slots');
check(JSON.stringify(sa?.players) === JSON.stringify(['Joe 2', 'Avery']), 'roster lists the human players');
stranger.send({ t: 'join', room: 3, name: 'x' });
await sleep(150);
check(stranger.last('error')?.msg === 'A night is already under way in Room 3', 'cannot join a room mid-night');
check(stranger.last('rooms')?.rooms[2].playing === true, 'the room list shows the night under way');
const snap0 = a.last('snap')?.s;
check(!!snap0 && snap0.w.length === 3, 'snapshots stream; 2 players + 1 AI fill-in = 3 wanderers');
check(typeof snap0?.doors === 'string' && snap0.doors.length > 20, `door states stream (${snap0?.doors.length} doors)`);
check(((snap0?.w[0][8] ?? 0) & 128) !== 0 && ((snap0?.w[2][8] ?? 0) & 128) === 0, 'slots 0-1 are players, slot 2 is AI');

// ---- In the night ----

// Human A walks a little; a teleport gets snapped back.
const me = a.last('snap')!.s.w[0];
let x = me[0];
const z = me[1];
for (let i = 0; i < 10; i++) {
  x += 0.08;
  a.send({ t: 'pos', x, z, yaw: 0, pitch: 0 });
  await sleep(50);
}
await sleep(100);
const moved = a.last('snap')!.s.w[0];
check(Math.abs(moved[0] - me[0]) > 0.3, `server accepted a walk (${me[0]} → ${moved[0]})`);
a.send({ t: 'pos', x: x + 30, z, yaw: 0, pitch: 0 });
await sleep(100);
check(!!a.last('correct'), 'a 30 m teleport was corrected');

a.send({ t: 'act', a: 'flash' });
a.send({ t: 'act', a: 'chalk' });
await sleep(150);
const s2 = a.last('snap')!.s;
check((s2.w[0][8] & 16) !== 0, 'flashlight turned on');
check(s2.chalk.length >= 2, 'chalk arrow drawn and synced');

host.send({ t: 'act', a: 'blackout', circuit: 0 });
await sleep(150);
check((host.last('snap')!.s.black[0] ?? 0) > 0, 'monster blackout reached the server');
host.send({ t: 'act', a: 'shift', key: 0 });
await sleep(100);
check(host.last('actErr')?.msg === 'The outer walls don\'t move', 'invalid shift reports an error');

// ---- Leaving ----

b.ws.close();
await sleep(200);
check((host.last('snap')!.s.w[1][8] & 128) === 0, 'a departed player\'s wanderer is now AI');

host.ws.close();
await sleep(200);
check(a.last('end')?.reason === 'The monster left the game', 'night ends when the monster leaves');
const back = a.last('lobby');
check(back?.players.length === 1 && back.players[0].host, 'remaining player is back in Room 3, now its host');

a.ws.close();
await sleep(150);
const room3 = stranger.last('rooms')?.rooms[2];
check(room3?.players === 0 && !room3.playing, 'Room 3 is empty and open again');

stranger.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
