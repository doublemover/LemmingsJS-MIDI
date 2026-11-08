import { verifyTimbreTuningSet, timbreTuningIdentity, physicalTuningForTimbreSet } from './TimbreTuningSet.js';
import { compileSoundContent, SOUND_RECIPE_SCHEMA } from './SoundContentCompiler.js';
import { hashData, freezeData } from '../../core/CanonicalData.js';

export async function compileTimbreTuningSet(raw, { descriptor, sampleRate, signal } = {}) {
  signal?.throwIfAborted(); const set = await verifyTimbreTuningSet(raw);
  if (descriptor?.engineId !== set.renderer.engineId || descriptor.engineVersion !== set.renderer.engineVersion || ![44100, 48000, 96000].includes(sampleRate)) throw new Error('Prepare the pair against the immutable existing spectrum renderer and actual output rate.');
  if (set.heldPolicy !== 'onset-only') throw new Error('This sparse spectrum pair supports onset-only transitions; retune-held needs a separately admitted atomic held-source transition.');
  const count = set.partialRatios.length, t60 = Math.max(...set.partialT60Seconds), quantity = (value, unit) => ({ value, unit }),
    parameters = { sourceMode: quantity(1, 'enum'), partialCount: quantity(count, 'enum'), partialDecaySeconds: quantity(t60, 's') };
  for (let index = 0; index < count; index++) {
    parameters['partial' + index + 'Ratio'] = quantity(set.partialRatios[index], 'ratio');
    parameters['partial' + index + 'Gain'] = quantity(set.partialProvenance[index].kind === 'disabled' ? 0 : set.partialGains[index], 'amplitude-linear');
    parameters['partial' + index + 'T60Scale'] = quantity(set.partialT60Seconds[index] / t60, 'ratio');
  }
  const source = { schema: SOUND_RECIPE_SCHEMA, pack: { id: set.id + '.pack', version: '1.0.0', name: set.name, author: 'Original laboratory recipe', sourceUrl: null, licenseId: 'NOASSERTION', licenseUrl: null, attribution: '', modifications: [], redistributionPolicy: 'unknown', licenses: [] }, files: [],
    recipes: [{ id: set.id, revision: set.revision, name: set.name, author: 'Original laboratory recipe', tags: ['spectrum', 'tuning', 'original'],
      engine: { id: descriptor.engineId, version: descriptor.engineVersion }, components: [{ id: 'exciter', role: 'exciter', parameters },
        { id: 'resonator', role: 'resonator', parameters: { scan01: quantity(0, 'normalized'), body01: quantity(0, 'normalized'), edge01: quantity(1, 'normalized') } }],
      voicePolicy: { maxVoices: 8, steal: 'reject', switchPolicy: { version: 1, mode: 'new-notes-only', boundary: 'immediate', fadeSeconds: 0.02 } }, mix: { gain01: 0.7, pan01: 0 }, midiFallback: null,
      rights: { kind: 'patch-recipe', creator: 'Original laboratory recipe', sourceUrl: null, licenseId: 'NOASSERTION', licenseUrl: null, attribution: '', modifications: [], declaredUse: 'unknown', licenseTextHash: null } }] };
  const compiled = await compileSoundContent(source, { targets: [{ descriptor }], signal }), patch = compiled.prepared.patches[0], identity = await hashData(timbreTuningIdentity(set)), physicalTuning = physicalTuningForTimbreSet(set),
    admission = set.partialRatios.map((ratio, index) => ({ index, ratio, requestedGain: set.partialGains[index], enabled: set.partialProvenance[index].kind !== 'disabled',
      minimumHz: ratio * set.registerDomain.minimumHz, maximumHz: ratio * set.registerDomain.maximumHz, upperRegisterTaper01: Math.max(0, Math.min(1, (sampleRate * 0.4 - ratio * set.registerDomain.maximumHz) / (sampleRate * 0.04))), reason: set.partialProvenance[index].kind === 'disabled' ? 'explicitly-disabled' : ratio * set.registerDomain.maximumHz >= sampleRate * 0.4 ? 'excluded-at-upper-register-by-renderer-0.4-rate-cutoff' : 'admitted-with-renderer-edge-taper' }));
  signal?.throwIfAborted();
  if (set.analysisReceipt && set.analysisReceipt.setHash !== identity) throw new Error('The retained analysis belongs to an older spectrum/tuning input. Analyze again or explicitly clear the stale receipt.');
  return freezeData({ schema: 'lemmings-compiled-timbre-tuning-set/v1', set, setHash: identity, physicalTuning, pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash,
    reference: { schema: 'lemmings-sound-reference/v1', packHash: compiled.prepared.contentHash, patchId: set.id, revision: set.revision, definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: [], definition: patch.archivedDefinition },
    renderer: patch.engineRequirement, compilerRevision: compiled.compilerRevision, renderKey: compiled.artifacts[0].renderKey, admission: { sampleRate, maximumVoices: 8, partialCount: count, partials: admission, cost: 'declared-structure;runtime-cost-unqualified', actualPcmMeasured: false },
    transition: { atomicPair: true, policy: 'onset-only', heldVoices: 'retain-onset-spectrum-and-tuning', external: 'requires-explicit-output-capability-review' }, qualification: 'compiled-data-and-domain-admission;consolidated-render-and-desktop-campaign-pending' });
}
