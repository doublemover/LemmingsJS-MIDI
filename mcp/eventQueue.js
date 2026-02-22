import crypto from 'node:crypto';

const nowIso = () => new Date().toISOString();

const makeId = (bytes = 9) => crypto.randomBytes(bytes)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

class EventQueue {
  constructor({ maxEvents = 1000, idFactory = makeId, timeFactory = nowIso } = {}) {
    this.maxEvents = Math.max(1, Math.trunc(maxEvents) || 1);
    this.idFactory = typeof idFactory === 'function' ? idFactory : makeId;
    this.timeFactory = typeof timeFactory === 'function' ? timeFactory : nowIso;
    this.events = new Array(this.maxEvents);
    this.head = 0;
    this.size = 0;
    this.seq = 0;
    this.lastDelivered = 0;
    this.humanSummaryParts = [];
  }

  add({ source, type, summary, data, resourceUris, tickIndex } = {}) {
    const entry = {
      id: this.idFactory(),
      source,
      type,
      tickIndex: Number.isFinite(tickIndex) ? tickIndex : null,
      time: this.timeFactory(),
      summary: summary || '',
      data,
      resourceUris
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

    if (source === 'human' && summary) {
      this.humanSummaryParts.push(summary);
    }
    return entry;
  }

  drain(after, { updateCursor = true, includeHumanSummary = true } = {}) {
    if (this.size <= 0) return null;
    const afterSeq = Number.isFinite(Number(after)) ? Number(after) : this.lastDelivered;
    const oldest = this.events[this.head];
    const newest = this.events[(this.head + this.size - 1) % this.maxEvents];
    if (!oldest || !newest) return null;
    if (afterSeq >= newest.seq) return null;

    const startSeq = Math.max(afterSeq + 1, oldest.seq);
    const startOffset = Math.max(0, startSeq - oldest.seq);
    if (startOffset >= this.size) return null;

    const selected = [];
    for (let offset = startOffset; offset < this.size; offset += 1) {
      const event = this.events[(this.head + offset) % this.maxEvents];
      if (event) selected.push(event);
    }
    if (!selected.length) return null;

    const cursor = String(selected[selected.length - 1].seq);
    if (updateCursor) {
      this.lastDelivered = Number(cursor);
    }
    const payload = {
      cursor,
      events: selected.map(({ seq, ...rest }) => rest)
    };
    if (includeHumanSummary && this.humanSummaryParts.length) {
      payload.humanSummary = this.humanSummaryParts.join('; ');
      this.humanSummaryParts = [];
    }
    return payload;
  }
}

export { EventQueue };
