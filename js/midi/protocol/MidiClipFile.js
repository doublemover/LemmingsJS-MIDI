import { decodeUmpPacket, UMP_WORD_COUNTS } from './UmpPacketCodec.js';
import { createUmpPayloadCollector } from './UmpPayloadCollector.js';

/** @typedef {{ticks: Float64Array, offsets: Uint32Array, words: Uint32Array}} ClipColumns */
/** @typedef {{ppq: number, configurationEndTick: number, endTick: number, configuration?: ClipColumns, sequence: ClipColumns}} ClipSnapshot */
/** @typedef {{maxBytes?: number, maximumEvents?: number, estimatedPeakBytes?: number, signal?: AbortSignal, current?: () => boolean, yieldControl?: () => Promise<unknown>, onProgress?: (progress: {phase: string, completedUnits: number}) => void}} ClipControls */

export const MIDI_CLIP_FILE_SCHEMA = 'lemmings-midi-clip-file/v1';
export const MIDI_CLIP_MAX_DELTA = 0xfffff;
const HEADER = [0x53, 0x4d, 0x46, 0x32, 0x43, 0x4c, 0x49, 0x50];
const DCS = 0x00400000, DCTPQ = 0x00300000, START = 0xf0200000, END = 0xf0210000;
const MAX_BYTES = 64 * 1048576, MAX_EVENTS = 262144;
const PAYLOAD_WORKSPACE = 32 * 1048576;
const fail = (code, message) => Object.assign(new Error(message), { name: 'MidiClipFileError', code });
const tick = value => Number.isSafeInteger(value) && value >= 0;
const stable = value => !(typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer) && !value.buffer.resizable;
const columnBytes = columns => columns.ticks.byteLength + columns.offsets.byteLength + columns.words.byteLength;
const emptyColumns = () => ({ ticks: new Float64Array(0), offsets: new Uint32Array(1), words: new Uint32Array(0) });
const check = controls => {
  if (controls.signal?.aborted || controls.current && !controls.current()) throw fail('canceled', 'The MIDI Clip source was retired.');
};
const controlsFor = (options = {}) => {
  const controls = { maxBytes: MAX_BYTES, maximumEvents: MAX_EVENTS, estimatedPeakBytes: 128 * 1048576,
    yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)), onProgress: () => {}, ...options };
  if (!Number.isSafeInteger(controls.maxBytes) || controls.maxBytes < 56 || controls.maxBytes > MAX_BYTES ||
      !Number.isSafeInteger(controls.maximumEvents) || controls.maximumEvents < 0 || controls.maximumEvents > MAX_EVENTS ||
      !Number.isSafeInteger(controls.estimatedPeakBytes) || controls.estimatedPeakBytes < 4096 || controls.estimatedPeakBytes > 512 * 1048576 ||
      typeof controls.yieldControl !== 'function' || typeof controls.onProgress !== 'function') throw fail('invalid-limits', 'Invalid MIDI Clip resource limits.');
  check(controls); return controls;
};
const pulse = async (controls, phase, completedUnits) => {
  check(controls); controls.onProgress({ phase, completedUnits }); await controls.yieldControl(); check(controls);
};
const memory = (bytes, controls) => { if (!Number.isSafeInteger(bytes) || bytes > controls.estimatedPeakBytes) throw fail('memory-capacity', 'MIDI Clip preparation exceeds its admitted memory.'); };
const inspectColumns = (value, controls) => {
  if (!value || !(value.ticks instanceof Float64Array) || !(value.offsets instanceof Uint32Array) || !(value.words instanceof Uint32Array) ||
      ![value.ticks, value.offsets, value.words].every(stable) || value.ticks.length > controls.maximumEvents ||
      value.offsets.length !== value.ticks.length + 1 || value.words.length > value.ticks.length * 4 ||
      value.offsets[0] !== 0 || value.offsets[value.ticks.length] !== value.words.length) throw fail('invalid-columns', 'MIDI Clip events require bounded owned tick, offset and UMP word columns.');
  return columnBytes(value);
};
const copyColumns = value => Object.freeze({ ticks: value.ticks.slice(), offsets: value.offsets.slice(), words: value.words.slice() });
const packetAt = (columns, index) => {
  const first = columns.offsets[index], last = columns.offsets[index + 1];
  if (last <= first || last - first > 4 || last > columns.words.length) throw fail('packet-length', 'MIDI Clip packet offsets are not complete ordered UMP frames.');
  return decodeUmpPacket(columns.words.subarray(first, last));
};
const payloadValidator = () => {
  const collector = createUmpPayloadCollector({ maximumStreams: 256, maximumMessageBytes: 1048576, maximumTotalBytes: 8 * 1048576, maximumPackets: 65536, now: () => 0 });
  let headerMessages = 0, tempo = false, meter = false, pendingPackets = 0;
  return {
    accept(packet, section, at) {
      if (packet.kind === 'utility' && ['deltaClockstamp', 'deltaClockstampTicksPerQuarter'].includes(packet.status) || packet.kind === 'stream' && [32, 33].includes(packet.status)) throw fail('owned-structure', 'Clip clockstamps and markers belong to the file structure.');
      if (section === 'configuration') {
        if (packet.kind === 'flex-data' && packet.bank === 0 && packet.status === 0) {
          if (tempo || headerMessages !== 0 || at !== 0) throw fail('configuration-order', 'Configuration tempo must occur once, first, at tick zero.'); tempo = true;
        }
        if (packet.kind === 'flex-data' && packet.bank === 0 && packet.status === 1) {
          if (meter || !tempo || headerMessages !== 1 || at !== 0) throw fail('configuration-order', 'Configuration meter must follow its initial tempo at tick zero.'); meter = true;
        }
        headerMessages++;
      }
      if (['sysex7', 'sysex8'].includes(packet.kind) || packet.kind === 'flex-data' && [1, 2].includes(packet.bank) || packet.kind === 'stream' && [3, 4, 18].includes(packet.status)) {
        if (++pendingPackets > 65536) throw fail('payload-capacity', 'Multipart Clip data exceeds its total packet workspace.');
        const result = collector.accept(packet);
        if (result.status === 'complete') pendingPackets -= result.packets;
        if (result.status === 'complete' && result.kind === 'sysex7' && result.payload[0] === 0x7e && result.payload[2] === 0x0d) {
          if (result.payload[3] >= 0x30 && result.payload[3] <= 0x3f) throw fail('property-exchange', 'Property Exchange belongs in a MIDI Container, not a Clip File.');
          if (result.payload[3] === 0x22) throw fail('unsupported-profile-preface', 'Set Profile On requires a separate untimed Clip preface.');
        }
      }
    },
    boundary() { if (collector.diagnostics().streams) throw fail('unfinished-payload', 'A multipart UMP message crosses a Clip section boundary or ends unfinished.'); }
  };
};
const report = fields => Object.freeze({ schema: MIDI_CLIP_FILE_SCHEMA, protocol: 'ump', byteOrder: 'big-endian',
  timeDomain: 'integer-clip-ticks', sequenceOrigin: 'start-of-clip', quantization: 'none',
  setupDisposition: 'data-only-never-submitted', endpointRouting: 'caller-selected-single-endpoint-required', ...fields });

/** @param {ClipSnapshot} input @param {ClipControls} [options] */
export async function encodeMidiClipFile(input, options = {}) {
  const controls = controlsFor(options);
  if (!input || !Number.isInteger(input.ppq) || input.ppq < 1 || input.ppq > 65535 || !tick(input.configurationEndTick) || !tick(input.endTick)) throw fail('invalid-timeline', 'A Clip requires explicit PPQ, configuration duration and sequence end ticks.');
  const configuration = input.configuration ?? emptyColumns(), sequence = input.sequence;
  const inputBytes = inspectColumns(configuration, controls) + inspectColumns(sequence, controls);
  const eventCount = configuration.ticks.length + sequence.ticks.length;
  if (eventCount > controls.maximumEvents || inputBytes > controls.maxBytes) throw fail('input-capacity', 'MIDI Clip input exceeds its declared capacity.');
  memory(inputBytes * 2 + PAYLOAD_WORKSPACE + 65536, controls);
  const snapshot = { ppq: input.ppq, configurationEndTick: input.configurationEndTick, endTick: input.endTick,
    configuration: copyColumns(configuration), sequence: copyColumns(sequence) };
  const validator = payloadValidator(); let bytes = 56, fillerNoops = 0, unknownPackets = 0, units = 0;
  const measureGap = gap => {
    const fillers = gap > 0 ? Math.floor((gap - 1) / MIDI_CLIP_MAX_DELTA) : 0;
    if (!Number.isSafeInteger(fillers) || fillers > controls.maxBytes / 8) throw fail('output-capacity', 'The MIDI Clip silent gap exceeds its file bound.');
    fillerNoops += fillers; bytes += fillers * 8;
    if (eventCount + fillerNoops > controls.maximumEvents) throw fail('event-capacity', 'Gap fillers exceed the Clip decoded event bound.');
    if (bytes > controls.maxBytes) throw fail('output-capacity', 'The MIDI Clip exceeds its file byte bound.');
  };
  for (const section of ['configuration', 'sequence']) {
    const columns = snapshot[section]; let previous = 0;
    for (let index = 0; index < columns.ticks.length; index++) {
      const at = columns.ticks[index]; if (!tick(at) || at < previous) throw fail('invalid-timeline', 'Clip event ticks must be nonnegative, safe and ordered.');
      const packet = packetAt(columns, index); validator.accept(packet, section, at);
      if (!packet.known) unknownPackets++; bytes += 4 + packet.wordCount * 4; measureGap(at - previous); previous = at;
      if (++units % 1024 === 0) await pulse(controls, 'validating-midi-clip', units);
    }
    const end = section === 'configuration' ? snapshot.configurationEndTick : snapshot.endTick;
    if (end < previous) throw fail('invalid-timeline', 'A Clip section cannot end before its last event.');
    measureGap(end - previous); validator.boundary();
  }
  memory(inputBytes * 2 + bytes + PAYLOAD_WORKSPACE + 65536, controls); check(controls);
  const output = new Uint8Array(bytes), view = new DataView(output.buffer); output.set(HEADER); let offset = 8;
  const write = word => { view.setUint32(offset, word, false); offset += 4; };
  const longGap = async delta => {
    while (delta > MIDI_CLIP_MAX_DELTA) {
      write(DCS | MIDI_CLIP_MAX_DELTA); write(0); delta -= MIDI_CLIP_MAX_DELTA;
      if (++units % 1024 === 0) await pulse(controls, 'writing-midi-clip', units);
    }
    write(DCS | delta);
  };
  write(DCS); write(DCTPQ | snapshot.ppq);
  for (const section of ['configuration', 'sequence']) {
    const columns = snapshot[section]; let previous = 0;
    for (let index = 0; index < columns.ticks.length; index++) {
      const delta = columns.ticks[index] - previous;
      if (delta > MIDI_CLIP_MAX_DELTA) await longGap(delta); else write(DCS | delta);
      previous = columns.ticks[index];
      for (let at = columns.offsets[index]; at < columns.offsets[index + 1]; at++) write(columns.words[at]);
      if (++units % 1024 === 0) await pulse(controls, 'writing-midi-clip', units);
    }
    const delta = (section === 'configuration' ? snapshot.configurationEndTick : snapshot.endTick) - previous;
    if (delta > MIDI_CLIP_MAX_DELTA) await longGap(delta); else write(DCS | delta);
    write(section === 'configuration' ? START : END); write(0); write(0); write(0);
  }
  check(controls); if (offset !== bytes) throw fail('internal-size', 'The Clip byte count changed during serialization.');
  return Object.freeze({ bytes: output, report: report({ ppq: snapshot.ppq, configurationEndTick: snapshot.configurationEndTick,
    endTick: snapshot.endTick, configurationEvents: snapshot.configuration.ticks.length, sequenceEvents: snapshot.sequence.ticks.length,
    fillerNoops, unknownPackets, inputBytes, bytes }) });
}

async function scan(bytes, controls, emit = null) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), validator = payloadValidator();
  let offset = 8, phase = 'resolution', at = 0, ppq = null, lastWasDelta = false, hasDelta = false, configurationEndTick = null, endTick = null;
  let configurationEvents = 0, sequenceEvents = 0, configurationWords = 0, sequenceWords = 0, unknownPackets = 0, noops = 0, packets = 0;
  while (offset < bytes.length) {
    const first = view.getUint32(offset, false), count = UMP_WORD_COUNTS[first >>> 28];
    if (offset + count * 4 > bytes.length) throw fail('truncated-packet', 'The Clip ends inside a UMP packet.');
    const words = []; for (let index = 0; index < count; index++) words.push(view.getUint32(offset + index * 4, false));
    const packet = decodeUmpPacket(words); offset += count * 4;
    if (packet.kind === 'utility' && packet.status === 'deltaClockstamp') {
      if (lastWasDelta) throw fail('consecutive-clockstamp', 'Long Clip gaps require a NOOP between clockstamps.');
      if (!tick(at + packet.data)) throw fail('invalid-timeline', 'Clip time exceeds the safe integer tick range.');
      at += packet.data; lastWasDelta = hasDelta = true;
    } else {
      if (!hasDelta) throw fail('unsupported-profile-preface', 'This reader requires DCS-zero before the resolution; untimed profile prefaces are not supported.');
      if (phase === 'resolution') {
        if (packet.kind !== 'utility' || packet.status !== 'deltaClockstampTicksPerQuarter' || at !== 0 || !packet.data) throw fail('missing-resolution', 'The first timed Clip message must declare a nonzero PPQ at tick zero.');
        ppq = packet.data; phase = 'configuration';
      } else if (packet.kind === 'stream' && packet.status === 32) {
        if (phase !== 'configuration' || !lastWasDelta) throw fail('clip-marker', 'Start of Clip must occur once after its own clockstamp.');
        validator.boundary(); configurationEndTick = at; at = 0; phase = 'sequence';
      } else if (packet.kind === 'stream' && packet.status === 33) {
        if (phase !== 'sequence' || !lastWasDelta || offset !== bytes.length) throw fail('clip-marker', 'End of Clip must finish the sequence after its own clockstamp.');
        validator.boundary(); endTick = at; phase = 'ended';
      } else {
        validator.accept(packet, phase, at);
        if (configurationEvents + sequenceEvents >= controls.maximumEvents) throw fail('event-capacity', 'The Clip exceeds its decoded event bound.');
        if (phase === 'sequence') { sequenceEvents++; sequenceWords += count; } else { configurationEvents++; configurationWords += count; }
        if (!packet.known) unknownPackets++; if (packet.kind === 'utility' && packet.status === 'noop') noops++;
        emit?.(phase, at, words);
      }
      lastWasDelta = false;
    }
    if (++packets % 1024 === 0) await pulse(controls, emit ? 'decoding-midi-clip' : 'inspecting-midi-clip', packets);
  }
  if (phase !== 'ended') throw fail('unfinished-clip', 'The Clip must contain its resolution, Start and final End markers.');
  check(controls); return { ppq, configurationEndTick, endTick, configurationEvents, sequenceEvents, configurationWords, sequenceWords, unknownPackets, noops, packets };
}

/** @param {Uint8Array} input @param {ClipControls} [options] */
export async function decodeMidiClipFile(input, options = {}) {
  const controls = controlsFor(options);
  if (!(input instanceof Uint8Array) || !stable(input) || input.byteLength < 56 || input.byteLength > controls.maxBytes || input.byteLength % 4) throw fail('file-length', 'A Clip requires bounded complete wire words and its full structure.');
  if (!HEADER.every((byte, index) => input[index] === byte)) throw fail('file-header', 'The MIDI Clip file header is not SMF2CLIP.');
  memory(input.byteLength * 2 + PAYLOAD_WORKSPACE + 65536, controls);
  const bytes = input.slice(), measured = await scan(bytes, controls);
  const decodedBytes = (measured.configurationEvents + measured.sequenceEvents) * 12 + 8 + (measured.configurationWords + measured.sequenceWords) * 4;
  memory(input.byteLength * 2 + decodedBytes + PAYLOAD_WORKSPACE + 65536, controls);
  const allocate = (events, words) => Object.freeze({ ticks: new Float64Array(events), offsets: new Uint32Array(events + 1), words: new Uint32Array(words) });
  const configuration = allocate(measured.configurationEvents, measured.configurationWords), sequence = allocate(measured.sequenceEvents, measured.sequenceWords);
  const cursors = { configuration: { events: 0, words: 0 }, sequence: { events: 0, words: 0 } };
  await scan(bytes, controls, (section, at, words) => {
    const columns = section === 'configuration' ? configuration : sequence, cursor = cursors[section];
    columns.ticks[cursor.events] = at; columns.words.set(words, cursor.words); cursor.words += words.length;
    columns.offsets[++cursor.events] = cursor.words;
  });
  return Object.freeze({ ppq: measured.ppq, configurationEndTick: measured.configurationEndTick, endTick: measured.endTick,
    configuration, sequence, report: report({ ...measured, bytes: bytes.length, decodedBytes,
      unknownDisposition: 'preserved-as-data', profilePreface: 'unsupported-explicit-refusal' }) });
}
