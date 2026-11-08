export async function causalRuntimeBindingCorpus(journal, sourceTakeId, sourceRoot = new URL('../../js/app/procgen/', import.meta.url)) {
  const { createCausalReperformance } = await import(new URL('workstation/CausalReperformance.js', sourceRoot));
  const { getActiveExecutionIdentity } = await import(new URL('../../runtime/ActiveExecutionIdentity.js', sourceRoot));
  const parent = await journal.openTake(sourceTakeId), initial = await journal.readCheckpoint(parent.initialCheckpoint), active = getActiveExecutionIdentity();
  const original = JSON.stringify(parent), recorded = parent.sourceVersions.applicationExecution?.activeExecution === 'bound' ? parent.sourceVersions.applicationExecution :
    { receiptVersion: 3, activeExecution: 'bound', buildId: '1'.repeat(64), closureDigest: '2'.repeat(64), codeDigest: '3'.repeat(64), assetDigest: '4'.repeat(64),
      harnessVersion: 'browser-survey-v1', stateSchema: 11, realmId: 'recorded-realm', capabilityProfile: 'browser-survey-core', binding: 'immutable-application-generation', identityRecipe: 'normalized-data-slot-v2-instruments' };
  const require = (value, message) => { if (!value) throw new Error(message); };
  const variants = [
    { kind: 'matching-recording', edit() {}, full: true },
    { kind: 'legacy-recording', edit(value) { delete value.applicationExecution; }, full: true, reason: 'legacy-recording-execution-unbound' },
    { kind: 'different-realm', edit(value) { value.applicationExecution.realmId = 'other-recording-realm'; } },
    ...['buildId', 'closureDigest', 'codeDigest', 'assetDigest', 'harnessVersion', 'stateSchema', 'identityRecipe'].map(field => ({ kind: 'changed-' + field,
      edit(value) { const identity = value.applicationExecution; identity[field] = field === 'stateSchema' ? identity[field] + 1 : field.endsWith('Digest') || field === 'buildId' ? (identity[field][0] === 'a' ? 'b' : 'a') + identity[field].slice(1) : identity[field] + '-changed'; },
      full: field === 'codeDigest', mismatch: field })),
    { kind: 'missing-code-hash', edit(value) { delete value.applicationExecution.codeDigest; }, reason: 'recorded-execution-identity-invalid' },
    { kind: 'future-execution-version', edit(value) { value.applicationExecution.receiptVersion++; }, reason: 'recorded-execution-version-unsupported' },
    { kind: 'unbuilt-recording', edit(value) { value.applicationExecution = { receiptVersion: 3, activeExecution: 'unbound', reason: 'unbuilt-source-entry' }; }, reason: 'recorded-execution-unbound' },
    { kind: 'future-protocol', edit(value) { value.physicalMusic++; }, unsupported: 'source-version-mismatch' },
    { kind: 'changed-asset-collection', edit() {}, assets: [...parent.assetRefs, { id: 'unavailable-asset', revision: 'a'.repeat(64) }], unsupported: 'asset-identity-mismatch' }
  ];
  const records = []; let next = 1;
  while (next <= parent.durableSequence) {
    const page = await journal.query({ takeId: parent.takeId, firstSequence: next, limit: 4096 }); records.push(...page.records);
    require(page.records.length && (page.nextSequence == null || page.nextSequence > next), 'Source corpus page did not advance'); next = page.nextSequence ?? parent.durableSequence + 1;
  }
  const last = parent.checkpoints.findLast(ref => ref.sequence === parent.durableSequence), final = last && await journal.readCheckpoint(last), rows = [];
  let allocations = 0;
  const service = createCausalReperformance({ journal, sourceVersions: parent.sourceVersions, assetRefs: parent.assetRefs,
    createWorld() { allocations++; throw new Error('Preflight allocated a world'); } });
  try {
    for (const variant of variants) {
      const sourceVersions = structuredClone({ ...parent.sourceVersions, applicationExecution: recorded }); variant.edit(sourceVersions);
      const takeId = 'take:binding:' + variant.kind;
      const writer = await journal.createTake({ takeId, takeName: variant.kind, documentId: parent.documentId, sourceVersions, captureProfile: parent.captureProfile,
        boundaryState: parent.boundaryState, initialCheckpoint: initial, mapping: parent.mapping, assetRefs: variant.assets || parent.assetRefs });
      if (variant.full) for (const { kind, tick, generation, payload } of records) require(writer.append({ kind, tick, generation, payload }).status === 'accepted', 'Corpus record not admitted');
      const stopped = await writer.stop({ coverage: variant.full ? parent.coverage : { status: 'complete', gaps: [] },
        ...(variant.full && final ? { finalCheckpoint: { value: final, tick: last.tick, generation: last.generation } } : {}) });
      require(stopped.complete, 'Corpus take not durable: ' + variant.kind);
      const compatible = await service.preflight({ takeId }), exact = await service.reperform({ takeId, mode: 'exact', executionEpoch: 'binding:' + variant.kind });
      require(compatible.status === (variant.unsupported ? 'unsupported' : 'compatible-current-runtime'), 'Incorrect compatibility outcome: ' + variant.kind);
      if (variant.unsupported) require(compatible.reasons.includes(variant.unsupported), 'Missing protocol/asset reason: ' + variant.kind);
      if (variant.reason) require(compatible.executionBinding.reasons.includes(variant.reason), 'Missing execution reason: ' + variant.kind);
      if (variant.mismatch && active.activeExecution === 'bound') require(compatible.executionBinding.status === 'mismatched' && compatible.executionBinding.mismatches.includes(variant.mismatch), 'Build mismatch accepted: ' + variant.kind);
      if (['matching-recording', 'different-realm'].includes(variant.kind) && active.activeExecution === 'bound') require(compatible.executionBinding.status === 'matched', 'Matching trusted active build refused: ' + variant.kind);
      require(exact.session === null && exact.receipt.status === 'unsupported' && exact.receipt.exactQualified === false && exact.receipt.reasons.includes('causal-exact-realm-unqualified'), 'Unqualified exact causal replay executed');
      require(allocations === 0 && exact.receipt.executionIdentity.activeExecution === active.activeExecution, 'Caller supplied source identity replaced actual executing identity');
      rows.push({ kind: variant.kind, takeId, compatibility: compatible.status, binding: compatible.executionBinding, reasons: compatible.reasons, exactReasons: exact.receipt.reasons, full: !!variant.full });
    }
    require(JSON.stringify(await journal.openTake(parent.takeId)) === original, 'Source manifest changed during compatibility inspection');
    return { rows, allocations, sourceUnchanged: true, active };
  } finally { const receipt = service.dispose(); await receipt.completion; require(receipt.outcome === 'complete', 'Corpus runtime did not retire'); }
}
