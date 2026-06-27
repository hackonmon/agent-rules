import type { EventGraph, Opportunity } from '../config/types.js';
import { getLogger } from '../util/logger.js';
import type { ExecutionEngine } from './executor.js';

const log = () => getLogger();

export class OrderManager {
  private readonly inFlight = new Set<string>();
  private readonly gameStartHandled = new Set<string>();

  constructor(private readonly engine: ExecutionEngine) {}

  async executeOpportunity(
    opportunity: Opportunity,
    metaByMarket: Map<string, { tickSize: number; negRisk: boolean }>,
  ): Promise<boolean> {
    if (this.inFlight.has(opportunity.id)) return false;
    this.inFlight.add(opportunity.id);
    opportunity.status = 'placing';

    try {
      for (const leg of opportunity.legs) {
        const meta = metaByMarket.get(leg.marketId);
        if (!meta) continue;
        await this.engine.placeOrder({
          leg,
          tickSize: meta.tickSize,
          negRisk: meta.negRisk,
          opportunityId: opportunity.id,
        });
      }
      opportunity.status = 'filled';
      return true;
    } catch (error) {
      opportunity.status = 'rejected';
      log().error({ error, opportunityId: opportunity.id }, 'Order execution failed');
      return false;
    } finally {
      this.inFlight.delete(opportunity.id);
    }
  }

  async cancelAllAtGameStart(event: EventGraph): Promise<void> {
    if (!event.gameStartTime) return;
    if (this.gameStartHandled.has(event.eventId)) return;

    const now = Date.now();
    const startMs = event.gameStartTime.getTime();
    const windowMs = 5 * 60 * 1000;

    if (now >= startMs && now - startMs <= windowMs) {
      await this.engine.cancelAll();
      this.gameStartHandled.add(event.eventId);
      log().warn({ event: event.slug }, 'Cancelled all orders at game start');
    }
  }

  isInFlight(opportunityId: string): boolean {
    return this.inFlight.has(opportunityId);
  }
}
