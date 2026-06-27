import type { GammaEvent } from '../data/gammaTypes.js';

export type SportId = 'nba' | 'world_cup';

export interface SportProfile {
  id: SportId;
  label: string;
  /** Polymarket /sports metadata sport codes */
  sportCodes: string[];
  /** Gamma tag IDs to scan for events */
  tagIds: number[];
  /** Gamma series IDs for scheduled match/event groups */
  seriesIds: string[];
  /** Match if title or slug contains any of these (lowercase) */
  titleKeywords: string[];
  /** Match if event tag label/slug contains any of these */
  tagLabels: string[];
  /** Exclude if title/tags contain any of these */
  excludeKeywords: string[];
}

export const SPORT_PROFILES: Record<SportId, SportProfile> = {
  nba: {
    id: 'nba',
    label: 'NBA',
    sportCodes: ['nba'],
    tagIds: [745, 100639],
    seriesIds: ['10345'],
    titleKeywords: ['nba'],
    tagLabels: ['nba'],
    excludeKeywords: ['wnba', 'ncaab', 'ncaa', 'fiba', 'bkarg', 'bkfiba'],
  },
  world_cup: {
    id: 'world_cup',
    label: 'World Cup',
    sportCodes: ['fifwc', 'fif'],
    tagIds: [102232, 100350, 100639],
    seriesIds: ['11433'],
    titleKeywords: ['world cup', 'fifa world cup'],
    tagLabels: ['world cup', 'fifa'],
    excludeKeywords: [
      'club world cup',
      'women',
      'womens',
      'cricket',
      'table tennis',
      'tt world cup',
      'hockey world',
    ],
  },
};

export const DEFAULT_SPORT_FOCUS: SportId[] = ['nba', 'world_cup'];

export function parseSportFocus(raw: string | undefined): SportId[] {
  if (!raw?.trim()) return [...DEFAULT_SPORT_FOCUS];

  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/-/g, '_'))
    .filter(Boolean);

  const resolved: SportId[] = [];
  for (const id of ids) {
    if (id === 'nba' || id === 'world_cup') {
      if (!resolved.includes(id)) resolved.push(id);
    }
  }

  return resolved.length > 0 ? resolved : [...DEFAULT_SPORT_FOCUS];
}

export function getSportProfiles(focus: SportId[]): SportProfile[] {
  return focus.map((id) => SPORT_PROFILES[id]);
}

export function eventMatchesSport(event: GammaEvent, profile: SportProfile): boolean {
  const title = (event.title ?? '').toLowerCase();
  const slug = (event.slug ?? '').toLowerCase();
  const tagText = (event.tags ?? [])
    .map((t) => `${t.label ?? ''} ${(t as { slug?: string }).slug ?? ''}`)
    .join(' ')
    .toLowerCase();
  const blob = `${title} ${slug} ${tagText}`;

  if (profile.excludeKeywords.some((kw) => blob.includes(kw))) {
    return false;
  }

  if (profile.titleKeywords.some((kw) => title.includes(kw) || slug.includes(kw))) {
    return true;
  }

  if (profile.tagLabels.some((kw) => tagText.includes(kw))) {
    return true;
  }

  return false;
}

export function classifyEventSport(
  event: GammaEvent,
  focus: SportId[],
): SportId | null {
  for (const sportId of focus) {
    if (eventMatchesSport(event, SPORT_PROFILES[sportId])) {
      return sportId;
    }
  }
  return null;
}

export async function resolveSportTagsFromMetadata(
  fetchSports: () => Promise<Array<{ sport: string; tags: string }>>,
  focus: SportId[],
): Promise<Map<SportId, number[]>> {
  const sports = await fetchSports();
  const result = new Map<SportId, number[]>();

  for (const sportId of focus) {
    const profile = SPORT_PROFILES[sportId];
    const tagSet = new Set<number>(profile.tagIds);

    for (const meta of sports) {
      if (!profile.sportCodes.includes(meta.sport)) continue;
      for (const part of meta.tags.split(',')) {
        const id = Number(part.trim());
        if (Number.isFinite(id)) tagSet.add(id);
      }
    }

    result.set(sportId, [...tagSet]);
  }

  return result;
}
