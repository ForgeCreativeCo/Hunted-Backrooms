import type { ClientMsg, ServerMsg } from './protocol';

/** Thin wrapper around the game server socket (same origin, /ws). */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<(m: ServerMsg) => void>();
  onClose: (() => void) | null = null;

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return Promise.resolve();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not reach the game server'));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.onClose?.();
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
