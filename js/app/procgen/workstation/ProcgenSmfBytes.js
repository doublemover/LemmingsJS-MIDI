export const smfVariable = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) throw new RangeError('MIDI delta time exceeds the four-byte SMF limit.');
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
};
export const smfTempo = bpm => {
  const microseconds = Math.round(60000000 / bpm);
  if (!Number.isFinite(bpm) || bpm <= 0 || microseconds < 1 || microseconds > 0xffffff) throw new RangeError('Tempo is outside the representable SMF range; export was not retimed.');
  return [0xff, 0x51, 3, (microseconds >> 16) & 255, (microseconds >> 8) & 255, microseconds & 255];
};
export const smfHeader = (ppq, length) => [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255,
  0x4d, 0x54, 0x72, 0x6b, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255];
