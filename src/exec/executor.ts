import type { FillEvent, Leg, OrderRecord } from '../config/types.js';

export interface PlaceOrderRequest {
  leg: Leg;
  tickSize: number;
  negRisk: boolean;
  opportunityId?: string;
}

export interface ExecutionEngine {
  readonly mode: 'sim' | 'live';
  placeOrder(request: PlaceOrderRequest): Promise<OrderRecord>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAll(): Promise<void>;
  getOpenOrders(): OrderRecord[];
  onFill(callback: (fill: FillEvent) => void): void;
  getBalance(): number;
}

export type FillCallback = (fill: FillEvent) => void;

export function legNotional(leg: Leg): number {
  return leg.price * leg.size;
}
