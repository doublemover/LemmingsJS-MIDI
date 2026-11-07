export type ResourceToken = object | string | number | symbol | bigint | boolean;
export interface ResourceReservationRequest {
  token: ResourceToken; owner: string; bytes: number; generation?: number; kind?: string; category?: string;
  previousBytes?: number | null; cache?: boolean; pinned?: boolean; reloadable?: boolean; unreleased?: boolean;
}
export interface ResourceReservation {
  readonly token: ResourceToken; readonly owner: string; readonly generation: number; readonly revision: number; readonly category: string; readonly bytes: number;
  readonly accountedBytes: number; readonly estimatedOverheadBytes: number; readonly pinned: boolean; readonly reloadable: boolean; readonly unreleased: boolean;
}
export interface ResourceReleaseRequest { token: ResourceToken; owner?: string | null; generation?: number | null; revision?: number | null }
export interface ResourceReservationInspection {
  readonly owner: string; readonly generation: number; readonly revision: number; readonly category: string; readonly bytes: number;
  readonly accountedBytes: number; readonly pinned: boolean; readonly unreleased: boolean;
}
export interface ResourceBudgetAdapter {
  reserve(request: ResourceReservationRequest): ResourceReservation | boolean | void;
  release(request: ResourceReleaseRequest): boolean | void;
  inspectReservation?(request: Pick<ResourceReleaseRequest, 'token' | 'owner'>): ResourceReservationInspection | null;
}
export interface ResourceCategoryUsage { residentBytes: number; accountedBytes: number; entries: number; pinned: number; reloadable: number }
export interface ResourceEvictorObservation { owner: string; priority: number; calls: number; failures: number; misses: number; evictions: number; reclaimedBytes: number }
export interface ResourceOwnerObservation { owner: string; generation: number; entries: number; residentBytes: number; accountedBytes: number; pinned: number; unreleased: number }
export interface ResourceBudgetDiagnostics {
  readonly limitBytes: number; readonly accountedBytes: number; readonly residentBytes: number; readonly estimatedOverheadBytes: number; readonly unreleasedEstimatedBytes: number;
  readonly peakAccountedBytes: number; readonly reservations: number; readonly denials: number; readonly evictions: number; readonly retired: boolean;
  readonly admissionDurationMs: number; readonly peakAdmissionDurationMs: number; readonly queueWaitMs: 0; readonly admissionPolicy: 'synchronous-reject-or-admit';
  readonly categoryPeakCoverage: 'complete' | 'truncated-at-256-categories'; readonly categoryPeaks: Readonly<Record<string, number>>;
  readonly evictionPolicy: 'priority-then-least-recently-served'; readonly evictionOwners: readonly Readonly<ResourceEvictorObservation>[];
  readonly categories: Readonly<Record<string, Readonly<ResourceCategoryUsage>>>;
}
export interface ResourceEvictionRequest { readonly neededBytes: number; readonly category: string; readonly owner: string; readonly targetRevision: number | null; readonly evictionPriority: number }
export type ResourceEvictionCallback = (request: ResourceEvictionRequest) => number | boolean | void;
export interface ResourceBudgetOptions { limitBytes?: number; costFactors?: Readonly<Record<string, number>>; now?: () => number }
export interface ResourceBudget extends ResourceBudgetAdapter {
  reserve(request: ResourceReservationRequest): ResourceReservation;
  release(request: ResourceReleaseRequest): boolean;
  inspectReservation(request: Pick<ResourceReleaseRequest, 'token' | 'owner'>): ResourceReservationInspection | null;
  transfer(request: { token: ResourceToken; owner: string; generation: number; toOwner: string; toGeneration?: number; revision?: number | null }): Readonly<{ token: ResourceToken; owner: string; generation: number; revision: number; category: string; bytes: number; accountedBytes: number }>;
  registerEvictor(owner: string, callback: ResourceEvictionCallback, options?: { priority?: number }): () => void;
  diagnostics(): ResourceBudgetDiagnostics;
  inspectOwners(options?: { maximum?: number }): Readonly<{ status: 'complete' | 'truncated'; omittedEntries: number; omittedAccountedBytes: number; owners: readonly Readonly<ResourceOwnerObservation>[] }>;
  retire(): ResourceBudgetDiagnostics;
}
