export interface SimulationExecutionPolicy { readonly schema: 'lemmings-simulation-execution-policy/v1'; readonly physicalFeedbackMode: 'disabled' | 'preserve-live' | 'exact-command-tape' }
export interface SimulationManifest {
  schema: 'lemmings-authoritative-simulation/v1'; ownerId: string; ownerEpoch: number; documentRevision: number;
  rootPath: string; resourceProfile?: 'balanced-v1' | 'compact-v1' | 'single-lane-v1'; checkpoint: unknown; semantic: unknown; timeline: unknown; graph: unknown; performance: unknown;
  executionPolicy?: SimulationExecutionPolicy | null;
  bpm: number; nominalSpeed?: number; playing: boolean; scoreTimeline: boolean;
}
export interface SimulationState {
  readonly phase: string; readonly paused: boolean; readonly worldId: string; readonly generation: number;
  readonly laneCount: number; readonly laneHeight: number; readonly worldWidth: number; readonly tick: number; readonly sequence: number; readonly documentRevision: number; readonly tickDurationMs: number;
  readonly failure?: Readonly<{ code: string; message: string }> | null;
}
export interface SimulationRetirement {
  readonly schema: 'lemmings-retirement/v1'; readonly state: string; readonly outcome: string;
  readonly completion: Promise<SimulationRetirement>;
}
export interface SimulationPacket {
  readonly sequence: number; readonly documentRevision: number; readonly batch: Readonly<Record<string, unknown>>;
  readonly intents: readonly unknown[]; readonly bodyCommands: readonly unknown[];
  readonly scoreTime: Readonly<Record<string, unknown>> | null; readonly tempoBpm: number;
}
export interface SimulationHost {
  readonly mode: 'worker'; readonly identity: Readonly<{ ownerId: string; ownerEpoch: number; documentRevision: number }>; state(): SimulationState | null;
  pause(): Promise<unknown>; resume(): Promise<unknown>; advance(steps: number): Promise<unknown>;
  watchViewport(viewport?: { x?: number; firstLane?: number; laneCount?: number; width?: number; pixelWidth?: number; pixelHeight?: number }): Promise<unknown>;
  stopViewport(): Promise<boolean>; liveProjection(): { read(): Readonly<Record<string, unknown>>; release(): boolean } | null; releaseLiveProjection(): boolean; viewportState(): { active: boolean; phase: string; failure: string | null; sequence?: number; maximumCaptureMs?: number };
  project(viewport?: { x?: number; firstLane?: number; laneCount?: number; width?: number; pixelWidth?: number; pixelHeight?: number }): Promise<{ read(): Readonly<Record<string, unknown>>; release(): boolean }>;
  captureRecoveryCheckpoint(): Promise<{ schema: string; receipt(): Readonly<Record<string, unknown>> | null; read(): Readonly<Record<string, unknown>>; release(): boolean }>;
  detachCheckpoint(): Promise<{ schema: string; receipt(): Readonly<Record<string, unknown>> | null; read(): Readonly<Record<string, unknown>>; release(): boolean }>;
  submit(command: unknown): Promise<unknown>; checkpoint(): Promise<unknown>;
  diagnostics(): Readonly<Record<string, unknown>>; dispose(): SimulationRetirement;
}
export interface SimulationHostOptions {
  manifest: SimulationManifest; resourceBudget: unknown; signal?: AbortSignal;
  requiredPorts?: MessagePort[]; consume?: ((packet: SimulationPacket) => unknown | Promise<unknown>) | null;
  onState?: (state: SimulationState) => void; onViewport?: () => void; Worker?: typeof Worker; MessageChannel?: typeof MessageChannel;
}
export function prepareWorkerProcgenSimulationHost(options: SimulationHostOptions): Promise<SimulationHost>;
export function attachProcgenSimulationOutput(options: Readonly<Record<string, unknown>>): { state(): Readonly<Record<string, unknown>>; dispose(): SimulationRetirement };
export function attachProcgenNativeSimulationOutput(options: Readonly<Record<string, unknown>>): { state(): Readonly<Record<string, unknown>>; dispose(): SimulationRetirement };
export function prepareInProcessProcgenSimulationHost(options: {
  manifest: SimulationManifest; resourceBudget: unknown; signal?: AbortSignal;
  requiredConsumer?: (packet: SimulationPacket) => unknown | Promise<unknown>;
  onState?: (state: SimulationState) => void;
}): Promise<{ host: unknown; restoredContinuationHash: string; execution: string }>;

export { prepareProcgenNativeOutputRealm } from './ProcgenNativeOutputRealm.js';
