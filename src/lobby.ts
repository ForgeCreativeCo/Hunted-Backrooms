import { CFG } from './config';
import { Net } from './net/client';
import type { LobbyPlayer, RoomInfo, ServerMsg } from './net/protocol';

const $ = (id: string) => document.getElementById(id)!;

export type StartMsg = Extract<ServerMsg, { t: 'start' }>;

/** The multiplayer room list and waiting room. Calls onStart when the host launches the night. */
export class Lobby {
  net = new Net();
  private you = '';
  private players: LobbyPlayer[] = [];
  private rooms: RoomInfo[] = [];
  private inLobby = false;

  constructor(private onStart: (msg: StartMsg) => void, private onBack: () => void) {
    const name = $('mpname') as HTMLInputElement;
    try { name.value = localStorage.getItem('hum-name') ?? ''; } catch { /* storage blocked */ }

    $('mpback').addEventListener('click', () => { $('mp').hidden = true; this.onBack(); });
    $('be-monster').addEventListener('click', () => this.net.send({ t: 'role', role: 'monster' }));
    $('be-human').addEventListener('click', () => this.net.send({ t: 'role', role: 'human' }));
    $('ready').addEventListener('click', () => this.net.send({ t: 'ready', ready: !this.me()?.ready }));
    $('start').addEventListener('click', () => this.net.send({ t: 'start' }));
    $('leave').addEventListener('click', () => {
      this.net.send({ t: 'leave' });
      this.inLobby = false;
      $('lobby').hidden = true;
      this.openMenu();
    });

    this.net.on((m) => this.handle(m));
    this.net.onClose = () => this.lost();
  }

  /** Show the room list, connecting first if needed. */
  async openMenu() {
    $('mp').hidden = false;
    this.renderRooms();
    if (this.net.connected) {
      this.net.send({ t: 'rooms' });
      return;
    }
    this.status('Connecting…');
    try {
      await this.net.connect(); // the server sends the room list on connect
      this.status('');
    } catch {
      this.status(import.meta.env.DEV
        ? 'Could not reach the game server. Is it running? (npm run dev)'
        : 'Could not reach the game server. It may be offline or waking up; try again in a minute.');
    }
  }

  /** Back to the waiting room after a night ends. */
  showLobby() {
    if (!this.inLobby) return this.openMenu();
    $('lobby').hidden = false;
    this.render();
  }

  /** The connection dropped: forget the room, and go back to the menu if it was on screen. */
  lost() {
    const showing = !$('lobby').hidden;
    this.inLobby = false;
    this.rooms = [];
    $('lobby').hidden = true;
    if (showing) $('mp').hidden = false;
    this.renderRooms();
    this.status('Lost connection to the game server');
  }

  private join(room: number) {
    const input = $('mpname') as HTMLInputElement;
    const name = input.value.trim() || 'Player';
    try { localStorage.setItem('hum-name', input.value.trim()); } catch { /* storage blocked */ }
    this.net.send({ t: 'join', room, name });
  }

  private status(msg: string) {
    $('mpstatus').textContent = msg;
    $('lobbystatus').textContent = msg;
  }

  private me() {
    return this.players.find((p) => p.id === this.you);
  }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'rooms':
        this.rooms = m.rooms;
        this.renderRooms();
        break;
      case 'lobby':
        this.you = m.you;
        this.players = m.players;
        $('roomname').textContent = m.name;
        if (!this.inLobby) {
          this.inLobby = true;
          this.status('');
          $('mp').hidden = true;
          $('lobby').hidden = false;
        }
        this.render();
        break;
      case 'error':
        this.status(m.msg);
        break;
      case 'start':
        $('lobby').hidden = true;
        this.status('');
        this.onStart(m);
        break;
    }
  }

  private renderRooms() {
    const list = $('rooms');
    list.innerHTML = '';
    for (const r of this.rooms) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'rn';
      name.textContent = r.name;
      const state = document.createElement('span');
      state.className = `rs ${r.playing ? 'live' : ''}`;
      state.textContent = r.playing
        ? `night under way · ${r.players}/${r.max}`
        : r.players === 0 ? 'empty' : `${r.players}/${r.max} waiting${r.monster ? ' · monster taken' : ''}`;
      const btn = document.createElement('button');
      btn.textContent = 'Join';
      btn.disabled = r.playing || r.players >= r.max;
      btn.addEventListener('click', () => this.join(r.id));
      li.append(name, state, btn);
      list.appendChild(li);
    }
  }

  private render() {
    const me = this.me();
    const list = $('players');
    list.innerHTML = '';
    for (const p of this.players) {
      const li = document.createElement('li');
      if (p.id === this.you) li.className = 'you';
      const name = document.createElement('span');
      name.textContent = `${p.host ? '★ ' : ''}${p.name}${p.id === this.you ? ' (you)' : ''}`;
      const role = document.createElement('span');
      role.className = `r ${p.role ?? ''} ${p.ready ? 'ok' : ''}`;
      role.textContent = p.role === 'monster' ? 'Monster' : p.role === 'human' ? 'Human' : 'Choosing…';
      li.append(name, role);
      list.appendChild(li);
    }
    const humans = this.players.filter((p) => p.role === 'human').length;
    const ai = Math.max(3, humans) - humans;
    $('fillnote').textContent = `${humans} human player${humans === 1 ? '' : 's'} · ${ai} AI wanderer${ai === 1 ? '' : 's'} will fill in · up to ${CFG.MAX_HUMANS} humans`;
    const monsterTaken = this.players.some((p) => p.role === 'monster' && p.id !== this.you);
    ($('be-monster') as HTMLButtonElement).disabled = monsterTaken || me?.role === 'monster';
    ($('be-human') as HTMLButtonElement).disabled = me?.role === 'human';
    const ready = $('ready') as HTMLButtonElement;
    ready.disabled = !me?.role;
    ready.textContent = me?.ready ? 'Not ready' : 'Ready';
    const start = $('start') as HTMLButtonElement;
    start.hidden = !me?.host;
    const canStart = this.players.filter((p) => p.role === 'monster').length === 1 && this.players.every((p) => p.role && p.ready);
    start.disabled = !canStart;
    if (me?.host && !canStart) {
      $('lobbystatus').textContent = this.players.some((p) => p.role === 'monster')
        ? 'Waiting for everyone to pick a side and ready up'
        : 'Someone has to be the monster';
    } else if (me?.host) {
      $('lobbystatus').textContent = '';
    }
  }
}
