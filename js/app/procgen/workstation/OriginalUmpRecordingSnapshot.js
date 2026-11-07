import { yieldBackgroundTask } from '../../resources/BackgroundTaskYield.js';
import { planRecordedMidiExport } from './RecordedMidiExportPlan.js';

/** @typedef {{schema: string, count: number, sourceCount: number, beats: Float64Array, offsets: Uint32Array, words: Uint32Array, routes: Uint32Array, sourceIndices: Uint32Array, attribution: Record<string, unknown>[], metadataBytes: number, tempoBeats: Float64Array, tempoBpms: Float64Array, tempoIndices: Uint32Array, outputIds: string[], outputEpochs: Float64Array, routeCounts: Uint32Array, firstTempoBeat: number|null}} OriginalUmpSnapshot */
/** @typedef {{sourceLayer?: string, tempoSource?: 'captured-transport'|'original-flex', placement?: 'retained-absolute-beat'|'rebase-recording-start', outputRouteId?: string, outputRouteIndex?: number, ppq?: number}} OriginalClipOptions */
export const ORIGINAL_UMP_RECORDING_SCHEMA = 'procgen-original-ump-recording/v1';
export const ORIGINAL_UMP_METADATA_LIMIT = 32 * 1048576;
const identities = ['intentId', 'onsetId', 'voiceId', 'eventId', 'batchId', 'worldId', 'actorId'];
export const originalUmpExportPeakBytes = estimate => {
  if (!Number.isSafeInteger(estimate) || estimate < 0 || estimate > ORIGINAL_UMP_METADATA_LIMIT) throw new RangeError('Invalid original UMP recording estimate.');
  return 64 * 1048576 + estimate * 10;
};
export function originalUmpAttribution(event) {
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const key of identities) if (event[key] != null) {
    const value = event[key];
    if (!(typeof value === 'string' && value.length <= 256 || Number.isSafeInteger(value) && value >= 0)) throw new TypeError('Invalid original UMP attribution identity.');
    result[key] = value;
  }
  if (event.sourceEventIds != null) {
    if (!Array.isArray(event.sourceEventIds) || event.sourceEventIds.length > 32 || event.sourceEventIds.some(id => typeof id !== 'string' || id.length > 256)) throw new TypeError('Invalid original UMP source identities.');
    result.sourceEventIds = [...event.sourceEventIds];
  }
  for (const key of ['soundingPitch', 'controllerSequence', 'baselineRevision']) if (event[key] != null) {
    if (!Number.isFinite(event[key])) throw new TypeError('Invalid original UMP controller attribution.'); result[key] = event[key];
  }
  return result;
}
/** @param {OriginalUmpSnapshot} snapshot @param {OriginalClipOptions} [options] */
export function planOriginalUmpClip(snapshot, options = {}, counts = snapshot?.routeCounts, boundary = snapshot?.firstTempoBeat) {
  if (options.sourceLayer !== undefined && options.sourceLayer !== 'authored-intent') throw Object.assign(new Error('Original UMP Clip export currently captures authored intent only; no submitted UMP backend is recorded.'), { code: 'clip-submitted-source-unavailable' });
  if (!['captured-transport', 'original-flex'].includes(options.tempoSource)) throw new RangeError('Choose captured transport tempo or original Flex tempo for this Clip.');
  const plan = planRecordedMidiExport(snapshot, { ...options, sourceLayer: 'intent-render' }, counts, boundary);
  if (!plan.includedMessages) throw new Error('No original UMP intent is retained for the selected output.');
  return Object.freeze({ ...plan, schema: 'procgen-original-ump-export-plan/v1', sourceLayer: 'authored-intent', publication: 'not-submitted',
    protocol: 'original-ump', channelPolicy: 'preserve-original-groups-and-channels', tempoSource: options.tempoSource });
}
/** @param {{records: Record<string, any>[], count: number, signal?: AbortSignal, isCurrent: () => boolean, onProgress?: (progress: any) => void, yieldTask?: (options: any) => Promise<unknown>}} options
 * @returns {Promise<OriginalUmpSnapshot>} */
export async function snapshotOriginalUmpRecording({ records, count, signal, isCurrent, onProgress = () => {}, yieldTask = yieldBackgroundTask }) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 2000000) throw new RangeError('Invalid original recording prefix.');
  const guard = () => { signal?.throwIfAborted(); if (!isCurrent()) throw new Error('The original UMP recording changed during preparation.'); };
  const pulse = async completedUnits => { guard(); onProgress({ phase: 'snapshotting-original-ump', completedUnits, totalUnits: count * 2 }); await yieldTask({ signal }); guard(); };
  guard(); let packets = 0, wordCount = 0, tempos = 0;
  for (let index = 0; index < count; index++) {
    const event = records[index];
    if (!event.cancelled && event.type === 'umpIntent') {
      const length = event.umpWords?.length;
      if (!Number.isInteger(length) || length < 1 || length > 4) throw new TypeError('Original UMP packets must retain complete words.');
      packets++; wordCount += length;
    } else if (!event.cancelled && event.type === 'tempo') tempos++;
    if (packets > 100000 || packets + tempos > 262144) throw new RangeError('Original UMP recording exceeds the Clip event bound.');
    if (index % 4096 === 4095) await pulse(index + 1);
  }
  const beats = new Float64Array(packets), offsets = new Uint32Array(packets + 1), words = new Uint32Array(wordCount), routes = new Uint32Array(packets), sourceIndices = new Uint32Array(packets), attribution = [];
  const tempoBeats = new Float64Array(tempos), tempoBpms = new Float64Array(tempos), tempoIndices = new Uint32Array(tempos), outputIds = [], epochs = [], counts = [], ids = new Map();
  let at = 0, word = 0, tempo = 0, textUnits = 0, metadataBytes = 0, firstTempoBeat = null;
  const encoder = new TextEncoder();
  for (let index = 0; index < count; index++) {
    const event = records[index];
    if (!event.cancelled && event.type === 'umpIntent') {
      if (!Number.isFinite(event.beat) || event.beat < 0 || event.timeDomain !== 'recorded-score-beat' || event.publication !== 'authored-not-submitted') throw new Error('Original UMP export requires explicitly mapped authored score beats.');
      const outputId = String(event.outputId ?? ''), epoch = event.connectionEpoch ?? -1, revision = event.routeRevision ?? -1;
      if (![epoch, revision].every(value => Number.isSafeInteger(value) && value >= -1)) throw new TypeError('Invalid original output epoch.');
      const key = JSON.stringify([outputId, epoch, revision]);
      if (!ids.has(key)) {
        if (outputIds.length >= 4096 || outputId.length > 4096 || (textUnits += outputId.length) > 524288) throw new RangeError('Original output identities exceed the export bound.');
        ids.set(key, outputIds.length); outputIds.push(outputId); epochs.push(epoch, revision); counts.push(0, 0);
      }
      const meta = originalUmpAttribution(event), size = encoder.encode(JSON.stringify(meta)).length;
      if (size > 4096 || (metadataBytes += size + 512) > ORIGINAL_UMP_METADATA_LIMIT) throw new RangeError('Original UMP attribution exceeds the bounded sidecar.');
      beats[at] = event.beat; routes[at] = ids.get(key); counts[routes[at] * 2 + 1]++; sourceIndices[at] = index; attribution.push(meta);
      offsets[at] = word; for (const value of event.umpWords) words[word++] = value; offsets[++at] = word;
    } else if (!event.cancelled && event.type === 'tempo') {
      if (!Number.isFinite(event.beat) || event.beat < 0 || !Number.isFinite(event.bpm) || event.bpm <= 0) throw new TypeError('Invalid captured transport tempo.');
      tempoBeats[tempo] = event.beat; tempoBpms[tempo] = event.bpm; tempoIndices[tempo++] = index;
      if (firstTempoBeat == null || event.beat < firstTempoBeat) firstTempoBeat = event.beat;
    }
    if (index % 4096 === 4095) await pulse(count + index + 1);
  }
  guard(); onProgress({ phase: 'snapshotting-original-ump', completedUnits: count * 2, totalUnits: count * 2 });
  return { schema: ORIGINAL_UMP_RECORDING_SCHEMA, count: packets, sourceCount: count, beats, offsets, words, routes, sourceIndices, attribution, metadataBytes,
    tempoBeats, tempoBpms, tempoIndices, outputIds, outputEpochs: new Float64Array(epochs), routeCounts: new Uint32Array(counts), firstTempoBeat };
}
