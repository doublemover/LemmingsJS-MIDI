export type ProjectCandidateKind = 'checkpoint' | 'recovery-checkpoint' | 'legacy-recovery';
export type ProjectVerification = 'unverified' | 'stored-snapshot-checked' | 'checksum-verified';
export interface ProjectTickBoundary { readonly tick: number; readonly generation: number }
export interface ProjectRecoveryRange { readonly firstSequence: number | null; readonly lastSequence: number; readonly initial: ProjectTickBoundary; readonly final: ProjectTickBoundary; readonly verified: boolean }
export interface ProjectSummary {
  readonly schema: 'procgen-project-summary/v1'; readonly id: string | null; readonly name: string; readonly savedAt: string | null; readonly kind: ProjectCandidateKind;
  readonly revision: number | null; readonly sessionVersion: number | null; readonly projectVersion: number | null; readonly checkpointVersion: number | null;
  readonly laneCount: number | null; readonly seed: number | null; readonly tick: number | null; readonly generation: number | null;
  readonly recoveryGeneration: number | null; readonly documentRevision: number | null; readonly checksum: string | null; readonly sourceDocumentId: string | null;
  readonly sourceStoredRevision: number | null; readonly range: ProjectRecoveryRange | null; readonly verification: ProjectVerification;
  readonly compatibility: 'supported-header' | 'unsupported-header' | 'check-on-open'; readonly assetDigest: string | null; readonly buildId: string | null; readonly paused: true;
}
export interface ProjectSummaryOptions { id?: string; kind?: ProjectCandidateKind; revision?: number; recoveryGeneration?: number; checksum?: string; verification?: ProjectVerification }
export interface ReplacementReviewInput {
  identity: string; documentIdentity: string; name?: string; dirty?: boolean; physicalProgress?: boolean;
  drafts?: { textDrafts?: number; curveDrafts?: number; gestures?: number };
  take?: { recovering?: boolean; finalizing?: boolean; recording?: boolean };
  capture?: { unresolved?: boolean; state?: string };
  recording?: { active?: boolean; learning?: boolean; retained?: number };
  prelisten?: { unresolved?: boolean; active?: boolean }; artifact?: number | boolean; delivery?: boolean; saving?: boolean; preparingFile?: boolean;
}
export interface ReplacementReview {
  readonly identity: string; readonly documentIdentity: string; readonly name: string; readonly required: boolean; readonly reasons: readonly string[];
  readonly textDrafts: number; readonly curveDrafts: number; readonly gestures: number; readonly canReplace: boolean; readonly canSave: boolean; readonly finalizeTake: boolean; readonly replaceLabel: string;
}
export type OperationPhase = 'reviewing' | 'selecting' | 'reading' | 'validating' | 'loading-assets' | 'preparing' | 'committing' | 'finalizing' | 'naming' | 'quiescing' | 'encoding' | 'connecting' | 'loading-sounds' | 'canceling';
export interface OperationViewInput { id: string; kind: string; phase: OperationPhase; cancelable?: boolean; blockingScopes?: readonly string[]; errorCode?: string | null; retryAction?: string | null }
export interface OperationView {
  readonly id: string; readonly kind: string; readonly phase: OperationPhase; readonly label: string; readonly progressKind: 'none' | 'indeterminate'; readonly completed: null; readonly total: null;
  readonly cancelable: boolean; readonly blockingScopes: readonly string[]; readonly errorCode: string | null; readonly retryAction: string | null;
}
export interface OperationBoundaryInput {
  documentIdentity: string; projectRevision: number; editRevision: number; documentId?: string | null; worldId?: string | null; generation?: number | null; tick?: number | null; storedRevision?: number | null;
}
export interface OperationBoundary {
  readonly documentIdentity: string; readonly projectRevision: number; readonly editRevision: number; readonly documentId: string | null; readonly worldId: string | null; readonly generation: number | null; readonly tick: number | null; readonly storedRevision: number | null;
}
export type CommittedOperationOutcome = 'committed' | 'committed-with-error';
export type UncommittedOperationOutcome = 'prepared' | 'canceled' | 'failed' | 'unknown' | 'retired';
interface OperationRequest { id: string; kind: string; source: OperationBoundaryInput; captured?: OperationBoundaryInput | null; errorCode?: string | null }
export type OperationReceiptInput = OperationRequest & ({ outcome: CommittedOperationOutcome; accepted: OperationBoundaryInput } | { outcome: UncommittedOperationOutcome; accepted?: null });
interface OperationReceiptBase { readonly version: 1; readonly id: string; readonly kind: string; readonly source: OperationBoundary; readonly captured: OperationBoundary | null; readonly errorCode: string | null; readonly resourceRetirement: 'reported-separately'; readonly acousticDelivery: false }
export type OperationReceipt = OperationReceiptBase & ({ readonly outcome: CommittedOperationOutcome; readonly accepted: OperationBoundary } | { readonly outcome: UncommittedOperationOutcome; readonly accepted: null });
export interface SceneCommitReceipt {
  readonly status: 'committed'; readonly sceneHash: string; readonly baseIdentity: string; readonly policy: 'stopped-replacement'; readonly transportPlaying: false;
  readonly externalOutputEnabledByScene: false; readonly recordingArmedByScene: false; readonly localAudioEnabledByScene: false;
}
export interface RetirementReceipt { readonly completion?: Promise<unknown>; readonly outcome?: string }
export interface SceneCandidate {
  readonly sceneHash: string; readonly baseIdentity: string; readonly variants: readonly string[];
  readonly admission: { readonly status: string; readonly world: boolean; readonly sound: boolean; readonly mapping: boolean };
  commit(options: { isCurrent: () => boolean; policy: 'stopped-replacement' }): SceneCommitReceipt;
  retire(): RetirementReceipt | Promise<RetirementReceipt>;
}
export interface SceneRequest {
  readonly scene: unknown; readonly preflight: unknown; readonly baseIdentity: string; readonly signal: AbortSignal; readonly isCurrent: () => boolean; readonly onPhase: (phase: string) => void;
}
export interface ScenePreviewOwner {
  readonly routing: 'isolated-local'; readonly externalOutput: false; readonly completion?: Promise<RetirementReceipt>;
  readonly manifest?: { readonly body?: unknown; readonly privateStations?: unknown; readonly sourceHash?: string; readonly ticks?: number };
  readonly monitorRoute?: { readonly cueIncludedInMasterCapture?: boolean };
  state?(): { readonly playing?: boolean }; retire(): RetirementReceipt | Promise<RetirementReceipt>;
}
export interface SceneApplyOptions { signal?: AbortSignal; isCurrent?: () => boolean; onCommit?: () => void; onCommitted?: (receipt: SceneCommitReceipt) => undefined }
export interface SceneLoaderOptions {
  getBaseIdentity: () => string; resolveDependency: (dependency: unknown, options?: unknown) => unknown;
  prepareCandidate: (request: SceneRequest) => Promise<SceneCandidate>;
  preparePreview?: ((request: { candidate: SceneCandidate; authoredStations: boolean; scene: unknown; preflight: unknown; signal: AbortSignal; isCurrent: () => boolean }) => Promise<ScenePreviewOwner>) | null;
  beforeCommit?: (request: { scene: unknown; preflight: unknown; changedScope: readonly string[]; policy: 'stopped-replacement' }) => boolean | Promise<boolean>;
  onState?: (state: Readonly<Record<string, unknown>>) => void;
}
export interface PreferenceReadHold { readonly completion: Promise<unknown>; release(): void }

export interface SessionBindingSource { readonly project: { readonly procgen?: { readonly sceneOrigin?: unknown } }; readonly name: string; readonly savedAt?: string; readonly settings?: Readonly<Record<string, unknown>>; readonly ui?: Readonly<Record<string, unknown>>; readonly transport?: Readonly<Record<string, unknown>>; readonly patterns?: unknown; readonly camera?: unknown; readonly physicalTimeline?: unknown; readonly physicalState?: unknown }
export interface MidiExportRequest {
  format?: 'midi1' | 'ump'; outputRouteId?: string; outputRouteIndex?: number;
  sourceLayer?: 'auto' | 'api-accepted' | 'intent-render' | 'authored-intent'; placement?: 'retained-absolute-beat' | 'rebase-recording-start'; tempoSource?: 'captured-transport' | 'original-flex';
}

export interface StorageReadOptions { signal?: AbortSignal }
export interface DocumentReadOptions extends StorageReadOptions { expectedRevision?: number | null }
export interface ProjectPageCursor { readonly savedAt: string; readonly id: string }
export interface ProjectPageOptions extends StorageReadOptions { limit?: number; cursor?: ProjectPageCursor | null; query?: string }
export interface RecoveryReadOptions extends StorageReadOptions { requireVerified?: boolean; owned?: boolean; expectedGeneration?: number | null; expectedChecksum?: string | null }
export interface RecoverySourceMetadata { documentRevision?: number | null; tick?: number | null; sourceDocumentId?: string | null; sourceStoredRevision?: number | null }
export interface RecoveryWriteOptions extends StorageReadOptions, RecoverySourceMetadata { laneCount?: number; snapshotMetadata?: (() => RecoverySourceMetadata) | null; incremental?: boolean }
export interface StoredProjectRecord { id: string; kind: 'document'; revision: number; name: string; savedAt: string; session: SessionBindingSource & { world: { laneCount: number } } }
export interface RecoveryCommitReceipt { generation: number; checksum: string; documentRevision: number | null; tick: number | null; durable: boolean; canceledAfterCommit: boolean; retirement?: { readonly outcome?: string; readonly failures?: readonly unknown[] } }

export interface ProjectImportFile { readonly size?: number; text(): string | Promise<string>; stream?: () => ReadableStream<Uint8Array> }
