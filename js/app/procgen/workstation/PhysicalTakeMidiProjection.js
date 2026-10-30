import { selectPhysicalMidiEpoch, selectPhysicalMidiCrop } from './PhysicalTakeMidiEpochs.js';
import { preparePhysicalMidiTiming } from './PhysicalMidiTiming.js';
import { smfHeader, smfTempo, smfVariable, smfBeatTick } from './ProcgenSmfBytes.js';

const natural = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const bounded = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const defaultChannels = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16]);
const midiPitch = pitch => {
  if (!bounded(pitch?.cents, -24000, 24000) || !bounded(pitch.referenceHz ?? 440, 0.1, 20000)) throw new Error('Physical MIDI requires captured sounding pitch.');
  return pitch.cents / 100 + 12 * Math.log2((pitch.referenceHz ?? 440) / 440);
};
const expressionFor = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['pressure01', 'pitchOffsetCents', 'pan01'].includes(key)) ||
      value.pressure01 != null && !bounded(value.pressure01, 0, 1) || value.pitchOffsetCents != null && !bounded(value.pitchOffsetCents, -24000, 24000) ||
      value.pan01 != null && !bounded(value.pan01, -1, 1)) throw new Error('Choose a qualified lowering for unsupported physical note expression.');
  return value;
};
/** @typedef {{channels?: number[], ppq?: number, bendRangeSemitones?: number, program?: number, epoch?: string, origin?: {epoch: string, simTick: number, subTick?: number}, end?: {epoch: string, simTick: number, subTick?: number}}} PhysicalMidiOptions */
/** @param {{revoice?: Record<string, any>, options?: PhysicalMidiOptions}} input
 * @param {{signal?: AbortSignal, current?: () => boolean, estimatedPeakBytes?: number, onProgress?: (progress: any) => void, yieldControl?: () => Promise<unknown>}} [controls] */
export async function encodePhysicalTakeMidi({ revoice, options = {} } = {}, { signal, current = () => true, estimatedPeakBytes,
  onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const intents = revoice?.intents, channels = options.channels ?? defaultChannels, ppq = options.ppq ?? 960, bendRange = options.bendRangeSemitones ?? 2, program = options.program ?? 0;
  if (revoice?.version !== 1 || revoice.operation !== 'sound-only-revoice' || !text(revoice.takeId) || !natural(revoice.takeRevision) || !/^[a-f0-9]{64}$/.test(revoice.sourceCanonicalHash) ||
      Object.keys(options).some(key => !['channels', 'ppq', 'bendRangeSemitones', 'program', 'epoch', 'origin', 'end'].includes(key)) || options.epoch != null && !text(options.epoch) || !Array.isArray(intents) || intents.length > 8192 || revoice.intentCount !== intents.length || revoice.nextSequence != null ||
      revoice.coverage?.status !== 'known-covered' || revoice.boundary?.status !== 'captured-initial-state' || !Array.isArray(revoice.boundary.state?.voices) || revoice.boundary.state.voices.length ||
      !Array.isArray(revoice.finalBoundaryState?.voices) || revoice.finalBoundaryState.voices.length || !['finalized', 'partial'].includes(revoice.sourceState) ||
      !Array.isArray(channels) || !channels.length || channels.length > 15 || new Set(channels).size !== channels.length || channels.some(channel => !Number.isInteger(channel) || channel < 1 || channel > 16 || channel === 10) ||
      ![2, 12, 24, 48, 96].includes(bendRange) || !Number.isInteger(program) || program < 0 || program > 127 || !Number.isInteger(ppq) || ppq < 24 || ppq > 32767 ||
      !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 32 * 1048576 + intents.length * 8192 || estimatedPeakBytes > 256 * 1048576)
    throw new Error('Physical MIDI needs a covered finalized bounded intent source with empty note boundaries and an explicit melodic channel policy.');
  const guard = () => { signal?.throwIfAborted(); if (!current()) throw new Error('The selected physical MIDI source changed.'); };
  const pulse = async completedUnits => { guard(); onProgress({ phase: 'lowering-physical-take', completedUnits, totalUnits: intents.length }); await yieldControl(); guard(); };
  guard();
  const selection = await selectPhysicalMidiEpoch(revoice, options.epoch, { signal, current, yieldControl });
  const { saved, selected: epoch } = selection;
  const origin = options.origin ?? selection.origin, end = options.end ?? selection.end;
  const crop = selectPhysicalMidiCrop(revoice, selection, origin, end), { sourceOrdinals } = crop;
  const sourceTime = { version: 1, domain: 'simulation-tick', ordering: 'canonical-intent-order', clock: saved, origin, end };
  const events = [], active = new Map(), seen = new Set(), free = [...channels].sort((a, b) => a - b), initialized = new Set();
  const losses = { velocity7bit: 0, minimumNonzeroVelocity: 0, pressure7bit: 0, pan7bit: 0, pitch14bit: 0, maximumVelocityError: 0, maximumPressureError: 0, maximumPanError: 0, maximumPitchErrorCents: 0,
    sourceIntentsWithoutFactSequence: 0, originalTimbreReplaced: true, releaseVelocityUnobserved: 0 };
  let peakVoices = 0, begins = 0, updates = 0, ends = 0;
  const emit = (data, intent, intentOrdinal) => {
    if (events.length >= 100000) throw new RangeError('Physical MIDI protocol expansion exceeds100000 messages.');
    events.push({ type: 'midi1-channel', data, worldId: intent.worldId, causalSequence: intent.causalSequence ?? null, intentOrdinal, intentId: intent.intentId, voiceId: intent.voiceId, scoreTime: intent.scoreTime });
  };
  const lower = (value, kind, range, minimum = 0) => {
    const encoded = Math.max(minimum, Math.round(value * range)), decoded = encoded / range, error = Math.abs(value - decoded);
    if (error) losses[kind + '7bit']++; const field = 'maximum' + kind[0].toUpperCase() + kind.slice(1) + 'Error'; losses[field] = Math.max(losses[field], error); return encoded;
  };
  const pan = value => {
    const encoded = Math.round(64 + value * (value < 0 ? 64 : 63)), decoded = (encoded - 64) / (encoded < 64 ? 64 : 63), error = Math.abs(value - decoded);
    if (error) losses.pan7bit++; losses.maximumPanError = Math.max(losses.maximumPanError, error); return encoded;
  };
  for (const index of sourceOrdinals) {
    const intent = intents[index];
    if (intent?.version !== 1 || !['begin', 'update', 'end'].includes(intent.kind) || !text(intent.intentId) || seen.has(intent.intentId) || !text(intent.voiceId) ||
        !text(intent.worldId) || intent.worldId !== saved.worldId || !natural(intent.generation) || intent.scoreTime?.epoch !== epoch.epoch ||
        intent.route === 'prepared-body' || intent.causalSequence != null && !natural(intent.causalSequence)) throw new Error('Physical MIDI intent identity, clock or source route is unsupported.');
    seen.add(intent.intentId); if (intent.causalSequence == null) losses.sourceIntentsWithoutFactSequence++;
    const key = JSON.stringify([intent.worldId, intent.generation, intent.voiceId]), expression = expressionFor(intent.expression ?? {});
    let voice = active.get(key);
    if (intent.kind === 'begin') {
      if (voice || !bounded(intent.velocity01, Number.MIN_VALUE, 1)) throw new Error('Physical MIDI onset is repeated, silent or has invalid velocity.');
      if (!free.length) throw new Error('Physical MIDI melodic channel capacity exhausted; no voice was stolen or merged.');
      const pitch = midiPitch(intent.pitch), note = Math.round(pitch);
      if (note < 0 || note > 127) throw new Error('Captured sounding pitch lies outside MIDI1 note addresses.');
      const channel = free.shift(), status = channel - 1;
      voice = { channel, note, pitch, expression: { pressure01: 0, pan01: 0, pitchOffsetCents: 0 } }; active.set(key, voice); peakVoices = Math.max(peakVoices, active.size);
      if (!initialized.has(channel)) {
        for (const [controller, value] of [[101, 0], [100, 0], [6, bendRange], [38, 0], [101, 127], [100, 127]]) emit([0xb0 | status, controller, value], intent, index);
        emit([0xc0 | status, program], intent, index); initialized.add(channel);
      }
      emit([0xb0 | status, 64, 0], intent, index); emit([0xd0 | status, 0], intent, index); emit([0xb0 | status, 10, 64], intent, index);
      begins++;
    } else if (!voice) throw new Error('Physical MIDI update or release lacks its retained original onset.');
    const status = voice.channel - 1;
    if (intent.kind === 'end') {
      emit([0x80 | status, voice.note, 0], intent, index); emit([0xe0 | status, 0, 64], intent, index);
      active.delete(key); free.push(voice.channel); free.sort((a, b) => a - b); ends++; losses.releaseVelocityUnobserved++;
    } else {
      Object.assign(voice.expression, expression);
      if (intent.kind === 'update' && intent.pitch != null) voice.pitch = midiPitch(intent.pitch);
      const cents = (voice.pitch - voice.note) * 100 + voice.expression.pitchOffsetCents;
      if (Math.abs(cents) > bendRange * 100) throw new Error('Physical MIDI expression exceeds the explicitly configured pitch-bend range.');
      const pitchValue = cents / (bendRange * 100), bend = Math.round(8192 + pitchValue * (pitchValue < 0 ? 8192 : 8191));
      const decoded = (bend - 8192) / (bend < 8192 ? 8192 : 8191) * bendRange * 100, error = Math.abs(decoded - cents);
      if (error) losses.pitch14bit++; losses.maximumPitchErrorCents = Math.max(losses.maximumPitchErrorCents, error);
      emit([0xe0 | status, bend & 127, bend >> 7], intent, index);
      if (intent.kind === 'begin' || expression.pressure01 != null) emit([0xd0 | status, lower(voice.expression.pressure01, 'pressure', 127)], intent, index);
      if (intent.kind === 'begin' || expression.pan01 != null) emit([0xb0 | status, 10, pan(voice.expression.pan01)], intent, index);
      if (intent.kind === 'begin') {
        const velocity = lower(intent.velocity01, 'velocity', 127, 1); if (!Math.round(intent.velocity01 * 127)) losses.minimumNonzeroVelocity++;
        emit([0x90 | status, voice.note, velocity], intent, index);
      } else updates++;
    }
    if (index % 128 === 127) await pulse(index + 1);
  }
  if (active.size) throw new Error('Physical MIDI capture ends with open semantic voices; no releases were invented.');
  guard();
  const timed = preparePhysicalMidiTiming(events, sourceTime, ppq);
  const lowering = { schema: 'procgen-physical-midi-lowering/v1', sourceLayer: 'captured-musical-intent', evidence: 'new-midi1-revoice-not-submitted-output', protocol: 'midi1-independent-melodic-channels',
    channels: [...channels], program, bendRangeSemitones: bendRange, capacity: channels.length, capacityPolicy: 'reject-no-steal-no-merge', peakVoices, begins, updates, ends, losses };
  const manifest = { schema: 'procgen-physical-take-midi/v1', takeId: revoice.takeId, takeRevision: revoice.takeRevision, sourceCanonicalHash: revoice.sourceCanonicalHash,
    epochSelection: { epoch: epoch.epoch, ordinal: selection.choices.indexOf(epoch) + 1, available: selection.choices.length, selectedIntents: selection.sourceOrdinals.length, excludedIntents: intents.length - selection.sourceOrdinals.length, boundaryPolicy: 'retained-closed-no-crossing-notes' },
    cropSelection: { selectedIntents: sourceOrdinals.length, excludedIntents: crop.excludedIntents, boundaryPolicy: 'inclusive-closed-no-crossing-notes' },
    sourceComplete: revoice.sourceComplete === true, noteBoundaries: 'retained-closed-no-derived-pickups-or-releases', timing: timed.report, lowering };
  const payload = new TextEncoder().encode(JSON.stringify(manifest)); if (payload.length > 4096) throw new RangeError('Physical MIDI manifest exceeds4KiB.');
  const rows = [{ tick: 0, data: smfTempo(timed.bpm) }, { tick: 0, data: [0xff, 1, ...smfVariable(payload.length), ...payload] }];
  for (let index = 0; index < timed.events.length; index++) {
    const event = timed.events[index]; rows.push({ tick: smfBeatTick(event.beat, ppq), data: event.type === 'tempo' ? smfTempo(event.bpm) : event.data });
    if (index % 4096 === 4095) await pulse(intents.length);
  }
  rows.sort((a, b) => a.tick - b.tick);
  let previous = 0, trackBytes = 0;
  for (const row of rows) { trackBytes += smfVariable(row.tick - previous).length + row.data.length; previous = row.tick; }
  const endDelta = smfVariable(timed.report.endTick - previous); trackBytes += endDelta.length + 3;
  if (trackBytes > 64 * 1048576) throw new RangeError('Physical MIDI file exceeds64MiB.');
  const bytes = new Uint8Array(22 + trackBytes); bytes.set(smfHeader(ppq, trackBytes)); let at = 22; previous = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], delta = smfVariable(row.tick - previous); bytes.set(delta, at); at += delta.length; bytes.set(row.data, at); at += row.data.length; previous = row.tick;
    if (index % 4096 === 4095) await pulse(intents.length);
  }
  bytes.set(endDelta, at); bytes.set([0xff, 0x2f, 0], at + endDelta.length); guard(); return { bytes, manifest };
}
