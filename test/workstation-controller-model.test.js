import { createProcgenWorkstation } from '../js/app/procgen/workstation/ProcgenWorkstation.js';
import { setup } from './helpers/workstation-fixture.js';
import { expect } from 'chai';
import { generateControllerTrace, replayControllerTrace } from './support/workstation-controller-model.js';

describe('coupled document, history, save and transport controller reference', function() {
  this.timeout(30000);
  for (const seed of [1, 17, 101, 997, 4201, 9991186, 0xc47a31, 0x7fffffff]) it('preserves document/history/transport owners across mixed actions seed=' + seed, async () => {
    const result = await replayControllerTrace(generateControllerTrace(seed, { steps: 48 })); expect(result).to.include({ valid: true, complete: true });
  });
  it('keeps an acknowledged save clean after a refused candidate without inventing accepted edits (#1271)', async () => {
    const trace = [{ kind: 'save', id: 'held', name: 'Held save' }, { kind: 'new-refused', seed: 91 }, { kind: 'settle-save', id: 'held', outcome: 'success' }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, generations: 0, documents: 1 });
  });
  it('preserves a newer paused document and its history when a prior save acknowledges late', async () => {
    const trace = [{ kind: 'gain', value: 0.5 }, { kind: 'play' }, { kind: 'save', id: 'old', name: 'Older project' }, { kind: 'new', seed: 91 }, { kind: 'pause' }, { kind: 'gain', value: 0.75 },
      { kind: 'settle-save', id: 'old', outcome: 'success' }, { kind: 'undo' }, { kind: 'redo' }, { kind: 'save', id: 'current', name: 'Current project' }, { kind: 'gain', value: 0.875 },
      { kind: 'settle-save', id: 'current', outcome: 'success' }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, documents: 2, generations: 1 });
  });
  it('retains a failed replacement’s current history and adopts fresh identity before optional presentation fails', async () => {
    const trace = [{ kind: 'gain', value: 0.25 }, { kind: 'save', id: 'named', name: 'Named source' }, { kind: 'settle-save', id: 'named', outcome: 'success' },
      { kind: 'gain', value: 0.5 }, { kind: 'new-refused', seed: 91 }, { kind: 'undo' }, { kind: 'redo' }, { kind: 'new-presentation-error', seed: 92 }, { kind: 'gain', value: 0.75 }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, generations: 1 });
  });
  it('settles old native writes after disposal without republishing the document or resuming transport', async () => {
    const trace = [{ kind: 'play' }, { kind: 'save', id: 'retired', name: 'Retired save' }, { kind: 'dispose' }, { kind: 'settle-save', id: 'retired', outcome: 'success' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, documents: 1 });
  });
  it('rejects deleted-owner and unchanged-gain traces during minimization', async () => {
    expect(await replayControllerTrace([{ kind: 'settle-save', id: 'missing', outcome: 'success' }])).to.include({ valid: false });
    expect(await replayControllerTrace([{ kind: 'gain', value: 1 }])).to.include({ valid: false });
  });
});

describe('coupled controller import read and publication reference', function() {
  this.timeout(30000);
  for (const outcome of ['success', 'read-failure', 'malformed', 'restart-refused', 'presentation-error']) it('preserves latest-selection ownership when an older import finishes with ' + outcome, async () => {
    const trace = [{ kind: 'gain', value: 0.25 }, { kind: 'play' }, { kind: 'save', id: 'saved-before-import', name: 'Before import' },
      { kind: 'import', id: 'older', seed: 51, gain: 0.5, name: 'Older selection' }, { kind: 'import', id: 'current', seed: 91, gain: 0.75, name: 'Current selection' },
      { kind: 'settle-import', id: 'current', outcome: 'success' }, { kind: 'gain', value: 0.875 }, { kind: 'settle-save', id: 'saved-before-import', outcome: 'success' },
      { kind: 'settle-import', id: 'older', outcome }, { kind: 'undo' }, { kind: 'redo' }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, acceptedImports: 1, generations: 1, documents: 1 });
  });
  for (const outcome of ['success', 'read-failure', 'malformed']) it('retains current edited state when a held import completes with ' + outcome, async () => {
    const trace = [{ kind: 'import', id: 'edited-source', seed: 91, gain: 0.5, name: 'Source before edits' }, { kind: 'gain', value: 0.75 },
      { kind: 'settle-import', id: 'edited-source', outcome }, { kind: 'undo' }, { kind: 'redo' }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, acceptedImports: 0, generations: 0 });
  });
  for (const outcome of ['read-failure', 'malformed', 'restart-refused', 'presentation-error']) it('records the exact document commit frontier for current import ' + outcome, async () => {
    const trace = [{ kind: 'gain', value: 0.25 }, { kind: 'import', id: 'candidate', seed: 91, gain: 0.625, name: 'Candidate' },
      { kind: 'settle-import', id: 'candidate', outcome }, { kind: 'dispose' }];
    const accepted = Number(outcome === 'presentation-error'); expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, acceptedImports: accepted, generations: accepted });
  });
  it('joins both selected file reads after disposal without creating a replacement world', async () => {
    const trace = [{ kind: 'import', id: 'older', seed: 51, gain: 0.5, name: 'Older' }, { kind: 'import', id: 'current', seed: 91, gain: 0.75, name: 'Current' },
      { kind: 'dispose' }, { kind: 'settle-import', id: 'current', outcome: 'success' }, { kind: 'settle-import', id: 'older', outcome: 'malformed' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, acceptedImports: 0, generations: 0 });
  });
  it('preserves a fresh New document across an older import and save acknowledgment', async () => {
    const trace = [{ kind: 'play' }, { kind: 'save', id: 'old-save', name: 'Old save' }, { kind: 'import', id: 'old-file', seed: 51, gain: 0.5, name: 'Old file' },
      { kind: 'new', seed: 91 }, { kind: 'pause' }, { kind: 'gain', value: 0.625 }, { kind: 'settle-import', id: 'old-file', outcome: 'success' },
      { kind: 'settle-save', id: 'old-save', outcome: 'success' }, { kind: 'undo' }, { kind: 'dispose' }];
    expect(await replayControllerTrace(trace)).to.include({ valid: true, complete: true, acceptedImports: 0, generations: 1, documents: 1 });
  });
  it('rejects missing import owners and a third unresolved read during shrinking', async () => {
    expect(await replayControllerTrace([{ kind: 'settle-import', id: 'missing', outcome: 'success' }])).to.include({ valid: false });
    const trace = ['a', 'b', 'c'].map((id, index) => ({ kind: 'import', id, seed: index + 51, gain: 0.5, name: id }));
    expect(await replayControllerTrace(trace)).to.include({ valid: false, step: 2 });
  });
});


describe('world replacement transport ownership (#1268)', function() {
  const fixtureForBootBinding = () => {
    let studio;
    return setup({ physicalOnly: true, workstationFactory: options => {
      studio = createProcgenWorkstation({ ...options, restart: async request => { const result = await options.restart(request); if (result !== false) { studio.beforeRestart(); studio.bindRuntime({ session: request.session }); } return result; } }); return studio;
    } });
  };
  const awaitRestart = async fixture => { for (let turn = 0; !fixture.restarts.length && turn < 64; turn++) await new Promise(resolve => setImmediate(resolve)); expect(fixture.restarts).to.have.length(1); };
  for (const action of ['new', 'replay']) {
    it('keeps paused ' + action + ' paused after refusal and a successful retry', async () => {
      const fixture = fixtureForBootBinding(); fixture.studio.bindRuntime(); fixture.studio.transport.pause(); const prior = fixture.runtime.world;
      try {
        fixture.failRestart(true); expect(await fixture.studio.handlers[action]()).to.equal(false); expect(fixture.runtime.world).to.equal(prior); expect(fixture.studio.transport.getState().playing).to.equal(false);
        fixture.failRestart(false); expect(await fixture.studio.handlers[action]()).to.equal(true); expect(fixture.runtime.world).not.to.equal(prior); expect(fixture.studio.transport.getState().playing).to.equal(false);
      } finally { await fixture.studio.dispose().completion; }
    });
    for (const refuse of [false, true]) it('preserves Pause during pending ' + action + ' when preparation ' + (refuse ? 'fails' : 'succeeds'), async () => {
      const fixture = fixtureForBootBinding(); fixture.studio.bindRuntime(); fixture.studio.play(); const release = fixture.holdRestart(); fixture.failRestart(refuse);
      const pending = fixture.studio.handlers[action]();
      try { await awaitRestart(fixture); fixture.studio.transport.pause(); release(); expect(await pending).to.equal(!refuse); expect(fixture.studio.transport.getState().playing).to.equal(false); }
      finally { release(); await pending; await fixture.studio.dispose().completion; }
    });
    it('resumes playing ' + action + ' only when its resume ownership remains current', async () => {
      const fixture = fixtureForBootBinding(); fixture.studio.bindRuntime(); fixture.studio.play();
      try { expect(await fixture.studio.handlers[action]()).to.equal(true); expect(fixture.studio.transport.getState().playing).to.equal(true); }
      finally { await fixture.studio.dispose().completion; }
    });
  }
});
