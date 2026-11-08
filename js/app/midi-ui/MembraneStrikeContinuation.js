import { cloneData } from '../../core/CanonicalData.js';
import { MEMBRANE_STRIKE_QUEUE_CAPACITY, MEMBRANE_STRIKE_VOICES, MEMBRANE_STRIKE_WIDTH } from '../../midi/content/RectangularMembraneProfile.js';
const natural = value => Number.isSafeInteger(value) && value >= 0;
const normalized = value => Number.isFinite(value) && value >= 0 && value <= 1;
const fail = () => { throw Object.assign(new Error('Finite-strike host state differs from the detached body frontier.'), { code: 'incompatible-body-strike-continuation' }); };
export function validateMembraneStrikeContinuation(raw, profile, audioFrame) {
  const state = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 });
  if (!state || Object.keys(state).some(key => !['schema', 'audioFrame', 'pending', 'applied', 'ended', 'rejected', 'lastDriveFrame'].includes(key)) ||
      state.schema !== 'lemmings-membrane-strike-cut/v1' || !natural(audioFrame) || state.audioFrame !== audioFrame ||
      !['applied', 'ended', 'rejected', 'lastDriveFrame'].every(key => natural(state[key])) || !Array.isArray(state.pending) || state.pending.length > MEMBRANE_STRIKE_QUEUE_CAPACITY + MEMBRANE_STRIKE_VOICES) fail();
  const tokens = new Set();
  for (const record of state.pending) {
    const command = record?.command, pulse = profile.pulses[command?.pulseIndex];
    if (!record || Object.keys(record).some(key => !['command', 'admitted', 'applied'].includes(key)) || record.admitted !== true || typeof record.applied !== 'boolean' ||
        !command || Object.keys(command).some(key => !['frame', 'token', 'x01', 'y01', 'amplitude01', 'pulseIndex'].includes(key)) ||
        !natural(command.frame) || !natural(command.token) || !command.token || tokens.has(command.token) || !Number.isInteger(command.pulseIndex) || !pulse ||
        !['x01', 'y01', 'amplitude01'].every(key => normalized(command[key])) || !Number.isSafeInteger(command.frame + pulse.frames) || command.frame + pulse.frames > state.lastDriveFrame ||
        (record.applied ? command.frame >= audioFrame || command.frame + pulse.frames <= audioFrame : command.frame < audioFrame)) fail();
    tokens.add(command.token);
  }
  return state;
}
export function assertMembraneStrikeKernelContinuation(raw, kernel, audioFrame, logicalAudioFrame) {
  const state = validateMembraneStrikeContinuation(raw, kernel.profile, audioFrame), strikes = kernel.strikes, expected = new Map(state.pending.map(record => [record.command.token, record]));
  if (strikes.receiptCount || strikes.lastFrame !== logicalAudioFrame - 1) fail();
  const offset = logicalAudioFrame - audioFrame;
  const match = (plane, at, active) => {
    const record = expected.get(plane[at + 1]), command = record?.command;
    if (!record || record.applied !== active || (active ? plane[at + 7] : plane[at]) !== command.frame + offset ||
        plane[at + 2] !== command.x01 || plane[at + 3] !== command.y01 || plane[at + 4] !== command.amplitude01 || plane[at + 5] !== command.pulseIndex) fail();
    expected.delete(command.token);
  };
  for (let index = 0; index < strikes.queued; index++) match(strikes.queue, index * MEMBRANE_STRIKE_WIDTH, false);
  for (let at = 0; at < strikes.voices.length; at += MEMBRANE_STRIKE_WIDTH) if (strikes.voices[at]) match(strikes.voices, at, true);
  if (expected.size) fail();
}
