import type { Config, EventGraph, Opportunity } from '../config/types.js';
import type { OrderBookStore } from '../data/orderBook.js';
import { bpsToDecimal, uuid } from '../util/math.js';
import {
  checkBttsPair,
  checkComplementaryPair,
  checkMoneylineSpread,
  checkSpreadLadder,
  checkThreeWaySum,
  checkTotalsLadder,
} from './relations.js';
import { buildOpportunity, type RelationContext } from './types.js';
import { groupByType } from '../model/marketClassifier.js';

export class ArbDetector {
  constructor(private readonly config: Config) {}

  scan(graphs: EventGraph[], store: OrderBookStore): Opportunity[] {
    const opportunities: Opportunity[] = [];

    for (const graph of graphs) {
      const ctx: RelationContext = {
        eventId: graph.eventId,
        eventTitle: graph.title,
        feeBps: this.config.feeBps,
        slippageBps: this.config.slippageBps,
        minNetEdge: bpsToDecimal(this.config.minNetEdgeBps),
        maxLegSize: 1,
      };

      const groups = groupByType(graph.markets);
      const violations = [
        ...graph.markets.map((m) => checkComplementaryPair(store, m, ctx)),
        ...graph.markets.map((m) => checkBttsPair(store, m, ctx)),
        checkTotalsLadder(store, graph.markets, ctx),
        checkSpreadLadder(store, graph.markets, ctx),
        checkMoneylineSpread(store, groups.moneyline, groups.spread, ctx),
        checkThreeWaySum(store, graph.markets, ctx),
      ].filter((v): v is NonNullable<typeof v> => v !== null);

      for (const violation of violations) {
        const opp = buildOpportunity(ctx, violation);
        opp.id = uuid();
        opportunities.push(opp);
      }
    }

    return opportunities.sort((a, b) => b.netEdge - a.netEdge);
  }
}
