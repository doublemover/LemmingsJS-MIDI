import { expect } from 'chai';
import { createPhraseCargoObserver, validatePhraseCargoStations, validatePhraseCargoPayload } from '../js/app/procgen/workstation/physical/PhraseCargo.js';
import { createCausalMusicEngine, validateCausalInstrumentGraph } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
const domain = { pickups: [{ id: 'capture' }, { id: 'deliver' }, { id: 'transform' }], encounters: [{ id: 'meeting' }] };
const definitions = extra => validatePhraseCargoStations([{ id: 'pick', kind: 'capture', source: { kind: 'pickup', id: 'capture' }, payload: { version: 1, kind: 'interval-contour', baseCents: 6000, intervals: [0, 400, 300] }, maximumCopies: 2, maximumDeliveries: 2, ...extra }, { id: 'drop', kind: 'delivery', source: { kind: 'pickup', id: 'deliver' }, representation: 'chord', consume: true }], domain);
const observer = values => { const result = createPhraseCargoObserver(); result.configure(values || definitions()); return result; };
const actors = [{ actorId: 1, laneId: 0, x: 0, y: 0 }, { actorId: 2, laneId: 1, x: 0, y: 0 }];
const batch = (tick, list = actors) => ({ worldId: 'world', generation: 1, tick, batchId: `b:${tick}`, completeness: { status: 'complete' }, snapshot: { tick, generation: 1, actors: list } });
const crossing = (tick, gateId, actorId = 1, pitchCents = 6000) => ({ kind: 'PickupCrossing', actorId, laneId: actorId - 1, gateId, pitchCents, eventId: `root:${tick}:${actorId}:${gateId}`, observationId: `cross:${tick}:${actorId}:${gateId}`, sourceEventIds: [`root:${tick}:${actorId}:${gateId}`], causalSequence: tick * 100 + actorId, fraction: 1 });
const encounter = tick => ({ kind: 'EncounterBegan', encounterId: 'meeting', actorId: 1, participants: [1, 2], participantCount: 2, rootCoverage: 'complete', eventId: `meeting:${tick}:1`, observationId: `meeting:${tick}`, sourceEventIds: [`meeting:${tick}:1`, `meeting:${tick}:2`], causalSequence: tick * 100, fraction: 1 });
describe('actor-borne physical phrase cargo', () => {
  it('validates rational and interval payloads without accepting live voices or unsafe pitches', () => {
    expect(validatePhraseCargoPayload({ version: 1, kind: 'ratio', baseCents: 6000, numerator: 3, denominator: 2 }).kind).to.equal('ratio');
    for (const payload of [{ version: 1, kind: 'voice', voice: {} }, { version: 1, kind: 'ratio', baseCents: 6000, numerator: 3, denominator: 0 }, { version: 1, kind: 'interval-contour', baseCents: 24000, intervals: [0, 1] }]) expect(() => validatePhraseCargoPayload(payload)).to.throw();
  });
  it('never autonomously plays a carried contour; actual arrival creates only the declared chord', () => {
    const cargo = observer(); expect(cargo.observe(batch(1), [crossing(1, 'capture')]).responses).to.have.length(0);
    for (let tick = 2; tick < 70; tick++) expect(cargo.observe(batch(tick), []).responses).to.have.length(0);
    const result = cargo.observe(batch(70), [crossing(70, 'deliver')]); expect(result.responses.map(value => value.pitchCents)).to.deep.equal([6000, 6400, 6700]); expect(result.responses.every(value => value.simTick === 70 && value.responseDescriptor.timedSequence === false)).to.equal(true); expect(result.facts[0].sourceEventIds).to.include('root:1:1:capture').and.include('root:70:1:deliver'); expect(cargo.snapshot().tokens).to.have.length(0);
    expect(cargo.observe(batch(70), [crossing(70, 'deliver')]).responses).to.have.length(0);
  });
  it('copies only at an exact qualified pair and shares a finite delivery/duplication budget', () => {
    const config = [...definitions({ maximumDeliveries: 1 }), ...validatePhraseCargoStations([{ id: 'exchange', kind: 'exchange', source: { kind: 'encounter', id: 'meeting' }, policy: 'copy' }], domain)], cargo = observer(config);
    cargo.observe(batch(1), [crossing(1, 'capture')]); const copied = cargo.observe(batch(2), [encounter(2)]); expect(copied.facts[0].kind).to.equal('CargoExchanged'); expect(cargo.snapshot().tokens).to.have.length(2);
    const delivered = cargo.observe(batch(3), [crossing(3, 'deliver', 2)]); expect(delivered.responses).to.have.length(3); expect(delivered.responses[0].sourceEventIds).to.include('meeting:2:1').and.include('meeting:2:2'); expect(cargo.snapshot().tokens).to.have.length(0); expect(cargo.snapshot().families).to.have.length(0); expect(cargo.observe(batch(4), [crossing(4, 'deliver', 1)]).responses).to.have.length(0);
    const unqualified = observer(config); unqualified.observe(batch(1), [crossing(1, 'capture')]); expect(unqualified.observe(batch(2), [{ ...encounter(2), rootCoverage: 'capped' }]).facts).to.have.length(0);
  });
  it('swaps ownership atomically in stable participant order and transforms only at physical contact', () => {
    const config = [...definitions(), ...validatePhraseCargoStations([{ id: 'swap', kind: 'exchange', source: { kind: 'encounter', id: 'meeting' }, policy: 'swap' }, { id: 'trans', kind: 'transform', source: { kind: 'pickup', id: 'transform' }, operation: 'transpose', cents: 1200 }], domain)], cargo = observer(config);
    cargo.observe(batch(1), [crossing(1, 'capture', 1), crossing(1, 'capture', 2)]); const ids = cargo.snapshot().tokens.map(([, token]) => token.tokenId); cargo.observe(batch(2), [{ ...encounter(2), participants: [2, 1] }]); const after = new Map(cargo.snapshot().tokens); expect(after.get('1:0').tokenId).to.equal(ids[1]); expect(after.get('2:0').tokenId).to.equal(ids[0]);
    cargo.observe(batch(3), [crossing(3, 'transform', 1)]); const response = cargo.observe(batch(4), [crossing(4, 'deliver', 1)]); expect(response.responses.map(value => value.pitchCents)).to.deep.equal([7200, 7600, 7900]);
  });
  it('captures only complete actual recent pickup intervals and preserves them through lane transfer/checkpoint', () => {
    const config = definitions({ mode: 'recent-pickup-contour', history: { eventCount: 2, windowTicks: 10 } }), a = observer(config); a.observe(batch(1), [crossing(1, 'other', 1, 6100)]); a.observe(batch(2), [crossing(2, 'other', 1, 6600)]); a.observe(batch(3), [crossing(3, 'capture')]);
    const saved = a.snapshot(), b = observer(config); b.restore(saved); const moved = actors.map(value => ({ ...value, laneId: value.actorId === 1 ? 7 : value.laneId })); const expected = a.observe(batch(4, moved), [crossing(4, 'deliver')]); expect(b.observe(batch(4, moved), [crossing(4, 'deliver')])).to.deep.equal(expected); expect(expected.responses.map(value => value.pitchCents)).to.deep.equal([6100, 6600]); expect(expected.responses.every(value => value.laneId === 7)).to.equal(true); expect(saved.tokens).to.have.length(1);
    const gap = observer(config); gap.observe(batch(1), [crossing(1, 'other')]); gap.observe({ ...batch(2), completeness: { status: 'partial' } }, []); expect(gap.observe(batch(3), [crossing(3, 'capture')]).facts).to.have.length(0);
  });
  it('retires death, expiry and generation ownership and cannot resurrect delivered cargo on a duplicate boundary', () => {
    const cargo = observer(definitions({ expiryTicks: 2 })); cargo.observe(batch(1), [crossing(1, 'capture')]); cargo.observe(batch(2), []); expect(cargo.observe(batch(3), [crossing(3, 'deliver')]).responses).to.have.length(0);
    cargo.observe(batch(4), [crossing(4, 'capture')]); expect(cargo.observe(batch(5), [{ kind: 'ActorTerminated', actorId: 1, eventId: 'death:1' }, crossing(5, 'deliver')]).responses).to.have.length(0);
    cargo.observe(batch(6), [crossing(6, 'capture')]); expect(cargo.observe({ ...batch(7), generation: 2 }, [crossing(7, 'deliver')]).responses).to.have.length(0);
  });
  it('refuses malformed checkpoint ownership before changing the live token or reservation accounting', () => {
    const cargo = observer(); cargo.observe(batch(1), [crossing(1, 'capture')]); const before = cargo.snapshot(), invalid = JSON.parse(JSON.stringify(before)); invalid.tokens[0][1].slot = 3; expect(() => cargo.restore(invalid)).to.throw(); expect(cargo.snapshot()).to.deep.equal(before);
  });
});
describe('cargo through the real shared walking action', () => {
  let masks; before(async () => { masks = await loadProcgenMasks(); });
  const run = ({ destinationX = 100, delay = false } = {}) => {
    const world = new ProcgenLaneWorld({ masks, assists: false, seed: 42, laneCount: 1 }), actor = world.actors[0]; world.baseGroundAt = (_x, y) => y >= 72 ? 1 : 0; actor.x = 39; actor.y = 72; actor.setAction(world.actions[State.WALKING]);
    const graph = validateCausalInstrumentGraph({ version: 1, revision: 1, pickups: [['capture', 40], ['deliver', destinationX]].map(([id, x]) => ({ id, geometry: { kind: 'segment', points: [{ x, y: 40 }, { x, y: 73 }] } })), cargoStations: definitions(), instruments: [{ id: 'courier', sourceKind: 'CargoDelivery', cargoStationId: 'drop', pitchCents: 6000, velocity01: 0.5, role: 'courier', route: 'local' }] });
    const engine = createCausalMusicEngine({ getGraph: () => graph }), attacks = [], captures = []; world.soundEvents.onBatch.on(batch => { for (const intent of engine.processBatch(batch)) if (intent.kind === 'begin') attacks.push({ tick: batch.tick, pitch: intent.pitch.cents, roots: intent.sourceEventIds }); for (const fact of engine.physicalAnalysis()?.facts || []) if (fact.kind === 'CargoCaptured') captures.push(fact); });
    try { for (let tick = 0; tick < 130; tick++) { if (delay && [29, 39].includes(tick)) world.enqueueIntervention({ id: `wait:${tick}`, kind: tick === 29 ? 'place-blocker' : 'release-blocker', origin: 'manual', target: { generation: world.generation, actorId: actor.id }, parameters: {} }); world.step(tick * 17); } return { attacks, captures }; } finally { world.dispose(); }
  };
  it('moves delivery with actual route travel and a real blocker delay instead of a fixed capture timer', () => {
    const normal = run(), shifted = run({ destinationX: 101 }), delayed = run({ delay: true }); expect(normal.attacks).to.have.length(3); expect(normal.captures).to.have.length(1); expect(shifted.attacks[0].tick).to.equal(normal.attacks[0].tick + 1); expect(delayed.attacks[0].tick).to.be.greaterThan(normal.attacks[0].tick); expect(normal.attacks[0].tick).to.be.greaterThan(normal.captures[0].simTick);
  });
});
