import type { Config } from '../config/types.js';
import type { FillEvent, OrderRecord } from '../config/types.js';
import type { OrderBookStore } from '../data/orderBook.js';
import { getLogger } from '../util/logger.js';
import { add, mul, uuid } from '../util/math.js';
import type { ExecutionEngine, PlaceOrderRequest } from './executor.js';

const log = () => getLogger();

export class SimExecutor implements ExecutionEngine {
  readonly mode = 'sim' as const;
  private balance: number;
  private readonly orders = new Map<string, OrderRecord>();
  private fillCallbacks: Array<(fill: FillEvent) => void> = [];

  constructor(config: Config, private readonly store: OrderBookStore) {
    this.balance = config.simInitialBalance;
  }

  onFill(callback: (fill: FillEvent) => void): void {
    this.fillCallbacks.push(callback);
  }

  getBalance(): number {
    return this.balance;
  }

  getOpenOrders(): OrderRecord[] {
    return [...this.orders.values()].filter((o) => o.status === 'open' || o.status === 'partial');
  }

  async placeOrder(request: PlaceOrderRequest): Promise<OrderRecord> {
    const { leg } = request;
    const order: OrderRecord = {
      id: uuid(),
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

    this.orders.set(order.id, order);
    this.tryFill(order);
    return order;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order && (order.status === 'open' || order.status === 'partial')) {
      order.status = 'cancelled';
    }
  }

  async cancelAll(): Promise<void> {
    for (const order of this.orders.values()) {
      if (order.status === 'open' || order.status === 'partial') {
        order.status = 'cancelled';
      }
    }
  }

  processRestingOrders(): void {
    for (const order of this.getOpenOrders()) {
      this.tryFill(order);
    }
  }

  private tryFill(order: OrderRecord): void {
    if (order.side !== 'BUY') return;

    const bestAsk = this.store.bestAsk(order.tokenId);
    if (bestAsk == null || bestAsk > order.price + 1e-9) return;

    const remaining = order.size - order.filledSize;
    if (remaining <= 0) return;

    const fillPrice = bestAsk;
    const cost = mul(remaining, fillPrice);
    if (cost > this.balance) {
      log().warn({ orderId: order.id, cost, balance: this.balance }, 'Sim insufficient balance');
      order.status = 'cancelled';
      return;
    }

    this.balance = add(this.balance, -cost);
    order.filledSize = order.size;
    order.status = 'filled';

    const fill: FillEvent = {
      orderId: order.id,
      tokenId: order.tokenId,
      marketId: order.marketId,
      side: order.side,
      price: fillPrice,
      size: remaining,
      timestamp: Date.now(),
      mode: 'sim',
    };

    for (const cb of this.fillCallbacks) cb(fill);
    log().info({ fill, balance: this.balance }, 'Sim fill');
  }
}
