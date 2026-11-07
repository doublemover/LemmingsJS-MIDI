import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';

const SCHEMA = 'lemmings-causal-onset-coverage/v1', MAX_ENTRIES = 16, MAX_ENTRY_BYTES = 32768, MAX_LIST_BYTES = 8192;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = () => { throw new TypeError('Causal onset coverage needs an exact bounded source/frame inventory.'); };

export function createCausalOnsetCoverage({ voices, firstFrame, frames, sampleRate, takeId, takeRevision, sourceCanonicalHash, laneId = null, panicFrame = null }) {
  if (!voices?.[Symbol.iterator] || !integer(firstFrame) || !integer(frames) || !frames || !integer(firstFrame + frames) ||
      !integer(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !text(takeId) || !integer(takeRevision) || !takeRevision ||
      !hash(sourceCanonicalHash) || laneId != null && !integer(laneId) || panicFrame != null && !integer(panicFrame)) fail();
  const entries = []; let total = 0, bytes = 0, visited = 0;
  for (const voice of voices) {
    if (++visited > 32768) fail();
    if (!integer(voice.start)) fail();
    if (voice.start < firstFrame || voice.start >= firstFrame + frames || laneId != null && voice.laneId !== laneId || panicFrame != null && voice.start >= panicFrame) continue;
    total++;
    const intent = voice.begin;
    if (!text(intent?.intentId) || !text(intent.worldId) || !integer(intent.generation) || !Array.isArray(intent.sourceEventIds) ||
        !intent.sourceEventIds.length || intent.sourceEventIds.length > 8 || !intent.sourceEventIds.every(text)) continue;
    const entry = { intentId: intent.intentId, worldId: intent.worldId, generation: intent.generation,
      sourceEventIds: [...intent.sourceEventIds], frame: voice.start - firstFrame };
    const size = canonicalDataText(entry, { maxBytes: MAX_ENTRY_BYTES, maxNodes: 64 }).bytes.length;
    if (entries.length === MAX_ENTRIES || bytes + size > MAX_LIST_BYTES) continue;
    entries.push(entry); bytes += size;
  }
  return freezeData({ schema: SCHEMA, complete: total === entries.length, total, omitted: total - entries.length,
    takeId, takeRevision, sourceCanonicalHash, sampleRate, frames, frameDomain: 'artifact-local-output-frames',
    evidence: 'rendered-semantic-source-onsets;not-cause-separation-or-acoustic-proof', entries });
}
export function cropCausalOnsetCoverage(value, firstFrame, endFrame) {
  if (value == null) return null;
  if (!integer(firstFrame) || !integer(endFrame) || endFrame <= firstFrame || value.schema !== SCHEMA || !integer(value.frames) ||
      endFrame > value.frames || !integer(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 192000 ||
      !text(value.takeId) || !integer(value.takeRevision) || !value.takeRevision || !hash(value.sourceCanonicalHash) ||
      typeof value.complete !== 'boolean' || !integer(value.total) || !integer(value.omitted) || value.total !== value.entries?.length + value.omitted ||
      value.complete !== (value.omitted === 0) || value.frameDomain !== 'artifact-local-output-frames' ||
      value.evidence !== 'rendered-semantic-source-onsets;not-cause-separation-or-acoustic-proof' ||
      !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) fail();
  canonicalDataText(value, { maxBytes: 12288, maxNodes: 512 });
  const ids = new Set(), entries = [];
  for (const entry of value.entries) {
    if (!entry || Object.keys(entry).some(key => !['intentId', 'worldId', 'generation', 'sourceEventIds', 'frame'].includes(key)) ||
        !text(entry.intentId) || ids.has(entry.intentId) || !text(entry.worldId) || !integer(entry.generation) ||
        !integer(entry.frame) || entry.frame >= value.frames || !Array.isArray(entry.sourceEventIds) ||
        !entry.sourceEventIds.length || entry.sourceEventIds.length > 8 || !entry.sourceEventIds.every(text)) fail();
    ids.add(entry.intentId);
    if (entry.frame >= firstFrame && entry.frame < endFrame) entries.push({ ...entry, sourceEventIds: [...entry.sourceEventIds], frame: entry.frame - firstFrame });
  }
  return freezeData({ ...value, frames: endFrame - firstFrame, entries, total: entries.length + value.omitted });
}
