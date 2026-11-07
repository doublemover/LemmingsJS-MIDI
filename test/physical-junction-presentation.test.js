import { expect } from 'chai';
import { createPhysicalJunctionPresentation } from '../js/app/procgen/workstation/PhysicalJunctionPresentation.js';
import { junctionPresentationWorld, junctionDefinition } from './helpers/junctionPresentationWorld.js';
import { prepareProjectJunctions } from '../js/app/procgen/workstation/PhysicalJunctionProject.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { captureProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
import { hashProcgenPhysicsCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpointProvenance.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';

const fixture = () => { const f = junctionPresentationWorld(); const observer = createPhysicalJunctionPresentation(f); observer.select('switch'); return { ...f, observer }; };
describe('source-bound physical junction presentation', () => {
  it('keeps requested and applied configurations separate from observed inlet-to-outlet motion', () => {
    const f = fixture(); f.state.pending = [{ requestId: 'request:two', desiredConfiguration: 'closed', state: 'waiting', reason: 'occupied', expiryTick: 120 }];
    expect(f.observer.read()).to.include({ currentCrossings: 0, trackedActors: 0 }); expect(f.observer.read().state.actual.configurationId).to.equal('open');
    const entry = f.emit([{ from: 89, to: 95 }]); expect(f.observer.read().observed).to.have.length(0);
    const exit = f.emit([{ from: 95, to: 111 }]), result = f.observer.read(); expect(result.currentCrossings).to.equal(1);
    expect(result.observed[0]).to.include({ inletId: 'in', outletId: 'out', entryCauseId: entry.facts[0].eventId, exitCauseId: exit.facts[0].eventId, commandId: 'apply:one', configurationId: 'open', trailComplete: true });
    expect(result.pending[0].remainingTicks).to.equal(118); expect(f.state.actual.configurationId).to.equal('open'); f.observer.dispose();
  });
  it('requires an observed inlet after selection and does not relabel downstream actors after switching', () => {
    const f = fixture(); f.emit([{ from: 105, to: 111 }]); expect(f.observer.read().observed).to.have.length(0);
    f.emit([{ from: 89, to: 111 }]); expect(f.observer.read().currentCrossings).to.equal(1);
    f.emit([{ from: 89, to: 95, actorId: 2 }]); f.state.actual = { ...f.state.actual, commandId: 'apply:two', configurationId: 'closed', appliedTick: f.world.tickIndex };
    f.emit([{ from: 95, to: 111, actorId: 2 }]); const result = f.observer.read(); expect(result.currentCrossings).to.equal(0); expect(result.observed).to.have.length(1);
    expect(result.observed[0].commandId).to.equal('apply:one'); expect(result.gap).to.include('already downstream');
    f.emit([{ from: 89, to: 111, actorId: 3 }]); expect(f.observer.read().currentCrossings).to.equal(1); f.observer.dispose();
  });
  for (const failure of ['endpoint', 'incomplete', 'coordinates', 'stale', 'tick-gap', 'foreign-fact']) it(`keeps route uncertainty after ${failure} evidence`, () => {
    const f = fixture(); f.emit([{ from: 89, to: 95 }]);
    if (failure === 'endpoint') f.emit([{ from: 95, to: 100, precision: 'endpoint-chord' }]);
    if (failure === 'incomplete') f.emit([], { status: 'incomplete' });
    if (failure === 'coordinates') f.emit([{ from: 97, to: 100 }]);
    if (failure === 'stale') { f.state.actual.status = 'stale-geometry'; f.emit([{ from: 95, to: 100 }]); }
    if (failure === 'tick-gap') f.emit([{ from: 95, to: 100 }], { tick: f.world.tickIndex + 2 });
    if (failure === 'foreign-fact') f.emit([{ from: 95, to: 100, fact: { worldId: 'foreign' } }]);
    f.emit([{ from: 100, to: 111 }]); expect(f.observer.read().observed).to.have.length(0); expect(f.observer.read().gap).to.be.a('string'); f.observer.dispose();
  });
  it('ignores duplicate batches and requires the exact port anchor envelope and direction', () => {
    const f = fixture(); const batch = f.emit([{ from: 89, to: 111 }]); f.world.soundEvents.onBatch.trigger(batch); expect(f.observer.read().observed).to.have.length(1);
    f.emit([{ from: 89, to: 111, y: 69 }]); f.emit([{ from: 111, to: 89 }]); expect(f.observer.read().observed).to.have.length(1); f.observer.dispose();
  });
  it('bounds tracked actors, trail segments and retained crossing history with visible uncertainty', () => {
    const f = fixture(); f.emit(Array.from({ length: 65 }, (_, actorId) => ({ actorId, from: 89, to: 95 })));
    expect(f.observer.read().trackedActors).to.equal(64); expect(f.observer.read().gap).to.include('capacity');
    f.emit([{ actorId: 0, from: 95, to: 111 }]); expect(f.observer.read().observed).to.have.length(0);
    for (let index = 0; index < 40; index++) f.emit([{ actorId: 64, from: 95 + index / 10, to: 95 + (index + 1) / 10 }]);
    f.emit([{ actorId: 64, from: 99, to: 111 }]); expect(f.observer.read().observed[0]).to.include({ trailComplete: false }); expect(f.observer.read().observed[0].segments).to.have.length(32);
    for (let actorId = 100; actorId < 110; actorId++) f.emit([{ actorId, from: 89, to: 111 }]); expect(f.observer.read().observed).to.have.length(8); f.observer.dispose();
  });
  it('clears source history on definition changes or rewind and retires its epoch and reservation', () => {
    const f = fixture(); f.emit([{ from: 89, to: 111 }]); f.world.tickIndex = 0; expect(f.observer.read().observed).to.have.length(0);
    f.emit([{ from: 89, to: 111 }]); f.world.physicalJunctions.definitions = [{ ...f.definition, revision: 2 }]; f.state.authoringRevision = 2;
    expect(f.observer.read().observed).to.have.length(0); expect([...f.resources.held.values()]).to.deep.equal([512 * 1024]);
    f.world.generation++; expect(f.observer.read()).to.equal(null); expect(() => f.observer.select('switch')).to.throw('world changed');
    f.observer.dispose(); expect(f.resources.held.size).to.equal(0); expect(f.world.soundEvents.onBatch.handlers.size).to.equal(0); f.observer.dispose();
  });
  it('does not reserve for empty selection and refuses admission before accepting a selected observer', () => {
    const f = junctionPresentationWorld(); const observer = createPhysicalJunctionPresentation({ ...f, resources: { retain() { throw new Error('display budget'); }, release() { throw new Error('not held'); } } });
    expect(() => observer.select('missing')).to.throw('committed world'); expect(() => observer.select('switch')).to.throw('display budget'); expect(observer.read().selectedId).to.equal(null); observer.dispose();
  });
  it('keeps real physical facts and physics checkpoint hashes identical with the observer attached', async () => {
    const masks = await loadProcgenMasks(), worlds = [0, 1].map(() => new ProcgenLaneWorld({ masks, seed: 342, worldId: 'same-source', assists: false }));
    const batches = worlds.map(world => { const values = []; world.soundEvents.onBatch.on(batch => values.push(batch)); return values; });
    for (const world of worlds) {
      prepareProjectJunctions(world, [junctionDefinition()]).commit(); world.step();
      world.enqueueIntervention({ id: 'initial-route', kind: 'junction-request', origin: 'manual', target: { generation: world.generation }, parameters: { request: {
        junctionId: 'switch', configurationId: 'open', authoringRevision: 1, expiryTick: world.tickIndex + 120, policy: 'waitForSafeBoundary' } } }); world.step();
    }
    const observer = createPhysicalJunctionPresentation({ world: worlds[1] });
    observer.select('switch');
    try {
      for (let tick = 0; tick < 160; tick++) for (const world of worlds) world.step();
      expect(batches[1]).to.deep.equal(batches[0]);
      const graph = { version: 1, revision: 1, instruments: [{ id: 'crossing', sourceKind: 'MotionCommitted', gateX: 110, pitchCents: 6000, velocity01: 0.75, role: 'percussion', route: 'local' }] };
      const intents = batches.map(source => { const engine = createCausalMusicEngine({ getGraph: () => graph }); try { return source.flatMap(batch => engine.processBatch(batch)); } finally { engine.dispose(); } });
      expect(intents[0].length).to.be.greaterThan(0); expect(intents[1]).to.deep.equal(intents[0]);
      expect(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(worlds[1]))).to.equal(await hashProcgenPhysicsCheckpoint(captureProcgenCheckpoint(worlds[0])));
    } finally { observer.dispose(); for (const world of worlds) world.dispose(); }
  });
});
