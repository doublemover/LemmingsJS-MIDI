export function sendProcgenMidiBytes(port, bytes, timestamp) {
  if (!port || port.state === 'disconnected') return false;
  // WebMidi.js wraps the native MIDIOutput timestamp in an options object.
  port.send(Array.from(bytes), port.channels ? { time: timestamp } : timestamp);
  return true;
}

export function clearProcgenMidiQueue(port) {
  try { port?.clear?.(); } catch { /* A disconnected port may reject clear. */ }
}

export function songPositionBytes(beat) {
  const position = Math.min(16383, Math.max(0, Math.floor(beat * 4)));
  return [0xf2, position & 127, (position >> 7) & 127];
}
