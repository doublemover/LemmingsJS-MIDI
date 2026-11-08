import { freezeData, canonicalDataText } from '../../core/CanonicalData.js';
import { sourceVoiceMatches } from '../../midi/content/EffectVoiceSelection.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code: 'effect-source-binding' }); };
export function prepareEffectSourceBindings(plan, sourceLaneIds = [], sourceVoices = []) {
  if (!Array.isArray(sourceLaneIds) || sourceLaneIds.length > 128 || new Set(sourceLaneIds).size !== sourceLaneIds.length || sourceLaneIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      !Array.isArray(sourceVoices) || sourceVoices.length > 32768 || sourceVoices.some(voice => !voice || typeof voice.voiceId !== 'string' || !voice.voiceId || voice.voiceId.length > 512 || !Number.isSafeInteger(voice.generation) || voice.generation < 0)) fail('Sidechains require exact bounded captured source identities.');
  const source = new Set(sourceLaneIds), voiceKeys = new Set(sourceVoices.map(voice => voice.generation + ':' + voice.voiceId)), laneIds = [], selections = [];
  const routes = (plan?.sidechainInputs || []).map(id => {
    const p = plan.nodes.find(node => node.id === id).parameters;
    if (p.inputLayout !== 'audioStereo') fail('Rendered source buses are stereo; use an explicit stereo-to-mono graph adapter.');
    if (p.sourceBusId === 'voices:selected') {
      const key = JSON.stringify(p.voiceSelection); let selection = selections.find(entry => entry.key === key);
      if (!selection) { selection = { key, stemId: '@voices:' + selections.length, voiceSelection: p.voiceSelection, present: p.voiceSelection.filter(voice => voiceKeys.has(voice.generation + ':' + voice.voiceId)) }; selections.push(selection); }
      return { nodeId: id, sourceBusId: p.sourceBusId, laneId: null, voiceStemId: selection.stemId, voiceSelection: p.voiceSelection, tap: p.tap, layout: p.inputLayout, available: selection.present.length > 0 };
    }
    const laneId = p.sourceBusId === 'owner' ? null : p.sourceBusId.slice(5); if (laneId !== null && !laneIds.includes(laneId)) laneIds.push(laneId);
    return { nodeId: id, sourceBusId: p.sourceBusId, laneId, tap: p.tap, layout: p.inputLayout, available: laneId === null || source.has(laneId) };
  });
  return freezeData({ schema: 'lemmings-render-effect-source-bindings/v1', sourceLaneIds: [...sourceLaneIds].sort(), laneIds: laneIds.sort(), routes,
    ...(selections.length ? { voiceSelections: selections.map(({ stemId, voiceSelection, present }) => ({ stemId, voiceSelection, present })), sourceVoiceIdentities: [...new Map(selections.flatMap(selection => selection.present).map(voice => [voice.generation + ':' + voice.voiceId, voice])).values()] } : {}),
    clock: 'same-render-source-frame-through-full-history-before-crop', faderPolicy: 'new-realization-unity-owner-fader-pre-and-post-equivalent', historicalMuteSolo: 'not-replayed;explicit-new-source-realization',
    missingPolicy: 'zero-input-release-to-authored-neutral', feedbackBoundary: 'same-owner-upstream-source-buses-only' });
}
export function validateEffectSourceBindings(plan, value) {
  const expected = prepareEffectSourceBindings(plan, value?.sourceLaneIds, value?.sourceVoiceIdentities || []);
  if (canonicalDataText(expected).text !== canonicalDataText(value).text) fail('Sidechain receipt differs from its exact prepared source inventory.'); return expected;
}
export function effectVoiceStemMask(bindings, voice, captureIds) {
  let mask = 0; const lane = captureIds.indexOf(voice.laneId); if (lane >= 0) mask |= 1 << lane;
  for (const selection of bindings?.voiceSelections || []) if (sourceVoiceMatches(selection.voiceSelection, voice.begin.voiceId, voice.begin.generation)) { const index = captureIds.indexOf(selection.stemId); if (index >= 0) mask |= 1 << index; }
  return mask;
}
export function createEffectSourceSampler(bindings, capturedLaneIds, channels) {
  if (!bindings) fail('Source sampling requires prepared bindings.');
  const needed = [...bindings.laneIds, ...(bindings.voiceSelections || []).map(selection => selection.stemId)];
  if (!bindings || !Array.isArray(capturedLaneIds) || !Array.isArray(channels) || channels.length !== capturedLaneIds.length || new Set(capturedLaneIds).size !== capturedLaneIds.length ||
      channels.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(plane => !(plane instanceof Float32Array) || !(plane.buffer instanceof ArrayBuffer)) || pair[0].length !== pair[1].length) || needed.some(id => !capturedLaneIds.includes(id))) fail('Source sampling requires every declared donor in the same render pass.');
  const pairs = bindings.routes.map(route => route.sourceBusId === 'owner' ? null : channels[capturedLaneIds.indexOf(route.voiceStemId || route.laneId)]), samples = new Float32Array(bindings.routes.length * 2), present = new Uint8Array(bindings.routes.length);
  for (let index = 0; index < present.length; index++) present[index] = bindings.routes[index].available ? 1 : 0;
  return Object.freeze({ samples, present, fill(left, right, frame) {
    for (let index = 0; index < pairs.length; index++) { const at = index * 2; samples[at] = present[index] ? pairs[index] ? pairs[index][0][frame] : left : 0; samples[at + 1] = present[index] ? pairs[index] ? pairs[index][1][frame] : right : 0; } return samples;
  } });
}
