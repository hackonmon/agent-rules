import type { Config, Leg, Opportunity, RelationType } from '../config/types.js';
import {
  computeKellyStake,
  packageAllInPrice,
  roundStake,
  sharesFromKellyStake,
} from '../util/stakeMath.js';

/** Relations where minimum payout is locked at $1 per share set */
const LOCKED_ARB_RELATIONS: RelationType[] = [
  'complementary_pair',
  'three_way_sum',
  'totals_ladder',
  'spread_ladder',
];

export interface SizedOpportunity extends Opportunity {
  stakeUsd: number;
  kellyFraction: number;
  winProbability: number;
}

export class StakeSizer {
  constructor(private readonly config: Config) {}

  apply(opportunity: Opportunity, bankroll: number): Opportunity {
    const legs = opportunity.legs;
    if (legs.length === 0) return opportunity;

    const allInPrice = packageAllInPrice(legs.map((l) => l.price));
    const winProbability = estimateWinProbability(opportunity);
    const stakeUsd = computeKellyStake({
      probability: winProbability,
      allInPrice,
      bankroll,
      maxStake: this.config.maxPositionUsd,
      minStake: this.config.minStakeUsd,
      kellyFraction: this.config.kellyFraction,
    });

    const shareCount = sharesFromKellyStake(stakeUsd, legs.map((l) => l.price));
    const sizedLegs = legs.map((leg) => ({
      ...leg,
      size: roundStake(Math.max(1, shareCount)),
    }));

    return {
      ...opportunity,
      legs: sizedLegs,
      description: `${opportunity.description} [Kelly $${stakeUsd.toFixed(2)}, ${shareCount} sh/leg]`,
    };
  }
}

function estimateWinProbability(opportunity: Opportunity): number {
  if (LOCKED_ARB_RELATIONS.includes(opportunity.relation)) {
    // Structural arb: payout ≥ $1 per unit when all legs fill; treat as near-certain.
    return Math.min(0.999, 0.95 + opportunity.netEdge);
  }

  if (opportunity.relation === 'moneyline_spread') {
    // Relative-value trade — scale confidence from net edge.
    return clamp(0.52 + opportunity.netEdge * 3, 0.52, 0.92);
  }

  // Fallback: edge-implied probability capped below certainty
  return clamp(0.5 + opportunity.netEdge * 2, 0.51, 0.9);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function totalLegNotional(legs: Leg[]): number {
  return legs.reduce((sum, leg) => sum + leg.price * leg.size, 0);
}
