import assert from 'node:assert/strict';
import { createTestBackgroundJobs } from '../helpers/background-worker.js';
import { setup } from '../helpers/workstation-fixture.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
const gainValue = value => Number.isFinite(value) && value >= 0 && value <= 2;

export function createControllerReference() {
  const state = { generation: 0, seed: 7, gain: 1, playing: false, undo: [], redo: [], version: 0, savedVersion: -1, documentId: null, revision: 0, name: 'Untitled session', stopRevision: 0, disposed: false };
  const saves = new Map();
  const apply = command => {
    if (!command || typeof command.kind !== 'string') return false;
    if (command.kind === 'settle-save') {
      const job = saves.get(command.id); if (!job || job.settled || !['success', 'failure'].includes(command.outcome)) return false;
      job.settled = true;
      if (!state.disposed && job.generation === state.generation) {
        if (command.outcome === 'success') { state.savedVersion = job.version; state.name = job.name; }
        if (job.wasPlaying && state.stopRevision === job.stopRevision) state.playing = true;
      }
      return true;
    }
    if (state.disposed) return false;
    if (command.kind === 'gain') {
      if (!gainValue(command.value) || command.value === state.gain) return false;
      state.undo.push(state.gain); state.redo.length = 0; state.gain = command.value; state.version++;
    } else if (command.kind === 'undo' || command.kind === 'redo') {
      if (state.playing) return false;
      const from = command.kind === 'undo' ? state.undo : state.redo, to = command.kind === 'undo' ? state.redo : state.undo;
      if (!from.length) return false; to.push(state.gain); state.gain = from.pop(); state.version++;
    } else if (command.kind === 'play') state.playing = true;
    else if (command.kind === 'pause') { state.playing = false; state.stopRevision++; }
    else if (command.kind === 'seek') { if (!Number.isFinite(command.beat) || command.beat < 0 || command.beat > 1000000) return false; }
    else if (command.kind === 'save') {
      if (typeof command.id !== 'string' || !command.id || command.id.length > 64 || saves.has(command.id) || [...saves.values()].filter(job => !job.settled).length >= 8 || [...saves.values()].some(job => !job.settled && job.generation === state.generation) || typeof command.name !== 'string' || !command.name.trim() || command.name.length > 64) return false;
      const job = { generation: state.generation, seed: state.seed, gain: state.gain, version: state.version, name: state.documentId ? state.name : command.name, wasPlaying: state.playing, stopRevision: ++state.stopRevision, settled: false };
      saves.set(command.id, job); state.playing = false;
    } else if (['new', 'new-refused', 'new-presentation-error'].includes(command.kind)) {
      if (!Number.isSafeInteger(command.seed) || command.seed < 1 || command.seed > 0xffffffff || command.seed === state.seed) return false;
      state.stopRevision++;
      if (command.kind !== 'new-refused') { state.generation++; state.seed = command.seed; state.gain = 1; state.undo.length = 0; state.redo.length = 0; state.version++; state.savedVersion = -1; state.documentId = null; state.revision = 0; state.name = 'Untitled session'; if (command.kind === 'new-presentation-error') state.playing = false; }
    } else if (command.kind === 'dispose') { state.disposed = true; state.playing = false; state.stopRevision++; }
    else return false;
    return true;
  };
  return { state, saves, apply };
}

export function generateControllerTrace(seed, { steps = 48 } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(steps) || steps < 1 || steps > 128) throw new TypeError('Invalid controller model bounds.');
  const model = createControllerReference(), trace = []; let word = seed || 1, serial = 0;
  const draw = maximum => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) % maximum; };
  for (let index = 0; index < steps; index++) {
    const state = model.state, pending = [...model.saves].filter(([, job]) => !job.settled), choices = [];
    for (const [id] of pending) choices.push({ kind: 'settle-save', id, outcome: draw(4) ? 'success' : 'failure' });
    if (!state.disposed) {
      let gain = draw(17) / 8; if (gain === state.gain) gain = gain === 2 ? 0 : gain + 0.125;
      choices.push({ kind: 'gain', value: gain }, { kind: 'play' }, { kind: 'pause' }, { kind: 'seek', beat: draw(64) / 4 });
      if (!state.playing && state.undo.length) choices.push({ kind: 'undo' }); if (!state.playing && state.redo.length) choices.push({ kind: 'redo' });
      if (pending.length < 8 && !pending.some(([, job]) => job.generation === state.generation)) choices.push({ kind: 'save', id: 'save-' + serial++, name: 'Model save ' + serial });
      let nextSeed = draw(0x7ffffffe) + 1; if (nextSeed === state.seed) nextSeed++;
      choices.push({ kind: 'new', seed: nextSeed }, { kind: 'new-refused', seed: nextSeed });
      if (index > steps / 2) choices.push({ kind: 'new-presentation-error', seed: nextSeed });
      if (index > steps * 0.75 && pending.length) choices.push({ kind: 'dispose' });
    }
    if (!choices.length) break; const command = choices[draw(choices.length)]; if (!model.apply(command)) throw new Error('controller-model:generator-precondition'); trace.push(command);
  }
  if (!model.state.disposed) { model.apply({ kind: 'dispose' }); trace.push({ kind: 'dispose' }); }
  for (const [id, job] of model.saves) if (!job.settled) { const command = { kind: 'settle-save', id, outcome: draw(2) ? 'success' : 'failure' }; model.apply(command); trace.push(command); }
  return trace;
}

export async function replayControllerTrace(trace, { checkBudget = () => {}, workstationFactory } = {}) {
  if (!Array.isArray(trace) || !trace.length || trace.length > 512) return { valid: false, step: 0 };
  const model = createControllerReference(), jobs = new Map(), documents = new Map(), observations = []; let capturing = null, fixture, retirement = null, index = 0;
  const storage = { close() {}, saveDocument(id, expectedRevision, session) {
    const job = capturing; assert.ok(job && !job.native, 'controller-model:save-owner');
    assert.equal(documents.get(id)?.revision || 0, expectedRevision, 'controller-model:stored-revision');
    job.native = { id, revision: expectedRevision + 1, session: structuredClone(session) };
    return new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  } };
  const modelJobs = createTestBackgroundJobs();
  fixture = setup({ storageOverride: storage, physicalOnly: true, workstationFactory, backgroundJobs: modelJobs }); fixture.studio.bindRuntime(); fixture.studio.transport.pause();
  const settle = async predicate => { for (let turn = 0; !predicate(); turn++) { if (turn >= 128) throw new Error('controller-model:bounded-settlement'); checkBudget(); await flush(); } };
  const inspect = () => {
    const state = model.state, project = fixture.studio.getProject(), document = fixture.studio.getDocumentState(), status = fixture.viewProps.getDocumentStatus(), history = fixture.studio.handlers.historyState();
    assert.equal(project.procgen.seed, state.seed, 'controller-model:canonical-seed'); assert.equal(project.procgen.lanes[0].gain, state.gain, 'controller-model:canonical-gain');
    assert.equal(fixture.runtime.world.seed, state.seed, 'controller-model:world-seed'); assert.equal(fixture.runtime.world.laneCount, project.procgen.lanes.length, 'controller-model:world-project-lanes');
    assert.equal(fixture.studio.transport.getState().playing, state.playing, 'controller-model:transport-owner'); assert.equal(document.id, state.documentId, 'controller-model:document-identity'); assert.equal(document.revision, state.revision, 'controller-model:document-revision');
    assert.equal(document.dirty, state.version !== state.savedVersion, 'controller-model:dirty-snapshot'); assert.equal(status.name, state.name, 'controller-model:document-name');
    assert.equal(history.undo, state.undo.length, 'controller-model:undo-document-scope'); assert.equal(history.redo, state.redo.length, 'controller-model:redo-document-scope');
    assert.equal(fixture.studio.getOperationState(), null, 'controller-model:no-permanent-operation');
    if (state.disposed) { assert.equal(fixture.physicalOwner, null, 'controller-model:retired-control-owner'); assert.equal(fixture.view.disposed, true, 'controller-model:retired-view'); }
    observations.push({ step: index, seed: state.seed, gain: state.gain, document: { id: document.id, revision: document.revision, dirty: document.dirty, name: status.name }, history: { undo: history.undo, redo: history.redo }, playing: state.playing, disposed: state.disposed, pendingSaves: [...jobs.values()].filter(job => !job.settled).length });
  };
  try {
    inspect();
    for (const command of trace) {
      checkBudget(); const priorWorld = fixture.runtime.world;
      if (!model.apply(command)) return { valid: false, step: index };
      const state = model.state;
      if (command.kind === 'gain') fixture.studio.dispatch({ type: 'procgen/lane', laneId: fixture.studio.getProject().procgen.lanes[0].id, patch: { gain: command.value } });
      else if (command.kind === 'undo' || command.kind === 'redo') assert.equal(await fixture.studio.handlers[command.kind](), true, 'controller-model:history-admission');
      else if (command.kind === 'play') fixture.studio.play();
      else if (command.kind === 'pause') fixture.studio.transport.pause();
      else if (command.kind === 'seek') { fixture.studio.transport.seek(command.beat); assert.equal(fixture.studio.transport.getState().beat, command.beat, 'controller-model:seek-position'); }
      else if (command.kind === 'save') {
        const expected = model.saves.get(command.id), job = { ...expected, settled: false, returned: false, native: null }; jobs.set(command.id, job); capturing = job; fixture.window.prompt = () => job.name;
        job.promise = fixture.studio.handlers.save().then(value => { job.returned = true; job.value = value; }, error => { job.returned = true; job.error = error; });
        await settle(() => !!job.native || job.returned); capturing = null; assert.ok(job.native, 'controller-model:save-write-boundary');
        assert.equal(job.native.session.project.procgen.seed, job.seed, 'controller-model:captured-save-seed'); assert.equal(job.native.session.project.procgen.lanes[0].gain, job.gain, 'controller-model:captured-save-gain');
      } else if (command.kind === 'settle-save') {
        const job = jobs.get(command.id); job.settled = true;
        if (command.outcome === 'success') { documents.set(job.native.id, structuredClone(job.native)); job.resolve({ id: job.native.id, revision: job.native.revision }); }
        else job.reject(new Error('Modeled storage publication refusal'));
        await job.promise; if (job.error) throw job.error;
        if (command.outcome === 'success' && !state.disposed && job.generation === state.generation) { state.documentId = job.native.id; state.revision = job.native.revision; }
      } else if (command.kind.startsWith('new')) {
        fixture.window.crypto.getRandomValues = bytes => { bytes.fill(0); bytes[0] = command.seed; return bytes; };
        const present = fixture.view.recording; if (command.kind === 'new-refused') fixture.failRestart(true); if (command.kind === 'new-presentation-error') fixture.view.recording = (...args) => { if (fixture.runtime.world !== priorWorld) throw new Error('Modeled post-commit recording presentation refusal'); return present?.(...args); };
        try { assert.equal(await fixture.studio.handlers.new(), command.kind === 'new', 'controller-model:replacement-result'); }
        finally { fixture.failRestart(false); fixture.view.recording = present; }
        assert.equal(fixture.runtime.world === priorWorld, command.kind === 'new-refused', 'controller-model:world-commit-frontier');
      } else if (command.kind === 'dispose') retirement = fixture.studio.dispose();
      await flush(); inspect(); index++;
    }
    if (model.state.disposed && [...jobs.values()].every(job => job.settled)) await retirement.completion;
    return { valid: true, transitions: index, trace, observations, complete: model.state.disposed && [...jobs.values()].every(job => job.settled), documents: documents.size, generations: model.state.generation };
  } catch (error) { error.modelTrace = trace.slice(0, index + 1); error.modelObservations = observations; throw error; }
  finally {
    const closing = fixture.studio.dispose(); modelJobs.dispose();
    for (const job of jobs.values()) if (!job.settled && job.native) { job.settled = true; job.reject(new Error('Model owner retired')); }
    await Promise.allSettled([...jobs.values()].map(job => job.promise)); await closing.completion;
  }
}
