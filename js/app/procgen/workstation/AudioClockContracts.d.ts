declare const unit: unique symbol;
declare const identity: unique symbol;
export type HostMilliseconds = number & { readonly [unit]: 'host-monotonic-milliseconds' };
export type DurationMilliseconds = number & { readonly [unit]: 'duration-milliseconds' };
export type ScoreBeats = number & { readonly [unit]: 'score-quarter-note-beats' };
export type AudioSeconds = number & { readonly [unit]: 'audio-context-seconds' };
export type AudioFrame = number & { readonly [unit]: 'audio-render-frame' };
export type SampleRateHz = number & { readonly [unit]: 'audio-sample-rate-hz' };
export type TempoBpm = number & { readonly [unit]: 'quarter-note-beats-per-minute' };
export type ExecutionEpoch = string & { readonly [identity]: 'physical-execution-epoch' };
export type ScoreEpoch = string & { readonly [identity]: 'score-epoch' };

export interface NativeAudioClockContext {
  readonly state: string;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): { readonly contextTime: number; readonly performanceTime: number };
}
export interface AudioClockBridgeOptions {
  getContext: () => NativeAudioClockContext | null;
  nowMs: () => HostMilliseconds;
  presentationDelayMs?: DurationMilliseconds;
  maxHorizonMs?: DurationMilliseconds;
}
export interface AudioClockAnchorInput {
  executionEpoch: ExecutionEpoch;
  scoreEpoch: ScoreEpoch;
  beat: ScoreBeats;
  hostMs: HostMilliseconds;
  bpm: TempoBpm;
  reason?: string;
}
export interface AudioClockAnchor {
  readonly executionEpoch: ExecutionEpoch;
  readonly scoreEpoch: ScoreEpoch;
  readonly beat: ScoreBeats;
  readonly hostMs: HostMilliseconds;
  readonly bpm: TempoBpm;
  readonly contextSeconds: AudioSeconds;
  readonly correlationHostMs: HostMilliseconds;
  readonly sampleRate: SampleRateHz;
  readonly uncertaintyMs: DurationMilliseconds;
  readonly presentationDelayMs: DurationMilliseconds;
  readonly reason: string;
}
export interface DisplayClockRequest { executionEpoch: ExecutionEpoch; contextEpoch: number }
export interface DisplayClockCorrelation {
  readonly executionEpoch: ExecutionEpoch;
  readonly contextEpoch: number;
  readonly audioFrame: AudioFrame;
  readonly presentationMs: HostMilliseconds;
  readonly sampleRate: SampleRateHz;
  readonly outputLatencyMs: DurationMilliseconds;
  readonly uncertaintyMs: DurationMilliseconds;
  readonly method: 'output-timestamp' | 'context-correlation-with-reported-latency';
  readonly acousticReceipt: false;
}
export interface AudioClockDiagnostics {
  readonly anchor: AudioClockAnchor | null;
  readonly rebases: number;
  readonly rejected: number;
  readonly displayCorrelations: number;
  readonly displayRejected: number;
  readonly presentationDelayMs: DurationMilliseconds;
  readonly maxHorizonMs: DurationMilliseconds;
  readonly currentFrame: AudioFrame | null;
  readonly baseLatencySeconds: AudioSeconds | null;
  readonly outputLatencySeconds: AudioSeconds | null;
  readonly outputCorrelation: { readonly contextSeconds: AudioSeconds; readonly hostMs: HostMilliseconds } | null;
}
export interface AudioClockBridge {
  rebase(input: AudioClockAnchorInput): AudioClockAnchor;
  isAnchored(executionEpoch: ExecutionEpoch, scoreEpoch: ScoreEpoch, bpm: TempoBpm): boolean;
  toTargetFrame(scoreTime: { epoch: ScoreEpoch; beat: ScoreBeats }, executionEpoch: ExecutionEpoch): AudioFrame | null;
  currentFrame(): AudioFrame | null;
  correlateDisplay(request?: Partial<DisplayClockRequest>): DisplayClockCorrelation | null;
  diagnostics(): AudioClockDiagnostics;
  invalidate(): void;
  getAnchor(): AudioClockAnchor | null;
}
