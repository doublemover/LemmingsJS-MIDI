import assert from 'node:assert/strict';
import { prepareExportArtifact, deliverArtifactToFileHandle } from '../../js/app/export/ExportArtifact.js';
import { nativeExportDeliveryDiagnostics } from '../../js/app/export/NativeExportDeliveryOwner.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
export function deliveryReference() {
  const state = { started: false, attempts: 0, retained: true, neighbor: false, mutated: false, canceled: false, opened: false, failed: false, cause: null,
    pending: { open: false, write: false, close: false, abort: false }, terminal: null, settled: false, result: null, bytesWritten: 0 };
  const finish = value => { if (!state.settled) { state.settled = true; state.result = value; } };
  const cancel = (cause = 'canceled') => { state.canceled = true; state.cause ||= cause; if (state.pending.open && !state.opened) finish(state.cause); else if (state.opened && !state.settled) state.pending.abort = true; };
  return { state, apply(command) {
    const s = state, p = s.pending;
    if (command.kind === 'start') {
      if (!s.retained || s.attempts >= 4 || s.started && (!s.settled || Object.values(p).some(Boolean) || s.opened && !s.terminal)) return false;
      s.started = true; s.attempts++; s.canceled = false; s.opened = false; s.failed = false; s.cause = null; s.terminal = null; s.settled = false; s.result = null; s.bytesWritten = 0; p.open = true;
    }
    else if (command.kind === 'borrow-neighbor') { if (!s.retained || s.neighbor) return false; s.neighbor = true; }
    else if (command.kind === 'release-neighbor') { if (!s.neighbor) return false; s.neighbor = false; }
    else if (command.kind === 'mutate-input') { if (s.mutated) return false; s.mutated = true; }
    else if (command.kind === 'cancel') { if (!s.started || s.settled || s.canceled) return false; cancel(); }
    else if (command.kind === 'discard' || command.kind === 'expire') { if (!s.retained) return false; s.retained = false; if (s.started && !s.settled && !s.canceled) cancel(command.kind === 'expire' ? 'failed' : 'canceled'); }
    else if (['resolve-open', 'reject-open'].includes(command.kind)) {
      if (!p.open) return false; p.open = false;
      if (command.kind === 'reject-open') { s.failed = true; s.cause ||= 'failed'; finish(s.cause); }
      else { s.opened = true; if (s.canceled) p.abort = true; else p.write = true; }
    } else if (['resolve-write', 'reject-write'].includes(command.kind)) {
      if (!p.write) return false; p.write = false;
      if (command.kind === 'reject-write') { s.failed = true; s.cause ||= 'failed'; if (!s.canceled && !s.settled) p.abort = true; }
      else if (!s.canceled) { s.bytesWritten = 4; p.close = true; }
    } else if (['resolve-close', 'reject-close', 'refuse-close'].includes(command.kind)) {
      if (!p.close) return false; p.close = false;
      if (command.kind === 'resolve-close') { s.terminal = 'closed'; if (!s.canceled) finish('close-acknowledged'); }
      else { s.failed = true; s.cause ||= 'failed'; if (!s.canceled && !s.settled) p.abort = true; }
    } else if (command.kind === 'resolve-abort') {
      if (!p.abort) return false; p.abort = false; s.terminal ||= 'aborted';
      finish(s.terminal === 'closed' ? 'close-acknowledged' : s.cause || 'failed');
    } else return false;
    return true;
  }, held() { return state.started && !(state.settled && !Object.values(state.pending).some(Boolean) && (!state.opened || state.terminal)); } };
}
export function generateDeliveryTrace(seed, { steps = 24 } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(steps) || steps < 1 || steps > 128) throw new TypeError('Invalid delivery model campaign.');
  let word = seed >>> 0 || 1; const draw = count => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % count; };
  const model = deliveryReference(), trace = [], add = kind => { const command = { kind }; if (!model.apply(command)) throw new Error('Invalid generated command'); trace.push(command); };
  add('start');
  for (let step = 0; step < steps; step++) {
    const s = model.state, p = s.pending, choices = [];
    if (p.open) choices.push('resolve-open', 'reject-open'); if (p.write) choices.push('resolve-write', 'reject-write');
    if (p.close) choices.push('resolve-close', 'reject-close', 'refuse-close'); if (p.abort) choices.push('resolve-abort');
    if (!s.settled && !s.canceled) choices.push('cancel'); if (s.retained) choices.push('discard', 'expire');
    if (s.retained && s.attempts < 4 && s.settled && !Object.values(p).some(Boolean) && (!s.opened || s.terminal)) choices.push('start');
    if (s.retained && !s.neighbor) choices.push('borrow-neighbor'); if (s.neighbor) choices.push('release-neighbor'); if (!s.mutated) choices.push('mutate-input');
    if (!choices.length) break; add(choices[draw(choices.length)]);
  }
  if (!model.state.settled && !model.state.canceled) add('cancel');
  for (let attempt = 0; Object.values(model.state.pending).some(Boolean); attempt++) {
    if (attempt >= 8) throw new Error('Unbounded generated delivery cleanup.');
    const pending = model.state.pending, next = ['abort', 'close', 'write', 'open'].find(key => pending[key]); add('resolve-' + next);
  }
  if (model.state.neighbor) add('release-neighbor'); if (model.state.retained) add('discard'); return trace;
}
export async function replayDeliveryTrace(trace, { prematureReleaseOnAbort = false, checkBudget = () => {} } = {}) {
  if (!Array.isArray(trace) || trace.length > 160) throw new TypeError('Invalid delivery trace length.');
  if (!trace.length || trace[0]?.kind !== 'start') return { valid: false, step: 0 };
  const model = deliveryReference(), original = Uint8Array.of(1, 2, 3, 4), held = new Map(), calls = [], observations = [];
  const makeGates = () => ({ open: deferred(), write: deferred(), close: deferred(), abort: deferred() });
  const baseline = nativeExportDeliveryDiagnostics().activeOwners; let controller = new AbortController(), gates = makeGates(), nativeLease = null, neighbor = null, delivery = null, receipt = null, deliveryError = null, step = 0, now = 0;
  const artifact = prepareExportArtifact({ bytes: original, immutableSourceRef: 'take:delivery-model:1', formatVersion: 'model/v1', suggestedFilename: 'model.bin', lifetimeMs: 1000, clock: () => now,
    budgetAdapter: { reserve(request) { held.set(request.token, request.bytes); }, release({ token }) { return held.delete(token); } } });
  await artifact.digest(); const identity = artifact.metadata(), proxy = Object.freeze({ ...artifact, borrow() { nativeLease = artifact.borrow(); return nativeLease; } });
  assert.equal(identity.sha256, '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a', 'delivery-model:initial-source-hash');
  const writer = { write(value) { calls.push({ kind: 'write', bytes: Array.from(value) }); return gates.write.promise; }, close() { calls.push({ kind: 'close' }); return gates.close.promise; },
    abort() { calls.push({ kind: 'abort' }); if (prematureReleaseOnAbort) nativeLease?.release(); return gates.abort.promise; } };
  const inspect = () => {
    const metadata = artifact.metadata(), expectedHeld = Number(model.held()) + Number(model.state.neighbor), actualBytes = [...held.values()].reduce((sum, value) => sum + value, 0);
    assert.equal(metadata.artifactId, identity.artifactId, 'delivery-model:artifact-identity'); assert.equal(metadata.sha256, identity.sha256, 'delivery-model:source-hash');
    assert.equal(metadata.retained, model.state.retained, 'delivery-model:retained'); assert.equal(metadata.activeLeases, expectedHeld, 'delivery-model:source-lease-count');
    assert.equal(actualBytes, model.state.retained || expectedHeld ? 4 : 0, 'delivery-model:reserved-bytes');
    assert.equal(nativeExportDeliveryDiagnostics().activeOwners - baseline, Number(model.held()), 'delivery-model:native-owner-count');
    if (model.state.settled) { assert.ok(receipt, 'delivery-model:request-liveness'); assert.equal(receipt.state, model.state.result, 'delivery-model:logical-outcome'); assert.equal(receipt.bytesWritten, model.state.bytesWritten, 'delivery-model:written-bytes'); }
    for (const call of calls) if (call.kind === 'write') assert.deepEqual(call.bytes, [1, 2, 3, 4], 'delivery-model:immutable-payload');
    if (deliveryError) throw deliveryError;
    observations.push({ step, activeLeases: metadata.activeLeases, reservedBytes: actualBytes, retained: metadata.retained, requestState: receipt?.state || 'pending', nativeOwners: nativeExportDeliveryDiagnostics().activeOwners - baseline, referencePending: { ...model.state.pending } });
  };
  try {
    for (const command of trace) {
      checkBudget(); if (!model.apply(command)) return { valid: false, step };
      if (command.kind === 'start') {
        controller = new AbortController(); gates = makeGates(); receipt = null; deliveryError = null; calls.length = 0;
        delivery = deliverArtifactToFileHandle(proxy, { createWritable() { calls.push({ kind: 'open' }); return gates.open.promise; } }, { signal: controller.signal, clock: () => 0 }); delivery.then(value => { receipt = value; }, error => { deliveryError = error; });
      }
      else if (command.kind === 'borrow-neighbor') neighbor = artifact.borrow();
      else if (command.kind === 'release-neighbor') { neighbor.release(); neighbor = null; }
      else if (command.kind === 'mutate-input') original.fill(255);
      else if (command.kind === 'cancel') controller.abort();
      else if (command.kind === 'discard') artifact.discard();
      else if (command.kind === 'expire') { now = 1000; artifact.metadata(); }
      else if (command.kind.startsWith('resolve-')) gates[command.kind.slice(8)].resolve(command.kind === 'resolve-open' ? writer : undefined);
      else if (command.kind.startsWith('reject-')) gates[command.kind.slice(7)].reject(new Error('Modeled native rejection'));
      else if (command.kind === 'refuse-close') gates.close.resolve(false);
      await flush();
      for (let turn = 0; turn < 8 && (model.state.pending.write && !calls.some(call => call.kind === 'write') || model.state.pending.abort && !calls.some(call => call.kind === 'abort')); turn++) await flush();
      inspect(); step++;
    }
    return { valid: true, transitions: step, observations, receipt, sourceHash: identity.sha256, reference: { ...model.state, pending: { ...model.state.pending } } };
  } catch (error) { error.modelTrace = trace.slice(0, step + 1); error.modelStep = step; error.modelObservations = observations; throw error; }
  finally {
    controller.abort(); neighbor?.release(); for (const [key, gate] of Object.entries(gates)) gate.resolve(key === 'open' ? writer : undefined);
    if (delivery) await delivery; artifact.discard(); await flush();
    assert.equal(artifact.metadata().activeLeases, 0, 'delivery-model:final-source-leases'); assert.equal(held.size, 0, 'delivery-model:final-source-budget');
    assert.equal(nativeExportDeliveryDiagnostics().activeOwners, baseline, 'delivery-model:final-native-owners');
  }
}
export { shrinkModelTrace as shrinkDeliveryTrace } from './model-trace.js';
