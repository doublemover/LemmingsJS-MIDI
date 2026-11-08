import assert from 'node:assert/strict';
import { setup } from '../helpers/workstation-fixture.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };

export async function replaySaveSchedule({ seed, phase, interruption, failWrite = false, editCount = 1 + seed % 3 }, { workstationFactory } = {}) {
  assert.ok(['prompt', 'preferences', 'write'].includes(phase)); assert.ok(['none', 'pause', 'stop', 'new', 'dispose'].includes(interruption));
  const name = deferred(), entered = deferred(), write = deferred(), preferenceEntered = deferred(), retiredPreference = deferred(), timers = [], documents = new Map(), events = [];
  let holdPreference = phase === 'preferences', fixture, selectedWorld, selectedDocument, selectedProject, disposed = false, saving, capturedNote, capturedSeed, afterDisposeStatus, afterDisposeStorage;
  let word = seed >>> 0, edited = false;
  const nextNote = () => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return 24 + (word >>> 0) % 80; };
  const storage = {
    async saveDocument(id, revision, session) {
      capturedNote = session.project.procgen.lanes[0].patterns[0].steps[0].note; capturedSeed = session.world.seed; entered.resolve(); await write.promise;
      if (failWrite) throw new Error('Modeled durable write refused');
      documents.set(id, { revision: revision + 1, session }); return { id, revision: revision + 1 };
    },
    async savePreferences(_value, { signal }) {
      if (!holdPreference) return { durable: true };
      holdPreference = false; preferenceEntered.resolve();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Modeled preference cancellation'), { backgroundRetirementCompletion: retiredPreference.promise }));
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    }, close() {}
  };
  const note = () => fixture.studio.getProject().procgen.lanes[0].patterns?.[0]?.steps?.[0]?.note ?? null;
  const record = label => {
    const state = fixture.studio.getDocumentState();
    if (!disposed && interruption !== 'new') assert.equal(fixture.runtime.world, selectedWorld, label + ' world owner');
    if (disposed) { assert.equal(fixture.statuses.length, afterDisposeStatus, label + ' cannot publish after dispose'); assert.equal(fixture.storageReceipts.length, afterDisposeStorage, label + ' cannot publish storage after dispose'); }
    events.push({ label, playing: fixture.studio.transport.getState().playing, id: state.id, revision: state.revision, dirty: state.dirty, note: note(), stored: documents.size });
  };
  try {
    fixture = setup({ workstationFactory, storageOverride: storage, windowTimers: {
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout(id) { timers[id - 1] = null; }
    } });
    fixture.studio.bindRuntime(); selectedWorld = fixture.runtime.world; selectedProject = fixture.studio.getProject(); selectedDocument = fixture.studio.getDocumentState();
    fixture.view.requestProjectName = () => name.promise;
    if (phase === 'preferences') { const pending = timers.find(timer => timer?.delay === 250); assert.ok(pending); pending.callback(); await preferenceEntered.promise; }
    saving = fixture.studio.handlers.save(); record('save-started'); assert.equal(fixture.studio.transport.getState().playing, false);
    if (phase !== 'prompt') name.resolve('Model ' + seed);
    if (phase === 'preferences') { await settle(); assert.equal(fixture.studio.getPreferenceState().suspended, true); }
    if (phase === 'write') await entered.promise;
    for (let index = 0; index < editCount; index++) {
      fixture.studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: 0, patch: { note: nextNote() } }); edited = true; record('edit-' + index);
    }
    const sourceNote = note();
    if (interruption === 'pause') fixture.studio.transport.pause();
    else if (interruption === 'stop') fixture.studio.transport.stop();
    else if (interruption === 'new') { const replacing = fixture.studio.handlers.new(); retiredPreference.resolve({ phase: 'canceled' }); assert.equal(await replacing, true); fixture.studio.transport.pause(); selectedWorld = fixture.runtime.world; selectedProject = fixture.studio.getProject(); selectedDocument = fixture.studio.getDocumentState(); }
    else if (interruption === 'dispose') { selectedProject = fixture.studio.getProject(); void fixture.studio.dispose(); disposed = true; afterDisposeStatus = fixture.statuses.length; afterDisposeStorage = fixture.storageReceipts.length; }
    record('interruption-' + interruption);
    name.resolve('Model ' + seed); retiredPreference.resolve({ phase: 'canceled' });
    if (!['new', 'dispose'].includes(interruption) || phase === 'write') await entered.promise;
    write.resolve(); const accepted = await saving; await settle(); record('save-settled');
    assert.equal(fixture.studio.transport.getState().playing, interruption === 'none', 'only the original unexpired resume lease may restart transport');
    const shouldWrite = phase === 'write' || !['new', 'dispose'].includes(interruption);
    assert.equal(documents.size, Number(shouldWrite && !failWrite), 'durable source inventory');
    if (shouldWrite) { assert.equal(capturedSeed, 7); if (phase !== 'write') assert.equal(capturedNote, sourceNote, 'capture includes accepted edits before admission'); }
    if (['new', 'dispose'].includes(interruption)) {
      assert.equal(fixture.runtime.world, selectedWorld); assert.equal(fixture.studio.getProject(), selectedProject);
      assert.equal(fixture.studio.getDocumentState().id, selectedDocument.id);
    } else {
      assert.equal(note(), sourceNote);
      assert.equal(fixture.studio.getDocumentState().dirty, failWrite || phase === 'write' && edited);
      if (!failWrite) assert.equal(fixture.studio.getDocumentState().revision, 1);
    }
    return { seed, phase, interruption, failWrite, accepted, events, capturedNote, capturedSeed, durableDocuments: documents.size };
  } catch (error) { error.saveSchedule = { seed, phase, interruption, failWrite, events }; throw error; }
  finally {
    name.resolve(null); retiredPreference.resolve({ phase: 'canceled' }); write.resolve();
    if (saving) await saving;
    if (fixture) await fixture.studio.dispose().completion;
  }
}
