import type { Config, EventGraph, FillEvent, Opportunity } from '../config/types.js';
import { legNotional } from '../exec/executor.js';
import { bpsToDecimal } from '../util/math.js';

export class RiskManager {
  private readonly seenOpportunities = new Map<string, number>();
  private dailyRealizedPnl = 0;
  private killSwitch = false;
  private eventExposure = new Map<string, number>();

  constructor(private readonly config: Config) {}

  resetDaily(_startBalance: number): void {
    this.dailyRealizedPnl = 0;
    this.killSwitch = false;
  }

  recordRealizedPnl(delta: number): void {
    this.dailyRealizedPnl += delta;
    if (this.dailyRealizedPnl <= -this.config.dailyLossLimitUsd) {
      this.killSwitch = true;
    }
  }

  isKillSwitchActive(): boolean {
    return this.killSwitch;
  }

  activateKillSwitch(): void {
    this.killSwitch = true;
  }

  approve(opportunity: Opportunity, graph: EventGraph, balance: number): {
    approved: boolean;
    reason?: string;
  } {
    if (this.killSwitch) {
      return { approved: false, reason: 'Daily loss kill-switch active' };
    }

    if (opportunity.netEdge < bpsToDecimal(this.config.minNetEdgeBps)) {
      return { approved: false, reason: 'Net edge below threshold' };
    }

    const lastSeen = this.seenOpportunities.get(opportunity.id);
    if (lastSeen && Date.now() - lastSeen < 5_000) {
      return { approved: false, reason: 'Duplicate opportunity cooldown' };
    }

    const notional = opportunity.legs.reduce((acc, leg) => acc + legNotional(leg), 0);
    if (notional > this.config.maxPositionUsd) {
      return { approved: false, reason: 'Position size exceeds max' };
    }
    if (notional > balance) {
      return { approved: false, reason: 'Insufficient balance' };
    }

    const eventExp = this.eventExposure.get(graph.eventId) ?? 0;
    if (eventExp + notional > this.config.maxEventExposureUsd) {
      return { approved: false, reason: 'Event exposure cap exceeded' };
    }

    return { approved: true };
  }

  markExecuted(opportunity: Opportunity, graph: EventGraph): void {
    this.seenOpportunities.set(opportunity.id, Date.now());
    const notional = opportunity.legs.reduce((acc, leg) => acc + legNotional(leg), 0);
    this.eventExposure.set(graph.eventId, (this.eventExposure.get(graph.eventId) ?? 0) + notional);
  }

  onFill(fill: FillEvent): void {
    // exposure tracked at execution time; fills update portfolio separately
    void fill;
  }
}
