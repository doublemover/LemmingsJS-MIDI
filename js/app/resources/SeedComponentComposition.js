import { inspectSeedDerivedInput, encodeSeedDerivedAudio, seedDerivedFailure } from './SoundSeedDerivedAudio.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

export const SEED_COMPONENT_COMPOSITION_REVISION = 'aligned-printed-component-branches-v1';
export const SEED_COMPONENT_KINDS = Object.freeze(['transient-like', 'sustained-like', 'residual']);
export function prepareSeedComponentComposition(raw = {}, sampleRate = 48000) {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key => !['transientGain', 'sustainedGain', 'residualGain', 'outputGain', 'solo', 'transientDrive', 'sustainedLowpassHz', 'residualHighpassHz'].includes(key))) seedDerivedFailure('Choose a bounded explicit three-component composition.');
  const p = { transientGain: 1, sustainedGain: 1, residualGain: 1, outputGain: 1, solo: 'all', transientDrive: 1, sustainedLowpassHz: 0, residualHighpassHz: 0, ...raw }, finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || ![p.transientGain, p.sustainedGain, p.residualGain].every(value => finite(value, 0, 2)) || !finite(p.outputGain, 0, 1) || !['all', ...SEED_COMPONENT_KINDS].includes(p.solo) || !finite(p.transientDrive, 1, 4) ||
      !finite(p.sustainedLowpassHz, 0, Math.min(12000, sampleRate * 0.45)) || p.sustainedLowpassHz !== 0 && p.sustainedLowpassHz < 80 || !finite(p.residualHighpassHz, 0, Math.min(6000, sampleRate * 0.45)) || p.residualHighpassHz !== 0 && p.residualHighpassHz < 20) seedDerivedFailure('Component gain, drive or filter frequency exceeds its declared source-rate domain.');
  const neutral = p.transientGain === 1 && p.sustainedGain === 1 && p.residualGain === 1 && p.outputGain === 1 && p.solo === 'all' && p.transientDrive === 1 && !p.sustainedLowpassHz && !p.residualHighpassHz;
  return freezeData({ options: p, mode: neutral ? 'neutral-recombination' : 'creative-printed-components',
    lowpassAlpha: p.sustainedLowpassHz ? 1 - Math.exp(-2 * Math.PI * p.sustainedLowpassHz / sampleRate) : 0, highpassPole: p.residualHighpassHz ? Math.exp(-2 * Math.PI * p.residualHighpassHz / sampleRate) : 0,
    driveNormalization: Math.tanh(p.transientDrive), cropPolicy: 'exact-common-frozen-window;no-implicit-tail-padding', normalization: 'none;explicit-output-gain;no-peak-limiter' });
}

export async function composeSeedComponents(input, { estimatedPeakBytes, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) seedDerivedFailure('Component composition generation changed.'); }; check();
  const source = inspectSeedDerivedInput(input, ['options', 'componentInputs']), profile = prepareSeedComponentComposition(input.options, source.sampleRate);
  if (!Array.isArray(input.componentInputs) || input.componentInputs.length !== 3 || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 64 * 1048576 + input.pcm.length * 8 || estimatedPeakBytes > 512 * 1048576) seedDerivedFailure('Composition needs all three aligned original components and admitted input/output storage.');
  const components = input.componentInputs.map(value => inspectSeedDerivedInput(value)), hashes = components.map(component => component.source.immutableSourceRef), first = components[0].origin.derivedTransform;
  if (new Set(hashes).size !== 3 || first?.algorithmRevision !== 'linked-stereo-median-masks-v1' || !/^[a-f0-9]{64}$/.test(first.recipeHash)) seedDerivedFailure('Use the three immutable outputs from one exact linked-stereo decomposition.');
  for (let index = 0; index < 3; index++) {
    const c = components[index], transform = c.origin.derivedTransform;
    if (c.frames !== source.frames || c.sampleRate !== source.sampleRate || c.generation !== source.generation || c.firstFrame !== 0 || c.endFrame !== source.frames || transform?.component !== SEED_COMPONENT_KINDS[index] || transform.algorithmRevision !== first.algorithmRevision || transform.recipeHash !== first.recipeHash ||
        transform.parentAssetHash !== source.source.immutableSourceRef || canonicalDataText(transform.regionFrames).text !== canonicalDataText([source.firstFrame, source.endFrame]).text || transform.outputDelayFrames !== 0 || canonicalDataText(transform.outputCropFrames).text !== canonicalDataText([0, source.frames]).text) seedDerivedFailure('Component parent, analysis, rate, delay or exact crop does not cover this frozen source.');
  }
  const { frames, sampleRate } = source, pcm = new Uint8Array(frames * 8), output = new DataView(pcm.buffer), filter = new Float64Array(6), p = profile.options;
  const tg = p.solo === 'all' || p.solo === 'transient-like' ? p.transientGain : 0, sg = p.solo === 'all' || p.solo === 'sustained-like' ? p.sustainedGain : 0, rg = p.solo === 'all' || p.solo === 'residual' ? p.residualGain : 0;
  let sourceSquares = 0, neutralErrorSquares = 0, neutralMaximumError = 0, creativeErrorSquares = 0, maximumCreativeDifference = 0;
  for (let begin = 0; begin < frames; begin += 8192) {
    check(); const end = Math.min(frames, begin + 8192);
    for (let frame = begin; frame < end; frame++) for (let channel = 0; channel < 2; channel++) {
      const t = components[0].sample(frame, channel), s = components[1].sample(frame, channel), r = components[2].sample(frame, channel), original = source.sample(frame, channel), neutral = Math.fround(t + s + r), difference = neutral - original;
      sourceSquares += original * original; neutralErrorSquares += difference * difference; neutralMaximumError = Math.max(neutralMaximumError, Math.abs(difference));
      const transient = p.transientDrive === 1 ? t : Math.tanh(p.transientDrive * t) / profile.driveNormalization;
      let sustained = s, residual = r;
      if (profile.lowpassAlpha) { filter[channel] += profile.lowpassAlpha * (s - filter[channel]); sustained = filter[channel]; }
      if (profile.highpassPole) { residual = r - filter[2 + channel] + profile.highpassPole * filter[4 + channel]; filter[2 + channel] = r; filter[4 + channel] = residual; }
      const value = Math.fround((tg * transient + sg * sustained + rg * residual) * p.outputGain);
      if (!Number.isFinite(value) || Math.abs(value) > 16) seedDerivedFailure('The printed composition exceeds the material peak bound; reduce explicit branch/output gains. No normalization or clipping was applied.');
      output.setFloat32(frame * 8 + channel * 4, value, true); const creativeDifference = value - original; creativeErrorSquares += creativeDifference * creativeDifference; maximumCreativeDifference = Math.max(maximumCreativeDifference, Math.abs(creativeDifference));
    }
    onProgress({ phase: 'printing-aligned-components', completedUnits: end, totalUnits: frames }); await yieldControl();
  }
  const reconstruction = freezeData({ comparedFrames: frames, channels: 2, maximumAbsoluteError: neutralMaximumError, rmsError: Math.sqrt(neutralErrorSquares / (frames * 2)), sourceRms: Math.sqrt(sourceSquares / (frames * 2)), relativeRmsError: sourceSquares ? Math.sqrt(neutralErrorSquares / sourceSquares) : 0,
    evidence: 'measured-unprocessed-neutral-sum;creative-output-is-intentionally-different;not-perceptual-isolation' });
  const recipe = freezeData({ algorithmRevision: SEED_COMPONENT_COMPOSITION_REVISION, parentAssetHash: source.source.immutableSourceRef, regionFrames: [source.firstFrame, source.endFrame], sourceRate: sampleRate,
    decompositionRecipeHash: first.recipeHash, decompositionRevision: first.algorithmRevision, componentAssetHashes: Object.fromEntries(SEED_COMPONENT_KINDS.map((kind, index) => [kind, hashes[index]])), options: p, mode: profile.mode,
    alignment: 'identical-original-frame-ruler;zero-output-delay;exact-common-crop', cropPolicy: profile.cropPolicy, normalization: profile.normalization, parentPrintedEffects: source.origin.bakedEffects,
    processing: { transient: 'drive=1:bypass;otherwise-tanh(drive*x)/tanh(drive)', sustained: 'cutoff=0:bypass;otherwise-positive-one-pole-lowpass', residual: 'cutoff=0:bypass;otherwise-x-minus-previous-x-plus-positive-pole-times-previous-output', summation: 'canonical-transient-sustained-residual-order;Float64-processing;one-Float32-output-quantization' },
    filterTail: { policy: 'cropped-at-exact-frozen-end;extend-source-selection-explicitly', terminalState: Array.from(filter), truncationPossible: profile.lowpassAlpha !== 0 || profile.highpassPole !== 0 },
    neutralReconstruction: reconstruction, creativeDifference: { maximumAbsoluteDifference: maximumCreativeDifference, rmsDifference: Math.sqrt(creativeErrorSquares / (frames * 2)) },
    layerRealization: 'printed-into-one-immutable-playable-asset;not-three-live-DSP-voices', semanticOnsetsAdded: 0, perceptualIsolationQualified: false, listeningQualified: false });
  const recipeHash = await hashData(recipe, { maxBytes: 262144, maxNodes: 32768 }); check();
  const artifact = await encodeSeedDerivedAudio(pcm, source, { ...recipe, recipeHash, component: 'component-composition' }, { check, yieldControl,
    bakedEffects: profile.mode === 'neutral-recombination' ? null : 'printed-component-composition;see-derived-transform-and-parent' }); check();
  return { value: { schema: 'lemmings-seed-component-composition/v1', generation: source.generation, recipe, recipeHash, reconstruction, components: [{ kind: 'component-composition', ...artifact }], estimate: { status: profile.mode, layerRealization: recipe.layerRealization } },
    inputBytes: input.pcm.length + input.originBytes.length + input.componentInputs.reduce((sum, value) => sum + value.pcm.length + value.originBytes.length, 0), nodes: 4096,
    retainedBytes: artifact.bytes.length + artifact.waveform.minMax.byteLength + 262144 };
}
