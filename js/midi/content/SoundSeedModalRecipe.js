import { createSoundSeedRecipe } from './SoundSeedRecipe.js';
import { canonicalDataText, freezeData, hashDataText } from '../../core/CanonicalData.js';

export async function createSoundSeedModalRecipe({ manifest, assetHash, byteLength, pitch, modalFit } = {}) {
  const fail = message => { throw new TypeError('Modal seed recipe: ' + message); };
  if (pitch?.mode !== 'pitched' || modalFit?.parentAssetHash !== assetHash || modalFit.recipe?.parentAssetHash !== assetHash ||
      modalFit.estimate?.schema !== 'lemmings-modal-estimate/v1' || !Array.isArray(modalFit.estimate.modes) || !modalFit.estimate.modes.length || modalFit.estimate.modes.length > 8) fail('Fit this exact frozen seed and declare a root before compiling the new body.');
  const base = await createSoundSeedRecipe({ manifest, assetHash, byteLength, pitch, transform: 'hammer-seed' }), rootHz = 440 * 2 ** ((pitch.rootCents - 6900) / 1200), modes = modalFit.estimate.modes;
  if (modes.some(mode => !Number.isFinite(mode.frequencyHz) || mode.frequencyHz / rootHz < 0.125 || mode.frequencyHz / rootHz > 16 || !Number.isFinite(mode.t60Seconds) || mode.t60Seconds < 0.03 || mode.t60Seconds > 2.5 || !Number.isFinite(mode.amplitude) || mode.amplitude < 0 || mode.amplitude > 32))
    fail('Selected modes exceed this native body’s 0.125–16 frequency ratios or 0.03–2.5 s amplitude T60. Edit/select modes explicitly; no hidden decay or frequency clamping is applied.');
  const longestT60 = Math.max(...modes.map(mode => mode.t60Seconds)), amplitudeSum = modes.reduce((sum, mode) => sum + mode.amplitude, 0);
  if (!(amplitudeSum > 1e-10)) fail('Selected modes have no usable fitted amplitude.');
  const contract = freezeData({ ...base.contract, transform: 'modal-body', modalFit: { recipe: modalFit.recipe, estimate: modalFit.estimate },
    playbackMeaning: 'new-excitation-damped-sine-approximation;original-stereo-phases-remain-in-analysis-only', calibrationHz: rootHz, normalization: 'fixed-selected-mode-L1',
    warnings: [...base.contract.warnings, 'This playable approximation uses new sine-bank excitation. It does not reproduce original phase, stereo pickup geometry or the true material.'] });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), id = 'seed.modal.' + contractHash.slice(0, 24), source = structuredClone(base.source), recipe = source.recipes[0];
  source.pack.id = id; source.pack.name = 'Found body · fitted approximation'; recipe.id = id; recipe.name = source.pack.name; recipe.engine.id = 'native-modal'; recipe.sampleRefs = []; delete recipe.sampleMap;
  recipe.tags = ['sound-seed', 'modal-body', 'fitted-approximation', 'new-excitation']; recipe.dependencies = [assetHash, contractHash]; recipe.voicePolicy.maxVoices = 8;
  const parameters = { modeCount: { value: Math.max(4, modes.length), unit: 'enum' }, bodyT60Seconds: { value: longestT60, unit: 's' }, bodySizeRatio: { value: 1, unit: 'ratio' } };
  for (let index = 0; index < 8; index++) {
    const mode = modes[index], gain = mode ? mode.amplitude / amplitudeSum : 0;
    parameters['mode' + index + 'Ratio'] = { value: mode ? mode.frequencyHz / rootHz : 1, unit: 'ratio' };
    parameters['mode' + index + 'T60Scale'] = { value: mode ? mode.t60Seconds / longestT60 : 1, unit: 'ratio' };
    parameters['mode' + index + 'GainA'] = parameters['mode' + index + 'GainB'] = { value: gain, unit: 'amplitude-linear' };
  }
  recipe.components = [{ id: 'exciter', role: 'exciter', parameters: { strikePosition01: { value: 0.5, unit: 'normalized' }, maxBendCents: { value: 0, unit: 'cents' } } },
    { id: 'resonator', role: 'resonator', parameters }, { id: 'envelope', role: 'envelope', parameters: { attackSeconds: { value: 0.002, unit: 's' }, decaySeconds: { value: 0, unit: 's' }, sustain01: { value: 1, unit: 'ratio' }, releaseSeconds: { value: 0.04, unit: 's' } } },
    { id: 'output', role: 'output', parameters: { gain01: { value: 0.4, unit: 'amplitude-linear' }, pan01: { value: 0, unit: 'normalized' } } }];
  recipe.macros = []; source.files[1].sha256 = contractHash; source.files[1].bytes = encoded.bytes.length;
  return freezeData({ source, contract, contractHash, contractText: encoded.text });
}
