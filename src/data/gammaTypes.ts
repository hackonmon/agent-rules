import type { ClassifiedMarket } from '../config/types.js';

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  clobTokenIds?: string | string[];
  enableOrderBook?: boolean;
  sportsMarketType?: string | null;
  line?: number | string | null;
  gameStartTime?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  minimum_tick_size?: number | string | null;
  neg_risk?: boolean | null;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
}

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  gameStartTime?: string | null;
  markets?: GammaMarket[];
  tags?: Array<{ id: string | number; label?: string }>;
}

export function parseClobTokenIds(raw: string | string[] | undefined): [string, string] | null {
  if (!raw) return null;
  let parsed: string[];
  if (Array.isArray(raw)) {
    parsed = raw;
  } else {
    try {
      parsed = JSON.parse(raw) as string[];
    } catch {
      return null;
    }
  }
  if (parsed.length < 2) return null;
  return [parsed[0], parsed[1]];
}

export function parseGameStartTime(market: GammaMarket, event: GammaEvent): Date | null {
  const raw = market.gameStartTime ?? event.gameStartTime ?? event.startDate ?? market.startDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toNumber(value: number | string | null | undefined, fallback = 0.01): number {
  if (value == null) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isTradableMarket(market: GammaMarket): boolean {
  return market.enableOrderBook === true && !!parseClobTokenIds(market.clobTokenIds);
}

export function gammaMarketToBase(market: GammaMarket, event: GammaEvent): ClassifiedMarket | null {
  const tokens = parseClobTokenIds(market.clobTokenIds);
  if (!tokens || !isTradableMarket(market)) return null;

  return {
    id: market.id,
    conditionId: market.conditionId,
    question: market.question,
    slug: market.slug,
    eventId: event.id,
    eventSlug: event.slug,
    eventTitle: event.title,
    gameStartTime: parseGameStartTime(market, event),
    type: 'other',
    tokens: { yesTokenId: tokens[0], noTokenId: tokens[1] },
    enableOrderBook: true,
    minimumTickSize: toNumber(market.minimum_tick_size),
    negRisk: market.neg_risk === true,
  };
}
