import Bottleneck from 'bottleneck';

export function createRateLimiter(options?: Bottleneck.ConstructorOptions): Bottleneck {
  return new Bottleneck({
    minTime: 20,
    maxConcurrent: 5,
    reservoir: 50,
    reservoirRefreshAmount: 50,
    reservoirRefreshInterval: 1000,
    ...options,
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}
