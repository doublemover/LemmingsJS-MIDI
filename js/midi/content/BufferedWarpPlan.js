import { cloneData, freezeData, canonicalDataText, hashData } from '../../core/CanonicalData.js';

export const BUFFERED_WARP_PLAN_REVISION = 'owned-buffered-warp-frame-map-v1';
const admitted = new WeakSet();
const integer = (value, low = 0, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw Object.assign(new TypeError('Buffered warp: ' + message), { code: 'invalid-buffered-warp-plan' }); };
export const acceptsWarpRate = value => [0.75, 1, 1.5].includes(value);
export const acceptsWarpPitch = value => [0.5, 1, 2].includes(value);

// This is a source-coordinate/ownership plan, not qualification of a DSP backend.
// Prepared PCM must be copied/resampled to outputRate by the eventual owned
// adapter. The original asset's source-frame coordinates remain authoritative.
export function validateBufferedWarpPlan(raw) {
  const value = cloneData(raw, { maxBytes: 16384, maxNodes: 2048 });
  if (!value || Object.keys(value).some(key => !['schema', 'assetHash', 'sourceRate', 'sourceFrames', 'sourceFrameRegion', 'outputRate', 'rootPitch', 'rateRatio', 'pitchRatio', 'formantPolicy', 'loop', 'seekPolicy', 'algorithm'].includes(key)) || value.schema !== 'lemmings-buffered-warp-plan/v1' || !hash(value.assetHash) || !integer(value.sourceRate, 8000, 192000) || ![44100, 48000, 96000].includes(value.outputRate) || !integer(value.sourceFrames, 2, 16 * 192000) || !Array.isArray(value.sourceFrameRegion) || value.sourceFrameRegion.length !== 2 || !integer(value.sourceFrameRegion[0], 0, value.sourceFrames - 2) || (!integer(value.sourceFrameRegion[1], value.sourceFrameRegion[0] + 2, value.sourceFrames) || value.sourceFrameRegion[1] - value.sourceFrameRegion[0] > value.sourceRate * 16) || !acceptsWarpRate(value.rateRatio) || !acceptsWarpPitch(value.pitchRatio) || value.formantPolicy !== 'shift-with-pitch' || value.seekPolicy !== 'reset-and-deterministic-preroll') fail('Use an exact immutable region, named rates and the explicitly bounded starting rate/pitch matrix. Reverse, rest/freeze and independent formant control require another capability.');
  const root = value.rootPitch;
  if (!root || Object.keys(root).some(key => !['cents', 'referenceHz'].includes(key)) || !Number.isFinite(root.cents) || Math.abs(root.cents) > 24000 || !Number.isFinite(root.referenceHz) || root.referenceHz < 1 || root.referenceHz > 20000) fail('Declare the actual material root and pitch reference.');
  if (value.loop !== null && (!value.loop || Object.keys(value.loop).some(key => !['firstSourceFrame', 'endSourceFrame', 'historyPolicy'].includes(key)) || !integer(value.loop.firstSourceFrame, value.sourceFrameRegion[0], value.sourceFrameRegion[1] - 2) || !integer(value.loop.endSourceFrame, value.loop.firstSourceFrame + 2, value.sourceFrameRegion[1]) || value.loop.historyPolicy !== 'reset-and-deterministic-preroll')) fail('A loop must remain inside the selected source region and explicitly reset/preroll its spectral history.');
  const a = value.algorithm;
  if (!a || Object.keys(a).some(key => !['id', 'revision', 'artifactHashes', 'configurationHash', 'preparedRate', 'inputLatencyFrames', 'outputLatencyFrames', 'requiredPreparationLeadFrames', 'restoration', 'qualification'].includes(key)) || typeof a.id !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(a.id) || typeof a.revision !== 'string' || !a.revision.length || a.revision.length > 128 || !Array.isArray(a.artifactHashes) || !a.artifactHashes.length || a.artifactHashes.length > 8 || a.artifactHashes.some(value => !hash(value)) || new Set(a.artifactHashes).size !== a.artifactHashes.length || !hash(a.configurationHash) || a.preparedRate !== value.outputRate || !integer(a.inputLatencyFrames, 0, value.outputRate * 4) || !integer(a.outputLatencyFrames, 0, value.outputRate * 4) || !integer(a.requiredPreparationLeadFrames, a.outputLatencyFrames, value.outputRate * 8) || a.restoration !== 'deterministicPreroll' || !['unqualified', 'exact-build-matrix-qualified'].includes(a.qualification)) fail('Bind the actual complete backend artifacts, resolved configuration, preparation rate, separate latency and lead reports. A plan is not backend evidence.');
  const prepared = freezeData(value); admitted.add(prepared); return prepared;
}

export async function prepareBufferedWarpPlan(raw) {
  const plan = validateBufferedWarpPlan(raw), planHash = await hashData(plan, { maxBytes: 16384, maxNodes: 2048 });
  return freezeData({ plan, planHash, revision: BUFFERED_WARP_PLAN_REVISION, sourceMode: 'buffered-only', sourceFrameDomain: 'original-asset-rate;exclusive-region-end', outputFrameDomain: 'owned-renderer-output-rate',
    rateMeaning: 'source-seconds-per-output-second;independent-of-pitchRatio', sourceCopies: 'caller-must-own-immutable-prepared-rate-copies;never-detach-a-shared-cache', physicalTiming: 'canonical-onset-unchanged;missed-lead-is-refused', backendEvidence: 'not-established-by-plan-validation' });
}

export function warpPreparationBoundary(plan, { preparedAtOutputFrame, targetOutputFrame } = {}) {
  const value = validateBufferedWarpPlan(plan);
  if (!integer(preparedAtOutputFrame) || !integer(targetOutputFrame)) fail('Preparation and onset need named output-frame coordinates.');
  const availableLeadFrames = targetOutputFrame - preparedAtOutputFrame;
  return Object.freeze({ status: availableLeadFrames >= value.algorithm.requiredPreparationLeadFrames ? 'prepared-in-domain' : 'missed-preparation-deadline', preparedAtOutputFrame, targetOutputFrame,
    requiredPreparationLeadFrames: value.algorithm.requiredPreparationLeadFrames, availableLeadFrames, inputLatencyFrames: value.algorithm.inputLatencyFrames, outputLatencyFrames: value.algorithm.outputLatencyFrames,
    outputRate: value.outputRate, preparedRate: value.algorithm.preparedRate, deviceLatency: 'separate-output-device-report;not-algorithmic-latency', attackRetimed: false });
}

export function validateWarpSegment(raw, plan) {
  if (!admitted.has(plan)) fail('A segment requires its admitted source-coordinate plan.');
  const value = cloneData(raw, { maxBytes: 4096, maxNodes: 128 });
  if (!value || Object.keys(value).some(key => !['outputFrame', 'active', 'rateRatio', 'pitchRatio', 'sourceFrame'].includes(key)) || !integer(value.outputFrame) || typeof value.active !== 'boolean' || value.rateRatio !== undefined && !acceptsWarpRate(value.rateRatio) || value.pitchRatio !== undefined && !acceptsWarpPitch(value.pitchRatio) || value.sourceFrame !== undefined && (!Number.isFinite(value.sourceFrame) || value.sourceFrame < plan.sourceFrameRegion[0] || value.sourceFrame >= plan.sourceFrameRegion[1])) fail('A canonical warp segment needs a bounded output target, positive starting-matrix controls and an in-region explicit source seek.');
  return freezeData(value);
}

export function mapWarpSourceFrame(plan, state, outputFrame) {
  if (!admitted.has(plan) || !state || typeof state.active !== 'boolean' || !acceptsWarpRate(state.rateRatio) || !acceptsWarpPitch(state.pitchRatio) || !Number.isFinite(state.sourceFrame) || state.sourceFrame < plan.sourceFrameRegion[0] || state.sourceFrame > plan.sourceFrameRegion[1] || !integer(state.outputFrame) || !integer(state.loopIteration ?? 0)) fail('The source mapping state differs from its admitted plan.');
  if (!integer(outputFrame, state.outputFrame) || state.active && outputFrame - state.outputFrame > plan.outputRate * 3600) fail('Source mapping requires a retained segment and at most one hour between committed anchors.');
  let sourceFrame = state.sourceFrame + (state.active ? (outputFrame - state.outputFrame) * plan.sourceRate / plan.outputRate * state.rateRatio : 0), loopIteration = state.loopIteration ?? 0;
  const loop = plan.loop;
  if (state.active && loop && sourceFrame >= loop.endSourceFrame) { const span = loop.endSourceFrame - loop.firstSourceFrame, turns = Math.floor((sourceFrame - loop.firstSourceFrame) / span); sourceFrame = loop.firstSourceFrame + (sourceFrame - loop.firstSourceFrame) % span; loopIteration += turns; }
  const atEnd = sourceFrame >= plan.sourceFrameRegion[1]; sourceFrame = Math.min(plan.sourceFrameRegion[1], sourceFrame);
  return Object.freeze({ outputFrame, sourceFrame, active: state.active && !atEnd, rateRatio: state.rateRatio, pitchRatio: state.pitchRatio, loopIteration, boundary: atEnd ? 'exclusive-region-end;no-read' : 'in-region', historyPolicy: loopIteration !== (state.loopIteration ?? 0) ? 'reset-and-deterministic-preroll-at-each-loop-edge' : outputFrame === state.outputFrame ? state.historyPolicy ?? 'continuous' : 'continuous' });
}

export function warpPlanMetadataBytes(plan) { return canonicalDataText(plan, { maxBytes: 16384, maxNodes: 2048 }).bytes.length; }
