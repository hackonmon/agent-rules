import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config/config.js';
import type { Opportunity } from '../src/config/types.js';
import { StakeSizer } from '../src/risk/stakeSizer.js';
import {
  computeKellyStake,
  formatStakeUsd,
  packageAllInPrice,
  sharesFromKellyStake,
} from '../src/util/stakeMath.js';

describe('stakeMath (Kelly criterion)', () => {
  it('computes half-Kelly stake for binary market edge', () => {
    const stake = computeKellyStake({
      probability: 0.58,
      allInPrice: 0.52,
      bankroll: 500,
      maxStake: 25,
      minStake: 5,
      kellyFraction: 0.5,
    });
    assert.ok(stake >= 5 && stake <= 25);
    assert.equal(formatStakeUsd(stake).includes('.'), true);
  });

  it('returns minStake when no edge', () => {
    const stake = computeKellyStake({
      probability: 0.5,
      allInPrice: 0.52,
      bankroll: 500,
      maxStake: 25,
      minStake: 5,
      kellyFraction: 0.5,
    });
    assert.equal(stake, 5);
  });

  it('sizes locked arb package (YES+NO < 1)', () => {
    const allIn = packageAllInPrice([0.45, 0.5]);
    assert.equal(allIn, 0.95);

    const stake = computeKellyStake({
      probability: 1,
      allInPrice: allIn,
      bankroll: 10_000,
      maxStake: 500,
      minStake: 5,
      kellyFraction: 0.25,
    });
    assert.equal(stake, 500);

    const shares = sharesFromKellyStake(stake, [0.45, 0.5]);
    assert.ok(shares >= 1);
  });
});

describe('StakeSizer', () => {
  it('applies Kelly sizing to opportunity legs', () => {
    const config = loadConfig({
      maxPositionUsd: 100,
      kellyFraction: 0.5,
      minStakeUsd: 5,
    });
    const sizer = new StakeSizer(config);

    const opp: Opportunity = {
      id: 'test-1',
      eventId: 'e1',
      eventTitle: 'Test',
      relation: 'complementary_pair',
      description: 'YES+NO arb',
      legs: [
        { tokenId: 'y', marketId: 'm1', side: 'BUY', price: 0.45, size: 1, outcome: 'YES' },
        { tokenId: 'n', marketId: 'm1', side: 'BUY', price: 0.5, size: 1, outcome: 'NO' },
      ],
      grossEdge: 0.05,
      netEdge: 0.03,
      detectedAt: Date.now(),
      status: 'detected',
    };

    const sized = sizer.apply(opp, 10_000);
    assert.ok(sized.legs[0].size >= 1);
    assert.ok(sized.legs[1].size === sized.legs[0].size);
    assert.ok(sized.description.includes('Kelly'));
  });
});
