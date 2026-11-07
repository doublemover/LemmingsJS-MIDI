import { expect } from 'chai';
import { createOriginalAcousticMap, createOriginalAcousticZone } from '../js/midi/content/OriginalAcousticMap.js';
import { compileAcousticMap } from '../js/midi/content/AcousticMap.js';
import { createWorldSpatialControl } from '../js/app/procgen/workstation/WorldSpatialControl.js';
import { spatialSourcePoint } from '../js/app/procgen/workstation/CausalSpatialPlayback.js';

const zones = () => ['felt', 'glass'].map((id, index) => createOriginalAcousticZone({ zoneId: id, materialResponseId: id, priority: 0, worldRegion: { kind: 'rectangle', bounds: { x1: index * 64, x2: 128 + index * 64, y1: 0, y2: 96 } } }));
const batch = (tick = 1) => ({ worldId: 'acoustic-test-world', generation: 1, tick, sourceTimeMs: tick * 12, tickDurationMs: 12, completeness: { status: 'complete' }, snapshot: { terrainRevision: 1, actors: [{ actorId: 7, x: 80, y: 70, laneId: 0 }] } });

describe('committed world acoustic controls (deferred grouped qualification)', () => {
  it('keeps camera changes out of fixed-listener controls and separates actor from fixed strike attachment', () => {
    let camera = { x: 10, y: 10 }; const control = createWorldSpatialControl({ getCameraPosition: () => camera }), map = createOriginalAcousticMap({ listener: { x: 64, y: 70 }, zones: zones() }); control.configure(map); control.observe(batch());
    const fixed = { voiceId: 'strike', actorId: 7, attachment: { kind: 'struck-point' }, sourcePosition: { x: 40, y: 70 } }, first = control.state(fixed).state; camera = { x: 4000, y: -2000 }; control.observe(batch()); expect(control.state(fixed).state).to.deep.equal(first);
    const moving = control.state({ ...fixed, voiceId: 'moving', attachment: { kind: 'actor' } }).state; expect(moving.sourceWorldPosition).to.deep.equal({ x: 80, y: 70 }); expect(first.sourceWorldPosition).to.deep.equal({ x: 40, y: 70 });
  });
  it('normalizes equal-priority overlaps independently of serialized zone order', () => {
    const a = compileAcousticMap(createOriginalAcousticMap({ zones: zones() })), b = compileAcousticMap(createOriginalAcousticMap({ zones: zones().reverse() }));
    const position = { x: 96, y: 50 }; expect(a.evaluate(position)).to.deep.equal(b.evaluate(position)); const membership = a.evaluate(position); expect(membership.memberships.reduce((sum, zone) => sum + zone.blend01, membership.dryRemainder01)).to.be.closeTo(1, 1e-12);
  });
  it('recovers the exact observed crossing point rather than moving the strike to the actor endpoint', () => {
    const graph = { pickups: [{ id: 'gate', revision: 2, geometry: { kind: 'segment', points: [{ x: 96, y: 0 }, { x: 96, y: 100 }] } }] }, fact = { positionAfter: { x: 101, y: 80 } }, intent = { observation: { kind: 'PickupCrossing', gateId: 'gate', gateRevision: 2, local01: 0.8 } };
    expect(spatialSourcePoint(fact, intent, graph)).to.deep.equal({ x: 96, y: 80 }); expect(spatialSourcePoint(fact, { observation: { ...intent.observation, gateRevision: 1 } }, graph)).to.equal(null);
  });
});
