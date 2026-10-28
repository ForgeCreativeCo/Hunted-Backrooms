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

const host = new Bot('host'), a = new Bot('a'), b = new Bot('b');
await Promise.all([host.open, a.open, b.open]);

host.send({ t: 'create', name: 'Joe' });
await sleep(150);
const code = host.last('lobby')?.code ?? '';
check(/^[A-Z]{4}$/.test(code), `host created lobby ${code}`);

a.send({ t: 'join', code: code.toLowerCase(), name: 'Joe' });
b.send({ t: 'join', code, name: 'Avery' });
const stranger = new Bot('stranger');
await stranger.open;
stranger.send({ t: 'join', code: 'ZZZZ', name: 'x' });
await sleep(150);
const lobby = host.last('lobby')!;
check(lobby.players.length === 3, 'two players joined (code is case-insensitive)');
check(lobby.players.some((p) => p.name === 'Joe 2'), 'duplicate name became "Joe 2"');
check(stranger.last('error')?.msg === 'No lobby with that code', 'bad code is refused');

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
const snap0 = a.last('snap')?.s;
check(!!snap0 && snap0.w.length === 3, 'snapshots stream; 2 players + 1 AI fill-in = 3 wanderers');
check(((snap0?.w[0][8] ?? 0) & 128) !== 0 && ((snap0?.w[2][8] ?? 0) & 128) === 0, 'slots 0-1 are players, slot 2 is AI');

// Human A walks a little; a teleport gets snapped back.
const me = a.last('snap')!.s.w[0];
let x = me[0], z = me[1];
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

// Flashlight and chalk.
a.send({ t: 'act', a: 'flash' });
a.send({ t: 'act', a: 'chalk' });
await sleep(150);
const s2 = a.last('snap')!.s;
check((s2.w[0][8] & 16) !== 0, 'flashlight turned on');
check(s2.chalk.length >= 2, 'chalk arrow drawn and synced');

// Monster blacks out the circuit it stands in... via any circuit index.
host.send({ t: 'act', a: 'blackout', circuit: 0 });
await sleep(150);
check((host.last('snap')!.s.black[0] ?? 0) > 0, 'monster blackout reached the server');
host.send({ t: 'act', a: 'shift', key: 0 });
await sleep(100);
check(host.last('actErr')?.msg === 'The outer walls don\'t move', 'invalid shift reports an error');

// Human B disconnects: an AI takes over their body.
b.ws.close();
await sleep(200);
const s3 = host.last('snap')!.s;
check((s3.w[1][8] & 128) === 0, 'a departed player\'s wanderer is now AI');

// The monster leaves: the night ends for everyone.
host.ws.close();
await sleep(200);
const end = a.last('end');
check(end?.reason === 'The monster left the game', 'night ends when the monster leaves');
check(a.last('lobby')?.players.length === 1, 'remaining player is back in the lobby');

a.ws.close();
stranger.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
