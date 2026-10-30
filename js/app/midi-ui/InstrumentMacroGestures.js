import { validateInstrumentControls } from '../../midi/content/InstrumentPerformance.js';
import { getSupportedInstrumentDefinition } from '../../midi/content/SoundContentReference.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
const fail = message => { throw new Error('Macro gesture: ' + message); };
const key = (lane, macro) => JSON.stringify([lane, macro]);
let nextOwner = 0;

export function createInstrumentMacroGestures({ getLane, getDocumentEpoch, commit, resourceBudget = null, onState = () => {} } = {}) {
  if ([getLane, getDocumentEpoch, commit, onState].some(value => typeof value !== 'function')) throw new TypeError('Invalid macro gesture owner.');
  const active = new Map(), handles = new WeakMap(), bindings = new Map(), retirement = createProcgenRetirementScope();
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'macro-gestures-' + (++nextOwner), kind: 'macro-gesture-inputs', category: 'audio', bytes: 65536 });
  let disposed = false, sequence = 0, revision = 0, publishing = false;
  const changed = () => { if (!Number.isSafeInteger(revision + 1)) fail('Gesture observation revision exhausted.'); revision++; try { onState(); } catch { /* Views cannot change controls. */ } };
  const source = (laneId, macroId) => { const lane = getLane(laneId), macro = getSupportedInstrumentDefinition(lane?.instrumentRef)?.macros?.find(value => value.id === macroId);
    if (!lane || !macro || macro.mode !== 'onset-only') fail('Only admitted onset-sampled macros can use this performer adapter. Continuous or missing targets remain unsupported.');
    return { lane, macro, value: lane.instrumentControls?.macros?.[macroId] ?? macro.default01, identity: lane.instrumentRef.packHash + ':' + lane.instrumentRef.definitionHash }; };
  const valid = entry => {
    if (disposed || entry.epoch !== getDocumentEpoch()) return false;
    try { const next = source(entry.laneId, entry.macroId); return next.identity === entry.identity && next.value === entry.baseline; } catch { return false; }
  };
  const remove = entry => { if (active.get(entry.key) !== entry) return false; active.delete(entry.key); changed(); return true; };
  const begin = (laneId, macroId, { momentary = false, origin = 'manual' } = {}) => {
    if (disposed || !['manual', 'controller', 'pressure'].includes(origin)) fail('Unavailable gesture source.');
    const selected = source(laneId, macroId), id = key(laneId, macroId), previous = active.get(id);
    if (previous) remove(previous); if (active.size >= 4 || !Number.isSafeInteger(sequence + 1)) fail('At most four simultaneous macro gestures are admitted.');
    const handle = Object.freeze({ gestureId: ++sequence, laneId, macroId }), entry = { handle, key: id, laneId, macroId, epoch: getDocumentEpoch(), identity: selected.identity,
      baseline: selected.value, value: selected.value, momentary: momentary === true, origin, macro: selected.macro };
    handles.set(handle, entry); active.set(id, entry); changed(); return handle;
  };
  const resolve = handle => { const entry = handles.get(handle); if (!entry || active.get(entry.key) !== entry || !valid(entry)) { if (entry) remove(entry); fail('The patch, baseline or document lease changed.'); } return entry; };
  const set = (handle, value) => { const entry = resolve(handle); if (!Number.isFinite(value) || value < 0 || value > 1) fail('A macro value must be normalized and finite.'); if (entry.value !== value) { entry.value = value; changed(); }
    return Object.freeze({ gestureId: handle.gestureId, requested01: value, application: 'next-causal-onset', origin: entry.origin, physicalMutation: false }); };
  const finish = (handle, { cancel = false } = {}) => {
    const entry = resolve(handle), next = entry.value; remove(entry);
    if (cancel || entry.momentary || next === entry.baseline) return Object.freeze({ state: 'returned', canonicalEdit: false, baseline01: entry.baseline });
    const lane = getLane(entry.laneId), controls = validateInstrumentControls({ ...lane.instrumentControls, macros: { ...lane.instrumentControls?.macros, [entry.macroId]: next } });
    publishing = true;
    try { if (commit(entry.laneId, controls, handle.gestureId) === false) fail('Canonical macro commit was not admitted.'); }
    finally { publishing = false; }
    return Object.freeze({ state: 'committed', canonicalEdit: true, requested01: next });
  };
  const reconcile = () => { if (publishing) return; for (const entry of active.values()) if (!valid(entry)) remove(entry); for (const [id, binding] of bindings) {
    let current; try { current = source(binding.laneId, binding.macroId); } catch { current = null; }
    if (binding.epoch !== getDocumentEpoch() || current?.identity !== binding.identity) { if (binding.handle) { const entry = handles.get(binding.handle); if (entry) remove(entry); } bindings.delete(id); changed(); }
  } };
  const lanes = input => {
    reconcile(); if (!active.size) return input;
    const byLane = new Map(); for (const entry of active.values()) { const entries = byLane.get(entry.laneId) || []; entries.push(entry); byLane.set(entry.laneId, entries); }
    return input.map(lane => {
      const entries = byLane.get(lane.id); if (!entries) return lane;
      const applicable = entries.filter(entry => lane.instrumentRef?.packHash + ':' + lane.instrumentRef?.definitionHash === entry.identity &&
        (lane.instrumentControls?.macros?.[entry.macroId] ?? entry.macro.default01) === entry.baseline);
      if (!applicable.length) return lane;
      const macros = { ...lane.instrumentControls?.macros }; for (const entry of applicable) macros[entry.macroId] = entry.value;
      return { ...lane, instrumentControls: validateInstrumentControls({ ...lane.instrumentControls, macros }) };
    });
  };
  const cancelAll = () => { for (const entry of [...active.values()]) remove(entry); for (const binding of bindings.values()) { binding.handle = null; binding.pickedUp = false; binding.previous = null; } };
  return Object.freeze({ begin, set, finish, lanes, reconcile, cancelAll,
    pressure(handle, value) { const entry = resolve(handle); if (!Number.isFinite(value) || value < -1 || value > 1 || value < 0 && !entry.macro.bipolar) fail('Pressure is normalized model input, not physical force; negative values require a bipolar macro.');
      return set(handle, value < 0 ? entry.baseline * (1 + value) : entry.baseline + (1 - entry.baseline) * value); },
    bindController(laneId, macroId, { endpointId, endpointEpoch, channel, controller = null, type = 'cc' } = {}) {
      const selected = source(laneId, macroId);
      if (disposed || typeof endpointId !== 'string' || !endpointId || endpointId.length > 160 || !Number.isSafeInteger(endpointEpoch) || endpointEpoch < 0 || !Number.isInteger(channel) || channel < 1 || channel > 16 ||
          !['cc', 'pressure', 'bend'].includes(type) || type === 'cc' && (!Number.isInteger(controller) || controller < 0 || controller > 127)) fail('Invalid selected input endpoint/controller observation.');
      const id = key(laneId, macroId); if (!bindings.has(id) && bindings.size >= 32) fail('Controller mapping capacity exceeded.');
      const old = bindings.get(id); if (old?.handle) { const entry = handles.get(old.handle); if (entry) remove(entry); }
      bindings.set(id, { laneId, macroId, endpointId, endpointEpoch, channel, controller, type, epoch: getDocumentEpoch(), identity: selected.identity, previous: null, pickedUp: false, handle: null }); changed();
    },
    observeController(event, { endpointId, endpointEpoch } = {}) {
      reconcile(); let matched = 0;
      for (const binding of bindings.values()) {
        if (binding.endpointId !== endpointId || binding.endpointEpoch !== endpointEpoch || binding.channel !== event.channel || binding.type !== event.type || event.type === 'cc' && binding.controller !== event.controller) continue;
        if (!Number.isInteger(event.value) || (event.type === 'bend' ? event.value < -8192 || event.value > 8191 : event.value < 0 || event.value > 127)) continue;
        const selected = source(binding.laneId, binding.macroId), value = event.type === 'bend' ? (event.value + 8192) / 16383 : event.value / 127;
        if (binding.handle && active.get(key(binding.laneId, binding.macroId))?.handle !== binding.handle) { binding.handle = null; binding.pickedUp = false; }
        if (event.type === 'pressure') {
          if (event.value === 0) { if (binding.handle) { finish(binding.handle, { cancel: true }); binding.handle = null; } binding.previous = 0; matched++; continue; }
          binding.handle ||= begin(binding.laneId, binding.macroId, { momentary: true, origin: 'pressure' }); set(binding.handle, selected.value + (1 - selected.value) * value); matched++; continue;
        }
        if (!binding.pickedUp) binding.pickedUp = Math.abs(value - selected.value) <= 1 / 127 || binding.previous != null && (binding.previous - selected.value) * (value - selected.value) <= 0;
        binding.previous = value; changed(); if (!binding.pickedUp) continue;
        binding.handle ||= begin(binding.laneId, binding.macroId, { origin: 'controller' }); set(binding.handle, value); matched++;
      }
      return Object.freeze({ matched, application: 'next-causal-onset', noteCreation: false });
    },
    disconnect(endpointId, endpointEpoch) { for (const [id, binding] of bindings) if (binding.endpointId === endpointId && (endpointEpoch == null || binding.endpointEpoch === endpointEpoch)) {
      if (binding.handle) { try { finish(binding.handle, { cancel: binding.type === 'pressure' }); } finally { bindings.delete(id); } } else bindings.delete(id);
    } changed(); },
    commitAll() { const outcomes = []; for (const entry of [...active.values()]) outcomes.push(finish(entry.handle)); return Object.freeze(outcomes); },
    state(laneId, macroId) { const entry = active.get(key(laneId, macroId)), binding = bindings.get(key(laneId, macroId)); return Object.freeze({ preview01: entry?.value ?? null, requestedOnly: true, mode: 'next-causal-onset',
      pickup01: binding && !binding.pickedUp ? binding.previous : null, controllerBound: !!binding, gestureId: entry?.handle.gestureId ?? null }); },
    revision: () => revision, diagnostics: () => Object.freeze({ active: active.size, bindings: bindings.size, revision, resource: reservation.receipt(), disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); cancelAll(); bindings.clear(); disposed = true; return retirement.retire([{ name: 'macro-gesture-inputs', run: () => reservation.release() }]); }
  });
}
