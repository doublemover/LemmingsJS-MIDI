import { expect } from 'chai';
import { createInstrumentMacroGestures } from '../../js/app/midi-ui/InstrumentMacroGestures.js';
import { captureCausalPerformanceState, diffCausalPerformanceState, createCausalPerformanceState } from '../../js/app/procgen/workstation/CausalPerformanceState.js';
const fixture = () => {
  const macros = ['a', 'b', 'c', 'd'].map(id => ({ id, mode: 'onset-only', default01: 0.5, bipolar: id === 'a' }));
  let lane = { id: 'lane:one', gain: 1, instrumentRef: { packHash: 'pack', definitionHash: 'definition', definition: { schemaVersion: 2, macros } }, instrumentControls: { macros: {} } }, epoch = 1;
  const commits = [], owner = createInstrumentMacroGestures({ getLane: id => id === lane.id ? lane : null, getDocumentEpoch: () => epoch,
    commit(id, controls, gestureId) { commits.push({ id, controls, gestureId }); lane = { ...lane, instrumentControls: controls }; } });
  return { owner, commits, lane: () => lane, change: value => { lane = { ...lane, ...value }; }, replaceDocument: () => epoch++ };
};
describe('bounded physical-onset macro gesture owner', () => {
  it('refuses gestures against opaque future patch metadata before interpreting it', () => {
    const f = fixture(); f.change({ instrumentRef: { ...f.lane().instrumentRef, definition: { schemaVersion: 99, macros: { futureOnly: true } } } });
    expect(() => f.owner.begin(f.lane().id, 'a')).to.throw('Only admitted onset-sampled macros'); expect(f.commits).to.have.length(0); f.owner.dispose();
  });
  it('coalesces rapid reversals to one canonical gesture without a preset or physical mutation during preview', () => {
    const f = fixture(), initial = f.lane(), handle = f.owner.begin(initial.id, 'a');
    for (const value of [0, 1, 0.1, 0.9, 0.375]) expect(f.owner.set(handle, value).physicalMutation).to.equal(false);
    expect(f.lane()).to.equal(initial); expect(f.commits).to.have.length(0);
    expect(f.owner.lanes([initial])[0].instrumentControls.macros.a).to.equal(0.375);
    f.change({ gain: 0.6, instrumentControls: { macros: { b: 0.7 } } });
    expect(f.owner.finish(handle).canonicalEdit).to.equal(true); expect(f.commits).to.have.length(1);
    expect(f.lane().gain).to.equal(0.6); expect(f.lane().instrumentControls.macros).to.deep.equal({ a: 0.375, b: 0.7 });
    expect(() => f.owner.finish(handle)).to.throw('lease'); f.owner.dispose();
  });
  it('returns normalized bipolar model pressure to saved baseline without history and never creates autonomous notes', () => {
    const f = fixture(), handle = f.owner.begin(f.lane().id, 'a', { momentary: true, origin: 'pressure' });
    expect(f.owner.pressure(handle, -0.8).requested01).to.be.closeTo(0.1, 1e-12);
    expect(f.owner.pressure(handle, 0.8).requested01).to.equal(0.9);
    expect(f.owner.finish(handle).state).to.equal('returned'); expect(f.commits).to.have.length(0);
    expect(f.owner.lanes([f.lane()])[0]).to.equal(f.lane());
    const unipolar = f.owner.begin(f.lane().id, 'b'); expect(() => f.owner.pressure(unipolar, -0.1)).to.throw('bipolar');
    f.owner.cancelAll(); expect(f.owner.diagnostics().active).to.equal(0); f.owner.dispose();
  });
  it('fences previews against exact patch, parameter baseline and document but not unrelated controls', () => {
    const f = fixture(), start = () => f.owner.begin(f.lane().id, 'a'); let handle = start(); f.owner.set(handle, 0.8);
    const proposed = { ...f.lane(), instrumentControls: { macros: { a: 0.2, b: 0.7 } } };
    expect(f.owner.lanes([proposed])[0]).to.equal(proposed);
    f.change({ instrumentControls: proposed.instrumentControls }); expect(() => f.owner.set(handle, 0.9)).to.throw('lease');
    handle = start(); f.replaceDocument(); expect(() => f.owner.finish(handle)).to.throw('lease');
    handle = start(); f.change({ instrumentRef: { ...f.lane().instrumentRef, definitionHash: 'new' } }); expect(() => f.owner.finish(handle)).to.throw('lease');
    expect(f.commits).to.have.length(0); f.owner.dispose();
  });
  it('requires selected endpoint/epoch pickup and commits the exact final controller value once on disconnect', () => {
    const f = fixture(), scope = { endpointId: 'input', endpointEpoch: 2 }, laneId = f.lane().id;
    f.owner.bindController(laneId, 'a', { ...scope, channel: 1, controller: 74 });
    const cc = value => ({ type: 'cc', controller: 74, channel: 1, value });
    expect(f.owner.observeController(cc(127), { ...scope, endpointEpoch: 1 }).matched).to.equal(0);
    expect(f.owner.observeController(cc(0), scope).matched).to.equal(0);
    expect(f.owner.state(laneId, 'a').pickup01).to.equal(0);
    expect(f.owner.observeController(cc(90), scope).matched).to.equal(1);
    f.owner.observeController(cc(93), scope); expect(f.commits).to.have.length(0);
    f.owner.disconnect('input', 2); expect(f.commits).to.have.length(1); expect(f.lane().instrumentControls.macros.a).to.equal(93 / 127);
    f.owner.disconnect('input', 2); expect(f.commits).to.have.length(1); f.owner.dispose();
  });
  it('returns pressure on zero/disconnect and resists stale controller gesture ownership after a manual replacement', () => {
    const f = fixture(), scope = { endpointId: 'input', endpointEpoch: 2 }, laneId = f.lane().id;
    f.owner.bindController(laneId, 'a', { ...scope, channel: 1, type: 'pressure' });
    f.owner.observeController({ type: 'pressure', channel: 1, value: 127 }, scope); expect(f.owner.lanes([f.lane()])[0].instrumentControls.macros.a).to.equal(1);
    const manual = f.owner.begin(laneId, 'a'); f.owner.set(manual, 0.1);
    f.owner.observeController({ type: 'pressure', channel: 1, value: 60 }, scope);
    expect(() => f.owner.set(manual, 0.2)).to.throw('lease');
    f.owner.observeController({ type: 'pressure', channel: 1, value: 0 }, scope); expect(f.owner.diagnostics().active).to.equal(0);
    f.owner.disconnect('input', 2); expect(f.commits).to.have.length(0); f.owner.dispose();
  });
  it('replays sampled controls with interleaved canonical mix edits and momentary return, not raw UI event counts', () => {
    const f = fixture(), initial = captureCausalPerformanceState([f.lane()]), replay = createCausalPerformanceState(initial);
    let previous = initial; const record = lanes => { const next = captureCausalPerformanceState(f.owner.lanes(lanes)); const delta = diffCausalPerformanceState(previous, next); if (delta) replay.apply(delta); previous = next; return delta; };
    const h = f.owner.begin(f.lane().id, 'a', { momentary: true }); f.owner.set(h, 0.8); record([f.lane()]);
    f.change({ gain: 0.3 }); record([f.lane()]); expect(replay.getControls(f.lane().id).macros.a).to.equal(0.8); expect(replay.getMix(f.lane().id).gain).to.equal(0.3);
    f.owner.finish(h); record([f.lane()]); expect(replay.snapshot()).to.deep.equal(captureCausalPerformanceState([f.lane()])); f.owner.dispose();
  });
  it('exposes unsupported continuous macro modes rather than decorative movement', () => {
    const f = fixture(); f.change({ instrumentRef: { ...f.lane().instrumentRef, definition: { schemaVersion: 2, macros: [{ id: 'live', default01: 0.5, mode: 'continuous' }] } } });
    expect(() => f.owner.begin(f.lane().id, 'live')).to.throw('unsupported'); f.owner.dispose();
  });
});
