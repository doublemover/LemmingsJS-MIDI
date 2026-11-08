export async function prepareCausalRecordedInputCorpus(journal, sourceTakeId) {
  const parent = await journal.openTake(sourceTakeId), initial = await journal.readCheckpoint(parent.initialCheckpoint);
  const state = initial.world.graph.owners.find(owner => owner.name === 'world').props, tick = state.tickIndex, generation = state.generation;
  const observed = { version: 1, kind: 'external-observation', sourceId: 'recorded-port', effect: 'observation-only', timestamp: 1234.567, bytes: [0x90, 60, 1] };
  const variants = [
      { name: 'valid-observation', payload: observed, valid: true },
      ...[['negative-byte', [-1]], ['overflow-byte', [256]], ['fractional-byte', [1.5]], ['string-byte', ['144']], ['nonarray-bytes', '90 3c 01'], ['null-bytes', null], ['oversized-bytes', Array(65537).fill(1)]].map(([name, bytes]) => ({ name, payload: { ...observed, bytes } })),
      { name: 'string-timestamp', payload: { ...observed, timestamp: 'yesterday' } },
      { name: 'overflow-timestamp', payload: { ...observed, timestamp: Number.MAX_SAFE_INTEGER + 1 } },
      { name: 'unknown-observation-effect', payload: { ...observed, effect: 'change-world' } },
      { name: 'unknown-observation-field', payload: { ...observed, playing: false } },
      { name: 'unknown-input-version', payload: { ...observed, version: 3 } },
      { name: 'unknown-input-kind', payload: { ...observed, kind: 'future-clock-source' } },
      { name: 'zero-world-speed', payload: { version: 1, kind: 'world-speed', speedFactor: 0 } },
      { name: 'unknown-world-speed-field', payload: { version: 1, kind: 'world-speed', speedFactor: 1, effect: 'future' } },
      { name: 'unknown-transport-field', payload: { version: 1, kind: 'transport-state', playing: true, effect: 'future' } },
      { name: 'negative-transport-clock', payload: { version: 2, kind: 'transport-state', playing: false, speedFactor: -1 } },
      { name: 'missing-cancel-owner', payload: { version: 1, kind: 'intervention-cancel', commandId: 'missing:pending-command' }, code: 'input-boundary-mismatch' },
      { name: 'invalid-performance-removal', payload: { version: 1, kind: 'instrument-performance', change: { version: 1, upserts: [], removed: ['missing:lane'] } } },
      { name: 'unknown-performance-field', payload: { version: 1, kind: 'instrument-performance', change: { version: 1, upserts: [], removed: [] }, future: true } },
      { name: 'invalid-feedback-state', payload: { version: 1, kind: 'physical-feedback-boundary', commands: [], outcomes: [], cancelIds: [], state: {} } },
      { name: 'unknown-tempo-field', kind: 'timeline', payload: { version: 1, kind: 'tempo', bpm: initial.replay.bpm, future: true } },
      { name: 'zero-tempo', kind: 'timeline', payload: { version: 1, kind: 'tempo', bpm: 0 } },
      { name: 'stale-mapping-revision', kind: 'mapping', payload: parent.mapping },
      { name: 'null-intervention', kind: 'intervention', payload: null },
      { name: 'wrong-input-boundary', payload: observed, tickOffset: 1, code: 'input-boundary-mismatch' }
    ], rows = [];
  for (const variant of variants) {
    const takeId = 'take:recorded-input:' + variant.name, writer = await journal.createTake({ takeId, takeName: variant.name, documentId: parent.documentId,
      sourceVersions: parent.sourceVersions, assetRefs: parent.assetRefs, mapping: parent.mapping, captureProfile: parent.captureProfile,
      boundaryState: parent.boundaryState, initialCheckpoint: initial });
    const recordTick = tick + (variant.tickOffset || 0), kind = variant.kind || 'input-observation';
    if (writer.append({ kind, tick: recordTick, generation, payload: variant.payload }).status !== 'accepted') throw new Error('Recorded input fixture was not admitted: ' + variant.name);
    const stopped = await writer.stop({ coverage: { status: 'complete', gaps: [], sourceRange: { firstTick: tick, lastTick: recordTick } },
      ...(variant.valid ? { finalCheckpoint: { value: initial, tick, generation } } : {}) });
    if (!stopped.complete) throw new Error('Recorded input fixture was not durable: ' + variant.name);
    const manifest = await journal.openTake(takeId);
    rows.push({ name: variant.name, takeId, tick: recordTick, kind, valid: !!variant.valid, expectedCode: variant.code || 'unsupported-recorded-input', sourceId: manifest.chunks[0].id, sequence: 1 });
  }
  return { rows, sourceTakeId: parent.takeId, sourceCanonicalHash: parent.canonicalHash };
}
