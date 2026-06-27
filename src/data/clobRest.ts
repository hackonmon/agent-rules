import type { Config } from '../config/types.js';
import { OrderBookStore, parseRestBook, type RestBookResponse } from './orderBook.js';
import { getLogger } from '../util/logger.js';
import { withRetry } from '../util/rateLimiter.js';

const log = () => getLogger();

export class ClobRestClient {
  constructor(
    private readonly config: Config,
    private readonly store: OrderBookStore,
  ) {}

  async fetchBook(tokenId: string): Promise<void> {
    const url = new URL('/book', this.config.clobBaseUrl);
    url.searchParams.set('token_id', tokenId);

    const raw = await withRetry(async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CLOB book fetch failed: ${res.status}`);
      return (await res.json()) as RestBookResponse;
    });

    const snapshot = parseRestBook(raw);
    this.store.setSnapshot(tokenId, snapshot.bids, snapshot.asks, snapshot.lastTradePrice);
  }

  async fetchBooks(tokenIds: string[]): Promise<void> {
    if (tokenIds.length === 0) return;

    const chunkSize = 50;
    for (let i = 0; i < tokenIds.length; i += chunkSize) {
      const chunk = tokenIds.slice(i, i + chunkSize);
      const url = new URL('/books', this.config.clobBaseUrl);

      const raw = await withRetry(async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk.map((token_id) => ({ token_id }))),
        });
        if (!res.ok) throw new Error(`CLOB books fetch failed: ${res.status}`);
        return (await res.json()) as RestBookResponse[];
      });

      for (const book of raw) {
        const snapshot = parseRestBook(book);
        this.store.setSnapshot(
          snapshot.tokenId,
          snapshot.bids,
          snapshot.asks,
          snapshot.lastTradePrice,
        );
      }
    }

    log().debug({ count: tokenIds.length }, 'Seeded order books from REST');
  }
}
