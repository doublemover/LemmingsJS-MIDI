import crypto from 'node:crypto';

const nowIso = () => new Date().toISOString();
const DEFAULT_MAX_EVENTS = 1000;
const MAX_MAX_EVENTS = 10000;
const DEFAULT_MAX_HUMAN_SUMMARY_PARTS = 24;
const MIN_HUMAN_SUMMARY_PARTS = 0;
const MAX_HUMAN_SUMMARY_PARTS = 2048;

/**
 * Normalize capacity-like inputs to stable integer bounds.
 */
const normalizeCapacity = (value, fallback, min = 0) => {
  const numeric = Number(value);
  const candidate = Number.isFinite(numeric) ? Math.trunc(numeric) : NaN;
  if (!Number.isFinite(candidate) || candidate < min) return fallback;
  return candidate;
};

const makeId = (bytes = 9) => crypto.randomBytes(bytes)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

/**
 * Clone event payloads so queue entries stay immutable from caller mutations.
 */
const cloneEventValueFallback = (value, seen = new WeakMap()) => {
  if (value == null || typeof value !== 'object') return value;
  if (typeof value === 'function') return value;
  if (seen.has(value)) return seen.get(value);

  if (Buffer.isBuffer(value)) {
    const copy = Buffer.from(value);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof DataView) {
    const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    const copy = new DataView(buffer);
    seen.set(value, copy);
    return copy;
  }
  if (ArrayBuffer.isView(value)) {
    const copy = new value.constructor(value);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [entryKey, entryValue] of value.entries()) {
      copy.set(
        cloneEventValueFallback(entryKey, seen),
        cloneEventValueFallback(entryValue, seen)
      );
    }
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const entry of value.values()) {
      copy.add(cloneEventValueFallback(entry, seen));
    }
    return copy;
  }
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    seen.set(value, copy);
    for (let i = 0; i < value.length; i += 1) {
      copy[i] = cloneEventValueFallback(value[i], seen);
    }
    return copy;
  }

  const copy = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = cloneEventValueFallback(value[key], seen);
  }
  return copy;
};

/**
 * Clone event payloads so queue entries stay immutable from caller mutations.
 */
const cloneEventValue = (value) => {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    try {
      return cloneEventValueFallback(value);
    } catch {
      return null;
    }
  }
};

class EventQueue {
  /**
   * @param {Object} options
   * @param {number} [options.maxEvents=1000] - Maximum number of events retained in the queue.
   * @param {number} [options.maxHumanSummaryParts=24] - Max human summary segments retained.
   * @param {() => string} [options.idFactory=makeId] - Unique id factory for event entries.
   * @param {() => string} [options.timeFactory=nowIso] - Timestamp factory for event entries.
   */
  constructor({
    maxEvents = DEFAULT_MAX_EVENTS,
    maxHumanSummaryParts = DEFAULT_MAX_HUMAN_SUMMARY_PARTS,
    idFactory = makeId,
    timeFactory = nowIso
  } = {}) {
    this.maxEvents = Math.min(
      MAX_MAX_EVENTS,
      Math.max(1, normalizeCapacity(maxEvents, DEFAULT_MAX_EVENTS, 1))
    );
    this.idFactory = typeof idFactory === 'function' ? idFactory : makeId;
    this.timeFactory = typeof timeFactory === 'function' ? timeFactory : nowIso;
    this.events = new Array(this.maxEvents);
    this.head = 0;
    this.size = 0;
    this.seq = 0;
    this.lastDelivered = 0;
    // Ring-buffer over summary segments to avoid O(n) shift churn under chatty input.
    this.humanSummaryParts = [];
    this.humanSummaryStart = 0;
    this.maxHumanSummaryParts = Math.min(
      MAX_HUMAN_SUMMARY_PARTS,
      normalizeCapacity(
        maxHumanSummaryParts,
        DEFAULT_MAX_HUMAN_SUMMARY_PARTS,
        MIN_HUMAN_SUMMARY_PARTS
      )
    );
  }

  /**
   * Add a new event to the queue and keep snapshots of mutable payloads.
   * @param {object} entry
   * @param {string} entry.source
   * @param {string} entry.type
   * @param {string} [entry.summary]
   * @param {*} [entry.data]
   * @param {string[]} [entry.resourceUris]
   * @param {number} [entry.tickIndex]
   * @returns {object}
   */
  add({ source, type, summary, data, resourceUris, tickIndex } = {}) {
    const eventData = cloneEventValue(data);
    const eventResourceUris = Array.isArray(resourceUris) ? resourceUris.slice() : resourceUris;
    const entry = {
      id: this.idFactory(),
      source,
      type,
      tickIndex: Number.isFinite(tickIndex) ? tickIndex : null,
      time: this.timeFactory(),
      summary: summary || '',
      data: eventData,
      resourceUris: eventResourceUris
    };
    this.seq += 1;
    entry.seq = this.seq;

    let index;
    if (this.size < this.maxEvents) {
      index = (this.head + this.size) % this.maxEvents;
      this.size += 1;
    } else {
      index = this.head;
      this.head = (this.head + 1) % this.maxEvents;
    }
    this.events[index] = entry;

    const summaryCap = Math.min(
      MAX_HUMAN_SUMMARY_PARTS,
      normalizeCapacity(
        this.maxHumanSummaryParts,
        DEFAULT_MAX_HUMAN_SUMMARY_PARTS,
        MIN_HUMAN_SUMMARY_PARTS
      )
    );
    this.maxHumanSummaryParts = summaryCap;
    if (summaryCap <= 0 && this.humanSummaryParts.length) {
      this.humanSummaryParts.length = 0;
      this.humanSummaryStart = 0;
    }

    if (source === 'human' && summary) {
      if (summaryCap <= 0) {
        return entry;
      }
      if (this.humanSummaryParts.length > summaryCap) {
        if (this.humanSummaryStart === 0) {
          this.humanSummaryParts = this.humanSummaryParts.slice(-summaryCap);
        } else {
          const ordered = new Array(this.humanSummaryParts.length);
          for (let i = 0; i < this.humanSummaryParts.length; i += 1) {
            ordered[i] = this.humanSummaryParts[
              (this.humanSummaryStart + i) % this.humanSummaryParts.length
            ];
          }
          this.humanSummaryParts = ordered.slice(-summaryCap);
        }
        this.humanSummaryStart = 0;
      }
      if (this.humanSummaryParts.length < summaryCap) {
        this.humanSummaryParts.push(summary);
      } else {
        this.humanSummaryParts[this.humanSummaryStart] = summary;
        this.humanSummaryStart = (this.humanSummaryStart + 1) % summaryCap;
      }
    }
    return entry;
  }

  /**
   * Drain queued events newer than `after` into a transport envelope.
   * @param {string|number|undefined} after
   * @param {object} [options]
   * @param {boolean} [options.updateCursor=true] - Whether to advance last delivered cursor.
   * @param {boolean} [options.includeHumanSummary=true] - Whether to include human summary.
   * @returns {{cursor:string,events:object[],humanSummary?:string}|null}
   */
  drain(after, { updateCursor = true, includeHumanSummary = true } = {}) {
    if (this.size <= 0) return null;
    const parsedAfter = Number(after);
    const afterSeq = Number.isFinite(parsedAfter) ? Math.trunc(parsedAfter) : this.lastDelivered;
    const oldest = this.events[this.head];
    const newest = this.events[(this.head + this.size - 1) % this.maxEvents];
    if (!oldest || !newest) return null;
    if (afterSeq >= newest.seq) return null;

    const startSeq = Math.max(afterSeq + 1, oldest.seq);
    const startOffset = Math.max(0, startSeq - oldest.seq);
    if (startOffset >= this.size) return null;

    const events = [];
    let cursorSeq = afterSeq;
    for (let offset = startOffset; offset < this.size; offset += 1) {
      const event = this.events[(this.head + offset) % this.maxEvents];
      if (!event) continue;
      cursorSeq = event.seq;
      const { seq, ...rest } = event;
      events.push(rest);
    }
    if (!events.length) return null;

    const cursor = String(cursorSeq);
    if (updateCursor) {
      this.lastDelivered = Number(cursor);
    }
    const payload = {
      cursor,
      events
    };
    if (includeHumanSummary && this.humanSummaryParts.length) {
      if (this.humanSummaryStart === 0) {
        payload.humanSummary = this.humanSummaryParts.join('; ');
      } else {
        const ordered = new Array(this.humanSummaryParts.length);
        for (let i = 0; i < this.humanSummaryParts.length; i += 1) {
          ordered[i] = this.humanSummaryParts[
            (this.humanSummaryStart + i) % this.humanSummaryParts.length
          ];
        }
        payload.humanSummary = ordered.join('; ');
      }
      if (updateCursor) {
        this.humanSummaryParts.length = 0;
        this.humanSummaryStart = 0;
      }
    }
    return payload;
  }
}

export { EventQueue };
