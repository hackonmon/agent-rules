import type { ClassifiedMarket, MarketType } from '../config/types.js';
import type { GammaMarket } from '../data/gammaTypes.js';

const SPREAD_RE = /spread|handicap|point spread|cover/i;
const TOTAL_RE = /total|over\/under|o\/u|goals scored|points scored|\bover\b|\bunder\b/i;
const DRAW_RE = /draw|tie/i;
const BTTS_RE = /both teams to score|btts/i;
const MONEYLINE_RE = /moneyline|to win|winner|match winner|ml/i;
const OVER_RE = /\bover\b/i;
const UNDER_RE = /\bunder\b/i;
const LINE_RE = /([+-]?\d+(?:\.\d+)?)/;

function normalizeSportsType(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function parseLine(raw: number | string | null | undefined, question: string): number | undefined {
  if (raw != null && raw !== '') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return n;
  }
  const match = question.match(LINE_RE);
  if (match) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function extractTeam(question: string): string | undefined {
  const patterns = [
    /Will (.+?) win/i,
    /(.+?) to win/i,
    /(.+?) \([+-]?\d/,
    /Spread: (.+?) /i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

export function classifyMarket(market: ClassifiedMarket, gamma?: GammaMarket): ClassifiedMarket {
  const sportsType = normalizeSportsType(gamma?.sportsMarketType);
  const question = market.question;
  let type: MarketType = 'other';
  let side: ClassifiedMarket['side'];
  let line = parseLine(gamma?.line, question);
  let team = extractTeam(question);

  if (sportsType.includes('moneyline') || MONEYLINE_RE.test(question)) {
    type = 'moneyline';
    side = 'home';
  } else if (sportsType.includes('spread') || SPREAD_RE.test(question)) {
    type = 'spread';
    side = 'home';
  } else if (sportsType.includes('total') || sportsType === 'totals' || TOTAL_RE.test(question)) {
    type = 'total';
    side = OVER_RE.test(question) ? 'over' : UNDER_RE.test(question) ? 'under' : 'over';
  } else if (sportsType.includes('draw') || DRAW_RE.test(question)) {
    type = 'draw';
    side = 'draw';
  } else if (
    sportsType.includes('btts') ||
    sportsType.includes('both_teams') ||
    BTTS_RE.test(question)
  ) {
    type = 'btts';
    side = 'yes';
  }

  if (type === 'total' && line == null) {
    const totalMatch = question.match(/(\d+(?:\.\d+)?)/);
    if (totalMatch) line = Number(totalMatch[1]);
  }

  if (type === 'spread' && line == null) {
    const spreadMatch = question.match(/([+-]\d+(?:\.\d+)?)/);
    if (spreadMatch) line = Number(spreadMatch[1]);
  }

  return {
    ...market,
    type,
    team,
    line,
    side,
  };
}

export function classifyMarkets(
  markets: ClassifiedMarket[],
  gammaById: Map<string, GammaMarket>,
): ClassifiedMarket[] {
  return markets.map((m) => classifyMarket(m, gammaById.get(m.id)));
}

export function groupByType(markets: ClassifiedMarket[]): Record<MarketType, ClassifiedMarket[]> {
  const groups: Record<MarketType, ClassifiedMarket[]> = {
    moneyline: [],
    spread: [],
    total: [],
    draw: [],
    btts: [],
    other: [],
  };
  for (const market of markets) {
    groups[market.type].push(market);
  }
  return groups;
}
