import type { ClientMsg, ServerMsg } from './protocol';

/**
 * Where the game server lives: the same origin by default. Static hosts such as
 * Netlify can't run it, so builds there set VITE_SERVER_URL to the server hosted
 * elsewhere (e.g. https://hum-server.onrender.com).
 */
function serverUrl() {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env.replace(/^http/, 'ws').replace(/\/+$/, '').replace(/(\/ws)?$/, '/ws');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** Thin wrapper around the game server socket (/ws). */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<(m: ServerMsg) => void>();
  onClose: (() => void) | null = null;

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl());
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => reject(new Error('Could not reach the game server'));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        // A connection that never opened is reported by connect() instead.
        if (opened) this.onClose?.();
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
