import { effectGraphHash, prepareEffectGraphRevision } from '../../js/midi/content/EffectGraphRevision.js';

export async function capturedEffectHistoryFixture({ frames = [2000, 12000, 24000], gains = [0.2, 0.6, 0.9] } = {}) {
  const definitions = gains.map((gain01, index) => ({ schema: 'lemmings-effect-graph/v1', id: 'test.captured-history-' + index, revision: 1, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 0,
    nodes: [{ id: 'source', kind: 'bus-in', parameters: {} }, { id: 'return', kind: 'gain', parameters: { gain01, gainMaximum01: 1 } }, { id: 'output', kind: 'bus-out', parameters: {} }],
    edges: [{ from: { nodeId: 'source', port: 'audio' }, to: { nodeId: 'return', port: 'audio' }, gain01: 1 }, { from: { nodeId: 'return', port: 'audio' }, to: { nodeId: 'output', port: 'audio' }, gain01: 1 }] }));
  const hashes = await Promise.all(definitions.map(definition => effectGraphHash(prepareEffectGraphRevision(definition))));
  const intents = [['begin', 100], ['end', 800]].map(([kind, sourceTimeMs], index) => ({ version: 1, kind, worldId: 'world:unit-history', generation: 1, actorId: 1, batchId: 'batch:' + index, voiceId: 'held', onsetId: 'held', intentId: 'intent:' + kind,
    laneId: 0, sourceEventIds: ['cause:' + kind], pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.5, expression: {}, scoreTime: { sourceTimeMs, simTick: index, subTick: 0, precision: 'tick' } }));
  const effectEvents = definitions.map((definition, index) => ({ schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', operation: 'graph', sequence: index + 1,
    streamId: 'unit:history', ownerRouteRevision: index + 1, graphDefinitionHash: hashes[index], sampleRate: 48000, targetFrame: frames[index], executionEpoch: 'unit:execution',
    clockAnchor: { intentId: 'intent:begin', sourceTargetFrame: 4800, executionEpoch: 'unit:execution' }, definition, sourceEventIds: [], acousticReceipt: false,
    routeTransition: { schema: 'lemmings-effect-route-transition/v1', startFrame: frames[index], transitionFrames: 960,
      previous: index ? { ownerRouteRevision: index, graphDefinitionHash: hashes[index - 1], retireAtFrame: frames[index] + 960, lastBodyDriveFrame: 0 } : null } }));
  return { version: 1, operation: 'sound-only-revoice', takeId: 'take:unit-history', takeRevision: 1, sourceState: 'finalized', sourceCanonicalHash: 'a'.repeat(64), nextSequence: null,
    coverage: { status: 'known-covered' }, effectCoverage: { captured: true, gaps: [] }, boundary: { status: 'captured-initial-state', state: { sourceTimeMs: 0, voices: [] } },
    finalBoundaryState: { sourceTimeMs: 1000, voices: [] }, intents, effectEvents };
}
