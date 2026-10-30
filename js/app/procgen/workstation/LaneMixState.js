import { procgenLane, procgenLaneCollectionChange } from './ProcgenProjectIndex.js';

export const formatLaneGain = gain => gain === 0 ? '−∞ dB' : `${(20 * Math.log10(gain)).toFixed(1)} dB`;
export const parseLaneGain = text => /^[-−](?:inf(?:inity)?|∞)$/i.test(text.trim()) ? 0 : 10 ** (Number(text) / 20);
export function createLaneMixState() {
  let source = null, revision = 0, states = new Map(), activeSolos = 0; const events = new Map();
  const stats = { fullBuilds: 0, incrementalBuilds: 0, skippedCollections: 0, stateVisits: 0, stateAllocations: 0 };
  const authored = lane => {
    const gain = lane.gain ?? 1, pan = lane.pan ?? 0;
    if (typeof lane.id !== 'string' || !Number.isFinite(gain) || gain < 0 || gain > 2 || !Number.isFinite(pan) || pan < -127 || pan > 127) throw new Error('Invalid authored lane mix.');
    return { baseGain: gain, pan: pan / 127, mute: !!lane.mute, solo: !!lane.solo };
  };
  const complete = (value, solo) => { const suppressed = solo && !value.solo; stats.stateAllocations++;
    return Object.freeze({ ...value, effectiveGain: value.mute || suppressed ? 0 : value.baseGain, soloSuppressed: suppressed, revision: revision + 1 }); };
  const synchronize = lanes => {
    if (source === lanes) return false;
    const change = source && procgenLaneCollectionChange(source, lanes);
    if (change && !change.structural) {
      if (!change.fields.some(field => ['gain', 'pan', 'mute', 'solo'].includes(field))) { source = lanes; stats.skippedCollections++; return false; }
      const updated = new Map(); let nextSolos = activeSolos;
      for (const id of change.laneIds) {
        const value = authored(procgenLane(lanes, id)), previous = states.get(id); stats.stateVisits++;
        nextSolos += Number(value.solo && !value.mute) - Number(previous.solo && !previous.mute); updated.set(id, value);
      }
      if (!!nextSolos === !!activeSolos) {
        for (const [id, value] of updated) states.set(id, complete(value, nextSolos > 0));
        source = lanes; activeSolos = nextSolos; revision++; stats.incrementalBuilds++; return true;
      }
    }
    if (!Array.isArray(lanes) || lanes.length > 1024 || new Set(lanes.map(lane => lane.id)).size !== lanes.length) throw new Error('Invalid lane mix collection.');
    const nextSolos = lanes.reduce((count, lane) => count + Number(!!lane.solo && !lane.mute), 0), next = new Map();
    for (const lane of lanes) {
      stats.stateVisits++; next.set(lane.id, complete(authored(lane), nextSolos > 0));
    }
    source = lanes; activeSolos = nextSolos; states = next; revision++; stats.fullBuilds++; for (const id of events.keys()) if (!states.has(id)) events.delete(id); return true;
  };
  return { synchronize, revision: () => revision, diagnostics: () => ({ ...stats, lanes: states.size, activeSolos, revision }),
    mix(laneId) { const value = states.get(laneId); return value ? { gain: value.effectiveGain, pan: value.pan, revision, muted: value.mute, soloSuppressed: value.soloSuppressed } : null; },
    record(laneId, timeMs, status) { if (!states.has(laneId) || !Number.isFinite(timeMs)) return; const previous = events.get(laneId); events.set(laneId, { timeMs, count: previous && timeMs - previous.startMs <= 1000 ? previous.count + 1 : 1, startMs: previous && timeMs - previous.startMs <= 1000 ? previous.startMs : timeMs, status }); },
    view(laneId, { nowMs, connected = false } = {}) {
      const state = states.get(laneId); if (!state) return null; const event = events.get(laneId), age = event && Number.isFinite(nowMs) ? Math.max(0, nowMs - event.timeMs) : null;
      const eventRate = event && age < 1000 ? event.count / Math.max(1, (nowMs - event.startMs) / 1000) : 0;
      return Object.freeze({ ...state, revision, localPeak: null, localRms: null, eventRate, meterSource: 'semantic-event-activity', signalStatus: 'unavailable', age,
        outputState: !connected ? 'output-disconnected' : state.mute ? 'self-muted' : state.soloSuppressed ? 'solo-suppressed' : state.baseGain === 0 ? 'zero-gain' : eventRate ? 'source-events' : 'no-source-events',
        gainEvidence: 'requested-lane-mix', lastAdmission: event?.status ?? null });
    } };
}
