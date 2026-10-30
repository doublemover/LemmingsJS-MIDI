import { createSoundSeedRecipe } from './SoundSeedRecipe.js';
import { SOUND_SEED_GRAFT_BODIES } from './SoundSeedGraftRecipe.js';
import { canonicalDataText, freezeData, hashDataText } from '../../core/CanonicalData.js';

export async function createGraftRecipeOrigin({ manifest, assetHash, byteLength, originalBody = null, modalFit = null } = {}) {
  if (originalBody === null) return createSoundSeedRecipe({ manifest, assetHash, byteLength, transform: 'hammer-seed', pitch: { mode: 'unpitched' } });
  if (!Object.hasOwn(SOUND_SEED_GRAFT_BODIES, originalBody) || manifest !== undefined || assetHash !== undefined || byteLength !== undefined || modalFit !== null) throw new TypeError('Original grafts require one built-in body and no invented frozen recording or fitted-source ancestry.');
  const body = SOUND_SEED_GRAFT_BODIES[originalBody], encodedBody = canonicalDataText({ schema: 'lemmings-original-graft-body/v1', body }), bodyHash = await hashDataText(encodedBody.text), sourceUrl = 'urn:lemmings:original-graft-body:' + bodyHash;
  const contract = freezeData({ schema: 'lemmings-original-graft-recipe/v1', algorithmRevision: 'original-authored-graft-origin-v1', assetHash: bodyHash, originalBody, bodyModel: body,
    sourceMaterialRole: 'original-authored-modal-model-data;no-recorded-PCM', sourceTakeRefs: [], ancestry: [], printedEffects: 'none-declared', rightsClosure: 'original-authored-model;redistribution-not-asserted', warnings: [] });
  const encoded = canonicalDataText(contract), contractHash = await hashDataText(encoded.text), recipeId = 'original.graft.' + bodyHash.slice(0, 24), rights = kind => ({ kind, creator: 'LemmingsJS-MIDI', sourceUrl, licenseId: 'NOASSERTION', licenseUrl: null, attribution: 'Original authored modal ratios, positive decay and observation gains.', modifications: ['original-authored-graft-origin-v1'], declaredUse: 'unknown' });
  return freezeData({ contract, contractHash, contractText: encoded.text, originalModelFile: { path: 'graft/original-body.json', sha256: bodyHash, bytes: encodedBody.bytes.length, text: encodedBody.text }, source: { schema: 'lemmings-sound-recipes/v1',
    pack: { id: recipeId, version: '1.0.0', name: body.name, author: 'LemmingsJS-MIDI', sourceUrl, licenseId: 'NOASSERTION', licenseUrl: null, attribution: 'Original procedural exciter and authored modal model. No recording is required.', modifications: [], redistributionPolicy: 'unknown', licenses: [] },
    files: [{ path: 'graft/original-body.json', sha256: bodyHash, bytes: encodedBody.bytes.length, kind: 'generated-data', mediaType: 'application/json', parents: [], rights: rights('derived-data') },
      { path: 'graft/recipe.json', sha256: contractHash, bytes: encoded.bytes.length, kind: 'generated-data', mediaType: 'application/json', parents: [bodyHash], rights: rights('derived-data') }],
    recipes: [{ id: recipeId, revision: 1, name: body.name, author: 'LemmingsJS-MIDI', tags: ['original', 'private-modal-body'], engine: { id: 'worklet-texture', version: 1 }, rights: rights('patch-recipe'), sampleRefs: [], dependencies: [bodyHash, contractHash], voicePolicy: { maxVoices: 2, steal: 'reject' }, mix: { gain01: 0.6, pan01: 0 }, components: [], macros: [] }] } });
}
