import type { FillEvent, OrderRecord } from '../config/types.js';
import { createRateLimiter } from '../util/rateLimiter.js';
import { getLogger } from '../util/logger.js';
import { uuid } from '../util/math.js';
import type { ExecutionEngine, PlaceOrderRequest } from './executor.js';

const log = () => getLogger();

export interface LiveClobClient {
  createAndPostOrder(
    order: { tokenID: string; price: number; size: number; side: 'BUY' | 'SELL' },
    options: { tickSize: string; negRisk: boolean },
  ): Promise<{ orderID?: string; id?: string }>;
  cancelOrder(orderId: string): Promise<unknown>;
  cancelAll?: () => Promise<unknown>;
}

export interface LiveExecutorDeps {
  createClient: () => Promise<LiveClobClient>;
}

export class LiveExecutor implements ExecutionEngine {
  readonly mode = 'live' as const;
  private client: LiveClobClient | null = null;
  private readonly orders = new Map<string, OrderRecord>();
  private readonly remoteToLocal = new Map<string, string>();
  private fillCallbacks: Array<(fill: FillEvent) => void> = [];
  private readonly limiter = createRateLimiter({ minTime: 25, maxConcurrent: 3 });
  private balance = 0;

  constructor(private readonly deps: LiveExecutorDeps) {}

  async init(): Promise<void> {
    this.client = await this.deps.createClient();
    log().info('Live CLOB client initialized');
  }

  onFill(callback: (fill: FillEvent) => void): void {
    this.fillCallbacks.push(callback);
  }

  getBalance(): number {
    return this.balance;
  }

  setBalance(balance: number): void {
    this.balance = balance;
  }

  getOpenOrders(): OrderRecord[] {
    return [...this.orders.values()].filter((o) => o.status === 'open' || o.status === 'partial');
  }

  handleExternalFill(fill: FillEvent): void {
    const localId = this.remoteToLocal.get(fill.orderId) ?? fill.orderId;
    const order = this.orders.get(localId);
    if (order) {
      order.filledSize += fill.size;
      order.status = order.filledSize >= order.size ? 'filled' : 'partial';
    }
    for (const cb of this.fillCallbacks) cb({ ...fill, orderId: localId });
  }

  async placeOrder(request: PlaceOrderRequest): Promise<OrderRecord> {
    if (!this.client) throw new Error('Live executor not initialized');

    const localId = uuid();
    const { leg, tickSize, negRisk } = request;

    const order: OrderRecord = {
      id: localId,
      tokenId: leg.tokenId,
      marketId: leg.marketId,
      side: leg.side,
      price: leg.price,
      size: leg.size,
      filledSize: 0,
      status: 'open',
      createdAt: Date.now(),
      opportunityId: request.opportunityId,
    };

    const response = await this.limiter.schedule(() =>
      this.client!.createAndPostOrder(
        {
          tokenID: leg.tokenId,
          price: leg.price,
          size: leg.size,
          side: leg.side,
        },
        { tickSize: String(tickSize), negRisk },
      ),
    );

    const remoteId = response.orderID ?? response.id;
    if (remoteId) this.remoteToLocal.set(remoteId, localId);

    this.orders.set(localId, order);
    log().info({ localId, remoteId, leg }, 'Live order placed');
    return order;
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (!this.client) return;
    const order = this.orders.get(orderId);
    if (!order) return;

    const remoteId = [...this.remoteToLocal.entries()].find(([, local]) => local === orderId)?.[0];
    if (remoteId) {
      await this.limiter.schedule(() => this.client!.cancelOrder(remoteId));
    }
    order.status = 'cancelled';
  }

  async cancelAll(): Promise<void> {
    if (!this.client) return;
    if (this.client.cancelAll) {
      await this.limiter.schedule(() => this.client!.cancelAll!());
    } else {
      for (const order of this.getOpenOrders()) {
        await this.cancelOrder(order.id);
      }
    }
  }
}

export async function createLiveClobClient(config: import('../config/types.js').Config): Promise<LiveClobClient> {
  const { ClobClient, Chain, Side } = await import('@polymarket/clob-client-v2');
  const { createWalletClient, http } = await import('viem');
  const { polygon, polygonAmoy } = await import('viem/chains');
  const { privateKeyToAccount } = await import('viem/accounts');

  if (!config.privateKey) {
    throw new Error('PRIVATE_KEY required for live trading');
  }

  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const chainDef = config.chain.toLowerCase() === 'amoy' ? polygonAmoy : polygon;
  const chain = config.chain.toLowerCase() === 'amoy' ? Chain.AMOY : Chain.POLYGON;

  const walletClient = createWalletClient({
    account,
    chain: chainDef,
    transport: http(),
  });

  const client = new ClobClient({
    host: config.clobBaseUrl,
    chain,
    signer: walletClient,
    creds: {
      key: config.clobApiKey!,
      secret: config.clobApiSecret!,
      passphrase: config.clobApiPassphrase!,
    },
    builderConfig: config.builderCode ? { builderCode: config.builderCode } : undefined,
  });

  return {
    createAndPostOrder: async (order, options) => {
      const side = order.side === 'BUY' ? Side.BUY : Side.SELL;
      return client.createAndPostOrder(
        {
          tokenID: order.tokenID,
          price: order.price,
          size: order.size,
          side,
        },
        {
          tickSize: options.tickSize as '0.1' | '0.01' | '0.001' | '0.0001',
          negRisk: options.negRisk,
        },
      );
    },
    cancelOrder: (orderId) => client.cancelOrder({ orderID: orderId }),
    cancelAll: () => client.cancelAll(),
  };
}
