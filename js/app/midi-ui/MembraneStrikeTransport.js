import { MEMBRANE_STRIKE_QUEUE_CAPACITY, MEMBRANE_STRIKE_VOICES, MEMBRANE_STRIKE_RECEIPTS } from '../../midi/content/RectangularMembraneProfile.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'EffectGraphError', code });
const natural = value => Number.isSafeInteger(value) && value >= 0;
const normalized = value => Number.isFinite(value) && value >= 0 && value <= 1;

export function createMembraneStrikeTransport({ profile, node, context, nodeId, graphDefinitionHash, offline = false, onReceipt, onUnknown }) {
  const pending = new Map(); let lastDriveFrame = 0, blocked = false, applied = 0, ended = 0, rejected = 0;
  const report = receipt => { try { onReceipt(Object.freeze({ ...receipt, nodeId, graphDefinitionHash, processorRevision: profile.revision })); } catch {} };
  const unknown = reason => {
    if (blocked) return; blocked = true;
    report({ status: 'rejected', stage: 'body-strike-ownership-unknown', reason, acousticReceipt: false, appliedFrame: null, retainedCommands: pending.size });
    onUnknown(failure('body-strike-ownership-unknown', reason));
  };
  const enqueue = raw => {
    const { frame, token, x01, y01, amplitude01, pulseIndex } = raw || {}, now = Math.ceil(context.currentTime * context.sampleRate), pulse = profile.pulses[pulseIndex];
    if (blocked) throw failure('body-strike-quarantined', 'The body command transport has unresolved ownership.');
    if (!natural(frame) || !natural(token) || token === 0 || !normalized(x01) || !normalized(y01) || !normalized(amplitude01) || !Number.isInteger(pulseIndex) || !pulse || !Number.isSafeInteger(frame + pulse.frames) || frame < now || !offline && frame > now + context.sampleRate) throw failure('invalid-body-strike', 'A finite strike needs a current bounded frame, unique token, prepared pulse and normalized position/amplitude.');
    if (pending.has(token) || pending.size >= MEMBRANE_STRIKE_QUEUE_CAPACITY + MEMBRANE_STRIKE_VOICES) throw failure('body-strike-capacity', 'The finite body command limit is full or this token is already owned.');
    const command = Object.freeze({ frame, token, x01, y01, amplitude01, pulseIndex }), record = { command, admitted: false, applied: false };
    pending.set(token, record); lastDriveFrame = Math.max(lastDriveFrame, frame + pulse.frames);
    try { node.port.postMessage({ type: 'body-strike', command }); }
    catch (error) { unknown('Body command submission failed with unknown delivery: ' + error.message); throw error; }
    return Object.freeze({ status: 'accepted', stage: 'body-strike-api-submitted', nodeId, graphDefinitionHash, token, targetFrame: frame, endFrame: frame + pulse.frames, appliedFrame: null, acousticReceipt: false });
  };
  const consume = data => {
    if (!['body-strike-admission', 'body-strike-receipts'].includes(data?.type)) return false;
    if (blocked) return true;
    try {
      if (data.revision !== profile.revision) throw new Error('Body strike receipt has a foreign processor revision.');
      if (data.type === 'body-strike-admission') {
        const record = pending.get(data.token);
        if (!record || record.admitted || record.applied || typeof data.accepted !== 'boolean' || typeof data.muted !== 'boolean' || !natural(data.frame) || !natural(data.reasonCode) || data.reasonCode > 4 || data.accepted && (data.reasonCode !== 0 || data.muted || data.frame > record.command.frame)) throw new Error('Body strike queue admission does not match its owned command.');
        record.admitted = data.accepted;
        if (!data.accepted) { pending.delete(data.token); rejected++; }
        report({ status: data.accepted ? 'accepted' : 'rejected', stage: 'body-strike-dsp-queued', token: data.token, targetFrame: record.command.frame, observedFrame: data.frame, reasonCode: data.reasonCode, appliedFrame: null, acousticReceipt: false });
        if (offline && !data.accepted) unknown('Offline body rejected an admitted finite strike.');
        return true;
      }
      const values = data.data;
      if (!(values instanceof Float64Array) || values.length === 0 || values.length % 4 || values.length > MEMBRANE_STRIKE_RECEIPTS * 4) throw new Error('Invalid bounded body strike receipt packet.');
      // Validate the whole packet before releasing any ownership.
      const simulated = new Map([...pending].map(([token, record]) => [token, { ...record }]));
      for (let at = 0; at < values.length; at += 4) {
        const kind = values[at], token = values[at + 1], frame = values[at + 2], code = values[at + 3], record = simulated.get(token);
        if (!record || !record.admitted || ![1, 2, 3].includes(kind) || !natural(frame) || !natural(code) || code > 3) throw new Error('Body strike receipt has no matching admitted command.');
        if (kind === 1) { if (record.applied || code !== 0 || frame !== record.command.frame) throw new Error('Body strike was not applied at its exact target frame.'); record.applied = true; }
        else if (kind === 2) { if (record.applied || code === 0 || code !== 3 && frame < record.command.frame) throw new Error('Invalid body strike rejection.'); simulated.delete(token); }
        else { if (!record.applied || code !== 0 && code !== 3 || code === 0 && frame !== record.command.frame + profile.pulses[record.command.pulseIndex].frames || code === 3 && frame < record.command.frame) throw new Error('Invalid finite body strike completion.'); simulated.delete(token); }
      }
      for (let at = 0; at < values.length; at += 4) {
        const kind = values[at], token = values[at + 1], frame = values[at + 2], code = values[at + 3], record = pending.get(token);
        if (kind === 1) { record.applied = true; applied++; } else { pending.delete(token); if (kind === 2) rejected++; else ended++; }
        report({ status: kind === 2 ? 'rejected' : 'accepted', stage: kind === 1 ? 'body-strike-applied' : kind === 2 ? 'body-strike-rejected' : 'body-strike-ended', token, targetFrame: record.command.frame, observedFrame: frame, appliedFrame: kind === 1 ? frame : null, reasonCode: code, acousticReceipt: false, applicationEvidence: kind === 1 ? 'processor-frame-acknowledged' : null });
        if (offline && (kind === 2 || code === 3)) unknown('Offline body strike did not finish its exact finite support.');
      }
    } catch (error) { unknown(error.message); }
    return true;
  };
  return Object.freeze({ enqueue, consume, lastDriveFrame: () => lastDriveFrame,
    assertComplete() { if (blocked || pending.size || rejected) throw failure('body-strike-incomplete', 'The body lacks complete applied and ended receipts for every finite strike.'); },
    state: () => ({ blocked, pending: pending.size, applied, ended, rejected, lastDriveFrame }) });
}
