import { expect } from 'chai';
import { createPreparedSurfaceMapping, validatePreparedSurfaceDefinitions } from '../../js/app/procgen/workstation/physical/PreparedSurfaceMapping.js';
import { createPreparedSurfaceBodyOwner } from '../../js/app/procgen/workstation/PreparedSurfaceBodyOwner.js';
import { createCausalMusicEngine } from '../../js/app/procgen/workstation/CausalMusicEngine.js';
import { createRectangularMembraneRecipe } from '../../js/midi/content/RectangularMembraneRecipe.js';
import { createSympatheticMapRecipe } from '../../js/midi/content/SympatheticMapRecipes.js';
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
  const definition = revision => options.modal ? createSympatheticMapRecipe({ recipe: 'felt-bridge', revision, damp01: 0 }).graph : createRectangularMembraneRecipe({ gridSize: 16, revision }).graph;
  const graphs = [await createOwnedEffectGraphKernel({ definition: definition(1) }), await createOwnedEffectGraphKernel({ definition: definition(2) })];
  const targets = graphs.map((graph, index) => { const profile = graph.plan.nodes.find(node => node.membrane || node.network), body = profile.membrane || profile.network; return { owner: 'audio-owner', ownerGeneration: 0, ownerRouteRevision: index + 1, graphDefinitionHash: graph.hash, nodeId: profile.id, processorRevision: body.revision, active: index === 0,
    ...(options.modal ? { preparationKinds: ['mode-loss', 'pickup-left', 'pickup-right'], pickupGrid: { id: body.pickupGrid.id, controls: { pickupLeftX01: { pendingFuture: false } } }, lossMasks: body.lossMasks.map((mask, index) => ({ id: mask.id, index, target01: 0, pendingFuture: false })) } : {}) }; });
  const submissions = [], receipts = [], panics = []; let present = [targets[0]];
  const owner = createPreparedSurfaceBodyOwner({ documentEpoch: 'document-execution-a', resourceBudget: options.resourceBudget, inventory: () => present, toFrame: score => score.frame, onReceipt: value => receipts.push(value),
    apply: (nodeId, values, targetFrame, expected) => { const index = graphs.findIndex(graph => graph.hash === expected.graphDefinitionHash); graphs[index].update(nodeId, values); submissions.push({ index, values, targetFrame }); return { status: 'accepted', targetFrame, graphDefinitionHash: expected.graphDefinitionHash }; },
    panicBody: (nodeId, expected) => { if (options.failPanic?.()) throw new Error('panic ownership unknown'); panics.push({ nodeId, expected }); return { status: 'accepted' }; } });
  const bind = (index, surfaceMap = map(), surfaceRevision = 1) => owner.bind({ surfaceId: 'skin', surfaceRevision, surfaceMap, nodeId: options.modal ? 'bodies' : 'skin', preparationKinds: options.modal ? ['mode-loss'] : null, executionEpoch: 'execution-a', worldId: 'world-a', generation: 0,
    expected: { ownerRouteRevision: index + 1, graphDefinitionHash: graphs[index].hash } });
  return { graphs, owner, bind, targets, submissions, receipts, panics, replace() { targets[0].active = false; targets[1].active = true; present = targets; }, retireFirst() { present = [targets[1]]; }, retireAll() { present = []; } };
}
describe('mapped shared-surface preparation ownership', () => {
  const modeCommand = (sequence, values = {}) => command(sequence, { kind: 'mode-loss', lossMaskId: 'felt-alternating', preparationSlot: 'felt', mappingId: 'skin.felt', radius01: null, amount01: 0.7, ...values });
  const pickupCommand = (sequence, values = {}) => command(sequence, { kind: 'pickup-left', preparationSlot: 'observer-left', mappingId: 'skin.observer-left', radius01: null, amount01: null, ...values });
  it('keeps independent observed modal pickups on their actual body through replacement and holds the last position on release', async () => {
    const f = await fixture({ modal: true }); await f.bind(0); expect(f.owner.consume(pickupCommand(1, { position: { x: 20, y: 40 } }), 'execution-a').status).to.equal('accepted');
    expect(f.owner.consume(pickupCommand(2, { actorId: 2, contactSpanId: 'span-b' }), 'execution-a').reason).to.equal('pickup-owner-capacity');
    expect(f.owner.consume(pickupCommand(3, { kind: 'pickup-right', actorId: 2, contactSpanId: 'span-b', preparationSlot: 'observer-right', mappingId: 'skin.observer-right', position: { x: 80, y: 60 } }), 'execution-a').status).to.equal('accepted');
    f.replace(); await f.bind(1, map(1), 2); f.owner.consume(pickupCommand(4, { operation: 'update', sourceKind: 'ContactSpanUpdated', position: { x: 30, y: 40 } }), 'execution-a');
    const old = f.graphs[0].diagnostics().sympatheticStates[0].pickups; expect(old.targets[0]).to.equal(Math.fround(0.3)); expect(old.targets[2]).to.equal(Math.fround(0.8));
    const writes = f.submissions.length; f.owner.consume(pickupCommand(5, { operation: 'end', sourceKind: 'ContactSpanEnded', position: null }), 'execution-a'); expect(f.submissions.length).to.equal(writes);
    expect(f.owner.state().bindings).to.have.length(1); expect(f.graphs[0].diagnostics().sympatheticStates[0].pickups.targets[0]).to.equal(old.targets[0]); f.owner.dispose();
  });
  it('requires future manual observation automation to finish before physical handoff', async () => {
    const f = await fixture({ modal: true }); f.targets[0].pickupGrid.controls.pickupLeftX01.pendingFuture = true; let error; try { await f.bind(0); } catch (caught) { error = caught; }
    expect(error.message).to.include('future manual pickup'); expect(f.owner.state().bodies).to.have.length(0); f.targets[0].pickupGrid.controls.pickupLeftX01.pendingFuture = false; await f.bind(0); f.owner.dispose();
  });
  it('maps actual completed support to named authored mode loss without spatial radius or musical onsets', () => {
    const value = surface(); value.preparations = [{ id: 'felt', kind: 'mode-loss', lossMaskId: 'felt-alternating', sourceLanes: [0], actions: ['blocking'], beginPolicy: 'current-observed-contact', amount01: 0.7 }];
    const mapping = { version: 1, revision: 1, instruments: [], preparedSurfaces: [value] }, engine = createCausalMusicEngine({ getGraph: () => mapping });
    expect(engine.processBatch(batch(1, [fact(1, 'ContactSpanBegan')]))).to.deep.equal([]); const prepared = engine.bodyPreparations(); expect(prepared.commands).to.have.length(1);
    expect(prepared.commands[0]).to.include({ kind: 'mode-loss', lossMaskId: 'felt-alternating', amount01: 0.7, radius01: null }); engine.dispose();
    value.preparations[0].radius01 = 0.12; expect(() => validatePreparedSurfaceDefinitions([value])).to.throw('authored mask');
  });
  it('aggregates independent owners of the same mask and releases one without clearing another contribution', async () => {
    const f = await fixture({ modal: true }); await f.bind(0);
    expect(f.owner.consume(modeCommand(1, { amount01: 0.4 }), 'execution-a').status).to.equal('accepted');
    expect(f.owner.consume(modeCommand(2, { actorId: 2, contactSpanId: 'span-b', amount01: 0.9 }), 'execution-a').status).to.equal('accepted');
    const state = () => f.graphs[0].diagnostics().sympatheticStates[0].lossMasks[0].target01; expect(state()).to.equal(Math.fround(0.9)); const writes = f.submissions.length;
    expect(f.owner.consume(modeCommand(3, { operation: 'end', sourceKind: 'ContactSpanEnded', position: null, amount01: null }), 'execution-a').status).to.equal('accepted');
    expect(state()).to.equal(Math.fround(0.9)); expect(f.submissions).to.have.length(writes); expect(f.owner.state().bindings).to.have.length(1);
    f.owner.consume(modeCommand(4, { actorId: 2, contactSpanId: 'span-b', operation: 'end', sourceKind: 'ContactSpanEnded', position: null, amount01: null }), 'execution-a'); expect(state()).to.equal(0); expect(f.owner.state().bindings).to.have.length(0); f.owner.dispose();
  });
  it('retains independent authored masks on the old body through replacement and rejects a stale update on the new one', async () => {
    const f = await fixture({ modal: true }), first = await f.bind(0);
    f.owner.consume(modeCommand(1), 'execution-a'); f.owner.consume(modeCommand(2, { actorId: 2, contactSpanId: 'span-b', lossMaskId: 'felt-complement', preparationSlot: 'felt-other', mappingId: 'skin.other' }), 'execution-a');
    f.replace(); const second = await f.bind(1, map(1), 2);
    f.owner.consume(modeCommand(3, { actorId: 3, contactSpanId: 'span-c', mapRevision: 1, mappingRevision: 2, sourceEditRevision: 1, boundTopologyRevision: 1 }), 'execution-a');
    f.owner.consume(modeCommand(4, { operation: 'end', sourceKind: 'ContactSpanEnded', position: null, amount01: null }), 'execution-a');
    const old = f.graphs[0].diagnostics().sympatheticStates[0]; expect(old.lossMasks[0].target01).to.equal(0); expect(old.lossMasks[1].target01).to.equal(Math.fround(0.7));
    expect(f.owner.state().bindings.find(binding => binding.actorId === 2).bodyInstanceId).to.equal(first.bodyInstanceId); expect(f.owner.state().bindings.find(binding => binding.actorId === 3).bodyInstanceId).to.equal(second.bodyInstanceId);
    const writes = f.submissions.length; expect(f.owner.consume(modeCommand(5, { actorId: 3, contactSpanId: 'span-c', operation: 'update', sourceKind: 'ContactSpanUpdated' }), 'execution-a').status).to.equal('rejected'); expect(f.submissions).to.have.length(writes); f.owner.dispose();
  });
  it('rejects future manual preparation and unsupported mask capabilities before binding a physical owner', async () => {
    const f = await fixture({ modal: true }); let caught; f.targets[0].lossMasks[0].pendingFuture = true;
    try { await f.bind(0); } catch (error) { caught = error; } expect(caught.message).to.include('future manual automation'); expect(f.owner.state().bodies).to.have.length(0);
    f.targets[0].lossMasks[0].pendingFuture = false; f.targets[0].lossMasks[0].target01 = 0.5;
    try { await f.bind(0); } catch (error) { caught = error; } expect(caught.message).to.include('manual mode-loss');
    f.targets[0].lossMasks[0].target01 = 0; await f.bind(0); expect(f.owner.consume(command(1), 'execution-a').reason).to.equal('body-preparation-kind-unavailable'); f.owner.dispose();
  });
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
    const other = surface(); other.revision++; other.surfaceMap.revision = 2; b.configure([other]); expect(() => b.restore(cut)).to.throw('Incompatible');
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
    expect(f.owner.consume(command(8, { ...pickup, operation: 'update', sourceKind: 'ContactSpanUpdated', actorId: 3, contactSpanId: 'listen-c' }), 'execution-a').reason).to.equal('pickup-owner-capacity');
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
