import type { Config } from '../config/types.js';
import { getLogger } from '../util/logger.js';
import { withRetry } from '../util/rateLimiter.js';
import type { GammaEvent } from './gammaTypes.js';
import { isTradableMarket } from './gammaTypes.js';
import {
  classifyEventSport,
  eventMatchesSport,
  getSportProfiles,
  resolveSportTagsFromMetadata,
  type SportId,
  type SportProfile,
} from '../model/sportsRegistry.js';

const log = () => getLogger();

export class GammaClient {
  constructor(private readonly config: Config) {}

  private async fetchJson<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const url = new URL(path, this.config.gammaBaseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    return withRetry(async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Gamma API ${path} failed: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    });
  }

  async fetchSportsMetadata(): Promise<Array<{ sport: string; tags: string }>> {
    return this.fetchJson<Array<{ sport: string; tags: string }>>('/sports');
  }

  async fetchEventBySlug(slug: string): Promise<GammaEvent | null> {
    const events = await this.fetchJson<GammaEvent[]>('/events', {
      slug,
      active: true,
      closed: false,
    });
    return events[0] ?? null;
  }

  async fetchEventById(eventId: string): Promise<GammaEvent | null> {
    try {
      return await this.fetchJson<GammaEvent>(`/events/${eventId}`);
    } catch {
      return null;
    }
  }

  async fetchEventsByTag(tagId: number, limit = 50, offset = 0): Promise<GammaEvent[]> {
    return this.fetchJson<GammaEvent[]>('/events', {
      tag_id: tagId,
      active: true,
      closed: false,
      limit,
      offset,
      order: 'volume_24hr',
      ascending: false,
    });
  }

  async fetchEventsBySeries(seriesId: string, limit = 50, offset = 0): Promise<GammaEvent[]> {
    return this.fetchJson<GammaEvent[]>('/events', {
      series_id: seriesId,
      active: true,
      closed: false,
      limit,
      offset,
      order: 'volume_24hr',
      ascending: false,
    });
  }

  private async fetchEventsForSource(
    profile: SportProfile,
    fetchPage: (limit: number, offset: number) => Promise<GammaEvent[]>,
    maxEvents: number,
  ): Promise<GammaEvent[]> {
    const events: GammaEvent[] = [];
    const seen = new Set<string>();
    let offset = 0;

    while (events.length < maxEvents) {
      const limit = Math.min(50, maxEvents - events.length + 20);
      const batch = await fetchPage(limit, offset);
      if (batch.length === 0) break;

      for (const event of batch) {
        if (seen.has(event.id)) continue;
        if (!isSportsCandidate(event)) continue;
        if (!eventMatchesSport(event, profile)) continue;
        seen.add(event.id);
        events.push(event);
        if (events.length >= maxEvents) break;
      }

      offset += batch.length;
      if (batch.length < limit) break;
    }

    return events;
  }

  async fetchEventsForSport(profile: SportProfile, maxEvents: number): Promise<GammaEvent[]> {
    const sportTags = await resolveSportTagsFromMetadata(
      () => this.fetchSportsMetadata(),
      [profile.id],
    );
    const tagIds = sportTags.get(profile.id) ?? profile.tagIds;
    const events: GammaEvent[] = [];
    const seen = new Set<string>();

    for (const seriesId of profile.seriesIds) {
      const remaining = Math.max(0, maxEvents - events.length);
      if (remaining === 0) break;

      const batch = await this.fetchEventsForSource(
        profile,
        (limit, offset) => this.fetchEventsBySeries(seriesId, limit, offset),
        remaining,
      );
      for (const event of batch) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      }
    }

    for (const tagId of tagIds) {
      const remaining = Math.max(0, maxEvents - events.length);
      if (remaining === 0) break;

      const batch = await this.fetchEventsForSource(
        profile,
        (limit, offset) => this.fetchEventsByTag(tagId, limit, offset),
        remaining,
      );
      for (const event of batch) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      }
    }

    return events.slice(0, maxEvents);
  }

  async discoverEvents(): Promise<GammaEvent[]> {
    const { eventSlugs, tagIds, maxDiscoveryEvents, sportFocus } = this.config;
    const events: GammaEvent[] = [];
    const seen = new Set<string>();

    for (const slug of eventSlugs) {
      const event = await this.fetchEventBySlug(slug);
      if (event && !seen.has(event.id) && hasTradableMarkets(event)) {
        seen.add(event.id);
        events.push(event);
      }
    }

    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        const remaining = Math.max(0, maxDiscoveryEvents - events.length);
        if (remaining === 0) break;

        let offset = 0;
        while (events.length < maxDiscoveryEvents) {
          const limit = Math.min(50, maxDiscoveryEvents - events.length + 10);
          const batch = await this.fetchEventsByTag(tagId, limit, offset);
          if (batch.length === 0) break;

          for (const event of batch) {
            if (!isSportsCandidate(event)) continue;
            if (!matchesAnyFocusedSport(event, sportFocus)) continue;
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            events.push(event);
            if (events.length >= maxDiscoveryEvents) break;
          }

          offset += batch.length;
          if (batch.length < limit) break;
        }
      }
    } else {
      const profiles = getSportProfiles(sportFocus);
      const perSportLimit = Math.max(10, Math.ceil(maxDiscoveryEvents / profiles.length));

      for (const profile of profiles) {
        const batch = await this.fetchEventsForSport(profile, perSportLimit);
        for (const event of batch) {
          if (!seen.has(event.id)) {
            seen.add(event.id);
            events.push(event);
          }
        }
      }
    }

    const filtered = events
      .filter((event) => eventSlugs.length > 0 || matchesAnyFocusedSport(event, sportFocus))
      .slice(0, maxDiscoveryEvents);

    const hydrated = await this.hydrateEvents(filtered);
    const counts = countBySport(hydrated, sportFocus);
    log().info(
      { count: hydrated.length, sportFocus, counts },
      'Discovered focused sports events',
    );
    return hydrated;
  }

  private async hydrateEvents(events: GammaEvent[]): Promise<GammaEvent[]> {
    const needsHydration = events.filter((event) =>
      (event.markets ?? []).some((m) => isTradableMarket(m) && m.sportsMarketType == null),
    );

    if (needsHydration.length === 0) return events;

    const hydrateLimit = Math.min(needsHydration.length, this.config.maxDiscoveryEvents);
    const detailById = new Map<string, GammaEvent>();

    await Promise.all(
      needsHydration.slice(0, hydrateLimit).map(async (event) => {
        const full = await this.fetchEventById(event.id);
        if (full) detailById.set(event.id, full);
      }),
    );

    return events.map((event) => detailById.get(event.id) ?? event);
  }
}

function matchesAnyFocusedSport(event: GammaEvent, focus: SportId[]): boolean {
  return classifyEventSport(event, focus) !== null;
}

function countBySport(events: GammaEvent[], focus: SportId[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sportId of focus) {
    counts[sportId] = 0;
  }
  for (const event of events) {
    const sportId = classifyEventSport(event, focus);
    if (sportId) counts[sportId] += 1;
  }
  return counts;
}

export function hasTradableMarkets(event: GammaEvent): boolean {
  return (event.markets ?? []).some((market) => isTradableMarket(market));
}

export function isSportsCandidate(event: GammaEvent): boolean {
  const tradable = (event.markets ?? []).filter((market) => isTradableMarket(market));
  if (tradable.length === 0) return false;

  const title = event.title ?? '';
  if (/ vs\.? | at | v /i.test(title)) return true;

  const questions = tradable.map((m) => m.question ?? '').join(' ');
  if (/spread|total|o\/u|over|under|moneyline|both teams to score|handicap|draw| to win|world cup|nba/i.test(questions)) {
    return true;
  }

  const labels = (event.tags ?? []).map((t) => `${t.label ?? ''} ${(t as { slug?: string }).slug ?? ''}`.toLowerCase());
  if (labels.some((label) => /sport|nba|world cup|fifa/i.test(label))) {
    return true;
  }

  return tradable.length >= 1;
}
