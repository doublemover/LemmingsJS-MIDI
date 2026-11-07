import type { createBrowserNotePreview } from '../../midi-ui/browserNotePreview.js';
import type { createResourceBudget } from '../../resources/ResourceBudget.js';
import type { getNativeInstrumentCatalog } from '../../midi-ui/NativeInstrumentSchema.js';
import type { ExecutionEpoch, HostMilliseconds, ScoreBeats, ScoreEpoch } from './AudioClockContracts.js';

export interface PhysicalScorePosition { readonly epoch: ScoreEpoch; readonly beat: ScoreBeats }
export interface PlaybackLaneSource {
  readonly id: string;
  readonly instrumentRef?: { readonly packHash: string; readonly definitionHash: string } | null;
  readonly instrumentControls?: unknown;
  readonly timeTransform?: unknown;
  readonly scoreContext?: unknown;
  readonly piano?: unknown;
  readonly pianoControls?: unknown;
  readonly orchestral?: unknown;
  readonly percussion?: unknown;
}
export interface PlaybackGraphSource {
  readonly revision: number;
  readonly instruments: readonly { readonly id: string; readonly articulation?: { readonly sustain?: boolean; readonly orientation?: string } }[];
  readonly preparedSurfaces?: readonly {
    readonly id: string;
    readonly revision: number;
    readonly surfaceMap: { readonly boundTopologyRevision: number; readonly [key: string]: unknown };
    readonly preparations: readonly { readonly kind: string; readonly lossMaskId?: string }[];
  }[];
}
export interface PlaybackDisplayPort {
  actorEffects?: { subscription?: (() => void) | null; retired?: boolean; visible?: boolean; inspectedActorId?: number; clear(options: { profiles: boolean }): void };
  effectTelemetryActors?: Iterable<number>;
}
export interface PhysicalOutputOwner {
  readonly sinks: readonly unknown[];
  enabled(): boolean;
  observe(position: PhysicalScorePosition, context: { bpm: number; executionEpoch: ExecutionEpoch; generation?: number; worldId?: string; batchId?: string; scoreContext?: { meter?: { beats: number; unit: number } | null } | null }): void;
  flushSourceControls?(batch: PhysicalBatchSource): void;
  synchronizeLaneMix?(): void;
  dispose(): unknown;
  diagnostics?(): unknown;
  lastOutcome?(): { readonly status: string; readonly stage: string; readonly reason?: string | null } | null;
}
export interface InstrumentStateNotice {
  readonly laneId: string;
  readonly state: string;
  readonly code?: string;
  readonly [key: string]: unknown;
}
export interface PhysicalClockSource {
  readonly version: 1;
  readonly worldId: string;
  readonly generation: number;
  readonly tick: number;
  readonly sourceTimeMs: number;
  readonly tickDurationMs: number;
}
export interface PhysicalBatchSource extends PhysicalClockSource {
  readonly batchId: string;
  readonly terrainRevisionAfter?: number;
  readonly snapshot?: { readonly terrainRevision?: number };
  readonly completeness: { readonly status: string; readonly dropped: number };
  readonly facts: readonly unknown[];
}
export type IntentProvenance =
  | { readonly version: 1; readonly kind: 'omitted'; readonly batchId: string; readonly generation: number; readonly count: number }
  | { readonly version: 1; readonly kind?: never; readonly intentId: string; readonly batchId: string; readonly generation: number;
      readonly mappingId: string; readonly graphRevision: number | null; readonly mappingRevision: number | null; readonly evidence: 'canonical-intent-construction' };
export interface PhysicalPlaybackOptions {
  audio: Partial<ReturnType<typeof createBrowserNotePreview>> | null;
  getGraph: () => PlaybackGraphSource;
  scoreTimeline: { map(time: { simTick: number }): PhysicalScorePosition; currentSegment?(): { readonly tempoBpm: number } };
  now: () => HostMilliseconds;
  renderer?: PlaybackDisplayPort | null;
  resourceBudget?: ReturnType<typeof createResourceBudget> | null;
  world?: unknown;
  getLanes?: () => readonly PlaybackLaneSource[];
  getScoreContext?: () => { meter?: { beats: number; unit: number } | null } | null;
  getActorTimbreLocks?: () => readonly import('../../../midi/content/InstrumentActorLocks.js').ActorTimbreLock[];
  isPlaybackEnabled?: () => boolean;
  initialMorphMechanism?: unknown;
  initialCavityBody?: unknown;
  initialPreparedSurface?: unknown;
  continuationStaging?: boolean;
  presentationDelayMs?: number;
  documentEpoch?: string;
  onInstrumentState?: (notice: InstrumentStateNotice) => void;
  onReceipt?: (receipt: Readonly<Record<string, unknown>>) => void;
  onIntentProvenance?: ((receipt: IntentProvenance) => void) | null;
  isEffectCaptureEnabled?: () => boolean;
  getInstrumentCatalog?: typeof getNativeInstrumentCatalog;
  additionalOutputs?: readonly PhysicalOutputOwner[];
}

export interface PhysicalScoreTime extends PhysicalScorePosition {
  readonly simTick: number;
  readonly subTick: number;
  readonly precision: 'tick' | 'endpoint' | 'interpolated';
}
export interface PhysicalScoreTimeRequest {
  simTick: number;
  subTick?: number;
  precision?: PhysicalScoreTime['precision'];
  epoch?: ScoreEpoch;
}
