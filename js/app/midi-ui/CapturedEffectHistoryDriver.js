import { OWNED_STATE_BUNDLE_HEADER, writeOwnedStateBundle, readOwnedStateBundle } from './worklet/OwnedStateBundle.js';
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
  const stateIdentity = { abi: 'captured-effect-history-cut-v1', historyHash: replay.hash, sampleRate: replay.sampleRate, returnNodeIds: [...returnNodeIds] };
  const stateByteLength = () => OWNED_STATE_BUNDLE_HEADER + active.reduce((sum, arm) => sum + arm.graph.stateByteLength(), 0);
  const snapshotInto = bytes => writeOwnedStateBundle(bytes, { identity: stateIdentity,
    frontier: { cursor, frame, nextBoundary: Number.isFinite(nextBoundary) ? nextBoundary : null, leftSample, rightSample, peakGraphs, taps: Array.from(tapSamples), completed: completed.map(row => ({ ownerRouteRevision: row.ownerRouteRevision, retiredAtFrame: row.retiredAtFrame, realization: { hash: row.realization.hash, frame: row.realization.frame, muted: row.realization.muted, diagnosticScope: 'retired-graph-summary;DSP-memory-already-released' } })), active: active.map(arm => ({ entryIndex: replay.graphs.indexOf(arm.entry), driver: arm.driver.snapshot() })) },
    components: active.map(arm => { const bytes = new Uint8Array(arm.graph.stateByteLength()); arm.graph.snapshotInto(bytes); return { key: 'graph:' + replay.graphs.indexOf(arm.entry), bytes }; }) });
  const restoreFrom = async bytes => {
    if (frame !== -1 || cursor || active.length) fail('Restore history into a fresh unpublished driver.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = bytes.length >= OWNED_STATE_BUNDLE_HEADER ? view.getUint32(20, true) : -1;
    if (count < 0 || count > 2) fail('A history cut exceeds its two-graph ownership bound.');
    const headerLength = view.getUint32(12, true);
    if (headerLength < 1 || headerLength > OWNED_STATE_BUNDLE_HEADER - 64) fail('Invalid history state metadata.');
    let headerText = ''; for (let index = 64; index < 64 + headerLength; index++) headerText += String.fromCharCode(bytes[index]);
    const inventory = JSON.parse(headerText).components;
    if (!Array.isArray(inventory) || inventory.length !== count || inventory.some(row => !/^graph:(?:0|[1-9][0-9]?)$/.test(row?.key))) fail('Invalid history graph inventory.');
    const { frontier, components } = readOwnedStateBundle(bytes, stateIdentity, inventory.map(row => row.key));
    if (!Number.isSafeInteger(frontier.frame) || frontier.frame < -1 || !Number.isSafeInteger(frontier.cursor) || frontier.cursor < 0 || frontier.cursor > replay.graphs.length || !Number.isSafeInteger(frontier.peakGraphs) || frontier.peakGraphs < count || frontier.peakGraphs > 2 || !Array.isArray(frontier.active) || frontier.active.length !== count || new Set(frontier.active.map(row => row.entryIndex)).size !== count || !Array.isArray(frontier.completed) || frontier.completed.length > 32 || ![frontier.leftSample, frontier.rightSample].every(Number.isFinite) || !Array.isArray(frontier.taps) || frontier.taps.length !== tapSamples.length || frontier.taps.some(value => !Number.isFinite(value))) fail('Invalid captured graph-history frontier.');
    const staged = [];
    try {
      for (let index = 0; index < frontier.active.length; index++) {
        const entryIndex = frontier.active[index].entryIndex, entry = replay.graphs[entryIndex];
        if (!Number.isSafeInteger(entryIndex) || entryIndex < 0 || entryIndex >= frontier.cursor || !entry || components[index].key !== 'graph:' + entryIndex || Math.max(0, entry.startFrame) > frontier.frame || entry.retireFrame !== null && entry.retireFrame <= frontier.frame) fail('A retained graph differs from the captured history interval.');
        const graph = await createOwnedEffectGraphKernel({ definition: entry.definition, sampleRate: replay.sampleRate, returnNodeIds, frameOrigin: entry.replay.frameOrigin });
        staged.push({ entry, graph }); graph.restoreFrom(components[index].bytes);
        if (graph.frame !== frontier.frame - Math.max(0, entry.startFrame) + 1) fail('Retained graph and output history do not share one frame.');
        const driver = createCapturedEffectReplayDriver(entry.replay, graph, { externalLifecycle: true }); driver.restore(frontier.active[index].driver); staged[index].driver = driver;
      }
      const boundary = Math.min(frontier.cursor < replay.graphs.length ? Math.max(0, replay.graphs[frontier.cursor].startFrame) : Infinity, ...staged.map(arm => arm.entry.retireFrame ?? Infinity));
      if (boundary !== (frontier.nextBoundary ?? Infinity) || boundary <= frontier.frame || frontier.completed.some(row => !replay.graphs.some(entry => entry.ownerRouteRevision === row.ownerRouteRevision && entry.retireFrame === row.retiredAtFrame && entry.retireFrame <= frontier.frame))) fail('Restored history publication/retirement frontier differs.');
      active.push(...staged); completed.push(...frontier.completed); cursor = frontier.cursor; frame = frontier.frame; nextBoundary = boundary; leftSample = frontier.leftSample; rightSample = frontier.rightSample; peakGraphs = frontier.peakGraphs; tapSamples.set(frontier.taps);
      return Object.freeze({ status: 'restored-unpublished-graph-history', frame: frame + 1, activeGraphs: active.length, mutableState: 'independent', qualification: 'implementation-awaiting-pcm-equivalence' });
    } catch (error) { for (const arm of staged) arm.graph.panic(); throw error; }
  };
  return Object.freeze({ hash: replay.graphHash, tapSamples, advance, stateByteLength, snapshotInto, restoreFrom, get frame() { return frame + 1; }, panic() { for (const arm of active) arm.graph.panic(); }, get nextBoundary() { return nextBoundary; },
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
