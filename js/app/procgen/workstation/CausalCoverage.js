import { cloneJournalData } from './CausalJournalCanonical.js';

const natural = value => Number.isSafeInteger(value) && value >= 0;
const overflowGap = gap => gap.reason === 'coverage-index-capacity' || gap.unknownSuffix === true;
const firstTick = gap => natural(gap.firstTick) ? gap.firstTick : natural(gap.tick) ? gap.tick : null;
const lastTick = gap => natural(gap.lastTick) ? gap.lastTick : firstTick(gap);
const applies = (gap, kind, generation) => (kind === '*' || gap.kind == null || gap.kind === 'all' || gap.kind === kind || gap.kind === 'physical-facts') &&
  (generation == null || gap.generation == null && !gap.generations || gap.generation === generation || gap.generations?.includes(generation));

export function queryCausalCoverage({ coverage, kind = '*', range, generation = null } = {}) {
  if (!natural(range?.firstTick) || !natural(range.lastTick) || range.lastTick < range.firstTick) throw new Error('A bounded causal coverage range is required.');
  const missingRanges = [], unknownRanges = [], source = coverage?.sourceRange;
  for (const gap of coverage?.gaps || []) {
    const first = firstTick(gap), last = lastTick(gap);
    // Legacy capacity markers did not extend when later evidence was lost.
    // Their entire suffix therefore remains unknown, across generations.
    if (overflowGap(gap)) {
      if (first == null || range.lastTick >= first) unknownRanges.push({ ...gap,
        firstTick: Math.max(range.firstTick, first ?? range.firstTick), lastTick: range.lastTick, unknownSuffix: true });
    } else if (applies(gap, kind, generation)) {
      if (first == null || last == null) unknownRanges.push({ ...gap, ...range });
      else if (first <= range.lastTick && last >= range.firstTick) missingRanges.push({ ...gap,
        firstTick: Math.max(range.firstTick, first), lastTick: Math.min(range.lastTick, last) });
    }
  }
  if (!natural(source?.firstTick) || !natural(source?.lastTick)) unknownRanges.push({ kind: 'source-coverage', reason: 'unknown-captured-range', ...range });
  else {
    if (range.firstTick < source.firstTick) missingRanges.push({ kind: 'source-coverage', reason: 'outside-captured-range',
      firstTick: range.firstTick, lastTick: Math.min(range.lastTick, source.firstTick - 1) });
    if (range.lastTick > source.lastTick) missingRanges.push({ kind: 'source-coverage', reason: 'outside-captured-range',
      firstTick: Math.max(range.firstTick, source.lastTick + 1), lastTick: range.lastTick });
  }
  return { status: unknownRanges.length ? 'unknown' : missingRanges.length ? 'known-missing' : 'known-covered', missingRanges, unknownRanges };
}

export function createCausalCoverageIndex({ gaps = [], maxEntries = 4096 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries > 4096) throw new Error('Invalid causal coverage index budget.');
  const groups = new Map(); let count = 0, overflow = null;
  const add = input => {
    const gap = cloneJournalData(input), first = firstTick(gap), last = lastTick(gap);
    if (first == null || last == null || last < first) throw new Error('Invalid causal coverage interval.');
    if (overflowGap(gap)) {
      overflow ||= { kind: 'all', reason: 'coverage-index-capacity', firstTick: first, lastTick: Number.MAX_SAFE_INTEGER,
        generation: null, unknownSuffix: true, throughTick: last };
      overflow.firstTick = Math.min(overflow.firstTick, first); overflow.throughTick = Math.max(overflow.throughTick, last);
      return;
    }
    const key = JSON.stringify([gap.kind, gap.reason, gap.generation ?? null, gap.worldId ?? null, gap.scope ?? null]);
    let intervals = groups.get(key);
    if (!intervals) intervals = [];
    let low = 0, high = intervals.length;
    while (low < high) { const middle = low + high >>> 1; if (intervals[middle].lastTick + 1 < first) low = middle + 1; else high = middle; }
    const merged = { ...gap, firstTick: first, lastTick: last }; let end = low;
    while (end < intervals.length && intervals[end].firstTick <= merged.lastTick + 1) {
      const previous = intervals[end++], overlaps = previous.lastTick >= merged.firstTick && previous.firstTick <= merged.lastTick;
      merged.firstTick = Math.min(merged.firstTick, previous.firstTick); merged.lastTick = Math.max(merged.lastTick, previous.lastTick);
      if (natural(previous.dropped) || natural(merged.dropped)) {
        merged.dropped = overlaps ? Math.max(previous.dropped || 0, merged.dropped || 0) : (previous.dropped || 0) + (merged.dropped || 0);
        if (overlaps) merged.droppedEvidence = 'lower-bound';
      }
      if (previous.droppedEvidence) merged.droppedEvidence = previous.droppedEvidence;
    }
    const removed = end - low;
    if (!removed && (overflow || count >= maxEntries - 1)) {
      overflow ||= { kind: 'all', reason: 'coverage-index-capacity', firstTick: first, lastTick: Number.MAX_SAFE_INTEGER,
        generation: null, unknownSuffix: true, throughTick: last };
      overflow.firstTick = Math.min(overflow.firstTick, first); overflow.throughTick = Math.max(overflow.throughTick, last); return;
    }
    intervals.splice(low, removed, merged); groups.set(key, intervals); count += 1 - removed;
  };
  for (const gap of gaps) add(firstTick(gap) == null ? { ...gap, firstTick: 0, lastTick: Number.MAX_SAFE_INTEGER, unknownSuffix: true } : gap);
  return { add, snapshot: () => [...groups.values()].flat().map(gap => ({ ...gap })).sort((a, b) => a.firstTick - b.firstTick || a.lastTick - b.lastTick)
    .concat(overflow ? [{ ...overflow }] : []), diagnostics: () => ({ entries: count + (overflow ? 1 : 0), groups: groups.size, truncated: !!overflow }) };
}
