import type { ClientMsg, ServerMsg } from './protocol';

/**
 * Where the game server lives: the same origin by default. Static hosts such as
 * Netlify can't run it, so builds there set VITE_SERVER_URL to the server hosted
 * elsewhere (e.g. https://hum-server.onrender.com).
 */
const ENV_SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() || '';

function httpBase() {
  if (ENV_SERVER) return ENV_SERVER.replace(/^ws/, 'http').replace(/\/+$/, '').replace(/\/ws$/, '');
  return location.origin;
}

function serverUrl() {
  return `${httpBase().replace(/^http/, 'ws')}/ws`;
}

/** A static host with no server configured can never connect; say so instead of retrying. */
function noServerHere() {
  return !ENV_SERVER && import.meta.env.PROD && /(\.netlify\.app|\.github\.io|\.vercel\.app|\.pages\.dev)$/.test(location.hostname);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thin wrapper around the game server socket (/ws). */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<(m: ServerMsg) => void>();
  private connecting: Promise<void> | null = null;
  onClose: (() => void) | null = null;

  /**
   * Connect, waking the server if needed. Free hosts (Render) put the server to
   * sleep when idle and take up to a minute to wake, so keep trying for a while,
   * reporting progress through onStatus.
   */
  connect(onStatus?: (msg: string) => void): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.connectWithRetry(onStatus).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connectWithRetry(onStatus?: (msg: string) => void) {
    if (noServerHere()) throw new Error('This copy of the game has no multiplayer server set up (VITE_SERVER_URL).');
    // In dev the server is local: it's either running or it isn't.
    const deadline = Date.now() + (import.meta.env.DEV ? 3000 : 100_000);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.open();
        return;
      } catch {
        if (Date.now() > deadline) throw new Error('Could not reach the game server');
        onStatus?.(attempt === 0 ? 'Waking the game server…' : 'Waking the game server… this can take up to a minute');
        // An ordinary request is what wakes a sleeping host; a refused socket may not.
        await Promise.race([
          fetch(`${httpBase()}/health`, { cache: 'no-store' }).catch(() => {}),
          sleep(15000),
        ]);
        await sleep(Math.min(5000, 1000 + attempt * 1000));
      }
    }
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl());
      this.ws = ws;
      let opened = false;
      // A socket that hangs half-open never errors; give up on it.
      const timer = setTimeout(() => { if (!opened) ws.close(); }, 10000);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => reject(new Error('Could not reach the game server'));
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws === ws) this.ws = null;
        // A connection that never opened is reported by connect() instead.
        if (opened) this.onClose?.();
        else reject(new Error('Could not reach the game server'));
      };
      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(e.data); } catch { return; }
        for (const h of this.handlers) h(msg);
      };
    });
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(h: (m: ServerMsg) => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
}
