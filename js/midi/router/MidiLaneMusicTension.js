import { sanitizeMidiEnsembleTension } from '../project/MidiEnsembleTension.js';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const chance = (lane, actor, sfx, tick) => {
  let value = Math.imul((actor | 0) ^ Math.imul((lane | 0) + 1, 374761393), 668265263);
  value = Math.imul(value ^ (sfx | 0) ^ (tick | 0), 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};
/** Cached arrangement policy driven exclusively by completed simulation ticks. */
class MidiLaneMusicTension {
  constructor(settings) { this.lanes = new Array(1024).fill(null); this.configure(settings); this.reset(); }
  configure(settings) {
    const config = sanitizeMidiEnsembleTension(settings), key = JSON.stringify(config);
    if (this.key !== key) { this.config = config; this.key = key; this.reset(); }
  }
  reset() { this.lanes.fill(null); this.generation = null; this.tick = null; }
  synchronize(generation, tick) {
    const changed = this.generation != null && (this.generation !== generation || Number.isFinite(tick) && tick < this.tick);
    if (changed) this.reset();
    this.generation = generation; this.tick = Number.isFinite(tick) ? tick : this.tick;
    return changed;
  }
  updateLane(laneIndex, signal, tick) {
    if (!this.config.enabled || !this.config.amount || !Number.isInteger(laneIndex) || laneIndex < 0 || laneIndex >= 1024 || !signal || !Number.isFinite(tick)) return null;
    let state = this.lanes[laneIndex];
    if (!state) state = this.lanes[laneIndex] = { tick, strength: 0, baseline: 0, established: false, healthyStart: null,
      recoveryUntil: -Infinity, collapseX: null, passedPreviousBest: false, reason: 'startup', alive: 0, soloActorId: null, survival: 1, lastNetTransfer: finite(signal.transferredIn) - finite(signal.transferredOut), lastDistance: finite(signal.bestDistance) };
    const settings = this.config, delta = Math.max(0, tick - state.tick);
    state.tick = tick; state.alive = Math.max(0, Math.trunc(finite(signal.alive)));
    state.soloActorId = Number.isInteger(signal.lowestSurvivingActorId) && signal.lowestSurvivingActorId >= 0 ? signal.lowestSurvivingActorId : null;
    const netTransfer = Math.max(0, finite(signal.transferredIn)) - Math.max(0, finite(signal.transferredOut));
    if (state.established) state.baseline = Math.max(0, state.baseline + netTransfer - state.lastNetTransfer);
    state.lastNetTransfer = netTransfer;
    const hasSuccessfulDepartures = Number.isFinite(signal.successfulDepartures);
    if (hasSuccessfulDepartures) {
      const departures = Math.max(0, signal.successfulDepartures);
      if (state.established) state.baseline = Math.max(0, state.baseline - departures + (state.lastSuccessfulDepartures ?? departures));
      state.lastSuccessfulDepartures = departures;
    }
    const admitted = finite(signal.admitted, finite(signal.spawned, state.alive));
    state.survival = hasSuccessfulDepartures && admitted <= 0 ? 1 : clamp(state.alive / Math.max(1, admitted), 0, 1);
    if (!state.established) {
      if (state.alive >= settings.healthyPopulation) {
        state.healthyStart ??= tick;
        if (tick - state.healthyStart >= settings.healthyTicks) { state.established = true; state.baseline = state.alive; }
      } else state.healthyStart = null;
    }
    let target = 0;
    if (state.established) {
      state.baseline = Math.max(state.baseline, state.alive);
      const ratio = hasSuccessfulDepartures && state.baseline <= 0 ? 1 : state.alive / Math.max(1, state.baseline), x = finite(signal.maxX);
      target = clamp((settings.recoveryRatio - ratio) / (settings.recoveryRatio - settings.collapseRatio), 0, 1);
      if (target > 0 && state.collapseX == null) state.collapseX = x;
      const previousBest = finite(signal.previousDistance);
      const personalBest = previousBest >= settings.breakthroughPixels && finite(signal.bestDistance) > previousBest && state.lastDistance <= previousBest && !state.passedPreviousBest;
      if (target > 0 && state.collapseX != null && (x - state.collapseX >= settings.breakthroughPixels || personalBest)) {
        state.recoveryUntil = tick + settings.breakthroughHoldTicks; state.collapseX = null;
        state.passedPreviousBest ||= personalBest; state.reason = personalBest ? 'previous-best' : 'progress-breakthrough';
      } else if (tick >= state.recoveryUntil) state.reason = target > 0 ? 'population-decline' : state.strength > 0 ? 'population-recovery' : 'steady';
      if (tick < state.recoveryUntil) target = 0;
      if (!target && tick >= state.recoveryUntil) state.collapseX = null;
    }
    const wanted = target * settings.amount;
    state.strength = clamp(state.strength + clamp(wanted - state.strength, -delta / settings.fadeTicks, delta / settings.fadeTicks), 0, settings.amount);
    state.lastDistance = finite(signal.bestDistance);
    return state;
  }
  decision(spec, meta, tick) {
    const state = this.lanes[meta.laneIndex ?? 0];
    if (!spec.ensembleRole || !this.config.enabled || !state?.established || state.strength <= 0) return { spec, state };
    if (state.soloActorId != null && meta.lemmingId === state.soloActorId) return { spec, state };
    if (state.strength >= 0.999999 || chance(meta.laneIndex, meta.lemmingId, meta.sfxId, tick) >= 1 - state.strength) return { spec: null, state };
    const gain = 1 - state.strength * 0.5;
    return { spec: { ...spec, velocity: Math.max(1, Math.round(spec.velocity * gain)),
      releaseVelocity: Math.max(1, Math.round((spec.releaseVelocity ?? spec.velocity) * gain)) }, state };
  }
  snapshot(laneIndex = 0) { const state = this.lanes[laneIndex]; return state ? { ...state } : null; }
}
export { MidiLaneMusicTension };
