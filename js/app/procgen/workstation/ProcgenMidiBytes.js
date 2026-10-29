import { withMidiSubmissionGuard } from '../../../midi/scheduler/MidiByteSubmission.js';

export function validProcgenMidiChannelBytes(bytes) {
  if (!bytes || !Number.isInteger(bytes.length) || bytes.length < 2 || bytes.length > 3) return false;
  const status = bytes[0];
  if (!Number.isInteger(status) || status < 0x80 || status >= 0xf0) return false;
  if (bytes.length !== ([0xc0, 0xd0].includes(status & 0xf0) ? 2 : 3)) return false;
  for (let index = 1; index < bytes.length; index++) if (!Number.isInteger(bytes[index]) || bytes[index] < 0 || bytes[index] > 127) return false;
  return true;
}

export function sendProcgenMidiBytes(port, bytes, timestamp, isCurrent = null) {
  if (!port || port.state === 'disconnected') return false;
  // WebMidi.js wraps the native MIDIOutput timestamp in an options object.
  const data = Array.from(bytes), send = port.send, options = port.channels ? { time: timestamp } : timestamp;
  if (isCurrent) { try { if (isCurrent() !== true) return false; } catch { return false; } }
  return withMidiSubmissionGuard(port, isCurrent, () => send.call(port, data, options)) !== false;
}

export function clearProcgenMidiQueue(port, isCurrent = null) {
  if (!port || port.state === 'disconnected' || typeof port.clear !== 'function' ||
      (port._midiOutput && typeof port._midiOutput.clear !== 'function')) return false;
  try { const clear = port.clear; if (isCurrent && isCurrent() !== true) return false; return withMidiSubmissionGuard(port, isCurrent, () => clear.call(port)) !== false; } catch { return false; }
}

export function songPositionBytes(beat) {
  const position = Math.min(16383, Math.max(0, Math.floor(beat * 4)));
  return [0xf2, position & 127, (position >> 7) & 127];
}
