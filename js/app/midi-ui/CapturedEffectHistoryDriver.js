import { createOwnedEffectGraphKernel } from './OwnedEffectGraphKernel.js';
import { createCapturedEffectReplayDriver } from './CapturedEffectReplay.js';

const fail = message => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code: 'effect-history-driver-contract' }); };
const ramp = (frame, first, width) => Math.max(0, Math.min(1, (frame - first) / width));
export function createCapturedEffectHistoryDriver(replay, returnNodeIds = []) {
  if (replay?.schema !== 'lemmings-captured-effect-history/v1' || replay.graphs.length < 2 || replay.graphs.length > 32) fail('A bounded captured graph history is required.');
  const active = [], completed = [], tapSamples = new Float32Array(returnNodeIds.length * 2); let cursor = 0, frame = -1, nextBoundary = Math.max(0, replay.graphs[0].startFrame), leftSample = 0, rightSample = 0, peakGraphs = 0;
  const advance = async at => {
    if (!Number.isSafeInteger(at) || at < 0 || at < frame || at !== nextBoundary) fail('Graph publication must occur at its next source-frame boundary.');
    for (let index = active.length - 1; index >= 0; index--) if (active[index].entry.retireFrame !== null && active[index].entry.retireFrame <= at) {
      const arm = active[index]; arm.graph.assertHealthy(); completed.push({ ownerRouteRevision: arm.entry.ownerRouteRevision, retiredAtFrame: arm.entry.retireFrame, realization: arm.graph.diagnostics() }); arm.graph.panic(); active.splice(index, 1);
    }
    while (cursor < replay.graphs.length && Math.max(0, replay.graphs[cursor].startFrame) === at) {
      if (active.length >= 2) fail('The admitted two-graph capacity was exceeded.');
      const entry = replay.graphs[cursor++], graph = await createOwnedEffectGraphKernel({ definition: entry.definition, sampleRate: replay.sampleRate, returnNodeIds, frameOrigin: entry.replay.frameOrigin });
      if (graph.hash !== entry.graphHash) fail('A prepared graph differs from its captured history.');
      active.push({ entry, graph, driver: createCapturedEffectReplayDriver(entry.replay, graph, { externalLifecycle: true }) }); peakGraphs = Math.max(peakGraphs, active.length);
    }
    nextBoundary = Math.min(cursor < replay.graphs.length ? Math.max(0, replay.graphs[cursor].startFrame) : Infinity, ...active.map(arm => arm.entry.retireFrame ?? Infinity));
  };
  return Object.freeze({ hash: replay.graphHash, tapSamples, advance, get nextBoundary() { return nextBoundary; },
    sample(left, right, at) {
      if (at !== frame + 1 || at >= nextBoundary) fail('A graph boundary was not prepared before sampling its exact source frame.'); frame = at;
      const first = replay.graphs[0], dry = 1 - ramp(at, first.startFrame, first.transitionFrames); leftSample = left * dry; rightSample = right * dry; tapSamples.fill(0);
      for (const { entry, graph, driver } of active) {
        const input = entry.detachFrame === null || at < entry.detachFrame ? ramp(at, entry.startFrame, entry.transitionFrames) : ramp(entry.detachFrame, entry.startFrame, entry.transitionFrames) * (1 - ramp(at, entry.detachFrame, entry.detachTransitionFrames));
        driver.sample(left * input, right * input, at); leftSample += driver.leftSample; rightSample += driver.rightSample;
        for (let index = 0; index < tapSamples.length; index++) tapSamples[index] += graph.tapSamples[index];
      }
    }, get leftSample() { return leftSample; }, get rightSample() { return rightSample; },
    assertHealthy() { for (const arm of active) arm.graph.assertHealthy(); },
    diagnostics: () => ({ schema: 'lemmings-captured-effect-history-realization/v1', graphHistoryHash: replay.hash, peakGraphs, maximumConcurrentGraphs: 2, completed, active: active.map(arm => ({ ownerRouteRevision: arm.entry.ownerRouteRevision, realization: arm.graph.diagnostics() })), sourceRealizations: 1, exactLiveDspState: false }) });
}
