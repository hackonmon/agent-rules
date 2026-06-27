import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMarket } from '../src/model/marketClassifier.js';
import type { ClassifiedMarket } from '../src/config/types.js';
import { OrderBookStore } from '../src/data/orderBook.js';
import { checkComplementaryPair, checkTotalsLadder } from '../src/arb/relations.js';
import type { RelationContext } from '../src/arb/types.js';

function baseMarket(overrides: Partial<ClassifiedMarket> = {}): ClassifiedMarket {
  return {
    id: 'm1',
    conditionId: 'c1',
    question: 'Will Team A win?',
    slug: 'team-a-win',
    eventId: 'e1',
    eventSlug: 'event-1',
    eventTitle: 'Team A vs Team B',
    gameStartTime: null,
    type: 'moneyline',
    tokens: { yesTokenId: 'yes1', noTokenId: 'no1' },
    enableOrderBook: true,
    minimumTickSize: 0.01,
    negRisk: false,
    ...overrides,
  };
}

describe('marketClassifier', () => {
  it('classifies moneyline from question', () => {
    const result = classifyMarket(baseMarket({ question: 'Team A moneyline to win' }));
    assert.equal(result.type, 'moneyline');
  });

  it('classifies spread and extracts line', () => {
    const result = classifyMarket(
      baseMarket({ question: 'Spread: Team A (-3.5)' }),
      { id: 'm1', question: 'Spread: Team A (-3.5)', slug: 's', conditionId: 'c', sportsMarketType: 'spread', line: -3.5 } as any,
    );
    assert.equal(result.type, 'spread');
    assert.equal(result.line, -3.5);
  });

  it('classifies totals over market', () => {
    const result = classifyMarket(baseMarket({ question: 'Over 2.5 goals?' }));
    assert.equal(result.type, 'total');
    assert.equal(result.side, 'over');
  });

  it('classifies BTTS', () => {
    const result = classifyMarket(baseMarket({ question: 'Both teams to score?' }));
    assert.equal(result.type, 'btts');
  });

  it('classifies draw market', () => {
    const result = classifyMarket(baseMarket({ question: 'Will the match end in a draw?' }));
    assert.equal(result.type, 'draw');
  });
});

describe('relations', () => {
  const ctx: RelationContext = {
    eventId: 'e1',
    eventTitle: 'Test Event',
    feeBps: 0,
    slippageBps: 0,
    minNetEdge: 0.01,
    maxLegSize: 10,
  };

  it('detects complementary pair arb when YES+NO < 1', () => {
    const store = new OrderBookStore();
    const market = baseMarket();
    store.setSnapshot('yes1', [], [{ price: 0.45, size: 100 }]);
    store.setSnapshot('no1', [], [{ price: 0.50, size: 100 }]);

    const violation = checkComplementaryPair(store, market, ctx);
    assert.ok(violation);
    assert.equal(violation.relation, 'complementary_pair');
    assert.ok(violation.netEdge > 0);
    assert.equal(violation.legs.length, 2);
  });

  it('returns null when complementary pair has no edge', () => {
    const store = new OrderBookStore();
    const market = baseMarket();
    store.setSnapshot('yes1', [], [{ price: 0.55, size: 100 }]);
    store.setSnapshot('no1', [], [{ price: 0.50, size: 100 }]);

    const violation = checkComplementaryPair(store, market, ctx);
    assert.equal(violation, null);
  });

  it('detects totals ladder inversion', () => {
    const store = new OrderBookStore();
    const over25 = baseMarket({
      id: 't25',
      type: 'total',
      line: 2.5,
      question: 'Over 2.5 goals',
      tokens: { yesTokenId: 'o25', noTokenId: 'u25' },
    });
    const over35 = baseMarket({
      id: 't35',
      type: 'total',
      line: 3.5,
      question: 'Over 3.5 goals',
      tokens: { yesTokenId: 'o35', noTokenId: 'u35' },
    });

    store.setSnapshot('o25', [], [{ price: 0.40, size: 100 }]);
    store.setSnapshot('u25', [], [{ price: 0.60, size: 100 }]);
    store.setSnapshot('o35', [], [{ price: 0.55, size: 100 }]);
    store.setSnapshot('u35', [], [{ price: 0.40, size: 100 }]);

    const violation = checkTotalsLadder(store, [over25, over35], ctx);
    assert.ok(violation);
    assert.equal(violation.relation, 'totals_ladder');
  });
});
