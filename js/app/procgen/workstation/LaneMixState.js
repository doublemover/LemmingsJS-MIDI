export const formatLaneGain = gain => gain === 0 ? '−∞ dB' : `${(20 * Math.log10(gain)).toFixed(1)} dB`;
export const parseLaneGain = text => /^[-−](?:inf(?:inity)?|∞)$/i.test(text.trim()) ? 0 : 10 ** (Number(text) / 20);
export function createLaneMixState() {
  let source = null, revision = 0, states = new Map(); const events = new Map();
  const synchronize = lanes => {
    if (source === lanes) return false;
    if (!Array.isArray(lanes) || lanes.length > 1024 || new Set(lanes.map(lane => lane.id)).size !== lanes.length) throw new Error('Invalid lane mix collection.');
    const solo = lanes.some(lane => lane.solo && !lane.mute), next = new Map();
    for (const lane of lanes) {
      const gain = lane.gain ?? 1, pan = lane.pan ?? 0;
      if (typeof lane.id !== 'string' || !Number.isFinite(gain) || gain < 0 || gain > 2 || !Number.isFinite(pan) || pan < -127 || pan > 127) throw new Error('Invalid authored lane mix.');
      const suppressed = solo && !lane.solo, muted = !!lane.mute;
      next.set(lane.id, Object.freeze({ baseGain: gain, effectiveGain: muted || suppressed ? 0 : gain, pan: pan / 127,
        mute: muted, solo: !!lane.solo, soloSuppressed: suppressed, revision: revision + 1 }));
    }
    source = lanes; states = next; revision++; for (const id of events.keys()) if (!states.has(id)) events.delete(id); return true;
  };
  return { synchronize, revision: () => revision,
    mix(laneId) { const value = states.get(laneId); return value ? { gain: value.effectiveGain, pan: value.pan, revision, muted: value.mute, soloSuppressed: value.soloSuppressed } : null; },
    record(laneId, timeMs, status) { if (!states.has(laneId) || !Number.isFinite(timeMs)) return; const previous = events.get(laneId); events.set(laneId, { timeMs, count: previous && timeMs - previous.startMs <= 1000 ? previous.count + 1 : 1, startMs: previous && timeMs - previous.startMs <= 1000 ? previous.startMs : timeMs, status }); },
    view(laneId, { nowMs, connected = false } = {}) {
      const state = states.get(laneId); if (!state) return null; const event = events.get(laneId), age = event && Number.isFinite(nowMs) ? Math.max(0, nowMs - event.timeMs) : null;
      const eventRate = event && age < 1000 ? event.count / Math.max(1, (nowMs - event.startMs) / 1000) : 0;
      return Object.freeze({ ...state, localPeak: null, localRms: null, eventRate, meterSource: 'semantic-event-activity', signalStatus: 'unavailable', age,
        outputState: !connected ? 'output-disconnected' : state.mute ? 'self-muted' : state.soloSuppressed ? 'solo-suppressed' : state.baseGain === 0 ? 'zero-gain' : eventRate ? 'source-events' : 'no-source-events',
        gainEvidence: 'requested-lane-mix', lastAdmission: event?.status ?? null });
    } };
}
