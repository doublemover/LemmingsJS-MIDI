import { createTakeReadoutComparisonOwner } from './TakeReadoutComparisonOwner.js';
import { prepareGraftComparison } from '../../midi/content/GraftComparison.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const roles = Object.freeze(['original', 'exciter-only', 'body-only', 'full-graft']);
const fail = message => Object.assign(new Error('Graft take comparison: ' + message), { code: 'graft-take-comparison-unavailable' });
export function createGraftTakeComparisonOwner(options = {}) {
  return createTakeReadoutComparisonOwner({ ...options, name: 'Graft take comparison', code: 'graft-take-comparison-unavailable', schema: 'lemmings-graft-take-comparison/v1',
    async buildPlan(request, { check }) {
      const copy = reference => freezeData(validateSoundContentReference(JSON.parse(canonicalDataText(reference, { maxBytes: 65536, maxNodes: 8192 }).text)));
      const original = copy(request.originalReference), graft = copy(request.graftReference), tail = request.tail || { mode: 'exact-crop' };
      if (!original || !graft || !['exact-crop', 'bounded-natural', 'boundary-release'].includes(tail.mode) || Object.keys(tail).some(key => !['mode', 'maxSeconds'].includes(key)) || !Number.isFinite(tail.maxSeconds ?? 4) || (tail.maxSeconds ?? 4) < 0 || (tail.maxSeconds ?? 4) > 4) throw fail('Choose explicit pinned instruments and a bounded common tail policy.');
      const frames = Math.round((request.endSeconds - request.startSeconds + (tail.mode === 'exact-crop' ? 0 : tail.maxSeconds ?? 4)) * request.sampleRate);
      if (frames * 8 * 4 + 4 * 262208 > 64 * 1048576) throw fail('The four output files exceed the shared 64 MiB comparison cap.');
      for (const reference of [original, graft]) if (await hashData(reference.definition) !== reference.definitionHash) throw fail('An instrument differs from its immutable definition hash.');
      const dry = await prepareGraftComparison(graft.definition, 'exciter-only'), body = await prepareGraftComparison(graft.definition, 'body-only'); check();
      const expected = [original.definitionHash, dry.comparison.definitionHash, body.comparison.definitionHash, graft.definitionHash];
      return { originalDefinitionHash: original.definitionHash, graftDefinitionHash: graft.definitionHash, tail,
        variants: roles.map((id, index) => { const reference = index === 0 ? original : graft; return { id, label: id === 'body-only' ? 'Body only · after the same excitation' : id, definitionHash: expected[index], engineRequirement: reference.engineRequirement,
          sourceReference: { packHash: reference.packHash, patchId: reference.patchId, revision: reference.revision, definitionHash: reference.definitionHash },
          ...(index === 1 || index === 2 ? { derivation: index === 1 ? dry.comparison : body.comparison } : {}),
          input: { definition: reference.definition, materialReference: reference, tail, graftComparison: index === 1 || index === 2 ? id : null } }; }) };
    },
    verifyReadout(result, variant, plan) {
      if (result.bundle.manifest.tail?.mode !== plan.tail.mode || result.bundle.manifest.tail.maxSeconds !== (plan.tail.maxSeconds ?? 4)) throw fail('A readout changed its declared tail policy.');
      if (variant.derivation && canonicalDataText(result.comparison).text !== canonicalDataText(variant.derivation).text) throw fail('The dry/body readout lacks its exact source-preserving derivation.');
    },
    describeComparison({ plan, readouts }) {
      return { originalDefinitionHash: plan.originalDefinitionHash, graftDefinitionHash: plan.graftDefinitionHash, readouts: readouts.map(row => ({ ...row, role: row.id })), level: 'fixed-authored-gain;no-loudness-normalization', effects: 'dry-sources;no-external-rack', quality: 'unqualified-numerical-and-listening-result' };
    }
  });
}
