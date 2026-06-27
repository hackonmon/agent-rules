import WebSocket from 'ws';
import type { Config } from '../config/types.js';
import type { FillEvent, Side } from '../config/types.js';
import { getLogger } from '../util/logger.js';

const log = () => getLogger();

export interface UserSocketCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

type UserSocketListener = {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onFill?: (fill: FillEvent) => void;
  onAlert?: (message: string) => void;
};

interface UserMessage {
  event_type?: string;
  type?: string;
  order_id?: string;
  asset_id?: string;
  market?: string;
  side?: Side;
  price?: string;
  size?: string;
  status?: string;
}

export class UserSocket {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly credentials: UserSocketCredentials,
    private readonly listener: UserSocketListener = {},
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async start(conditionIds: string[]): Promise<void> {
    this.stopped = false;
    await this.connect(conditionIds);
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private async connect(conditionIds: string[]): Promise<void> {
    if (this.stopped) return;

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(this.config.userWsUrl);
      this.ws = ws;

      ws.on('open', () => {
        this.reconnectAttempt = 0;
        this.startHeartbeat();
        ws.send(
          JSON.stringify({
            type: 'user',
            markets: conditionIds,
            auth: {
              apiKey: this.credentials.apiKey,
              secret: this.credentials.secret,
              passphrase: this.credentials.passphrase,
            },
          }),
        );
        this.listener.onConnect?.();
        log().info('User WS connected');
        resolve();
      });

      ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        this.clearHeartbeat();
        this.listener.onDisconnect?.();
        if (!this.stopped) this.scheduleReconnect(conditionIds);
      });

      ws.on('error', (err) => {
        log().error({ err }, 'User WS error');
      });
    });
  }

  private scheduleReconnect(conditionIds: string[]): void {
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    const msg = `User WS reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`;
    log().warn(msg);
    this.listener.onAlert?.(msg);
    setTimeout(() => {
      void this.connect(conditionIds);
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

  private handleMessage(raw: string): void {
    if (raw === '{}' || raw.trim() === '') return;

    let msg: UserMessage;
    try {
      msg = JSON.parse(raw) as UserMessage;
    } catch {
      return;
    }

    const eventType = msg.event_type ?? msg.type;
    if (!eventType) return;

    if (eventType.includes('fill') || eventType.includes('trade') || msg.status === 'MATCHED') {
      if (!msg.order_id || !msg.asset_id || !msg.price || !msg.size) return;
      const fill: FillEvent = {
        orderId: msg.order_id,
        tokenId: msg.asset_id,
        marketId: msg.market ?? '',
        side: msg.side ?? 'BUY',
        price: Number(msg.price),
        size: Number(msg.size),
        timestamp: Date.now(),
        mode: 'live',
      };
      this.listener.onFill?.(fill);
    }
  }
}
