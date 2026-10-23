export function sendProcgenMidiBytes(port, bytes, timestamp) {
  if (!port || port.state === 'disconnected') return false;
  // WebMidi.js wraps the native MIDIOutput timestamp in an options object.
  return port.send(Array.from(bytes), port.channels ? { time: timestamp } : timestamp) !== false;
}

export function clearProcgenMidiQueue(port) {
  if (!port || port.state === 'disconnected' || typeof port.clear !== 'function' ||
      (port._midiOutput && typeof port._midiOutput.clear !== 'function')) return false;
  try { return port.clear() !== false; } catch { return false; }
}

export function songPositionBytes(beat) {
  const position = Math.min(16383, Math.max(0, Math.floor(beat * 4)));
  return [0xf2, position & 127, (position >> 7) & 127];
}
