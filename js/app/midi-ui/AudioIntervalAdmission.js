export const audioIntervalStorageBytes = maximum => (maximum * 2 + 2) * 18;

// Host-side admission reuses fixed scratch storage. The authoritative intervals
// remain on the existing voice records, including native and worklet tails.
export function createAudioIntervalAdmission({ maxIntervals = 128 } = {}) {
  if (!Number.isSafeInteger(maxIntervals) || maxIntervals < 1 || maxIntervals > 16383) throw new RangeError('Invalid audio interval index bound.');
  const maximum = maxIntervals * 2 + 2, times = new Float64Array(maximum), deltas = new Float64Array(maximum), order = new Uint16Array(maximum);
  const inspect = ({ voices, first, last, limit, cost = 0, mode = 'source', workload = null, overrides = null, semantic = false } = {}) => {
    if (!voices?.[Symbol.iterator] || !Number.isFinite(first) || first < 0 || !Number.isFinite(last) || last < first ||
        !Number.isSafeInteger(limit) || limit < 0 || limit > 65536 || !Number.isSafeInteger(cost) || cost < 0 || cost > 1024 ||
        !['source', 'gate'].includes(mode)) throw new TypeError('Invalid audio reservation interval.');
    if (first === last) return Object.freeze({ accepted: true, peak: 0, limit, first, last, intervals: 0, reason: null });
    let count = 0, intervals = 0;
    const add = (time, delta) => { times[count] = time; deltas[count] = delta; order[count] = count; count++; };
    for (const voice of voices) {
      if (workload && (voice.workloadClass || 'live') !== workload) continue;
      const change = overrides?.get(voice), start = voice.start, end = mode === 'gate' ? Math.min(change?.releaseAt ?? voice.releaseAt, voice.semanticRelease?.at ?? Infinity) : change?.end ?? voice.end;
      const units = semantic ? 1 : voice.renderCost || 1;
      if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || !Number.isSafeInteger(units) || units < 1 || units > 1024)
        return Object.freeze({ accepted: false, peak: null, limit, first, last, intervals, reason: 'unknown-source-interval' });
      if (end <= first || start >= last || end <= start) continue;
      if (++intervals > maxIntervals) return Object.freeze({ accepted: false, peak: null, limit, first, last, intervals, reason: 'interval-index-capacity' });
      add(Math.max(first, start), units); add(Math.min(last, end), -units);
    }
    order.subarray(0, count).sort((a, b) => times[a] - times[b] || deltas[a] - deltas[b] || a - b);
    let used = cost, peak = cost;
    for (let cursor = 0; cursor < count;) {
      const time = times[order[cursor]]; let delta = 0;
      do { delta += deltas[order[cursor++]]; } while (cursor < count && times[order[cursor]] === time);
      used += delta; if (time < last) peak = Math.max(peak, used);
    }
    return Object.freeze({ accepted: peak <= limit, peak, limit, first, last, intervals, reason: peak <= limit ? null : 'reserved-interval-capacity' });
  };
  return Object.freeze({ inspect, storageBytes: times.byteLength + deltas.byteLength + order.byteLength, maxIntervals });
}
