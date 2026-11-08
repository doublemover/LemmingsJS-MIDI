import { captureCausalPerformanceState } from '../js/app/procgen/workstation/CausalPerformanceState.js';
import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';

const replacement = fixture => {
  const session = fixture.studio.capture('Imported frontier');
  session.project.procgen.seed = 91; session.project.procgen.lanes[0].gain = 0.375;
  session.world.seed = 91; session.settings.seed = 91;
  if (session.physicalState) session.physicalState = { ...session.physicalState, performanceInputs: captureCausalPerformanceState(session.project.procgen.lanes, session.project.procgen.actorTimbreLocks) };
  return session;
};
const expectAccepted = (fixture, session) => {
  expect(fixture.studio.getProject().procgen.seed).to.equal(91); expect(fixture.runtime.world.seed).to.equal(91);
  expect(fixture.studio.getProject().procgen.lanes[0].gain).to.equal(0.375);
  expect(fixture.studio.getDocumentState()).to.include({ id: null, revision: 0, dirty: true });
  expect(fixture.viewProps.getDocumentStatus().name).to.equal(session.name); expect(fixture.studio.handlers.historyState()).to.include({ undo: 0, redo: 0 });
  expect(fixture.studio.transport.getState().playing).to.equal(false); expect(fixture.studio.getOperationState()).to.equal(null);
};

describe('session document adoption at the accepted world frontier', () => {
  for (const point of ['output-identity', 'old-router', 'authoring-binding', 'camera', 'recording-view', 'render']) it('keeps the accepted document recoverable after ' + point + ' fails', async () => {
    const fixture = setup({ physicalOnly: true }); let failing = false;
    const subscribe = fixture.runtime.view.subscribeMidiPreviewRouter;
    fixture.runtime.view.subscribeMidiPreviewRouter = listener => { const release = subscribe.call(fixture.runtime.view, listener); return () => { if (failing && point === 'old-router') throw new Error('Old router retirement refused'); release(); }; };
    fixture.legacy.local.setPerformanceDocumentIdentity = () => { if (failing && point === 'output-identity') throw new Error('Output identity binding refused'); };
    fixture.studio.bindRuntime(); fixture.studio.transport.pause();
    const session = replacement(fixture), prior = fixture.runtime.world;
    fixture.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.75 } });
    if (point === 'camera') fixture.failCamera();
    if (point === 'recording-view') fixture.view.recording = () => { if (failing && fixture.runtime.world !== prior) throw new Error('Recording presentation refused'); };
    if (point === 'render') fixture.view.render = () => { if (failing && fixture.runtime.world !== prior) throw new Error('Render refused'); };
    const legacySet = fixture.legacy.setProject;
    fixture.legacy.setProject = (...args) => { const result = legacySet(...args); if (failing && point === 'authoring-binding' && fixture.runtime.world !== prior) fixture.runtime.world.configurePhysicalAuthoring = () => { throw new Error('Authoring consumer binding refused'); }; return result; };
    failing = true; let error;
    try { await fixture.studio.loadSession(session); } catch (value) { error = value; }
    try {
      expect(error).to.be.instanceOf(Error); expect(fixture.runtime.world).not.to.equal(prior); expectAccepted(fixture, session);
      const captured = fixture.studio.capture(); expect(captured.world.seed).to.equal(captured.project.procgen.seed); expect(captured.project.procgen.lanes[0].gain).to.equal(0.375);
      expect(await fixture.studio.handlers.undo()).to.equal(false);
    } finally { failing = false; await fixture.studio.dispose().completion; }
  });
  it('retains old document and history when restart refuses before world publication', async () => {
    const fixture = setup({ physicalOnly: true }); fixture.studio.bindRuntime(); fixture.studio.transport.pause(); const session = replacement(fixture);
    fixture.studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.75 } });
    const project = fixture.studio.getProject(), world = fixture.runtime.world, status = fixture.viewProps.getDocumentStatus(); fixture.failRestart();
    let error; try { await fixture.studio.loadSession(session); } catch (value) { error = value; }
    expect(error).to.be.instanceOf(Error); expect(fixture.studio.getProject()).to.equal(project); expect(fixture.runtime.world).to.equal(world);
    expect(fixture.viewProps.getDocumentStatus().name).to.equal(status.name); expect(fixture.studio.handlers.historyState().undo).to.equal(1); await fixture.studio.dispose().completion;
  });
  it('reuses one adoption when binding retries after an early external identity failure', async () => {
    const fixture = setup({ physicalOnly: true }); fixture.studio.bindRuntime(); fixture.studio.transport.pause(); const session = replacement(fixture); let fail = true;
    fixture.legacy.local.setPerformanceDocumentIdentity = () => { if (fail) throw new Error('Identity temporarily unavailable'); };
    try { await fixture.studio.loadSession(session); } catch { /* The accepted document stays inspectable. */ }
    const first = fixture.studio.getDocumentState(); fail = false;
    const project = fixture.studio.getProject(); fixture.studio.bindRuntime({ session: fixture.restarts.at(-1).session });
    expect(fixture.studio.getProject()).to.equal(project); expect(fixture.studio.getDocumentState().editRevision).to.equal(first.editRevision);
    expectAccepted(fixture, session); await fixture.studio.dispose().completion;
  });
  it('preserves the loaded document across a late durable save of its predecessor', async () => {
    const jobs = createTestBackgroundJobs(); let commit;
    const fixture = setup({ physicalOnly: true, backgroundJobs: jobs, storageOverride: { close() {}, saveDocument(id, revision) { return new Promise(resolve => { commit = () => resolve({ id, revision: revision + 1 }); }); } } });
    fixture.studio.bindRuntime(); fixture.studio.transport.pause(); const session = replacement(fixture); fixture.studio.play(); const saving = fixture.studio.handlers.save();
    for (let turns = 0; !commit; turns++) { if (turns > 128) throw new Error('Save did not reach its bounded write boundary'); await new Promise(resolve => setImmediate(resolve)); }
    expect(await fixture.studio.loadSession(session)).to.equal(true); commit(); await saving;
    expectAccepted(fixture, session); await fixture.studio.dispose().completion; jobs.dispose();
  });
});
