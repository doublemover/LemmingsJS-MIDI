export function readLongSessionSample(elapsedMs, api = globalThis.window?.__E2E__) {
  const game = api?.getState?.()?.game, history = game?.history, memory = globalThis.performance?.memory;
  const sample = { elapsedMs, clockMs: globalThis.performance?.now?.(), running: game?.timer?.running, tickIndex: game?.timer?.tickIndex,
    historySpanTicks: history?.spanTicks, historyDeltaCount: history?.deltaCount, coldBlockCount: history?.coldBlockCount,
    coldBlocksCreated: history?.coldBlocksCreated, coldBlocksThawed: history?.coldBlocksThawed, coldBlocksRetired: history?.coldBlocksRetired,
    soundQueued: game?.soundEvents?.queuedCount, soundQueueLimit: game?.soundEvents?.queueLimit, triggerCount: game?.triggers?.totalCount, heapUsedBytes: memory?.usedJSHeapSize };
  sample.validTelemetry = typeof sample.running === 'boolean' && Object.entries(sample).filter(([key]) => key !== 'running').every(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0) && sample.soundQueueLimit > 0;
  return sample;
}
