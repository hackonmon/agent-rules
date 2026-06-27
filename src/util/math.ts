export function add(a: number, b: number): number {
  return round(a + b);
}

export function sub(a: number, b: number): number {
  return round(a - b);
}

export function mul(a: number, b: number): number {
  return round(a * b);
}

export function div(a: number, b: number): number {
  return round(a / b);
}

function round(n: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  return Math.round(price / tickSize) * tickSize;
}

export function bpsToDecimal(bps: number): number {
  return bps / 10_000;
}

export function applyFee(price: number, feeBps: number): number {
  return mul(price, 1 + bpsToDecimal(feeBps));
}

export function applySlippage(price: number, slippageBps: number, side: 'BUY' | 'SELL'): number {
  const factor = bpsToDecimal(slippageBps);
  return side === 'BUY' ? mul(price, 1 + factor) : mul(price, 1 - factor);
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => add(acc, v), 0);
}

export function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatUsd(value: number, digits = 2): string {
  return `$${value.toFixed(digits)}`;
}

export function formatPct(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatBps(value: number): string {
  return `${(value * 10_000).toFixed(1)} bps`;
}
