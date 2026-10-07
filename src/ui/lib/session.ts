import { useSyncExternalStore } from "react";
import type { ModuleInfo } from "../../shared/modules";
import { PROTOCOL_VERSION, type Request, type ServerFrame } from "../../shared/protocol";
import { emptyState, reduce, type SessionState } from "../../shared/state";

export type ChannelStatus = "connecting" | "open" | "closed";

export type ChannelSnapshot = {
  status: ChannelStatus;
  /** Undefined until the server says which session it serves. */
  state?: SessionState;
  /** The modules the server offers. */
  modules: ModuleInfo[];
  /** The last refusal or failure the server sent. */
  error?: string;
};

/**
 * The browser's end of the session channel. State comes only from the server's events: this tab sends
 * requests and renders what comes back. Reconnects on its own, resuming after the last event it saw.
 */
export class SessionChannel {
  private ws?: WebSocket;
  private retry = 250;
  private stopped = false;
  private listeners = new Set<() => void>();
  snapshot: ChannelSnapshot = { status: "connecting", modules: [] };

  constructor(
    private url: string,
    private WS: typeof WebSocket = WebSocket,
  ) {
    this.connect();
  }

  private set(patch: Partial<ChannelSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private connect() {
    const ws = (this.ws = new this.WS(this.url));
    this.set({ status: "connecting" });
    ws.onopen = () => {
      const s = this.snapshot.state;
      this.send({ type: "hello", v: PROTOCOL_VERSION, ...(s && { session: s.id, after: s.seq }) });
    };
    ws.onmessage = (m) => this.receive(JSON.parse(String(m.data)) as ServerFrame);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.set({ status: "closed" });
      if (this.stopped) return;
      setTimeout(() => !this.stopped && this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 4000);
    };
  }

  private receive(f: ServerFrame) {
    if (f.type === "welcome") {
      this.retry = 250;
      // A different session means the server restarted on a new one; it replays that one from the start.
      const s = this.snapshot.state;
      this.set({
        status: "open",
        error: undefined,
        modules: f.modules,
        state: s?.id === f.session ? s : emptyState(f.session),
      });
    } else if (f.type === "error") {
      if (f.fatal) this.stopped = true;
      this.set({ error: f.message });
      // A refusal is news, not a state: let it fade.
      if (!f.fatal) setTimeout(() => this.snapshot.error === f.message && this.set({ error: undefined }), 8000);
    } else {
      const s = this.snapshot.state;
      if (s && f.seq === s.seq + 1) this.set({ state: reduce(s, f) });
    }
  }

  /** Returns false when the channel isn't open; the request isn't queued. */
  send(req: Request): boolean {
    if (this.ws?.readyState !== this.WS.OPEN) return false;
    // A new request starts clean, so a refusal that repeats the last one still shows up as new.
    if (this.snapshot.error) this.set({ error: undefined });
    this.ws.send(JSON.stringify(req));
    return true;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  close() {
    this.stopped = true;
    this.ws?.close();
  }
}

let shared: SessionChannel | undefined;

/** The page's one channel, opened on first use. */
export function sessionChannel(): SessionChannel {
  return (shared ??= new SessionChannel(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/session`,
  ));
}

export function useSession(channel = sessionChannel()): ChannelSnapshot {
  return useSyncExternalStore(channel.subscribe, () => channel.snapshot);
}
