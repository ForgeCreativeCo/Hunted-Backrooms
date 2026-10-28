import { Game, NightResult, WState } from '../game';

// Messages between clients and the game server. The server runs the real Game;
// each client keeps a mirror Game (same seed, same roster) and copies snapshots into it.

export type Role = 'monster' | 'human';

export interface LobbyPlayer {
  id: string;
  name: string;
  role: Role | null;
  ready: boolean;
  host: boolean;
}

/** One of the fixed rooms, as the room list shows it. */
export interface RoomInfo {
  id: number;
  name: string;
  players: number;
  max: number;
  playing: boolean;
  monster: boolean;
}

export type ClientMsg =
  | { t: 'rooms' }
  | { t: 'join'; room: number; name: string }
  | { t: 'role'; role: Role }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'leave' }
  // In game: where I am (client-authoritative movement, checked by the server).
  | { t: 'pos'; x: number; z: number; yaw: number; pitch: number; sprint?: boolean; crouch?: boolean }
  | { t: 'act'; a: 'blackout'; circuit: number }
  | { t: 'act'; a: 'shift'; key: number }
  | { t: 'act'; a: 'seep' | 'erase' | 'redraw' | 'flash' | 'chalk' }
  | { t: 'act'; a: 'catch'; fx: number; fz: number };

export type ServerMsg =
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'lobby'; room: number; name: string; you: string; players: LobbyPlayer[] }
  | { t: 'error'; msg: string }
  | { t: 'start'; seed: string; role: Role; slot: number; players: string[] }
  | { t: 'snap'; s: Snapshot; ev: NetEvent[] }
  | { t: 'correct'; x: number; z: number }
  | { t: 'actErr'; msg: string }
  | { t: 'caught'; name: string; pts: number }
  | { t: 'end'; result: NightResult; reason?: string };

/** Sounds, captions, toasts and sense pulses raised by the server's game this tick. */
export type NetEvent =
  | ['s', string, number, number, number, number] // sound kind, x, z, loud, wanderer id (-1 none)
  | ['c', string, number] // caption, wanderer id
  | ['t', string] // toast
  | ['p', number, number, number, number, number]; // pulse x, z, maxR, fear, wanderer id

const STATES: WState[] = ['explore', 'alert', 'flee', 'hide', 'escape', 'panic', 'chalk', 'confused'];

export interface Snapshot {
  t: number;
  dread: number;
  score: number;
  black: number[];
  m: number[]; // x, z, yaw, pitch, seepT, seepCD, seen, moving
  w: number[][]; // per wanderer: x, z, heading, pitch, state, fear, stamina, battery, flags
  chalk: number[]; // cell, dir pairs
  wv: number; // wall version
  walls?: string; // '0'/'1' per edge, only when the version changed
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function encodeSnapshot(g: Game, sentWallVersion: number): Snapshot {
  const m = g.monster;
  const L = g.level;
  const snap: Snapshot = {
    t: r2(g.t),
    dread: r2(g.dread),
    score: g.score,
    black: Array.from(g.blackout, r2),
    m: [r2(m.x), r2(m.z), r2(m.yaw), r2(m.pitch), r2(m.seepT), r2(m.seepCD), m.seen ? 1 : 0, m.moving ? 1 : 0],
    w: g.wanderers.map((w) => [
      r2(w.x), r2(w.z), r2(w.heading), r2(w.pitch), STATES.indexOf(w.state), r2(w.fear), r2(w.stamina), r2(w.battery),
      (w.entered ? 1 : 0) | (w.caught ? 2 : 0) | (w.escaped ? 4 : 0) | (w.exhausted ? 8 : 0)
        | (w.flash ? 16 : 0) | (w.crouch ? 32 : 0) | (w.sees ? 64 : 0) | (w.player ? 128 : 0) | (w.moving ? 256 : 0),
    ]),
    chalk: [...g.chalk].flatMap(([cell, mark]) => [cell, mark.dir]),
    wv: L.version,
  };
  if (L.version !== sentWallVersion) snap.walls = Array.from(L.walls).join('');
  return snap;
}

/**
 * Copy a snapshot into a client's mirror game. The local player's own position
 * and look are left alone (their client is the authority for those).
 */
export function applySnapshot(g: Game, s: Snapshot, self: { role: Role; slot: number }) {
  g.t = s.t;
  g.dread = s.dread;
  g.score = s.score;
  s.black.forEach((v, i) => (g.blackout[i] = v));
  const m = g.monster;
  if (self.role !== 'monster') {
    [m.x, m.z, m.yaw, m.pitch] = s.m;
    m.moving = s.m[7] === 1;
  }
  m.seepT = s.m[4];
  m.seepCD = s.m[5];
  m.seen = s.m[6] === 1;
  s.w.forEach((a, i) => {
    const w = g.wanderers[i];
    if (!w) return;
    const mine = self.role === 'human' && self.slot === i;
    if (!mine) {
      w.x = a[0];
      w.z = a[1];
      w.heading = a[2];
      w.pitch = a[3];
      w.cell = g.level.cellAt(w.x, w.z);
    }
    w.state = STATES[a[4]] ?? 'explore';
    w.fear = a[5];
    w.stamina = a[6];
    w.battery = a[7];
    const f = a[8];
    w.entered = !!(f & 1);
    w.caught = !!(f & 2);
    w.escaped = !!(f & 4);
    w.exhausted = !!(f & 8);
    w.flash = !!(f & 16);
    if (!mine) w.crouch = !!(f & 32);
    w.sees = !!(f & 64);
    w.player = !!(f & 128);
    if (!mine) w.moving = !!(f & 256);
  });
  g.chalk.clear();
  for (let i = 0; i < s.chalk.length; i += 2) g.chalk.set(s.chalk[i], { dir: s.chalk[i + 1], by: -1 });
  if (s.walls) {
    for (let k = 0; k < s.walls.length; k++) g.level.walls[k] = s.walls.charCodeAt(k) === 49 ? 1 : 0;
  }
  g.level.version = s.wv;
}
