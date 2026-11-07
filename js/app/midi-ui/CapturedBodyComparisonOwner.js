import { createTakeReadoutComparisonOwner } from './TakeReadoutComparisonOwner.js';
import { CAUSAL_RENDER_SINE } from './CausalTakeAudioRender.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { querySoundOnlyRevoiceOwned } from '../procgen/workstation/CausalTake.js';
import { retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { validateEffectPerformance } from '../../midi/content/EffectPerformance.js';
import { prepareEffectGraphRevision, effectGraphHash } from '../../midi/content/EffectGraphRevision.js';
import { planPatchComparisonGroupLevels } from '../../midi/content/PatchComparisonLevels.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error('Body comparison: ' + message), { code: 'body-comparison-unavailable' });
export function createCapturedBodyComparisonOwner({ journal, resourceBudget, jobs, getCatalog = getNativeInstrumentCatalog, ...options } = {}) {
  return createTakeReadoutComparisonOwner({ ...options, journal, resourceBudget, jobs, getCatalog, name: 'Body comparison', code: 'body-comparison-unavailable', schema: 'lemmings-captured-body-comparison/v1',
    async buildPlan(request, { signal, check, ownerId, retainUnknown }) {
      if (request.tail && (request.tail.mode !== 'exact-crop' || Object.keys(request.tail).some(key => key !== 'mode'))) throw fail('Choose one exact comparison window including the body decay. Different natural tail lengths are not the same crop.');
      const catalog = await getCatalog(); check(); const descriptor = catalog.descriptors?.find(entry => entry.engineId === 'worklet-sine');
      if (catalog.state !== 'bound-application-engines' || !descriptor || !/^[a-f0-9]{64}$/.test(descriptor.artifactHash)) throw fail('Prepare from the installed immutable owned-source renderer.');
      const engineRequirement = Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, descriptor[key]])), definitionHash = await hashData(CAUSAL_RENDER_SINE);
      const loan = await querySoundOnlyRevoiceOwned({ journal, resourceBudget, jobs, takeId: request.takeId, takeRevision: request.takeRevision, includeEffects: true,
        soundPatch: { id: CAUSAL_RENDER_SINE.id, revision: CAUSAL_RENDER_SINE.revision, definitionHash, engineRequirement }, executionEpoch: ownerId + ':body-selection', limit: 8192, maxIntents: 32768, maxBytes: 2 * 1048576, signal });
      try {
        check(); const source = loan.value;
        if (source.nextSequence != null || !source.effectCoverage?.captured || source.effectCoverage.gaps?.length || !Array.isArray(source.effectEvents)) throw fail('The take needs a complete bounded graph publication history.');
        const publications = source.effectEvents.filter(packet => packet.operation === 'graph').map(validateEffectPerformance);
        if (publications.length < 2 || publications.length > 4) throw fail('Compare takes containing two to four recorded body revisions.');
        const seen = new Set(), variants = [];
        for (const packet of publications) {
          check();
          const identity = packet.streamId + ':' + packet.ownerRouteRevision;
          if (seen.has(identity) || packet.streamId !== publications[0].streamId || variants.length && packet.ownerRouteRevision <= variants.at(-1).sourceReference.ownerRouteRevision) throw fail('Published body routes are duplicated, unordered or from different owners.'); seen.add(identity);
          const native = prepareEffectGraphRevision(packet.definition, { sampleRate: packet.sampleRate });
          if (await effectGraphHash(native) !== packet.graphDefinitionHash) throw fail('A published body differs from its recorded definition hash.');
          if (native.impulseCount || native.sidechainInputs.length || native.nodes.filter(node => node.network).length !== 1 || native.nodes.some(node => !['bus-in', 'bus-out', 'gain', 'sympathetic-network'].includes(node.kind))) throw fail('This comparison supports one recorded audio-input modal network per revision.');
          const target = prepareEffectGraphRevision(packet.definition, { sampleRate: request.sampleRate }), renderedGraphHash = await effectGraphHash(target);
          const sourceReference = { takeId: source.takeId, takeRevision: source.takeRevision, sourceCanonicalHash: source.sourceCanonicalHash, ownerRouteRevision: packet.ownerRouteRevision, graphDefinitionHash: packet.graphDefinitionHash, sampleRate: packet.sampleRate, publicationFrame: packet.targetFrame };
          variants.push({ id: 'body-' + packet.ownerRouteRevision, label: 'Body revision ' + packet.ownerRouteRevision + ' · matched PRELISTEN; raw WAV', definitionHash, engineRequirement, renderedGraphHash, sourceReference,
            input: { definition: CAUSAL_RENDER_SINE, effectGraph: target.definition, tail: { mode: 'exact-crop' } } });
        }
        return { variants, sourceCanonicalHash: source.sourceCanonicalHash, sourceDefinitionHash: definitionHash, sourceIntentHash: await hashData(source.intents, { maxBytes: 8 * 1048576, maxNodes: 1000000 }), capturedGestures: 'not-replayed;published-static-body-defaults', excitation: 'one-identical-owned-sine-revoice-of-original-captured-intents-per-body', crop: 'same-exact-source-frame-window;include-decay-in-selected-range' };
      } finally { try { retireCausalRead(loan); } catch (error) { retainUnknown({ error, loan }); throw error; } }
    },
    verifyReadout(result, variant, plan) {
      const manifest = result.bundle.manifest;
      if (manifest.sourceCanonicalHash !== plan.sourceCanonicalHash || manifest.intentHash !== plan.sourceIntentHash || manifest.effectGraph?.hash !== variant.renderedGraphHash || manifest.effectGraph.controls !== 'explicit-authored-defaults-not-replayed-live-gestures' || manifest.tail?.mode !== 'exact-crop' || manifest.commands.derivedReleases !== 0 || canonicalDataText(manifest.effectGraph.definition).text !== canonicalDataText(variant.input.effectGraph).text) throw fail('A readout changed the original intents, exact static body or crop policy.');
    },
    describeComparison({ plan, files }) {
      const calibration = planPatchComparisonGroupLevels(files.map(file => file.manifest));
      return { sourceDefinitionHash: plan.sourceDefinitionHash, sourceIntentHash: plan.sourceIntentHash, bodyRevisions: plan.variants.map(variant => ({ ...variant.sourceReference, renderedGraphHash: variant.renderedGraphHash })),
        capturedGestures: plan.capturedGestures, excitation: plan.excitation, crop: plan.crop, calibration, level: 'whole-file-rms-matched-PRELISTEN;attenuation-only;raw-WAV-gain-unchanged', previewLevelEvidence: 'source-file-PCM;cue-resampling-route-and-device-level-unmeasured', effects: 'recorded-body-definitions;new-static-realizations', measuredSimilarity: null, perceptualQuality: null };
    }
  });
}
