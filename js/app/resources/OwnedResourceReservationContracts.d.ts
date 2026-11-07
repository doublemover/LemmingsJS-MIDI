import type { ResourceBudgetAdapter } from './ResourceBudgetContracts.js';

export interface OwnedResourceReservationOptions {
  budget?: ResourceBudgetAdapter | null;
  owner: string;
  kind: string;
  category?: string;
  generation?: number;
  bytes?: number;
  maxBytes?: number;
}
export interface OwnedResourceReservationReceipt {
  readonly enabled: boolean;
  readonly owner: string;
  readonly kind: string;
  readonly category: string;
  readonly generation: number;
  readonly declaredBytes: number;
  readonly maxBytes: number;
  readonly state: 'reserved' | 'released' | 'failed-or-unknown';
  readonly error: string | null;
}
export interface OwnedResourceReservation {
  receipt(): Readonly<OwnedResourceReservationReceipt>;
  resize(bytes: number): Readonly<OwnedResourceReservationReceipt>;
  isActive(): boolean;
  release(): boolean;
}
