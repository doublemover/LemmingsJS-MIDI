import { expect } from 'chai';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createCausalObserverResources, causalObserverResourceProfile } from '../js/app/procgen/workstation/CausalObserverResources.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenPhysicalPlayback } from '../js/app/procgen/workstation/ProcgenPhysicalPlayback.js';

const empty = { version: 1, revision: 1, instruments: [] };
const source = tick => ({ version: 1, worldId: 'w', generation: 1, batchId: `b:${tick}`, tick, facts: [], completeness: { status: 'complete', dropped: 0 }, snapshot: { actors: [] } });
describe('shared physical observer reservation owners', () => {
  it('admits before graph access or observer allocation and retires once', () => {
    let reads = 0; const denied = createResourceBudget({ limitBytes: 4096 });
    expect(() => createCausalMusicEngine({ resourceBudget: denied, getGraph: () => { reads++; return empty; } })).to.throw('accounted bytes');
    expect(reads).to.equal(0); expect(denied.diagnostics().accountedBytes).to.equal(0);
    const budget = createResourceBudget({ limitBytes: 512 * 1048576 }), engine = createCausalMusicEngine({ resourceBudget: budget, getGraph: () => empty });
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); engine.processBatch(source(1));
    expect(engine.diagnostics().resources.estimated).to.equal(true); expect(engine.dispose()).to.equal(true); expect(engine.dispose()).to.equal(false);
    expect(budget.diagnostics().accountedBytes).to.equal(0); expect(() => engine.processBatch(source(2))).to.throw('disposed');
  });
  it('holds feature high water after removal and reserves simultaneous restore copies', () => {
    const budget = createResourceBudget({ limitBytes: 512 * 1048576 }), owner = createCausalObserverResources({ resourceBudget: budget, traceLimit: 0 });
    const initial = budget.diagnostics().accountedBytes;
    owner.admitGraph({ cargoStations: [{}], motifs: [{}] }); const extended = budget.diagnostics().accountedBytes;
    expect(extended).to.be.greaterThan(initial); owner.admitGraph(empty); expect(budget.diagnostics().accountedBytes).to.equal(extended);
    owner.stage('restore-copy', () => { expect(budget.diagnostics().accountedBytes).to.equal(extended * 2); });
    expect(budget.diagnostics().accountedBytes).to.equal(extended); owner.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('keeps failed graph growth and staged restore from mutating accepted state', () => {
    const profile = causalObserverResourceProfile(empty, { traceLimit: 0 }), capacity = Math.ceil((profile.stateBytes + profile.scratchBytes) * 1.25);
    const budget = createResourceBudget({ limitBytes: capacity + 4096 }), owner = createCausalObserverResources({ resourceBudget: budget, traceLimit: 0 });
    const before = owner.diagnostics(); expect(() => owner.admitGraph({ cargoStations: [{}] })).to.throw('accounted bytes');
    expect(owner.diagnostics()).to.deep.equal(before); let touched = false;
    expect(() => owner.stage('restore-copy', () => { touched = true; })).to.throw('accounted bytes'); expect(touched).to.equal(false); owner.dispose();
  });
  it('reuses an immutable boundary snapshot and retains it only until owner retirement', () => {
    const budget = createResourceBudget({ limitBytes: 512 * 1048576 }), engine = createCausalMusicEngine({ resourceBudget: budget, getGraph: () => empty });
    engine.processBatch(source(1)); const saved = engine.snapshot(), admitted = budget.diagnostics().reservations;
    expect(engine.snapshot()).to.equal(saved); expect(budget.diagnostics().reservations).to.equal(admitted);
    engine.processBatch(source(2)); expect(engine.snapshot()).not.to.equal(saved); expect(saved.physicalCursor.tick).to.equal(1);
    engine.restore(saved); expect(engine.snapshot()).to.deep.equal(saved); engine.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('fails closed when staging retirement does not acknowledge', () => {
    const actual = createResourceBudget({ limitBytes: 512 * 1048576 }), budget = { reserve: actual.reserve, release: () => false };
    const owner = createCausalObserverResources({ resourceBudget: budget });
    expect(() => owner.stage('snapshot-copy', () => 1)).to.throw('retirement');
    expect(() => owner.admitGraph(empty)).to.throw('retirement'); expect(() => owner.dispose()).to.throw('retirement');
    expect(owner.diagnostics().retirementError).to.be.a('string'); expect(actual.diagnostics().categories.candidate.pinned).to.equal(2);
  });
  it('unwinds already-created audio owners when initial interpreter admission fails', () => {
    const calls = [], backend = { prepare: async () => ({ status: 'ready' }), dispose() { calls.push('backend'); } };
    const session = { createInstrumentBackend: () => backend, dispose() { calls.push('session'); }, getState: () => ({ enabled: false }) };
    const audio = { createSession: () => session, getState: () => ({ enabled: false }), subscribe: () => () => calls.push('unsubscribe') };
    expect(() => createProcgenPhysicalPlayback({ audio, resourceBudget: createResourceBudget({ limitBytes: 4096 }), getGraph: () => empty })).to.throw('accounted bytes');
    expect(calls).to.include.members(['backend', 'session', 'unsubscribe']);
  });
});
