import { hashData, freezeData } from '../../../core/CanonicalData.js';
import { validateSoundContentReference } from '../../../midi/content/SoundContentReference.js';
import { OWNED_SOURCE_IDS, getOwnedSourceProfile } from '../../midi-ui/OwnedSourceProfiles.js';

export async function sceneOwnedMaterialReceipt(material, reference) {
  return freezeData({ sourceIndex: material.sourceIndex, definitionHash: reference.definitionHash, dependencyCount: material.verifiedDependencyHashes.length, dependencyHash: await hashData([...material.verifiedDependencyHashes].sort()), descriptorHash: material.pcm ? await hashData(material.pcm.descriptor) : null, bytes: material.pcm ? material.pcm.descriptor.bytes : 0, dataVerification: 'owned-provider-SHA256-before-handoff;not-rehashed-as-JSON-in-render-worker' });
}

export async function prepareSceneRehearsalLane({ scene, source, sourceHash, buildId, sampleRate, index, descriptors, sourceMaterial = null } = {}) {
  const row = scene.patchRefs[index], reference = validateSoundContentReference(row.reference), descriptor = descriptors.find(value => value.engineId === reference.engineRequirement.engineId);
  if (!descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === reference.engineRequirement[key]) || await hashData(reference.definition) !== reference.definitionHash) throw new Error('The rehearsal patch differs from its exact executing definition.');
  if (reference.assetHashes.length) {
    const profile = OWNED_SOURCE_IDS.includes(descriptor.engineId) ? getOwnedSourceProfile(descriptor.engineId) : null, hashes = sourceMaterial?.verifiedDependencyHashes;
    if (!profile || sourceMaterial?.sourceIndex !== index || !Array.isArray(hashes) || hashes.length > 512 || hashes.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) || new Set(hashes).size !== hashes.length || reference.assetHashes.some(value => !hashes.includes(value)) || (profile.requiresPCM ? !sourceMaterial.pcm : sourceMaterial.pcm !== null)) throw new Error('The rehearsal source needs its exact prepared PCM/data ancestry; metadata availability alone is insufficient.');
  } else if (sourceMaterial !== null) throw new Error('An assetless scene lane cannot receive unrelated prepared material.');
  const intents = source.intents.filter(intent => intent.laneId === index), laneHash = await hashData({ sceneHash: source.sceneHash, sourceHash, laneId: row.laneId, intents }, { maxBytes: 8 * 1048576, maxNodes: 524288 });
  const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'scene-rehearsal:' + source.sceneHash + ':' + row.laneId, takeRevision: 1, sourceCanonicalHash: laneHash, sourceState: 'finalized', coverage: { status: 'known-covered' },
    boundary: { status: 'captured-initial-state', state: { sourceTimeMs: source.sourceTimeMs, voices: [] } }, finalBoundaryState: { sourceTimeMs: source.sourceTimeMs + source.durationSeconds * 1000 },
    sourceVersions: { applicationBuildId: buildId, sceneHash: source.sceneHash, rehearsalSourceHash: sourceHash }, intents };
  return { row, reference, descriptor, intents, laneHash, input: { revoice, definition: reference.definition, descriptor, applicationBuildId: buildId, sampleRate, startSeconds: 0, endSeconds: source.durationSeconds, tail: { mode: 'boundary-release', maxSeconds: 0.5 }, stemLaneIds: [], ...(sourceMaterial?.pcm ? { pcm: sourceMaterial.pcm } : {}) } };
}
