export function nativeClockReceipt(project, scenario) {
  const nodes = Array.from({ length: 8 }, (_, ordinal) => ({ ordinal, expectedFrame: 10000, submittedFrame: 8000, renderFrameAtSubmission: 8000, observerReadyFrame: 1024, submittedHostMs: 1000,
    observedThrough: 24000, first: 10001, firstWhileBlocked: 10001, last: 11000 }));
  const anchor = { executionEpoch: 'owned:1', scoreEpoch: 'world:1', sampleRate: 48000 };
  const snapshot = { schema: 'lemmings-native-physical-clock/v1', source: { actorsPosed: false, processorsOverridden: false }, context: { sampleRate: 48000 }, nodes,
    viewport: { width: 1920, height: 1080 },
    observer: { crossOriginIsolated: true, sharedBytes: 16, warmed: true, slots: 8 },
    stops: nodes.map(row => ({ ordinal: row.ordinal, targetSeconds: 0.23, submittedSeconds: 0.2, sampleRate: 48000 })) };
  const receipt = { schema: 'lemmings-native-clock-qualification/v1', project, browser: 'validator-fixture', scenario, viewport: { width: 1920, height: 1080 }, acousticReceipt: false,
    availability: { available: true },
    targets: { checked: 8, presentationDelayMs: 160, sourcePrecision: 'committed-tick-and-endpoint-crossing', producerLeadClock: 'native-audio-worklet-quantum-start', producerLeadFrames: nodes.map(() => 2000) },
    retirement: { accountedBytes: 0, retired: true }, actual: { snapshot } };
  if (scenario.startsWith('stall-')) {
    const milliseconds = Number(scenario.slice(6)); Object.assign(receipt.actual, { requestedMs: milliseconds, observedMs: milliseconds + 1, renderStartFrame: 9700, renderEndFrame: 9700 + milliseconds * 48, onsetsWhileBlocked: 8, renderWindowClock: 'native-audio-worklet-shared-observer' });
    receipt.onset = { population: 8, p50Frames: 1, p95Frames: 1, p99Frames: 1, maxFrames: 1, sampleRate: 48000, tap: 'native-oscillator-pre-envelope', deviceLatency: 'unmeasured' };
  } else if (scenario.startsWith('cancel-')) {
    const rendered = scenario === 'cancel-after-render';
    if (!rendered) for (const row of nodes) { row.first = null; row.last = null; row.firstWhileBlocked = null; }
    receipt.cancellation = { nativeSubmissionObserved: true, rendered, nodes: 8, deviceBufferedPcm: 'unknown' };
    Object.assign(receipt.actual, { requestedAtFrame: rendered ? 12000 : 8100, retirement: { outcome: 'complete' } });
  } else if (scenario === 'independent-owner') {
    Object.assign(receipt.actual, { sameContext: true, before: { anchor, rebases: 1 }, after: { anchor, rebases: 1 } });
    receipt.independentOwner = { sameContext: true, sameAnchor: true, unchangedRebases: true };
  } else {
    receipt.before = { tick: 24, generation: 1, bpm: 120, clock: { rebases: 1 }, starts: 2, sampleRate: 48000 };
    receipt.muted = { tick: 104, starts: 2 };
    receipt.after = { tick: 164, generation: 1, bpm: 120, viewport: { width: 1920, height: 1080 }, clock: { rebases: 2 }, contexts: scenario === 'context-replacement' ? [{ sampleRate: 48000, state: 'closed' }, { sampleRate: 48000, state: 'running' }] : [{ sampleRate: 48000, state: 'running' }] };
    receipt.rearm = { sameGeneration: true, sameBpm: true, sameSampleRate: true, mutedAttacks: 2, admitted: 4, missedAttacksReplayed: 0, sourceTargetFramesChecked: 4, terminalActiveNotes: 0 };
    receipt.actual = { intents: [{ kind: 'begin' }], outcomes: [{ status: 'accepted' }] };
  }
  return receipt;
}
