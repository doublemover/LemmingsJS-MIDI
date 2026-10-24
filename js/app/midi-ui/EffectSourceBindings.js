import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';

const fail = message => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code: 'effect-source-binding' }); };
export function prepareEffectSourceBindings(plan, sourceLaneIds = []) {
  if (!Array.isArray(sourceLaneIds) || sourceLaneIds.length > 128 || new Set(sourceLaneIds).size !== sourceLaneIds.length || sourceLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128)) fail('Sidechains require the exact bounded captured source lane inventory.');
  const source = new Set(sourceLaneIds), laneIds = [];
  const routes = (plan?.sidechainInputs || []).map(id => {
    const node = plan.nodes.find(node => node.id === id), p = node.parameters, laneId = p.sourceBusId === 'owner' ? null : p.sourceBusId.slice(5);
    if (p.inputLayout !== 'audioStereo') fail('Rendered owner/lane buses are stereo; use an explicit stereo-to-mono graph adapter for a mono donor.');
    if (laneId !== null && !laneIds.includes(laneId)) laneIds.push(laneId);
    return { nodeId: id, sourceBusId: p.sourceBusId, laneId, tap: p.tap, layout: p.inputLayout, available: laneId === null || source.has(laneId) };
  });
  return freezeData({ schema: 'lemmings-render-effect-source-bindings/v1', sourceLaneIds: [...sourceLaneIds].sort(), laneIds: laneIds.sort(), routes,
    clock: 'same-render-source-frame-through-full-history-before-crop', faderPolicy: 'new-realization-unity-owner-fader-pre-and-post-equivalent',
    historicalMuteSolo: 'not-replayed;explicit-new-source-realization', missingPolicy: 'zero-input-release-to-authored-neutral', feedbackBoundary: 'same-owner-upstream-source-buses-only' });
}
export function validateEffectSourceBindings(plan, value) {
  const expected = prepareEffectSourceBindings(plan, value?.sourceLaneIds);
  if (canonicalDataText(expected).text !== canonicalDataText(value).text) fail('Sidechain receipt differs from the exact prepared source bus, tap or lane inventory.');
  return expected;
}
export function createEffectSourceSampler(bindings, capturedLaneIds, channels) {
  if (!bindings || !Array.isArray(capturedLaneIds) || !Array.isArray(channels) || channels.length !== capturedLaneIds.length || new Set(capturedLaneIds).size !== capturedLaneIds.length ||
      channels.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer)) || pair[0].length !== pair[1].length) ||
      bindings.laneIds.some(id => !capturedLaneIds.includes(id))) fail('Source sampling requires every declared donor lane in the same render pass.');
  const pairs = bindings.routes.map(route => route.laneId === null ? null : channels[capturedLaneIds.indexOf(route.laneId)]), samples = new Float32Array(bindings.routes.length * 2), present = new Uint8Array(bindings.routes.length);
  for (let i = 0; i < present.length; i++) present[i] = bindings.routes[i].available ? 1 : 0;
  return Object.freeze({ samples, present, fill(left, right, frame) {
    for (let i = 0; i < pairs.length; i++) { const at = i * 2; samples[at] = present[i] ? pairs[i] ? pairs[i][0][frame] : left : 0; samples[at + 1] = present[i] ? pairs[i] ? pairs[i][1][frame] : right : 0; }
    return samples;
  } });
}
