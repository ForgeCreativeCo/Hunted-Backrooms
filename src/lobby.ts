import { CFG } from './config';
import { Net } from './net/client';
import type { LobbyPlayer, ServerMsg } from './net/protocol';

const $ = (id: string) => document.getElementById(id)!;

export type StartMsg = Extract<ServerMsg, { t: 'start' }>;

/** The multiplayer menu and lobby screens. Calls onStart when the host launches the night. */
export class Lobby {
  net = new Net();
  private you = '';
  private players: LobbyPlayer[] = [];
  private inLobby = false;

  constructor(private onStart: (msg: StartMsg) => void, private onBack: () => void) {
    const name = $('mpname') as HTMLInputElement;
    try { name.value = localStorage.getItem('hum-name') ?? ''; } catch { /* storage blocked */ }
    const saveName = () => {
      try { localStorage.setItem('hum-name', name.value.trim()); } catch { /* storage blocked */ }
      return name.value.trim() || 'Player';
    };

    $('create').addEventListener('click', async () => {
      if (await this.ensureConnected()) this.net.send({ t: 'create', name: saveName() });
    });
    const join = async () => {
      const code = ($('joincode') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length !== 4) return this.status('Enter the 4-letter lobby code');
      if (await this.ensureConnected()) this.net.send({ t: 'join', code, name: saveName() });
    };
    $('join').addEventListener('click', join);
    $('joincode').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') join(); });
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

  /** The connection dropped: forget the lobby, and go back to the menu if it was on screen. */
  lost() {
    const showing = !$('lobby').hidden;
    this.inLobby = false;
    $('lobby').hidden = true;
    if (showing) this.openMenu();
    this.status('Lost connection to the game server');
  }

  openMenu() {
    $('mp').hidden = false;
    ($('mpname') as HTMLInputElement).focus();
  }

  /** Back to the lobby screen after a night ends. */
  showLobby() {
    if (!this.inLobby) return this.openMenu();
    $('lobby').hidden = false;
    this.render();
  }

  private async ensureConnected() {
    if (this.net.connected) return true;
    this.status('Connecting…');
    try {
      await this.net.connect();
      this.status('');
      return true;
    } catch {
      this.status('Could not reach the game server. Is it running? (npm run dev)');
      return false;
    }
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
      case 'lobby':
        this.you = m.you;
        this.players = m.players;
        $('code').textContent = m.code;
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
