const endOf = voice => voice.offTimeMs > voice.startedAt ? voice.offTimeMs : Infinity;

export function pendingReservationConflicts(voices, incoming, globalLimit, trackLimit = null) {
  const end = endOf(incoming), cancelled = new Set(), entries = [...voices];
  const scopes = [{ limit: globalLimit, matches: () => true }];
  if (incoming.trackId && trackLimit != null) scopes.push({ limit: trackLimit, matches: voice => voice.trackId === incoming.trackId });
  for (const { limit, matches } of scopes) {
    const events = [];
    for (const voice of entries) {
      if (voice.token === incoming.token || cancelled.has(voice.token) || !matches(voice)) continue;
      const start = Math.max(incoming.startedAt, voice.startedAt), stop = Math.min(end, endOf(voice));
      if (start >= stop) continue;
      events.push({ time: start, start: true, voice });
      if (Number.isFinite(stop)) events.push({ time: stop, start: false, voice });
    }
    events.sort((a, b) => a.time - b.time || Number(a.start) - Number(b.start) || a.voice.token - b.voice.token);
    const active = new Map();
    for (const event of events) {
      const voice = event.voice;
      if (cancelled.has(voice.token)) continue;
      if (event.start) active.set(voice.token, voice); else active.delete(voice.token);
      while (active.size + 1 > limit) {
        let victim = null;
        for (const candidate of active.values()) {
          if (candidate.hasStarted !== false) continue;
          if (!victim || candidate.startedAt < victim.startedAt || candidate.startedAt === victim.startedAt && candidate.token < victim.token) victim = candidate;
        }
        if (!victim) break;
        cancelled.add(victim.token); active.delete(victim.token);
      }
    }
  }
  return [...cancelled];
}
