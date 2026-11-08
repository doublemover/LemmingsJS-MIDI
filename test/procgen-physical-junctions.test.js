import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { validatePhysicalJunction } from '../js/app/procgen/PhysicalJunctions.js';
import { inspectTerrainInfluence, planTerrainCommand } from '../js/app/procgen/TerrainAuthoringAdapter.js';
import { prepareProjectJunctions } from '../js/app/procgen/workstation/PhysicalJunctionProject.js';
import { alignPhysicalPorts } from '../js/app/procgen/workstation/physical/PhysicalPorts.js';
import { captureProcgenCheckpoint, restoreProcgenCheckpoint } from '../js/app/procgen/workstation/ProcgenCheckpoint.js';
const definition = () => validatePhysicalJunction({ id: 'switch', revision: 1, safetyVersion: 1,
  control: { x1: 100, x2: 102, y1: 10, y2: 12 }, influence: { x1: 90, x2: 112, y1: 0, y2: 40 },
  ports: [{ id: 'in', role: 'inlet', position: { x: 92, y: 30 }, direction: 'right' }, { id: 'out', role: 'outlet', position: { x: 110, y: 30 }, direction: 'right' }],
  configurations: [false, true].map(solid => ({ id: solid ? 'closed' : 'open', outletIds: ['out'], spans: [10, 11].map(y => ({ y, x1: 100, x2: 102, solid })) })) });
const request = (world, id, configurationId = 'closed', extra = {}) => ({ id, transactionId: id, kind: 'junction-request', origin: 'manual', target: { generation: world.generation }, parameters: { request: {
  junctionId: 'switch', authoringRevision: 1, configurationId, policy: 'waitForSafeBoundary', expiryTick: world.tickIndex + 120, ...extra } } });
describe('queued physical junction requests', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  const ready = () => { const world = new ProcgenLaneWorld({ masks, assists: false }); prepareProjectJunctions(world, [definition()]).commit(); world.step(); return world; };
  it('stores definitions in the shared command queue and atomically applies a mixed solid/opening patch', () => {
    const world = ready(), batches = []; world.soundEvents.onBatch.on(batch => batches.push(batch));
    expect(world.queryJunction('switch').actual).to.equal(null); world.enqueueIntervention(request(world, 'close')); world.step();
    expect(world.hasGroundAt(100, 10)).to.equal(true); expect(world.queryJunction('switch').actual.configurationId).to.equal('closed');
    expect(batches.flatMap(batch => batch.facts).some(fact => fact.kind === 'TerrainWorkCommitted')).to.equal(false);
    world.enqueueIntervention(request(world, 'open', 'open')); world.step(); expect(world.hasGroundAt(100, 10)).to.equal(false);
    const receipt = world.interventionState.receipts.at(-1); expect(receipt.terrain.counts.solidRemoved).to.equal(4); expect(receipt.terrain.junction.passageGuaranteed).to.equal(false); world.dispose();
  });
  it('waits for actual safe influence, not merely empty changed cells, and owns no worker reservation', () => {
    const world = ready(), actor = world.actors[0]; actor.x = 110; actor.y = 55;
    expect(inspectTerrainInfluence(world, definition().influence).status).to.equal('busy');
    const before = world.terrainRevision; world.enqueueIntervention(request(world, 'wait')); world.step();
    expect(world.queryJunction('switch').pending[0].state).to.equal('waiting'); expect(world.terrainRevision).to.equal(before);
    expect(world.hasGroundAt(100, 10)).to.equal(false); actor.x = 40; actor.y = 71; world.step();
    expect(world.hasGroundAt(100, 10)).to.equal(true); expect(world.queryJunction('switch').pending).to.have.length(0); world.dispose();
  });
  it('protects active work claims and refuses unknown actor-action footprints', () => {
    const world = ready(), actor = world.actors[0], action = actor.action;
    world.accessTasks[0] = [{ footprint: { x1: 95, x2: 99, y1: 30, y2: 35 } }]; expect(inspectTerrainInfluence(world, definition().influence).reason).to.equal('claimed-work');
    world.accessTasks[0] = null; actor.x = 100; actor.y = 30; actor.action = { actionName: 'future-unsupported-action' };
    expect(inspectTerrainInfluence(world, definition().influence).reason).to.equal('unknown-actor-footprint'); actor.action = action; world.dispose();
  });
  it('rejects a stale region and cancels or expires waiting input without partial geometry', () => {
    const world = ready(); world.enqueueIntervention(request(world, 'stale')); world.setGroundAt(110, 10); world.step();
    expect(world.interventionState.receipts.at(-1).reason).to.equal('stale-junction-region'); expect(world.hasGroundAt(100, 10)).to.equal(false);
    world.enqueueIntervention(request(world, 'cancel')); expect(world.cancelIntervention('cancel')).to.equal(true); world.step(); expect(world.hasGroundAt(100, 10)).to.equal(false);
    world.enqueueIntervention(request(world, 'expire', 'closed', { expiryTick: world.tickIndex + 1 })); world.step(); expect(world.interventionState.receipts.at(-1).status).to.equal('expired'); world.dispose();
  });
  it('records uncommitted last-wins supersession without aliasing active requests', () => {
    const world = ready(); world.enqueueIntervention(request(world, 'old', 'closed', { coalesce: true })); world.enqueueIntervention(request(world, 'latest', 'open', { coalesce: true }));
    expect(world.interventionState.receipts.at(-1)).to.include({ commandId: 'old', status: 'superseded', supersededBy: 'latest' }); world.step();
    expect(world.hasGroundAt(100, 10)).to.equal(false); expect(world.queryJunction('switch').actual.configurationId).to.equal('open'); world.dispose();
  });
  it('makes definition batches speculative and preserves last-wins updates through project Undo-style revisions', () => {
    const world = new ProcgenLaneWorld({ masks, assists: false }), original = world.interventionState;
    const proposal = prepareProjectJunctions(world, [definition()]); expect(world.interventionState).to.equal(original); proposal.commit();
    const next = { ...definition(), revision: 2 }; prepareProjectJunctions(world, [next]).commit(); world.step(); expect(world.queryJunction('switch').authoringRevision).to.equal(2);
    prepareProjectJunctions(world, []).commit(); world.step(); expect(world.queryJunction('switch')).to.equal(null); world.dispose();
  });
  it('replays twenty safe switches and restores pending requests through actual checkpoint state', () => {
    const a = ready(), b = new ProcgenLaneWorld({ masks, assists: false }); restoreProcgenCheckpoint(b, JSON.parse(JSON.stringify(captureProcgenCheckpoint(a))));
    const left = [], right = []; a.soundEvents.onBatch.on(batch => left.push(batch)); b.soundEvents.onBatch.on(batch => right.push(batch));
    for (let index = 0; index < 20; index++) { const command = request(a, `switch:${index}`, index % 2 ? 'open' : 'closed'); a.enqueueIntervention(command); b.enqueueIntervention(command); a.step(); b.step(); }
    expect(left).to.deep.equal(right); expect(captureProcgenCheckpoint(a)).to.deep.equal(captureProcgenCheckpoint(b));
    a.enqueueIntervention(request(a, 'pending')); restoreProcgenCheckpoint(b, JSON.parse(JSON.stringify(captureProcgenCheckpoint(a)))); expect(b.queryJunction('switch').pending[0].requestId).to.equal('pending'); a.dispose(); b.dispose();
  });
  it('rejects incompatible ports and conflicting finite patch declarations', () => {
    const [inlet, outlet] = definition().ports; expect(alignPhysicalPorts(outlet, inlet).reasons).to.include('position-mismatch');
    const world = ready(); expect(() => planTerrainCommand({ operation: 'replaceSolid', generation: 1, transactionId: 'bad', spans: [{ x1: 100, x2: 102, y: 10, solid: true }, { x1: 101, x2: 103, y: 10, solid: false }] }, world)).to.throw('Conflicting'); world.dispose();
  });
});
