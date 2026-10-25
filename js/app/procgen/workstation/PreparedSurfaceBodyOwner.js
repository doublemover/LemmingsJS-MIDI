import { preparedBodyIdentity, validateMappedBodyPreparation, projectPreparedSurfacePoint } from '../../../midi/content/PreparedSurface.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

export function createPreparedSurfaceBodyOwner({ documentEpoch, inventory, apply, panicBody, toFrame, onReceipt = () => {}, resourceBudget = null }) {
  if (typeof documentEpoch !== 'string' || !documentEpoch || documentEpoch.length > 200 || typeof inventory !== 'function' || typeof apply !== 'function' || typeof panicBody !== 'function' || typeof toFrame !== 'function') throw new TypeError('Prepared surfaces require the existing owned body inventory and shared audio clock.');
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: documentEpoch + ':prepared-surfaces', kind: 'prepared-body-contact-bindings-and-ledgers-estimate', category: 'audio', bytes: 4 * 1048576 });
  const bodies = new Map(), active = new Map(), bindings = new Map(), seen = new Set(), seenOrder = [], ended = new Set(), endedOrder = [], closedContacts = new Set(), closedOrder = [];
  let disposed = false, blocked = null, serial = 0, lastTick = -1, lastSequence = -1, execution = null, worldId = null, generation = null;
  const report = receipt => { const value = Object.freeze({ ...receipt, acousticReceipt: false, appliedFrame: null }); try { onReceipt(value); } catch {} return value; };
  const sourceKey = command => JSON.stringify([command.worldId, command.generation, command.contactSpanId, command.surfaceId, command.mapId, command.mapRevision, command.mappingId, command.mappingRevision, command.preparationSlot, command.kind, command.lossMaskId ?? null]);
  const contactKey = command => JSON.stringify([command.actorId, command.contactSpanId]);
  const targetKey = body => JSON.stringify([body.owner, body.ownerGeneration, body.ownerRouteRevision, body.graphDefinitionHash, body.nodeId]);
  const expected = body => ({ ownerRouteRevision: body.ownerRouteRevision, graphDefinitionHash: body.graphDefinitionHash });
  const maskAmount = (bodyInstanceId, lossMaskId, skip = null, candidate = null) => { let amount = candidate?.amount01 ?? 0; for (const [key, binding] of bindings) if (key !== skip && binding.bodyInstanceId === bodyInstanceId && binding.kind === 'mode-loss' && binding.lossMaskId === lossMaskId) amount = Math.max(amount, binding.amount01); return amount; };
  const maskRelease = (body, binding, key) => { const before = maskAmount(body.identity.bodyInstanceId, binding.lossMaskId), after = maskAmount(body.identity.bodyInstanceId, binding.lossMaskId, key); return before === after ? null : { ['modeLoss' + binding.slot + 'Amount01']: after }; };
  const prune = () => {
    const targets = inventory(), available = new Map(targets.map(target => [targetKey(target), target]));
    for (const body of bodies.values()) { const target = available.get(targetKey(body.identity)); body.active = active.get(body.identity.surfaceId) === body.identity.bodyInstanceId && target?.active === true; body.quarantined ||= target?.quarantined === true; }
    for (const [id, body] of bodies) if (!available.has(targetKey(body.identity))) {
      bodies.delete(id); if (active.get(body.identity.surfaceId) === id) active.delete(body.identity.surfaceId);
      for (const [key, binding] of bindings) if (binding.bodyInstanceId === id) bindings.delete(key);
    }
  };
  const failBody = (body, error) => {
    body.quarantined = true; try { panicBody(body.identity.nodeId, expected(body.identity)); } catch {}
    return report({ status: 'rejected', stage: 'prepared-body-control-unknown', bodyInstanceId: body.identity.bodyInstanceId, reason: error.code || error.message, ownership: 'binding-metadata-retained-until-body-retirement' });
  };
  const submit = (body, values, targetFrame, command) => {
    const version = serial, receipt = apply(body.identity.nodeId, values, targetFrame, expected(body.identity), command);
    if (serial !== version) throw Object.assign(new Error('Prepared body ownership changed during submission.'), { code: 'stale-prepared-body' });
    if (receipt?.status !== 'accepted' || receipt.graphDefinitionHash !== body.identity.graphDefinitionHash || receipt.targetFrame !== targetFrame) throw new Error('The exact prepared body did not acknowledge native control submission.');
    return receipt;
  };
  const bind = async ({ surfaceId, surfaceRevision, surfaceMap, nodeId = 'skin', preparationKinds = null, lossMaskIds = null, executionEpoch, worldId: boundWorld, generation: boundGeneration, expected: route }) => {
    if (disposed || blocked) throw blocked || new Error('Prepared surface bindings have retired.'); prune(); const request = ++serial;
    if (execution !== null && (execution !== executionEpoch || worldId !== boundWorld || generation !== boundGeneration)) throw new Error('Retire the previous prepared execution before binding another.');
    const target = inventory().find(body => body.active && body.nodeId === nodeId && body.ownerRouteRevision === route?.ownerRouteRevision && body.graphDefinitionHash === route.graphDefinitionHash);
    if (!target || target.quarantined) throw new Error('The exact prepared body is unavailable or its retained-body limit is full.');
    const capabilities = target.preparationKinds || ['touch', 'pickup-left', 'pickup-right'];
    if (preparationKinds && (!Array.isArray(preparationKinds) || preparationKinds.some(kind => !capabilities.includes(kind)))) throw new Error('This actual body does not expose the mapped preparation kind.');
    if (lossMaskIds && (!Array.isArray(lossMaskIds) || lossMaskIds.some(id => !target.lossMasks?.some(mask => mask.id === id)))) throw new Error('This actual body does not expose the mapped authored loss mask.');
    const identity = await preparedBodyIdentity({ documentEpoch, executionEpoch, worldId: boundWorld, generation: boundGeneration, surfaceId, surfaceRevision, surfaceMap,
      owner: target.owner, ownerGeneration: target.ownerGeneration, ownerRouteRevision: target.ownerRouteRevision, graphDefinitionHash: target.graphDefinitionHash, nodeId, processorRevision: target.processorRevision });
    const currentTarget = inventory().find(body => body.active && targetKey(body) === targetKey(identity));
    if (disposed || serial !== request || !currentTarget) throw new Error('A later body preparation superseded this binding.');
    if (bodies.has(identity.bodyInstanceId)) return bodies.get(identity.bodyInstanceId).identity;
    if (currentTarget.lossMasks?.some(mask => mask.target01 !== 0 || mask.pendingFuture)) throw new Error('Release the authored manual mode-loss controls and finish future manual automation before assigning physical contact owners.');
    if (Object.values(currentTarget.pickupGrid?.controls || {}).some(control => control.pendingFuture)) throw new Error('Finish future manual pickup automation before assigning observed contact owners.');
    if ([...bodies.values()].some(body => targetKey(body.identity) === targetKey(identity))) throw new Error('Prepare a separate body revision before assigning this node to another surface or map.');
    if (bodies.size >= 8) throw new Error('The retained prepared-body limit is full.');
    const previous = active.get(surfaceId); if (previous && bodies.has(previous)) bodies.get(previous).active = false;
    bodies.set(identity.bodyInstanceId, { identity, active: true, quarantined: false, preparationKinds: [...capabilities], pickupFieldId: currentTarget.pickupGrid?.id || null, lossMasks: (currentTarget.lossMasks || []).map(({ id, index }) => ({ id, index })) }); active.set(surfaceId, identity.bodyInstanceId); execution = executionEpoch; worldId = boundWorld; generation = boundGeneration;
    return identity;
  };
  const consume = (raw, executionEpoch) => {
    if (disposed || blocked) return report({ status: 'rejected', stage: 'prepared-body-control', reason: 'owner-retired' }); prune();
    let command; try { command = validateMappedBodyPreparation(raw); } catch (error) { return report({ status: 'rejected', stage: 'prepared-body-control', reason: error.message }); }
    const base = { commandId: command.commandId, sourceEventIds: command.sourceEventIds, sourceTick: command.sourceTick, sourceSequence: command.sourceSequence, contactSpanId: command.contactSpanId, mappingId: command.mappingId, preparationSlot: command.preparationSlot, kind: command.kind, ...(command.lossMaskId ? { lossMaskId: command.lossMaskId } : {}) };
    const reject = reason => report({ ...base, status: 'rejected', stage: 'prepared-body-control', reason });
    if (seen.has(command.commandId)) return reject('duplicate-command');
    if (executionEpoch !== execution || command.worldId !== worldId || command.generation !== generation) return reject('foreign-body-execution');
    if (command.sourceTick < lastTick || command.sourceSequence < lastSequence) return reject('stale-source-command');
    const key = sourceKey(command), held = bindings.get(key);
    if (command.operation !== 'end' && closedContacts.has(contactKey(command))) return reject('physical-contact-already-ended');
    if (command.operation === 'end' && ['ContactSpanEnded', 'ActorTerminated'].includes(command.sourceKind)) {
      let frame; try { frame = toFrame(command.scoreTime, executionEpoch, true); } catch {} if (!Number.isSafeInteger(frame) || frame < 0) return reject('shared-audio-clock-unavailable');
      let released = 0, remaining = 0;
      for (const [bindingKey, binding] of bindings) if (binding.actorId === command.actorId && (command.sourceKind === 'ActorTerminated' || binding.contactSpanId === command.contactSpanId)) {
        const body = bodies.get(binding.bodyInstanceId);
        try { const values = body && (binding.kind === 'touch' ? { ['touch' + binding.slot + 'Amount01']: 0 } : binding.kind === 'mode-loss' ? maskRelease(body, binding, bindingKey) : null); if (values) submit(body, values, frame, command); bindings.delete(bindingKey); ended.add(bindingKey); endedOrder.push(bindingKey); released++; }
        catch (error) { remaining++; if (error.code !== 'stale-prepared-body') failBody(body, error); }
        const closedKey = JSON.stringify([binding.actorId, binding.contactSpanId]); if (!closedContacts.has(closedKey)) { closedContacts.add(closedKey); closedOrder.push(closedKey); }
      }
      const closedKey = contactKey(command); if (!closedContacts.has(closedKey)) { closedContacts.add(closedKey); closedOrder.push(closedKey); }
      while (closedOrder.length > 256) closedContacts.delete(closedOrder.shift()); while (endedOrder.length > 256) ended.delete(endedOrder.shift());
      lastTick = command.sourceTick; lastSequence = command.sourceSequence; seen.add(command.commandId); seenOrder.push(command.commandId); if (seenOrder.length > 256) seen.delete(seenOrder.shift());
      return report({ ...base, status: remaining ? 'rejected' : 'accepted', stage: remaining ? 'prepared-contact-awaiting-body-retirement' : 'prepared-contact-closure-submitted', releasedBindings: released, retainedBindings: remaining, targetFrame: frame, sourceCardinality: 'preparation-command;zero-musical-onsets' });
    }
    if (!held && command.operation !== 'end' && (ended.has(key) || command.operation === 'update' && command.beginPolicy !== 'current-observed-contact')) return reject('held-contact-binding-unavailable');
    if (command.operation === 'begin' && held) return reject('contact-already-bound');
    const body = bodies.get(held?.bodyInstanceId ?? active.get(command.surfaceId)), identity = body?.identity;
    if (!body || body.quarantined || !held && command.operation !== 'end' && !body.active) return reject('prepared-body-unavailable');
    if (!body.preparationKinds.includes(command.kind)) return reject('body-preparation-kind-unavailable');
    if (identity.surfaceId !== command.surfaceId || identity.surfaceRevision !== command.mappingRevision || identity.surfaceMap.id !== command.mapId || identity.surfaceMap.revision !== command.mapRevision ||
        identity.surfaceMap.sourceEditRevision !== command.sourceEditRevision || identity.surfaceMap.boundTopologyRevision !== command.boundTopologyRevision || held && (held.actorId !== command.actorId || held.mappingRevision !== command.mappingRevision)) return reject('stale-surface-map-or-contact-owner');
    let targetFrame, position, slot = held?.slot, values;
    try {
      targetFrame = toFrame(command.scoreTime, executionEpoch, command.operation === 'end'); if (!Number.isSafeInteger(targetFrame) || targetFrame < 0) return reject('shared-audio-clock-unavailable');
      if (command.operation === 'end' && !held) values = null;
      else if (command.kind === 'touch') {
        if (slot == null) { const occupied = new Set([...bindings.values()].filter(binding => binding.bodyInstanceId === identity.bodyInstanceId && binding.kind === 'touch').map(binding => binding.slot)); slot = [0, 1, 2, 3].find(value => !occupied.has(value)); if (slot == null || bindings.size >= 32) return reject('touch-slot-capacity'); }
        if (command.operation === 'end') values = { ['touch' + slot + 'Amount01']: 0 };
        else { position = projectPreparedSurfacePoint(identity.surfaceMap, command.position); values = { ['touch' + slot + 'X01']: position.x01, ['touch' + slot + 'Y01']: position.y01, ['touch' + slot + 'Radius01']: command.radius01, ['touch' + slot + 'Amount01']: command.amount01 }; }
      } else if (command.kind === 'mode-loss') {
        const mask = body.lossMasks.find(mask => mask.id === command.lossMaskId); if (!mask || !held && command.operation !== 'end' && bindings.size >= 32) return reject('mode-loss-mask-or-owner-capacity'); slot = mask.index;
        if (command.operation === 'end') values = held ? maskRelease(body, held, key) : null;
        else {
          position = projectPreparedSurfacePoint(identity.surfaceMap, command.position);
          const before = maskAmount(identity.bodyInstanceId, command.lossMaskId), after = maskAmount(identity.bodyInstanceId, command.lossMaskId, key, command); values = before === after ? null : { ['modeLoss' + slot + 'Amount01']: after };
        }
      } else {
        if (!held && command.operation !== 'end' && (bindings.size >= 32 || [...bindings.values()].some(binding => binding.bodyInstanceId === identity.bodyInstanceId && binding.kind === command.kind))) return reject('pickup-owner-capacity');
        if (command.operation !== 'end') { position = projectPreparedSurfacePoint(identity.surfaceMap, command.position); const name = command.kind === 'pickup-left' ? 'pickupLeft' : 'pickupRight'; values = { [name + 'X01']: position.x01, [name + 'Y01']: position.y01 }; }
      }
      if (held && command.operation !== 'end' && held.position?.x01 === position?.x01 && held.position?.y01 === position?.y01 && held.radius01 === command.radius01 && held.amount01 === command.amount01) values = null;
      if (values) submit(body, values, targetFrame, command);
    } catch (error) {
      if (['unsupported-touch-position', 'invalid-effect-control', 'effect-control-capacity', 'stale-prepared-body'].includes(error.code) || error instanceof RangeError) return reject(error.code || error.message);
      return failBody(body, error);
    }
    if (command.operation === 'end') { bindings.delete(key); ended.add(key); endedOrder.push(key); if (endedOrder.length > 256) ended.delete(endedOrder.shift()); }
    else bindings.set(key, { bodyInstanceId: identity.bodyInstanceId, contactSpanId: command.contactSpanId, actorId: command.actorId, mappingId: command.mappingId, mappingRevision: command.mappingRevision,
      preparationSlot: command.preparationSlot, kind: command.kind, ...(command.lossMaskId ? { lossMaskId: command.lossMaskId } : {}), slot: slot ?? null, position: position || held?.position || null, radius01: command.radius01, amount01: command.amount01, mapRevision: command.mapRevision, targetFrame, sourceTick: command.sourceTick, sourceSequence: command.sourceSequence });
    lastTick = command.sourceTick; lastSequence = command.sourceSequence; seen.add(command.commandId); seenOrder.push(command.commandId); if (seenOrder.length > 256) seen.delete(seenOrder.shift());
    return report({ ...base, status: 'accepted', stage: values ? 'prepared-body-native-control-submitted' : command.operation === 'end' ? 'prepared-body-observation-owner-released' : 'prepared-body-observation-refreshed', bodyInstanceId: identity.bodyInstanceId,
      mapId: command.mapId, mapRevision: command.mapRevision, targetFrame, values: values || null, heldContactPolicy: identity.heldContactPolicy, sourceCardinality: 'preparation-command;zero-musical-onsets', pickupEndPolicy: 'hold-last-observation' });
  };
  const clear = (reason = 'execution-ended') => {
    serial++; prune(); let failure = null;
    for (const body of bodies.values()) { try { const receipt = panicBody(body.identity.nodeId, expected(body.identity)); if (receipt?.status !== 'accepted') throw new Error('Body panic submission did not acknowledge.'); } catch (error) { body.quarantined = true; failure ||= error; report({ status: 'rejected', stage: 'prepared-body-clear-unknown', bodyInstanceId: body.identity.bodyInstanceId, reason: error.message }); } }
    if (failure) { blocked = failure; throw failure; } blocked = null;
    bindings.clear(); active.clear(); bodies.clear(); seen.clear(); seenOrder.length = 0; ended.clear(); endedOrder.length = 0; closedContacts.clear(); closedOrder.length = 0; execution = worldId = generation = null; lastTick = lastSequence = -1;
    report({ status: 'accepted', stage: 'prepared-body-bindings-cleared', reason, audioState: 'owned-body-panic-submitted-not-applied-acknowledgment' });
  };
  return Object.freeze({ bind, consume, prune, clear,
    resolveActiveBody(surfaceId) { prune(); const body = bodies.get(active.get(surfaceId)); if (disposed || blocked || !body?.active || body.quarantined) return null; const target = inventory().find(target => targetKey(target) === targetKey(body.identity)); return target ? Object.freeze({ ...body.identity, pulses: target.pulses, sampleRate: target.sampleRate }) : null; },
    state: () => Object.freeze({ disposed, blocked: blocked?.message || null, documentEpoch, executionEpoch: execution, bodies: [...bodies.values()].map(body => ({ ...body.identity, active: body.active, quarantined: body.quarantined, preparationKinds: [...body.preparationKinds], pickupFieldId: body.pickupFieldId, lossMasks: body.lossMasks.map(mask => ({ ...mask, amount01: maskAmount(body.identity.bodyInstanceId, mask.id) })) })), bindings: [...bindings.values()].map(binding => ({ ...binding })),
      limits: { retainedBodies: 8, bindings: 32, touchSlotsPerBody: 4, pickupOwnersPerSide: 1, recentCommandAndClosureEntries: 256 }, preparationPolicy: 'separate-contact-owner-per-slot;keep-old-tail;no-implicit-rebind', restoration: 'canonical-command-preroll;no-foreign-body-identity-restore' }),
    dispose() { if (disposed) return false; clear('document-owner-retired'); storage.release(); disposed = true; return true; } });
}
