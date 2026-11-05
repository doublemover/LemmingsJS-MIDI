export const NATIVE_CLOCK_SCENARIOS = Object.freeze(['stall-20', 'stall-50', 'stall-100', 'cancel-before-render', 'cancel-after-render', 'independent-owner', 'listen-rearm', 'context-replacement']);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function qualifyNativeClockReceipt(receipt, project) {
  const fail = () => { throw new Error('Incomplete native clock qualification: ' + project + ' / ' + receipt?.scenario); };
  if (receipt?.schema !== 'lemmings-native-clock-qualification/v1' || receipt.project !== project || !NATIVE_CLOCK_SCENARIOS.includes(receipt.scenario) ||
      typeof receipt.browser !== 'string' || !receipt.browser || receipt.acousticReceipt !== false || !integer(receipt.viewport?.width) || receipt.viewport.width < 1920 || !integer(receipt.viewport?.height) || receipt.viewport.height < 1080) fail();
  const { scenario, actual } = receipt;
  const availability = receipt.availability;
  const observedViewport = availability?.available === false ? availability.viewport : scenario === 'listen-rearm' || scenario === 'context-replacement' ? receipt.after?.viewport : actual?.snapshot?.viewport;
  if (observedViewport?.width !== receipt.viewport.width || observedViewport?.height !== receipt.viewport.height) fail();
  if (availability?.available === false) {
    if (availability.reason !== 'native-AudioContext-absent' || availability.contextType === 'function' || availability.legacyContextType === 'function' ||
        !['undefined', 'object'].includes(availability.contextType) || !['undefined', 'object'].includes(availability.legacyContextType) || availability.contextsOpened !== 0 || availability.outputEnabled !== false ||
        receipt.onset || receipt.actual || receipt.rearm || receipt.targets) fail();
    return { scenario, availability, acousticReceipt: false };
  }
  if (availability?.available !== true) fail();
  if (scenario === 'listen-rearm' || scenario === 'context-replacement') {
    const { before, disabled, muted, after, rearm } = receipt;
    if (!before || !disabled || !muted || !after || !rearm || before.generation !== after.generation || before.bpm !== after.bpm || after.clock?.rebases <= before.clock?.rebases ||
        !integer(before.tick) || !integer(disabled.tick) || disabled.tick < before.tick || disabled.enabled !== false || !integer(disabled.starts) || disabled.starts < before.starts || muted.tick <= disabled.tick || after.tick <= muted.tick || muted.starts !== disabled.starts || before.starts < 1 ||
        after.contexts?.length !== (scenario === 'context-replacement' ? 2 : 1) || after.contexts.at(-1).sampleRate !== before.sampleRate ||
        scenario === 'context-replacement' && after.contexts[0].state !== 'closed' || !rearm.sameGeneration || !rearm.sameBpm || !rearm.sameSampleRate ||
        !integer(rearm.mutedAttacks) || rearm.mutedAttacks < 1 || !integer(rearm.admitted) || rearm.admitted < 1 || rearm.missedAttacksReplayed !== 0 ||
        rearm.sourceTargetFramesChecked < rearm.admitted || rearm.terminalActiveNotes !== 0 || !Array.isArray(actual?.intents) || !actual.intents.length || !Array.isArray(actual.outcomes) || !actual.outcomes.length) fail();
    if (!Array.isArray(actual.batches) || actual.batches.length > 4096 || actual.intents.length > 32768 || actual.outcomes.length > 32768) fail();
    const intents = new Map(actual.intents.map(intent => [intent.intentId, intent])), batches = new Map(actual.batches.map(batch => [batch.batchId, batch]));
    const starts = actual.outcomes.filter(row => row.sinkId === 'physical-browser-audio' && intents.get(row.intentId)?.kind === 'begin'), admitted = starts.filter(row => row.status === 'accepted');
    const mutedIds = new Set(starts.filter(row => { const tick = batches.get(row.batchId)?.tick; return tick > disabled.tick && tick <= muted.tick; }).map(row => row.intentId));
    if (mutedIds.size !== rearm.mutedAttacks || admitted.length !== rearm.admitted || admitted.some(row => mutedIds.has(row.intentId)) || !admitted.some(row => batches.get(row.batchId)?.tick > muted.tick)) fail();
    for (const row of admitted) {
      const anchor = batches.get(row.batchId)?.audioAnchor, intent = intents.get(row.intentId);
      if (!anchor || !Number.isFinite(intent.scoreTime?.beat) || !Number.isFinite(anchor.beat) || !Number.isFinite(anchor.bpm) || anchor.bpm <= 0 || !Number.isFinite(anchor.hostMs) || !Number.isFinite(anchor.contextSeconds) || !Number.isFinite(anchor.correlationHostMs) || !Number.isFinite(anchor.presentationDelayMs) || anchor.sampleRate !== before.sampleRate) fail();
      const host = anchor.hostMs + (intent.scoreTime.beat - anchor.beat) * 60000 / anchor.bpm, expected = Math.round((anchor.contextSeconds + (host + anchor.presentationDelayMs - anchor.correlationHostMs) / 1000) * anchor.sampleRate);
      if (!integer(expected) || row.sourceTargetFrame !== expected || row.targetFrame !== expected || row.repair !== null) fail();
    }
    return { scenario, availability, rearm, sampleRate: before.sampleRate, acousticReceipt: false };
  }
  const { snapshot } = actual || {}, nodes = snapshot?.nodes;
  if (!snapshot || snapshot.schema !== 'lemmings-native-physical-clock/v1' || snapshot.source?.actorsPosed !== false || snapshot.source.processorsOverridden !== false ||
      !Array.isArray(nodes) || nodes.length !== 8 || nodes.some(row => !integer(row.expectedFrame) || !integer(row.submittedFrame) || row.expectedFrame <= row.submittedFrame || !integer(row.observedThrough)) ||
      !Number.isFinite(snapshot.context?.sampleRate) || snapshot.context.sampleRate < 8000 || receipt.targets?.checked !== 8 || receipt.targets.producerLeadClock !== 'native-audio-worklet-quantum-start' ||
      !Array.isArray(receipt.targets.producerLeadFrames) || receipt.targets.producerLeadFrames.length !== 8 ||
      nodes.some((row, index) => !integer(row.renderFrameAtSubmission) || !integer(row.observerReadyFrame) || !Number.isFinite(row.submittedHostMs) ||
        receipt.targets.producerLeadFrames[index] !== row.expectedFrame - row.renderFrameAtSubmission || receipt.targets.producerLeadFrames[index] <= 0) ||
      !Number.isFinite(receipt.targets.presentationDelayMs) || receipt.targets.presentationDelayMs < 0 || receipt.targets.presentationDelayMs > 1000 ||
      receipt.targets.sourcePrecision !== 'committed-tick-and-endpoint-crossing' || receipt.retirement?.accountedBytes !== 0 || receipt.retirement.retired !== true) fail();
  if (scenario.startsWith('stall-')) {
    const milliseconds = Number(scenario.slice(6)), onset = receipt.onset;
    if (actual.requestedMs !== milliseconds || actual.observedMs < milliseconds || actual.renderWindowClock !== 'native-audio-worklet-shared-observer' || !integer(actual.renderStartFrame) || !integer(actual.renderEndFrame) || actual.renderEndFrame <= actual.renderStartFrame ||
        snapshot.observer?.crossOriginIsolated !== true || snapshot.observer.sharedBytes !== 16 || snapshot.observer.warmed !== true || snapshot.observer.slots !== 8 || !integer(actual.onsetsWhileBlocked) || actual.onsetsWhileBlocked < 1 ||
        nodes.some(row => !integer(row.first) || row.observedThrough < row.first) || nodes.filter(row => integer(row.firstWhileBlocked) && row.firstWhileBlocked === row.first).length !== actual.onsetsWhileBlocked) fail();
    const errors = nodes.map(row => Math.abs(row.first - row.expectedFrame)).sort((a, b) => a - b);
    if (errors.at(-1) > 129 || onset?.population !== 8 || onset.maxFrames !== errors.at(-1) || onset.p50Frames !== errors[3] || onset.p95Frames !== errors[7] || onset.p99Frames !== errors[7] ||
        onset.sampleRate !== snapshot.context.sampleRate || onset.tap !== 'native-oscillator-pre-envelope' || onset.deviceLatency !== 'unmeasured') fail();
    return { scenario, availability, onset, presentationDelayMs: receipt.targets.presentationDelayMs, producerLeadFrames: receipt.targets.producerLeadFrames, acousticReceipt: false };
  }
  if (scenario.startsWith('cancel-')) {
    const rendered = scenario === 'cancel-after-render';
    if (receipt.cancellation?.nativeSubmissionObserved !== true || receipt.cancellation.rendered !== rendered || receipt.cancellation.deviceBufferedPcm !== 'unknown' || receipt.cancellation.nodes !== 8 ||
        receipt.cancellation.frontier !== 'native-source-ended-acknowledgment' || receipt.cancellation.submissionFrontier !== 'native-stop-call-bracketed-by-shared-render-quantum' || receipt.cancellation.maximumFollowingFrames !== 128 || !Array.isArray(receipt.cancellation.stopFrontiers) ||
        !Array.isArray(snapshot.stops) || snapshot.stops.length > 1024 || !Array.isArray(snapshot.ends) || snapshot.ends.length > 512 ||
        actual.nativeEndWait?.complete !== true || actual.nativeEndWait.timeoutMs !== 2000 || !Array.isArray(actual.nativeEndWait.missingOrdinals) || actual.nativeEndWait.missingOrdinals.length ||
        !Number.isFinite(actual.nativeEndWait.elapsedMs) || actual.nativeEndWait.elapsedMs < 0 || snapshot.observer?.crossOriginIsolated !== true || snapshot.observer.warmed !== true || snapshot.observer.sharedBytes !== 16 ||
        actual.retirement?.outcome !== 'complete' ||
        !integer(actual.requestedAtFrame) || nodes.some(row => row.observedThrough < row.expectedFrame)) fail();
    for (const row of nodes) {
      const ends = snapshot.ends.filter(end => end.ordinal === row.ordinal);
      if (ends.length !== 1) fail(); const end = ends[0];
      if (end.acknowledgment !== 'native-source-ended' || end.trusted !== true || !integer(end.context) || end.context !== row.context || end.sampleRate !== snapshot.context.sampleRate ||
          !Number.isFinite(end.contextSeconds) || end.contextSeconds < 0 || !Number.isFinite(end.hostMs) || end.hostMs < row.submittedHostMs ||
          !integer(end.renderFrameAtAcknowledgment) || end.renderFrameAtAcknowledgment % 128 || end.renderFrameAtAcknowledgment > row.observedThrough) fail();
    }
    if (rendered) {
      if (nodes.some(row => !integer(row.first) || !integer(row.last) || row.last < row.first) || receipt.cancellation.stopFrontiers.length !== nodes.length || new Set(nodes.map(row => row.ordinal)).size !== nodes.length) fail();
      for (const row of nodes) {
        const stops = snapshot.stops?.filter(stop => stop.ordinal === row.ordinal) || [];
        if (!stops.length || stops.some(stop => !Number.isFinite(stop.targetSeconds) || stop.targetSeconds < 0 || !Number.isFinite(stop.submittedSeconds) || !Number.isFinite(stop.submittedHostMs) ||
            stop.sampleRate !== snapshot.context.sampleRate || !integer(stop.renderFrameBeforeStop) || !integer(stop.renderFrameAfterStop) || stop.renderFrameBeforeStop % 128 || stop.renderFrameAfterStop % 128 ||
            stop.renderFrameAfterStop < stop.renderFrameBeforeStop || stop.renderFrameAfterStop > row.observedThrough || !Number.isFinite(stop.mainSecondsAfterStop) || stop.mainSecondsAfterStop < stop.submittedSeconds)) fail();
        const end = snapshot.ends.find(value => value.ordinal === row.ordinal), frontier = Math.max(Math.round(end.contextSeconds * snapshot.context.sampleRate), end.renderFrameAtAcknowledgment), summary = receipt.cancellation.stopFrontiers.find(value => value.ordinal === row.ordinal);
        if (row.last > frontier + 128 || !summary || summary.lastRenderedFrame !== row.last || summary.frontierFrame !== frontier || summary.maximumFollowingFrames !== 128 || JSON.stringify(summary.stops) !== JSON.stringify(stops) || JSON.stringify(summary.nativeEnd) !== JSON.stringify(end) || summary.lastStopToAcknowledgmentMs !== end.hostMs - stops.at(-1).submittedHostMs) fail();
      }
    } else if (receipt.cancellation.stopFrontiers.length || actual.requestedAtFrame >= Math.min(...nodes.map(row => row.expectedFrame)) || nodes.some(row => row.first !== null || row.last !== null)) fail();
    return { scenario, availability, cancellation: receipt.cancellation, acousticReceipt: false };
  }
  if (actual.sameContext !== true || JSON.stringify(actual.before?.anchor) !== JSON.stringify(actual.after?.anchor) || !actual.before?.anchor || actual.before.rebases !== actual.after.rebases ||
      nodes.some(row => !integer(row.first))) fail();
  return { scenario, availability, independentOwner: receipt.independentOwner, acousticReceipt: false };
}
