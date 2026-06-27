import type { FillEvent, PortfolioSnapshot, Position } from '../config/types.js';
import type { OrderBookStore } from '../data/orderBook.js';
import { add, mul, sub } from '../util/math.js';

export class PortfolioTracker {
  private balance: number;
  private readonly positions = new Map<string, Position>();
  private realizedPnl = 0;
  private readonly pnlHistory: Array<{ t: number; pnl: number }> = [];

  constructor(initialBalance: number) {
    this.balance = initialBalance;
    this.pnlHistory.push({ t: Date.now(), pnl: 0 });
  }

  setBalance(balance: number): void {
    this.balance = balance;
  }

  getBalance(): number {
    return this.balance;
  }

  applyFill(fill: FillEvent): void {
    const key = fill.tokenId;
    const existing = this.positions.get(key);
    const cost = mul(fill.price, fill.size);

    if (fill.side === 'BUY') {
      this.balance = sub(this.balance, cost);
      if (existing) {
        const newSize = add(existing.size, fill.size);
        const newCost = add(existing.costBasis, cost);
        existing.size = newSize;
        existing.costBasis = newCost;
        existing.avgPrice = newCost / newSize;
      } else {
        this.positions.set(key, {
          tokenId: fill.tokenId,
          marketId: fill.marketId,
          outcome: 'YES',
          size: fill.size,
          avgPrice: fill.price,
          costBasis: cost,
        });
      }
    } else {
      this.balance = add(this.balance, cost);
      if (existing) {
        const pnl = sub(cost, mul(fill.size, existing.avgPrice));
        this.realizedPnl = add(this.realizedPnl, pnl);
        existing.size = sub(existing.size, fill.size);
        existing.costBasis = mul(existing.size, existing.avgPrice);
        if (existing.size <= 0) this.positions.delete(key);
      }
    }

    this.recordPnlPoint();
  }

  snapshot(store: OrderBookStore): PortfolioSnapshot {
    let unrealized = 0;
    let exposure = 0;

    for (const pos of this.positions.values()) {
      exposure = add(exposure, pos.costBasis);
      const mark = store.midPrice(pos.tokenId) ?? pos.avgPrice;
      unrealized = add(unrealized, sub(mul(pos.size, mark), pos.costBasis));
    }

    const totalPnl = add(this.realizedPnl, unrealized);
    return {
      balance: this.balance,
      positions: [...this.positions.values()],
      realizedPnl: this.realizedPnl,
      unrealizedPnl: unrealized,
      totalPnl,
      exposure,
      pnlHistory: [...this.pnlHistory],
    };
  }

  private recordPnlPoint(): void {
    const last = this.pnlHistory[this.pnlHistory.length - 1];
    const unrealized = 0;
    const total = add(this.realizedPnl, unrealized);
    if (!last || Date.now() - last.t > 1000) {
      this.pnlHistory.push({ t: Date.now(), pnl: total });
      if (this.pnlHistory.length > 300) this.pnlHistory.shift();
    } else {
      last.pnl = total;
      last.t = Date.now();
    }
  }
}
