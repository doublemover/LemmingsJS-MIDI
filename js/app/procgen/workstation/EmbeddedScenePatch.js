import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateInstrumentPatchV2 } from '../../../midi/content/InstrumentPatchV2.js';

export async function createEmbeddedScenePatch({ sourceHash, descriptor, definition }) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash || '') || !descriptor || definition?.engineId !== descriptor.engineId || definition.engineVersion !== descriptor.engineVersion) throw new TypeError('An embedded score patch requires the exact source and engine descriptor.');
  const patch = validateInstrumentPatchV2(definition, descriptor), definitionHash = await hashData(patch), packHash = await hashData({ schema: 'lemmings-original-scene-patches/v1', sourceHash, definitionHash });
  return freezeData({ schema: 'lemmings-sound-reference/v1', packHash, patchId: patch.id, revision: patch.revision, definitionHash, definition: patch, assetHashes: patch.sampleRefs.map(asset => asset.sha256),
    engineRequirement: { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash } });
}
