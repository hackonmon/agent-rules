import type { Leg, Opportunity, RelationType } from '../config/types.js';

export interface RelationContext {
  eventId: string;
  eventTitle: string;
  feeBps: number;
  slippageBps: number;
  minNetEdge: number;
  maxLegSize: number;
}

export interface RelationViolation {
  relation: RelationType;
  description: string;
  legs: Leg[];
  grossEdge: number;
  netEdge: number;
}

export function buildOpportunity(
  ctx: RelationContext,
  violation: RelationViolation,
): Opportunity {
  return {
    id: `${ctx.eventId}-${violation.relation}-${Date.now()}`,
    eventId: ctx.eventId,
    eventTitle: ctx.eventTitle,
    relation: violation.relation,
    description: violation.description,
    legs: violation.legs,
    grossEdge: violation.grossEdge,
    netEdge: violation.netEdge,
    detectedAt: Date.now(),
    status: 'detected',
  };
}
