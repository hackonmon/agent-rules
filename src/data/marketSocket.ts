import WebSocket from 'ws';
import type { Config } from '../config/types.js';
import { OrderBookStore } from './orderBook.js';
import { getLogger } from '../util/logger.js';
import { sleep } from '../util/math.js';

const log = () => getLogger();

type MarketSocketListener = {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onAlert?: (message: string) => void;
};

interface BookMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  price_changes?: Array<{
    asset_id: string;
    side: 'BUY' | 'SELL';
    price: string;
    size: string;
  }>;
  price?: string;
}

export class MarketSocket {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private subscribedTokens: string[] = [];
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly store: OrderBookStore,
    private readonly listener: MarketSocketListener = {},
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async start(tokenIds: string[]): Promise<void> {
    this.subscribedTokens = [...new Set(tokenIds)];
    this.stopped = false;
    await this.connect();
  }

  async resubscribe(tokenIds: string[]): Promise<void> {
    this.subscribedTokens = [...new Set(tokenIds)];
    if (!this.connected) return;
    this.sendSubscribe(this.subscribedTokens, false);
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.config.marketWsUrl);
      this.ws = ws;

      ws.on('open', () => {
        this.reconnectAttempt = 0;
        this.startHeartbeat();
        this.sendSubscribe(this.subscribedTokens, true);
        this.listener.onConnect?.();
        log().info({ tokens: this.subscribedTokens.length }, 'Market WS connected');
        resolve();
      });

      ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        this.clearHeartbeat();
        this.listener.onDisconnect?.();
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        log().error({ err }, 'Market WS error');
        if (ws.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      });
    }).catch(() => {
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    const msg = `Market WS reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`;
    log().warn(msg);
    this.listener.onAlert?.(msg);
    setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('{}');
      }
    }, 10_000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendSubscribe(tokenIds: string[], initial: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || tokenIds.length === 0) return;

    if (initial) {
      this.ws.send(
        JSON.stringify({
          type: 'market',
          assets_ids: tokenIds,
          custom_feature_enabled: true,
        }),
      );
    } else {
      this.ws.send(
        JSON.stringify({
          operation: 'subscribe',
          assets_ids: tokenIds,
        }),
      );
    }
  }

  private handleMessage(raw: string): void {
    if (raw === '{}' || raw.trim() === '') return;

    let msg: BookMessage | BookMessage[];
    try {
      msg = JSON.parse(raw) as BookMessage | BookMessage[];
    } catch {
      return;
    }

    const messages = Array.isArray(msg) ? msg : [msg];
    for (const item of messages) {
      this.handleSingleMessage(item);
    }
  }

  private handleSingleMessage(msg: BookMessage): void {
    const eventType = msg.event_type ?? 'book';

    if (eventType === 'book' && msg.asset_id) {
      const bids = (msg.bids ?? []).map((l) => ({ price: Number(l.price), size: Number(l.size) }));
      const asks = (msg.asks ?? []).map((l) => ({ price: Number(l.price), size: Number(l.size) }));
      this.store.applyBookMessage(msg.asset_id, bids, asks);
      return;
    }

    if (eventType === 'price_change' && msg.price_changes) {
      const byAsset = new Map<string, Array<{ side: 'BUY' | 'SELL'; price: number; size: number }>>();
      for (const change of msg.price_changes) {
        const list = byAsset.get(change.asset_id) ?? [];
        list.push({
          side: change.side,
          price: Number(change.price),
          size: Number(change.size),
        });
        byAsset.set(change.asset_id, list);
      }
      for (const [assetId, changes] of byAsset) {
        this.store.applyPriceChange(assetId, changes);
      }
      return;
    }

    if (eventType === 'last_trade_price' && msg.asset_id && msg.price) {
      this.store.setLastTradePrice(msg.asset_id, Number(msg.price));
    }
  }
}

export async function waitForConnection(socket: MarketSocket, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (socket.connected) return true;
    await sleep(100);
  }
  return socket.connected;
}
