import type { OperationView } from './ProcgenBoundaryContracts.js';

export type OperationalActionId = 'none' | 'export' | 'inspect-midi' | 'inspect-clock' | 'startup-fresh' | 'review-output' | 'discover' | 'take-over-output' | 'listen' | 'review-backend' | 'activate' | 'inspect-physical' | 'inspect-mix' | 'play' | 'lesson' | 'exit-stage';
export type OperationalBlockerCode = 'storage-error' | 'recovery-error' | 'owned-cleanup-unconfirmed' | 'clock-lost' | 'world-failed' | 'output-lost' | 'midi-api-error' | 'midi-permission-revoked' | 'world-preparing' | 'controller-observation' | 'performance-owned-elsewhere' | 'audio-budget' | 'audio-error' | 'route-configuration' | 'midi-permission-denied' | 'midi-unavailable' | 'midi-access-error' | 'output-preparing' | 'midi-no-destinations' | 'midi-selection' | 'midi-inactive' | 'audio-preparing' | 'audio-suspended' | 'audio-off' | 'clock-waiting' | 'instrument-routing' | 'instrument-preparing' | 'lanes-muted' | 'output-thinning' | 'transport-paused' | 'no-source-events' | 'ready';
export interface OperationalSimulationSource {
  readonly available?: boolean; readonly preparing?: boolean; readonly failure?: string | null; readonly canStartFresh?: boolean; readonly paused?: boolean;
  readonly requestedSpeed?: number | null; readonly achievedTicksPerSecond?: number | null; readonly tickDurationMs?: number | null; readonly measurementTime?: number | null;
}
export interface OperationalTransportSource {
  readonly clockSource?: string; readonly clockStatus?: string; readonly reason?: string | null; readonly timestamp?: number | null; readonly playing?: boolean;
  readonly linked?: boolean; readonly bpm?: number | null; readonly baseBpm?: number | null; readonly gameSpeed?: number | null;
}
export interface OperationalAudioSource {
  readonly contextState?: string; readonly status?: string; readonly message?: string; readonly performanceLease?: Readonly<{ status?: string }> | null;
}
export interface OperationalOutputSource {
  readonly selectedBackend?: string; readonly selectedOutputId?: string | null; readonly outputId?: string | null; readonly outputName?: string | null; readonly selectedOutputName?: string | null;
  readonly enabled?: boolean; readonly status?: string; readonly failureKind?: string | null; readonly discoveredOutputCount?: number; readonly midiPermission?: string; readonly message?: string;
  readonly audio?: OperationalAudioSource | null; readonly performanceLease?: Readonly<{ status?: string }> | null;
}
export interface OperationalRouteSource {
  readonly outputId: string; readonly name?: string; readonly active?: boolean; readonly available?: boolean; readonly ownedVoiceAdmissionReady?: boolean;
  readonly configurationFailure?: string | null; readonly activationFailure?: string | null; readonly mpeReady?: boolean; readonly connectionEpoch?: number | null;
}
export interface OperationalMidiSource {
  readonly outputRoutes?: readonly OperationalRouteSource[]; readonly inputId?: string | null; readonly clockOutputId?: string | null; readonly inputPortConnected?: boolean | null;
  readonly inputLiveness?: Readonly<{ mode?: string; observationDomain?: string; lastTrafficTime?: number | null; deadline?: number | null; connectionEpoch?: number | null; evidence?: string; reason?: string }> | null;
  readonly pressure?: Readonly<{ throttled?: boolean; reason?: string | null; dropped?: number | null }> | null;
}
export interface OperationalSource {
  readonly simulation?: OperationalSimulationSource; readonly transport?: OperationalTransportSource; readonly output?: OperationalOutputSource; readonly midi?: OperationalMidiSource;
  readonly physical?: Readonly<{ routingUnavailable?: boolean; prepared?: boolean; accepted?: number; rejected?: number; degraded?: number }> | null;
  readonly lanes?: readonly Readonly<{ solo?: boolean; mute?: boolean; gain?: number; mode?: string }>[];
  readonly storage?: Readonly<{ error?: unknown }>; readonly recovery?: Readonly<{ state?: string; error?: unknown; lessonAvailable?: boolean }>;
  readonly stage?: boolean; readonly identity?: string; readonly documentIdentity?: string; readonly documentRevision?: number; readonly operations?: readonly OperationView[];
}
export interface OperationalCondition {
  readonly code: OperationalBlockerCode; readonly message: string; readonly severity: 'error'; readonly priority: number; readonly scope: 'storage' | 'output';
  readonly target: string; readonly detail: string; readonly actionId: OperationalActionId | ''; readonly actionLabel: string;
}
export interface OperationalSnapshot {
  readonly version: 1; readonly identity: string; readonly documentIdentity: string; readonly documentRevision: number; readonly operations: readonly OperationView[];
  readonly conditions: readonly OperationalCondition[]; readonly stage: boolean; readonly nativeOutputActionAllowed: boolean;
  readonly simulation: Readonly<{ state: 'failed' | 'preparing' | 'unavailable' | 'paused' | 'running'; label: string; requestedSpeed: number | null; achievedTicksPerSecond: number | null; tickDurationMs: number | null; measurementTime: number | null }>;
  readonly transport: Readonly<{ state: 'playing' | 'stopped'; label: string; linked: boolean; bpm: number | null; baseBpm: number | null; gameSpeed: number | null; clockSource: string }>;
  readonly audioContext: Readonly<{ state: string; label: string }>; readonly localBackend: Readonly<{ state: string; enabled: boolean }>;
  readonly noteOutput: Readonly<{ state: 'not-selected' | 'active' | 'preparing' | 'lost' | 'selected' | 'discovered' | 'undiscovered'; label: string; selectedId: string | null; activeId: string | null; permission: string }>;
  readonly clockAuthority: Readonly<{ state: string; label: string; inputId: string | null; outputId: string | null }>;
  readonly controller: Readonly<{ connected: boolean | null; liveness: string; evidence: string; observationDomain: string; connectionEpoch: number | null; lastTrafficTime: number | null; deadline: number | null; evidenceAgeMs: number | null; bridge: 'not-reported' }>;
  readonly pressure: Readonly<{ throttled: boolean; reason: string; dropped: number | null }>;
  readonly blockedReason: Readonly<{ code: OperationalBlockerCode; message: string; severity: 'error' | 'warning' | 'info' }>;
  readonly recoveryAction: Readonly<{ id: OperationalActionId; label: string; enabled: boolean }>; readonly evidence: string;
}
export interface OperationalViewOptions {
  readonly document: Document; readonly readSnapshot: () => OperationalSnapshot | null;
  readonly performAction: (id: OperationalActionId, identity: string) => unknown;
  readonly cancelOperation?: (id: string) => unknown; readonly onStatus?: (message: string) => unknown;
}
export interface OperationalBlocker { readonly priority: number; readonly code: OperationalBlockerCode; readonly message: string; readonly action: readonly [OperationalActionId, string] | null }
