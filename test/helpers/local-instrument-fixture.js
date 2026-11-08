import { nativeSoundCandidates } from './native-sound-candidates.js';
import { validateSoundContentReference } from '../../js/midi/content/SoundContentReference.js';
import { createInstrumentExecutionLifecycle } from '../../js/app/midi-ui/InstrumentExecutionLifecycle.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
let loading, fixture;
export const loadLocalInstrumentFixture = () => loading ||= nativeSoundCandidates().then(({ candidates, descriptors }) => fixture = { reference: validateSoundContentReference({ ...candidates[0].reference, definition: candidates[0].definition }), catalog: { state: 'bound-application-engines', descriptors } });
export const localInstrumentFixture = () => { if (!fixture) throw new Error('Load the local instrument fixture before use.'); return fixture; };
// Orchestration boundary only; actual PCM and native node lifetime have separate fixtures.
export function createSemanticFixtureBackend({ context, generation = () => 0, record = () => {} }) {
  const voices = new Set();
  return createInstrumentExecutionLifecycle({ capabilities: { maximumVoices: 64, independentSamePitch: true, ownedGates: true },
    prepare: async () => ({ status: 'ready' }), renewExecutionLease: () => ({ status: 'accepted' }),
    begin(intent, targetFrame) { voices.add(intent.voiceId); record({ type: 'begin', note: intent.pitch.cents / 100, intent, targetFrame }); return { status: 'accepted' }; },
    update: () => ({ status: 'accepted' }), end(voiceId, release, targetFrame) { voices.delete(voiceId); record({ type: 'end', voiceId, release, targetFrame }); return { status: 'accepted' }; },
    cancelGenerationWithReceipt() { const count = voices.size; voices.clear(); record({ type: 'clear' }); return { status: 'accepted', count, retirement: createProcgenRetirementScope().retire() }; },
    renderDiagnostics: () => ({ activeVoices: voices.size }), dispose() { voices.clear(); record({ type: 'clear' }); return createProcgenRetirementScope().retire(); }
  }, { getContext: () => context, getGeneration: generation, isSettled: () => true, isVoiceSettled: voiceId => !voices.has(voiceId), forget() {} }).api;
}
export function addSemanticAudioFixturePorts(audio, record = () => {}) {
  const context = { state: 'running', currentTime: 0, sampleRate: 48000 };
  audio.getAudioContext ||= () => context;
  audio.getInstrumentCatalog ||= async () => localInstrumentFixture().catalog;
  audio.getSoundMaterialProvider ||= () => ({});
  audio.createInstrumentBackend ||= () => createSemanticFixtureBackend({ context, record });
  return audio;
}
