import { organRotaryValues, measureOrganFormation, profileRegisteredWords } from './OrganRotaryProfileAdapter.js';
import { scaleMidiResolution } from '../protocol/MidiProtocolLowering.js';

export function createOrganRotaryPart({ routes, route, laneId, now, submit, getLane }) {
  const contributors = new Map(), observed = new Map(), original = new Map(), pickup = new Map(), queued = new Map(), submitted = new Map(), submittedAt = new Map(), listeners = new Set();
  let dirty = false, target = 0, lastSourceTarget = null, pending = 0, fault = null, suspended = false, formation = null, smoothed = null, sequence = 0;
  let selector = { bank: null, index: null, msb: null };
  const emit = () => { routes.notifyPerformanceChange?.(); for (const listener of listeners) { try { listener(); } catch {} } };
  const report = () => routes.profileControllerBaseline(route.grant, route.group, route.channel, route.organ.organ?.peerMuid ?? route.organ.rotary?.peerMuid);
  const allowed = new Set([...Array.from({ length: 15 }, (_, index) => '64:' + (48 + index)), '64:64', '64:65', ...Array.from({ length: 14 }, (_, index) => '96:' + (32 + index))]);
  const seed = report(); for (const [key, row] of Object.entries(seed)) { if (!allowed.has(key)) continue; const value = scaleMidiResolution(row.value, row.bits, 32); observed.set(key, { ...row, value, known: true }); original.set(key, { ...row, value }); }
  const remember = (key, value, bits = 32) => {
    if (!allowed.has(key) || observed.size >= 64 && !observed.has(key)) return;
    const previous = observed.get(key); if (previous?.value === value) return;
    observed.set(key, { value, bits, known: true, revision: ++sequence, completedHostMs: now() });
    pickup.set(key, { waiting: route.organ.policy.pickup && submitted.get(key) !== value, previous: null }); emit();
  };
  const input = routes.input.subscribe(event => {
    if (event.grant !== route.organInputGrant) return;
    if (event.event === 'ingress-loss') { selector = { bank: null, index: null, msb: null }; for (const [key, row] of observed) observed.set(key, { ...row, known: false }); emit(); return; }
    if (event.event !== 'native-packet' || !event.dispatchable || !routes.allowsOrdinaryInput()) return;
    const packet = event.packet; if (packet.group !== route.group || packet.channel !== route.channel) return;
    if (packet.kind === 'midi2-channel-voice' && packet.status === 'registeredController') { remember(packet.bank + ':' + packet.index, packet.controllerValue.value); return; }
    if (packet.kind !== 'midi1-channel-voice' || packet.status !== 'controlChange') return;
    const [controller, value] = packet.data;
    if (controller === 101 || controller === 100) { selector[controller === 101 ? 'bank' : 'index'] = value; selector.msb = null; }
    else if (controller === 99 || controller === 98) selector = { bank: null, index: null, msb: null };
    else if (controller === 6) selector.msb = value;
    else if (controller === 38 && selector.bank != null && selector.index != null && selector.msb != null && !(selector.bank === 127 && selector.index === 127)) remember(selector.bank + ':' + selector.index, scaleMidiResolution(selector.msb * 128 + value, 14, 32), 14);
    else if ([96, 97].includes(controller)) { const key = selector.bank + ':' + selector.index; if (observed.has(key)) observed.set(key, { ...observed.get(key), known: false, revision: ++sequence }); selector.msb = null; emit(); }
  });
  const touch = (voiceId, intent, cause, deadline) => {
    const previous = contributors.get(voiceId) || { actorId: intent.actorId, representedCount: intent.swarm?.sourceCount ?? 0, position: null, velocity: null, tick: null };
    const values = cause?.evidence === 'completed-world-fact' ? cause.values : null, x = values?.positionXWorldPixels?.value, y = values?.positionYWorldPixels?.value, dx = values?.displacementXWorldPixels?.value, dy = values?.displacementYWorldPixels?.value, dt = intent.scoreTime?.sourceTickDurationMs / 1000, tick = intent.scoreTime?.simTick;
    const position = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : previous.position;
    const velocity = Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dt) && dt > 0 ? { x: dx / dt + (previous.tick === tick ? previous.velocity?.x || 0 : 0), y: dy / dt + (previous.tick === tick ? previous.velocity?.y || 0 : 0) } : previous.velocity;
    contributors.set(voiceId, { actorId: intent.actorId ?? previous.actorId, representedCount: intent.swarm?.sourceCount ?? previous.representedCount, position, velocity, tick: values ? tick : previous.tick });
    target = Math.max(target, deadline); dirty = true;
  };
  const prepare = lane => {
    if (fault || suspended || !routes.allowsPerformance(route.grant)) return { words: [], values: {} };
    const requested = organRotaryValues(route.organ, lane.organControls || {}, smoothed || {}), words = [], values = {};
    for (const [key, value] of Object.entries(requested)) {
      if (queued.get(key) === value) continue;
      const baseline = observed.get(key), handover = pickup.get(key) || { waiting: route.organ.policy.pickup, previous: null };
      const [bank, index] = key.split(':').map(Number), manual = bank === 64 && index >= 48 && index <= 56 ? lane.organControls?.drawbars != null : bank === 96 && index === 32 ? lane.organControls?.rotaryFast != null : true;
      if (handover.waiting && !manual) {
        if (!baseline?.known || Math.abs(value - baseline.value) > Math.max(route.organ.policy.deadband01 * 0xffffffff, 1) && !(handover.previous != null && (handover.previous - baseline.value) * (value - baseline.value) <= 0)) { handover.previous = value; pickup.set(key, handover); continue; }
        handover.waiting = false; pickup.set(key, handover);
      }
      if (!original.has(key) && baseline?.known) original.set(key, { ...baseline });
      words.push(...profileRegisteredWords(route, bank, index, value)); values[key] = value;
    }
    return { words, values };
  };
  const track = (plan, completion) => {
    for (const [key, value] of Object.entries(plan.values)) queued.set(key, value); pending++;
    Promise.resolve(completion).then(receipt => {
      pending--; if (receipt.kind === 'driver-submitted') for (const [key, value] of Object.entries(plan.values)) { submitted.set(key, value); submittedAt.set(key, now()); }
      else fault = receipt.reason || 'organ-registration-submission-unconfirmed'; emit();
    }, error => { pending--; fault = error.message; emit(); });
  };
  const queue = (plan, provenance, deadline) => {
    if (!plan.words.length) return { status: 'accepted', stage: 'semantic-observation' };
    const accepted = submit(plan.words, provenance, deadline);
    if (accepted.status === 'accepted') track(plan, accepted.completion); else fault = accepted.reason;
    return accepted;
  };
  return Object.freeze({
    touch, prepare, track, canPerform: () => !fault && !suspended, pendingCount: () => pending,
    remove(voiceId, deadline) { if (!contributors.delete(voiceId)) return; target = Math.max(target, deadline); dirty = true; },
    flush(batch) {
      if (!dirty || suspended || fault) return; dirty = false; formation = measureOrganFormation(contributors, batch.tick);
      const elapsed = lastSourceTarget == null ? null : Math.max(0, (target - lastSourceTarget) / 1000), alpha = !route.organ.policy.smoothingMs || elapsed == null ? 1 : -Math.expm1(-elapsed / route.organ.policy.smoothingMs);
      smoothed = { density01: smoothed ? smoothed.density01 + (formation.density01 - smoothed.density01) * alpha : formation.density01,
        circulationRadiansPerSecond: formation.circulationRadiansPerSecond == null ? null : smoothed?.circulationRadiansPerSecond == null ? formation.circulationRadiansPerSecond : smoothed.circulationRadiansPerSecond + (formation.circulationRadiansPerSecond - smoothed.circulationRadiansPerSecond) * alpha };
      lastSourceTarget = target; const lane = getLane(); if (!lane) return;
      queue(prepare(lane), Object.freeze({ schema: 'lemmings-native-organ-physical-controls/v1', laneId, outputId: route.outputId, connectionEpoch: route.connectionEpoch, routeRevision: route.routeRevision,
        worldId: batch.worldId, generation: batch.generation, sourceBatchId: batch.batchId, sourceTick: batch.tick, formation, smoothed, sourceAuthority: 'completed-physical-actor-facts-no-generated-onsets' }), target);
    },
    synchronize() {
      if (suspended || fault) return; const lane = getLane(); if (!lane) return;
      queue(prepare(lane), Object.freeze({ schema: 'lemmings-native-organ-part-controls/v1', laneId, outputId: route.outputId, connectionEpoch: route.connectionEpoch, routeRevision: route.routeRevision,
        controls: lane.organControls, observedHostMs: now() }), Math.round((now() + 10) * 1000));
    },
    async restore() {
      if (contributors.size || pending || fault || suspended) throw new Error('Stop this part’s owned voices and wait for native submissions before restoring its registration');
      const current = report(), values = {}, words = [], skipped = [];
      for (const [key, value] of submitted) {
        const before = original.get(key), after = current[key];
        if (!before || !after || after.completedHostMs < submittedAt.get(key) || scaleMidiResolution(value, 32, after.bits) !== after.value) { skipped.push(key); continue; }
        const [bank, index] = key.split(':').map(Number); values[key] = before.value; words.push(...profileRegisteredWords(route, bank, index, before.value));
      }
      if (!words.length) return Object.freeze({ status: 'unknown', reason: 'Read isolated current controller values; only unchanged app-owned settings with an observed original can be restored', skipped: Object.freeze(skipped) });
      const accepted = queue({ words, values }, Object.freeze({ schema: 'lemmings-native-organ-registration-restore/v1', laneId, outputId: route.outputId, restored: Object.freeze(Object.keys(values)), skipped: Object.freeze(skipped), ownership: 'observed-original-and-fresh-matching-current-only' }), Math.round((now() + 10) * 1000));
      if (accepted.status !== 'accepted') throw new Error(accepted.reason);
      const receipt = await accepted.completion; if (receipt.kind !== 'driver-submitted') throw new Error(receipt.reason || 'Registration restore is unconfirmed');
      suspended = true; emit(); return Object.freeze({ status: skipped.length ? 'partial' : 'submitted', receipt, skipped: Object.freeze(skipped), receiverState: 'unknown', reactivation: 'explicit-profile-rebind-required' });
    },
    state: () => Object.freeze({ laneId, outputId: route.outputId, grant: route.grant, pending, fault, suspended, contributors: contributors.size, formation, queued: Object.freeze(Object.fromEntries(queued)), submitted: Object.freeze(Object.fromEntries(submitted)),
      observed: Object.freeze(Object.fromEntries(observed)), observedOriginals: original.size, qualification: route.organ.qualification }),
    dispose() { input(); contributors.clear(); listeners.clear(); }
  });
}
