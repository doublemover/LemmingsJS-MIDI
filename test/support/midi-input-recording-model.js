import assert from 'node:assert/strict';
import { createProcgenMidiPorts } from '../../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
const routes = [null, 'input-A', 'input-A', 'input-B'];
const projection = row => ({ sequence: row.sequence, type: row.type, direction: row.direction, sourceRoute: row.sourceRoute ?? null,
  connectionEpoch: row.connectionEpoch ?? null, timestamp: row.timestamp, data: [...row.data] });
const invalidPackets = [[0x90, 60], [0x90, 128, 1], [0, 60, 1]];
const kinds = new Set(['advance', 'dispose', 'arm', 'stop', 'learn', 'cancel-learn', 'clear', 'source', 'packet', 'invalid-packet', 'mutate-view']);
const validCommand = command => {
  if (!command || typeof command !== 'object' || Array.isArray(command) || !kinds.has(command.kind)) return false;
  if (command.kind === 'source' && (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= routes.length)) return false;
  if (command.kind === 'invalid-packet' && (!Number.isInteger(command.variant) || command.variant < 0 || command.variant >= invalidPackets.length)) return false;
  if (command.kind === 'packet' && (!Array.isArray(command.data) || command.data.length !== 3 || ![0x80, 0x90, 0xb0].includes(command.data[0] & 0xf0) || command.data.some((value, index) => !Number.isInteger(value) || value < 0 || value > (index ? 127 : 0xbf)) || command.offsetMs != null && (!Number.isSafeInteger(command.offsetMs) || command.offsetMs < -100 || command.offsetMs > 0))) return false;
  if (command.hook && (!['monitor', 'transport', 'record', 'learn'].includes(command.hook.boundary) || !['dispose', 'replace', 'stop', 'clear', 'mutate-original', 'throw'].includes(command.hook.action) || command.hook.action === 'replace' && (!Number.isInteger(command.hook.slot) || command.hook.slot < 0 || command.hook.slot >= routes.length))) return false;
  return true;
};

export function inputRecordingReference() {
  const state = { time: 1000, slot: 0, epoch: 0, recording: false, learning: false, disposed: false, sequence: 0, rows: [], gates: new Map(), incomplete: new Set(),
    calls: { monitor: 0, transport: 0, record: 0, learn: 0 }, transportRows: [], lastError: null };
  let hook = null, fired = false;
  const stop = () => { if (state.recording && state.gates.size) state.incomplete.add('open-notes-at-stop'); state.recording = false; };
  const dispose = () => { state.disposed = true; state.recording = false; state.learning = false; state.slot = 0; state.rows = []; state.gates.clear(); };
  const clear = () => { state.sequence = 0; state.rows = []; state.gates.clear(); state.incomplete.clear(); };
  const fire = boundary => {
    state.calls[boundary]++;
    if (fired || hook?.boundary !== boundary) return;
    fired = true;
    if (hook.action === 'dispose') dispose();
    else if (hook.action === 'replace') replace(hook.slot);
    else if (hook.action === 'stop') stop();
    else if (hook.action === 'clear') clear();
    else if (hook.action === 'throw') { if (boundary === 'transport') throw new Error('Injected transport failure'); state.lastError = boundary; }
  };
  const append = row => { if (!state.recording || state.disposed) return; state.rows.push({ ...row, sequence: ++state.sequence }); fire('record'); };
  const replace = slot => {
    if (state.disposed || slot === state.slot) return;
    if (state.gates.size) {
      state.gates.clear();
      append({ type: 'safety-termination', direction: 'safety', sourceRoute: routes[state.slot], connectionEpoch: state.epoch, timestamp: state.time, data: [] });
      state.incomplete.add('input-source-terminated');
    }
    if (!state.disposed) { state.slot = slot; state.epoch++; state.learning = false; }
  };
  const apply = command => {
    if (!validCommand(command)) return { valid: false };
    hook = command.hook || null; fired = false;
    if (command.kind === 'advance') { if (!Number.isSafeInteger(command.ms) || command.ms < 0 || command.ms > 50) return { valid: false }; state.time += command.ms; }
    else if (command.kind === 'dispose') dispose();
    else if (state.disposed) return { valid: true, ...(['packet', 'invalid-packet'].includes(command.kind) ? { accepted: false } : {}) };
    else if (command.kind === 'arm') state.recording = true;
    else if (command.kind === 'stop') stop();
    else if (command.kind === 'learn') state.learning = true;
    else if (command.kind === 'cancel-learn') state.learning = false;
    else if (command.kind === 'clear') clear();
    else if (command.kind === 'source') { if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= routes.length) return { valid: false }; replace(command.slot); }
    else if (command.kind === 'packet' || command.kind === 'invalid-packet') {
      if (command.kind === 'invalid-packet') return { valid: true, accepted: false };
      const epoch = command.staleEpoch ? state.epoch - 1 : state.epoch, route = command.foreignRoute ? 'foreign-input' : routes[state.slot];
      const current = () => !state.disposed && epoch === state.epoch && route === routes[state.slot];
      if (!current()) return { valid: true, accepted: false };
      fire('monitor'); if (!current()) return { valid: true, accepted: false };
      state.transportRows.push([...command.data]);
      try { fire('transport'); } catch { return { valid: true, throws: true }; }
      if (!current()) return { valid: true, accepted: false };
      if (state.recording) {
        const [status, note, velocity] = command.data, family = status & 0xf0, key = (status & 15) + ':' + note;
        const type = family === 0xb0 ? 'cc' : family === 0x80 || !velocity ? 'noteOff' : 'noteOn';
        if (type === 'noteOn') state.gates.set(key, (state.gates.get(key) || 0) + 1);
        else if (type === 'noteOff') { const remaining = (state.gates.get(key) || 0) - 1; if (remaining > 0) state.gates.set(key, remaining); else state.gates.delete(key); }
        append({ type, direction: 'input', sourceRoute: route, connectionEpoch: epoch, timestamp: state.time + (command.offsetMs || 0), data: [...command.data] });
      }
      if (!current()) return { valid: true, accepted: false };
      if (state.learning) { state.learning = false; fire('learn'); }
      return { valid: true, accepted: current() };
    } else if (command.kind !== 'mutate-view') return { valid: false };
    return { valid: true };
  };
  return { state, apply };
}

export function generateInputRecordingTrace(seed, { steps = 128 } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(steps) || steps < 1 || steps > 256) throw new TypeError('Invalid input recording campaign.');
  let word = seed || 1; const draw = count => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % count; };
  const model = inputRecordingReference(), trace = [], add = command => { if (!model.apply(command).valid) throw new Error('Invalid generated input precondition'); trace.push(command); };
  if (seed % 2) add({ kind: 'source', slot: 1 }); add({ kind: 'arm' });
  for (let index = 0; index < steps && !model.state.disposed; index++) {
    const data = [([0x80, 0x90, 0xb0][draw(3)]) | draw(2), 60 + draw(2), draw(128)]; if ((data[0] & 0xf0) === 0xb0) data[1] = 74;
    const packet = { kind: 'packet', data, offsetMs: draw(3) ? 0 : -5, staleEpoch: draw(12) === 0, foreignRoute: draw(12) === 0 };
    if (draw(3) === 0) packet.hook = { boundary: ['monitor', 'transport', 'record', 'learn'][draw(4)], action: ['stop', 'clear', 'replace', 'mutate-original', 'throw', ...(index > steps / 2 ? ['dispose'] : [])][draw(index > steps / 2 ? 6 : 5)], slot: draw(4) };
    const choices = [packet, packet, packet, { kind: 'advance', ms: draw(51) }, { kind: 'arm' }, { kind: 'stop' }, { kind: 'clear' }, { kind: 'source', slot: draw(4) }, { kind: 'learn' }, { kind: 'cancel-learn' }, { kind: 'invalid-packet', variant: draw(invalidPackets.length) }, { kind: 'mutate-view' }];
    add(choices[draw(choices.length)]);
  }
  add({ kind: 'dispose' });
  add({ kind: 'packet', data: [0x90, 60, 90] }); add({ kind: 'learn' }); add({ kind: 'arm' }); add({ kind: 'clear' }); add({ kind: 'source', slot: 3 }); add({ kind: 'dispose' });
  return trace;
}

export async function replayInputRecordingTrace(trace, { factory = createProcgenMidiPorts, checkBudget = () => {} } = {}) {
  if (!Array.isArray(trace) || trace.length > 512) throw new TypeError('Invalid input recording trace.');
  if (!trace.length) return { valid: false, step: 0 };
  const model = inputRecordingReference(), sources = [null, { id: 'input-A', state: 'connected' }, { id: 'input-A', state: 'connected' }, { id: 'input-B', state: 'connected' }];
  const budget = createResourceBudget({ limitBytes: 4 * 1048576 }), calls = { monitor: 0, transport: 0, record: 0, learn: 0 }, transportRows = [], observations = [];
  let time = 1000, slot = 0, epoch = 0, hook = null, fired = false, original = null, ports, retirement = null, step = 0;
  const fire = boundary => {
    calls[boundary]++;
    if (fired || hook?.boundary !== boundary) return; fired = true;
    if (hook.action === 'dispose') retirement = ports.dispose();
    else if (hook.action === 'replace') ports.setInput(sources[hook.slot]);
    else if (hook.action === 'stop') ports.configure({ recording: false });
    else if (hook.action === 'clear') ports.clearRecording();
    else if (hook.action === 'mutate-original') original.fill(255);
    else if (hook.action === 'throw') throw new Error('Injected ' + boundary + ' failure');
  };
  ports = factory({ now: () => time, maxRecordedEvents: 512, resourceBudget: budget,
    transport: { panic() {}, receiveMidi(data) { transportRows.push([...data]); fire('transport'); }, getState() { return { beat: time / 500, bpm: 120 }; } },
    onMonitor(event) { assert.equal(Object.isFrozen(event), true, 'input-model:immutable-monitor'); assert.equal(Object.isFrozen(event.data), true, 'input-model:immutable-monitor-bytes'); fire('monitor'); },
    onRecord(event) { assert.equal(Object.isFrozen(event), true, 'input-model:immutable-record-callback'); fire('record'); }, onLearn() { fire('learn'); } });
  try {
    for (const command of trace) {
      checkBudget(); const expected = model.apply(command); if (!expected.valid) return { valid: false, step };
      hook = command.hook || null; fired = false;
      if (command.kind === 'advance') time += command.ms;
      else if (command.kind === 'arm') ports.configure({ recording: true });
      else if (command.kind === 'stop') ports.configure({ recording: false });
      else if (command.kind === 'learn') ports.learnNext();
      else if (command.kind === 'cancel-learn') ports.cancelLearn();
      else if (command.kind === 'clear') ports.clearRecording();
      else if (command.kind === 'source') ports.setInput(sources[command.slot]);
      else if (command.kind === 'dispose') { retirement = ports.dispose(); assert.equal(ports.dispose(), retirement, 'input-model:idempotent-retirement'); }
      else if (command.kind === 'packet' || command.kind === 'invalid-packet') {
        const current = ports.getState().inputLiveness;
        original = command.kind === 'packet' ? [...command.data] : [...invalidPackets[command.variant]];
        let result, error;
        try { result = ports.receiveMidi(original, time + (command.offsetMs || 0), { connectionEpoch: current.connectionEpoch - Number(!!command.staleEpoch), sourceRoute: command.foreignRoute ? 'foreign-input' : current.sourceRoute }); }
        catch (failure) { error = failure; }
        if (expected.throws) assert.match(error?.message || '', /Injected transport failure/, 'input-model:transport-error');
        else { if (error) throw error; assert.equal(result, expected.accepted, 'input-model:packet-admission'); }
      } else if (command.kind === 'mutate-view') { const view = ports.getRecording(); if (view.length && view[0].data.length) view[0].data[0] = 0; }
      if (retirement) await retirement.completion;
      const state = ports.getState(); slot = model.state.slot; epoch = model.state.epoch;
      assert.equal(state.recording, model.state.recording, 'input-model:recording-owner'); assert.equal(state.learning, model.state.learning, 'input-model:learning-owner');
      assert.equal(state.inputId, routes[slot], 'input-model:source-route'); assert.equal(state.inputLiveness.connectionEpoch, epoch, 'input-model:source-epoch');
      assert.deepEqual(transportRows, model.state.transportRows, 'input-model:transport-payload'); assert.deepEqual(calls, model.state.calls, 'input-model:callback-counts');
      assert.deepEqual(ports.getRecording().map(projection), model.state.rows, 'input-model:retained-prefix');
      assert.deepEqual([...state.incompleteReasons].sort(), [...model.state.incomplete].sort(), 'input-model:incomplete-evidence');
      assert.equal(state.lastCallbackError?.source ?? null, model.state.lastError, 'input-model:callback-error-owner');
      if (model.state.disposed) assert.equal(budget.diagnostics().accountedBytes, 0, 'input-model:retired-reservations');
      observations.push({ step, recording: state.recording, learning: state.learning, epoch, route: state.inputId, retained: state.recordedEvents, incomplete: state.incompleteReasons, calls: { ...calls }, accountedBytes: budget.diagnostics().accountedBytes }); step++;
    }
    return { valid: true, transitions: step, observations, complete: model.state.disposed, retainedEvents: model.state.rows.length, callbacks: { ...calls } };
  } catch (error) { error.modelTrace = trace.slice(0, step + 1); error.modelStep = step; error.modelObservations = observations; throw error; }
  finally { const retired = ports.dispose(); await retired.completion; assert.equal(retired.outcome, 'complete', 'input-model:final-retirement'); assert.equal(budget.diagnostics().accountedBytes, 0, 'input-model:final-reservations'); }
}
