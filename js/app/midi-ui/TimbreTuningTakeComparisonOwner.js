import { createTakeReadoutComparisonOwner } from './TakeReadoutComparisonOwner.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { compileTimbreTuningSet } from '../../midi/content/TimbreTuningCompiler.js';
import { querySoundOnlyRevoiceOwned } from '../procgen/workstation/CausalTake.js';
import { retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { planPatchComparisonGroupLevels } from '../../midi/content/PatchComparisonLevels.js';
import { hashData } from '../../core/CanonicalData.js';

export function createTimbreTuningTakeComparisonOwner({ journal, resourceBudget, jobs, getCatalog = getNativeInstrumentCatalog, ...options } = {}) {
  return createTakeReadoutComparisonOwner({ ...options, journal, resourceBudget, jobs, getCatalog, name: 'Paired spectrum/tuning comparison', code: 'timbre-tuning-comparison-unavailable', schema: 'lemmings-timbre-tuning-take-comparison/v1',
    async buildPlan(request, { signal, check, ownerId, retainUnknown }) {
      if (request.tail?.mode !== 'exact-crop') throw new Error('Choose one exact source window including the desired decay for both paired readouts.');
      const catalog = await getCatalog(); check(); const descriptor = catalog.descriptors?.find(engine => engine.engineId === 'worklet-spectrum');
      if (catalog.state !== 'bound-application-engines' || !descriptor) throw new Error('The paired comparison requires the pinned owned sparse-spectrum renderer.');
      const a = await compileTimbreTuningSet(request.sourceSet, { descriptor, sampleRate: request.sampleRate, signal }), b = await compileTimbreTuningSet(request.targetSet, { descriptor, sampleRate: request.sampleRate, signal }); check();
      const loan = await querySoundOnlyRevoiceOwned({ journal, resourceBudget, jobs, takeId: request.takeId, takeRevision: request.takeRevision,
        soundPatch: { id: a.reference.patchId, revision: a.reference.revision, definitionHash: a.reference.definitionHash, engineRequirement: a.renderer }, executionEpoch: ownerId + ':paired-onset-proof', limit: 8192, maxIntents: 32768, maxBytes: 4 * 1048576, signal });
      try {
        check(); const source = loan.value;
        if (source.nextSequence != null || source.coverage.status !== 'known-covered') throw new Error('The paired comparison requires the complete covered source intent history.');
        const limits = { maxBytes: 8 * 1048576, maxNodes: 1000000 }, sourceIntentHash = await hashData(source.intents, limits),
          onsetIdentityHash = await hashData(source.intents.map(({ pitch: _pitch, ...unchanged }) => unchanged), limits);
        return { sourceCanonicalHash: source.sourceCanonicalHash, sourceIntentHash, onsetIdentityHash,
          variants: [a, b].map((compiled, index) => ({ id: index ? 'paired-B' : 'paired-A', label: (index ? 'B proposed · ' : 'A original · ') + compiled.set.name + ' · matched PRELISTEN, raw WAV',
            definitionHash: compiled.reference.definitionHash, engineRequirement: compiled.renderer, setHash: compiled.setHash, spectrumHash: compiled.set.spectrumRef.hash, tuningHash: compiled.set.tuningRef.hash, sourceReference: { setHash: compiled.setHash, periodRatio: compiled.set.periodRatio, referenceHz: compiled.set.referenceHz },
            input: { definition: compiled.reference.definition, materialReference: compiled.reference, timbreTuningReadout: { sourceSet: a.set, targetSet: compiled.set }, tail: { mode: 'exact-crop' } } })) };
      } finally { try { retireCausalRead(loan); } catch (error) { retainUnknown({ error, loan }); throw error; } }
    },
    verifyReadout(result, variant, plan) {
      const manifest = result.bundle.manifest, receipt = manifest.timbreTuningReadout;
      if (manifest.sourceCanonicalHash !== plan.sourceCanonicalHash || receipt?.onsetIdentityHash !== plan.onsetIdentityHash || receipt?.sourceIntentHash !== plan.sourceIntentHash || receipt?.targetSetHash !== variant.setHash || receipt?.targetTuningHash !== variant.tuningHash || receipt?.targetSpectrumHash !== variant.spectrumHash || manifest.intentHash !== receipt.readoutIntentHash || manifest.tail.mode !== 'exact-crop') throw new Error('A paired readout changed source event order/timing, the exact pair or the common source crop.');
    },
    describeComparison({ plan, files }) {
      return { sourceIntentHash: plan.sourceIntentHash, onsetIdentityHash: plan.onsetIdentityHash, pairedSets: plan.variants.map(variant => variant.sourceReference),
        physicalEvidence: 'one-identical-archived-take-canonical-hash;no-world-stepping-or-actor-regeneration', pitchPolicy: 'exact-captured-degree-readout;onset-only;all-other-intent-fields-unchanged',
        calibration: planPatchComparisonGroupLevels(files.map(file => file.manifest)), level: 'same-window-PCM-RMS-matched-PRELISTEN;attenuation-only;raw-WAV-gain-unchanged',
        modelEvidence: 'independent-of-roughness-model;actual-rendered-file-levels-only', measuredSimilarity: null, perceptualQuality: null };
    }
  });
}
