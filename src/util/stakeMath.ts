/**
 * Kelly stake sizing for Polymarket-style binary markets.
 *
 * Implements the same API as the `stake-math` npm package (kelly.js only).
 * Do NOT install `stake-math` or `polymarket-stake-math` from npm — published
 * versions run a postinstall script that downloads and executes remote code.
 */

export interface KellyStakeInput {
  /** Estimated win probability (0–1) */
  probability: number;
  /** All-in entry price per share (e.g. best ask on YES) */
  allInPrice: number;
  /** Current bankroll in USD */
  bankroll: number;
  /** Maximum stake in USD */
  maxStake: number;
  /** Minimum stake in USD (default 0) */
  minStake?: number;
  /** Fractional Kelly multiplier (default 0.5 = half-Kelly) */
  kellyFraction?: number;
}

export function round(value: number, dp = 0): number {
  const n = Number(value);
  const places = Number(dp) || 0;
  if (!Number.isFinite(n)) return NaN;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

export function format(value: number, dp?: number): string {
  const n = round(value, dp);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(dp ?? 0);
}

/**
 * Kelly fraction for binary markets: f* = (p - price) / (1 - price)
 * Stake = bankroll * f* * kellyFraction, clamped to [minStake, maxStake].
 */
export function computeKellyStake({
  probability,
  allInPrice,
  bankroll,
  maxStake,
  minStake = 0,
  kellyFraction = 0.5,
}: KellyStakeInput): number {
  if (
    !Number.isFinite(probability) ||
    !Number.isFinite(allInPrice) ||
    !Number.isFinite(bankroll) ||
    allInPrice <= 0 ||
    allInPrice >= 1
  ) {
    return minStake;
  }

  const rawKelly = (probability - allInPrice) / (1 - allInPrice);
  if (rawKelly <= 0) return minStake;

  const stake = bankroll * rawKelly * kellyFraction;
  return round(Math.min(maxStake, Math.max(minStake, stake)), 2);
}

export function formatStakeUsd(value: number): string {
  return format(value, 2);
}

export function roundStake(value: number): number {
  return round(value, 2);
}

/** Sum of leg prices = all-in cost for one share of each leg in a package arb */
export function packageAllInPrice(legPrices: number[]): number {
  return legPrices.reduce((sum, p) => sum + p, 0);
}

/**
 * Convert Kelly USD stake into equal share count across arb legs.
 * Total deployment ≈ stakeUsd when each leg buys `size` shares.
 */
export function sharesFromKellyStake(stakeUsd: number, legPrices: number[]): number {
  const allIn = packageAllInPrice(legPrices);
  if (allIn <= 0 || stakeUsd <= 0) return 0;
  return Math.max(1, Math.floor(stakeUsd / allIn));
}
