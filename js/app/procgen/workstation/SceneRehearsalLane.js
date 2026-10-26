import { hashData } from '../../../core/CanonicalData.js';
import { validateSoundContentReference } from '../../../midi/content/SoundContentReference.js';

export async function prepareSceneRehearsalLane({ scene, source, sourceHash, buildId, sampleRate, index, descriptors } = {}) {
  const row = scene.patchRefs[index], reference = validateSoundContentReference(row.reference), descriptor = descriptors.find(value => value.engineId === reference.engineRequirement.engineId);
  if (!descriptor || !['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === reference.engineRequirement[key]) || reference.assetHashes.length || await hashData(reference.definition) !== reference.definitionHash) throw new Error('The rehearsal patch differs from its exact assetless executing definition.');
  const intents = source.intents.filter(intent => intent.laneId === index), laneHash = await hashData({ sceneHash: source.sceneHash, sourceHash, laneId: row.laneId, intents }, { maxBytes: 8 * 1048576, maxNodes: 524288 });
  const revoice = { operation: 'sound-only-revoice', version: 1, takeId: 'scene-rehearsal:' + source.sceneHash + ':' + row.laneId, takeRevision: 1, sourceCanonicalHash: laneHash, sourceState: 'finalized', coverage: { status: 'known-covered' },
    boundary: { status: 'captured-initial-state', state: { sourceTimeMs: source.sourceTimeMs, voices: [] } }, finalBoundaryState: { sourceTimeMs: source.sourceTimeMs + source.durationSeconds * 1000 },
    sourceVersions: { applicationBuildId: buildId, sceneHash: source.sceneHash, rehearsalSourceHash: sourceHash }, intents };
  return { row, reference, descriptor, intents, laneHash, input: { revoice, definition: reference.definition, descriptor, applicationBuildId: buildId, sampleRate, startSeconds: 0, endSeconds: source.durationSeconds, tail: { mode: 'boundary-release', maxSeconds: 0.5 }, stemLaneIds: [] } };
}
