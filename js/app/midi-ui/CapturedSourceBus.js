import { validateEffectVoiceSelection } from '../../midi/content/EffectVoiceSelection.js';
const fail = message => { throw Object.assign(new Error(message), { code: 'captured-source-bus' }); };
export function capturedSourceBusKey(binding) {
  if (binding?.sourceBusId === 'voices:selected') return 'voices:' + JSON.stringify(validateEffectVoiceSelection(binding.voiceSelection));
  if (typeof binding?.sourceBusId !== 'string' || !/^lane:[a-zA-Z0-9._:-]{1,96}$/.test(binding.sourceBusId)) fail('An actual donor tap omitted its bounded semantic source identity.'); return binding.sourceBusId;
}
