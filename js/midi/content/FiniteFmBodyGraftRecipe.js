import { FINITE_FM_EXCITER, FINITE_FM_EXCITER_REVISION } from './FiniteFmExciterProfile.js';
import { createSoundSeedGraftRecipe } from './SoundSeedGraftRecipe.js';
import { canonicalDataText, freezeData, hashDataText } from '../../core/CanonicalData.js';

export async function createFiniteFmBodyGraftRecipe(options = {}) {
  const transform = options.manifest?.derivedTransform;
  if (transform?.schema !== 'lemmings-finite-fm-excitation/v1' || transform.algorithmRevision !== FINITE_FM_EXCITER_REVISION || canonicalDataText(transform.generator).text !== canonicalDataText(FINITE_FM_EXCITER).text || ![44100, 48000, 96000].includes(transform.preparationRate) || transform.frames !== Math.ceil(transform.preparationRate * 0.012) || transform.frames !== options.manifest.frames || transform.preparationRate !== options.manifest.sampleRate || !/^[a-f0-9]{64}$/.test(transform.parentAssetHash || '')) throw new TypeError('Felt lightning requires the exact prepared original finite FM asset and body ancestry.');
  const prepared = await createSoundSeedGraftRecipe({ ...options, transform: 'feedforward-graft' }), source = structuredClone(prepared.source), recipe = source.recipes[0];
  const contract = freezeData({ ...prepared.contract, transform: 'finite-fm-body-graft', exciter: transform, sourceMaterialRole: 'generated-finite-FM-excitation;frozen-parent-is-body-ancestry-only',
    graft: { ...prepared.contract.graft, exciterRef: { ...prepared.contract.graft.exciterRef, revision: transform.algorithmRevision }, excitationCalibration: { ...prepared.contract.graft.excitationCalibration, supportSeconds: 0.012 } },
    warnings: ['Original 12 ms softened FM strike; body tuning and positive T60 are independent. This creative hybrid does not reproduce the parent take. Spectral, device and matched-level listening qualification is pending.'] });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), id = 'finite.fm-body.' + contractHash.slice(0, 24);
  source.pack.id = recipe.id = id; source.pack.name = recipe.name = (options.graftBody === 'wood' ? 'Felt lightning' : 'Finite FM strike') + ' → ' + contract.body.name;
  recipe.dependencies = [options.assetHash, contractHash]; recipe.tags = ['original-finite-fm-strike', 'finite-fm-body-graft', 'private-modal-body', 'unqualified-content']; recipe.sampleMap.mapId = id + '.map';
  const exciter = recipe.components.find(value => value.id === 'exciter'); exciter.parameters.graftSupportSeconds.value = 0.012;
  // The asset already carries the softened finite edge. Keep the generic reader's
  // attack transparent; its body runs after the finite source reaches EOF.
  recipe.components.find(value => value.id === 'envelope').parameters.attackSeconds.value = 0;
  source.realizationGroups = source.realizationGroups.map(group => ({ ...group, id: id + '.realization', profiles: group.profiles.map(profile => ({ ...profile, recipeId: id, algorithmRevision: transform.algorithmRevision })) }));
  source.files[1].sha256 = contractHash; source.files[1].bytes = encoded.bytes.length;
  return freezeData({ source, contract, contractHash, contractText: encoded.text, templateRevision: transform.algorithmRevision });
}
