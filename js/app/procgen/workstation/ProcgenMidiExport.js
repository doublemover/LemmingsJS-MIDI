import { encodeProcgenMidi } from './ProcgenMidiPorts.js';

const variable = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) throw new RangeError('MIDI delta time exceeds the four-byte SMF limit.');
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
};
const word = value => [(value >> 8) & 255, value & 255];
const long = value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const tempo = bpm => {
  const microseconds = Math.max(1, Math.min(0xffffff, Math.round(60000000 / (Number(bpm) > 0 ? Number(bpm) : 120))));
  return [0xff, 0x51, 3, (microseconds >> 16) & 255, (microseconds >> 8) & 255, microseconds & 255];
};

// Beat positions make performance export independent of physical game speed.
// Channel numbers are 1..16; programs and controllers retain MIDI's 0..127 values.
export function exportProcgenMidi(events = [], { bpm = 120, ppq = 480, beatsPerBar = 4, beatUnit = 4 } = {}) {
  ppq = Math.max(24, Math.min(32767, Math.round(Number(ppq) || 480)));
  const denominator = [1, 2, 4, 8, 16, 32].includes(beatUnit) ? beatUnit : 4;
  const timeline = [{ tick: 0, data: tempo(bpm) },
    { tick: 0, data: [0xff, 0x58, 4, Math.min(255, Math.max(1, Math.round(beatsPerBar) || 4)), Math.log2(denominator), 24, 8] }];
  for (const event of events) {
    const tick = Math.max(0, Math.round((Number(event.beat) || 0) * ppq));
    if (event.type === 'tempo') { timeline.push({ tick, data: tempo(event.bpm) }); continue; }
    const messages = encodeProcgenMidi(event);
    for (const data of messages) {
      const expected = (data[0] & 0xf0) === 0xc0 || (data[0] & 0xf0) === 0xd0 ? 2 : 3;
      if (data[0] < 0x80 || data[0] >= 0xf0 || data.length !== expected || data.slice(1).some(value => !Number.isInteger(value) || value < 0 || value > 127)) continue;
      timeline.push({ tick, data });
    }
  }
  timeline.sort((a, b) => a.tick - b.tick);
  const track = []; let previous = 0;
  for (const event of timeline) { track.push(...variable(event.tick - previous), ...event.data); previous = event.tick; }
  track.push(0, 0xff, 0x2f, 0);
  const result = new Uint8Array(22 + track.length);
  result.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ...word(ppq),
    0x4d, 0x54, 0x72, 0x6b, ...long(track.length)]);
  result.set(track, 22);
  return result;
}
