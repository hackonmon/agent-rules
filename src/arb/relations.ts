import type { ClassifiedMarket, Leg } from '../config/types.js';
import type { OrderBookStore } from '../data/orderBook.js';
import { applySlippage, bpsToDecimal, clamp, mul, sub, sum } from '../util/math.js';
import type { RelationContext, RelationViolation } from './types.js';

function buyLeg(
  market: ClassifiedMarket,
  outcome: 'YES' | 'NO',
  price: number,
  size: number,
): Leg {
  const tokenId = outcome === 'YES' ? market.tokens.yesTokenId : market.tokens.noTokenId;
  return {
    tokenId,
    marketId: market.id,
    side: 'BUY',
    price,
    size,
    outcome,
  };
}

function getAsk(store: OrderBookStore, market: ClassifiedMarket, outcome: 'YES' | 'NO'): number | null {
  const tokenId = outcome === 'YES' ? market.tokens.yesTokenId : market.tokens.noTokenId;
  return store.bestAsk(tokenId);
}

function netEdgeFromCost(totalCost: number, payout: number, ctx: RelationContext): number {
  const feeMultiplier = 1 + bpsToDecimal(ctx.feeBps);
  const slippageMultiplier = 1 + bpsToDecimal(ctx.slippageBps);
  const adjustedCost = totalCost * feeMultiplier * slippageMultiplier;
  return sub(payout, adjustedCost);
}

export function checkComplementaryPair(
  store: OrderBookStore,
  market: ClassifiedMarket,
  ctx: RelationContext,
): RelationViolation | null {
  const yesAsk = getAsk(store, market, 'YES');
  const noAsk = getAsk(store, market, 'NO');
  if (yesAsk == null || noAsk == null) return null;

  const totalCost = yesAsk + noAsk;
  const grossEdge = sub(1, totalCost);
  const netEdge = netEdgeFromCost(totalCost, 1, ctx);
  if (netEdge < ctx.minNetEdge) return null;

  const size = clamp(ctx.maxLegSize, 1, 100);
  return {
    relation: 'complementary_pair',
    description: `YES+NO ask sum ${totalCost.toFixed(3)} < 1 on ${market.question.slice(0, 40)}`,
    legs: [
      buyLeg(market, 'YES', yesAsk, size),
      buyLeg(market, 'NO', noAsk, size),
    ],
    grossEdge,
    netEdge,
  };
}

export function checkTotalsLadder(
  store: OrderBookStore,
  markets: ClassifiedMarket[],
  ctx: RelationContext,
): RelationViolation | null {
  const totals = markets
    .filter((m) => m.type === 'total' && m.line != null)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  for (let i = 0; i < totals.length - 1; i++) {
    const lower = totals[i];
    const higher = totals[i + 1];
    const lowerAsk = getAsk(store, lower, 'YES');
    const higherAsk = getAsk(store, higher, 'YES');
    if (lowerAsk == null || higherAsk == null) continue;

    // P(Over lower line) should be >= P(Over higher line)
    if (lowerAsk + 0.001 < higherAsk) {
      const higherNoAsk = getAsk(store, higher, 'NO');
      if (higherNoAsk == null) continue;

      const size = clamp(ctx.maxLegSize, 1, 100);
      const buyPrice = applySlippage(lowerAsk, ctx.slippageBps, 'BUY');
      const hedgePrice = applySlippage(higherNoAsk, ctx.slippageBps, 'BUY');
      const totalCost = buyPrice + hedgePrice;
      const grossEdge = sub(1, totalCost);
      const netEdge = sub(grossEdge, mul(totalCost, bpsToDecimal(ctx.feeBps)));
      if (netEdge < ctx.minNetEdge) continue;

      return {
        relation: 'totals_ladder',
        description: `Totals inversion: Over ${lower.line} (${lowerAsk.toFixed(3)}) < Over ${higher.line} (${higherAsk.toFixed(3)})`,
        legs: [
          buyLeg(lower, 'YES', buyPrice, size),
          buyLeg(higher, 'NO', hedgePrice, size),
        ],
        grossEdge,
        netEdge,
      };
    }
  }
  return null;
}

export function checkSpreadLadder(
  store: OrderBookStore,
  markets: ClassifiedMarket[],
  ctx: RelationContext,
): RelationViolation | null {
  const spreads = markets
    .filter((m) => m.type === 'spread' && m.line != null)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  for (let i = 0; i < spreads.length - 1; i++) {
    const easier = spreads[i];
    const harder = spreads[i + 1];
    const easierAsk = getAsk(store, easier, 'YES');
    const harderAsk = getAsk(store, harder, 'YES');
    if (easierAsk == null || harderAsk == null) continue;

    if (easierAsk + 0.001 < harderAsk) {
      const easierNoAsk = getAsk(store, easier, 'NO');
      if (easierNoAsk == null) continue;

      const size = clamp(ctx.maxLegSize, 1, 100);
      const buyPrice = applySlippage(harderAsk, ctx.slippageBps, 'BUY');
      const hedgePrice = applySlippage(easierNoAsk, ctx.slippageBps, 'BUY');
      const totalCost = buyPrice + hedgePrice;
      const grossEdge = sub(1, totalCost);
      const netEdge = sub(grossEdge, mul(totalCost, bpsToDecimal(ctx.feeBps)));
      if (netEdge < ctx.minNetEdge) continue;

      return {
        relation: 'spread_ladder',
        description: `Spread inversion: ${easier.line} (${easierAsk.toFixed(3)}) < ${harder.line} (${harderAsk.toFixed(3)})`,
        legs: [
          buyLeg(harder, 'YES', buyPrice, size),
          buyLeg(easier, 'NO', hedgePrice, size),
        ],
        grossEdge,
        netEdge,
      };
    }
  }
  return null;
}

export function checkMoneylineSpread(
  store: OrderBookStore,
  moneylines: ClassifiedMarket[],
  spreads: ClassifiedMarket[],
  ctx: RelationContext,
): RelationViolation | null {
  if (moneylines.length === 0 || spreads.length === 0) return null;

  const ml = moneylines[0];
  const spreadAtZero = spreads.find((s) => s.line === 0 || s.line === -0 || s.line === 0.0);
  const sp = spreadAtZero ?? spreads[0];

  const mlAsk = getAsk(store, ml, 'YES');
  const spAsk = getAsk(store, sp, 'YES');
  if (mlAsk == null || spAsk == null) return null;

  const diff = Math.abs(mlAsk - spAsk);
  if (diff <= 0.02) return null;

  const lagging = mlAsk > spAsk ? ml : sp;
  const leading = mlAsk > spAsk ? sp : ml;
  const lagAsk = getAsk(store, lagging, 'YES');
  const leadAsk = getAsk(store, leading, 'YES');
  if (lagAsk == null || leadAsk == null) return null;

  const grossEdge = sub(lagAsk, leadAsk);
  const netEdge = sub(grossEdge, mul(lagAsk + leadAsk, bpsToDecimal(ctx.feeBps)));
  if (netEdge < ctx.minNetEdge) return null;

  const size = clamp(ctx.maxLegSize, 1, 100);
  return {
    relation: 'moneyline_spread',
    description: `ML/spread desync: ML ${mlAsk.toFixed(3)} vs spread ${spAsk.toFixed(3)}`,
    legs: [
      buyLeg(lagging, 'YES', applySlippage(lagAsk, ctx.slippageBps, 'BUY'), size),
      buyLeg(leading, 'NO', sub(1, leadAsk), size),
    ],
    grossEdge,
    netEdge,
  };
}

export function checkThreeWaySum(
  store: OrderBookStore,
  markets: ClassifiedMarket[],
  ctx: RelationContext,
): RelationViolation | null {
  const moneylines = markets.filter((m) => m.type === 'moneyline');
  const draw = markets.find((m) => m.type === 'draw');
  if (moneylines.length < 2 || !draw) return null;

  const asks: number[] = [];
  const legs: Leg[] = [];
  const size = clamp(ctx.maxLegSize, 1, 100);

  for (const ml of moneylines.slice(0, 2)) {
    const ask = getAsk(store, ml, 'YES');
    if (ask == null) return null;
    asks.push(ask);
    legs.push(buyLeg(ml, 'YES', ask, size));
  }

  const drawAsk = getAsk(store, draw, 'YES');
  if (drawAsk == null) return null;
  asks.push(drawAsk);
  legs.push(buyLeg(draw, 'YES', drawAsk, size));

  const totalCost = sum(asks);
  const grossEdge = sub(1, totalCost);
  const netEdge = netEdgeFromCost(totalCost, 1, ctx);
  if (netEdge < ctx.minNetEdge) return null;

  return {
    relation: 'three_way_sum',
    description: `3-way sum ${totalCost.toFixed(3)} < 1 (home+draw+away arb)`,
    legs,
    grossEdge,
    netEdge,
  };
}

export function checkBttsPair(
  store: OrderBookStore,
  market: ClassifiedMarket,
  ctx: RelationContext,
): RelationViolation | null {
  if (market.type !== 'btts') return null;
  return checkComplementaryPair(store, market, ctx);
}
