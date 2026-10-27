import { createSoundSeedRecipe } from './SoundSeedRecipe.js';
import { prepareFeedforwardGraftDescriptor, prepareObservedMotionGraftDescriptor, FEEDFORWARD_GRAFT_REVISION, MOTION_GRAFT_REVISION } from './InstrumentGraft.js';
import { validateSampleTraversalBinding } from './SampleTraversal.js';
import { canonicalDataText, freezeData, hashData, hashDataText } from '../../core/CanonicalData.js';

export const SOUND_SEED_GRAFT_BODIES = freezeData({
  glass: { name: 'Original light glass shell', revision: 'original-light-glass-shell-v1', ratios: [1, 2.32, 4.25, 6.63, 9.38, 12.22], t60: [1.8, 1.3, 0.9, 0.6, 0.4, 0.25], gains: [1, 0.5, 0.35, 0.24, 0.17, 0.12] },
  tin: { name: 'Original tin modal body', revision: 'original-tin-body-v1', ratios: [1, 1.43, 2.17, 2.91, 4.07, 5.33], t60: [0.8, 0.65, 0.5, 0.4, 0.3, 0.2], gains: [1, 0.7, 0.5, 0.35, 0.25, 0.18] },
  wood: { name: 'Original dry wood modal body', revision: 'original-dry-wood-body-v1', ratios: [1, 2.76, 5.4, 8.93], t60: [0.25, 0.17, 0.1, 0.06], gains: [1, 0.6, 0.35, 0.2] }
});
const macro = (id, name, parameter, minimum, maximum, unit, default01) => ({ id, name, mode: 'onset-only', default01, smoothingMs: 0,
  perceptualDirection: name + ' follows the displayed feed-forward template equation for new voices; old bodies retain their onset state.', targets: [{ parameter, minimum: { value: minimum, unit }, maximum: { value: maximum, unit }, curve: 'linear', composition: 'replace', clamp: true }] });

export async function createSoundSeedGraftRecipe({ manifest, assetHash, byteLength, pitch, graftBody = 'tin', modalFit = null, transform = 'feedforward-graft', traversalBinding = null } = {}) {
  const fail = message => { throw new TypeError('Seed graft: ' + message); };
  if (!['feedforward-graft', 'motion-body-graft'].includes(transform)) fail('Choose an explicit finite or canonical-motion body template.');
  const motion = transform === 'motion-body-graft', traversal = motion ? validateSampleTraversalBinding(traversalBinding) : null;
  if (pitch?.mode !== 'pitched' || !Number.isFinite(pitch.rootCents) || pitch.rootCents < 2400 || pitch.rootCents > 9600) fail('Declare the body reference pitch independently of the fixed-rate exciter.');
  const base = await createSoundSeedRecipe({ manifest, assetHash, byteLength, pitch: { mode: 'unpitched' }, transform: motion ? 'route-relic' : 'hammer-seed' }), rootHz = 440 * 2 ** ((pitch.rootCents - 6900) / 1200);
  let body;
  if (graftBody === 'fitted') {
    const modes = modalFit?.estimate?.modes;
    if (!Array.isArray(modes) || !modes.length || modes.length > 8 || modes.some(mode => !Number.isFinite(mode.frequencyHz) || !Number.isFinite(mode.t60Seconds) || mode.t60Seconds < 0.03 || mode.t60Seconds > 2.5 || !Number.isFinite(mode.amplitude) || mode.amplitude < 0)) fail('Fit/select a supported 1–8 mode body before grafting.');
    body = { name: 'Selected fitted modal body', revision: modalFit.recipe.algorithmRevision, ratios: modes.map(mode => mode.frequencyHz / rootHz), t60: modes.map(mode => mode.t60Seconds), gains: modes.map(mode => mode.amplitude),
      analysis: { parentAssetHash: modalFit.parentAssetHash, recipe: modalFit.recipe, estimate: modalFit.estimate } };
  } else body = SOUND_SEED_GRAFT_BODIES[graftBody];
  if (!body || body.gains.reduce((sum, gain) => sum + Math.abs(gain), 0) < 1e-10 || body.ratios.some(ratio => ratio < 0.125 || ratio > 16)) fail('The chosen body/reference exceeds this renderer’s declared frequency ratios.');
  const rawEnergy = manifest.statistics?.rms ** 2 * manifest.frames * 2;
  if (!motion && (!Number.isFinite(rawEnergy) || rawEnergy < 0 || rawEnergy * 0.04 > 1000000)) fail('The frozen source lacks a supported copied-PCM energy measurement.');
  const excitationCalibration = motion ? { reference: 'owned-sample-reader-peak-normalization-v1', inputPeakBound: 1, dcPeakGainBound: 2, stereoModalStateL2Bound: 1,
    support: 'observed-cursor-motion-only;no-free-running-source', overflowPolicy: 'peak-bound-violation-stops-body-input;tail-retained', acousticCalibration: 'not-qualified' } : { energyBudget: Math.max(1e-9, rawEnergy * 0.04), supportSeconds: 0.25, reference: 'copied-seed-rms-with-explicit-runtime-energy-cap-v1',
    rawMeasuredEnergy: rawEnergy, normalizedEstimateScale: 0.04, overflowPolicy: 'final-injection-energy-cap-then-no-more-drive;diagnostic-retains-actual-overflow', edge: 'last-five-ms-linear-drive-fade', acousticCalibration: 'not-qualified' };
  const bodyHash = await hashData(body), observation = { revision: 'signed-authored-observation-ab-v1', gainsA: body.gains, gainsB: body.gains.map((gain, index) => index % 2 ? -gain : gain * 0.7), normalization: 'divide-max(1,max-reference-gain)-then-max(1,per-mode-maximum-L1)', meaning: 'authored-signed-mode-weights;not-spatial-geometry' }, observationHash = await hashData(observation);
  const graft = (motion ? prepareObservedMotionGraftDescriptor : prepareFeedforwardGraftDescriptor)({ exciterRef: { port: motion ? 'observed-motion-stereo-audio-excitation' : 'finite-stereo-audio-excitation', assetHash, revision: motion ? 'frozen-seed-observed-cursor-v1' : 'frozen-seed-fixed-rate-v1' },
    bodyRef: { port: 'linear-modal-audio-input', contentHash: bodyHash, revision: body.revision, modeCount: body.ratios.length, name: body.name },
    observationRef: { port: 'signed-modal-audio-observation', contentHash: observationHash, revision: observation.revision }, excitationCalibration, ...(motion ? { traversalBinding: traversal } : {}) });
  const contract = freezeData({ ...base.contract, transform, pitchDeclaration: { mode: 'declared-body-root', rootCents: pitch.rootCents }, exciterPitch: motion ? 'observed-varispeed-derivative;declared-root-belongs-to-body' : 'fixed-source-rate;no-fictional-sample-root',
    ...(motion ? { traversalBinding: traversal, loop: 'observed-coordinate-reflection;no-free-running-loop' } : {}),
    graft, body, observation, warnings: [...base.contract.warnings, 'A new audio exciter feeds the body’s private modal state. Original baked attacks remain ancestry. Calibration and timbre require listening qualification.'] });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), source = structuredClone(base.source), recipe = source.recipes[0], id = (motion ? 'seed.motion-graft.' : 'seed.graft.') + contractHash.slice(0, 24);
  source.pack.id = id; source.pack.name = (motion ? 'Travel seed → ' : 'Seed → ') + body.name; recipe.id = id; recipe.name = source.pack.name; recipe.dependencies = [assetHash, contractHash]; recipe.tags = ['sound-seed', transform, 'actor-owned-body', motion ? 'observed-motion-exciter' : 'fixed-exciter'];
  recipe.sampleMap.mapId = id + '.map';
  if (motion) for (const zone of recipe.sampleMap.zones) { zone.playbackMode = 'positionDriven'; zone.positionPolicy = { boundary: 'reflect', interpolation: 'linear', slewSeconds: 0.01, maximumReadDerivative: 4, crossfadeFrames: 0, gainLaw: 'linear', traversal }; }
  const parameters = { graftModeCount: { value: body.ratios.length, unit: 'count' }, graftExcitationMode: { value: motion ? 1 : 0, unit: 'enum' }, ...(!motion ? { graftEnergyBudget: { value: excitationCalibration.energyBudget, unit: 'dimensionless' }, graftSupportSeconds: { value: 0.25, unit: 's' } } : {}),
    graftMix01: { value: 0.7, unit: 'normalized' }, graftT60Seconds: { value: Math.max(...body.t60), unit: 's' }, graftDamping01: { value: 0, unit: 'normalized' }, graftExcite01: { value: 1, unit: 'normalized' }, graftPickup01: { value: 0.5, unit: 'normalized' } };
  const maximumGain = Math.max(1, ...body.gains), longest = Math.max(...body.t60);
  for (let index = 0; index < body.ratios.length; index++) {
    parameters['graftMode' + index + 'Ratio'] = { value: body.ratios[index], unit: 'ratio' }; parameters['graftMode' + index + 'T60Scale'] = { value: body.t60[index] / longest, unit: 'ratio' };
    parameters['graftMode' + index + 'PickupA'] = { value: observation.gainsA[index] / maximumGain, unit: 'dimensionless' }; parameters['graftMode' + index + 'PickupB'] = { value: observation.gainsB[index] / maximumGain, unit: 'dimensionless' };
  }
  const exciterParameters = ['graftExcitationMode', 'graftEnergyBudget', 'graftSupportSeconds', 'graftExcite01'], resonator = { id: 'resonator', role: 'resonator', parameters: Object.fromEntries(Object.entries(parameters).filter(([id]) => !exciterParameters.includes(id))) };
  recipe.components.push(resonator); const exciter = recipe.components.find(component => component.id === 'exciter');
  for (const id of exciterParameters) if (parameters[id]) exciter.parameters[id] = parameters[id];
  recipe.macros = [macro('excite', 'EXCITE', 'graftExcite01', 0, 1, 'normalized', 0.8), macro('body', 'BODY', 'graftT60Seconds', Math.max(0.02, longest * 0.4), longest, 's', 1),
    macro('damp', 'DAMP', 'graftDamping01', 0, 0.8, 'normalized', 0), macro('mix', 'MIX', 'graftMix01', 0, 1, 'normalized', 0.7)];
  const invariantIds = ['one-source-private-body', 'exact-source-and-body-pins', motion ? 'observed-motion-gates-excitation' : 'finite-calibrated-excitation', 'independent-positive-decay-tail'];
  source.realizationGroups = [{ schema: 'lemmings-authored-sound-realizations/v1', id: id + '.realization', defaultProfileId: 'prepared', requiredInvariants: invariantIds,
    profiles: [{ id: 'prepared', recipeId: id, algorithmRevision: motion ? MOTION_GRAFT_REVISION : FEEDFORWARD_GRAFT_REVISION, preservedInvariants: invariantIds, changedAudibleProperties: [], fallbackProfileId: null }], transitions: [],
    singleProfileLimit: 'This exact exciter/body pair has one prepared realization. Both components and old tails must be admitted; a cheaper or smooth dual-body alternative has no qualified transition.' }];
  source.files[1].sha256 = contractHash; source.files[1].bytes = encoded.bytes.length;
  return freezeData({ source, contract, contractHash, contractText: encoded.text, templateRevision: motion ? MOTION_GRAFT_REVISION : FEEDFORWARD_GRAFT_REVISION });
}
