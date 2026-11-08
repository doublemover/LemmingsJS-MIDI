export interface NativeOutputRealmState {
  readonly phase: string; readonly failure: string | null; readonly connectionEpoch: number;
  readonly inventory: Readonly<Record<string, unknown>> | null; readonly capabilities: Readonly<Record<string, unknown>> | null;
  readonly grants: readonly Readonly<{ grant: number; direction: string; groupMask: number; name: string }>[];
  readonly assignments: readonly Readonly<{ laneId: string; outputId: string }>[];
  readonly clock: Readonly<Record<string, unknown>> | null; readonly attached: boolean; readonly batches: number; readonly submittedIntents: number;
  readonly path: string; readonly acousticReceipt: false;
}
export interface NativeOutputRealm {
  state(): NativeOutputRealmState | null; readonly identity: Readonly<{ ownerId: string; applicationBuildId: string }>;
  connect(options: { pairingCode: string; url?: string }): Promise<unknown>; enumerate(): Promise<unknown>; selectBackend(api: number): Promise<unknown>;
  open(options: { inventoryEpoch: number; endpointToken: string; groupMask: number }): Promise<unknown>;
  assign(options: { grant: number; protocol: 'midi1' | 'midi2'; laneIds: readonly string[] }): Promise<unknown>;
  attach(options: { port: MessagePort; manifest: { ownerId: string; ownerEpoch: number; documentRevision: number }; initialHeldVoices: 0; lanes: readonly unknown[]; scoreContext?: unknown }): Promise<unknown>;
  dispose(): { readonly schema: 'lemmings-retirement/v1'; readonly outcome: string; readonly completion: Promise<unknown> };
}
export function prepareProcgenNativeOutputRealm(options: { resourceBudget: unknown; Worker?: typeof Worker; onState?: (state: NativeOutputRealmState) => void; timers?: unknown; signal?: AbortSignal }): Promise<NativeOutputRealm>;
