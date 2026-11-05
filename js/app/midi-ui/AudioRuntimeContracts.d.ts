export type AudioLatencyProfile = 'performance' | 'balanced' | 'robust';
export type AudioPreferredRate = 44100 | 48000 | 96000;
export interface AudioRuntimeConfigInput {
  readonly latencyProfile?: AudioLatencyProfile;
  readonly preferredSampleRate?: AudioPreferredRate | null;
  readonly sinkPreference?: string;
}
export interface AudioRuntimeConfig {
  readonly latencyProfile: AudioLatencyProfile;
  readonly preferredSampleRate: AudioPreferredRate | null;
  readonly sinkPreference: string;
}
export interface AudioRuntimeContextRequest {
  readonly latencyHint: AudioContextLatencyCategory;
  readonly sampleRate?: AudioPreferredRate;
  readonly sinkId?: string;
}
export interface AudioRuntimeEventSource {
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}
export interface AudioRuntimeContext extends AudioRuntimeEventSource {
  readonly state?: string;
  readonly sampleRate?: number;
}
export interface AudioRuntimeDocument extends AudioRuntimeEventSource { readonly visibilityState?: string }
export interface AudioPlaybackMetrics {
  readonly underrunDuration: number;
  readonly underrunEvents: number;
  readonly totalDuration: number;
  readonly averageLatency: number;
  readonly minimumLatency: number;
  readonly maximumLatency: number;
}
export type AudioStatsAvailability = 'not-observed' | 'no-context' | 'unavailable' | 'available' | 'invalid';
export type AudioStatsFreshness = 'not-observed' | 'stale-context-not-running' | 'stale-hidden-or-unknown' | 'invalid-observation-clock' |
  'stale-observation-clock-regressed' | 'observed-no-browser-timestamp' | 'unchanged-no-browser-timestamp' | 'waiting-collection-interval';
export interface AudioRuntimeSnapshot {
  readonly schema: 'lemmings-audio-runtime-observation/v1';
  readonly contextEpoch: number;
  readonly series: number;
  readonly routeRevision: number;
  readonly latencyRevision: number;
  readonly config: Readonly<{ latencyProfile: AudioLatencyProfile; preferredSampleRate: AudioPreferredRate | null; sinkPreference: 'explicit-device' | 'default' }>;
  readonly actualSampleRate: number | null;
  readonly contextState: string;
  readonly visibility: 'visible' | 'unknown-or-hidden';
  readonly baseLatencySeconds: number | null;
  readonly outputLatencySeconds: number | null;
  readonly estimatesAreAdditive: false;
  readonly acousticMeasurement: false;
  readonly outputSelection: Readonly<{ setSinkIdAvailable: boolean; actualSink: 'explicit-device' | 'default' | 'silent' | 'unknown'; preferenceObserved: boolean | null }>;
  readonly playbackStats: Readonly<{
    availability: AudioStatsAvailability; freshness: AudioStatsFreshness;
    sampledAtHostMs: number | null; lastChangedAtHostMs: number | null; minimumCollectionIntervalMs: 1000;
    latencyRevision: number; metricsLatencyRevision: number; latencyIntervalPending: boolean;
    cumulativeScope: 'context-lifetime-not-route-or-latency-reset'; units: 'seconds-except-underrun-event-count';
    metrics: AudioPlaybackMetrics | null; hasReportedPlaybackDuration: boolean | null; browserTimestampAvailable: false;
    interpretation: 'digital-playback-path-not-application-only-glitches-or-acoustic-latency';
  }>;
}
export interface AudioRuntimeObserverOptions { readonly nowMs?: () => number; readonly document?: AudioRuntimeDocument }
export interface AudioRuntimeObserver {
  read(context: AudioRuntimeContext | null, contextEpoch: number, config: AudioRuntimeConfig): AudioRuntimeSnapshot | null;
  resetLatency(): boolean;
  dispose(): void;
}
export type AudioRuntimeTransitionPhase = 'idle' | 'selecting' | 'stopping' | 'switching' | 'closing';
export interface AudioPhysicalLatencySnapshot {
  readonly contextEpoch: number | null;
  readonly sampleRate: number | null;
  readonly presentationDelayMs: number;
  readonly effects: Readonly<{ latencyFrames: number | null; routes: number; unresolved: boolean }> | null;
  readonly correlation: Readonly<{ presentationMs: number; uncertaintyMs: number; method: 'output-timestamp' | 'context-correlation-with-reported-latency' }> | null;
}
export interface AudioLatencyBreakdownInput {
  readonly observation: AudioRuntimeSnapshot | null;
  readonly observedAtHostMs: number;
  readonly tickDurationMs?: number | null;
  readonly speed?: number | null;
  readonly paused: boolean;
  readonly physical: AudioPhysicalLatencySnapshot | null;
  readonly masterLookaheadMs: number | null;
}
export interface AudioLatencyBreakdown {
  readonly schema: 'lemmings-audio-latency-breakdown/v1';
  readonly observedAtHostMs: number | null;
  readonly contextEpoch: number | null;
  readonly estimatesAreAdditive: false;
  readonly acousticMeasurement: false;
  readonly simulation: Readonly<{ quantizationMs: number | null; state: 'paused' | 'unavailable' | 'advancing'; scope: 'configured-tick-upper-bound-not-observed-scheduling-delay' }>;
  readonly queue: Readonly<{ configuredLeadMs: number | null; scope: 'physical-browser-audio-presentation-hold-not-midi-clock-lookahead' }>;
  readonly dsp: Readonly<{ masterLookaheadMs: number | null; effectLatencyMs: number | null; effectState: 'unknown' | 'no-effect-route' | 'declared'; retainedEffectRoutes: number | null; scope: 'declared-parallel-effect-path-maximum-not-measured-dsp-or-total' }>;
  readonly correlation: Readonly<{ freshness: 'context-not-running' | 'hidden-or-unknown' | 'context-changed-or-unavailable' | 'unavailable' | 'available' | 'stale-or-invalid'; method: 'output-timestamp' | 'context-correlation-with-reported-latency' | null; ageMs: number | null; uncertaintyMs: number | null }>;
}
export interface AudioRuntimeTransitionResult {
  readonly status: 'configured' | 'rebuild-ready' | 'unchanged' | 'unsupported' | 'busy' | 'retired' | 'canceled' | 'failed';
  readonly errorCode: string | null;
  readonly requiresEnable: boolean;
  readonly acousticReceipt: false;
}
export interface AudioRuntimeTransitionContext extends AudioRuntimeContext {
  readonly sinkId?: unknown;
  setSinkId?(sinkId: string): Promise<void>;
}
export interface AudioRuntimeTransitionPorts {
  getConfig(): AudioRuntimeConfig;
  getContext(): AudioRuntimeTransitionContext | null;
  isRetired(): boolean;
  quiesce(): Promise<boolean>;
  retireContext(context: AudioRuntimeTransitionContext): Promise<boolean>;
  commit(config: AudioRuntimeConfig): void;
  chooseOutput?(): Promise<string>;
  onChange?(): void;
}
export interface AudioRuntimeTransition {
  request(config: AudioRuntimeConfigInput): Promise<AudioRuntimeTransitionResult>;
  choose(): Promise<AudioRuntimeTransitionResult>;
  isPending(): boolean;
  state(): Readonly<{ phase: AudioRuntimeTransitionPhase; pending: boolean; last: AudioRuntimeTransitionResult | null }>;
  invalidate(): void;
  dispose(): Promise<void>;
}
