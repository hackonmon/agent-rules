import type { ClassifiedMarket, EventGraph, SportId } from '../config/types.js';
import { classifyMarkets } from './marketClassifier.js';
import type { GammaEvent, GammaMarket } from '../data/gammaTypes.js';
import { gammaMarketToBase } from '../data/gammaTypes.js';
import { classifyEventSport } from './sportsRegistry.js';

export function buildEventGraph(
  event: GammaEvent,
  sportFocus: SportId[] = ['nba', 'world_cup'],
): EventGraph | null {
  const markets = event.markets ?? [];
  const baseMarkets: ClassifiedMarket[] = [];
  const gammaById = new Map<string, GammaMarket>();

  for (const gammaMarket of markets) {
    gammaById.set(gammaMarket.id, gammaMarket);
    const base = gammaMarketToBase(gammaMarket, event);
    if (base) baseMarkets.push(base);
  }

  if (baseMarkets.length === 0) return null;

  const classified = classifyMarkets(baseMarkets, gammaById);
  const tokenIds = [
    ...new Set(classified.flatMap((m) => [m.tokens.yesTokenId, m.tokens.noTokenId])),
  ];

  const gameStartTime =
    classified.find((m) => m.gameStartTime)?.gameStartTime ??
    (event.gameStartTime ? new Date(event.gameStartTime) : null);

  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    sportId: classifyEventSport(event, sportFocus),
    gameStartTime,
    markets: classified,
    tokenIds,
  };
}

export function buildEventGraphs(events: GammaEvent[], sportFocus: SportId[] = ['nba', 'world_cup']): EventGraph[] {
  return events
    .map((event) => buildEventGraph(event, sportFocus))
    .filter((g): g is EventGraph => g !== null);
}

export function flattenTokenIds(graphs: EventGraph[]): string[] {
  return [...new Set(graphs.flatMap((g) => g.tokenIds))];
}

export function findMarketByToken(
  graphs: EventGraph[],
  tokenId: string,
): ClassifiedMarket | undefined {
  for (const graph of graphs) {
    for (const market of graph.markets) {
      if (market.tokens.yesTokenId === tokenId || market.tokens.noTokenId === tokenId) {
        return market;
      }
    }
  }
  return undefined;
}

export function getEventForToken(graphs: EventGraph[], tokenId: string): EventGraph | undefined {
  return graphs.find((g) => g.tokenIds.includes(tokenId));
}
