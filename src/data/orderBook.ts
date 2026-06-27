import type { BookLevel, OrderBookSnapshot } from '../config/types.js';
import { add, mul } from '../util/math.js';

export class OrderBookStore {
  private readonly books = new Map<string, OrderBookSnapshot>();

  get(tokenId: string): OrderBookSnapshot | undefined {
    return this.books.get(tokenId);
  }

  getAll(): Map<string, OrderBookSnapshot> {
    return this.books;
  }

  setSnapshot(tokenId: string, bids: BookLevel[], asks: BookLevel[], lastTradePrice?: number): void {
    this.books.set(tokenId, {
      tokenId,
      bids: sortBids(bids),
      asks: sortAsks(asks),
      lastTradePrice,
      updatedAt: Date.now(),
    });
  }

  applyBookMessage(tokenId: string, bids: BookLevel[], asks: BookLevel[]): void {
    this.setSnapshot(tokenId, bids, asks, this.books.get(tokenId)?.lastTradePrice);
  }

  applyPriceChange(
    tokenId: string,
    changes: Array<{ side: 'BUY' | 'SELL'; price: number; size: number }>,
  ): void {
    const existing = this.books.get(tokenId) ?? {
      tokenId,
      bids: [],
      asks: [],
      updatedAt: Date.now(),
    };

    const bids = [...existing.bids];
    const asks = [...existing.asks];

    for (const change of changes) {
      const levels = change.side === 'BUY' ? bids : asks;
      upsertLevel(levels, change.price, change.size, change.side === 'BUY');
    }

    this.setSnapshot(tokenId, bids, asks, existing.lastTradePrice);
  }

  setLastTradePrice(tokenId: string, price: number): void {
    const existing = this.books.get(tokenId);
    if (!existing) {
      this.setSnapshot(tokenId, [], [], price);
      return;
    }
    existing.lastTradePrice = price;
    existing.updatedAt = Date.now();
  }

  bestBid(tokenId: string): number | null {
    const book = this.books.get(tokenId);
    return book?.bids[0]?.price ?? null;
  }

  bestAsk(tokenId: string): number | null {
    const book = this.books.get(tokenId);
    return book?.asks[0]?.price ?? null;
  }

  midPrice(tokenId: string): number | null {
    const bid = this.bestBid(tokenId);
    const ask = this.bestAsk(tokenId);
    if (bid != null && ask != null) return (bid + ask) / 2;
    if (ask != null) return ask;
    if (bid != null) return bid;
    const book = this.books.get(tokenId);
    return book?.lastTradePrice ?? null;
  }

  impliedProb(tokenId: string): number | null {
    const ask = this.bestAsk(tokenId);
    if (ask != null) return ask;
    return this.midPrice(tokenId);
  }

  depthAtAsk(tokenId: string, maxLevels = 5): number {
    const book = this.books.get(tokenId);
    if (!book) return 0;
    return book.asks.slice(0, maxLevels).reduce((acc, l) => add(acc, l.size), 0);
  }

  costToBuy(tokenId: string, size: number): { avgPrice: number; totalCost: number } | null {
    const book = this.books.get(tokenId);
    if (!book || book.asks.length === 0) return null;

    let remaining = size;
    let totalCost = 0;
    for (const level of book.asks) {
      const take = Math.min(remaining, level.size);
      totalCost = add(totalCost, mul(take, level.price));
      remaining -= take;
      if (remaining <= 0) break;
    }
    if (remaining > 0) return null;

    return { avgPrice: totalCost / size, totalCost };
  }
}

function sortBids(levels: BookLevel[]): BookLevel[] {
  return [...levels].filter((l) => l.size > 0).sort((a, b) => b.price - a.price);
}

function sortAsks(levels: BookLevel[]): BookLevel[] {
  return [...levels].filter((l) => l.size > 0).sort((a, b) => a.price - b.price);
}

function upsertLevel(
  levels: BookLevel[],
  price: number,
  size: number,
  isBid: boolean,
): void {
  const idx = levels.findIndex((l) => l.price === price);
  if (size <= 0) {
    if (idx >= 0) levels.splice(idx, 1);
  } else if (idx >= 0) {
    levels[idx].size = size;
  } else {
    levels.push({ price, size });
  }
  if (isBid) {
    levels.sort((a, b) => b.price - a.price);
  } else {
    levels.sort((a, b) => a.price - b.price);
  }
}

export interface RestBookResponse {
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  last_trade_price?: string;
}

export function parseRestBook(raw: RestBookResponse): OrderBookSnapshot {
  return {
    tokenId: raw.asset_id,
    bids: (raw.bids ?? []).map((l) => ({ price: Number(l.price), size: Number(l.size) })),
    asks: (raw.asks ?? []).map((l) => ({ price: Number(l.price), size: Number(l.size) })),
    lastTradePrice: raw.last_trade_price ? Number(raw.last_trade_price) : undefined,
    updatedAt: Date.now(),
  };
}
