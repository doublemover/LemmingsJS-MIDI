export function futureMidiRatePeak(entries, { now, windowMs, scope } = {}) {
  const events = [];
  for (const entry of entries) {
    if (!entry.conservativeAllScopes && scope !== undefined && (scope !== null && typeof scope === 'object'
      ? entry.budgetScope !== scope.scope : entry.outputId !== scope)) continue;
    if (!Number.isFinite(entry.timeMs) || entry.timeMs < now - windowMs || !(entry.count > 0) || !(entry.bytes > 0)) continue;
    events.push(entry);
  }
  events.sort((a, b) => a.timeMs - b.timeMs);
  let first = 0, count = 0, bytes = 0, peakMessages = 0, peakBytes = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]; count += event.count; bytes += event.bytes;
    while (first <= index && events[first].timeMs < event.timeMs - windowMs) {
      count -= events[first].count; bytes -= events[first++].bytes;
    }
    if (event.timeMs < now) continue;
    peakMessages = Math.max(peakMessages, count); peakBytes = Math.max(peakBytes, bytes);
  }
  return { peakMessages, peakBytes };
}
