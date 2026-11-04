export async function installReplayDeploymentObservers(page) {
  await page.addInitScript(() => {
    window.__deploymentAudioOpens = 0; window.__deploymentMidiRequests = 0;
    const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(options) { window.__deploymentAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.__deploymentMidiRequests++; throw new Error('Unexpected hardware request.'); } });
  });
}

export async function captureReplayDeployment({ buildId }) {
  const root = new URL('./', location.href), studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__;
  const [{ getActiveExecutionIdentity }, { createProcgenSessionStorage }, { createProcgenCausalJournal }, { captureProcgenCheckpoint }, { hashProcgenContinuationCheckpoint }] = await Promise.all([
    import(new URL('js/runtime/ActiveExecutionIdentity.js', root)), import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)),
    import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root)),
    import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root))
  ]);
  const active = getActiveExecutionIdentity(); if (active.activeExecution !== 'bound' || active.buildId !== buildId) throw new Error('Capture did not execute the requested immutable application.');
  studio.transport.pause(); api.pause(); api.step(64); studio.play(); api.pause();
  const started = await studio.handlers.startCausalTake({ takeName: 'Actual cross-deployment source' }); if (!started) throw new Error('Native deployment take was not admitted.');
  api.step(32); studio.transport.pause(); api.pause(); const stopped = await studio.handlers.stopCausalTake();
  if (!stopped.complete) throw new Error('Native deployment source did not seal.');
  const storage = createProcgenSessionStorage(), journal = createProcgenCausalJournal({ storage });
  try {
    await journal.verify(stopped.takeId); const parent = await storage.loadCausalTake(stopped.takeId), chunks = [];
    for (const ref of parent.chunks) chunks.push({ id: ref.id, canonical: (await storage.loadCausalChunk(ref.id)).canonical });
    window.__ownedReplayProof = { world: api.world, project: JSON.stringify(studio.getProject()), document: JSON.stringify(studio.getDocumentState()),
      continuation: await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(api.world)), takeId: parent.takeId, manifest: JSON.stringify(parent), chunks };
    return { takeId: parent.takeId, canonicalHash: parent.canonicalHash, sourceVersions: parent.sourceVersions, recorded: parent.sourceVersions.applicationExecution,
      active, ticks: 32, durableSequence: parent.durableSequence, chunks: chunks.length, audioContexts: window.__deploymentAudioOpens, midiRequests: window.__deploymentMidiRequests };
  } finally { storage.close(); }
}

export async function inspectReplayDeployment({ buildId, takeId, kind }) {
  const root = new URL('./', location.href), studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__;
  const [{ getActiveExecutionIdentity }, { createProcgenSessionStorage }, { createProcgenCausalJournal }, { captureProcgenCheckpoint }, { hashProcgenContinuationCheckpoint }, { createCausalReperformance }, { causalRuntimeSourceVersions }] = await Promise.all([
    import(new URL('js/runtime/ActiveExecutionIdentity.js', root)), import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)),
    import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root)),
    import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root)), import(new URL('js/app/procgen/workstation/CausalReperformance.js', root)),
    import(new URL('js/app/procgen/workstation/CausalRuntimeIdentity.js', root))
  ]);
  studio.transport.pause(); api.pause(); const active = getActiveExecutionIdentity(), world = api.world, project = JSON.stringify(studio.getProject());
  if (active.activeExecution !== 'bound' || active.buildId !== buildId) throw new Error('Replay did not execute the requested immutable application.');
  const continuation = await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world));
  const storage = createProcgenSessionStorage(), journal = createProcgenCausalJournal({ storage }); let allocations = 0;
  const parent = await journal.openTake(takeId), before = JSON.stringify(await storage.loadCausalTake(takeId));
  const service = createCausalReperformance({ journal, sourceVersions: causalRuntimeSourceVersions(world, parent.mapping.revision), assetRefs: captureProcgenCheckpoint(world).assets,
    createWorld() { allocations++; throw new Error('Exact/preflight allocated a world.'); }, liveWorld: world });
  try {
    const preflight = await service.preflight({ takeId }), exact = await service.reperform({ takeId, mode: 'exact', executionEpoch: 'actual-deployment:' + kind });
    if (allocations || exact.session !== null || exact.receipt.exactQualified !== false || !exact.receipt.reasons.includes('causal-exact-realm-unqualified')) throw new Error('Unqualified exact deployment execution was accepted.');
    if (preflight.executionBinding.status !== 'mismatched') throw new Error('Changed executing bytes were presented as the original build.');
    await studio.handlers.browseCausalTakes(); await studio.handlers.selectCausalTake(takeId);
    const compared = await studio.handlers.compareCausalTake();
    if (preflight.status === 'compatible-current-runtime') {
      if (!compared?.receipt?.compatibilityMatch || compared.receipt.ticksExecuted !== 32 || compared.receipt.exactQualified !== false || compared.receipt.executionIdentity.buildId !== buildId) throw new Error('Changed build failed its explicitly current-runtime comparison.');
    } else if (preflight.status !== 'unsupported' || !preflight.reasons.includes('asset-identity-mismatch') || compared?.receipt?.status !== 'unsupported') throw new Error('Unexpected changed-asset compatibility outcome.');
    const unchanged = api.world === world && JSON.stringify(studio.getProject()) === project && await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world)) === continuation && JSON.stringify(await storage.loadCausalTake(takeId)) === before;
    if (!unchanged) throw new Error('Cross-deployment comparison changed CURRENT or the original take.');
    window.__ownedReplayProof = { world, project, document: JSON.stringify(studio.getDocumentState()), continuation, takeId, manifest: before,
      chunks: await Promise.all(parent.chunks.map(async ref => ({ id: ref.id, canonical: (await storage.loadCausalChunk(ref.id)).canonical }))) };
    return { kind, active, recorded: parent.sourceVersions.applicationExecution, preflight, exact: exact.receipt, compared: compared.receipt, allocations,
      canonicalHash: parent.canonicalHash, explanation: document.querySelector('.studio-causal-compatibility')?.textContent, unchanged,
      audioContexts: window.__deploymentAudioOpens, midiRequests: window.__deploymentMidiRequests };
  } finally { const receipt = service.dispose(); await receipt.completion; storage.close(); if (receipt.outcome !== 'complete') throw new Error('Cross-deployment preflight cleanup is unresolved.'); }
}

export async function verifyReplayDeploymentUnchanged() {
  const root = new URL('./', location.href), proof = window.__ownedReplayProof, studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__;
  const [{ createProcgenSessionStorage }, { captureProcgenCheckpoint }, { hashProcgenContinuationCheckpoint }] = await Promise.all([
    import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root)),
    import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root))
  ]);
  const storage = createProcgenSessionStorage();
  try {
    const sameChunks = (await Promise.all(proof.chunks.map(async chunk => (await storage.loadCausalChunk(chunk.id)).canonical === chunk.canonical))).every(Boolean);
    return { sameWorld: api.world === proof.world, sameProject: JSON.stringify(studio.getProject()) === proof.project,
      sameDocument: JSON.stringify(studio.getDocumentState()) === proof.document, sameContinuation: await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(api.world)) === proof.continuation,
      sameTake: JSON.stringify(await storage.loadCausalTake(proof.takeId)) === proof.manifest, sameChunks, audioContexts: window.__deploymentAudioOpens, midiRequests: window.__deploymentMidiRequests };
  } finally { storage.close(); }
}

export async function qualifyReplayMigrationFrontiers({ takeId }) {
  const root = new URL('./', location.href), studio = window.__PROCGEN_STUDIO__, api = window.__PROCGEN_LANES__;
  const [{ migrateProcgenCheckpoint, hashProcgenContinuationCheckpoint }, { createProcgenSessionStorage }, { createProcgenCausalJournal }, { createCausalReperformance }, { causalRuntimeSourceVersions }, { captureProcgenCheckpoint }] = await Promise.all([
    import(new URL('js/app/procgen/workstation/ProcgenCheckpointProvenance.js', root)), import(new URL('js/app/procgen/workstation/ProcgenSessionStorage.js', root)),
    import(new URL('js/app/procgen/workstation/ProcgenCausalJournal.js', root)), import(new URL('js/app/procgen/workstation/CausalReperformance.js', root)),
    import(new URL('js/app/procgen/workstation/CausalRuntimeIdentity.js', root)), import(new URL('js/app/procgen/workstation/ProcgenCheckpoint.js', root))
  ]);
  const session = structuredClone(studio.capture()), legacy = structuredClone(session.world), world = api.world;
  legacy.version = 1; delete legacy.schema; delete legacy.numericEncoding; delete legacy.componentCodecs;
  for (const node of legacy.graph.nodes) if (['Float32Array', 'Float64Array'].includes(node.type)) node.values = node.values.map(value =>
    value && typeof value === 'object' ? { '-0': -0, '-Infinity': -Infinity, Infinity, NaN }[value.special] : value);
  const before = structuredClone(legacy), sameData = (a, b) => Object.is(a, b) || !!a && !!b && typeof a === 'object' && typeof b === 'object' &&
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && sameData(a[key], b[key]));
  const migrated = migrateProcgenCheckpoint(legacy), migratedHash = await hashProcgenContinuationCheckpoint(migrated.checkpoint), originalHash = await hashProcgenContinuationCheckpoint(session.world);
  if (!sameData(legacy, before) || migratedHash !== originalHash || migrated.provenance.inspection.exactQualified !== false) throw new Error('Known legacy migration changed typed state or source provenance.');
  const project = JSON.stringify(studio.getProject()), documentState = JSON.stringify(studio.getDocumentState()), history = JSON.stringify(studio.handlers.historyState()), files = [];
  const future = structuredClone(session.world); future.componentCodecs.worldGraph++;
  const futureBefore = JSON.stringify(future); let migrationFailure;
  try { migrateProcgenCheckpoint(future); } catch (error) { migrationFailure = { code: error.code, message: error.message }; }
  if (migrationFailure?.code !== 'checkpoint-incompatible' || JSON.stringify(future) !== futureBefore) throw new Error('Migration repaired an unknown future codec.');
  for (const [kind, checkpoint] of [['lost-legacy-floating-values', legacy], ['future-component-codec', future]]) {
    const started = performance.now(), accepted = await studio.handlers.import(new File([JSON.stringify({ ...session, world: checkpoint })], kind + '.json', { type: 'application/json' }));
    const unchanged = api.world === world && JSON.stringify(studio.getProject()) === project && JSON.stringify(studio.getDocumentState()) === documentState &&
      JSON.stringify(studio.handlers.historyState()) === history && await hashProcgenContinuationCheckpoint(captureProcgenCheckpoint(world)) === originalHash;
    if (accepted !== false || !unchanged || studio.getOperationState() !== null) throw new Error('Unsupported legacy/future file changed CURRENT.');
    files.push({ kind, accepted, unchanged, operationRetired: true, durationMs: performance.now() - started, status: document.querySelector('.studio-status')?.textContent });
  }
  const storage = createProcgenSessionStorage(), journal = createProcgenCausalJournal({ storage }); let allocations = 0, service;
  try {
    const parent = await journal.openTake(takeId), initial = structuredClone(await journal.readCheckpoint(parent.initialCheckpoint)), parentBefore = JSON.stringify(await storage.loadCausalTake(takeId));
    initial.world.componentCodecs.worldGraph++;
    const writer = await journal.createTake({ takeId: 'take:actual-future-codec', takeName: 'Actual unsupported checkpoint codec', documentId: parent.documentId,
      sourceVersions: parent.sourceVersions, captureProfile: parent.captureProfile, boundaryState: parent.boundaryState, initialCheckpoint: initial, mapping: parent.mapping, assetRefs: parent.assetRefs });
    let next = 1;
    while (next <= parent.durableSequence) {
      const page = await journal.query({ takeId, firstSequence: next, limit: 256 });
      for (const { kind, tick, generation, payload } of page.records) if (writer.append({ kind, tick, generation, payload }).status !== 'accepted') throw new Error('Future codec fixture lost a source record.');
      next = page.nextSequence ?? parent.durableSequence + 1;
    }
    const final = parent.checkpoints.findLast(ref => ref.sequence === parent.durableSequence);
    await writer.stop({ coverage: parent.coverage, ...(final ? { finalCheckpoint: { value: await journal.readCheckpoint(final), tick: final.tick, generation: final.generation } } : {}) });
    service = createCausalReperformance({ journal, sourceVersions: causalRuntimeSourceVersions(world, parent.mapping.revision), assetRefs: session.world.assets,
      createWorld() { allocations++; throw new Error('Future codec allocated an execution world.'); } });
    const unsupported = await service.reperform({ takeId: 'take:actual-future-codec', executionEpoch: 'actual-future-codec' });
    if (allocations || unsupported.session !== null || !unsupported.receipt.reasons.includes('unsupported-component-codec') || JSON.stringify(await storage.loadCausalTake(takeId)) !== parentBefore) throw new Error('Future codec was executed or changed its original source.');
    return { migration: migrated.provenance, originalHash, migratedHash, originalLegacyUnchanged: sameData(legacy, before), migrationFailure, files, unsupported: unsupported.receipt, allocations };
  } finally { if (service) { const receipt = service.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Future codec preflight did not retire.'); } storage.close(); }
}
