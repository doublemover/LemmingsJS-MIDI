const profiles = Object.freeze([
  { waveform: 1, gain01: 1, attackSeconds: 0.008, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.04 },
  { waveform: 0, gain01: 0.9, attackSeconds: 0.006, decaySeconds: 0.05, sustain01: 0.82, releaseSeconds: 0.06 },
  { waveform: 3, gain01: 0.48, attackSeconds: 0.004, decaySeconds: 0.09, sustain01: 0.4, releaseSeconds: 0.04 },
  { waveform: 2, gain01: 0.45, attackSeconds: 0.012, decaySeconds: 0.08, sustain01: 0.65, releaseSeconds: 0.055 },
  { waveform: 1, gain01: 0.3, attackSeconds: 0.002, decaySeconds: 0.055, sustain01: 0, releaseSeconds: 0.015 }
]);
let sequence = 0;
export async function createNativeAudioFixture(session, { profile = 0, leaseSeconds = 4 } = {}) {
  if (!session?.createInstrumentBackend || !session?.getAudioContext || !Number.isInteger(profile) || !profiles[profile]) throw new TypeError('Use an explicit native audio fixture owner and profile.');
  const context = session.getAudioContext(), generation = ++sequence, parameters = { ...profiles[profile], pan01: 0 }, patchId = 'native-control-fixture-' + profile;
  const backend = session.createInstrumentBackend({ gateMode: 'owned' }), resolution = { status: 'ready', patch: { id: patchId, revision: 1, engineId: 'native-oscillator', engineVersion: 1, parameters, sampleRefs: [], voicePolicy: { maxVoices: 64, steal: 'reject' }, mix: { gain01: 1, pan01: 0 } }, receipt: { patchId, revision: 1, qualification: 'explicit-control-fixture;not-a-shipped-preset' } };
  const prepared = await backend.prepare(resolution); if (prepared.status !== 'ready') throw new Error('Native fixture preparation refused: ' + prepared.reason);
  const registered = backend.registerExecution({ executionEpoch: 'native-control-fixture:' + generation, generation }); if (registered.status !== 'accepted') throw new Error('Native fixture execution refused.');
  const execution = registered.execution, until = Math.ceil((context.currentTime + leaseSeconds) * context.sampleRate);
  if (backend.renewExecutionLease(generation, execution, until).status !== 'accepted') throw new Error('Native fixture lease refused.');
  return Object.freeze({ backend, execution, parameters: Object.freeze(parameters), qualification: resolution.receipt.qualification,
    begin({ id, pitchCents, velocity01 = 96 / 127, pan01 = 0, laneIndex = 0, targetFrame = Math.ceil(context.currentTime * context.sampleRate), endFrame = Math.round(context.sampleRate) }) {
      const voiceId = String(id), receipt = backend.begin({ version: 1, kind: 'begin', generation, voiceId, onsetId: voiceId, sourceEventIds: [], laneId: laneIndex, pitch: { cents: pitchCents, referenceHz: 440 }, velocity01, expression: { pressure01: 1, pan01 } }, targetFrame, execution);
      if (receipt.status === 'accepted') { const ended = backend.end(voiceId, { seconds: parameters.releaseSeconds }, endFrame, execution); if (ended.status !== 'accepted') throw new Error('Native fixture end refused: ' + ended.reason); } return receipt;
    }, active(id) { return backend.inspectExecution(execution, String(id)).voiceSettled === false; },
    stop: () => backend.retireExecution(execution).retirement, dispose: () => backend.dispose() });
}
