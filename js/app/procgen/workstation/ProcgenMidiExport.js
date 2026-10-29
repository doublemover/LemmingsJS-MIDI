import { encodeProcgenMidi } from './ProcgenMidiPorts.js';
import { smfVariable as variable, smfTempo as tempo, smfHeader, smfBeatTick } from './ProcgenSmfBytes.js';
import { preparePhysicalMidiTiming } from './PhysicalMidiTiming.js';

// A retained window may end before a real release arrives. Omit only the
// unpaired message; an invented Note Off would claim an event we did not see.
export function selectBalancedProcgenRecording(events = []) {
  const keep = new Uint8Array(events.length), pending = new Map();
  let omittedOnsets = 0, omittedReleases = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index], data = event.data || [];
    const family = (data[0] || 0) & 0xf0;
    const isOn = family === 0x90 && data[2] > 0;
    const isOff = family === 0x80 || (family === 0x90 && data[2] === 0);
    if (!isOn && !isOff) { keep[index] = 1; continue; }
    const key = JSON.stringify([event.outputId ?? '', event.connectionEpoch ?? null, event.routeRevision ?? null, (data[0] || 0) & 15, data[1]]);
    if (isOn) {
      let queue = pending.get(key);
      if (!queue) { queue = { indexes: [], head: 0 }; pending.set(key, queue); }
      queue.indexes.push(index);
    } else {
      const queue = pending.get(key);
      if (!queue || queue.head === queue.indexes.length) { omittedReleases++; continue; }
      keep[queue.indexes[queue.head++]] = 1;
      keep[index] = 1;
      if (queue.head === queue.indexes.length) pending.delete(key);
    }
  }
  for (const queue of pending.values()) omittedOnsets += queue.indexes.length - queue.head;
  return { events: events.filter((_, index) => keep[index]), omittedOnsets, omittedReleases };
}

// Beat positions make performance export independent of physical game speed.
// Channel numbers are 1..16; programs and controllers retain MIDI's 0..127 values.
const normalizePpq = ppq => Math.max(24, Math.min(32767, Math.round(Number(ppq) || 480)));

export function exportPhysicalProcgenMidi(events, sourceTime, options = {}) {
  const ppq = normalizePpq(options.ppq), prepared = preparePhysicalMidiTiming(events, sourceTime, ppq);
  for (const event of prepared.events) if (event.type !== 'tempo' && !encodeProcgenMidi(event).length) throw new RangeError('Physical MIDI event has no supported protocol representation.');
  const bytes = encodeMappedMidi(prepared.events, { ...options, ppq, bpm: prepared.bpm,
    manifest: { ...options.manifest, physicalTiming: prepared.report } }, prepared.endBeat);
  return { bytes, report: prepared.report };
}

export function exportProcgenMidi(events = [], options = {}) {
  return options.sourceTime === undefined ? encodeMappedMidi(events, options) : exportPhysicalProcgenMidi(events, options.sourceTime, options).bytes;
}

function encodeMappedMidi(events, { bpm = 120, ppq = 480, beatsPerBar = 4, beatUnit = 4, manifest = null } = {}, endBeat = null) {
  ppq = normalizePpq(ppq);
  const denominator = [1, 2, 4, 8, 16, 32].includes(beatUnit) ? beatUnit : 4;
  const timeline = [{ tick: 0, data: tempo(bpm) },
    { tick: 0, data: [0xff, 0x58, 4, Math.min(255, Math.max(1, Math.round(beatsPerBar) || 4)), Math.log2(denominator), 24, 8] }];
  if (manifest) {
    const payload = new TextEncoder().encode(JSON.stringify(manifest));
    if (payload.length > 4096) throw new RangeError('Recording manifest exceeds the 4 KiB export limit.');
    timeline.push({ tick: 0, data: [0xff, 0x01, ...variable(payload.length), ...payload] });
  }
  for (const event of events) {
    if (event?.type === 'umpIntent' || event?.umpWords && !event.data?.length) throw Object.assign(new Error('Original UMP intent requires an explicit MIDI1 lowering plan.'), { code: 'original-ump-needs-lowering' });
    const tick = smfBeatTick(event?.beat, ppq);
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
  track.push(...variable(endBeat == null ? 0 : smfBeatTick(endBeat, ppq) - previous), 0xff, 0x2f, 0);
  const result = new Uint8Array(22 + track.length);
  result.set(smfHeader(ppq, track.length));
  result.set(track, 22);
  return result;
}
