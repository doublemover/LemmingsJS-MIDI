import { validateEffectVoiceSelection } from '../../midi/content/EffectVoiceSelection.js';
const fail = message => { throw Object.assign(new Error(message), { code: 'captured-source-bus' }); };
export function capturedSourceBusKey(binding) {
  if (binding?.sourceBusId === 'voices:selected') return 'voices:' + JSON.stringify(validateEffectVoiceSelection(binding.voiceSelection));
  if (typeof binding?.sourceBusId !== 'string' || !/^lane:[a-zA-Z0-9._:-]{1,96}$/.test(binding.sourceBusId)) fail('An actual donor tap omitted its bounded semantic source identity.'); return binding.sourceBusId;
}

export function capturedEffectSourceRoutes(plan) {
  return plan.sidechainInputs.map(nodeId => {
    const parameters = plan.nodes.find(node => node.id === nodeId).parameters;
    if (parameters.inputLayout !== 'audioStereo') fail('Captured source continuation requires the exact prepared stereo bus and an explicit graph channel adapter.');
    return { nodeId, sourceBusId: parameters.sourceBusId, key: parameters.sourceBusId === 'owner' ? null : capturedSourceBusKey(parameters), tap: parameters.tap, layout: parameters.inputLayout };
  });
}
