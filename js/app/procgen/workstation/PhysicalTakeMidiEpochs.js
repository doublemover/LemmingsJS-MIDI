import { createProcgenPhysicalScoreClock } from './ProcgenPhysicalScoreClock.js';
const segmentFields = ['epoch', 'simTickOrigin', 'scoreBeatOrigin', 'tickDurationMs', 'tempoBpm', 'discontinuityReason'];

export function physicalMidiEpochChoices(revoice) {
  const epochs = revoice?.finalBoundaryState?.timeline?.timeline?.epochs, initial = revoice?.boundary?.state?.timeline;
  if (!Array.isArray(epochs) || !epochs.length || epochs.length > 2048 || epochs.some(epoch => typeof epoch?.epoch !== 'string' || epoch.epoch.length > 512 || !Array.isArray(epoch.segments) || !epoch.segments.length)) throw new Error('Captured MIDI clock epochs are unavailable.');
  const first = initial ? epochs.findIndex(epoch => epoch.epoch === initial.timeline?.currentEpoch) : 0;
  if (first < 0) throw new Error('The captured initial clock epoch is absent from its final history.');
  return epochs.slice(first).map((epoch, index) => ({ epoch: epoch.epoch, index: first + index,
    originTick: index === 0 && initial ? initial.lastTick : epoch.segments[0].simTickOrigin,
    endTick: epochs[first + index + 1]?.segments[0].simTickOrigin ?? revoice.finalBoundaryState.timeline.lastTick }));
}

/** @param {Record<string, any>} revoice @param {string} [requestedEpoch]
 * @param {{signal?: AbortSignal, current?: () => boolean, yieldControl?: () => Promise<unknown>}} [controls] */
export async function selectPhysicalMidiEpoch(revoice, requestedEpoch, { signal, current = () => true, yieldControl = async () => {} } = {}) {
  if (!Array.isArray(revoice?.intents) || revoice.intents.length > 8192 || revoice.boundary?.status !== 'captured-initial-state' ||
      !Array.isArray(revoice.boundary.state?.voices) || revoice.boundary.state.voices.length || !Array.isArray(revoice.finalBoundaryState?.voices) || revoice.finalBoundaryState.voices.length)
    throw new Error('Clock epoch selection requires a bounded captured history with retained empty voice boundaries.');
  const guard = () => { signal?.throwIfAborted(); if (!current()) throw new Error('The captured MIDI epoch source changed.'); };
  guard();
  const clock = createProcgenPhysicalScoreClock(); clock.restore(revoice.finalBoundaryState.timeline);
  const saved = clock.snapshot(), choices = physicalMidiEpochChoices(revoice), initial = revoice.boundary.state.timeline;
  if (initial) {
    const before = createProcgenPhysicalScoreClock(); before.restore(initial);
    const prefix = before.snapshot();
    if (before.snapshot().worldId !== saved.worldId || initial.lastTick > saved.lastTick || initial.lastSourceTimeMs > saved.lastSourceTimeMs ||
        prefix.timeline.epochs.some((epoch, index) => epoch.epoch !== saved.timeline.epochs[index]?.epoch || epoch.segments.some((segment, at) => segmentFields.some(key => segment[key] !== saved.timeline.epochs[index].segments[at]?.[key]))))
      throw new Error('The captured initial clock is not a preserved prefix of its final history.');
  }
  if (requestedEpoch == null && choices.length > 1) throw Object.assign(new Error('Choose one captured clock epoch; independent score origins cannot be flattened into one file.'), { code: 'physical-midi-epoch-choice-required', epochs: choices });
  const selected = requestedEpoch == null ? choices[0] : choices.find(epoch => epoch.epoch === requestedEpoch);
  if (!selected) throw new Error('The selected MIDI clock epoch is outside this captured take.');
  const byEpoch = new Map(saved.timeline.epochs.map((epoch, index) => [epoch.epoch, index])), active = new Set(), identities = new Set(), sourceOrdinals = [];
  let previousEpoch = choices[0].index - 1, previousTime = -1;
  for (let index = 0; index < revoice.intents.length; index++) {
    const intent = revoice.intents[index], at = byEpoch.get(intent?.scoreTime?.epoch);
    if (!Number.isSafeInteger(at) || at < choices[0].index || at < previousEpoch || intent?.version !== 1 || !['begin', 'update', 'end'].includes(intent.kind) ||
        typeof intent.intentId !== 'string' || !intent.intentId || intent.intentId.length > 512 || identities.has(intent.intentId) || intent.worldId !== saved.worldId ||
        !Number.isSafeInteger(intent.generation) || intent.generation < 0 || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 512)
      throw new Error('Captured semantic identity or clock epoch order is malformed.');
    identities.add(intent.intentId);
    const time = intent.scoreTime, limit = saved.timeline.epochs[at + 1]?.segments[0].simTickOrigin ?? saved.lastTick, fraction = time.subTick ?? 0;
    const firstTick = at === choices[0].index ? choices[0].originTick : saved.timeline.epochs[at].segments[0].simTickOrigin;
    if (!Number.isSafeInteger(time.simTick) || time.simTick < firstTick || time.simTick > limit || !Number.isFinite(fraction) || fraction < 0 || fraction >= 1 || time.simTick === limit && fraction > 0 ||
        at === previousEpoch && time.simTick + fraction < previousTime) throw new Error('Captured semantic time is outside its clock epoch or reverses source order.');
    const mapped = clock.map(time);
    if (time.beat != null && (!Number.isFinite(time.beat) || Math.abs(time.beat - mapped.beat) > 1e-10 * Math.max(1, Math.abs(mapped.beat)))) throw new Error('Captured semantic score beat disagrees with its clock epoch.');
    if (at >= selected.index && previousEpoch < selected.index && active.size || at > selected.index && previousEpoch <= selected.index && active.size)
      throw new Error('A semantic note crosses the selected clock epoch boundary; no pickup or release was invented.');
    const key = JSON.stringify([intent.worldId, intent.generation, intent.voiceId]);
    if (intent.kind === 'begin') { if (active.has(key)) throw new Error('Repeated captured semantic onset.'); active.add(key); }
    else { if (!active.has(key)) throw new Error('Captured semantic update or release lacks its original onset.'); if (intent.kind === 'end') active.delete(key); }
    if (at === selected.index) sourceOrdinals.push(index);
    previousEpoch = at; previousTime = time.simTick + fraction;
    if (index % 128 === 127) { guard(); await yieldControl(); guard(); }
  }
  if (active.size) throw new Error('Captured semantic history ends with open voices.');
  guard();
  return { saved, selected, choices, sourceOrdinals,
    origin: { epoch: selected.epoch, simTick: selected.originTick }, end: { epoch: selected.epoch, simTick: selected.endTick } };
}
