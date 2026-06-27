import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config/config.js';
import { GammaClient } from '../src/data/gammaClient.js';
import { buildEventGraphs } from '../src/model/eventGraph.js';
import {
  classifyEventSport,
  eventMatchesSport,
  parseSportFocus,
  SPORT_PROFILES,
} from '../src/model/sportsRegistry.js';

describe('sport focus registry', () => {
  it('defaults to nba and world_cup', () => {
    assert.deepEqual(parseSportFocus(undefined), ['nba', 'world_cup']);
  });

  it('matches World Cup qualifier events', () => {
    const event = {
      id: '1',
      slug: 'england-vs-ghana',
      title: 'England vs. Ghana',
      tags: [{ id: '1', label: 'World Cup' }],
      markets: [
        {
          id: 'm1',
          question: 'Will England win?',
          slug: 'm1',
          conditionId: 'c1',
          enableOrderBook: true,
          clobTokenIds: '["yes","no"]',
        },
      ],
    };
    assert.equal(eventMatchesSport(event, SPORT_PROFILES.world_cup), true);
    assert.equal(classifyEventSport(event, ['nba', 'world_cup']), 'world_cup');
  });

  it('excludes WNBA from NBA focus', () => {
    const event = {
      id: '2',
      slug: 'wnba-finals',
      title: 'WNBA Finals Winner',
      tags: [{ id: '1', label: 'WNBA' }],
      markets: [
        {
          id: 'm1',
          question: 'Will Team A win WNBA?',
          slug: 'm1',
          conditionId: 'c1',
          enableOrderBook: true,
          clobTokenIds: '["yes","no"]',
        },
      ],
    };
    assert.equal(eventMatchesSport(event, SPORT_PROFILES.nba), false);
  });

  it('matches NBA futures markets', () => {
    const event = {
      id: '3',
      slug: 'nba-draft',
      title: '2026 NBA Draft: 1st Overall pick',
      tags: [{ id: '745', label: 'NBA' }],
      markets: [
        {
          id: 'm1',
          question: 'Will Player X be picked first?',
          slug: 'm1',
          conditionId: 'c1',
          enableOrderBook: true,
          clobTokenIds: '["yes","no"]',
        },
      ],
    };
    assert.equal(eventMatchesSport(event, SPORT_PROFILES.nba), true);
  });
});

describe('gamma discovery', () => {
  it('discovers only focused sports (nba + world_cup)', async () => {
    const config = loadConfig({ maxDiscoveryEvents: 20, sportFocus: ['nba', 'world_cup'] });
    const client = new GammaClient(config);
    const events = await client.discoverEvents();
    assert.ok(events.length > 0, 'expected focused sports events');

    for (const event of events) {
      const sport = classifyEventSport(event, config.sportFocus);
      assert.ok(sport, `event should match focus: ${event.title}`);
    }

    const graphs = buildEventGraphs(events, config.sportFocus);
    assert.ok(graphs.length > 0, 'expected tradable graphs');
  });
});
