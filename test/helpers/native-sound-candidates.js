import { readFile } from 'node:fs/promises';
import { NATIVE_SOUND_COLLECTIONS } from '../../js/app/procgen/workstation/NativeSoundCollections.js';
import { compileSoundContent } from '../../js/midi/content/SoundContentCompiler.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createInstrumentExecutionLifecycle } from '../../js/app/midi-ui/InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
export async function nativeSoundCandidates() {
  const descriptors = await describeNativeInstrumentEngines(['native-oscillator', 'native-fm', 'native-modal', 'worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum'].map(engineId => ({ engineId, engineVersion: 1, artifactHash: 'a'.repeat(64) })));
  const candidates = [];
  for (const collection of NATIVE_SOUND_COLLECTIONS) {
    const source = JSON.parse(await readFile(collection.source, 'utf8')), result = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) }), patch = result.prepared.patches.find(entry => entry.definition.id === collection.patchIds[0]);
    candidates.push({ reference: { schema: 'lemmings-sound-reference/v1', packHash: result.prepared.contentHash, patchId: patch.definition.id, revision: patch.definition.revision,
      definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: patch.dependencies }, definition: patch.archivedDefinition });
  }
  return { candidates, descriptors };
}
// Host-owner and physics integration fixture only: deliberately no PCM or acoustic claim.
export function createSilentPreparationAudio() {
  const context = { currentTime: 0, sampleRate: 48000, state: 'running' }, state = { enabled: false, selectedBackend: 'synth', contextEpoch: 1 };
  const renderer = () => createInstrumentExecutionLifecycle({ prepare: async () => ({ status: 'ready' }), capabilities: {},
    begin: () => ({ status: 'accepted' }), update: () => ({ status: 'accepted' }), end: () => ({ status: 'accepted' }),
    updateLaneMix: () => ({ status: 'accepted' }), renewExecutionLease: () => ({ status: 'accepted' }), renderDiagnostics: () => ({ voices: 0 }),
    cancelGenerationWithReceipt: () => ({ status: 'accepted', count: 0 }), dispose: () => createProcgenRetirementScope().retire() },
  { getContext: () => context, getGeneration: () => 0, isSettled: () => true, isVoiceSettled: () => true, forget() {} }).api;
  return { getAudioContext: () => context, getState: () => state, subscribe: () => () => {}, createSession: () => ({ getState: () => ({ enabled: false, ownerId: 'fixture' }),
    createInstrumentBackend: renderer, createWorkletInstrumentBackend: async () => renderer(), enable: async () => false, stop() {}, dispose: () => createProcgenRetirementScope().retire() }) };
}
