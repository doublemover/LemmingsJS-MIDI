/**
 * Attach queued event envelope data to an MCP tool payload.
 * Minimal mode strips agent-originated events to reduce chatter.
 *
 * @param {any} session
 * @param {any} payload
 * @returns {any}
 */
const attachEvents = (session, payload) => {
  if (!session) return payload;
  if (!payload || typeof payload !== 'object') return payload;
  if (!session.events || typeof session.events.drain !== 'function') return payload;
  const mode = session.eventsMode || 'minimal';
  if (mode === 'none') return payload;

  const envelope = session.events.drain(undefined, {
    updateCursor: true,
    includeHumanSummary: mode !== 'none'
  });
  if (!envelope) return payload;

  if (mode === 'minimal') {
    envelope.events = (envelope.events || [])
      .filter((event) => event && event.source !== 'agent')
      .map((event) => ({
        source: event.source,
        type: event.type,
        tickIndex: event.tickIndex ?? null,
        summary: event.summary ?? null,
        ...(Array.isArray(event.resourceUris) && event.resourceUris.length
          ? { resourceUris: event.resourceUris }
          : {})
      }));
    if (!envelope.events.length) {
      delete envelope.events;
    }
    if (!envelope.humanSummary) {
      delete envelope.humanSummary;
    }
  }

  const hasEvents = Array.isArray(envelope.events) && envelope.events.length > 0;
  const hasSummary = typeof envelope.humanSummary === 'string' && envelope.humanSummary.length > 0;
  if (!hasEvents && !hasSummary) return payload;

  payload.events = envelope;
  return payload;
};

export { attachEvents };
