const finite = value => Number.isFinite(value) ? value : null;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const MAX_FIELDS = 64;
const RECORD_PRIORITY = ['type', 'accepted', 'reason', 'note', 'channel', 'token', 'requestId', 'voiceId', 'captureScope', 'outputScope', 'outputId', 'backend',
  'program', 'velocity', 'localMasterGain', 'releaseVelocity', 'durationMs', 'matchedDurationMs', 'held', 'cc', 'value', 'scheduledMs', 'intendedMs', 'offScheduledMs',
  'audioTime', 'endAudioTime', 'tick', 'beat', 'beatClock', 'baseTickMs', 'tempoBpm', 'speed', 'frameMs', 'laneIndex', 'laneCount', 'lemmingId',
  'eventType', 'sfxId', 'triggerType', 'trackId', 'ensembleRole', 'percussion', 'scaleName', 'scaleRoot', 'scaleDegrees', 'origin', 'seed', 'generation',
  'generationStartTick', 'laneSeed', 'themeId', 'originId', 'levelId', 'projectId', 'projectUpdatedAt'];
const bounded = (value, depth = 0, budget = { remaining: 256 }) => {
  if (budget.remaining-- <= 0) return null;
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'string') return value.slice(0, 256);
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 32).map(entry => bounded(entry, depth + 1, budget));
  if (typeof value !== 'object') return null;
  const result = {};
  for (const key of Object.keys(value).slice(0, MAX_FIELDS)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    result[key.slice(0, 64)] = bounded(value[key], depth + 1, budget);
  }
  return result;
};
const boundedRecord = fields => {
  const result = {};
  let remaining = 2048;
  const keys = [...new Set([...RECORD_PRIORITY.filter(key => Object.hasOwn(fields || {}, key)), ...Object.keys(fields || {})])];
  for (const key of keys.slice(0, MAX_FIELDS - 4)) {
    if (['seq', 'stage', 'dispatchMs'].includes(key)) continue;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const raw = fields[key];
    const scalar = value => typeof value === 'string' ? value.slice(0, 128)
      : typeof value === 'number' ? finite(value) : typeof value === 'boolean' ? value : null;
    const value = Array.isArray(raw) ? raw.slice(0, 32).map(scalar) : scalar(raw);
    const size = key.length + JSON.stringify(value).length + 4;
    if (size > remaining) continue;
    result[key.slice(0, 64)] = value; remaining -= size;
  }
  return result;
};
const csvCell = value => value == null ? '' : '"' + String(value).replaceAll('"', '""') + '"';
const CSV_FIELDS = ['seq', 'stage', 'type', 'dispatchMs', 'intendedMs', 'scheduledMs', 'audioTime', 'tick', 'beat', 'beatClock', 'baseTickMs', 'tempoBpm', 'localMasterGain', 'speed', 'frameMs', 'outputId', 'outputScope', 'captureScope', 'backend', 'origin', 'seed', 'generation', 'generationStartTick', 'laneSeed', 'themeId', 'originId', 'levelId', 'projectId', 'projectUpdatedAt', 'scaleName', 'scaleRoot', 'scaleDegrees', 'requestId', 'token', 'voiceId', 'laneIndex', 'laneCount', 'lemmingId', 'sfxId', 'eventType', 'triggerType', 'trackId', 'ensembleRole', 'channel', 'program', 'note', 'velocity', 'releaseVelocity', 'durationMs', 'matchedDurationMs', 'cc', 'value', 'reason', 'accepted', 'held', 'waveform', 'endAudioTime', 'rms', 'peak', 'frames', 'sampleRate', 'acousticReceipt', 'count'];

/** Observes finite output sessions. It never routes, sends or changes musical state. */
class MidiOutputCapture {
  constructor({ capacity = 4096, maxDurationMs = 120000, nowMs = clock } = {}) {
    this.capacity = clamp(Math.trunc(finite(capacity) ?? 4096), 64, 32768);
    this.maxDurationMs = clamp(finite(maxDurationMs) ?? 120000, 100, 300000);
    this._nowMs = typeof nowMs === 'function' ? nowMs : clock;
    this._ring = new Array(this.capacity);
    this._active = false;
    this._written = 0;
    this._startedMs = null;
    this._endedMs = null;
    this._metadata = {};
    this._stopReason = null;
    this._noteGates = new Map();
    this._lifecycleTruncated = 0;
  }

  start(metadata = {}) {
    this._ring.fill(undefined);
    this._noteGates.clear();
    this._lifecycleTruncated = 0;
    this._written = 0;
    this._startedMs = this._nowMs();
    this._endedMs = null;
    this._stopReason = null;
    this._metadata = bounded(metadata);
    this._active = true;
    return this.getState();
  }

  stop(reason = 'manual') {
    if (this._active) this._endedMs = this._nowMs();
    this._active = false;
    this._stopReason = String(reason).slice(0, 256);
    return this.getState();
  }

  isActive() {
    if (this._active && this._nowMs() - this._startedMs >= this.maxDurationMs) this.stop('duration-limit');
    return this._active;
  }

  record(stage, fields = {}) {
    if (!this.isActive()) return null;
    const now = this._nowMs();
    const record = { seq: ++this._written, stage: String(stage).slice(0, 64), dispatchMs: now, ...boundedRecord(fields) };
    if (stage === 'api-dispatch' && record.accepted !== false) {
      const gateKey = String(record.outputScope || record.outputId || record.backend || '') + '/' + String(record.captureScope || '') + '/' + record.channel + '/' + record.note;
      if (record.type === 'noteOn') {
        if (this._noteGates.size >= 512) { this._noteGates.delete(this._noteGates.keys().next().value); this._lifecycleTruncated += 1; }
        const id = record.seq;
        this._noteGates.set(id, { gateKey, token: record.token, requestId: record.requestId, voiceId: record.voiceId,
          outputId: record.outputId, outputScope: record.outputScope, channel: record.channel, startMs: record.scheduledMs ?? now });
      } else if (record.type === 'noteOff') {
        for (const [id, note] of this._noteGates) {
          if (note.gateKey !== gateKey || (record.token != null && (note.token !== record.token || note.requestId !== record.requestId)) ||
            (record.voiceId != null && note.voiceId !== record.voiceId)) continue;
          record.matchedDurationMs = Math.max(0, (record.scheduledMs ?? now) - note.startMs);
          this._noteGates.delete(id); break;
        }
      } else if (record.type === 'clear' || record.type === 'sendAllNotesOff' || (record.type === 'controlChange' && [120, 123].includes(record.cc))) {
        for (const [id, note] of this._noteGates) {
          if (note.outputScope === record.outputScope && note.outputId === record.outputId && (record.channel == null || note.channel === record.channel)) this._noteGates.delete(id);
        }
      }
    }
    this._ring[(record.seq - 1) % this.capacity] = record;
    return record.seq;
  }

  getState() {
    if (this._active && this._nowMs() - this._startedMs >= this.maxDurationMs) this.stop('duration-limit');
    return { active: this._active, capacity: this.capacity, maxDurationMs: this.maxDurationMs,
      recorded: this._written, retained: Math.min(this._written, this.capacity), truncated: Math.max(0, this._written - this.capacity),
      lifecycleTruncated: this._lifecycleTruncated, observedOpenGates: this._noteGates.size,
      startedMs: this._startedMs, endedMs: this._endedMs, stopReason: this._stopReason };
  }

  snapshot() {
    const state = this.getState(), records = [];
    const first = Math.max(0, this._written - this.capacity);
    for (let index = first; index < this._written; index += 1) records.push(bounded(this._ring[index % this.capacity]));
    return { schemaVersion: 1, clock: 'monotonic milliseconds on the capture host',
      evidence: 'API dispatch and local synth scheduling; acoustic playback and physical device receipt are unverified',
      metadata: bounded(this._metadata), state, records };
  }

  toJSONL() {
    const snapshot = this.snapshot(), { records, ...header } = snapshot;
    return [JSON.stringify({ kind: 'midi-capture', ...header }), ...records.map(record => JSON.stringify(record))].join('\n') + '\n';
  }

  toCSV() { return serializeMidiCaptureCSV(this.snapshot()); }
}

const serializeMidiCaptureCSV = snapshot => [CSV_FIELDS.join(','), ...(snapshot.records || []).map(record => CSV_FIELDS.map(field => csvCell(record[field])).join(','))].join('\r\n') + '\r\n';
const createMidiOutputCapture = options => new MidiOutputCapture(options);
export { MidiOutputCapture, createMidiOutputCapture, serializeMidiCaptureCSV };
