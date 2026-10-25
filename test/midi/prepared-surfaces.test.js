import { expect } from 'chai';
import { createPreparedSurfaceMapping, validatePreparedSurfaceDefinitions } from '../../js/app/procgen/workstation/physical/PreparedSurfaceMapping.js';
import { createPreparedSurfaceBodyOwner } from '../../js/app/procgen/workstation/PreparedSurfaceBodyOwner.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { createRectangularMembraneRecipe } from '../../js/midi/content/RectangularMembraneRecipe.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { validateMappedBodyPreparation } from '../../js/midi/content/PreparedSurface.js';

const map = (revision = 0) => ({ id: 'skin-map', revision, regionInstanceId: 'region-instance-a', sourceEditRevision: revision, boundTopologyRevision: revision, bounds: { x1: 0, y1: 0, x2: 100, y2: 100 } });
const surface = () => ({ schema: 'lemmings-prepared-surface/v1', id: 'skin', revision: 1, surfaceMap: map(), heldContactPolicy: 'keep-old-tail', unknownPolicy: 'release',
  preparations: [{ id: 'damper', kind: 'touch', sourceLanes: [0], actions: ['blocking'], beginPolicy: 'current-observed-contact', radius01: 0.18, amount01: 1 }] });
const fact = (sequence, kind = 'ContactSpanUpdated', options = {}) => ({ kind, eventId: 'event-' + sequence, causalSequence: sequence, worldId: 'world-a', generation: 0, actorId: 1, laneId: 0, spanId: 'span-a',
  action: 'blocking', actionInstanceId: 'blocking-instance-a', contactRole: 'supported-body', positionAfter: { x: 50, y: 49 }, precision: 'tick', observedTick: sequence, surfaceRevision: 0, causeKind: 'support', anchor: { x: 50, y: 50 }, physicalPayload: { evidence: 'completed-support-cell' }, ...options });
const batch = (sequence, facts, options = {}) => ({ version: 1, worldId: 'world-a', generation: 0, batchId: 'batch-' + sequence, tick: sequence, facts,
  terrainRevisionAfter: 0, completeness: { status: 'complete', dropped: 0 }, sourceTimeMs: sequence * 40, tickDurationMs: 40, ...options });
const scoreTimeFor = source => ({ simTick: source.tick, frame: source.tick * 1920 });
const command = (sequence, options = {}) => validateMappedBodyPreparation({ schema: 'lemmings-mapped-body-preparation/v1', stage: 'physical-mapping-output-not-audio-admission', commandId: 'command-' + sequence,
  batchId: 'batch-' + sequence, operation: 'begin', kind: 'touch', surfaceId: 'skin', mapId: 'skin-map', mapRevision: 0, mappingId: 'skin.damper', mappingRevision: 1, preparationSlot: 'damper', beginPolicy: 'current-observed-contact',
  contactSpanId: 'span-a', actorId: 1, worldId: 'world-a', generation: 0, sourceTick: sequence, sourceSequence: sequence, sourceEventIds: ['event-' + sequence], sourceKind: 'ContactSpanBegan',
  sourceEditRevision: 0, boundTopologyRevision: 0, position: { x: 50, y: 50 }, radius01: 0.18, amount01: 1, scoreTime: { frame: sequence * 1920 }, reason: null, ...options });

async function fixture(options = {}) {
  const graphs = [await createOwnedEffectGraphKernel({ definition: createRectangularMembraneRecipe({ gridSize: 16, revision: 1 }).graph }),
    await createOwnedEffectGraphKernel({ definition: createRectangularMembraneRecipe({ gridSize: 16, revision: 2 }).graph })];
  const targets = graphs.map((graph, index) => ({ owner: 'audio-owner', ownerGeneration: 0, ownerRouteRevision: index + 1, graphDefinitionHash: graph.hash, nodeId: 'skin', processorRevision: graph.plan.nodes.find(node => node.membrane).membrane.revision, active: index === 0 }));
  const submissions = [], receipts = [], panics = []; let present = [targets[0]];
  const owner = createPreparedSurfaceBodyOwner({ documentEpoch: 'document-execution-a', resourceBudget: options.resourceBudget, inventory: () => present, toFrame: score => score.frame, onReceipt: value => receipts.push(value),
    apply: (nodeId, values, targetFrame, expected) => { const index = graphs.findIndex(graph => graph.hash === expected.graphDefinitionHash); graphs[index].update(nodeId, values); submissions.push({ index, values, targetFrame }); return { status: 'accepted', targetFrame, graphDefinitionHash: expected.graphDefinitionHash }; },
    panicBody: (nodeId, expected) => { if (options.failPanic?.()) throw new Error('panic ownership unknown'); panics.push({ nodeId, expected }); return { status: 'accepted' }; } });
  const bind = (index, surfaceMap = map(), surfaceRevision = 1) => owner.bind({ surfaceId: 'skin', surfaceRevision, surfaceMap, nodeId: 'skin', executionEpoch: 'execution-a', worldId: 'world-a', generation: 0,
    expected: { ownerRouteRevision: index + 1, graphDefinitionHash: graphs[index].hash } });
  return { graphs, owner, bind, targets, submissions, receipts, panics, replace() { targets[0].active = false; targets[1].active = true; present = targets; }, retireFirst() { present = [targets[1]]; }, retireAll() { present = []; } };
}
describe('mapped shared-surface preparation ownership', () => {
  it('projects actual complete support spans and releases unknown continuity without a musical onset', () => {
    const mapper = createPreparedSurfaceMapping(); mapper.configure([surface()]);
    const first = mapper.consume(batch(1, [fact(1, 'ContactSpanBegan')]), { scoreTimeFor }); expect(first.commands).to.have.length(1); expect(first.commands[0].operation).to.equal('begin'); expect(first.commands[0].position).to.deep.equal({ x: 50, y: 50 });
    const stationary = mapper.consume(batch(2, [fact(2)]), { scoreTimeFor }); expect(stationary.commands[0].operation).to.equal('update'); expect(stationary.commands[0].sourceEventIds).to.deep.equal(['event-2']);
    const unknown = mapper.consume(batch(3, []), { scoreTimeFor }); expect(unknown.commands[0].operation).to.equal('end'); expect(unknown.commands[0].reason).to.equal('contact-continuity-unknown');
    expect(mapper.diagnostics().heldPreparations).to.equal(0); expect(mapper.diagnostics().semanticOnsets).to.equal(0);
  });
  it('keeps preparation commands distinct from two intentionally mapped musical begins', () => {
    const graph = { version: 1, revision: 1, preparedSurfaces: [surface()], instruments: ['left', 'right'].map(id => ({ id, sourceKind: 'ContactSpanBegan', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'contact' })) };
    let delivered; const engine = createCausalMusicEngine({ getGraph: () => graph, deliver: (intents, source, commands) => { delivered = { intents, source, commands }; } });
    const intents = engine.processBatch(batch(1, [fact(1, 'ContactSpanBegan')])); expect(intents.filter(intent => intent.kind === 'begin')).to.have.length(2); expect(delivered.commands).to.have.length(1);
    expect(delivered.commands[0]).not.to.have.property('voiceId'); expect(engine.diagnostics().preparedSurfaces.heldPreparations).to.equal(1); engine.dispose();
  });
  it('restores logical contact continuation and rejects another map without mutating the old mapper', () => {
    const a = createPreparedSurfaceMapping(), b = createPreparedSurfaceMapping(); a.configure([surface()]); b.configure([surface()]);
    a.consume(batch(1, [fact(1, 'ContactSpanBegan')]), { scoreTimeFor }); const cut = a.snapshot(); b.restore(cut);
    const next = batch(2, [fact(2, 'ContactSpanUpdated', { anchor: { x: 70, y: 50 } })]); expect(a.consume(next, { scoreTimeFor })).to.deep.equal(b.consume(next, { scoreTimeFor }));
    const other = surface(); other.surfaceMap.revision = 2; b.configure([other]); expect(() => b.restore(cut)).to.throw('Incompatible');
  });
  it('keeps a rearmed empty mapping cut at the same physical frontier', () => {
    const graph = { version: 1, revision: 1, instruments: [], preparedSurfaces: [surface()] }, a = createCausalMusicEngine({ getGraph: () => graph }), b = createCausalMusicEngine({ getGraph: () => graph });
    a.processBatch(batch(1, [])); a.rearm({ discardUnknownHeldState: true }); const cut = a.snapshot(); expect(() => b.restore(cut)).not.to.throw(); a.dispose(); b.dispose();
    const mapper = createPreparedSurfaceMapping(); mapper.configure([surface()]); const changed = surface(); changed.preparations[0].amount01 = 0.5; expect(() => mapper.configure([changed])).to.throw('new content revision');
  });
  it('releases on incomplete coverage, changed terrain, actor end and map replacement', () => {
    for (const kind of ['incomplete', 'terrain', 'actor', 'map']) {
      const mapper = createPreparedSurfaceMapping(); mapper.configure([surface()]); mapper.consume(batch(1, [fact(1, 'ContactSpanBegan')]), { scoreTimeFor });
      if (kind === 'map') { const next = surface(); next.revision++; mapper.configure([next]); }
      const next = kind === 'incomplete' ? batch(2, [], { completeness: { status: 'incomplete', dropped: 1 } }) : batch(2, [fact(2, kind === 'actor' ? 'ActorTerminated' : 'ContactSpanUpdated', kind === 'terrain' ? { surfaceRevision: 1 } : {})]);
      const result = mapper.consume(next, { scoreTimeFor }); expect(result.commands.some(command => command.operation === 'end')).to.equal(true);
      if (kind !== 'map') expect(mapper.diagnostics().heldPreparations).to.equal(0);
    }
  });
  it('keeps two touch owners on the old body, admits future contacts on the replacement and rejects an old-map update', async () => {
    const f = await fixture(), first = await f.bind(0); expect(f.owner.consume(command(1), 'execution-a').status).to.equal('accepted');
    expect(f.owner.consume(command(2, { actorId: 2, contactSpanId: 'span-b', position: { x: 80, y: 50 } }), 'execution-a').status).to.equal('accepted');
    f.replace(); const second = await f.bind(1, map(1), 2); expect(first.bodyInstanceId).not.to.equal(second.bodyInstanceId);
    expect(f.owner.consume(command(3, { actorId: 3, contactSpanId: 'span-c', mapRevision: 1, mappingRevision: 2, sourceEditRevision: 1, boundTopologyRevision: 1 }), 'execution-a').status).to.equal('accepted');
    expect(f.owner.consume(command(4, { operation: 'end', sourceKind: 'ContactSpanEnded', position: null, radius01: null, amount01: null }), 'execution-a').status).to.equal('accepted');
    const state = f.owner.state(); expect(state.bindings.some(binding => binding.actorId === 1)).to.equal(false); expect(state.bindings.some(binding => binding.actorId === 2 && binding.bodyInstanceId === first.bodyInstanceId)).to.equal(true);
    const old = f.graphs[0].diagnostics().membraneStates[0]; expect(old.touches[0].amount01).to.equal(0); expect(old.touches[1].amount01).to.equal(1);
    const before = f.submissions.length; expect(f.owner.consume(command(5, { operation: 'update', sourceKind: 'ContactSpanUpdated', actorId: 3, contactSpanId: 'span-c' }), 'execution-a').status).to.equal('rejected'); expect(f.submissions).to.have.length(before);
    f.retireFirst(); f.owner.prune(); expect(f.owner.state().bindings.every(binding => binding.bodyInstanceId === second.bodyInstanceId)).to.equal(true); f.owner.dispose();
  });
  it('admits a current observed contact after explicit binding, skips unchanged native writes and never resurrects an ended owner', async () => {
    const f = await fixture(); await f.bind(0);
    expect(f.owner.consume(command(1, { operation: 'update', sourceKind: 'ContactSpanUpdated' }), 'execution-a').status).to.equal('accepted');
    expect(f.owner.consume(command(2, { operation: 'update', sourceKind: 'ContactSpanUpdated' }), 'execution-a').stage).to.equal('prepared-body-observation-refreshed'); expect(f.submissions).to.have.length(1);
    f.owner.consume(command(3, { operation: 'end', sourceKind: 'ContactSpanEnded', position: null, radius01: null, amount01: null }), 'execution-a');
    expect(f.owner.consume(command(4, { operation: 'update', sourceKind: 'ContactSpanUpdated' }), 'execution-a').status).to.equal('rejected'); expect(f.owner.state().bindings).to.have.length(0); f.owner.dispose();
  });
  it('enforces independent touch capacity and pickup ownership without creating another body or strike', async () => {
    const f = await fixture(); await f.bind(0);
    for (let index = 0; index < 4; index++) expect(f.owner.consume(command(index + 1, { actorId: index + 1, contactSpanId: 'span-' + index }), 'execution-a').status).to.equal('accepted');
    expect(f.owner.consume(command(5, { actorId: 5, contactSpanId: 'fifth' }), 'execution-a').reason).to.equal('touch-slot-capacity');
    const pickup = { kind: 'pickup-left', mappingId: 'skin.listener', preparationSlot: 'listener', radius01: null, amount01: null, contactSpanId: 'listen-a' };
    expect(f.owner.consume(command(6, pickup), 'execution-a').status).to.equal('accepted'); expect(f.owner.consume(command(7, { ...pickup, actorId: 2, contactSpanId: 'listen-b' }), 'execution-a').reason).to.equal('pickup-owner-capacity');
    expect(f.owner.state().bodies).to.have.length(1); expect(f.receipts.filter(receipt => receipt.status === 'accepted').every(receipt => receipt.sourceCardinality === 'preparation-command;zero-musical-onsets')).to.equal(true); f.owner.dispose();
  });
  it('retains concrete binding metadata and its reservation when owned clearing is unknown', async () => {
    const reservations = new Map(), resourceBudget = { reserve({ token, bytes }) { reservations.set(token, bytes); return true; }, release({ token }) { reservations.delete(token); return true; } };
    const f = await fixture({ resourceBudget, failPanic: () => true }); await f.bind(0); f.owner.consume(command(1), 'execution-a');
    expect(() => f.owner.dispose()).to.throw('ownership unknown'); expect(f.owner.state().bindings).to.have.length(1); expect(reservations.size).to.equal(1);
    f.retireAll(); f.owner.prune(); f.owner.dispose(); expect(reservations.size).to.equal(0);
  });
  it('refuses to pretend that one DSP node is two different prepared surfaces', async () => {
    const f = await fixture(); await f.bind(0); let error;
    try { await f.owner.bind({ surfaceId: 'other-skin', surfaceRevision: 1, surfaceMap: map(), nodeId: 'skin', executionEpoch: 'execution-a', worldId: 'world-a', generation: 0, expected: { ownerRouteRevision: 1, graphDefinitionHash: f.graphs[0].hash } }); } catch (caught) { error = caught; }
    expect(error?.message).to.include('separate body revision'); expect(f.owner.state().bodies).to.have.length(1); f.owner.dispose();
  });
  it('rejects foreign epochs, unknown coordinates and unsupported rebinding policies', async () => {
    const f = await fixture(); await f.bind(0); expect(f.owner.consume(command(1), 'foreign-execution').reason).to.equal('foreign-body-execution');
    expect(f.owner.consume(command(2, { position: { x: 200, y: 50 } }), 'execution-a').status).to.equal('rejected'); expect(f.owner.state().bindings).to.have.length(0);
    const invalid = surface(); invalid.heldContactPolicy = 'both'; expect(() => validatePreparedSurfaceDefinitions([invalid])).to.throw(); f.owner.dispose();
  });
});
